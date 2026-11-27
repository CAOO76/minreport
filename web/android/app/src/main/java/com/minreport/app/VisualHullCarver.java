package com.minreport.app;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Pure-Java Multi-View Probabilistic Visual Hull (Space Carving) Engine for MINREPORT · ACOPIOS (2.2.0).
 *
 * Reconstructs textureless objects (e.g. smooth white cylinders / concrete silos / fine stockpiles)
 * from multi-view 2D silhouette masks without requiring photogrammetric wall texture or LiDAR.
 *
 * Projection convention (100% consistent with DepthMaskFuser / OfflineVioMvsEngine / ARCore OpenGL):
 * - worldToCameraColMajor16 = inverse(cameraToWorldColMajor16), 16-float column-major 4x4 matrix.
 * - Camera coordinates:
 *     xc = m[0]*wx + m[4]*wy + m[8]*wz + m[12]
 *     yc = m[1]*wx + m[5]*wy + m[9]*wz + m[13]
 *     zc = m[2]*wx + m[6]*wy + m[10]*wz + m[14]
 * - Visible in front of near plane if zc < -0.15f:
 *     u = fx * (xc / -zc) + cx
 *     v = cy - fy * (yc / -zc)
 *
 * Zero Android framework dependencies for deterministic JVM JUnit verification.
 */
public final class VisualHullCarver {

    private static final int MASK_THRESHOLD = 128;
    private static final float NEAR_PLANE_Z_NEG = -0.15f;
    private static final float MIN_IN_MASK_RATIO_4PLUS = 0.82f;
    private static final float MAX_OUT_RATIO_4PLUS = 0.18f;
    private static final float MIN_HULL_HEIGHT_M = 0.02f;
    private static final int DEFAULT_GRID_RES = 48;
    private static final int MIN_GRID_RES = 8;
    private static final int MAX_GRID_RES = 96;

    private VisualHullCarver() {}

    public static final class SegmentedView {
        public final byte[] maskConf;
        public final int width, height;
        public final float fx, fy, cx, cy;
        public final float[] worldToCameraColMajor16;
        public final float groundY;

        public SegmentedView(
            final byte[] maskConf,
            final int width,
            final int height,
            final float fx,
            final float fy,
            final float cx,
            final float cy,
            final float[] worldToCameraColMajor16,
            final float groundY
        ) {
            this.maskConf = maskConf;
            this.width = width;
            this.height = height;
            this.fx = fx;
            this.fy = fy;
            this.cx = cx;
            this.cy = cy;
            this.worldToCameraColMajor16 = worldToCameraColMajor16;
            this.groundY = groundY;
        }
    }

    public static final class VisualHullResult {
        public final float originX, originZ, cellSizeM;
        public final int cols, rows;
        public final float[] hullHeightsM;
        public final byte[] hullFootprintMask;
        public final int viewsUsed, survivingVoxels;

        public VisualHullResult(
            final float originX,
            final float originZ,
            final float cellSizeM,
            final int cols,
            final int rows,
            final float[] hullHeightsM,
            final byte[] hullFootprintMask,
            final int viewsUsed,
            final int survivingVoxels
        ) {
            this.originX = originX;
            this.originZ = originZ;
            this.cellSizeM = cellSizeM;
            this.cols = cols;
            this.rows = rows;
            this.hullHeightsM = hullHeightsM;
            this.hullFootprintMask = hullFootprintMask;
            this.viewsUsed = viewsUsed;
            this.survivingVoxels = survivingVoxels;
        }

        public boolean isValid() {
            return cols > 0 && rows > 0 && survivingVoxels > 0 && hullHeightsM != null && hullFootprintMask != null;
        }
    }

    private static final class PreparedView {
        final byte[] dilatedMask;
        final int w;
        final int h;
        final float fx;
        final float fy;
        final float cx;
        final float cy;
        final float m0, m1, m2;
        final float m4, m5, m6;
        final float m8, m9, m10;
        final float m12, m13, m14;
        // Unit camera +Z (backward) axis in world space for antipodal view check
        final float zAxisX, zAxisY, zAxisZ;

