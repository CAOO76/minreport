package com.minreport.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/**
 * Deterministic JVM unit tests for Sprint 1 (2.1.0-fieldtest):
 * (a) AC-5102 real production regression: 54 cm x 33 cm cylinder on 2.5 m x 2.5 m patio with +/-4 cm noise
 * (b) Two touching stockpiles separated by Anchor + 3D Marker-Controlled Watershed AND by polygonXZ
 * (c) Confined stockpile anchored with explicit padReferenceY
 * (d) OfflineVioMvsEngine ROI projection, TargetVolumeConstraint helper, Live3DOverlayRenderer geometry (<= 384 verts)
 *     & dual-color point partitioning, GroundCellAggregator trimmed median, and slopeProfile classification.
 */
public class TargetSegmentationSprint1Test {

    @Test
    public void testAc5102Cylinder54cmBy33cmOnNoisyPatioVolumeHeightAndVerticalSlope() {
        // Real production object AC-5102: cylinder H = 0.54 m, diameter = 0.33 m (radius = 0.165 m)
        // Exact analytical volume = pi * (0.165^2) * 0.54 = 0.046186 m^3
        final float cylRadiusM = 0.165f;
        final float cylHeightM = 0.54f;
        final float trueGroundY = -1.20f;

        final List<float[]> points = new ArrayList<>();
        final List<float[]> groundSamples = new ArrayList<>();
        final List<WalkRingToeSolver.WalkPose> walkPoses = new ArrayList<>();

        // 2.5 m x 2.5 m patio with deterministic +/-4 cm floor noise
        long rng = 0x5102ABCD1234L;
        for (float x = -1.25f; x <= 1.25f; x += 0.045f) {
            for (float z = -1.25f; z <= 1.25f; z += 0.045f) {
                rng = rng * 6364136223846793005L + 1442695040888963407L;
                final float u = ((rng >>> 40) & 0xFFFFFFL) / (float) 0xFFFFFFL; // [0, 1]
                final float noiseM = (u * 2.0f - 1.0f) * 0.04f; // [-0.04, +0.04] m
                final float r = (float) Math.hypot(x, z);
                if (r > cylRadiusM + 0.01f) {
                    points.add(new float[] { x, trueGroundY + noiseM, z, 2.0f });
                    if (Math.abs(x) <= 1.15f && Math.abs(z) <= 1.15f) {
                        groundSamples.add(new float[] { x, trueGroundY + noiseM, z });
                    }
                }
            }
        }

        // Dense cylinder top cap (r <= 0.165 m, y = trueGroundY + 0.54 m)
        for (float x = -cylRadiusM; x <= cylRadiusM; x += 0.02f) {
            for (float z = -cylRadiusM; z <= cylRadiusM; z += 0.02f) {
                if (Math.hypot(x, z) <= cylRadiusM) {
                    points.add(new float[] { x, trueGroundY + cylHeightM, z, 2.0f });
                }
            }
        }
        // Cylinder vertical side wall rings (r = 0.165 m, h in [0.06, 0.52])
        for (int a = 0; a < 48; a++) {
            final double ang = (2.0 * Math.PI * a) / 48.0;
            final float wx = (float) (Math.cos(ang) * cylRadiusM);
            final float wz = (float) (Math.sin(ang) * cylRadiusM);
            for (float h = 0.08f; h <= 0.52f; h += 0.06f) {
                points.add(new float[] { wx, trueGroundY + h, wz, 2.0f });
            }
        }

        // 24-pose walk ring at r = 1.6 m around cylinder, camera at y = 0.0 (1.20 m above floor)
        for (int i = 0; i < 24; i++) {
            final double ang = (2.0 * Math.PI * i) / 24.0;
            final float wx = (float) (Math.cos(ang) * 1.6);
            final float wz = (float) (Math.sin(ang) * 1.6);
            walkPoses.add(new WalkRingToeSolver.WalkPose(
                wx, 0.0f, wz, (float) (-Math.cos(ang)), -0.45f, (float) (-Math.sin(ang)), i * 100_000_000L
            ));
        }

        // 1. With TargetVolumeConstraint anchored on cylinder (radius 0.80 m)
        final TargetVolumeConstraint target = TargetVolumeConstraint.fromAnchor(0.0f, trueGroundY + 0.25f, 0.0f, 0.80f);
        final WalkRingToeSolver.MetrologyResult res = WalkRingToeSolver.solve(
            points, walkPoses, groundSamples, false, 0.3, target
        );

        assertTrue(
            "AC-5102 volume must be in [0.039, 0.054] m^3 (real 0.0462), got " + res.volumeM3,
            res.volumeM3 >= 0.039 && res.volumeM3 <= 0.054
        );
        assertEquals("AC-5102 height must be ~0.54 m", 0.54, res.dimH, 0.04);
        assertTrue(
            "AC-5102 cylinder slope must exceed 78 deg, got " + res.slopeAngleAvgDeg,
            res.slopeAngleAvgDeg > 78.0
        );
        assertEquals(WalkRingToeSolver.SLOPE_PROFILE_VERTICAL_STRUCTURE, res.slopeProfile);
        assertEquals(0, res.zeroCellsInside);
        assertTrue("Ground noise sigmaGround must be empirical in [0.012, 0.06]", res.sigmaGroundM >= 0.012 && res.sigmaGroundM <= 0.06);

        // 2. Fallback mode (user presses PLAY without tapping target first) must ALSO isolate cylinder cleanly
        final WalkRingToeSolver.MetrologyResult resNoTarget = WalkRingToeSolver.solve(
            points, walkPoses, groundSamples, false, 0.3
        );
        assertTrue(
            "Fallback AC-5102 volume without target must stay in [0.039, 0.054] m^3, got " + resNoTarget.volumeM3,
            resNoTarget.volumeM3 >= 0.039 && resNoTarget.volumeM3 <= 0.054
        );
        assertTrue(
            "Fallback AC-5102 slope must exceed 78 deg, got " + resNoTarget.slopeAngleAvgDeg,
            resNoTarget.slopeAngleAvgDeg > 78.0
        );
        assertEquals(WalkRingToeSolver.SLOPE_PROFILE_VERTICAL_STRUCTURE, resNoTarget.slopeProfile);
    }

