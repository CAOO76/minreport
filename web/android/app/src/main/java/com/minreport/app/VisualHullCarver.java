package com.minreport.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Pure-Java Generalist Multi-View Probabilistic Visual Hull (Space Carving) Engine for MINREPORT · ACOPIOS (2.3.0).
 *
 * Reconstructs any solid (textureless cylinders, boxes, cones, irregular mining stockpiles) from multi-view
 * 2D silhouette masks without requiring photogrammetric wall texture or LiDAR:
 * - Pre-centering via 3D least-squares intersection of silhouette centroid rays + adaptive 1.35x bbox sizing
 * - Continuous probabilistic carving (core=1.0, 1-px halo=0.6, out=0.0) without destructive antipodal rejection
 * - Base-anchored vertical continuity per column (chops floating air noise)
 * - Automatic 1x 1.6x box expansion when > 2% of surviving voxels touch XZ borders or Y ceiling
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
    private static final float CORE_WEIGHT = 1.0f;
    private static final float HALO_WEIGHT = 0.6f;
    private static final float MIN_IN_MASK_SCORE_RATIO = 0.78f;
    private static final float MAX_HARD_OUT_RATIO = 0.18f;
    private static final float SILHOUETTE_BBOX_MARGIN = 1.35f;
    private static final float TRUNCATION_BORDER_RATIO = 0.02f;
    private static final float AUTO_EXPAND_FACTOR = 1.60f;
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
        /** True 3D centroid of surviving voxels in world coordinates. */
        public final float centroidX, centroidY, centroidZ;

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
            this(
                originX,
                originZ,
                cellSizeM,
                cols,
                rows,
                hullHeightsM,
                hullFootprintMask,
                viewsUsed,
                survivingVoxels,
                0.0f,
                0.0f,
                0.0f
            );
        }

        public VisualHullResult(
            final float originX,
            final float originZ,
            final float cellSizeM,
            final int cols,
            final int rows,
            final float[] hullHeightsM,
            final byte[] hullFootprintMask,
            final int viewsUsed,
            final int survivingVoxels,
            final float centroidX,
            final float centroidY,
            final float centroidZ
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
            this.centroidX = Float.isFinite(centroidX) ? centroidX : 0.0f;
            this.centroidY = Float.isFinite(centroidY) ? centroidY : 0.0f;
            this.centroidZ = Float.isFinite(centroidZ) ? centroidZ : 0.0f;
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
        // Camera optical center in world coordinates (-R^T * t) and horizontal XZ unit +Z axis
        final float camX, camY, camZ;
        final float zAxisXzX, zAxisXzZ;
        // Silhouette bbox and centroid ray in world coordinates
        final int fgCount;
        final int minU, maxU, minV, maxV;
        final float centroidU, centroidV;
        final float rayDirX, rayDirY, rayDirZ;
        final boolean hasValidRay;

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

            // Camera center in world space: camPos = -R^T * t
            this.camX = -(m0 * m12 + m1 * m13 + m2 * m14);
            this.camY = -(m4 * m12 + m5 * m13 + m6 * m14);
            this.camZ = -(m8 * m12 + m9 * m13 + m10 * m14);
            // Horizontal XZ camera backward direction (pitch-invariant for handheld downward-tilted scans)
            final float zXzLen = (float) Math.hypot(m2, m10);
            if (zXzLen > 1e-5f) {
                this.zAxisXzX = m2 / zXzLen;
                this.zAxisXzZ = m10 / zXzLen;
            } else {
                this.zAxisXzX = 0.0f;
                this.zAxisXzZ = 1.0f;
            }

            int cnt = 0;
            int uLo = src.width;
            int uHi = -1;
            int vLo = src.height;
            int vHi = -1;
            double sumU = 0.0;
            double sumV = 0.0;
            for (int v = 0; v < src.height; v++) {
                final int rowOff = v * src.width;
                for (int u = 0; u < src.width; u++) {
                    if ((src.maskConf[rowOff + u] & 0xFF) >= MASK_THRESHOLD) {
                        cnt++;
                        sumU += u;
                        sumV += v;
                        if (u < uLo) uLo = u;
                        if (u > uHi) uHi = u;
                        if (v < vLo) vLo = v;
                        if (v > vHi) vHi = v;
                    }
                }
            }
            this.fgCount = cnt;
            this.minU = cnt > 0 ? uLo : 0;
            this.maxU = cnt > 0 ? uHi : 0;
            this.minV = cnt > 0 ? vLo : 0;
            this.maxV = cnt > 0 ? vHi : 0;
            this.centroidU = cnt > 0 ? (float) (sumU / cnt) : src.cx;
            this.centroidV = cnt > 0 ? (float) (sumV / cnt) : src.cy;

            if (cnt >= 4) {
                final float rcx = (this.centroidU - src.cx) / src.fx;
                final float rcy = -(this.centroidV - src.cy) / src.fy;
                final float rcz = -1.0f;
                final float dx = m0 * rcx + m1 * rcy + m2 * rcz;
                final float dy = m4 * rcx + m5 * rcy + m6 * rcz;
                final float dz = m8 * rcx + m9 * rcy + m10 * rcz;
                final float len = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (Float.isFinite(len) && len > 1e-5f) {
                    this.rayDirX = dx / len;
                    this.rayDirY = dy / len;
                    this.rayDirZ = dz / len;
                    this.hasValidRay = true;
                } else {
                    this.rayDirX = 0.0f;
                    this.rayDirY = 0.0f;
                    this.rayDirZ = -1.0f;
                    this.hasValidRay = false;
                }
            } else {
                this.rayDirX = 0.0f;
                this.rayDirY = 0.0f;
                this.rayDirZ = -1.0f;
                this.hasValidRay = false;
            }
        }
    }

    private static final class BandStats {
        int survivingVoxels;
        int borderTouchVoxels;
        int xzBorderTouchVoxels;
        int topTouchVoxels;
        double sumX;
        double sumY;
        double sumZ;
    }

    private static final class PassOutcome {
        final VisualHullResult result;
        final int borderTouchVoxels;
        final int xzBorderTouchVoxels;
        final int topTouchVoxels;

        PassOutcome(
            final VisualHullResult result,
            final int borderTouchVoxels,
            final int xzBorderTouchVoxels,
            final int topTouchVoxels
        ) {
            this.result = result;
            this.borderTouchVoxels = borderTouchVoxels;
            this.xzBorderTouchVoxels = xzBorderTouchVoxels;
            this.topTouchVoxels = topTouchVoxels;
        }
    }

    /**
     * Carves a 3D probabilistic visual hull from 2+ segmented camera views with automatic
     * silhouette-ray pre-centering, adaptive bbox sizing, continuous scoring, vertical continuity,
     * and 1x truncation-triggered 1.6x box expansion.
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
        final boolean usePolygonCut = hasTarget && target.hasValidPolygon();
        final float effGroundY = Float.isFinite(groundY)
            ? groundY
            : (target != null && target.hasPadReferenceY
                ? target.padReferenceY
                : (hasTarget ? target.anchorY : 0.0f));

        final PreparedView[] viewArr = prepared.toArray(new PreparedView[0]);

        // Step 1: Pre-center via 3D least-squares intersection of silhouette centroid rays
        final float[] rayCenter = triangulateSilhouetteRays(viewArr);
        float boxCx;
        float boxCy;
        float boxCz;
        if (rayCenter != null && (!usePolygonCut || target.containsXZ(rayCenter[0], rayCenter[2], 1.35f))) {
            boxCx = rayCenter[0];
            boxCy = rayCenter[1];
            boxCz = rayCenter[2];
        } else if (usePolygonCut) {
            final float[] polyC = TargetVolumeConstraint.computePolygonCentroidXZ(target.polygonXZ);
            boxCx = polyC[0];
            boxCy = effGroundY + (target.heightEstM > 0.05f ? target.heightEstM * 0.5f : 0.5f);
            boxCz = polyC[1];
        } else {
            boxCx = hasTarget ? target.anchorX : 0.0f;
            boxCy = effGroundY + (hasTarget && target.heightEstM > 0.05f ? target.heightEstM * 0.5f : 0.5f);
            boxCz = hasTarget ? target.anchorZ : 0.0f;
        }

        // Estimate box radius & height by projecting each view's silhouette bbox at distance d_i with 1.35x margin
        final float[] rayBounds = estimateBoxFromSilhouettes(viewArr, boxCx, boxCy, boxCz, effGroundY);
        final float fallbackRadiusM = hasTarget
            ? clamp(target.getEffectiveRadiusM() * 1.25f, 0.20f, 18.0f)
            : TargetVolumeConstraint.DEFAULT_RADIUS_M;
        final float fallbackHeightM = hasTarget && target.heightEstM > 0.05f
            ? clamp(target.heightEstM * 1.40f, 0.20f, 18.0f)
            : clamp(fallbackRadiusM * 2.5f, 0.30f, 18.0f);

        float boxRadiusM = (rayBounds != null && rayBounds[0] > 0.05f)
            ? clamp(rayBounds[0] * SILHOUETTE_BBOX_MARGIN, 0.15f, 18.0f)
            : fallbackRadiusM;
        float boxHeightM = (rayBounds != null && rayBounds[1] > 0.05f)
            ? clamp(rayBounds[1] * SILHOUETTE_BBOX_MARGIN, 0.15f, 18.0f)
            : fallbackHeightM;

        if (usePolygonCut) {
            // Guarantee box covers the user's explicit valley polygon cleanly
            float maxPolyR = 0.15f;
            for (int i = 0; i < target.polygonXZ.length; i += 2) {
                final float d = (float) Math.hypot(target.polygonXZ[i] - boxCx, target.polygonXZ[i + 1] - boxCz);
                if (d > maxPolyR) {
                    maxPolyR = d;
                }
            }
            boxRadiusM = Math.max(boxRadiusM, clamp(maxPolyR * 1.05f, 0.15f, 18.0f));
        }

        final int minVisRequired = Math.max(2, Math.min(4, (int) Math.ceil(nViews * 0.35f)));

        // Step 2: Execute probabilistic carving pass 1
        final PassOutcome pass1 = executeCarvePass(
            viewArr,
            usePolygonCut ? target : null,
            boxCx,
            boxCz,
            boxRadiusM,
            boxHeightM,
            effGroundY,
            res,
            minVisRequired
        );

        // Step 3: Truncation detection & 1x automatic 1.6x box expansion centered on surviving centroid
        if (
            pass1.result.survivingVoxels > 0 &&
            pass1.borderTouchVoxels > pass1.result.survivingVoxels * TRUNCATION_BORDER_RATIO
        ) {
            final float nextCx = pass1.result.centroidX;
            final float nextCz = pass1.result.centroidZ;
            final float nextRadiusM = pass1.xzBorderTouchVoxels > 0
                ? clamp(boxRadiusM * AUTO_EXPAND_FACTOR, 0.15f, 18.0f)
                : boxRadiusM;
            final float nextHeightM = pass1.topTouchVoxels > 0
                ? clamp(boxHeightM * AUTO_EXPAND_FACTOR, 0.15f, 18.0f)
                : boxHeightM;

            final PassOutcome pass2 = executeCarvePass(
                viewArr,
                usePolygonCut ? target : null,
                nextCx,
                nextCz,
                nextRadiusM,
                nextHeightM,
                effGroundY,
                res,
                minVisRequired
            );
            if (pass2.result.survivingVoxels > 0) {
                return pass2.result;
            }
        }

        return pass1.result;
    }

    private static PassOutcome executeCarvePass(
        final PreparedView[] viewArr,
        final TargetVolumeConstraint polygonTarget,
        final float boxCx,
        final float boxCz,
        final float boxRadiusM,
        final float boxHeightM,
        final float effGroundY,
        final int res,
        final int minVisRequired
    ) {
        final int nViews = viewArr.length;
        final float originX = boxCx - boxRadiusM;
        final float originZ = boxCz - boxRadiusM;
        final float cellSizeM = (2.0f * boxRadiusM) / res;
        final float dy = boxHeightM / res;

        final float[] hullHeightsM = new float[res * res];
        final byte[] hullFootprintMask = new byte[res * res];

        final int threads = (res >= 32 && nViews >= 4)
            ? Math.min(4, Math.max(1, Runtime.getRuntime().availableProcessors()))
            : 1;

        final BandStats total = new BandStats();
        if (threads <= 1) {
            final BandStats part = carveRowBand(
                0,
                res,
                res,
                originX,
                originZ,
                cellSizeM,
                effGroundY,
                dy,
                polygonTarget,
                viewArr,
                minVisRequired,
                hullHeightsM,
                hullFootprintMask
            );
            accumulateBandStats(total, part);
        } else {
            final ExecutorService pool = Executors.newFixedThreadPool(threads);
            final List<Callable<BandStats>> tasks = new ArrayList<>(threads);
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
                    polygonTarget,
                    viewArr,
                    minVisRequired,
                    hullHeightsM,
                    hullFootprintMask
                ));
            }
            try {
                final List<Future<BandStats>> futures = pool.invokeAll(tasks);
                for (Future<BandStats> f : futures) {
                    try {
                        final BandStats part = f.get();
                        if (part != null) {
                            accumulateBandStats(total, part);
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

        final float cxOut = total.survivingVoxels > 0 ? (float) (total.sumX / total.survivingVoxels) : boxCx;
        final float cyOut = total.survivingVoxels > 0 ? (float) (total.sumY / total.survivingVoxels) : effGroundY;
        final float czOut = total.survivingVoxels > 0 ? (float) (total.sumZ / total.survivingVoxels) : boxCz;

        final VisualHullResult result = new VisualHullResult(
            originX,
            originZ,
            cellSizeM,
            res,
            res,
            hullHeightsM,
            hullFootprintMask,
            nViews,
            total.survivingVoxels,
            cxOut,
            cyOut,
            czOut
        );
        return new PassOutcome(result, total.borderTouchVoxels, total.xzBorderTouchVoxels, total.topTouchVoxels);
    }

    private static void accumulateBandStats(final BandStats dst, final BandStats src) {
        dst.survivingVoxels += src.survivingVoxels;
        dst.borderTouchVoxels += src.borderTouchVoxels;
        dst.xzBorderTouchVoxels += src.xzBorderTouchVoxels;
        dst.topTouchVoxels += src.topTouchVoxels;
        dst.sumX += src.sumX;
        dst.sumY += src.sumY;
        dst.sumZ += src.sumZ;
    }

    private static BandStats carveRowBand(
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
        final float[] hullHeightsM,
        final byte[] hullFootprintMask
    ) {
        final int nViews = views.length;
        final int maxHardOutUpperBound = (int) Math.floor(nViews * MAX_HARD_OUT_RATIO + 1e-6f);
        // Per-thread scratch arrays for incremental column projection along +Y (zero inner-loop allocations)
        final float[] colBaseXc = new float[nViews];
        final float[] colBaseYc = new float[nViews];
        final float[] colBaseZc = new float[nViews];
        final float[] stepXc = new float[nViews];
        final float[] stepYc = new float[nViews];
        final float[] stepZc = new float[nViews];
        final int[] hardOutViews = new int[nViews];
        final boolean[] colSurvives = new boolean[res];
        for (int vi = 0; vi < nViews; vi++) {
            final PreparedView pv = views[vi];
            stepXc[vi] = pv.m4 * dy;
            stepYc[vi] = pv.m5 * dy;
            stepZc[vi] = pv.m6 * dy;
        }

        final float baseWy0 = groundY + 0.5f * dy;
        final int maxBaseStartIy = Math.min(res - 1, Math.max(2, res / 10));
        final BandStats stats = new BandStats();

        for (int r = rStart; r < rEnd; r++) {
            final float wz = originZ + (r + 0.5f) * cellSizeM;
            final int rowOff = r * res;
            final boolean rowOnBorder = (r == 0 || r == res - 1);

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

                for (int iy = 0; iy < res; iy++) {
                    int visCount = 0;
                    float inMaskScore = 0.0f;
                    int hardOutCount = 0;
                    boolean earlyReject = false;

                    for (int vi = 0; vi < nViews; vi++) {
                        final float zc = colBaseZc[vi] + iy * stepZc[vi];
                        if (zc >= NEAR_PLANE_Z_NEG) {
                            continue;
                        }
                        final PreparedView pv = views[vi];
                        final float xc = colBaseXc[vi] + iy * stepXc[vi];
                        final float yc = colBaseYc[vi] + iy * stepYc[vi];
                        final float invNegZ = 1.0f / (-zc);
                        final float fu = pv.fx * (xc * invNegZ) + pv.cx;
                        if (fu < 0.0f || fu > pv.w - 1.0f) {
                            continue;
                        }
                        final float fv = pv.cy - pv.fy * (yc * invNegZ);
                        if (fv < 0.0f || fv > pv.h - 1.0f) {
                            continue;
                        }

                        visCount++;
                        // Sub-pixel bilinear mask sampling eliminates +0.5..1.5 px rounding/dilation bloat
                        final int u0 = (int) fu;
                        final int v0 = (int) fv;
                        final int u1 = u0 + 1 < pv.w ? u0 + 1 : u0;
                        final int v1 = v0 + 1 < pv.h ? v0 + 1 : v0;
                        final float tx = fu - u0;
                        final float ty = fv - v0;
                        final byte[] bm = pv.dilatedMask;
                        final int r0Off = v0 * pv.w;
                        final int r1Off = v1 * pv.w;
                        final float top = bm[r0Off + u0] * (1.0f - tx) + bm[r0Off + u1] * tx;
                        final float bot = bm[r1Off + u0] * (1.0f - tx) + bm[r1Off + u1] * tx;
                        final float alpha = top * (1.0f - ty) + bot * ty;

                        if (alpha >= 0.50f) {
                            inMaskScore += CORE_WEIGHT;
                        } else if (alpha >= 0.25f) {
                            // Sub-pixel boundary halo absorbs VIO jitter on tangent walls and NEVER counts as hardOut
                            inMaskScore += HALO_WEIGHT;
                        } else {
                            // Bilateral wide-angle confirmation strictly on HARD background (alpha < 0.15 only, never halo):
                            // carves empty air outside flat box faces and cylinder walls when two views > 100 deg apart
                            // in horizontal azimuth both see background, while tolerating unilateral/consecutive mask errors.
                            for (int oi = 0; oi < hardOutCount; oi++) {
                                final PreparedView prev = views[hardOutViews[oi]];
                                final float dotXz =
                                    pv.zAxisXzX * prev.zAxisXzX +
                                    pv.zAxisXzZ * prev.zAxisXzZ;
                                if (dotXz < -0.17f) {
                                    earlyReject = true;
                                    break;
                                }
                            }
                            if (earlyReject) {
                                break;
                            }
                            hardOutViews[hardOutCount++] = vi;
                            if (hardOutCount > maxHardOutUpperBound) {
                                earlyReject = true;
                                break;
                            }
                        }
                    }

                    if (!earlyReject && visCount >= minVisRequired) {
                        final int maxHardOutForVis = (int) Math.floor(visCount * MAX_HARD_OUT_RATIO + 1e-6f);
                        colSurvives[iy] =
                            hardOutCount <= maxHardOutForVis &&
                            (inMaskScore / (float) visCount) >= MIN_IN_MASK_SCORE_RATIO;
                    } else {
                        colSurvives[iy] = false;
                    }
                }

                // Vertical continuity from base: keep only continuous solid block anchored near groundY,
                // cutting disconnected floating air noise above the object.
                int baseStart = -1;
                for (int iy = 0; iy <= maxBaseStartIy; iy++) {
                    if (colSurvives[iy]) {
                        baseStart = iy;
                        break;
                    }
                }
                if (baseStart < 0) {
                    continue;
                }
                int maxSurvivingIy = baseStart;
                for (int iy = baseStart + 1; iy < res; iy++) {
                    if (colSurvives[iy]) {
                        maxSurvivingIy = iy;
                    } else {
                        break;
                    }
                }

                final boolean xzBorder = rowOnBorder || c == 0 || c == res - 1;
                final int colVoxelCount = (maxSurvivingIy - baseStart) + 1;
                stats.survivingVoxels += colVoxelCount;
                stats.sumX += wx * colVoxelCount;
                stats.sumZ += wz * colVoxelCount;
                // Mean Y of continuous voxels [baseStart..maxSurvivingIy]
                final double avgIy = 0.5 * (baseStart + maxSurvivingIy);
                stats.sumY += (baseWy0 + avgIy * dy) * colVoxelCount;

                if (xzBorder) {
                    stats.xzBorderTouchVoxels += colVoxelCount;
                    stats.borderTouchVoxels += colVoxelCount;
                }
                if (maxSurvivingIy == res - 1) {
                    stats.topTouchVoxels++;
                    if (!xzBorder) {
                        stats.borderTouchVoxels++;
                    }
                }

                final float colH = (maxSurvivingIy + 1) * dy;
                final int idx = rowOff + c;
                hullHeightsM[idx] = colH;
                if (colH > MIN_HULL_HEIGHT_M) {
                    hullFootprintMask[idx] = 1;
                }
            }
        }
        return stats;
    }

    /**
     * Least-squares 3D intersection of silhouette centroid rays across all valid views:
     * minimizes sum_i ||(I - d_i d_i^T)(p - o_i)||^2.
     */
    private static float[] triangulateSilhouetteRays(final PreparedView[] views) {
        double a00 = 0.0, a01 = 0.0, a02 = 0.0;
        double a11 = 0.0, a12 = 0.0, a22 = 0.0;
        double b0 = 0.0, b1 = 0.0, b2 = 0.0;
        int validRays = 0;

        for (PreparedView pv : views) {
            if (!pv.hasValidRay) {
                continue;
            }
            final double dx = pv.rayDirX;
            final double dy = pv.rayDirY;
            final double dz = pv.rayDirZ;
            final double p00 = 1.0 - dx * dx;
            final double p01 = -dx * dy;
            final double p02 = -dx * dz;
            final double p11 = 1.0 - dy * dy;
            final double p12 = -dy * dz;
            final double p22 = 1.0 - dz * dz;

            a00 += p00;
            a01 += p01;
            a02 += p02;
            a11 += p11;
            a12 += p12;
            a22 += p22;

            b0 += p00 * pv.camX + p01 * pv.camY + p02 * pv.camZ;
            b1 += p01 * pv.camX + p11 * pv.camY + p12 * pv.camZ;
            b2 += p02 * pv.camX + p12 * pv.camY + p22 * pv.camZ;
            validRays++;
        }

        if (validRays < 2) {
            return null;
        }
        final double[] sol = solve3x3(
            new double[][] {
                { a00, a01, a02 },
                { a01, a11, a12 },
                { a02, a12, a22 }
            },
            new double[] { b0, b1, b2 }
        );
        if (sol == null || !Double.isFinite(sol[0]) || !Double.isFinite(sol[1]) || !Double.isFinite(sol[2])) {
            return null;
        }

        // Validate majority of silhouette rays see triangulated point in front of camera within sane range
        int forwardOk = 0;
        for (PreparedView pv : views) {
            if (!pv.hasValidRay) {
                continue;
            }
            final double vx = sol[0] - pv.camX;
            final double vy = sol[1] - pv.camY;
            final double vz = sol[2] - pv.camZ;
            final double along = vx * pv.rayDirX + vy * pv.rayDirY + vz * pv.rayDirZ;
            if (along > 0.15 && along < 30.0) {
                forwardOk++;
            }
        }
        if (forwardOk < Math.max(2, (int) Math.ceil(validRays * 0.6))) {
            return null;
        }
        return new float[] { (float) sol[0], (float) sol[1], (float) sol[2] };
    }

    /**
     * Estimates object apparent radius and height by projecting each view's silhouette bounding box
     * onto the depth plane d_i through (centerX, centerY, centerZ), returning { p85RadiusM, p85HeightM }.
     */
    private static float[] estimateBoxFromSilhouettes(
        final PreparedView[] views,
        final float centerX,
        final float centerY,
        final float centerZ,
        final float groundY
    ) {
        final float[] rEsts = new float[views.length];
        final float[] hEsts = new float[views.length];
        int count = 0;

        for (PreparedView pv : views) {
            if (!pv.hasValidRay) {
                continue;
            }
            final float zc = pv.m2 * centerX + pv.m6 * centerY + pv.m10 * centerZ + pv.m14;
            final float dM = -zc;
            if (!Float.isFinite(dM) || dM <= 0.15f || dM >= 30.0f) {
                continue;
            }
            final float wHalf = 0.5f * (pv.maxU - pv.minU + 1) * dM / pv.fx;
            final float hSpan = (pv.maxV - pv.minV + 1) * dM / pv.fy;

            // Project top of silhouette (centroidU, minV) at depth dM to capture world elevation above groundY
            final float xcTop = ((pv.centroidU - pv.cx) / pv.fx) * dM;
            final float ycTop = -((pv.minV - pv.cy) / pv.fy) * dM;
            final float zcTop = -dM;
            final float wyTop = pv.m4 * xcTop + pv.m5 * ycTop + pv.m6 * zcTop + pv.camY;
            final float hAboveGround = Float.isFinite(wyTop) ? (wyTop - groundY) : 0.0f;
            final float hEst = Math.max(hSpan, hAboveGround);

            if (Float.isFinite(wHalf) && wHalf > 0.02f && Float.isFinite(hEst) && hEst > 0.02f) {
                rEsts[count] = wHalf;
                hEsts[count] = hEst;
                count++;
            }
        }
        if (count == 0) {
            return null;
        }
        Arrays.sort(rEsts, 0, count);
        Arrays.sort(hEsts, 0, count);
        final int pIdx = count >= 4
            ? Math.min(count - 1, (int) Math.floor((count - 1) * 0.85))
            : (count - 1);
        return new float[] { rEsts[pIdx], hEsts[pIdx] };
    }

    private static double[] solve3x3(final double[][] mat, final double[] rhs) {
        final double[][] m = new double[3][4];
        for (int r = 0; r < 3; r++) {
            m[r][0] = mat[r][0];
            m[r][1] = mat[r][1];
            m[r][2] = mat[r][2];
            m[r][3] = rhs[r];
        }
        for (int col = 0; col < 3; col++) {
            int pivot = col;
            for (int row = col + 1; row < 3; row++) {
                if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) {
                    pivot = row;
                }
            }
            if (Math.abs(m[pivot][col]) < 1e-7) {
                return null;
            }
            final double[] tmp = m[col];
            m[col] = m[pivot];
            m[pivot] = tmp;
            final double div = m[col][col];
            for (int c = col; c < 4; c++) {
                m[col][c] /= div;
            }
            for (int row = 0; row < 3; row++) {
                if (row == col) continue;
                final double factor = m[row][col];
                for (int c = col; c < 4; c++) {
                    m[row][c] -= factor * m[col][c];
                }
            }
        }
        return new double[] { m[0][3], m[1][3], m[2][3] };
    }

    /**
     * Converts confidence mask into binary {0, 1} map for sub-pixel bilinear sampling
     * (alpha >= 0.50 -> core 1.0, 0.15 <= alpha < 0.50 -> soft halo 0.6, alpha < 0.15 -> hard out 0.0).
     */
    private static byte[] dilateMask1Px(final byte[] maskConf, final int w, final int h) {
        final int n = w * h;
        final byte[] out = new byte[n];
        for (int i = 0; i < n; i++) {
            if ((maskConf[i] & 0xFF) >= MASK_THRESHOLD) {
                out[i] = 1;
            }
        }
        return out;
    }

    private static VisualHullResult emptyResult(final int viewsUsed) {
        return new VisualHullResult(0.0f, 0.0f, 0.0f, 0, 0, new float[0], new byte[0], viewsUsed, 0, 0.0f, 0.0f, 0.0f);
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
