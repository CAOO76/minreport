package com.minreport.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

/**
 * Pure-JVM deterministic unit tests for 2.2.0-fieldtest Tri-Modal Computer Vision & Metrology:
 * (a) Smooth textureless white cylinder 54 cm x 33 cm (0.0462 m^3) with 0 MVS wall points + 16 SegmentedViews
 * (b) Conical stockpile with a concave bite observed by Depth/MVS carved via min(H_hull, H_obs)
 * (c) DepthMaskFuser.fuse with floor + 33x54 cm cylinder + adjacent furniture (floor cut, BFS exclusion, auto radius, mesh)
 *     plus no-depth fallback and extractFilteredDepthPoints
 * (d) TargetVolumeConstraint.contains3DForVisual floor rejection & withAutoBounds preservation.
 */
public class ObjectMaskAndHullTest {

    /**
     * Builds an OpenGL/ARCore camera-to-world 4x4 column-major matrix where camera sits at
     * (camX, camY, camZ) looking at (lookX, lookY, lookZ) with +Y world up, +X right, -Z forward.
     */
    private static float[] lookAtCameraToWorldColMajor(
        final float camX,
        final float camY,
        final float camZ,
        final float lookX,
        final float lookY,
        final float lookZ
    ) {
        // Forward optical axis (-Z in camera space) points from camera toward look target
        float fx = lookX - camX;
        float fy = lookY - camY;
        float fz = lookZ - camZ;
        final float fLen = (float) Math.sqrt(fx * fx + fy * fy + fz * fz);
        fx /= fLen;
        fy /= fLen;
        fz /= fLen;

        // Camera +Z axis points backward (opposite to forward)
        final float zx = -fx;
        final float zy = -fy;
        final float zz = -fz;

        // Camera +X (right) = normalize(forward x worldUp(0,1,0))
        float rx = -fz;
        float ry = 0.0f;
        float rz = fx;
        final float rLen = (float) Math.sqrt(rx * rx + ry * ry + rz * rz);
        rx /= rLen;
        ry /= rLen;
        rz /= rLen;

        // Camera +Y (up) = +Z x +X = right x forward
        final float ux = zy * rz - zz * ry;
        final float uy = zz * rx - zx * rz;
        final float uz = zx * ry - zy * rx;

        // Column-major 4x4: col0 = +X (right), col1 = +Y (up), col2 = +Z (back), col3 = camPos
        return new float[] {
            rx, ry, rz, 0.0f,
            ux, uy, uz, 0.0f,
            zx, zy, zz, 0.0f,
            camX, camY, camZ, 1.0f
        };
    }

    /**
     * Exact rigid SE(3) inverse of a column-major 4x4 camera-to-world matrix -> world-to-camera.
     */
    private static float[] invertRigidColMajor(final float[] c2w) {
        final float r00 = c2w[0], r10 = c2w[1], r20 = c2w[2];
        final float r01 = c2w[4], r11 = c2w[5], r21 = c2w[6];
        final float r02 = c2w[8], r12 = c2w[9], r22 = c2w[10];
        final float tx = c2w[12], ty = c2w[13], tz = c2w[14];

        // R^T in column-major
        final float itx = -(r00 * tx + r10 * ty + r20 * tz);
        final float ity = -(r01 * tx + r11 * ty + r21 * tz);
        final float itz = -(r02 * tx + r12 * ty + r22 * tz);

        return new float[] {
            r00, r01, r02, 0.0f,
            r10, r11, r12, 0.0f,
            r20, r21, r22, 0.0f,
            itx, ity, itz, 1.0f
        };
    }