    @Test
    public void testTwoTouchingStockpilesSeparatedByWatershedAndByPolygonXZ() {
        // Two touching cones on flat pad y = -1.40 m:
        // Pile A centered at (-1.35, 0), radius = 1.60 m, height = 1.35 m -> exact vol = (1/3)*pi*1.6^2*1.35 = 3.619 m^3
        // Pile B centered at (+1.35, 0), radius = 1.60 m, height = 1.30 m (overlaps A with valley saddle at x = 0!)
        final float groundY = -1.40f;
        final float rA = 1.60f;
        final float hA = 1.35f;
        final float rB = 1.60f;
        final float hB = 1.30f;
        final double exactVolA = (Math.PI * rA * rA * hA) / 3.0; // ~3.619 m^3

        final List<float[]> points = new ArrayList<>();
        final List<float[]> groundSamples = new ArrayList<>();
        final List<WalkRingToeSolver.WalkPose> walkPoses = new ArrayList<>();

        for (float x = -3.4f; x <= 3.4f; x += 0.09f) {
            for (float z = -2.2f; z <= 2.2f; z += 0.09f) {
                final float dA = (float) Math.hypot(x + 1.35f, z);
                final float dB = (float) Math.hypot(x - 1.35f, z);
                final float heightA = dA < rA ? hA * (1.0f - dA / rA) : 0.0f;
                final float heightB = dB < rB ? hB * (1.0f - dB / rB) : 0.0f;
                final float h = Math.max(heightA, heightB);
                if (h > 0.01f) {
                    points.add(new float[] { x, groundY + h, z, 2.0f });
                } else {
                    groundSamples.add(new float[] { x, groundY, z });
                }
            }
        }

        for (int i = 0; i < 24; i++) {
            final double ang = (2.0 * Math.PI * i) / 24.0;
            final float wx = -1.35f + (float) (Math.cos(ang) * 4.5);
            final float wz = (float) (Math.sin(ang) * 4.5);
            walkPoses.add(new WalkRingToeSolver.WalkPose(
                wx, 0.0f, wz, (float) (-Math.cos(ang)), -0.3f, (float) (-Math.sin(ang)), i * 100_000_000L
            ));
        }

        // Case 1: Anchor on Pile A with wide radius (3.5 m, encloses BOTH Pile A and Pile B) -> Watershed cuts at x ~ 0
        final TargetVolumeConstraint anchorA = TargetVolumeConstraint.fromAnchor(-1.35f, groundY + 0.8f, 0.0f, 3.5f);
        final WalkRingToeSolver.MetrologyResult resWatershed = WalkRingToeSolver.solve(
            points, walkPoses, groundSamples, false, 0.4, anchorA
        );
        assertTrue(
            "Watershed must exclude touching Pile B (expected ~" + exactVolA + " m^3, got " + resWatershed.volumeM3 + ")",
            resWatershed.volumeM3 >= exactVolA * 0.78 && resWatershed.volumeM3 <= exactVolA * 1.18
        );
        // Verify none of the stratified points belong deep inside Pile B (x > +0.35 m)
        int leakedToB = 0;
        for (float[] sp : resWatershed.stratifiedPointsM) {
            if (sp[0] > 0.35f) leakedToB++;
        }
        assertEquals("Watershed stratified cloud must not leak into Pile B", 0, leakedToB);

        // Case 2: Explicit valley polygonXZ enclosing only Pile A (x in [-3.1, 0.0], z in [-1.8, 1.8])
        final float[] valleyPolyA = new float[] {
            -3.10f, -1.80f,
            0.00f, -1.80f,
            0.00f, 1.80f,
            -3.10f, 1.80f
        };
        final TargetVolumeConstraint polyTarget = TargetVolumeConstraint.fromAnchorWithPolygon(
            -1.35f, groundY + 0.8f, 0.0f, 3.5f, valleyPolyA, false, 0.0f
        );
        final WalkRingToeSolver.MetrologyResult resPoly = WalkRingToeSolver.solve(
            points, walkPoses, groundSamples, false, 0.4, polyTarget
        );
        assertTrue(
            "polygonXZ must exclude Pile B (expected ~" + exactVolA + " m^3, got " + resPoly.volumeM3 + ")",
            resPoly.volumeM3 >= exactVolA * 0.78 && resPoly.volumeM3 <= exactVolA * 1.15
        );
        int polyLeakB = 0;
        for (float[] sp : resPoly.stratifiedPointsM) {
            if (sp[0] > 0.12f) polyLeakB++;
        }
        assertEquals("polygonXZ cut must strictly exclude Pile B cells", 0, polyLeakB);
    }