        PreparedView(final SegmentedView src, final byte[] dilatedMask) {
            this.dilatedMask = dilatedMask;
            this.w = src.width;
            this.h = src.height;
            this.fx = src.fx;
            this.fy = src.fy;
            this.cx = src.cx;
            this.cy = src.cy;
            final float[] m = src.worldToCameraColMajor16;
            this.m0 = m[0];
            this.m1 = m[1];
            this.m2 = m[2];
            this.m4 = m[4];
            this.m5 = m[5];
            this.m6 = m[6];
            this.m8 = m[8];
            this.m9 = m[9];
            this.m10 = m[10];
            this.m12 = m[12];
            this.m13 = m[13];
            this.m14 = m[14];
            final float zLen = (float) Math.sqrt(m2 * m2 + m6 * m6 + m10 * m10);
            if (zLen > 1e-5f) {
                this.zAxisX = m2 / zLen;
                this.zAxisY = m6 / zLen;
                this.zAxisZ = m10 / zLen;
            } else {
                this.zAxisX = 0.0f;
                this.zAxisY = 0.0f;
                this.zAxisZ = 1.0f;
            }
        }
    }

    /**
     * Carves a 3D probabilistic visual hull from 2+ segmented camera views inside the TargetVolumeConstraint box
     * and returns its 2.5D height field (hullHeightsM) and binary footprint mask (hullFootprintMask).
     */
    public static VisualHullResult carve(
        final List<SegmentedView> views,
        final TargetVolumeConstraint target,
        final float groundY,
        final int gridRes
    ) {
        if (views == null || views.size() < 2) {
            return emptyResult(views != null ? views.size() : 0);
        }

        final List<PreparedView> prepared = new ArrayList<>(views.size());
        for (SegmentedView sv : views) {
            if (
                sv == null ||
                sv.maskConf == null ||
                sv.width <= 0 ||
                sv.height <= 0 ||
                sv.maskConf.length < sv.width * sv.height ||
                sv.worldToCameraColMajor16 == null ||
                sv.worldToCameraColMajor16.length < 16 ||
                !Float.isFinite(sv.fx) ||
                !Float.isFinite(sv.fy) ||
                sv.fx <= 1e-3f ||
                sv.fy <= 1e-3f
            ) {
                continue;
            }
            final byte[] dilated = dilateMask1Px(sv.maskConf, sv.width, sv.height);
            prepared.add(new PreparedView(sv, dilated));
        }

        final int nViews = prepared.size();
        if (nViews < 2) {
            return emptyResult(nViews);
        }

        final int res = clampInt(gridRes > 0 ? gridRes : DEFAULT_GRID_RES, MIN_GRID_RES, MAX_GRID_RES);
        final boolean hasTarget = target != null && target.active;
        final float anchorX = hasTarget ? target.anchorX : 0.0f;
        final float anchorZ = hasTarget ? target.anchorZ : 0.0f;
        final float baseRadiusM = hasTarget
            ? target.getEffectiveRadiusM()
            : TargetVolumeConstraint.DEFAULT_RADIUS_M;
        final float heightEstM = hasTarget ? target.heightEstM : 0.0f;

        final float boxRadiusM = clamp(baseRadiusM * 1.25f, 0.20f, 18.0f);
        final float boxHeightM = clamp(Math.max(heightEstM * 1.40f, boxRadiusM * 2.5f), 0.70f, 16.0f);
        final float effGroundY = Float.isFinite(groundY)
            ? groundY
            : (target != null && target.hasPadReferenceY
                ? target.padReferenceY
                : (hasTarget ? target.anchorY : 0.0f));

        final float originX = anchorX - boxRadiusM;
        final float originZ = anchorZ - boxRadiusM;
        final float cellSizeM = (2.0f * boxRadiusM) / res;
        final float dy = boxHeightM / res;
        final boolean usePolygonCut = hasTarget && target.hasValidPolygon();

        final float[] hullHeightsM = new float[res * res];
        final byte[] hullFootprintMask = new byte[res * res];
        final PreparedView[] viewArr = prepared.toArray(new PreparedView[0]);

        final int minVisRequired = nViews >= 4 ? 4 : 2;
        final int maxOutAllowed = nViews >= 4
            ? (int) Math.floor(nViews * MAX_OUT_RATIO_4PLUS + 1e-6)
            : 0;
        final boolean strictAllIn = nViews < 4;

        final int threads = (res >= 32 && nViews >= 4)
            ? Math.min(4, Math.max(1, Runtime.getRuntime().availableProcessors()))
            : 1;

        int totalSurviving = 0;
        if (threads <= 1) {
            totalSurviving = carveRowBand(
                0,
                res,
                res,
                originX,
                originZ,
                cellSizeM,
                effGroundY,
                dy,
                usePolygonCut ? target : null,
                viewArr,
                minVisRequired,
                maxOutAllowed,
                strictAllIn,
                hullHeightsM,
                hullFootprintMask
            );
        } else {
            final ExecutorService pool = Executors.newFixedThreadPool(threads);
            final List<Callable<Integer>> tasks = new ArrayList<>(threads);
            final int rowsPerThread = (res + threads - 1) / threads;
            for (int t = 0; t < threads; t++) {
                final int rStart = t * rowsPerThread;
                final int rEnd = Math.min(res, rStart + rowsPerThread);
                if (rStart >= rEnd) {
                    continue;
                }
                tasks.add(() -> carveRowBand(
                    rStart,
                    rEnd,
                    res,
                    originX,
                    originZ,
                    cellSizeM,
                    effGroundY,
                    dy,
                    usePolygonCut ? target : null,
                    viewArr,
                    minVisRequired,
                    maxOutAllowed,
                    strictAllIn,
                    hullHeightsM,
                    hullFootprintMask
                ));
            }
            try {
                final List<Future<Integer>> futures = pool.invokeAll(tasks);
                for (Future<Integer> f : futures) {
                    try {
                        final Integer part = f.get();
                        if (part != null) {
                            totalSurviving += part;
                        }
                    } catch (Exception ignoredBandEx) {
                        // Preserve remaining bands if one band fails unexpectedly.
                    }
                }
            } catch (Exception ignoredInvokeEx) {
            } finally {
                pool.shutdownNow();
            }
        }

        return new VisualHullResult(
            originX,
            originZ,
            cellSizeM,
            res,
            res,
            hullHeightsM,
            hullFootprintMask,
            nViews,
            totalSurviving
        );
    }

