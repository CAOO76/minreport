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
        assertTrue("contourSegmentsXyz must emit GL_LINES vertex pairs", fused.contourSegmentsXyz.length >= 6);
        assertEquals("contourSegmentsXyz must be multiple of 6 floats", 0, fused.contourSegmentsXyz.length % 6);
        for (int i = 0; i + 5 < fused.contourSegmentsXyz.length; i += 6) {
            final float ddx = fused.contourSegmentsXyz[i + 3] - fused.contourSegmentsXyz[i];
            final float ddy = fused.contourSegmentsXyz[i + 4] - fused.contourSegmentsXyz[i + 1];
            final float ddz = fused.contourSegmentsXyz[i + 5] - fused.contourSegmentsXyz[i + 2];
            final float segLen = (float) Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
            assertTrue("contourSegmentsXyz must break 3D jumps > 0.25 m, got " + segLen, segLen <= 0.251f);
        }
        assertTrue(
            "Fused constraint must use generous ROI radius (>= R_app + 0.35 m), got " + fused.constraint.radiusM,
            fused.constraint.radiusM >= fused.estimatedRadiusM + 0.34f
        );
        assertTrue(
            "Inward center push must move constraint center closer to Z=0 than front skin (+0.105 m), got " + fused.constraint.anchorZ,
            Math.abs(fused.constraint.anchorZ) < 0.08f
        );
        assertFalse("depthPointsM must not be empty", fused.depthPointsM.isEmpty());

        // Strict verification: NO floor points (y <= groundY + 0.03) and NO furniture leakage (x > 0.21 or z < -0.25)
        for (float[] pt : fused.depthPointsM) {
            assertTrue("Floor point leaked into depthPointsM: y=" + pt[1], pt[1] > groundY + 0.03f);
            assertTrue("Furniture leaked into depthPointsM (x=" + pt[0] + ")", pt[0] <= 0.21f);
            assertTrue("Furniture leaked into depthPointsM (z=" + pt[2] + ")", pt[2] >= -0.25f);
            assertEquals("Depth points must carry weight 1.0f", 1.0f, pt[3], 1e-5f);
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

        // Verify translateByDelta shifts anchor & polygon by VIO delta without overwriting refined centroid
        final TargetVolumeConstraint shifted = auto.translateByDelta(0.05f, -0.02f, 0.03f);
        assertEquals(auto.anchorX + 0.05f, shifted.anchorX, 1e-6f);
        assertEquals(auto.anchorY - 0.02f, shifted.anchorY, 1e-6f);
        assertEquals(auto.anchorZ + 0.03f, shifted.anchorZ, 1e-6f);
        assertEquals(auto.radiusM, shifted.radiusM, 1e-6f);
        assertEquals(auto.heightEstM, shifted.heightEstM, 1e-6f);
        assertEquals(auto.polygonXZ[0] + 0.05f, shifted.polygonXZ[0], 1e-6f);
        assertEquals(auto.polygonXZ[1] + 0.03f, shifted.polygonXZ[1], 1e-6f);
    }

    @Test
    public void testCylinderWithFrontalSkinAnchorBiasAndRawDepthEdgeBleedingWithin6Pct() {
        // (a) 54 x 33 cm cylinder (exact V = 0.046186 m^3) with:
        //     - 0 MVS points on walls
        //     - Initial target anchor displaced +16.5 cm onto the FRONT SKIN (AC-9723 failure mode!)
        //     - Raw Depth points containing vertical wall points + edge-bleeding flying pixels at mid-height
        final float cylR = 0.165f;
        final float cylH = 0.54f;
        final float groundY = -1.20f;
        final double exactVol = Math.PI * cylR * cylR * cylH; // 0.046186 m^3

        final int w = 320;
        final int h = 240;
        final float fx = 280.0f;
        final float fy = 280.0f;
        final float cx = 160.0f;
        final float cy = 120.0f;

        final List<VisualHullCarver.SegmentedView> views = new ArrayList<>(16);
        final List<WalkRingToeSolver.WalkPose> walkPoses = new ArrayList<>(16);
        final List<float[]> noisyRawDepthPts = new ArrayList<>();

        for (int i = 0; i < 16; i++) {
            final double ang = (2.0 * Math.PI * i) / 16.0;
            final float camX = (float) (Math.cos(ang) * 1.45);
            final float camY = groundY + 0.85f;
            final float camZ = (float) (Math.sin(ang) * 1.45);

            final float[] c2w = lookAtCameraToWorldColMajor(camX, camY, camZ, 0.0f, groundY + 0.27f, 0.0f);
            final float[] w2c = invertRigidColMajor(c2w);

            final byte[] mask = new byte[w * h];
            final short[] depthMm = new short[w * h];
            final byte[] depthConf = new byte[w * h];

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

                    final float tCyl = intersectVerticalCylinder(camX, camY, camZ, dx, dy, dz, cylR, groundY, cylH);
                    if (tCyl < Float.MAX_VALUE) {
                        mask[rowOff + px] = (byte) 255;
                        final float wx = camX + tCyl * dx;
                        final float wy = camY + tCyl * dy;
                        final float wz = camZ + tCyl * dz;
                        final float zCam = w2c[2] * wx + w2c[6] * wy + w2c[10] * wz + w2c[14];
                        depthMm[rowOff + px] = (short) Math.round((-zCam) * 1000.0f);
                        depthConf[rowOff + px] = (byte) 230;
                    } else {
                        // Background wall at 3.2 m to trigger realistic depth-jump edge-bleeding on silhouette rim
                        depthMm[rowOff + px] = 3200;
                        depthConf[rowOff + px] = (byte) 220;
                    }
                }
            }

            // Inject synthetic edge-bleeding mixed depth pixels right along the silhouette boundary
            for (int py = 1; py < h - 1; py++) {
                for (int px = 1; px < w - 1; px++) {
                    final int idx = py * w + px;
                    if ((mask[idx] & 0xFF) >= 128 &&
                        ((mask[idx - 1] & 0xFF) < 128 || (mask[idx + 1] & 0xFF) < 128)) {
                        // Mixed depth between cylinder (~1.3m) and background (3.2m) -> 2.1m flying pixel!
                        depthMm[idx] = 2100;
                    }
                }
            }

            views.add(new VisualHullCarver.SegmentedView(mask, w, h, fx, fy, cx, cy, w2c, groundY));
            walkPoses.add(new WalkRingToeSolver.WalkPose(
                camX, camY, camZ, -c2w[8], -c2w[9], -c2w[10], i * 100_000_000L
            ));

            if (i % 2 == 0) {
                noisyRawDepthPts.addAll(DepthMaskFuser.extractFilteredDepthPoints(
                    mask, w, h, depthMm, depthConf, w, h,
                    fx, fy, cx, cy, c2w, groundY, null, 2, 400
                ));
            }
        }

        // Verify all extracted depth points have weight 1.0f and none flew to background (> 0.25 m from center)
        assertFalse("Filtered Raw Depth should still retain clean interior cylinder points", noisyRawDepthPts.isEmpty());
        for (float[] pt : noisyRawDepthPts) {
            assertEquals(1.0f, pt[3], 1e-5f);
            assertTrue(
                "Edge-bleeding flying pixel must be rejected (r=" + Math.hypot(pt[0], pt[2]) + ")",
                Math.hypot(pt[0], pt[2]) <= cylR + 0.05f
            );
        }

        // Also inject raw wall/edge-bleeding points directly on the cylinder perimeter to verify Tri-Modal protection
        for (int a = 0; a < 32; a++) {
            final double ang = (2.0 * Math.PI * a) / 32.0;
            final float wx = (float) (Math.cos(ang) * (cylR - 0.01f));
            final float wz = (float) (Math.sin(ang) * (cylR - 0.01f));
            noisyRawDepthPts.add(new float[] { wx, groundY + 0.18f, wz, 1.0f });
            noisyRawDepthPts.add(new float[] { wx, groundY + 0.27f, wz, 1.0f });
        }

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

        // FRONT-SKIN BIASED ANCHOR (+16.5 cm off-center) with tight radius 0.21 m!
        final TargetVolumeConstraint frontSkinTarget = TargetVolumeConstraint
            .fromAnchor(0.0f, groundY + 0.25f, +0.165f, 0.21f)
            .withAutoBounds(0.0f, groundY + 0.25f, +0.165f, 0.21f, 0.54f);

        final VisualHullCarver.VisualHullResult hull = VisualHullCarver.carve(views, frontSkinTarget, groundY, 64);
        assertTrue(hull.isValid());
        // Verify hull centroid recovered true center ~(0, -0.93, 0) despite +16.5 cm front-skin anchor!
        assertEquals("Hull centroidX must recover 0.0 m", 0.0f, hull.centroidX, 0.03f);
        assertEquals("Hull centroidZ must recover 0.0 m despite +16.5 cm anchor bias", 0.0f, hull.centroidZ, 0.03f);

        final WalkRingToeSolver.MetrologyResult res = WalkRingToeSolver.solve(
            noisyRawDepthPts,
            walkPoses,
            groundSamples,
            true,
            0.3,
            frontSkinTarget,
            hull
        );

        assertTrue(
            "Cylinder V must be in [0.0434, 0.0490] m^3 (< +/-6% of " + exactVol + "), got " + res.volumeM3,
            res.volumeM3 >= 0.0434 && res.volumeM3 <= 0.0490
        );
        assertTrue("dimA must be in [0.30, 0.36] m, got " + res.dimA, res.dimA >= 0.30 && res.dimA <= 0.36);
        assertTrue("dimB must be in [0.30, 0.36] m, got " + res.dimB, res.dimB >= 0.30 && res.dimB <= 0.36);
        assertTrue("dimH must be in [0.51, 0.57] m, got " + res.dimH, res.dimH >= 0.51 && res.dimH <= 0.57);
        assertTrue("Cylinder slope must exceed 80 deg, got " + res.slopeAngleAvgDeg, res.slopeAngleAvgDeg > 80.0);
        assertEquals(WalkRingToeSolver.SLOPE_PROFILE_VERTICAL_STRUCTURE, res.slopeProfile);
        // Exported anchor must be the true centroid (~0, ~0), NOT the +16.5 cm front-skin anchor!
        assertEquals("Exported anchorX must match true centroid", 0.0f, res.anchorX, 0.04f);
        assertEquals("Exported anchorZ must match true centroid", 0.0f, res.anchorZ, 0.04f);
        assertTrue("Exported roiRadiusM must be generous", res.roiRadiusM >= 0.35f);
        // LocalPreviewMesh dem_grid_v2 helper
        assertNotNull(res.previewMesh);
        assertEquals("dem_grid_v1", res.previewMesh.format);
        final WalkRingToeSolver.LocalPreviewMesh v2Mesh = res.previewMesh.withRgbB64("AAAA");
        assertEquals("dem_grid_v2", v2Mesh.format);
        assertEquals("AAAA", v2Mesh.rgbB64);
    }

    @Test
    public void testRectangularBox60x40x45cmVisualHullWithin8Pct() {
        // (b) Rectangular box 0.60 x 0.40 x 0.45 m -> exact V = 0.108 m^3 (< +/-8%)
        // Tests BOTH: (1) Multi-view Visual Hull with realistic walk-ring distance + top/wall depth,
        // and (2) Pure point-cloud vertical-wall box via robust upper-envelope MAD+p90 (zero -50% p50 wall erosion).
        final float halfX = 0.30f;
        final float halfZ = 0.20f;
        final float boxH = 0.45f;
        final float groundY = -1.10f;
        final double exactVol = 0.60 * 0.40 * 0.45; // 0.108 m^3

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
            final float camX = (float) (Math.cos(ang) * 3.20);
            final float camY = groundY + 0.60f;
            final float camZ = (float) (Math.sin(ang) * 3.20);
            final float[] c2w = lookAtCameraToWorldColMajor(camX, camY, camZ, 0.0f, groundY + 0.22f, 0.0f);
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
                    if (intersectBox(camX, camY, camZ, dx, dy, dz, -halfX, halfX, groundY, groundY + boxH, -halfZ, halfZ) < Float.MAX_VALUE) {
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
            groundSamples.add(new float[] { (float) (Math.cos(ang) * 1.4), groundY, (float) (Math.sin(ang) * 1.4) });
        }

        // 1. Dense vertical-wall + top-cap point cloud (tests robust MAD+p90 upper envelope without p50 wall collapse)
        final List<float[]> boxCloud = new ArrayList<>();
        for (float x = -halfX; x <= halfX + 1e-4f; x += 0.02f) {
            for (float z = -halfZ; z <= halfZ + 1e-4f; z += 0.02f) {
                boxCloud.add(new float[] { x, groundY + boxH, z, 1.0f });
            }
        }
        for (float hWall = 0.04f; hWall <= boxH - 0.02f; hWall += 0.03f) {
            for (float x = -halfX; x <= halfX + 1e-4f; x += 0.025f) {
                boxCloud.add(new float[] { x, groundY + hWall, -halfZ, 1.0f });
                boxCloud.add(new float[] { x, groundY + hWall, halfZ, 1.0f });
            }
            for (float z = -halfZ; z <= halfZ + 1e-4f; z += 0.025f) {
                boxCloud.add(new float[] { -halfX, groundY + hWall, z, 1.0f });
                boxCloud.add(new float[] { halfX, groundY + hWall, z, 1.0f });
            }
        }
        final TargetVolumeConstraint boxTarget = TargetVolumeConstraint.fromAnchor(0.0f, groundY + 0.22f, +0.20f, 0.70f);
        final WalkRingToeSolver.MetrologyResult resCloud = WalkRingToeSolver.solve(
            boxCloud, walkPoses, groundSamples, true, 0.3, boxTarget, null
        );
        final double errCloudPct = Math.abs(resCloud.volumeM3 - exactVol) / exactVol * 100.0;
        assertTrue(
            "Box 0.60x0.40x0.45 m cloud volume error must be < 8% (exact=0.108, got=" + resCloud.volumeM3 + ", err=" + errCloudPct + "%)",
            errCloudPct < 8.0
        );
        assertEquals("Box cloud height ~0.45 m", 0.45, resCloud.dimH, 0.04);
        assertTrue("Box vertical wall slope must exceed 80 deg, got " + resCloud.slopeAngleAvgDeg, resCloud.slopeAngleAvgDeg > 80.0);

        // 2. Visual Hull with front-face displaced anchor (+0.20 m) recovers true centroid ~(0, 0) & height ~0.45 m
        //    (note: exact analytical silhouette-only hull of a rectangular box from R=3.2 m has ~14% perspective corner overhang)
        final TargetVolumeConstraint target = TargetVolumeConstraint.fromAnchor(0.0f, groundY + 0.20f, +0.20f, 0.35f);
        final VisualHullCarver.VisualHullResult hull = VisualHullCarver.carve(views, target, groundY, 64);
        assertTrue(hull.isValid());
        assertEquals("Box hull centroidX must recover 0.0 m", 0.0f, hull.centroidX, 0.03f);
        assertEquals("Box hull centroidZ must recover 0.0 m despite +0.20 m front anchor", 0.0f, hull.centroidZ, 0.03f);
        final WalkRingToeSolver.MetrologyResult resHull = WalkRingToeSolver.solve(
            Collections.emptyList(), walkPoses, groundSamples, true, 0.3, target, hull
        );
        assertEquals("Box hull height ~0.45 m", 0.45, resHull.dimH, 0.05);
        assertTrue("Box hull volume must stay close to analytical visual hull bound (got " + resHull.volumeM3 + ")",
            resHull.volumeM3 >= 0.100 && resHull.volumeM3 <= 0.136);
    }

    @Test
    public void testTargetActiveNeverFallsBackToRoomCloudAndFloorRelaxationWorks() {
        // 1. Target active with 0 in-envelope points and NO visual hull -> must return REJECTED, never absorb room cloud!
        final List<float[]> roomPts = new ArrayList<>();
        for (float x = 3.0f; x <= 5.0f; x += 0.2f) {
            for (float z = 3.0f; z <= 5.0f; z += 0.2f) {
                roomPts.add(new float[] { x, -0.5f, z, 1.0f });
            }
        }
        final TargetVolumeConstraint emptyTarget = TargetVolumeConstraint.fromAnchor(0.0f, -1.2f, 0.0f, 0.35f);
        final WalkRingToeSolver.MetrologyResult rejected = WalkRingToeSolver.solve(
            roomPts, Collections.emptyList(), Collections.emptyList(), false, 0.5, emptyTarget, null
        );
        assertEquals("Target with < 12 in-envelope points and no hull must be REJECTED (no room fallback)", "REJECTED", rejected.metrologyGrade);
        assertEquals(0.0, rejected.volumeM3, 1e-6);

        // 2. DepthMaskFuser floor-cut relaxation when groundY arrives overestimated (> 80% pixels below groundY + 0.03)
        final int w = 80;
        final int h = 60;
        final float fx = 70.0f;
        final float fy = 70.0f;
        final float cx = 40.0f;
        final float cy = 30.0f;
        final float trueGroundY = -1.20f;
        final float[] c2w = lookAtCameraToWorldColMajor(0.0f, trueGroundY + 0.70f, 1.40f, 0.0f, trueGroundY + 0.27f, 0.0f);
        final float[] w2c = invertRigidColMajor(c2w);
        final byte[] mask = new byte[w * h];
        final short[] depthMm = new short[w * h];
        final byte[] depthConf = new byte[w * h];
        for (int py = 0; py < h; py++) {
            for (int px = 0; px < w; px++) {
                final float rcx = (px - cx) / fx;
                final float rcy = -(py - cy) / fy;
                float dx = c2w[0] * rcx + c2w[4] * rcy + c2w[8] * -1.0f;
                float dy = c2w[1] * rcx + c2w[5] * rcy + c2w[9] * -1.0f;
                float dz = c2w[2] * rcx + c2w[6] * rcy + c2w[10] * -1.0f;
                final float len = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
                dx /= len; dy /= len; dz /= len;
                final float tCyl = intersectVerticalCylinder(0.0f, trueGroundY + 0.70f, 1.40f, dx, dy, dz, 0.165f, trueGroundY, 0.54f);
                if (tCyl < Float.MAX_VALUE) {
                    mask[py * w + px] = (byte) 255;
                    final float wx = tCyl * dx;
                    final float wy = trueGroundY + 0.70f + tCyl * dy;
                    final float wz = 1.40f + tCyl * dz;
                    final float zCam = w2c[2] * wx + w2c[6] * wy + w2c[10] * wz + w2c[14];
                    depthMm[py * w + px] = (short) Math.round((-zCam) * 1000.0f);
                    depthConf[py * w + px] = (byte) 230;
                }
            }
        }
        // Pass an erroneously HIGH groundY (top of cylinder = trueGroundY + 0.52 m) -> > 80% discarded -> must relax!
        final DepthMaskFuser.FusedTargetSurface relaxed = DepthMaskFuser.fuse(
            mask, w, h, depthMm, depthConf, w, h, fx, fy, cx, cy, c2w,
            trueGroundY + 0.52f, 0.0f, trueGroundY + 0.52f, 0.165f, 0.5f, 0.5f, null
        );
        assertTrue("Overestimated floor must trigger relaxation and retain usedDepth=true", relaxed.usedDepth);
        assertTrue("Relaxed fusion must still produce frontal triangles", relaxed.triVerticesXyz.length >= 9);
    }

    @Test
    public void testNocturnalCylinder54x33PitchMinus43ShadowClosedLiveSkirtsAndCroppedPreviewMesh() {
        // v2.3.1 AC-5745 regression:
        // - 54 x 33 cm cylinder (exact V = 0.046186 m^3) scanned at downward pitch -43 deg
        // - Frontal shadow leakage in 2 views + noisy patio clutter points at r in [0.55, 1.25] m
        // - Raw depth top-cap & wall observations anchor roof via Tri-Modal allowCarveDown
        // - Validates: V in [0.0425, 0.0499], H in [0.51, 0.57], dimA/dimB in [0.30, 0.37],
        //   cropped previewMesh (cellSizeM <= 0.025 m, activeRatio > 0.25),
        //   and closed LiveOverlaySnapshot vertical skirts reaching groundPlane (minY <= groundY + 0.03f, maxY >= groundY + 0.45f).
        final float cylR = 0.165f;
        final float cylH = 0.54f;
        final float groundY = -1.20f;

        final int w = 320;
        final int h = 240;
        final float fx = 280.0f;
        final float fy = 280.0f;
        final float cx = 160.0f;
        final float cy = 120.0f;

        final float orbitR = 1.05f;
        // Downward pitch -43 deg looking at cylinder mid-height (groundY + 0.27 m)
        final float camY = groundY + 0.27f + (float) (orbitR * Math.tan(Math.toRadians(43.0)));

        final List<VisualHullCarver.SegmentedView> views = new ArrayList<>(16);
        final List<WalkRingToeSolver.WalkPose> walkPoses = new ArrayList<>(16);

        for (int i = 0; i < 16; i++) {
            final double ang = (2.0 * Math.PI * i) / 16.0;
            final float camX = (float) (Math.cos(ang) * orbitR);
            final float camZ = (float) (Math.sin(ang) * orbitR);

            final float[] c2w = lookAtCameraToWorldColMajor(camX, camY, camZ, 0.0f, groundY + 0.27f, 0.0f);
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

                    final float tCyl = intersectVerticalCylinder(camX, camY, camZ, dx, dy, dz, cylR, groundY, cylH);
                    if (tCyl < Float.MAX_VALUE) {
                        mask[rowOff + px] = (byte) 255;
                    } else if (i < 2 && dy < -1e-4f) {
                        // Frontal shadow leakage on floor in 2 views (z in [+0.16, +0.42], |x| <= 0.16)
                        final float tFloor = (groundY - camY) / dy;
                        if (tFloor > 0.05f && tFloor < 4.0f) {
                            final float fxW = camX + tFloor * dx;
                            final float fzW = camZ + tFloor * dz;
                            if (fzW >= cylR && fzW <= cylR + 0.25f && Math.abs(fxW) <= cylR) {
                                mask[rowOff + px] = (byte) 220;
                            }
                        }
                    }
                }
            }

            views.add(new VisualHullCarver.SegmentedView(mask, w, h, fx, fy, cx, cy, w2c, groundY));
            walkPoses.add(new WalkRingToeSolver.WalkPose(
                camX, camY, camZ, -c2w[8], -c2w[9], -c2w[10], i * 100_000_000L
            ));
        }

        // Depth points: clean flat top-cap observations (anchors roof against -43 deg visual hull pyramid)
        // + noisy patio clutter points far from cylinder (r in [0.55, 1.25] m) that must NOT bloat DEM bbox!
        final List<float[]> depthPts = new ArrayList<>();
        for (float x = -cylR; x <= cylR; x += 0.014f) {
            for (float z = -cylR; z <= cylR; z += 0.014f) {
                if (Math.hypot(x, z) <= cylR - 0.005f) {
                    depthPts.add(new float[] { x, groundY + cylH, z, 3.0f });
                }
            }
        }
        // Inject frontal shadow points (h = 0.05..0.09 m) and distant patio clutter points (up to 1.2 m away)
        for (float sx = -0.14f; sx <= 0.14f; sx += 0.04f) {
            for (float sz = cylR + 0.03f; sz <= cylR + 0.28f; sz += 0.04f) {
                depthPts.add(new float[] { sx, groundY + 0.07f, sz, 1.0f });
            }
        }
        for (int a = 0; a < 24; a++) {
            final double ang = (2.0 * Math.PI * a) / 24.0;
            depthPts.add(new float[] {
                (float) (Math.cos(ang) * 0.95),
                groundY + 0.11f,
                (float) (Math.sin(ang) * 0.95),
                1.0f
            });
        }

        final List<float[]> groundSamples = new ArrayList<>();
        for (int s = 0; s < 32; s++) {
            final double ang = (2.0 * Math.PI * s) / 32.0;
            for (float r = 0.45f; r <= 1.20f; r += 0.25f) {
                groundSamples.add(new float[] {
                    (float) (Math.cos(ang) * r),
                    groundY,
                    (float) (Math.sin(ang) * r)
                });
            }
        }

        final TargetVolumeConstraint target = TargetVolumeConstraint
            .fromAnchor(0.0f, groundY + 0.27f, 0.0f, 0.90f)
            .withAutoBounds(0.0f, groundY + 0.27f, 0.0f, 0.90f, cylH);

        final VisualHullCarver.VisualHullResult hull = VisualHullCarver.carve(views, target, groundY, 48);
        assertNotNull(hull);
        assertTrue("Nocturnal cylinder hull must be valid", hull.isValid());

        final WalkRingToeSolver.MetrologyResult res = WalkRingToeSolver.solve(
            depthPts,
            walkPoses,
            groundSamples,
            true,
            0.3,
            target,
            hull
        );

        assertNotNull(res);
        assertEquals("VALID_IN_SITU", res.metrologyGrade);
        assertTrue(
            "Nocturnal cylinder V must be in [0.0425, 0.0499] m^3 (real 0.0462), got " + res.volumeM3,
            res.volumeM3 >= 0.0425 && res.volumeM3 <= 0.0499
        );
        assertTrue(
            "Nocturnal cylinder H must be in [0.51, 0.57] m, got " + res.dimH,
            res.dimH >= 0.51 && res.dimH <= 0.57
        );
        assertTrue(
            "Nocturnal cylinder dimA must be in [0.30, 0.37] m, got " + res.dimA,
            res.dimA >= 0.30 && res.dimA <= 0.37
        );
        assertTrue(
            "Nocturnal cylinder dimB must be in [0.30, 0.37] m, got " + res.dimB,
            res.dimB >= 0.30 && res.dimB <= 0.37
        );

        // CR-5: Cropped LocalPreviewMesh (cellSizeM <= 0.025 m, activeRatio > 0.25, zero 94.9% empty grid)
        assertNotNull(res.previewMesh);
        assertTrue(
            "Cropped previewMesh cellSizeM must be <= 0.025 m, got " + res.previewMesh.cellSizeM,
            res.previewMesh.cellSizeM <= 0.025f
        );
        int previewActive = 0;
        for (float ph : res.previewMesh.heightsM) {
            if (ph > 0.01f) previewActive++;
        }
        final double activeRatio = previewActive / (double) Math.max(1, res.previewMesh.heightsM.length);
        assertTrue(
            "Cropped previewMesh activeRatio must be > 0.25 (zero 94.9% empty patio), got " + activeRatio,
            activeRatio > 0.25
        );

        // CR-2: LiveOverlaySnapshot closed vertical skirts down to groundPlane
        assertNotNull(res.liveOverlay);
        final float[] tris = res.liveOverlay.verifiedTriVerts;
        assertNotNull(tris);
        assertTrue("Live overlay must emit closed cap + vertical skirt triangles", tris.length >= 90);
        assertEquals("verifiedTriVerts must be complete triangles (multiple of 9)", 0, tris.length % 9);
        assertTrue("verifiedTriVerts must stay within 9000-float budget", tris.length <= 9000);
        float minY = Float.MAX_VALUE;
        float maxY = -Float.MAX_VALUE;
        for (int i = 1; i < tris.length; i += 3) {
            if (tris[i] < minY) minY = tris[i];
            if (tris[i] > maxY) maxY = tris[i];
        }
        assertTrue(
            "Live overlay vertical skirts must reach groundPlane (minY <= groundY + 0.03), got minY=" + minY + " vs groundY=" + groundY,
            minY <= groundY + 0.03f
        );
        assertTrue(
            "Live overlay top cap must reach cylinder top (maxY >= groundY + 0.45), got maxY=" + maxY + " vs groundY=" + groundY,
            maxY >= groundY + 0.45f
        );
    }
}