    @Test
    public void testConfinedStockpileUsesExplicitPadReferenceY() {
        // Confined stockpile where no wide open ground ring is visible (only elevated rubble/toe samples at -1.10 m)
        // True patio floor tapped by operator via vertical_align_bottom: padReferenceY = -1.50 m
        // Cone: radius = 2.0 m, height = 1.60 m above -1.50 m -> exact vol = (1/3)*pi*4*1.6 = 6.702 m^3
        final float truePadY = -1.50f;
        final float radiusM = 2.0f;
        final float heightM = 1.60f;
        final double exactVol = (Math.PI * radiusM * radiusM * heightM) / 3.0;

        final List<float[]> points = new ArrayList<>();
        final List<float[]> sparseGround = new ArrayList<>();
        final List<WalkRingToeSolver.WalkPose> walkPoses = new ArrayList<>();

        for (float x = -radiusM; x <= radiusM; x += 0.10f) {
            for (float z = -radiusM; z <= radiusM; z += 0.10f) {
                final float r = (float) Math.hypot(x, z);
                if (r <= radiusM) {
                    final float h = heightM * (1.0f - r / radiusM);
                    if (h >= 0.25f) { // lower toe occluded by confinement barrier
                        points.add(new float[] { x, truePadY + h, z, 2.0f });
                    }
                }
            }
        }
        // Only 2 contaminated ground points elevated by +0.35 m above real patio
        sparseGround.add(new float[] { 2.2f, truePadY + 0.35f, 0.0f });
        sparseGround.add(new float[] { -2.2f, truePadY + 0.35f, 0.0f });

        for (int i = 0; i < 16; i++) {
            final double ang = Math.toRadians(-90.0 + i * 12.0);
            final float wx = (float) (Math.cos(ang) * 3.5);
            final float wz = (float) (Math.sin(ang) * 3.5);
            walkPoses.add(new WalkRingToeSolver.WalkPose(
                wx, 0.0f, wz, (float) (-Math.cos(ang)), -0.35f, (float) (-Math.sin(ang)), i * 100_000_000L
            ));
        }

        final TargetVolumeConstraint confinedTarget = TargetVolumeConstraint.fromAnchorWithPad(
            0.0f, truePadY + 0.6f, 0.0f, 2.3f, truePadY
        );
        final WalkRingToeSolver.MetrologyResult res = WalkRingToeSolver.solve(
            points, walkPoses, sparseGround, false, 0.5, confinedTarget
        );

        assertEquals("Ground plane D must lock to explicit padReferenceY", truePadY, res.planeD, 0.03);
        assertEquals("Height must be measured from padReferenceY (~1.60 m)", heightM, res.dimH, 0.10);
        assertTrue(
            "Volume must match confined pile anchored to padReferenceY (got " + res.volumeM3 + ")",
            res.volumeM3 >= exactVol * 0.72 && res.volumeM3 <= exactVol * 1.15
        );
        assertTrue("Explicit padReferenceY must yield high toeScore", res.toeScore >= 75.0);
    }

