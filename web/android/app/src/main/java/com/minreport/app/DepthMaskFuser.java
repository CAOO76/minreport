package com.minreport.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Pure-Java 2D Object Mask + Depth Fusion & Filtered Raw-Depth Extractor for MINREPORT · ACOPIOS (2.2.0).
 *
 * Coordinate convention (100% consistent with ARCore / OpenGL / VisualHullCarver / OfflineVioMvsEngine):
 * - Camera space: +X right, +Y up, -Z forward (optical axis).
 * - Image pixel (u, v) with +u right, +v down and positive depth dM > 0 meters:
 *     xc = ((u - cx) / fx) * dM
 *     yc = -((v - cy) / fy) * dM
 *     zc = -dM
 * - cameraToWorldColMajor16 is a 16-float column-major OpenGL 4x4 matrix (e.g. Pose.toMatrix(m, 0)):
 *     wx = m[0]*xc + m[4]*yc + m[8]*zc + m[12]
 *     wy = m[1]*xc + m[5]*yc + m[9]*zc + m[13]
 *     wz = m[2]*xc + m[6]*yc + m[10]*zc + m[14]
 *
 * Zero Android framework dependencies for deterministic JVM JUnit verification.
 */
public final class DepthMaskFuser {

    private static final int MASK_THRESHOLD = 128;
    private static final int FUSE_DEPTH_CONF_MIN = 96;
    private static final int EXTRACT_DEPTH_CONF_MIN = 128;
    private static final float MIN_DEPTH_M = 0.25f;
    private static final float MAX_DEPTH_M = 4.50f;
    private static final float FLOOR_CLEARANCE_FUSE_M = 0.045f;
    private static final float FLOOR_CLEARANCE_EXTRACT_M = 0.025f;
    private static final float BFS_MAX_DEPTH_STEP_M = 0.08f;
    private static final float CONTOUR_MAX_SEGMENT_DIST_M = 0.15f;
    private static final float ASPECT_RATIO_CROP_EPS = 0.02f;
    private static final float FLOOR_RELAX_REJECT_RATIO = 0.80f;
    private static final float INWARD_CENTER_PUSH_FACTOR = 0.75f;
    private static final float BILINEAR_EDGE_GUARD_M = 0.15f;
    private static final int MIN_VALID_DEPTH_PIXELS = 12;
    private static final int MAX_MESH_GRID_DIM = 24;
    private static final int MAX_TRI_VERTICES = 3456;
    private static final int CONTOUR_SECTORS = 48;
    private static final int MAX_FUSE_DEPTH_POINTS = 1200;

    private DepthMaskFuser() {}

    public static final class FusedTargetSurface {
        public final TargetVolumeConstraint constraint;
        public final float[] triVerticesXyz;
        public final float[] contourLoopXyz;
        /** Filtered GL_LINES vertex pairs (x0,y0,z0, x1,y1,z1) breaking 3D jumps > 0.25 m. */
        public final float[] contourSegmentsXyz;
        public final List<float[]> depthPointsM;
        public final boolean usedDepth;
        public final float estimatedRadiusM;
        public final float estimatedHeightM;

        public FusedTargetSurface(
            final TargetVolumeConstraint constraint,
            final float[] triVerticesXyz,
            final float[] contourLoopXyz,
            final List<float[]> depthPointsM,
            final boolean usedDepth,
            final float estimatedRadiusM,
            final float estimatedHeightM
        ) {
            this(
                constraint,
                triVerticesXyz,
                contourLoopXyz,
                buildContourSegmentsFromLoop(contourLoopXyz),
                depthPointsM,
                usedDepth,
                estimatedRadiusM,
                estimatedHeightM
            );
        }

        public FusedTargetSurface(
            final TargetVolumeConstraint constraint,
            final float[] triVerticesXyz,
            final float[] contourLoopXyz,
            final float[] contourSegmentsXyz,
            final List<float[]> depthPointsM,
            final boolean usedDepth,
            final float estimatedRadiusM,
            final float estimatedHeightM
        ) {
            this.constraint = constraint != null ? constraint : TargetVolumeConstraint.inactive();
            this.triVerticesXyz = triVerticesXyz != null ? triVerticesXyz : new float[0];
            this.contourLoopXyz = contourLoopXyz != null ? contourLoopXyz : new float[0];
            this.contourSegmentsXyz = contourSegmentsXyz != null ? contourSegmentsXyz : new float[0];
            this.depthPointsM = depthPointsM != null ? depthPointsM : Collections.emptyList();
            this.usedDepth = usedDepth;
            this.estimatedRadiusM = estimatedRadiusM;
            this.estimatedHeightM = estimatedHeightM;
        }
    }