    /**
     * Ray-cylinder intersection (vertical cylinder centered at (0,0), radius R, y in [groundY, groundY+H]).
     * Returns positive ray parameter t (meters) along normalized ray (ox,oy,oz) + t*(dx,dy,dz), or Float.MAX_VALUE.
     */
    private static float intersectVerticalCylinder(
        final float ox,
        final float oy,
        final float oz,
        final float dx,
        final float dy,
        final float dz,
        final float radiusM,
        final float groundY,
        final float heightM
    ) {
        float bestT = Float.MAX_VALUE;
        final float topY = groundY + heightM;

        // Lateral wall: (ox + t*dx)^2 + (oz + t*dz)^2 = R^2
        final float a = dx * dx + dz * dz;
        if (a > 1e-8f) {
            final float b = 2.0f * (ox * dx + oz * dz);
            final float c = ox * ox + oz * oz - radiusM * radiusM;
            final float disc = b * b - 4.0f * a * c;
            if (disc >= 0.0f) {
                final float sqrtDisc = (float) Math.sqrt(disc);
                final float t0 = (-b - sqrtDisc) / (2.0f * a);
                final float t1 = (-b + sqrtDisc) / (2.0f * a);
                if (t0 > 0.05f) {
                    final float y0 = oy + t0 * dy;
                    if (y0 >= groundY && y0 <= topY && t0 < bestT) {
                        bestT = t0;
                    }
                }
                if (t1 > 0.05f) {
                    final float y1 = oy + t1 * dy;
                    if (y1 >= groundY && y1 <= topY && t1 < bestT) {
                        bestT = t1;
                    }
                }
            }
        }

        // Top cap: y = topY
        if (Math.abs(dy) > 1e-6f) {
            final float tTop = (topY - oy) / dy;
            if (tTop > 0.05f && tTop < bestT) {
                final float hx = ox + tTop * dx;
                final float hz = oz + tTop * dz;
                if (hx * hx + hz * hz <= radiusM * radiusM) {
                    bestT = tTop;
                }
            }
            // Bottom cap: y = groundY
            final float tBot = (groundY - oy) / dy;
            if (tBot > 0.05f && tBot < bestT) {
                final float hx = ox + tBot * dx;
                final float hz = oz + tBot * dz;
                if (hx * hx + hz * hz <= radiusM * radiusM) {
                    bestT = tBot;
                }
            }
        }
        return bestT;
    }

    /**
     * Ray-cone intersection (right circular cone centered at (0,0), base radius R at groundY, apex at groundY+H).
     */
    private static float intersectCone(
        final float ox,
        final float oy,
        final float oz,
        final float dx,
        final float dy,
        final float dz,
        final float radiusM,
        final float groundY,
        final float heightM
    ) {
        final float apexY = groundY + heightM;
        final float k = radiusM / heightM;
        final float k2 = k * k;
        final float oyA = oy - apexY;

        final float a = dx * dx + dz * dz - k2 * dy * dy;
        final float b = 2.0f * (ox * dx + oz * dz - k2 * oyA * dy);
        final float c = ox * ox + oz * oz - k2 * oyA * oyA;

        float bestT = Float.MAX_VALUE;
        if (Math.abs(a) > 1e-8f) {
            final float disc = b * b - 4.0f * a * c;
            if (disc >= 0.0f) {
                final float sqrtD = (float) Math.sqrt(disc);
                final float[] ts = { (-b - sqrtD) / (2.0f * a), (-b + sqrtD) / (2.0f * a) };
                for (float t : ts) {
                    if (t > 0.05f && t < bestT) {
                        final float y = oy + t * dy;
                        if (y >= groundY && y <= apexY) {
                            bestT = t;
                        }
                    }
                }
            }
        }
        return bestT;
    }

