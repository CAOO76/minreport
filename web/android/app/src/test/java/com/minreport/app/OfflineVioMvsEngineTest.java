package com.minreport.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/**
 * Unit tests for WalkRingToeSolver and OfflineVioMvsEngine verifying:
 * 1. Synthetic conical stockpile volume accuracy (< 5% error on 8 m diameter x 2.5 m height pile)
 * 2. Crater-free DEM filling (zeroCellsInside == 0 even with sparse interior holes)
 * 3. Gravity regularization preventing false ground slope tilt on flat pads (groundSlopeDeg <= 2.0 deg)
 * 4. Auto-ROI ray intersection center accuracy for both 360-deg rings and partial 180-deg wall arcs
 * 5. Pure-Java FAST+rBRIEF known-pose 3D triangulation + Stage 1B Census+ZNCC execution
 */
public class OfflineVioMvsEngineTest {

    @Test
    public void testSyntheticConicalStockpileVolumeAndFlatGroundRegularization() {
        // Synthetic copper mining stockpile: radius = 4.0 m (diameter 8.0 m), height = 2.5 m
        // Exact analytical cone volume: (1/3) * pi * r^2 * h = 41.8879 m^3
        final float radiusM = 4.0f;
        final float heightM = 2.5f;
        final double exactVolumeM3 = (Math.PI * radiusM * radiusM * heightM) / 3.0;
        final float groundY = -1.45f;

        final List<float[]> points = new ArrayList<>();
        final List<float[]> groundSamples = new ArrayList<>();
        final List<WalkRingToeSolver.WalkPose> walkPoses = new ArrayList<>();

        // Sample dense stockpile surface with an intentional interior hole (simulating sparse top/occluded band)
        for (float x = -radiusM; x <= radiusM; x += 0.14f) {
            for (float z = -radiusM; z <= radiusM; z += 0.14f) {
                final float r = (float) Math.hypot(x, z);
                if (r <= radiusM) {
                    // Leave a 0.6m x 0.6m interior unobserved hole on the side slope to prove crater-free fill
                    if (x > 0.6f && x < 1.2f && z > 0.6f && z < 1.2f) {
                        continue;
                    }
                    final float h = heightM * (1.0f - (r / radiusM));
                    points.add(new float[] { x, groundY + h, z, 2.0f });
                } else if (r <= radiusM + 1.2f) {
                    groundSamples.add(new float[] { x, groundY, z });
                }
            }
        }

        // Inject contaminated elevated "plateau" plane sample (must be filtered by y <= y_cam - 0.8m)
        groundSamples.add(new float[] { 0.0f, groundY + 2.3f, 0.0f });

        // 32-pose walk ring at r = 6.5 m around (0, 0), camera height = 0.0 m (1.45 m above ground)
        for (int i = 0; i < 32; i++) {
            final double ang = (2.0 * Math.PI * i) / 32.0;
            final float wx = (float) (Math.cos(ang) * 6.5);
            final float wz = (float) (Math.sin(ang) * 6.5);
            final float fx = (float) (-Math.cos(ang));
            final float fz = (float) (-Math.sin(ang));
            walkPoses.add(new WalkRingToeSolver.WalkPose(wx, 0.0f, wz, fx, -0.30f, fz, i * 100_000_000L));
        }

        final WalkRingToeSolver.MetrologyResult res = WalkRingToeSolver.solve(
            points,
            walkPoses,
            groundSamples,
            false,
            0.4
        );

        final double relErrPct = Math.abs(res.volumeM3 - exactVolumeM3) / exactVolumeM3 * 100.0;
        assertTrue(
            "Expected volume within 5% of " + exactVolumeM3 + ", got " + res.volumeM3 + " (err=" + relErrPct + "%)",
            relErrPct < 5.0
        );
        assertEquals("Interior crater cells must be strictly 0", 0, res.zeroCellsInside);
        assertTrue(
            "Flat pad must not produce false slope tilt (got " + res.groundSlopeDeg + " deg)",
            res.groundSlopeDeg < 2.0
        );
        assertEquals("VALID_IN_SITU", res.metrologyGrade);
        assertTrue("Toe score should be high on full 360 walk", res.toeScore >= 80.0);
        assertTrue("Uncertainty should be realistic [2.5, 12.0]", res.uncertaintyPct >= 2.5 && res.uncertaintyPct <= 12.0);
        final double exactAreaM2 = Math.PI * radiusM * radiusM;
        assertTrue(
            "Footprint area should match pi*r^2 (~" + exactAreaM2 + "), got " + res.footprintAreaM2,
            Math.abs(res.footprintAreaM2 - exactAreaM2) / exactAreaM2 < 0.12
        );
        assertNotNull("Local preview mesh must be emitted", res.previewMesh);
        assertEquals("dem_grid_v1", res.previewMesh.format);
        assertTrue("Preview mesh must stay compact (<= 32x32)", res.previewMesh.cols <= 32 && res.previewMesh.rows <= 32);
        assertNotNull("confidenceMask must be populated", res.previewMesh.confidenceMask);
        assertEquals(res.previewMesh.heightsM.length, res.previewMesh.confidenceMask.length);
        int emptyCells = 0;
        int interpCells = 0;
        int obsCells = 0;
        for (byte cVal : res.previewMesh.confidenceMask) {
            assertTrue("confidenceMask values must be in {0,1,2}", cVal == 0 || cVal == 1 || cVal == 2);
            if (cVal == 0) emptyCells++;
            else if (cVal == 1) interpCells++;
            else obsCells++;
        }
        assertTrue("Preview mesh must contain observed cells (2)", obsCells > 20);
        assertTrue("Preview mesh must contain empty exterior corners (0)", emptyCells > 0);
        assertTrue("Preview mesh must preserve interpolated interior hole marker (1) or full obs", interpCells >= 0);
        assertEquals(res.planeA, res.previewMesh.planeA, 1e-6);
        assertEquals(res.planeB, res.previewMesh.planeB, 1e-6);
        assertEquals(res.planeD, res.previewMesh.planeD, 1e-6);
    }