    /**
     * Fuses a 2D foreground confidence mask (maskW x maskH) with optional 16-bit millimeter depth
     * (depthW x depthH) into a 3D frontal surface mesh, 3D perimeter loop, auto-sized TargetVolumeConstraint,
     * and floor/neighbor-free 3D depth points.
     *
     * Intrinsics (fx, fy, cx, cy) are expressed in mask pixel coordinates (maskW x maskH); depthMm and
     * depthConf are resampled from normalized mask coordinates (u / maskW, v / maskH) to (depthW, depthH).
     */
    public static FusedTargetSurface fuse(
        final byte[] maskConf,
        final int maskW,
        final int maskH,
        final short[] depthMm,
        final byte[] depthConf,
        final int depthW,
        final int depthH,
        final float fx,
        final float fy,
        final float cx,
        final float cy,
        final float[] cameraToWorldColMajor16,
        final float groundY,
        final float anchorX,
        final float anchorY,
        final float anchorZ,
        final float tapNormX,
        final float tapNormY,
        final TargetVolumeConstraint existingConstraint
    ) {
        final TargetVolumeConstraint baseConstraint = existingConstraint != null
            ? existingConstraint
            : TargetVolumeConstraint.inactive();
        final float effGroundY = baseConstraint.hasPadReferenceY
            ? baseConstraint.padReferenceY
            : (Float.isFinite(groundY) ? groundY : (Float.isFinite(anchorY) ? anchorY : 0.0f));

        if (
            maskConf == null ||
            maskW <= 0 ||
            maskH <= 0 ||
            maskConf.length < maskW * maskH ||
            cameraToWorldColMajor16 == null ||
            cameraToWorldColMajor16.length < 16 ||
            !Float.isFinite(fx) ||
            !Float.isFinite(fy) ||
            fx <= 1e-3f ||
            fy <= 1e-3f
        ) {
            final float fallbackR = baseConstraint.active
                ? baseConstraint.radiusM
                : TargetVolumeConstraint.DEFAULT_RADIUS_M;
            final float fallbackH = baseConstraint.heightEstM;
            final TargetVolumeConstraint c = baseConstraint.withAutoBounds(
                anchorX,
                effGroundY,
                anchorZ,
                fallbackR,
                fallbackH
            );
            return new FusedTargetSurface(
                c,
                new float[0],
                new float[0],
                Collections.emptyList(),
                false,
                c.radiusM,
                c.heightEstM
            );
        }

        final float safeTapX = Float.isFinite(tapNormX) ? clamp(tapNormX, 0.0f, 1.0f) : 0.5f;
        final float safeTapY = Float.isFinite(tapNormY) ? clamp(tapNormY, 0.0f, 1.0f) : 0.5f;
        final int seedU = clampInt(Math.round(safeTapX * (maskW - 1)), 0, maskW - 1);
        final int seedV = clampInt(Math.round(safeTapY * (maskH - 1)), 0, maskH - 1);

        final boolean hasDepthInput =
            depthMm != null &&
            depthW > 0 &&
            depthH > 0 &&
            depthMm.length >= depthW * depthH;
        final boolean hasDepthConf =
            hasDepthInput &&
            depthConf != null &&
            depthConf.length >= depthW * depthH;

        if (hasDepthInput) {
            final int nMask = maskW * maskH;
            final boolean[] hasDepthPixel = new boolean[nMask];
            final boolean[] valid = new boolean[nMask];
            final float[] depthArr = new float[nMask];
            final float[] worldX = new float[nMask];
            final float[] worldY = new float[nMask];
            final float[] worldZ = new float[nMask];

            final float m0 = cameraToWorldColMajor16[0];
            final float m1 = cameraToWorldColMajor16[1];
            final float m2 = cameraToWorldColMajor16[2];
            final float m4 = cameraToWorldColMajor16[4];
            final float m5 = cameraToWorldColMajor16[5];
            final float m6 = cameraToWorldColMajor16[6];
            final float m8 = cameraToWorldColMajor16[8];
            final float m9 = cameraToWorldColMajor16[9];
            final float m10 = cameraToWorldColMajor16[10];
            final float m12 = cameraToWorldColMajor16[12];
            final float m13 = cameraToWorldColMajor16[13];
            final float m14 = cameraToWorldColMajor16[14];

            final float invFx = 1.0f / fx;
            final float invFy = 1.0f / fy;
            final float minValidWorldY = effGroundY + FLOOR_CLEARANCE_FUSE_M;

            final boolean useUniformCrop =
                Math.abs(((float) maskW / (float) maskH) - ((float) depthW / (float) depthH)) > ASPECT_RATIO_CROP_EPS;
            final float uniformScale = useUniformCrop
                ? computeUniformCropScale(maskW, maskH, depthW, depthH)
                : 1.0f;

            int totalMaskWithDepth = 0;
            int floorRejectedCount = 0;
            int validTotal = 0;
            for (int v = 0; v < maskH; v++) {
                final int rowOff = v * maskW;
                final float fdv = useUniformCrop
                    ? mapCoordUniform(v, maskH, depthH, uniformScale)
                    : (((v + 0.5f) * depthH) / (float) maskH - 0.5f);
                if (fdv < -0.5f || fdv > depthH - 0.5f) {
                    continue;
                }
                for (int u = 0; u < maskW; u++) {
                    final int idx = rowOff + u;
                    if ((maskConf[idx] & 0xFF) < MASK_THRESHOLD) {
                        continue;
                    }
                    final float fdu = useUniformCrop
                        ? mapCoordUniform(u, maskW, depthW, uniformScale)
                        : (((u + 0.5f) * depthW) / (float) maskW - 0.5f);
                    if (fdu < -0.5f || fdu > depthW - 0.5f) {
                        continue;
                    }
                    final float dM = sampleDepthEdgePreserving(
                        depthMm,
                        hasDepthConf ? depthConf : null,
                        depthW,
                        depthH,
                        fdu,
                        fdv,
                        FUSE_DEPTH_CONF_MIN
                    );
                    if (dM < MIN_DEPTH_M || dM > MAX_DEPTH_M) {
                        continue;
                    }

                    final float xc = (u - cx) * invFx * dM;
                    final float yc = -(v - cy) * invFy * dM;
                    final float zc = -dM;

                    final float wx = m0 * xc + m4 * yc + m8 * zc + m12;
                    final float wy = m1 * xc + m5 * yc + m9 * zc + m13;
                    final float wz = m2 * xc + m6 * yc + m10 * zc + m14;

                    if (!Float.isFinite(wx) || !Float.isFinite(wy) || !Float.isFinite(wz)) {
                        continue;
                    }

                    hasDepthPixel[idx] = true;
                    depthArr[idx] = dM;
                    worldX[idx] = wx;
                    worldY[idx] = wy;
                    worldZ[idx] = wz;
                    totalMaskWithDepth++;

                    if (wy <= minValidWorldY) {
                        floorRejectedCount++;
                        continue;
                    }

                    valid[idx] = true;
                    validTotal++;
                }
            }

            float usedGroundY = effGroundY;
            // If > 80% of mask depth pixels were discarded by an overestimated floor elevation,
            // relax the floor cutoff using the minimum wy of the tap's depth-connected component.
            if (
                totalMaskWithDepth >= MIN_VALID_DEPTH_PIXELS &&
                floorRejectedCount > totalMaskWithDepth * FLOOR_RELAX_REJECT_RATIO
            ) {
                final byte[] tapTmpMask = new byte[nMask];
                final int[] tapComp = extractConnectedDepthComponent(
                    hasDepthPixel,
                    depthArr,
                    maskW,
                    maskH,
                    seedU,
                    seedV,
                    tapTmpMask
                );
                if (tapComp != null && tapComp.length >= MIN_VALID_DEPTH_PIXELS) {
                    float minCompY = Float.MAX_VALUE;
                    for (int idx : tapComp) {
                        if (worldY[idx] < minCompY) {
                            minCompY = worldY[idx];
                        }
                    }
                    if (Float.isFinite(minCompY)) {
                        usedGroundY = minCompY;
                        final float relaxedMinY = minCompY + 0.015f;
                        Arrays.fill(valid, false);
                        validTotal = 0;
                        for (int idx : tapComp) {
                            if (worldY[idx] > relaxedMinY) {
                                valid[idx] = true;
                                validTotal++;
                            }
                        }
                    }
                }
            }

            if (validTotal >= MIN_VALID_DEPTH_PIXELS) {
                final byte[] bfsMask = new byte[nMask];
                final int[] bfsPixels = extractConnectedDepthComponent(
                    valid,
                    depthArr,
                    maskW,
                    maskH,
                    seedU,
                    seedV,
                    bfsMask
                );
                if (bfsPixels != null && bfsPixels.length >= MIN_VALID_DEPTH_PIXELS) {
                    return buildDepthFusedResult(
                        bfsPixels,
                        bfsMask,
                        depthArr,
                        worldX,
                        worldY,
                        worldZ,
                        maskW,
                        maskH,
                        cameraToWorldColMajor16,
                        usedGroundY,
                        baseConstraint
                    );
                }
            }
        }

        // No-Depth fallback: estimate real metric radius & height from mask pixel extents + anchor distance
        return buildNoDepthFallbackResult(
            maskConf,
            maskW,
            maskH,
            fx,
            fy,
            cameraToWorldColMajor16,
            effGroundY,
            anchorX,
            anchorY,
            anchorZ,
            seedU,
            seedV,
            baseConstraint
        );
    }