    private static int carveRowBand(
        final int rStart,
        final int rEnd,
        final int res,
        final float originX,
        final float originZ,
        final float cellSizeM,
        final float groundY,
        final float dy,
        final TargetVolumeConstraint polygonTarget,
        final PreparedView[] views,
        final int minVisRequired,
        final int maxOutAllowed,
        final boolean strictAllIn,
        final float[] hullHeightsM,
        final byte[] hullFootprintMask
    ) {
        final int nViews = views.length;
        // Per-thread scratch arrays for incremental column projection along +Y (zero inner-loop allocations)
        final float[] colBaseXc = new float[nViews];
        final float[] colBaseYc = new float[nViews];
        final float[] colBaseZc = new float[nViews];
        final float[] stepXc = new float[nViews];
        final float[] stepYc = new float[nViews];
        final float[] stepZc = new float[nViews];
        final int[] nonCoreViews = new int[nViews];
        for (int vi = 0; vi < nViews; vi++) {
            final PreparedView pv = views[vi];
            stepXc[vi] = pv.m4 * dy;
            stepYc[vi] = pv.m5 * dy;
            stepZc[vi] = pv.m6 * dy;
        }

        final float baseWy0 = groundY + 0.5f * dy;
        int survivingInBand = 0;

        for (int r = rStart; r < rEnd; r++) {
            final float wz = originZ + (r + 0.5f) * cellSizeM;
            final int rowOff = r * res;

            for (int c = 0; c < res; c++) {
                final float wx = originX + (c + 0.5f) * cellSizeM;
                if (polygonTarget != null && !polygonTarget.containsXZ(wx, wz, 1.0f)) {
                    continue;
                }

                // Precompute base camera coordinates at iy = 0 for every view
                for (int vi = 0; vi < nViews; vi++) {
                    final PreparedView pv = views[vi];
                    colBaseXc[vi] = pv.m0 * wx + pv.m4 * baseWy0 + pv.m8 * wz + pv.m12;
                    colBaseYc[vi] = pv.m1 * wx + pv.m5 * baseWy0 + pv.m9 * wz + pv.m13;
                    colBaseZc[vi] = pv.m2 * wx + pv.m6 * baseWy0 + pv.m10 * wz + pv.m14;
                }

                int maxSurvivingIy = -1;
                for (int iy = 0; iy < res; iy++) {
                    int visCount = 0;
                    float inMaskScore = 0.0f;
                    int outCount = 0;
                    int nonCoreCount = 0;
                    boolean rejected = false;

                    for (int vi = 0; vi < nViews; vi++) {
                        final float zc = colBaseZc[vi] + iy * stepZc[vi];
                        if (zc >= NEAR_PLANE_Z_NEG) {
                            continue;
                        }
                        final PreparedView pv = views[vi];
                        final float xc = colBaseXc[vi] + iy * stepXc[vi];
                        final float yc = colBaseYc[vi] + iy * stepYc[vi];
                        final float invNegZ = 1.0f / (-zc);
                        final int iu = Math.round(pv.fx * (xc * invNegZ) + pv.cx);
                        if (iu < 0 || iu >= pv.w) {
                            continue;
                        }
                        final int iv = Math.round(pv.cy - pv.fy * (yc * invNegZ));
                        if (iv < 0 || iv >= pv.h) {
                            continue;
                        }

                        visCount++;
                        final byte mVal = pv.dilatedMask[iv * pv.w + iu];
                        if (mVal == 2) {
                            inMaskScore += 1.0f;
                        } else {
                            // Bilateral antipodal empty-space confirmation (>120 deg apart):
                            // If two opposite cameras BOTH see a voxel outside the core mask (halo or background),
                            // carve it to eliminate tangent-halo & 1-px dilation bloat while keeping full 0.82
                            // resilience to single or consecutive occluded/jittered views.
                            for (int oi = 0; oi < nonCoreCount; oi++) {
                                final PreparedView prev = views[nonCoreViews[oi]];
                                final float dotZ =
                                    pv.zAxisX * prev.zAxisX +
                                    pv.zAxisY * prev.zAxisY +
                                    pv.zAxisZ * prev.zAxisZ;
                                if (dotZ < -0.5f) {
                                    rejected = true;
                                    break;
                                }
                            }
                            if (rejected) {
                                break;
                            }
                            nonCoreViews[nonCoreCount++] = vi;

                            if (mVal == 1) {
                                // 1-px morphological dilation halo: tolerates VIO drift on unilateral views
                                inMaskScore += 0.5f;
                            } else {
                                outCount++;
                                if (outCount > maxOutAllowed) {
                                    rejected = true;
                                    break;
                                }
                            }
                        }
                    }

                    if (!rejected && visCount >= minVisRequired) {
                        final boolean survives = strictAllIn
                            ? (outCount == 0 && inMaskScore >= visCount * 0.75f)
                            : ((inMaskScore / (float) visCount) >= MIN_IN_MASK_RATIO_4PLUS);
                        if (survives) {
                            survivingInBand++;
                            maxSurvivingIy = iy;
                        }
                    }
                }

                if (maxSurvivingIy >= 0) {
                    final float colH = (maxSurvivingIy + 1) * dy;
                    final int idx = rowOff + c;
                    hullHeightsM[idx] = colH;
                    if (colH > MIN_HULL_HEIGHT_M) {
                        hullFootprintMask[idx] = 1;
                    }
                }
            }
        }
        return survivingInBand;
    }