    @Test
    public void testSlopeProfileBandsNaturalReposeAndSteepAlert() {
        // Cone A: 32 deg (NATURAL_REPOSE): r = 3.0 m, h = 3.0 * tan(32 deg) = 1.8746 m
        final WalkRingToeSolver.MetrologyResult resNatural = solveSyntheticCone(3.0f, (float) (3.0 * Math.tan(Math.toRadians(32.0))));
        assertTrue("32 deg cone slope should be ~32 deg, got " + resNatural.slopeAngleAvgDeg,
            resNatural.slopeAngleAvgDeg >= 27.0 && resNatural.slopeAngleAvgDeg <= 37.0);
        assertEquals(WalkRingToeSolver.SLOPE_PROFILE_NATURAL_REPOSE, resNatural.slopeProfile);

        // Cone B: 45 deg (STEEP_ALERT > 38 deg): r = 2.5 m, h = 2.5 m
        final WalkRingToeSolver.MetrologyResult resSteep = solveSyntheticCone(2.5f, 2.5f);
        assertTrue("45 deg cone slope should be ~45 deg (> 38 deg), got " + resSteep.slopeAngleAvgDeg,
            resSteep.slopeAngleAvgDeg > 38.0 && resSteep.slopeAngleAvgDeg <= 52.0);
        assertEquals(WalkRingToeSolver.SLOPE_PROFILE_STEEP_ALERT, resSteep.slopeProfile);
    }