    /**
     * Extracts filtered 3D world points from ARCore 16-bit millimeter raw depth images.
     *
     * Intrinsics (fx, fy, cx, cy) are expressed in depth image pixel coordinates (depthW x depthH).
     * When maskConf != null, mask pixels are resampled from (u / depthW, v / depthH) to (maskW, maskH).
     */
    public static List<float[]> extractFilteredDepthPoints(
        final byte[] maskConf,
        final int maskW,
        final int maskH,
        final short[] depthMm,
        final byte[] depthConf,
        final int depthW,
        final int depthH,
        final float fx,
        final float fy,
        final float cx,
        final float cy,
        final float[] cameraToWorldColMajor16,
        final float groundY,
        final TargetVolumeConstraint constraint,
        final int stridePx,
        final int maxPoints
    ) {
        if (
            depthMm == null ||
            depthW <= 0 ||
            depthH <= 0 ||
            depthMm.length < depthW * depthH ||
            cameraToWorldColMajor16 == null ||
            cameraToWorldColMajor16.length < 16 ||
            !Float.isFinite(fx) ||
            !Float.isFinite(fy) ||
            fx <= 1e-3f ||
            fy <= 1e-3f ||
            maxPoints <= 0
        ) {
            return Collections.emptyList();
        }

        final int step = Math.max(1, stridePx);
        final boolean hasMask = maskConf != null && maskW > 0 && maskH > 0 && maskConf.length >= maskW * maskH;
        final boolean hasConf = depthConf != null && depthConf.length >= depthW * depthH;
        final boolean hasConstraint = constraint != null && constraint.active;
        final boolean hasGround =
            (constraint != null && constraint.hasPadReferenceY) || Float.isFinite(groundY);
        final float effGroundY = (constraint != null && constraint.hasPadReferenceY)
            ? constraint.padReferenceY
            : (Float.isFinite(groundY) ? groundY : 0.0f);
        final float minWy = effGroundY + FLOOR_CLEARANCE_EXTRACT_M;
        final float maxWy = hasConstraint && hasGround
            ? effGroundY + Math.max(
                2.0f,
                constraint.heightEstM > 0.05f
                    ? constraint.heightEstM * 1.40f
                    : constraint.getEffectiveRadiusM() * 2.0f
            )
            : Float.MAX_VALUE;

        final float m0 = cameraToWorldColMajor16[0];
        final float m1 = cameraToWorldColMajor16[1];
        final float m2 = cameraToWorldColMajor16[2];
        final float m4 = cameraToWorldColMajor16[4];
        final float m5 = cameraToWorldColMajor16[5];
        final float m6 = cameraToWorldColMajor16[6];
        final float m8 = cameraToWorldColMajor16[8];
        final float m9 = cameraToWorldColMajor16[9];
        final float m10 = cameraToWorldColMajor16[10];
        final float m12 = cameraToWorldColMajor16[12];
        final float m13 = cameraToWorldColMajor16[13];
        final float m14 = cameraToWorldColMajor16[14];

        final float invFx = 1.0f / fx;
        final float invFy = 1.0f / fy;

        // Erode 2D mask inward by 2 px before sampling depth to eliminate mixed silhouette edge pixels
        final boolean[] erodedMask = hasMask ? erodeMaskInward(maskConf, maskW, maskH, 2) : null;
        final boolean useUniformCrop = hasMask &&
            Math.abs(((float) maskW / (float) maskH) - ((float) depthW / (float) depthH)) > ASPECT_RATIO_CROP_EPS;
        final float uniformScale = useUniformCrop
            ? computeUniformCropScale(depthW, depthH, maskW, maskH)
            : 1.0f;

        final List<float[]> collected = new ArrayList<>(Math.min(maxPoints * 2, 4096));
        for (int v = 0; v < depthH; v += step) {
            final int rowOff = v * depthW;
            final int mv;
            if (hasMask) {
                final float fmv = useUniformCrop
                    ? mapCoordUniform(v, depthH, maskH, uniformScale)
                    : (((v + 0.5f) * maskH) / (float) depthH - 0.5f);
                mv = Math.round(fmv);
                if (mv < 0 || mv >= maskH) {
                    continue;
                }
            } else {
                mv = 0;
            }
            final int maskRowOff = mv * maskW;
            for (int u = 0; u < depthW; u += step) {
                final int idx = rowOff + u;
                if (hasConf && (depthConf[idx] & 0xFF) < EXTRACT_DEPTH_CONF_MIN) {
                    continue;
                }
                final int dMm = depthMm[idx] & 0xFFFF;
                if (dMm <= 0) {
                    continue;
                }
                final float dM = dMm * 0.001f;
                if (dM < MIN_DEPTH_M || dM > MAX_DEPTH_M) {
                    continue;
                }
                if (hasMask) {
                    final float fmu = useUniformCrop
                        ? mapCoordUniform(u, depthW, maskW, uniformScale)
                        : (((u + 0.5f) * maskW) / (float) depthW - 0.5f);
                    final int mu = Math.round(fmu);
                    if (mu < 0 || mu >= maskW || !erodedMask[maskRowOff + mu]) {
                        continue;
                    }
                }
                // Anti edge-bleeding / flying-pixel filter: reject any pixel with depth jump > max(0.06, 0.05*d)
                // against any of its 4-connected neighbors
                if (hasDepthJumpTo4Neighbors(depthMm, hasConf ? depthConf : null, depthW, depthH, u, v, dM)) {
                    continue;
                }

                final float xc = (u - cx) * invFx * dM;
                final float yc = -(v - cy) * invFy * dM;
                final float zc = -dM;

                final float wx = m0 * xc + m4 * yc + m8 * zc + m12;
                final float wy = m1 * xc + m5 * yc + m9 * zc + m13;
                final float wz = m2 * xc + m6 * yc + m10 * zc + m14;

                if (!Float.isFinite(wx) || !Float.isFinite(wy) || !Float.isFinite(wz)) {
                    continue;
                }
                if (hasGround && wy <= minWy) {
                    continue;
                }
                if (hasConstraint) {
                    if (!constraint.containsXZ(wx, wz, 1.05f) || wy > maxWy) {
                        continue;
                    }
                }
                collected.add(new float[] { wx, wy, wz, 1.0f });
            }
        }

        if (collected.size() <= maxPoints) {
            return collected;
        }
        // Uniformly subsample so top and bottom of target object are evenly represented
        final List<float[]> subsampled = new ArrayList<>(maxPoints);
        final double ratio = collected.size() / (double) maxPoints;
        for (int i = 0; i < maxPoints; i++) {
            final int srcIdx = Math.min(collected.size() - 1, (int) Math.floor(i * ratio));
            subsampled.add(collected.get(srcIdx));
        }
        return subsampled;
    }