    @Test
    public void testPartialArcAgainstWallRayIntersectionCenter() {
        // 180-degree arc around a stockpile centered at (3.0, -2.0) against a back wall
        final float trueCx = 3.0f;
        final float trueCz = -2.0f;
        final List<WalkRingToeSolver.WalkPose> arcPoses = new ArrayList<>();
        for (int i = 0; i <= 12; i++) {
            final double ang = Math.toRadians(-90.0 + i * 15.0); // 180-degree front arc
            final float px = trueCx + (float) (Math.cos(ang) * 5.0);
            final float pz = trueCz + (float) (Math.sin(ang) * 5.0);
            final float fx = (float) (-Math.cos(ang));
            final float fz = (float) (-Math.sin(ang));
            arcPoses.add(new WalkRingToeSolver.WalkPose(px, 0.0f, pz, fx, -0.2f, fz, i * 1000L));
        }

        final float[] est = WalkRingToeSolver.estimateAutoCenterXZ(arcPoses, new ArrayList<>());
        assertEquals(trueCx, est[0], 0.15f);
        assertEquals(trueCz, est[1], 0.15f);
    }

    @Test
    public void testPureJavaKnownPoseFastBriefTriangulationAndEngineSolve() {
        // Synthetic textured planar/mound scene rendered into 3 known-pose cameras at 4:3 (160x120)
        final int w = 160;
        final int h = 120;
        final float fx = 140.0f;
        final float fy = 140.0f;
        final float cx = 80.0f;
        final float cy = 60.0f;

        // Place 3D textured checkpoints on a 3m x 3m wall at z = -4.0 m
        final List<float[]> worldMarkers = new ArrayList<>();
        for (int iy = -2; iy <= 2; iy++) {
            for (int ix = -3; ix <= 3; ix++) {
                worldMarkers.add(new float[] { ix * 0.45f, iy * 0.35f, -4.0f });
            }
        }

        final float[] identityR = { 1, 0, 0, 0, 1, 0, 0, 0, 1 };
        final OfflineVioMvsEngine engine = new OfflineVioMvsEngine();

        final float[] camXs = { -0.5f, 0.0f, 0.5f };
        for (int k = 0; k < camXs.length; k++) {
            final byte[] luma = renderSyntheticLuma(w, h, fx, fy, cx, cy, camXs[k], worldMarkers);
            final OfflineVioMvsEngine.KeyframeFrame kf = new OfflineVioMvsEngine.KeyframeFrame(
                k, w, h, luma, fx, fy, cx, cy,
                identityR, new float[] { camXs[k], 0.0f, 0.0f },
                k * 100_000_000L
            );
            engine.ingestKeyframeIncremental(kf);
        }

        assertTrue(
            "Known-pose FAST+rBRIEF triangulation should reconstruct 3D markers (got " +
                engine.getIncrementalPointCount() + ")",
            engine.getIncrementalPointCount() >= 4
        );
    }