    @Test
    public void testOfflineVioMvsEngineTargetRoiProjectionAndTargetConstraintHelpers() {
        // 1. TargetVolumeConstraint clamping & polygon checks
        final TargetVolumeConstraint clampedLo = TargetVolumeConstraint.fromAnchor(1.0f, 0.0f, -3.0f, 0.05f);
        assertEquals(TargetVolumeConstraint.MIN_RADIUS_M, clampedLo.radiusM, 1e-6f);
        final TargetVolumeConstraint clampedHi = TargetVolumeConstraint.fromAnchor(1.0f, 0.0f, -3.0f, 40.0f);
        assertEquals(TargetVolumeConstraint.MAX_RADIUS_M, clampedHi.radiusM, 1e-6f);
        final TargetVolumeConstraint nanRadius = TargetVolumeConstraint.fromAnchor(1.0f, 0.0f, -3.0f, Float.NaN);
        assertEquals(TargetVolumeConstraint.DEFAULT_RADIUS_M, nanRadius.radiusM, 1e-6f);

        assertTrue(clampedLo.containsXZ(1.10f, -3.05f));
        assertFalse(clampedLo.containsXZ(1.50f, -3.0f));

        final float[] squarePoly = { -1.0f, -1.0f, 1.0f, -1.0f, 1.0f, 1.0f, -1.0f, 1.0f };
        final TargetVolumeConstraint polyC = TargetVolumeConstraint.fromAnchorWithPolygon(
            0.0f, 0.0f, 0.0f, 1.2f, squarePoly, true, -0.5f
        );
        assertTrue(polyC.hasValidPolygon());
        assertEquals(4, polyC.getPolygonVertexCount());
        assertTrue(polyC.containsXZ(0.0f, 0.0f));
        assertFalse(polyC.containsXZ(1.5f, 0.0f));

        // 2. OfflineVioMvsEngine.computeTargetProjectedRoi projection test
        final int w = 320;
        final int h = 240;
        final float[] identityR = { 1, 0, 0, 0, 1, 0, 0, 0, 1 };
        final OfflineVioMvsEngine.KeyframeFrame kf = new OfflineVioMvsEngine.KeyframeFrame(
            0, w, h, new byte[w * h], 260.0f, 260.0f, 160.0f, 120.0f,
            identityR, new float[] { 0.0f, 0.5f, 0.0f }, 1000L
        );

        // Inactive target -> standard Walk-Ring ROI [10%, 90%] x [18%, 92%]
        final int[] fullRoi = OfflineVioMvsEngine.computeTargetProjectedRoi(kf, TargetVolumeConstraint.inactive(), 6);
        assertNotNull(fullRoi);
        assertEquals(32, fullRoi[0]);  // 10% of 320
        assertEquals(288, fullRoi[1]); // 90% of 320
        assertEquals(43, fullRoi[2]);  // 18% of 240
        assertEquals(220, fullRoi[3]); // 92% of 240

        // Small target centered in front of camera at (0, 0, -4.0), radius 0.40 m -> strictly tighter ROI
        final TargetVolumeConstraint frontSmall = TargetVolumeConstraint.fromAnchor(0.0f, 0.0f, -4.0f, 0.40f);
        final int[] croppedRoi = OfflineVioMvsEngine.computeTargetProjectedRoi(kf, frontSmall, 6);
        assertNotNull(croppedRoi);
        assertTrue("uStart must crop inward from 32, got " + croppedRoi[0], croppedRoi[0] > fullRoi[0] + 40);
        assertTrue("uEnd must crop inward from 288, got " + croppedRoi[1], croppedRoi[1] < fullRoi[1] - 40);
        assertTrue("vStart >= baseVStart", croppedRoi[2] >= fullRoi[2]);
        assertTrue("vEnd <= baseVEnd", croppedRoi[3] <= fullRoi[3]);

        // Target behind camera at z = +4.0 -> returns null (skipped cleanly)
        final TargetVolumeConstraint behindCam = TargetVolumeConstraint.fromAnchor(0.0f, 0.0f, +4.0f, 0.50f);
        assertNull(OfflineVioMvsEngine.computeTargetProjectedRoi(kf, behindCam, 6));

        // 3. Live3DOverlayRenderer geometry vertex budget (<= 384) & dual-color point cloud partitioning
        final Live3DOverlayRenderer.TargetVolumeGeometry cylGeom =
            Live3DOverlayRenderer.buildTargetVolumeGeometry(frontSmall);
        assertNotNull(cylGeom);
        assertTrue(
            "Cylinder target overlay vertices must be <= 384, got " + cylGeom.totalVertexCount,
            cylGeom.totalVertexCount > 0 && cylGeom.totalVertexCount <= Live3DOverlayRenderer.MAX_TARGET_VOLUME_VERTICES
        );

        final Live3DOverlayRenderer.TargetVolumeGeometry polyGeom =
            Live3DOverlayRenderer.buildTargetVolumeGeometry(polyC);
        assertNotNull(polyGeom);
        assertTrue(
            "Polygon target overlay vertices must be <= 384, got " + polyGeom.totalVertexCount,
            polyGeom.totalVertexCount > 0 && polyGeom.totalVertexCount <= Live3DOverlayRenderer.MAX_TARGET_VOLUME_VERTICES
        );

        final float[] mixedCloud = new float[] {
            0.0f, 0.20f, -4.0f,  // inside frontSmall -> target (Cyan 90% 10px)
            0.15f, 0.35f, -4.1f, // inside frontSmall -> target
            2.5f, 0.0f, -4.0f,   // outside -> env (Gray 18% 5px)
            -2.0f, 0.0f, -2.0f   // outside -> env
        };
        final Live3DOverlayRenderer.PartitionedPoints parted =
            Live3DOverlayRenderer.partitionPointsByTarget(mixedCloud, frontSmall);
        assertNotNull(parted.targetPointsXyz);
        assertNotNull(parted.envPointsXyz);
        assertEquals(2 * 3, parted.targetPointsXyz.length);
        assertEquals(2 * 3, parted.envPointsXyz.length);

        final Live3DOverlayRenderer overlay = new Live3DOverlayRenderer();
        overlay.updateTargetVolumeConstraint(frontSmall);
        overlay.updateLivePointCloud(mixedCloud);
        assertEquals(4, overlay.getLivePointCount());
        assertEquals(2, overlay.getTargetLivePointCount());
        assertEquals(2, overlay.getEnvLivePointCount());

        // 4. GroundCellAggregator trimmed median rejects -3*sigma downward spike instead of keeping min(y)
        final CapturePipelineHelper.GroundCellAggregator agg = new CapturePipelineHelper.GroundCellAggregator(64);
        agg.addSample(new float[] { 0.10f, -1.00f, 0.10f }, 0.0f);
        agg.addSample(new float[] { 0.11f, -0.99f, 0.11f }, 0.0f);
        agg.addSample(new float[] { 0.12f, -1.01f, 0.12f }, 0.0f);
        agg.addSample(new float[] { 0.10f, -1.00f, 0.11f }, 0.0f);
        agg.addSample(new float[] { 0.11f, -1.00f, 0.10f }, 0.0f);
        agg.addSample(new float[] { 0.10f, -1.25f, 0.10f }, 0.0f); // downward outlier spike (-25 cm)
        agg.addSample(new float[] { 0.10f, -0.80f, 0.10f }, 0.0f); // upward outlier spike (+20 cm)
        final List<float[]> medPts = agg.snapshotTrimmedMedians();
        assertEquals(1, medPts.size());
        assertEquals("Trimmed median must stay at -1.00 m instead of min(y)=-1.25 m", -1.00f, medPts.get(0)[1], 0.015f);
    }