    private static float sampleDepthEdgePreserving(
        final short[] depthMm,
        final byte[] depthConf,
        final int depthW,
        final int depthH,
        final float fdu,
        final float fdv,
        final int minConf
    ) {
        final int nu = clampInt(Math.round(fdu), 0, depthW - 1);
        final int nv = clampInt(Math.round(fdv), 0, depthH - 1);
        final float dNearest = readValidDepthM(depthMm, depthConf, depthW, nu, nv, minConf);
        if (dNearest <= 0.0f) {
            return -1.0f;
        }

        final int u0 = clampInt((int) Math.floor(fdu), 0, depthW - 1);
        final int v0 = clampInt((int) Math.floor(fdv), 0, depthH - 1);
        final int u1 = Math.min(depthW - 1, u0 + 1);
        final int v1 = Math.min(depthH - 1, v0 + 1);
        if (u0 == u1 && v0 == v1) {
            return dNearest;
        }

        final float d00 = readValidDepthM(depthMm, depthConf, depthW, u0, v0, minConf);
        final float d10 = readValidDepthM(depthMm, depthConf, depthW, u1, v0, minConf);
        final float d01 = readValidDepthM(depthMm, depthConf, depthW, u0, v1, minConf);
        final float d11 = readValidDepthM(depthMm, depthConf, depthW, u1, v1, minConf);
        if (
            d00 <= 0.0f ||
            d10 <= 0.0f ||
            d01 <= 0.0f ||
            d11 <= 0.0f ||
            Math.abs(d00 - dNearest) > BILINEAR_EDGE_GUARD_M ||
            Math.abs(d10 - dNearest) > BILINEAR_EDGE_GUARD_M ||
            Math.abs(d01 - dNearest) > BILINEAR_EDGE_GUARD_M ||
            Math.abs(d11 - dNearest) > BILINEAR_EDGE_GUARD_M
        ) {
            return dNearest;
        }

        final float tx = clamp(fdu - u0, 0.0f, 1.0f);
        final float ty = clamp(fdv - v0, 0.0f, 1.0f);
        final float top = d00 + (d10 - d00) * tx;
        final float bot = d01 + (d11 - d01) * tx;
        return top + (bot - top) * ty;
    }

    private static float readValidDepthM(
        final short[] depthMm,
        final byte[] depthConf,
        final int depthW,
        final int u,
        final int v,
        final int minConf
    ) {
        final int idx = v * depthW + u;
        if (depthConf != null && (depthConf[idx] & 0xFF) < minConf) {
            return -1.0f;
        }
        final int mm = depthMm[idx] & 0xFFFF;
        if (mm <= 0) {
            return -1.0f;
        }
        final float dM = mm * 0.001f;
        return (dM >= MIN_DEPTH_M && dM <= MAX_DEPTH_M) ? dM : -1.0f;
    }

    /**
     * Runs 4-neighbor BFS starting from (seedU, seedV) (snapping to the nearest valid depth pixel if needed)
     * with depth discontinuity guard |deltaD| < 0.25 m. Marks winning pixels in outBfsMask and returns indices.
     */
    private static int[] extractConnectedDepthComponent(
        final boolean[] valid,
        final float[] depthArr,
        final int maskW,
        final int maskH,
        final int seedU,
        final int seedV,
        final byte[] outBfsMask
    ) {
        final int n = maskW * maskH;
        final boolean[] visited = new boolean[n];
        final int[] queue = new int[n];
        final int maxSearchR = Math.max(12, Math.min(maskW, maskH) / 4);

        for (int attempt = 0; attempt < 4; attempt++) {
            final int startIdx = findNearestUnvisitedValid(valid, visited, maskW, maskH, seedU, seedV, attempt == 0 ? maxSearchR : maxSearchR / 2);
            if (startIdx < 0) {
                break;
            }
            int head = 0;
            int tail = 0;
            visited[startIdx] = true;
            queue[tail++] = startIdx;

            while (head < tail) {
                final int cur = queue[head++];
                final float curD = depthArr[cur];
                final int cu = cur % maskW;
                final int cv = cur / maskW;

                if (cu > 0) {
                    final int ni = cur - 1;
                    if (!visited[ni] && valid[ni] && Math.abs(depthArr[ni] - curD) < BFS_MAX_DEPTH_STEP_M) {
                        visited[ni] = true;
                        queue[tail++] = ni;
                    }
                }
                if (cu + 1 < maskW) {
                    final int ni = cur + 1;
                    if (!visited[ni] && valid[ni] && Math.abs(depthArr[ni] - curD) < BFS_MAX_DEPTH_STEP_M) {
                        visited[ni] = true;
                        queue[tail++] = ni;
                    }
                }
                if (cv > 0) {
                    final int ni = cur - maskW;
                    if (!visited[ni] && valid[ni] && Math.abs(depthArr[ni] - curD) < BFS_MAX_DEPTH_STEP_M) {
                        visited[ni] = true;
                        queue[tail++] = ni;
                    }
                }
                if (cv + 1 < maskH) {
                    final int ni = cur + maskW;
                    if (!visited[ni] && valid[ni] && Math.abs(depthArr[ni] - curD) < BFS_MAX_DEPTH_STEP_M) {
                        visited[ni] = true;
                        queue[tail++] = ni;
                    }
                }
            }

            if (tail >= MIN_VALID_DEPTH_PIXELS) {
                for (int i = 0; i < tail; i++) {
                    outBfsMask[queue[i]] = 1;
                }
                return Arrays.copyOf(queue, tail);
            }
        }
        return null;
    }

    private static int findNearestUnvisitedValid(
        final boolean[] valid,
        final boolean[] visited,
        final int w,
        final int h,
        final int seedU,
        final int seedV,
        final int maxRadius
    ) {
        final int direct = seedV * w + seedU;
        if (valid[direct] && !visited[direct]) {
            return direct;
        }
        int bestIdx = -1;
        int bestDistSq = Integer.MAX_VALUE;
        final int v0 = Math.max(0, seedV - maxRadius);
        final int v1 = Math.min(h - 1, seedV + maxRadius);
        final int u0 = Math.max(0, seedU - maxRadius);
        final int u1 = Math.min(w - 1, seedU + maxRadius);
        for (int v = v0; v <= v1; v++) {
            final int dv = v - seedV;
            final int dvSq = dv * dv;
            final int rowOff = v * w;
            for (int u = u0; u <= u1; u++) {
                final int idx = rowOff + u;
                if (!valid[idx] || visited[idx]) {
                    continue;
                }
                final int du = u - seedU;
                final int dSq = du * du + dvSq;
                if (dSq < bestDistSq) {
                    bestDistSq = dSq;
                    bestIdx = idx;
                }
            }
        }
        if (bestIdx >= 0) {
            return bestIdx;
        }
        // Global fallback if tap was slightly outside mask bounds
        for (int v = 0; v < h; v++) {
            final int dv = v - seedV;
            final int dvSq = dv * dv;
            final int rowOff = v * w;
            for (int u = 0; u < w; u++) {
                final int idx = rowOff + u;
                if (!valid[idx] || visited[idx]) {
                    continue;
                }
                final int du = u - seedU;
                final int dSq = du * du + dvSq;
                if (dSq < bestDistSq) {
                    bestDistSq = dSq;
                    bestIdx = idx;
                }
            }
        }
        return bestIdx;
    }