    /**
     * Ray-AABB intersection returning entry distance t > 0.05f or Float.MAX_VALUE.
     */
    private static float intersectBox(
        final float ox,
        final float oy,
        final float oz,
        final float dx,
        final float dy,
        final float dz,
        final float minX,
        final float maxX,
        final float minY,
        final float maxY,
        final float minZ,
        final float maxZ
    ) {
        float tMin = 0.05f;
        float tMax = Float.MAX_VALUE;

        if (Math.abs(dx) < 1e-7f) {
            if (ox < minX || ox > maxX) return Float.MAX_VALUE;
        } else {
            float t1 = (minX - ox) / dx;
            float t2 = (maxX - ox) / dx;
            if (t1 > t2) { float tmp = t1; t1 = t2; t2 = tmp; }
            tMin = Math.max(tMin, t1);
            tMax = Math.min(tMax, t2);
            if (tMin > tMax) return Float.MAX_VALUE;
        }
        if (Math.abs(dy) < 1e-7f) {
            if (oy < minY || oy > maxY) return Float.MAX_VALUE;
        } else {
            float t1 = (minY - oy) / dy;
            float t2 = (maxY - oy) / dy;
            if (t1 > t2) { float tmp = t1; t1 = t2; t2 = tmp; }
            tMin = Math.max(tMin, t1);
            tMax = Math.min(tMax, t2);
            if (tMin > tMax) return Float.MAX_VALUE;
        }
        if (Math.abs(dz) < 1e-7f) {
            if (oz < minZ || oz > maxZ) return Float.MAX_VALUE;
        } else {
            float t1 = (minZ - oz) / dz;
            float t2 = (maxZ - oz) / dz;
            if (t1 > t2) { float tmp = t1; t1 = t2; t2 = tmp; }
            tMin = Math.max(tMin, t1);
            tMax = Math.min(tMax, t2);
            if (tMin > tMax) return Float.MAX_VALUE;
        }
        return tMin;
    }

    @Test
    public void testSmoothWhiteCylinder54cmBy33cmZeroMvsPointsVisualHullMetrology() {
        // (a) Smooth textureless white cylinder: H = 0.54 m, diameter = 0.33 m (R = 0.165 m)
        // Exact analytical volume = pi * (0.165^2) * 0.54 = 0.046186 m^3
        // ZERO MVS/Depth points on cylinder walls -> reconstructed purely via 16-view Visual Hull + ground samples
        final float cylR = 0.165f;
        final float cylH = 0.54f;
        final float groundY = -1.20f;

        final int w = 320;
        final int h = 240;
        final float fx = 280.0f;
        final float fy = 280.0f;
        final float cx = 160.0f;
        final float cy = 120.0f;

        final List<VisualHullCarver.SegmentedView> views = new ArrayList<>(16);
        final List<WalkRingToeSolver.WalkPose> walkPoses = new ArrayList<>(16);

        for (int i = 0; i < 16; i++) {
            final double ang = (2.0 * Math.PI * i) / 16.0;
            final float camX = (float) (Math.cos(ang) * 1.45);
            final float camY = groundY + 0.85f;
            final float camZ = (float) (Math.sin(ang) * 1.45);

            final float[] c2w = lookAtCameraToWorldColMajor(camX, camY, camZ, 0.0f, groundY + 0.27f, 0.0f);
            final float[] w2c = invertRigidColMajor(c2w);

            // Render exact silhouette mask by casting rays through each pixel
            final byte[] mask = new byte[w * h];
            for (int py = 0; py < h; py++) {
                final int rowOff = py * w;
                final float rcy = -(py - cy) / fy;
                for (int px = 0; px < w; px++) {
                    final float rcx = (px - cx) / fx;
                    final float rcz = -1.0f;
                    // Transform camera ray direction into world space
                    float dx = c2w[0] * rcx + c2w[4] * rcy + c2w[8] * rcz;
                    float dy = c2w[1] * rcx + c2w[5] * rcy + c2w[9] * rcz;
                    float dz = c2w[2] * rcx + c2w[6] * rcy + c2w[10] * rcz;
                    final float len = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
                    dx /= len;
                    dy /= len;
                    dz /= len;

                    final float tCyl = intersectVerticalCylinder(camX, camY, camZ, dx, dy, dz, cylR, groundY, cylH);
                    if (tCyl < Float.MAX_VALUE) {
                        mask[rowOff + px] = (byte) 255;
                    }
                }
            }

            views.add(new VisualHullCarver.SegmentedView(mask, w, h, fx, fy, cx, cy, w2c, groundY));
            // Forward vector is -Z column of c2w
            walkPoses.add(new WalkRingToeSolver.WalkPose(
                camX, camY, camZ, -c2w[8], -c2w[9], -c2w[10], i * 100_000_000L
            ));
        }

        // Ground samples around the patio ring (r in [0.45, 1.25] m)
        final List<float[]> groundSamples = new ArrayList<>();
        for (int s = 0; s < 32; s++) {
            final double ang = (2.0 * Math.PI * s) / 32.0;
            for (float r = 0.50f; r <= 1.20f; r += 0.35f) {
                groundSamples.add(new float[] {
                    (float) (Math.cos(ang) * r),
                    groundY,
                    (float) (Math.sin(ang) * r)
                });
            }
        }

        // Auto-sized target constraint around the cylinder
        final TargetVolumeConstraint target = TargetVolumeConstraint
            .fromAnchor(0.0f, groundY, 0.0f, 0.22f)
            .withAutoBounds(0.0f, groundY, 0.0f, 0.22f, 0.54f);

        final VisualHullCarver.VisualHullResult hull = VisualHullCarver.carve(views, target, groundY, 48);
        assertNotNull(hull);
        assertTrue("VisualHullResult must be valid", hull.isValid());
        assertEquals(16, hull.viewsUsed);
        assertTrue("Visual hull must retain positive voxels", hull.survivingVoxels > 200);

        // Solve with ZERO MVS points on walls!
        final WalkRingToeSolver.MetrologyResult res = WalkRingToeSolver.solve(
            Collections.emptyList(),
            walkPoses,
            groundSamples,
            true,
            0.3,
            target,
            hull
        );

        assertNotNull(res);
        assertTrue(
            "Cylinder volume must be in [0.042, 0.051] m^3 (real 0.0462), got " + res.volumeM3,
            res.volumeM3 >= 0.042 && res.volumeM3 <= 0.051
        );
        assertTrue(
            "Cylinder dimH must be in [0.50, 0.58] m, got " + res.dimH,
            res.dimH >= 0.50 && res.dimH <= 0.58
        );
        assertTrue(
            "Cylinder dimA must be in [0.29, 0.37] m, got " + res.dimA,
            res.dimA >= 0.29 && res.dimA <= 0.37
        );
        assertTrue(
            "Cylinder dimB must be in [0.29, 0.37] m, got " + res.dimB,
            res.dimB >= 0.29 && res.dimB <= 0.37
        );
        assertEquals(WalkRingToeSolver.SLOPE_PROFILE_VERTICAL_STRUCTURE, res.slopeProfile);
        assertEquals("VALID_IN_SITU", res.metrologyGrade);
        assertEquals(0, res.zeroCellsInside);
        assertTrue("occludedVolumePct must stay low when observed by visual hull", res.occludedVolumePct < 10.0);
    }