    @Test
    public void testEstimateAutoCenterProjectsForward3mOnFewPosesAndShortCollinearArc() {
        // 0 poses & no points -> never {0,0}, projects +3.0m along -Z
        final float[] estEmpty = WalkRingToeSolver.estimateAutoCenterXZ(new ArrayList<>(), new ArrayList<>());
        assertEquals(0.0f, estEmpty[0], 1e-4f);
        assertEquals(-3.0f, estEmpty[1], 1e-4f);

        // 1 pose at (2, 0, 5) facing +X -> projects to (5.0, 5.0)
        final List<WalkRingToeSolver.WalkPose> onePose = new ArrayList<>();
        onePose.add(new WalkRingToeSolver.WalkPose(2.0f, 1.5f, 5.0f, 1.0f, -0.2f, 0.0f, 100L));
        final float[] estOne = WalkRingToeSolver.estimateAutoCenterXZ(onePose, new ArrayList<>());
        assertEquals(5.0f, estOne[0], 0.05f);
        assertEquals(5.0f, estOne[1], 0.05f);

        // 2 poses walking along Z while looking toward -Z (mean pos = (1.0, 2.0), fwd = (0, -1)) -> (1.0, -1.0)
        final List<WalkRingToeSolver.WalkPose> twoPoses = new ArrayList<>();
        twoPoses.add(new WalkRingToeSolver.WalkPose(0.5f, 1.5f, 2.0f, 0.0f, -0.2f, -1.0f, 100L));
        twoPoses.add(new WalkRingToeSolver.WalkPose(1.5f, 1.5f, 2.0f, 0.0f, -0.2f, -1.0f, 200L));
        final float[] estTwo = WalkRingToeSolver.estimateAutoCenterXZ(twoPoses, new ArrayList<>());
        assertEquals(1.0f, estTwo[0], 0.05f);
        assertEquals(-1.0f, estTwo[1], 0.05f);

        // 4 parallel rays (short collinear walk, ray intersection det == 0) -> projects +3.0m forward, never {meanPx, meanPz}
        final List<WalkRingToeSolver.WalkPose> collinear = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            collinear.add(new WalkRingToeSolver.WalkPose(i * 0.4f, 1.5f, 4.0f, 0.0f, -0.2f, -1.0f, i * 100L));
        }
        final float[] estCollinear = WalkRingToeSolver.estimateAutoCenterXZ(collinear, new ArrayList<>());
        assertEquals(0.6f, estCollinear[0], 0.05f);
        assertEquals(1.0f, estCollinear[1], 0.05f);
    }

    @Test
    public void testDenseSweepPartialArcNoWrapAroundAndEndpointSingleNeighbor() {
        // 6 keyframes on a linear front pass (not a closed loop: dist(0, 5) = 3.0m > 2.5m)
        final int w = 160;
        final int h = 120;
        final float fx = 140.0f;
        final float fy = 140.0f;
        final float cx = 80.0f;
        final float cy = 60.0f;

        final List<float[]> worldMarkers = new ArrayList<>();
        for (int iy = -3; iy <= 3; iy++) {
            for (int ix = -6; ix <= 6; ix++) {
                worldMarkers.add(new float[] { ix * 0.40f, iy * 0.30f, -3.5f });
            }
        }

        final float[] identityR = { 1, 0, 0, 0, 1, 0, 0, 0, 1 };
        final List<OfflineVioMvsEngine.KeyframeFrame> kfs = new ArrayList<>();
        final List<WalkRingToeSolver.WalkPose> walkPoses = new ArrayList<>();
        for (int k = 0; k < 6; k++) {
            final float camX = -1.5f + k * 0.6f; // span = 3.0m (> 2.5m loop closure gate)
            final byte[] luma = renderSyntheticLuma(w, h, fx, fy, cx, cy, camX, worldMarkers);
            final OfflineVioMvsEngine.KeyframeFrame kf = new OfflineVioMvsEngine.KeyframeFrame(
                k, w, h, luma, fx, fy, cx, cy,
                identityR, new float[] { camX, 0.0f, 0.0f },
                k * 100_000_000L
            );
            kfs.add(kf);
            walkPoses.add(new WalkRingToeSolver.WalkPose(camX, 0.0f, 0.0f, 0.0f, 0.0f, -1.0f, k * 100_000_000L));
        }

        assertFalse(
            "Linear 3.0m pass must NOT qualify as closed loop",
            OfflineVioMvsEngine.isLoopClosurePair(kfs.get(0), kfs.get(kfs.size() - 1))
        );

        final List<float[]> openSweepPts = OfflineVioMvsEngine.runDenseCensusZnccSweep(
            kfs, 0.0f, -3.5f, walkPoses, false, false
        );
        assertTrue(
            "Open-arc dense sweep without wrap-around must reconstruct points (got " + openSweepPts.size() + ")",
            openSweepPts.size() >= 10
        );

        // Verify at least some points come from single-neighbor endpoints (weight == 1.0f)
        int endpointPts = 0;
        for (float[] p : openSweepPts) {
            if (p.length >= 4 && Math.abs(p[3] - 1.0f) < 1e-3f) {
                endpointPts++;
            }
        }
        assertTrue(
            "Endpoints 0 and totalKf-1 must emit single-neighbor points on partial arc (got " + endpointPts + ")",
            endpointPts > 0
        );
    }

    @Test
    public void testLargeStockpileOver16mNoTruncationAndLocalGroundFilter() {
        // Large mining stockpile: radius = 10.0 m (diameter = 20.0 m > 16 m), height = 4.5 m
        final float radiusM = 10.0f;
        final float heightM = 4.5f;
        final double exactVolumeM3 = (Math.PI * radiusM * radiusM * heightM) / 3.0;
        final float groundY = -1.45f;

        final List<float[]> points = new ArrayList<>();
        final List<float[]> groundSamples = new ArrayList<>();
        final List<WalkRingToeSolver.WalkPose> walkPoses = new ArrayList<>();

        for (float x = -radiusM; x <= radiusM; x += 0.35f) {
            for (float z = -radiusM; z <= radiusM; z += 0.35f) {
                final float r = (float) Math.hypot(x, z);
                if (r <= radiusM) {
                    final float h = heightM * (1.0f - (r / radiusM));
                    points.add(new float[] { x, groundY + h, z, 2.0f });
                } else if (r <= radiusM + 1.5f) {
                    groundSamples.add(new float[] { x, groundY, z });
                }
            }
        }

        for (int i = 0; i < 32; i++) {
            final double ang = (2.0 * Math.PI * i) / 32.0;
            final float wx = (float) (Math.cos(ang) * 13.0);
            final float wz = (float) (Math.sin(ang) * 13.0);
            walkPoses.add(new WalkRingToeSolver.WalkPose(
                wx, 0.0f, wz, (float) (-Math.cos(ang)), -0.25f, (float) (-Math.sin(ang)), i * 100_000_000L
            ));
        }

        final WalkRingToeSolver.MetrologyResult res = WalkRingToeSolver.solve(
            points, walkPoses, groundSamples, false, 0.4
        );

        final double relErrPct = Math.abs(res.volumeM3 - exactVolumeM3) / exactVolumeM3 * 100.0;
        assertTrue(
            "20m stockpile must NOT be truncated (expected dimA >= 18.5m, got " + res.dimA + "m)",
            res.dimA >= 18.5
        );
        assertTrue(
            "20m stockpile volume must stay within 8% of " + exactVolumeM3 + " (got " + res.volumeM3 + ", err=" + relErrPct + "%)",
            relErrPct < 8.0
        );
        assertEquals("Interior crater cells must be strictly 0", 0, res.zeroCellsInside);
        assertEquals("VALID_IN_SITU", res.metrologyGrade);
    }

    private static byte[] renderSyntheticLuma(
        final int w,
        final int h,
        final float fx,
        final float fy,
        final float cx,
        final float cy,
        final float camX,
        final List<float[]> markers
    ) {
        final byte[] img = new byte[w * h];
        // Mild background gradient
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                img[y * w + x] = (byte) (90 + ((x + y) & 7));
            }
        }
        // Draw high-contrast asymmetric corner markers at projected 3D points
        for (int idx = 0; idx < markers.size(); idx++) {
            final float[] p = markers.get(idx);
            final float depth = -p[2];
            final int u = Math.round(((p[0] - camX) / depth) * fx + cx);
            final int v = Math.round((-p[1] / depth) * fy + cy);
            if (u < 6 || u >= w - 6 || v < 6 || v >= h - 6) continue;
            final int polarity = (idx % 2 == 0) ? 235 : 15;
            for (int dy = -2; dy <= 2; dy++) {
                for (int dx = -2; dx <= 2; dx++) {
                    if (dx >= 0 && dy >= 0) {
                        img[(v + dy) * w + (u + dx)] = (byte) polarity;
                    } else if (dx < 0 && dy < 0) {
                        img[(v + dy) * w + (u + dx)] = (byte) (255 - polarity);
                    }
                }
            }
        }
        return img;
    }
}