    private static FusedTargetSurface buildDepthFusedResult(
        final int[] rawBfsPixels,
        final byte[] rawBfsMask,
        final float[] depthArr,
        final float[] worldX,
        final float[] worldY,
        final float[] worldZ,
        final int maskW,
        final int maskH,
        final float[] cameraToWorldColMajor16,
        final float effGroundY,
        final TargetVolumeConstraint baseConstraint
    ) {
        // Stage 1: Depth outlier rejection (|d - medianD| > max(0.35 m, 0.25 * medianD))
        int[] bfsPixels = rawBfsPixels;
        final int rawCount = rawBfsPixels.length;
        if (rawCount >= MIN_VALID_DEPTH_PIXELS) {
            final float[] sortedD = new float[rawCount];
            for (int i = 0; i < rawCount; i++) {
                sortedD[i] = depthArr[rawBfsPixels[i]];
            }
            Arrays.sort(sortedD);
            final float medianD = sortedD[rawCount / 2];
            final float maxDepthDev = Math.max(0.35f, 0.25f * medianD);
            final int[] depthFiltered = new int[rawCount];
            int dKeep = 0;
            for (int i = 0; i < rawCount; i++) {
                final int idx = rawBfsPixels[i];
                if (Math.abs(depthArr[idx] - medianD) <= maxDepthDev) {
                    depthFiltered[dKeep++] = idx;
                }
            }
            if (dKeep >= MIN_VALID_DEPTH_PIXELS && dKeep < rawCount) {
                bfsPixels = Arrays.copyOf(depthFiltered, dKeep);
            }
        }

        // Stage 2: Radial outlier rejection (r > 1.45 * p80R when count >= 30) to eliminate shadow/edge tails
        if (bfsPixels.length >= 30) {
            double preSumX = 0.0;
            double preSumZ = 0.0;
            final int nCur = bfsPixels.length;
            for (int i = 0; i < nCur; i++) {
                final int idx = bfsPixels[i];
                preSumX += worldX[idx];
                preSumZ += worldZ[idx];
            }
            final float preCx = (float) (preSumX / nCur);
            final float preCz = (float) (preSumZ / nCur);
            final float[] preR = new float[nCur];
            for (int i = 0; i < nCur; i++) {
                final int idx = bfsPixels[i];
                preR[i] = (float) Math.hypot(worldX[idx] - preCx, worldZ[idx] - preCz);
            }
            final float[] sortedPreR = Arrays.copyOf(preR, nCur);
            Arrays.sort(sortedPreR);
            final float p80R = sortedPreR[Math.min(nCur - 1, (int) Math.floor((nCur - 1) * 0.80))];
            if (p80R > 1e-4f) {
                final float maxAllowedR = 1.45f * p80R;
                final int[] radFiltered = new int[nCur];
                int rKeep = 0;
                for (int i = 0; i < nCur; i++) {
                    if (preR[i] <= maxAllowedR) {
                        radFiltered[rKeep++] = bfsPixels[i];
                    }
                }
                if (rKeep >= MIN_VALID_DEPTH_PIXELS && rKeep < nCur) {
                    bfsPixels = Arrays.copyOf(radFiltered, rKeep);
                }
            }
        }

        final int count = bfsPixels.length;
        final byte[] bfsMask;
        if (count < rawCount) {
            bfsMask = new byte[maskW * maskH];
            for (int i = 0; i < count; i++) {
                bfsMask[bfsPixels[i]] = 1;
            }
        } else {
            bfsMask = rawBfsMask;
        }

        double sumWx = 0.0;
        double sumWz = 0.0;
        double sumU = 0.0;
        double sumV = 0.0;
        int minU = maskW - 1;
        int maxU = 0;
        int minV = maskH - 1;
        int maxV = 0;

        for (int i = 0; i < count; i++) {
            final int idx = bfsPixels[i];
            sumWx += worldX[idx];
            sumWz += worldZ[idx];
            final int u = idx % maskW;
            final int v = idx / maskW;
            sumU += u;
            sumV += v;
            if (u < minU) minU = u;
            if (u > maxU) maxU = u;
            if (v < minV) minV = v;
            if (v > maxV) maxV = v;
        }

        final float frontCentroidX = (float) (sumWx / count);
        final float frontCentroidZ = (float) (sumWz / count);
        final float centroidU = (float) (sumU / count);
        final float centroidV = (float) (sumV / count);

        final float[] radii = new float[count];
        final float[] heights = new float[count];
        for (int i = 0; i < count; i++) {
            final int idx = bfsPixels[i];
            radii[i] = (float) Math.hypot(worldX[idx] - frontCentroidX, worldZ[idx] - frontCentroidZ);
            heights[i] = Math.max(0.0f, worldY[idx] - effGroundY);
        }
        Arrays.sort(radii);
        Arrays.sort(heights);

        // Use p85R (immune to shadow tails inflating p95R) scaled by 1/0.85 to recover full frontal-skin radius
        final float p85R = radii[Math.min(count - 1, (int) Math.floor((count - 1) * 0.85))];
        final float p98H = heights[Math.min(count - 1, (int) Math.floor((count - 1) * 0.98))];

        final float rApp = clamp(
            p85R / 0.85f,
            TargetVolumeConstraint.MIN_RADIUS_M,
            TargetVolumeConstraint.MAX_RADIUS_M
        );
        // Push estimated volumetric center inward from the frontal skin along the horizontal camera->surface ray
        final float camX = cameraToWorldColMajor16[12];
        final float camZ = cameraToWorldColMajor16[14];
        final float rayDx = frontCentroidX - camX;
        final float rayDz = frontCentroidZ - camZ;
        final float rayLen = (float) Math.hypot(rayDx, rayDz);
        final float volCenterX = rayLen > 1e-3f
            ? frontCentroidX + (INWARD_CENTER_PUSH_FACTOR * rApp) * (rayDx / rayLen)
            : frontCentroidX;
        final float volCenterZ = rayLen > 1e-3f
            ? frontCentroidZ + (INWARD_CENTER_PUSH_FACTOR * rApp) * (rayDz / rayLen)
            : frontCentroidZ;

        // Generous search ROI radius (never a tight frontal-skin guillotine)
        final float roiRadiusM = clamp(
            Math.max(1.8f * rApp, rApp + 0.35f),
            TargetVolumeConstraint.MIN_RADIUS_M,
            TargetVolumeConstraint.MAX_RADIUS_M
        );
        final float estimatedHeightM = clamp(p98H, 0.10f, 15.0f);

        final float[] triVerticesXyz = buildFrontalMeshTriangles(
            bfsMask,
            depthArr,
            worldX,
            worldY,
            worldZ,
            maskW,
            maskH,
            minU,
            maxU,
            minV,
            maxV
        );

        final float[] contourLoopXyz = buildContourLoop3D(
            bfsPixels,
            bfsMask,
            worldX,
            worldY,
            worldZ,
            maskW,
            maskH,
            centroidU,
            centroidV
        );
        final float[] contourSegmentsXyz = buildContourSegmentsFromLoop(contourLoopXyz);

        final int outPtsCount = Math.min(count, MAX_FUSE_DEPTH_POINTS);
        final List<float[]> depthPointsM = new ArrayList<>(outPtsCount);
        final double ptRatio = count / (double) outPtsCount;
        for (int i = 0; i < outPtsCount; i++) {
            final int idx = bfsPixels[Math.min(count - 1, (int) Math.floor(i * ptRatio))];
            depthPointsM.add(new float[] { worldX[idx], worldY[idx], worldZ[idx], 1.0f });
        }

        final TargetVolumeConstraint constraint = baseConstraint.withAutoBounds(
            volCenterX,
            effGroundY,
            volCenterZ,
            roiRadiusM,
            estimatedHeightM
        );

        return new FusedTargetSurface(
            constraint,
            triVerticesXyz,
            contourLoopXyz,
            contourSegmentsXyz,
            depthPointsM,
            true,
            rApp,
            estimatedHeightM
        );
    }