    private static WalkRingToeSolver.MetrologyResult solveSyntheticCone(final float radiusM, final float heightM) {
        final float groundY = -1.40f;
        final List<float[]> points = new ArrayList<>();
        final List<float[]> groundSamples = new ArrayList<>();
        final List<WalkRingToeSolver.WalkPose> walkPoses = new ArrayList<>();
        for (float x = -radiusM - 0.8f; x <= radiusM + 0.8f; x += 0.11f) {
            for (float z = -radiusM - 0.8f; z <= radiusM + 0.8f; z += 0.11f) {
                final float r = (float) Math.hypot(x, z);
                if (r <= radiusM) {
                    points.add(new float[] { x, groundY + heightM * (1.0f - r / radiusM), z, 2.0f });
                } else {
                    groundSamples.add(new float[] { x, groundY, z });
                }
            }
        }
        for (int i = 0; i < 24; i++) {
            final double ang = (2.0 * Math.PI * i) / 24.0;
            final float wx = (float) (Math.cos(ang) * (radiusM + 2.0));
            final float wz = (float) (Math.sin(ang) * (radiusM + 2.0));
            walkPoses.add(new WalkRingToeSolver.WalkPose(
                wx, 0.0f, wz, (float) (-Math.cos(ang)), -0.3f, (float) (-Math.sin(ang)), i * 100_000_000L
            ));
        }
        return WalkRingToeSolver.solve(points, walkPoses, groundSamples, false, 0.4);
    }
}