    @Test
    public void testConicalStockpileWithConcaveBiteCarvedByTriModalMinFusion() {
        // (b) Conical stockpile R = 1.50 m, H = 1.20 m with a concave loader scoop on +X flank.
        // Silhouettes see the outer cone envelope (visual hull fills across concavity), while Depth/MVS
        // observes the true concave scoop -> min(H_hull, H_obs) must strictly reduce volume vs pure hull.
        final float coneR = 1.50f;
        final float coneH = 1.20f;
        final float groundY = -1.40f;

        final int w = 240;
        final int h = 180;
        final float fx = 200.0f;
        final float fy = 200.0f;
        final float cx = 120.0f;
        final float cy = 90.0f;

        final List<VisualHullCarver.SegmentedView> views = new ArrayList<>(16);
        final List<WalkRingToeSolver.WalkPose> walkPoses = new ArrayList<>(16);

        for (int i = 0; i < 16; i++) {
            final double ang = (2.0 * Math.PI * i) / 16.0;
            final float camX = (float) (Math.cos(ang) * 4.2);
            final float camY = groundY + 1.55f;
            final float camZ = (float) (Math.sin(ang) * 4.2);

            final float[] c2w = lookAtCameraToWorldColMajor(camX, camY, camZ, 0.0f, groundY + 0.50f, 0.0f);
            final float[] w2c = invertRigidColMajor(c2w);

            final byte[] mask = new byte[w * h];
            for (int py = 0; py < h; py++) {
                final int rowOff = py * w;
                final float rcy = -(py - cy) / fy;
                for (int px = 0; px < w; px++) {
                    final float rcx = (px - cx) / fx;
                    final float rcz = -1.0f;
                    float dx = c2w[0] * rcx + c2w[4] * rcy + c2w[8] * rcz;
                    float dy = c2w[1] * rcx + c2w[5] * rcy + c2w[9] * rcz;
                    float dz = c2w[2] * rcx + c2w[6] * rcy + c2w[10] * rcz;
                    final float len = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
                    dx /= len;
                    dy /= len;
                    dz /= len;

                    final float tCone = intersectCone(camX, camY, camZ, dx, dy, dz, coneR, groundY, coneH);
                    if (tCone < Float.MAX_VALUE) {
                        mask[rowOff + px] = (byte) 255;
                    }
                }
            }

            views.add(new VisualHullCarver.SegmentedView(mask, w, h, fx, fy, cx, cy, w2c, groundY));
            walkPoses.add(new WalkRingToeSolver.WalkPose(
                camX, camY, camZ, -c2w[8], -c2w[9], -c2w[10], i * 100_000_000L
            ));
        }

        final List<float[]> groundSamples = new ArrayList<>();
        for (int s = 0; s < 32; s++) {
            final double ang = (2.0 * Math.PI * s) / 32.0;
            groundSamples.add(new float[] {
                (float) (Math.cos(ang) * 2.4),
                groundY,
                (float) (Math.sin(ang) * 2.4)
            });
        }

        final TargetVolumeConstraint target = TargetVolumeConstraint
            .fromAnchor(0.0f, groundY, 0.0f, 1.65f)
            .withAutoBounds(0.0f, groundY, 0.0f, 1.65f, coneH);

        final VisualHullCarver.VisualHullResult hull = VisualHullCarver.carve(views, target, groundY, 44);
        assertTrue(hull.isValid());

        // 1. Pure hull solve (0 Depth/MVS points)
        final WalkRingToeSolver.MetrologyResult resHullOnly = WalkRingToeSolver.solve(
            Collections.emptyList(),
            walkPoses,
            groundSamples,
            true,
            0.4,
            target,
            hull
        );

        // 2. Depth/MVS points observing a deep concave scoop in the +X quadrant (x in [0.15, 1.35], |z| <= 0.85)
        final List<float[]> concaveDepthPts = new ArrayList<>();
        for (float x = -coneR; x <= coneR; x += 0.07f) {
            for (float z = -coneR; z <= coneR; z += 0.07f) {
                final float r = (float) Math.hypot(x, z);
                if (r > coneR) continue;
                float surfH = coneH * (1.0f - r / coneR);
                // Carve concave loader bite on +X side
                if (x >= 0.15f && x <= 1.35f && Math.abs(z) <= 0.85f) {
                    surfH *= 0.25f;
                }
                if (surfH > 0.02f) {
                    concaveDepthPts.add(new float[] { x, groundY + surfH, z, 2.0f });
                }
            }
        }

        final WalkRingToeSolver.MetrologyResult resFused = WalkRingToeSolver.solve(
            concaveDepthPts,
            walkPoses,
            groundSamples,
            true,
            0.4,
            target,
            hull
        );

        assertEquals("VALID_IN_SITU", resHullOnly.metrologyGrade);
        assertEquals("VALID_IN_SITU", resFused.metrologyGrade);
        assertTrue(
            "Tri-modal min(H_hull, H_obs) must strictly reduce volume when concave bite is observed " +
            "(hullOnly=" + resHullOnly.volumeM3 + ", fused=" + resFused.volumeM3 + ")",
            resFused.volumeM3 < resHullOnly.volumeM3 * 0.92
        );
    }