    /**
     * Subsamples the BFS bounding box onto a <= 24x24 grid (<= 576 nodes) and emits
     * depth-continuous GL_TRIANGLES vertex coordinates (triVerticesXyz).
     */
    private static float[] buildFrontalMeshTriangles(
        final byte[] bfsMask,
        final float[] depthArr,
        final float[] worldX,
        final float[] worldY,
        final float[] worldZ,
        final int maskW,
        final int maskH,
        final int minU,
        final int maxU,
        final int minV,
        final int maxV
    ) {
        final int spanU = maxU - minU + 1;
        final int spanV = maxV - minV + 1;
        if (spanU < 2 || spanV < 2) {
            return new float[0];
        }
        final int gW = Math.min(MAX_MESH_GRID_DIM, spanU);
        final int gH = Math.min(MAX_MESH_GRID_DIM, spanV);
        final int gridNodes = gW * gH;

        final int[] nodeSrcIdx = new int[gridNodes];
        Arrays.fill(nodeSrcIdx, -1);

        for (int gr = 0; gr < gH; gr++) {
            final int v = gH > 1
                ? minV + Math.round((gr * (spanV - 1)) / (float) (gH - 1))
                : minV;
            for (int gc = 0; gc < gW; gc++) {
                final int u = gW > 1
                    ? minU + Math.round((gc * (spanU - 1)) / (float) (gW - 1))
                    : minU;
                final int idx = v * maskW + u;
                if (bfsMask[idx] != 0) {
                    nodeSrcIdx[gr * gW + gc] = idx;
                } else {
                    // 1-pixel snap inside BFS so jagged borders still close cleanly
                    nodeSrcIdx[gr * gW + gc] = findNeighborBfsPixel(bfsMask, maskW, maskH, u, v);
                }
            }
        }

        final float[] tmp = new float[MAX_TRI_VERTICES * 3];
        int outFloats = 0;
        final int maxFloats = MAX_TRI_VERTICES * 3;

        for (int gr = 0; gr < gH - 1 && outFloats + 18 <= maxFloats; gr++) {
            for (int gc = 0; gc < gW - 1 && outFloats + 18 <= maxFloats; gc++) {
                final int i00 = nodeSrcIdx[gr * gW + gc];
                final int i10 = nodeSrcIdx[gr * gW + gc + 1];
                final int i01 = nodeSrcIdx[(gr + 1) * gW + gc];
                final int i11 = nodeSrcIdx[(gr + 1) * gW + gc + 1];

                final int validCorners =
                    (i00 >= 0 ? 1 : 0) +
                    (i10 >= 0 ? 1 : 0) +
                    (i01 >= 0 ? 1 : 0) +
                    (i11 >= 0 ? 1 : 0);
                if (validCorners < 3) {
                    continue;
                }

                if (validCorners == 4) {
                    if (isTriangleDepthContinuous(depthArr, worldX, worldY, worldZ, i00, i01, i10)) {
                        outFloats = emitTriangle(tmp, outFloats, worldX, worldY, worldZ, i00, i01, i10);
                    }
                    if (isTriangleDepthContinuous(depthArr, worldX, worldY, worldZ, i10, i01, i11)) {
                        outFloats = emitTriangle(tmp, outFloats, worldX, worldY, worldZ, i10, i01, i11);
                    }
                } else if (i00 >= 0 && i01 >= 0 && i10 >= 0) {
                    if (isTriangleDepthContinuous(depthArr, worldX, worldY, worldZ, i00, i01, i10)) {
                        outFloats = emitTriangle(tmp, outFloats, worldX, worldY, worldZ, i00, i01, i10);
                    }
                } else if (i10 >= 0 && i01 >= 0 && i11 >= 0) {
                    if (isTriangleDepthContinuous(depthArr, worldX, worldY, worldZ, i10, i01, i11)) {
                        outFloats = emitTriangle(tmp, outFloats, worldX, worldY, worldZ, i10, i01, i11);
                    }
                } else if (i00 >= 0 && i01 >= 0 && i11 >= 0) {
                    if (isTriangleDepthContinuous(depthArr, worldX, worldY, worldZ, i00, i01, i11)) {
                        outFloats = emitTriangle(tmp, outFloats, worldX, worldY, worldZ, i00, i01, i11);
                    }
                } else if (i00 >= 0 && i10 >= 0 && i11 >= 0) {
                    if (isTriangleDepthContinuous(depthArr, worldX, worldY, worldZ, i00, i10, i11)) {
                        outFloats = emitTriangle(tmp, outFloats, worldX, worldY, worldZ, i00, i10, i11);
                    }
                }
            }
        }

        return Arrays.copyOf(tmp, outFloats);
    }

    private static int findNeighborBfsPixel(
        final byte[] bfsMask,
        final int maskW,
        final int maskH,
        final int u,
        final int v
    ) {
        if (u > 0 && bfsMask[v * maskW + (u - 1)] != 0) return v * maskW + (u - 1);
        if (u + 1 < maskW && bfsMask[v * maskW + (u + 1)] != 0) return v * maskW + (u + 1);
        if (v > 0 && bfsMask[(v - 1) * maskW + u] != 0) return (v - 1) * maskW + u;
        if (v + 1 < maskH && bfsMask[(v + 1) * maskW + u] != 0) return (v + 1) * maskW + u;
        return -1;
    }

    private static boolean isTriangleDepthContinuous(
        final float[] depthArr,
        final float[] worldX,
        final float[] worldY,
        final float[] worldZ,
        final int a,
        final int b,
        final int c
    ) {
        final float da = depthArr[a];
        final float db = depthArr[b];
        final float dc = depthArr[c];
        final float minD = Math.min(da, Math.min(db, dc));
        final float maxD = Math.max(da, Math.max(db, dc));
        if ((maxD - minD) >= BFS_MAX_DEPTH_STEP_M) {
            return false;
        }
        final float maxEdge = Math.max(0.14f, 0.14f * minD);
        final float maxEdgeSq = maxEdge * maxEdge;
        return
            dist3DSq(worldX, worldY, worldZ, a, b) <= maxEdgeSq &&
            dist3DSq(worldX, worldY, worldZ, b, c) <= maxEdgeSq &&
            dist3DSq(worldX, worldY, worldZ, a, c) <= maxEdgeSq;
    }

    private static float dist3DSq(
        final float[] worldX,
        final float[] worldY,
        final float[] worldZ,
        final int a,
        final int b
    ) {
        final float dx = worldX[b] - worldX[a];
        final float dy = worldY[b] - worldY[a];
        final float dz = worldZ[b] - worldZ[a];
        return dx * dx + dy * dy + dz * dz;
    }

    private static int emitTriangle(
        final float[] dst,
        int offset,
        final float[] worldX,
        final float[] worldY,
        final float[] worldZ,
        final int a,
        final int b,
        final int c
    ) {
        dst[offset++] = worldX[a];
        dst[offset++] = worldY[a];
        dst[offset++] = worldZ[a];
        dst[offset++] = worldX[b];
        dst[offset++] = worldY[b];
        dst[offset++] = worldZ[b];
        dst[offset++] = worldX[c];
        dst[offset++] = worldY[c];
        dst[offset++] = worldZ[c];
        return offset;
    }