    /**
     * 1-pixel 4-connected morphological dilation on foreground mask ((maskConf[i] & 0xFF) >= 128):
     * - 2 = core foreground pixel (full weight 1.0)
     * - 1 = 1-px dilated halo neighbor (half weight 0.5, absorbs VIO pose jitter without inflating radius)
     * - 0 = background
     */
    private static byte[] dilateMask1Px(final byte[] maskConf, final int w, final int h) {
        final byte[] out = new byte[w * h];
        for (int v = 0; v < h; v++) {
            final int rowOff = v * w;
            for (int u = 0; u < w; u++) {
                final int idx = rowOff + u;
                if ((maskConf[idx] & 0xFF) >= MASK_THRESHOLD) {
                    out[idx] = 2;
                    if (u > 0 && out[idx - 1] == 0) out[idx - 1] = 1;
                    if (u + 1 < w && out[idx + 1] == 0) out[idx + 1] = 1;
                    if (v > 0 && out[idx - w] == 0) out[idx - w] = 1;
                    if (v + 1 < h && out[idx + w] == 0) out[idx + w] = 1;
                }
            }
        }
        return out;
    }

    private static VisualHullResult emptyResult(final int viewsUsed) {
        return new VisualHullResult(0.0f, 0.0f, 0.0f, 0, 0, new float[0], new byte[0], viewsUsed, 0);
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