    @Test
    public void testDepthMaskFuserClipsFloorExcludesFurnitureAndAutoSizesCylinder() {
        // (c) Synthetic scene: floor at y = -1.20 m + 33x54 cm cylinder at (0, -1.20, 0) +
        //     neighboring furniture box at x in [0.24, 0.95], z in [-0.70, -0.40], y in [-1.20, -0.35].
        //     Mask intentionally leaks onto BOTH floor AND furniture to prove floor cut + BFS depth isolation.
        final float groundY = -1.20f;
        final float cylR = 0.165f;
        final float cylH = 0.54f;

        final int w = 160;
        final int h = 120;
        final float fx = 140.0f;
        final float fy = 140.0f;
        final float cx = 80.0f;
        final float cy = 60.0f;

        final float camX = 0.0f;
        final float camY = groundY + 0.75f;
        final float camZ = 1.40f;
        final float[] c2w = lookAtCameraToWorldColMajor(camX, camY, camZ, 0.0f, groundY + 0.27f, 0.0f);
        final float[] w2c = invertRigidColMajor(c2w);

        final byte[] maskConf = new byte[w * h];
        final short[] depthMm = new short[w * h];
        final byte[] depthConf = new byte[w * h];

        int cylSumU = 0;
        int cylSumV = 0;
        int cylPxCount = 0;

        for (int py = 0; py < h; py++) {
            final int rowOff = py * w;
            final float rcy = -(py - cy) / fy;
            for (int px = 0; px < w; px++) {
                final float rcx = (px - cx) / fx;
                final float rcz = -1.0f;
                // Camera-space unit ray for linear Z-depth conversion
                float dx = c2w[0] * rcx + c2w[4] * rcy + c2w[8] * rcz;
                float dy = c2w[1] * rcx + c2w[5] * rcy + c2w[9] * rcz;
                float dz = c2w[2] * rcx + c2w[6] * rcy + c2w[10] * rcz;
                final float dirLen = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
                dx /= dirLen;
                dy /= dirLen;
                dz /= dirLen;

                final float tCyl = intersectVerticalCylinder(camX, camY, camZ, dx, dy, dz, cylR, groundY, cylH);
                final float tFurn = intersectBox(
                    camX, camY, camZ, dx, dy, dz,
                    0.24f, 0.95f, groundY, groundY + 0.85f, -0.70f, -0.40f
                );
                float tFloor = Float.MAX_VALUE;
                if (dy < -1e-5f) {
                    final float tf = (groundY - camY) / dy;
                    if (tf > 0.05f && tf < 4.40f) {
                        tFloor = tf;
                    }
                }

                final float bestT = Math.min(tCyl, Math.min(tFurn, tFloor));
                if (bestT < Float.MAX_VALUE) {
                    final float wx = camX + bestT * dx;
                    final float wy = camY + bestT * dy;
                    final float wz = camZ + bestT * dz;
                    // Z-depth along camera -Z axis (matches OpenGL/ARCore depth buffer convention)
                    final float zCam = w2c[2] * wx + w2c[6] * wy + w2c[10] * wz + w2c[14];
                    final float dM = -zCam;
                    if (dM >= 0.25f && dM <= 4.50f) {
                        depthMm[rowOff + px] = (short) Math.round(dM * 1000.0f);
                        depthConf[rowOff + px] = (byte) 220;
                    }
                    // Contaminate mask: cylinder + adjacent floor ring + neighboring furniture!
                    if (tCyl == bestT) {
                        maskConf[rowOff + px] = (byte) 240;
                        cylSumU += px;
                        cylSumV += py;
                        cylPxCount++;
                    } else if (tFurn == bestT) {
                        maskConf[rowOff + px] = (byte) 220;
                    } else if (tFloor == bestT && Math.hypot(wx, wz) <= 0.45) {
                        maskConf[rowOff + px] = (byte) 210;
                    }
                }
            }
        }

        assertTrue("Synthetic cylinder must project onto camera pixels", cylPxCount > 60);
        final float tapNormX = (cylSumU / (float) cylPxCount) / (w - 1);
        final float tapNormY = (cylSumV / (float) cylPxCount) / (h - 1);

        final DepthMaskFuser.FusedTargetSurface fused = DepthMaskFuser.fuse(
            maskConf, w, h,
            depthMm, depthConf, w, h,
            fx, fy, cx, cy,
            c2w,
            groundY,
            0.0f, groundY + 0.25f, 0.0f,
            tapNormX, tapNormY,
            null
        );

        assertNotNull(fused);
        assertTrue("Depth fusion must report usedDepth=true", fused.usedDepth);
        assertTrue(
            "Auto-fitted cylinder radius must be in [0.15, 0.24] m (not 1.20 m), got " + fused.estimatedRadiusM,
            fused.estimatedRadiusM >= 0.15f && fused.estimatedRadiusM <= 0.24f
        );
        assertTrue(
            "Auto-fitted cylinder height must be in [0.46, 0.62] m, got " + fused.estimatedHeightM,
            fused.estimatedHeightM >= 0.46f && fused.estimatedHeightM <= 0.62f
        );
        assertTrue("Frontal mesh triangles must be generated", fused.triVerticesXyz.length > 0);
        assertEquals("triVerticesXyz must contain complete triangles (multiple of 9 floats)", 0, fused.triVerticesXyz.length % 9);
        assertTrue("3D contour loop must have >= 3 vertices", fused.contourLoopXyz.length >= 9);
        assertEquals(0, fused.contourLoopXyz.length % 3);
        assertFalse("depthPointsM must not be empty", fused.depthPointsM.isEmpty());

        // Strict verification: NO floor points (y <= groundY + 0.03) and NO furniture leakage (x > 0.21 or z < -0.25)
        for (float[] pt : fused.depthPointsM) {
            assertTrue("Floor point leaked into depthPointsM: y=" + pt[1], pt[1] > groundY + 0.03f);
            assertTrue("Furniture leaked into depthPointsM (x=" + pt[0] + ")", pt[0] <= 0.21f);
            assertTrue("Furniture leaked into depthPointsM (z=" + pt[2] + ")", pt[2] >= -0.25f);
        }
        for (int i = 0; i + 2 < fused.triVerticesXyz.length; i += 3) {
            assertTrue(
                "Floor vertex leaked into triVerticesXyz: y=" + fused.triVerticesXyz[i + 1],
                fused.triVerticesXyz[i + 1] > groundY + 0.03f
            );
        }

        // Verify No-Depth fallback on clean cylinder-only mask
        final byte[] cylOnlyMask = new byte[w * h];
        for (int py = 0; py < h; py++) {
            final int rowOff = py * w;
            for (int px = 0; px < w; px++) {
                // Keep only foreground pixels near center (cylinder)
                if ((maskConf[rowOff + px] & 0xFF) == 240) {
                    cylOnlyMask[rowOff + px] = (byte) 240;
                }
            }
        }
        final DepthMaskFuser.FusedTargetSurface noDepth = DepthMaskFuser.fuse(
            cylOnlyMask, w, h,
            null, null, 0, 0,
            fx, fy, cx, cy,
            c2w,
            groundY,
            0.0f, groundY + 0.27f, 0.0f,
            tapNormX, tapNormY,
            null
        );
        assertFalse("No-depth fallback must report usedDepth=false", noDepth.usedDepth);
        assertEquals(0, noDepth.triVerticesXyz.length);
        assertEquals(0, noDepth.contourLoopXyz.length);
        assertTrue(
            "No-depth estimated radius must be realistic in [0.12, 0.24] m, got " + noDepth.estimatedRadiusM,
            noDepth.estimatedRadiusM >= 0.12f && noDepth.estimatedRadiusM <= 0.24f
        );

        // Verify extractFilteredDepthPoints filters floor and respects active TargetVolumeConstraint
        final List<float[]> extracted = DepthMaskFuser.extractFilteredDepthPoints(
            maskConf, w, h,
            depthMm, depthConf, w, h,
            fx, fy, cx, cy,
            c2w,
            groundY,
            fused.constraint,
            2,
            250
        );
        assertFalse("extractFilteredDepthPoints must return cylinder points", extracted.isEmpty());
        assertTrue(extracted.size() <= 250);
        for (float[] pt : extracted) {
            assertTrue("Extracted point must be strictly above floor + 2.5 cm", pt[1] > groundY + 0.025f);
            assertTrue("Extracted point must stay within target XZ radius", fused.constraint.containsXZ(pt[0], pt[2], 1.05f));
        }
    }