    /**
     * Builds an angularly ordered 3D silhouette perimeter loop (suitable for GL_LINE_LOOP)
     * from BFS boundary pixels grouped into 48 angular sectors around the 2D mask centroid.
     */
    private static float[] buildContourLoop3D(
        final int[] bfsPixels,
        final byte[] bfsMask,
        final float[] worldX,
        final float[] worldY,
        final float[] worldZ,
        final int maskW,
        final int maskH,
        final float centroidU,
        final float centroidV
    ) {
        final int[] sectorBestIdx = new int[CONTOUR_SECTORS];
        final float[] sectorBestDistSq = new float[CONTOUR_SECTORS];
        Arrays.fill(sectorBestIdx, -1);
        Arrays.fill(sectorBestDistSq, -1.0f);

        final double invSectorRad = CONTOUR_SECTORS / (2.0 * Math.PI);

        for (int idx : bfsPixels) {
            final int u = idx % maskW;
            final int v = idx / maskW;
            final boolean isBoundary =
                u == 0 ||
                u == maskW - 1 ||
                v == 0 ||
                v == maskH - 1 ||
                bfsMask[idx - 1] == 0 ||
                bfsMask[idx + 1] == 0 ||
                bfsMask[idx - maskW] == 0 ||
                bfsMask[idx + maskW] == 0;
            if (!isBoundary) {
                continue;
            }
            final float du = u - centroidU;
            final float dv = v - centroidV;
            final float distSq = du * du + dv * dv;
            double ang = Math.atan2(dv, du);
            if (ang < 0.0) {
                ang += 2.0 * Math.PI;
            }
            final int sec = Math.min(CONTOUR_SECTORS - 1, Math.max(0, (int) Math.floor(ang * invSectorRad)));
            if (distSq > sectorBestDistSq[sec]) {
                sectorBestDistSq[sec] = distSq;
                sectorBestIdx[sec] = idx;
            }
        }

        int count = 0;
        for (int s = 0; s < CONTOUR_SECTORS; s++) {
            if (sectorBestIdx[s] >= 0) {
                count++;
            }
        }
        if (count < 3) {
            return new float[0];
        }

        final float[] loop = new float[count * 3];
        int out = 0;
        for (int s = 0; s < CONTOUR_SECTORS; s++) {
            final int idx = sectorBestIdx[s];
            if (idx >= 0) {
                loop[out++] = worldX[idx];
                loop[out++] = worldY[idx];
                loop[out++] = worldZ[idx];
            }
        }
        return smoothContourLoop3Pt(loop);
    }

    /**
     * Applies 3-point circular smoothing (0.25, 0.50, 0.25) only across continuous neighbors (dist3D <= 0.25 m)
     * so silhouette noise softens without bridging across depth discontinuities.
     */
    private static float[] smoothContourLoop3Pt(final float[] loop) {
        if (loop == null || loop.length < 9) {
            return loop != null ? loop : new float[0];
        }
        final int n = loop.length / 3;
        final float[] smoothed = new float[loop.length];
        final float maxDistSq = CONTOUR_MAX_SEGMENT_DIST_M * CONTOUR_MAX_SEGMENT_DIST_M;
        for (int i = 0; i < n; i++) {
            final int prev = (i + n - 1) % n;
            final int next = (i + 1) % n;
            final float cx = loop[i * 3];
            final float cy = loop[i * 3 + 1];
            final float cz = loop[i * 3 + 2];
            final float px = loop[prev * 3];
            final float py = loop[prev * 3 + 1];
            final float pz = loop[prev * 3 + 2];
            final float nx = loop[next * 3];
            final float ny = loop[next * 3 + 1];
            final float nz = loop[next * 3 + 2];
            final float dPrevSq = (cx - px) * (cx - px) + (cy - py) * (cy - py) + (cz - pz) * (cz - pz);
            final float dNextSq = (cx - nx) * (cx - nx) + (cy - ny) * (cy - ny) + (cz - nz) * (cz - nz);
            if (dPrevSq <= maxDistSq && dNextSq <= maxDistSq) {
                smoothed[i * 3] = 0.25f * px + 0.50f * cx + 0.25f * nx;
                smoothed[i * 3 + 1] = 0.25f * py + 0.50f * cy + 0.25f * ny;
                smoothed[i * 3 + 2] = 0.25f * pz + 0.50f * cz + 0.25f * nz;
            } else {
                smoothed[i * 3] = cx;
                smoothed[i * 3 + 1] = cy;
                smoothed[i * 3 + 2] = cz;
            }
        }
        return smoothed;
    }

    /**
     * Converts an ordered 3D contour loop into GL_LINES vertex pairs (x0,y0,z0, x1,y1,z1),
     * breaking every edge whose 3D Euclidean length exceeds 0.25 m to prevent cross-chords.
     */
    private static float[] buildContourSegmentsFromLoop(final float[] contourLoopXyz) {
        if (contourLoopXyz == null || contourLoopXyz.length < 6) {
            return new float[0];
        }
        final int n = contourLoopXyz.length / 3;
        final float maxDistSq = CONTOUR_MAX_SEGMENT_DIST_M * CONTOUR_MAX_SEGMENT_DIST_M;
        final float[] tmp = new float[n * 6];
        int out = 0;
        for (int i = 0; i < n; i++) {
            final int next = (i + 1) % n;
            final float x0 = contourLoopXyz[i * 3];
            final float y0 = contourLoopXyz[i * 3 + 1];
            final float z0 = contourLoopXyz[i * 3 + 2];
            final float x1 = contourLoopXyz[next * 3];
            final float y1 = contourLoopXyz[next * 3 + 1];
            final float z1 = contourLoopXyz[next * 3 + 2];
            final float dx = x1 - x0;
            final float dy = y1 - y0;
            final float dz = z1 - z0;
            final float distSq = dx * dx + dy * dy + dz * dz;
            if (distSq > 1e-8f && distSq <= maxDistSq) {
                tmp[out++] = x0;
                tmp[out++] = y0;
                tmp[out++] = z0;
                tmp[out++] = x1;
                tmp[out++] = y1;
                tmp[out++] = z1;
            }
        }
        return Arrays.copyOf(tmp, out);
    }

    /**
     * Iterative 4-connected morphological erosion by radiusPx pixels inward from mask background.
     */
    private static boolean[] erodeMaskInward(
        final byte[] maskConf,
        final int w,
        final int h,
        final int radiusPx
    ) {
        final int n = w * h;
        boolean[] cur = new boolean[n];
        for (int i = 0; i < n; i++) {
            cur[i] = (maskConf[i] & 0xFF) >= MASK_THRESHOLD;
        }
        for (int iter = 0; iter < radiusPx; iter++) {
            final boolean[] next = new boolean[n];
            for (int v = 0; v < h; v++) {
                final int rowOff = v * w;
                for (int u = 0; u < w; u++) {
                    final int idx = rowOff + u;
                    if (!cur[idx]) {
                        continue;
                    }
                    final boolean leftOk = (u == 0) || cur[idx - 1];
                    final boolean rightOk = (u + 1 == w) || cur[idx + 1];
                    final boolean upOk = (v == 0) || cur[idx - w];
                    final boolean downOk = (v + 1 == h) || cur[idx + w];
                    if (leftOk && rightOk && upOk && downOk) {
                        next[idx] = true;
                    }
                }
            }
            cur = next;
        }
        return cur;
    }

    /**
     * Anti edge-bleeding / flying-pixel guard: returns true if depth dM differs by more than
     * max(0.06 m, 0.05 * dM) from any valid 4-connected neighbor.
     */
    private static boolean hasDepthJumpTo4Neighbors(
        final short[] depthMm,
        final byte[] depthConf,
        final int w,
        final int h,
        final int u,
        final int v,
        final float dM
    ) {
        final float maxJump = Math.max(0.06f, 0.05f * dM);
        final int idx = v * w + u;
        if (u > 0 && isDepthNeighborJump(depthMm, depthConf, idx - 1, dM, maxJump)) {
            return true;
        }
        if (u + 1 < w && isDepthNeighborJump(depthMm, depthConf, idx + 1, dM, maxJump)) {
            return true;
        }
        if (v > 0 && isDepthNeighborJump(depthMm, depthConf, idx - w, dM, maxJump)) {
            return true;
        }
        if (v + 1 < h && isDepthNeighborJump(depthMm, depthConf, idx + w, dM, maxJump)) {
            return true;
        }
        return false;
    }

    private static boolean isDepthNeighborJump(
        final short[] depthMm,
        final byte[] depthConf,
        final int nIdx,
        final float dM,
        final float maxJump
    ) {
        if (depthConf != null && (depthConf[nIdx] & 0xFF) < EXTRACT_DEPTH_CONF_MIN) {
            return false;
        }
        final int mm = depthMm[nIdx] & 0xFFFF;
        if (mm <= 0) {
            return false;
        }
        final float dnM = mm * 0.001f;
        return Math.abs(dM - dnM) > maxJump;
    }

    private static float computeUniformCropScale(
        final int srcW,
        final int srcH,
        final int dstW,
        final int dstH
    ) {
        if (srcW >= srcH && dstW >= dstH) {
            return (float) dstW / (float) srcW;
        }
        if (srcH > srcW && dstH > dstW) {
            return (float) dstH / (float) srcH;
        }
        return Math.min((float) dstW / (float) srcW, (float) dstH / (float) srcH);
    }

    private static float mapCoordUniform(
        final float srcCoord,
        final int srcDim,
        final int dstDim,
        final float uniformScale
    ) {
        return (srcCoord + 0.5f - 0.5f * srcDim) * uniformScale + 0.5f * dstDim - 0.5f;
    }

    private static FusedTargetSurface buildNoDepthFallbackResult(
        final byte[] maskConf,
        final int maskW,
        final int maskH,
        final float fx,
        final float fy,
        final float[] cameraToWorldColMajor16,
        final float effGroundY,
        final float anchorX,
        final float anchorY,
        final float anchorZ,
        final int seedU,
        final int seedV,
        final TargetVolumeConstraint baseConstraint
    ) {
        final int n = maskW * maskH;
        final boolean[] fg = new boolean[n];
        int fgCount = 0;
        for (int i = 0; i < n; i++) {
            if ((maskConf[i] & 0xFF) >= MASK_THRESHOLD) {
                fg[i] = true;
                fgCount++;
            }
        }

        int minU = maskW - 1;
        int maxU = 0;
        int minV = maskH - 1;
        int maxV = 0;
        int compCount = 0;

        if (fgCount > 0) {
            final boolean[] visited = new boolean[n];
            final int startIdx = findNearestUnvisitedValid(fg, visited, maskW, maskH, seedU, seedV, Math.max(maskW, maskH));
            if (startIdx >= 0) {
                final int[] queue = new int[n];
                int head = 0;
                int tail = 0;
                visited[startIdx] = true;
                queue[tail++] = startIdx;
                while (head < tail) {
                    final int cur = queue[head++];
                    final int u = cur % maskW;
                    final int v = cur / maskW;
                    if (u < minU) minU = u;
                    if (u > maxU) maxU = u;
                    if (v < minV) minV = v;
                    if (v > maxV) maxV = v;
                    compCount++;

                    if (u > 0 && fg[cur - 1] && !visited[cur - 1]) {
                        visited[cur - 1] = true;
                        queue[tail++] = cur - 1;
                    }
                    if (u + 1 < maskW && fg[cur + 1] && !visited[cur + 1]) {
                        visited[cur + 1] = true;
                        queue[tail++] = cur + 1;
                    }
                    if (v > 0 && fg[cur - maskW] && !visited[cur - maskW]) {
                        visited[cur - maskW] = true;
                        queue[tail++] = cur - maskW;
                    }
                    if (v + 1 < maskH && fg[cur + maskW] && !visited[cur + maskW]) {
                        visited[cur + maskW] = true;
                        queue[tail++] = cur + maskW;
                    }
                }
            }
        }

        final float estimatedRadiusM;
        final float estimatedHeightM;
        final float roiRadiusM;
        float volCenterX = anchorX;
        float volCenterZ = anchorZ;
        if (compCount > 0 && maxU >= minU && maxV >= minV) {
            final float camX = cameraToWorldColMajor16[12];
            final float camY = cameraToWorldColMajor16[13];
            final float camZ = cameraToWorldColMajor16[14];
            final float dx = anchorX - camX;
            final float dy = anchorY - camY;
            final float dz = anchorZ - camZ;
            final float rawDist = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
            final float anchorDistM = (Float.isFinite(rawDist) && rawDist > 0.1f)
                ? clamp(rawDist, MIN_DEPTH_M, 25.0f)
                : 1.50f;
            final float maskWidthPx = (maxU - minU + 1);
            final float maskHeightPx = (maxV - minV + 1);

            estimatedRadiusM = clamp(
                0.5f * maskWidthPx * anchorDistM / Math.max(1.0f, fx),
                TargetVolumeConstraint.MIN_RADIUS_M,
                TargetVolumeConstraint.MAX_RADIUS_M
            );
            estimatedHeightM = clamp(
                maskHeightPx * anchorDistM / Math.max(1.0f, fy),
                TargetVolumeConstraint.MIN_RADIUS_M,
                TargetVolumeConstraint.MAX_RADIUS_M
            );
            final float rayLenXZ = (float) Math.hypot(dx, dz);
            if (rayLenXZ > 1e-3f) {
                volCenterX = anchorX + (INWARD_CENTER_PUSH_FACTOR * estimatedRadiusM) * (dx / rayLenXZ);
                volCenterZ = anchorZ + (INWARD_CENTER_PUSH_FACTOR * estimatedRadiusM) * (dz / rayLenXZ);
            }
            roiRadiusM = clamp(
                Math.max(1.8f * estimatedRadiusM, estimatedRadiusM + 0.35f),
                TargetVolumeConstraint.MIN_RADIUS_M,
                TargetVolumeConstraint.MAX_RADIUS_M
            );
        } else {
            estimatedRadiusM = baseConstraint.active
                ? baseConstraint.radiusM
                : TargetVolumeConstraint.DEFAULT_RADIUS_M;
            estimatedHeightM = baseConstraint.heightEstM;
            roiRadiusM = estimatedRadiusM;
        }

        final TargetVolumeConstraint constraint = baseConstraint.withAutoBounds(
            volCenterX,
            effGroundY,
            volCenterZ,
            roiRadiusM,
            estimatedHeightM
        );
        return new FusedTargetSurface(
            constraint,
            new float[0],
            new float[0],
            new float[0],
            Collections.emptyList(),
            false,
            estimatedRadiusM,
            estimatedHeightM
        );
    }

    private static float clamp(final float v, final float min, final float max) {
        if (!Float.isFinite(v)) {
            return min;
        }
        return Math.max(min, Math.min(max, v));
    }

    private static int clampInt(final int v, final int min, final int max) {
        return Math.max(min, Math.min(max, v));
    }
}