    @Test
    public void testTargetVolumeConstraintContains3DForVisualRejectsFloorAndAcceptsCylinder() {
        // (d) Verify MIN_RADIUS_M = 0.12f, heightEstM, withAutoBounds preservation, and floor rejection fix
        assertEquals(0.12f, TargetVolumeConstraint.MIN_RADIUS_M, 1e-6f);

        final float groundY = -1.20f;
        final float[] poly = { -0.50f, -0.50f, 0.50f, -0.50f, 0.50f, 0.50f, -0.50f, 0.50f };
        final TargetVolumeConstraint initial = TargetVolumeConstraint.fromAnchorWithPolygon(
            0.0f, groundY, 0.0f, 1.20f, poly, true, groundY
        );
        assertEquals(0.0f, initial.heightEstM, 1e-6f);

        final TargetVolumeConstraint auto = initial.withAutoBounds(0.02f, groundY, -0.01f, 0.18f, 0.54f);
        assertTrue(auto.active);
        assertEquals(0.18f, auto.radiusM, 1e-6f);
        assertEquals(0.54f, auto.heightEstM, 1e-6f);
        assertTrue("withAutoBounds must preserve hasPadReferenceY", auto.hasPadReferenceY);
        assertEquals(groundY, auto.padReferenceY, 1e-6f);
        assertTrue("withAutoBounds must preserve polygonXZ", auto.hasValidPolygon());
        assertEquals(4, auto.getPolygonVertexCount());

        // Floor rejection with padReferenceY set (3-arg)
        assertFalse("Floor point at y = groundY must be rejected", auto.contains3DForVisual(0.0f, groundY, 0.0f));
        assertFalse("Floor point at y = groundY - 0.01 must be rejected", auto.contains3DForVisual(0.0f, groundY - 0.01f, 0.0f));
        assertFalse("Floor tile point at y = groundY + 0.02 must be rejected", auto.contains3DForVisual(0.0f, groundY + 0.02f, 0.0f));

        // Cylinder body acceptance (y >= groundY + 0.05 up to top)
        assertTrue("Cylinder point at y = groundY + 0.05 must be accepted", auto.contains3DForVisual(0.0f, groundY + 0.05f, 0.0f));
        assertTrue("Cylinder top at y = groundY + 0.54 must be accepted", auto.contains3DForVisual(0.05f, groundY + 0.54f, 0.02f));

        // Explicit 4-arg overload WITHOUT padReferenceY (anchorY mid-object, explicit groundY passed)
        final TargetVolumeConstraint noPad = TargetVolumeConstraint
            .fromAnchor(0.0f, groundY + 0.25f, 0.0f, 0.19f)
            .withAutoBounds(0.0f, groundY + 0.25f, 0.0f, 0.19f, 0.54f);
        assertFalse(noPad.hasPadReferenceY);
        assertFalse(
            "4-arg contains3DForVisual must reject floor tile at groundY + 0.02",
            noPad.contains3DForVisual(0.0f, groundY + 0.02f, 0.0f, groundY)
        );
        assertTrue(
            "4-arg contains3DForVisual must accept cylinder body at groundY + 0.05",
            noPad.contains3DForVisual(0.05f, groundY + 0.05f, 0.0f, groundY)
        );
        assertFalse(
            "4-arg contains3DForVisual must reject point outside XZ radius",
            noPad.contains3DForVisual(0.40f, groundY + 0.25f, 0.0f, groundY)
        );

        // 3-arg without padReferenceY anchored at floor (anchorY == groundY): must never subtract 0.12 or 0.02!
        final TargetVolumeConstraint floorAnchored = TargetVolumeConstraint.fromAnchor(0.0f, groundY, 0.0f, 0.20f);
        assertFalse("3-arg must reject y = groundY + 0.02 when anchorY = groundY", floorAnchored.contains3DForVisual(0.0f, groundY + 0.02f, 0.0f));
        assertTrue("3-arg must accept y = groundY + 0.05 when anchorY = groundY", floorAnchored.contains3DForVisual(0.0f, groundY + 0.05f, 0.0f));
    }
}
