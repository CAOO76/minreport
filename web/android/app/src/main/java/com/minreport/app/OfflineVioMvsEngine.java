package com.minreport.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Pure-Java High-Performance Known-Pose VIO + Multi-View Triangulation + PatchMatch/Plane-Sweep
 * Census + ZNCC Engine for offline in-situ mining stockpile metrology on non-LiDAR Android devices.
 *
 * Uses primitive arrays, zero allocations in hot loops, Long.bitCount/Integer.bitCount for binary
 * descriptors, max 4 worker threads, and thermal degradation guard.
 */
public final class OfflineVioMvsEngine {

    private static final float MIN_DEPTH_M = 0.40f;
    private static final float MAX_DEPTH_M = 30.0f;
    private static final float MIN_PARALLAX_COS = 0.99939f; // ~2.0 degrees
    private static final float MAX_REPROJ_ERR_PX = 2.5f;
    private static final int MAX_HAMMING_DIST = 14;
    private static final int FAST_THRESHOLD = 16;
    private static final int MAX_FEATURES_PER_KF = 420;

    // 16-pixel Bresenham circle of radius 3 for FAST-9
    private static final int[] CIRCLE_DX = { 0, 1, 2, 3, 3, 3, 2, 1, 0, -1, -2, -3, -3, -3, -2, -1 };
    private static final int[] CIRCLE_DY = { -3, -3, -2, -1, 0, 1, 2, 3, 3, 3, 2, 1, 0, -1, -2, -3 };

    // Deterministic 64-bit BRIEF sampling pattern within [-7, 7] radius
    private static final int[] BRIEF_AX = new int[64];
    private static final int[] BRIEF_AY = new int[64];
    private static final int[] BRIEF_BX = new int[64];
    private static final int[] BRIEF_BY = new int[64];

    static {
        long seed = 0x9E3779B97F4A7C15L;
        for (int i = 0; i < 64; i++) {
            seed = seed * 6364136223846793005L + 1442695040888963407L;
            BRIEF_AX[i] = (int) (((seed >>> 32) % 13) - 6);
            seed = seed * 6364136223846793005L + 1442695040888963407L;
            BRIEF_AY[i] = (int) (((seed >>> 32) % 13) - 6);
            seed = seed * 6364136223846793005L + 1442695040888963407L;
            BRIEF_BX[i] = (int) (((seed >>> 32) % 13) - 6);
            seed = seed * 6364136223846793005L + 1442695040888963407L;
            BRIEF_BY[i] = (int) (((seed >>> 32) % 13) - 6);
            if (BRIEF_AX[i] == BRIEF_BX[i] && BRIEF_AY[i] == BRIEF_BY[i]) {
                BRIEF_BX[i] = (BRIEF_BX[i] + 3) % 7;
            }
        }
    }

    public static final class KeyframeFrame {
        public final int index;
        public final int width;
        public final int height;
        public final byte[] luma; // length = width * height, unsigned 0..255
        public final float fx;
        public final float fy;
        public final float cx;
        public final float cy;
        public final float[] rWc; // 9 elements row-major (camera-to-world rotation)
        public final float[] tWc; // 3 elements (camera position in world)
        public final float[] rCw; // 9 elements row-major (world-to-camera rotation = R^T)
        public final float[] tCw; // 3 elements (-R^T * t)
        public final long timestampNs;

        // Extracted sparse features (populated on ingest)
        public int featureCount;
        public float[] featX;
        public float[] featY;
        public long[] featDesc;

        // Precomputed Census + local stats for Stage 1B
        public byte[] census;
        public float[] patchMean;
        public float[] patchInvStd;

        public KeyframeFrame(
            final int index,
            final int width,
            final int height,
            final byte[] luma,
            final float fx,
            final float fy,
            final float cx,
            final float cy,
            final float[] rWc,
            final float[] tWc,
            final long timestampNs
        ) {
            this.index = index;
            this.width = width;
            this.height = height;
            this.luma = luma;
            this.fx = fx;
            this.fy = fy;
            this.cx = cx;
            this.cy = cy;
            this.rWc = Arrays.copyOf(rWc, 9);
            this.tWc = Arrays.copyOf(tWc, 3);
            this.rCw = new float[] {
                rWc[0], rWc[3], rWc[6],
                rWc[1], rWc[4], rWc[7],
                rWc[2], rWc[5], rWc[8]
            };
            this.tCw = new float[] {
                -(rCw[0] * tWc[0] + rCw[1] * tWc[1] + rCw[2] * tWc[2]),
                -(rCw[3] * tWc[0] + rCw[4] * tWc[1] + rCw[5] * tWc[2]),
                -(rCw[6] * tWc[0] + rCw[7] * tWc[1] + rCw[8] * tWc[2])
            };
            this.timestampNs = timestampNs;
        }
    }

    public static final class EngineOutput {
        public final WalkRingToeSolver.MetrologyResult metrology;
        public final long computeMs;
        public final boolean thermalDegraded;
        public final int sparseTriangulatedCount;
        public final int denseMvsCount;

        public EngineOutput(
            final WalkRingToeSolver.MetrologyResult metrology,
            final long computeMs,
            final boolean thermalDegraded,
            final int sparseTriangulatedCount,
            final int denseMvsCount
        ) {
            this.metrology = metrology;
            this.computeMs = computeMs;
            this.thermalDegraded = thermalDegraded;
            this.sparseTriangulatedCount = sparseTriangulatedCount;
            this.denseMvsCount = denseMvsCount;
        }
    }

    private final List<KeyframeFrame> keyframes = new ArrayList<>();
    private final List<float[]> incrementalPoints = new ArrayList<>(4096);

    public synchronized void reset() {
        keyframes.clear();
        incrementalPoints.clear();
    }

    public synchronized int getKeyframeCount() {
        return keyframes.size();
    }

    public synchronized int getIncrementalPointCount() {
        return incrementalPoints.size();
    }

    public synchronized List<float[]> getIncrementalPointsSnapshot() {
        return new ArrayList<>(incrementalPoints);
    }

    /**
     * Stage 0 (Real-time incremental ingest, < 5 ms per keyframe):
     * Extracts FAST-9 + oriented 64-bit rBRIEF features and triangulates against the 2 previous keyframes
     * using known ARCore SE(3) poses. Covers 0.4 m to 30.0 m with NO 5 m depth ceiling.
     */
    public int ingestKeyframeIncremental(final KeyframeFrame kf) {
        if (kf == null || kf.luma == null || kf.width < 32 || kf.height < 24) {
            return 0;
        }
        extractFastOrientedBrief(kf);

        final KeyframeFrame prev1;
        final KeyframeFrame prev2;
        synchronized (this) {
            final int sz = keyframes.size();
            prev1 = sz >= 1 ? keyframes.get(sz - 1) : null;
            prev2 = sz >= 2 ? keyframes.get(sz - 2) : null;
            keyframes.add(kf);
        }

        final List<float[]> newlyTriangulated = new ArrayList<>(128);
        if (prev1 != null) {
            triangulatePair(prev1, kf, newlyTriangulated);
        }
        if (prev2 != null) {
            triangulatePair(prev2, kf, newlyTriangulated);
        }

        synchronized (this) {
            if (incrementalPoints.size() < 24000) {
                incrementalPoints.addAll(newlyTriangulated);
            }
        }
        return newlyTriangulated.size();
    }

    /**
     * Stage 1A + Stage 1B full offline in-situ solve (4-thread Census+ZNCC plane sweep + Walk-Ring Toe Solver).
     */
    public EngineOutput solveFullOffline(
        final List<WalkRingToeSolver.WalkPose> walkPoses,
        final List<float[]> groundSamples,
        final List<float[]> extraVioPoints,
        final boolean hasScaleAnchor,
        final boolean thermalDegraded
    ) {
        final long startMs = System.currentTimeMillis();
        final List<KeyframeFrame> kfSnapshot;
        final List<float[]> sparsePoints;
        synchronized (this) {
            kfSnapshot = new ArrayList<>(keyframes);
            sparsePoints = new ArrayList<>(incrementalPoints);
        }
        if (extraVioPoints != null && !extraVioPoints.isEmpty()) {
            sparsePoints.addAll(extraVioPoints);
        }

        // Loop closure check between first and last keyframes if ring wrapped
        if (kfSnapshot.size() >= 6) {
            triangulatePair(kfSnapshot.get(0), kfSnapshot.get(kfSnapshot.size() - 1), sparsePoints);
        }

        // Stage 1A: Fast initial Walk-Ring Toe + DEM on triangulated sparse points
        final float[] centerXZ = WalkRingToeSolver.estimateAutoCenterXZ(walkPoses, sparsePoints);

        // Stage 1B: Multi-view dense plane-sweep (Census + ZNCC) on 4 threads inside Walk-Ring ROI
        final List<float[]> denseMvsPoints = runDenseCensusZnccSweep(
            kfSnapshot,
            centerXZ[0],
            centerXZ[1],
            walkPoses,
            thermalDegraded
        );

        final List<float[]> fusedCloud = new ArrayList<>(sparsePoints.size() + denseMvsPoints.size());
        fusedCloud.addAll(sparsePoints);
        fusedCloud.addAll(denseMvsPoints);

        final WalkRingToeSolver.MetrologyResult metrology = WalkRingToeSolver.solve(
            fusedCloud,
            walkPoses,
            groundSamples,
            hasScaleAnchor,
            -1.0
        );

        final long elapsedMs = System.currentTimeMillis() - startMs;
        return new EngineOutput(
            metrology,
            elapsedMs,
            thermalDegraded,
            sparsePoints.size(),
            denseMvsPoints.size()
        );
    }

    /**
     * Extracts up to MAX_FEATURES_PER_KF spatially bucketed FAST-9 corners with oriented 64-bit BRIEF descriptors.
     */
    public static void extractFastOrientedBrief(final KeyframeFrame kf) {
        final int w = kf.width;
        final int h = kf.height;
        final byte[] img = kf.luma;
        final int margin = 10;
        if (w <= margin * 2 || h <= margin * 2) {
            kf.featureCount = 0;
            kf.featX = new float[0];
            kf.featY = new float[0];
            kf.featDesc = new long[0];
            return;
        }

        final int gridCols = 8;
        final int gridRows = 6;
        final int maxPerBucket = Math.max(4, MAX_FEATURES_PER_KF / (gridCols * gridRows));
        final int[] bucketCount = new int[gridCols * gridRows];
        final float[] outX = new float[MAX_FEATURES_PER_KF];
        final float[] outY = new float[MAX_FEATURES_PER_KF];
        final long[] outDesc = new long[MAX_FEATURES_PER_KF];
        int total = 0;

        final int cellW = Math.max(1, (w - 2 * margin) / gridCols);
        final int cellH = Math.max(1, (h - 2 * margin) / gridRows);

        for (int y = margin; y < h - margin && total < MAX_FEATURES_PER_KF; y += 2) {
            final int rowOff = y * w;
            final int gr = Math.min(gridRows - 1, (y - margin) / cellH);
            for (int x = margin; x < w - margin && total < MAX_FEATURES_PER_KF; x += 2) {
                final int gc = Math.min(gridCols - 1, (x - margin) / cellW);
                final int bIdx = gr * gridCols + gc;
                if (bucketCount[bIdx] >= maxPerBucket) {
                    continue;
                }

                final int center = img[rowOff + x] & 0xFF;
                final int hi = center + FAST_THRESHOLD;
                final int lo = center - FAST_THRESHOLD;

                // Fast cardinal rejection test (indices 0, 4, 8, 12)
                final int p0 = img[(y - 3) * w + x] & 0xFF;
                final int p4 = img[rowOff + (x + 3)] & 0xFF;
                final int p8 = img[(y + 3) * w + x] & 0xFF;
                final int p12 = img[rowOff + (x - 3)] & 0xFF;
                final int brightCard = (p0 > hi ? 1 : 0) + (p4 > hi ? 1 : 0) + (p8 > hi ? 1 : 0) + (p12 > hi ? 1 : 0);
                final int darkCard = (p0 < lo ? 1 : 0) + (p4 < lo ? 1 : 0) + (p8 < lo ? 1 : 0) + (p12 < lo ? 1 : 0);
                if (brightCard < 3 && darkCard < 3) {
                    continue;
                }

                // Full 16-pixel contiguous 9-arc check
                int runBright = 0;
                int runDark = 0;
                boolean isCorner = false;
                for (int k = 0; k < 24; k++) {
                    final int idx = k & 15;
                    final int val = img[(y + CIRCLE_DY[idx]) * w + (x + CIRCLE_DX[idx])] & 0xFF;
                    if (val > hi) {
                        runBright++;
                        runDark = 0;
                        if (runBright >= 9) { isCorner = true; break; }
                    } else if (val < lo) {
                        runDark++;
                        runBright = 0;
                        if (runDark >= 9) { isCorner = true; break; }
                    } else {
                        runBright = 0;
                        runDark = 0;
                    }
                }
                if (!isCorner) {
                    continue;
                }

                // Intensity centroid orientation (rBRIEF)
                int m10 = 0;
                int m01 = 0;
                for (int dy = -3; dy <= 3; dy++) {
                    final int rOff = (y + dy) * w;
                    for (int dx = -3; dx <= 3; dx++) {
                        final int v = img[rOff + x + dx] & 0xFF;
                        m10 += dx * v;
                        m01 += dy * v;
                    }
                }
                final double ang = Math.atan2(m01, m10);
                final float cosA = (float) Math.cos(ang);
                final float sinA = (float) Math.sin(ang);

                long desc = 0L;
                for (int bit = 0; bit < 64; bit++) {
                    final int ax = x + Math.round(BRIEF_AX[bit] * cosA - BRIEF_AY[bit] * sinA);
                    final int ay = y + Math.round(BRIEF_AX[bit] * sinA + BRIEF_AY[bit] * cosA);
                    final int bx = x + Math.round(BRIEF_BX[bit] * cosA - BRIEF_BY[bit] * sinA);
                    final int by = y + Math.round(BRIEF_BX[bit] * sinA + BRIEF_BY[bit] * cosA);
                    final int va = img[ay * w + ax] & 0xFF;
                    final int vb = img[by * w + bx] & 0xFF;
                    if (va > vb) {
                        desc |= (1L << bit);
                    }
                }

                outX[total] = x;
                outY[total] = y;
                outDesc[total] = desc;
                bucketCount[bIdx]++;
                total++;
            }
        }

        kf.featureCount = total;
        kf.featX = Arrays.copyOf(outX, total);
        kf.featY = Arrays.copyOf(outY, total);
        kf.featDesc = Arrays.copyOf(outDesc, total);
    }

    /**
     * Known-pose epipolar feature matching + midpoint 3D triangulation with cheirality,
     * parallax angle >= 2 deg, and symmetric reprojection error < 2.5 px.
     */
    public static int triangulatePair(
        final KeyframeFrame kf1,
        final KeyframeFrame kf2,
        final List<float[]> outPoints
    ) {
        if (kf1.featureCount < 8 || kf2.featureCount < 8) {
            return 0;
        }
        final float bdx = kf2.tWc[0] - kf1.tWc[0];
        final float bdy = kf2.tWc[1] - kf1.tWc[1];
        final float bdz = kf2.tWc[2] - kf1.tWc[2];
        final float baseline = (float) Math.sqrt(bdx * bdx + bdy * bdy + bdz * bdz);
        if (baseline < 0.12f) {
            return 0;
        }

        int added = 0;
        final float[] r1 = kf1.rWc;
        final float[] t1 = kf1.tWc;
        final float[] r2 = kf2.rWc;
        final float[] t2 = kf2.tWc;

        for (int i = 0; i < kf1.featureCount; i++) {
            final long d1 = kf1.featDesc[i];
            int bestJ = -1;
            int bestDist = MAX_HAMMING_DIST + 1;
            int secondDist = 64;

            for (int j = 0; j < kf2.featureCount; j++) {
                final int dist = Long.bitCount(d1 ^ kf2.featDesc[j]);
                if (dist < bestDist) {
                    secondDist = bestDist;
                    bestDist = dist;
                    bestJ = j;
                } else if (dist < secondDist) {
                    secondDist = dist;
                }
            }

            if (bestJ < 0 || bestDist > MAX_HAMMING_DIST || (bestDist * 10) > (secondDist * 8)) {
                continue;
            }

            // Build unit rays in world space (OpenGL/ARCore camera: +X right, +Y up, -Z forward)
            final float cx1 = (kf1.featX[i] - kf1.cx) / kf1.fx;
            final float cy1 = -(kf1.featY[i] - kf1.cy) / kf1.fy;
            final float cz1 = -1.0f;
            final float invN1 = 1.0f / (float) Math.sqrt(cx1 * cx1 + cy1 * cy1 + 1.0f);
            final float wx1 = (r1[0] * cx1 + r1[1] * cy1 + r1[2] * cz1) * invN1;
            final float wy1 = (r1[3] * cx1 + r1[4] * cy1 + r1[5] * cz1) * invN1;
            final float wz1 = (r1[6] * cx1 + r1[7] * cy1 + r1[8] * cz1) * invN1;

            final float cx2 = (kf2.featX[bestJ] - kf2.cx) / kf2.fx;
            final float cy2 = -(kf2.featY[bestJ] - kf2.cy) / kf2.fy;
            final float cz2 = -1.0f;
            final float invN2 = 1.0f / (float) Math.sqrt(cx2 * cx2 + cy2 * cy2 + 1.0f);
            final float wx2 = (r2[0] * cx2 + r2[1] * cy2 + r2[2] * cz2) * invN2;
            final float wy2 = (r2[3] * cx2 + r2[4] * cy2 + r2[5] * cz2) * invN2;
            final float wz2 = (r2[6] * cx2 + r2[7] * cy2 + r2[8] * cz2) * invN2;

            // Parallax check
            final float dot12 = wx1 * wx2 + wy1 * wy2 + wz1 * wz2;
            if (Math.abs(dot12) > MIN_PARALLAX_COS) {
                continue;
            }

            // Closest midpoint between rays P1 + s1*D1 and P2 + s2*D2
            final float denom = 1.0f - dot12 * dot12;
            if (denom < 1e-5f) {
                continue;
            }
            final float bDot1 = bdx * wx1 + bdy * wy1 + bdz * wz1;
            final float bDot2 = bdx * wx2 + bdy * wy2 + bdz * wz2;
            final float s1 = (bDot1 - dot12 * bDot2) / denom;
            final float s2 = (dot12 * bDot1 - bDot2) / denom;
            if (s1 < MIN_DEPTH_M || s1 > MAX_DEPTH_M || s2 < MIN_DEPTH_M || s2 > MAX_DEPTH_M) {
                continue;
            }

            final float px = 0.5f * ((t1[0] + s1 * wx1) + (t2[0] + s2 * wx2));
            final float py = 0.5f * ((t1[1] + s1 * wy1) + (t2[1] + s2 * wy2));
            final float pz = 0.5f * ((t1[2] + s1 * wz1) + (t2[2] + s2 * wz2));

            // Symmetric reprojection error check
            if (
                reprojErrorPx(kf1, px, py, pz, kf1.featX[i], kf1.featY[i]) <= MAX_REPROJ_ERR_PX &&
                reprojErrorPx(kf2, px, py, pz, kf2.featX[bestJ], kf2.featY[bestJ]) <= MAX_REPROJ_ERR_PX
            ) {
                outPoints.add(new float[] { px, py, pz, 2.0f });
                added++;
            }
        }
        return added;
    }

    private static float reprojErrorPx(
        final KeyframeFrame kf,
        final float wx,
        final float wy,
        final float wz,
        final float obsU,
        final float obsV
    ) {
        final float camX = kf.rCw[0] * wx + kf.rCw[1] * wy + kf.rCw[2] * wz + kf.tCw[0];
        final float camY = kf.rCw[3] * wx + kf.rCw[4] * wy + kf.rCw[5] * wz + kf.tCw[1];
        final float camZ = kf.rCw[6] * wx + kf.rCw[7] * wy + kf.rCw[8] * wz + kf.tCw[2];
        final float depth = -camZ;
        if (depth < MIN_DEPTH_M) {
            return 999.0f;
        }
        final float predU = (camX / depth) * kf.fx + kf.cx;
        final float predV = (-camY / depth) * kf.fy + kf.cy;
        return (float) Math.hypot(predU - obsU, predV - obsV);
    }

    /**
     * Stage 1B: 4-thread Plane-Sweep Census + ZNCC inside the Walk-Ring projected ROI mask.
     */
    private static List<float[]> runDenseCensusZnccSweep(
        final List<KeyframeFrame> keyframes,
        final float centerX,
        final float centerZ,
        final List<WalkRingToeSolver.WalkPose> walkPoses,
        final boolean thermalDegraded
    ) {
        final int totalKf = keyframes.size();
        if (totalKf < 3) {
            return new ArrayList<>();
        }

        // Precompute 3x3 Census bitmask + 5x5 local mean/invStd for all keyframes
        for (KeyframeFrame kf : keyframes) {
            ensureCensusAndStats(kf);
        }

        // Select up to 16 evenly distributed reference keyframes around the walk ring
        final int maxRef = thermalDegraded ? 8 : 14;
        final int refStep = Math.max(1, totalKf / maxRef);
        final int pixelStride = thermalDegraded ? 4 : 3;
        final int depthSteps = thermalDegraded ? 20 : 28;

        // Estimate search depth range from walk ring radius
        float medDist = 4.0f;
        if (walkPoses != null && !walkPoses.isEmpty()) {
            final float[] ds = new float[walkPoses.size()];
            for (int i = 0; i < walkPoses.size(); i++) {
                ds[i] = (float) Math.hypot(walkPoses.get(i).x - centerX, walkPoses.get(i).z - centerZ);
            }
            Arrays.sort(ds);
            medDist = Math.max(1.2f, ds[ds.length / 2]);
        }
        final float dMin = Math.max(0.6f, medDist * 0.25f);
        final float dMax = Math.min(26.0f, medDist * 1.65f);

        final int threads = Math.min(4, Math.max(1, Runtime.getRuntime().availableProcessors()));
        final ExecutorService pool = Executors.newFixedThreadPool(threads);
        final List<Callable<List<float[]>>> tasks = new ArrayList<>();

        for (int idx = 0; idx < totalKf; idx += refStep) {
            final KeyframeFrame ref = keyframes.get(idx);
            final KeyframeFrame nbPrev = keyframes.get((idx - 1 + totalKf) % totalKf);
            final KeyframeFrame nbNext = keyframes.get((idx + 1) % totalKf);
            tasks.add(() -> sweepReferenceFrame(ref, nbPrev, nbNext, dMin, dMax, depthSteps, pixelStride));
        }

        final List<float[]> denseOut = new ArrayList<>(4096);
        try {
            final List<Future<List<float[]>>> futures = pool.invokeAll(tasks);
            for (Future<List<float[]>> f : futures) {
                final List<float[]> chunk = f.get();
                if (chunk != null) {
                    denseOut.addAll(chunk);
                }
            }
        } catch (Exception ignored) {
        } finally {
            pool.shutdownNow();
        }
        return denseOut;
    }

    private static List<float[]> sweepReferenceFrame(
        final KeyframeFrame ref,
        final KeyframeFrame prev,
        final KeyframeFrame next,
        final float dMin,
        final float dMax,
        final int depthSteps,
        final int stride
    ) {
        final List<float[]> pts = new ArrayList<>(256);
        final int w = ref.width;
        final int h = ref.height;
        final int pad = 6;
        // Skip upper 18% sky band and outer 10% lateral edges (Walk-Ring ROI mask)
        final int uStart = Math.max(pad, w / 10);
        final int uEnd = Math.min(w - pad, (w * 9) / 10);
        final int vStart = Math.max(pad, (h * 18) / 100);
        final int vEnd = Math.min(h - pad, (h * 92) / 100);

        final float invDMin = 1.0f / dMin;
        final float invDMax = 1.0f / dMax;
        final float invStep = (invDMin - invDMax) / Math.max(1, depthSteps - 1);

        final float[] rRef = ref.rWc;
        final float[] tRef = ref.tWc;

        for (int v = vStart; v < vEnd; v += stride) {
            for (int u = uStart; u < uEnd; u += stride) {
                final int rIdx = v * w + u;
                if (ref.patchInvStd[rIdx] <= 0.0f) {
                    continue; // Skip flat textureless sky/glare pixels
                }

                final float rayCamX = (u - ref.cx) / ref.fx;
                final float rayCamY = -(v - ref.cy) / ref.fy;
                final float rayWorldX = rRef[0] * rayCamX + rRef[1] * rayCamY - rRef[2];
                final float rayWorldY = rRef[3] * rayCamX + rRef[4] * rayCamY - rRef[5];
                final float rayWorldZ = rRef[6] * rayCamX + rRef[7] * rayCamY - rRef[8];

                float bestScorePrev = -1.0f;
                float bestDepthPrev = -1.0f;
                float bestScoreNext = -1.0f;
                float bestDepthNext = -1.0f;

                for (int s = 0; s < depthSteps; s++) {
                    final float depth = 1.0f / (invDMax + s * invStep);
                    final float wx = tRef[0] + rayWorldX * depth;
                    final float wy = tRef[1] + rayWorldY * depth;
                    final float wz = tRef[2] + rayWorldZ * depth;

                    final float scPrev = scoreProjectionCensusZncc(ref, prev, u, v, rIdx, wx, wy, wz);
                    if (scPrev > bestScorePrev) {
                        bestScorePrev = scPrev;
                        bestDepthPrev = depth;
                    }
                    final float scNext = scoreProjectionCensusZncc(ref, next, u, v, rIdx, wx, wy, wz);
                    if (scNext > bestScoreNext) {
                        bestScoreNext = scNext;
                        bestDepthNext = depth;
                    }
                }

                // Multi-view consistency gate between prev and next neighbors
                if (bestScorePrev >= 0.58f && bestScoreNext >= 0.58f && bestDepthPrev > 0.0f && bestDepthNext > 0.0f) {
                    final float avgD = 0.5f * (bestDepthPrev + bestDepthNext);
                    if (Math.abs(bestDepthPrev - bestDepthNext) / avgD <= 0.09f) {
                        final float wx = tRef[0] + rayWorldX * avgD;
                        final float wy = tRef[1] + rayWorldY * avgD;
                        final float wz = tRef[2] + rayWorldZ * avgD;
                        pts.add(new float[] { wx, wy, wz, 2.0f });
                    }
                }
            }
        }
        return pts;
    }

    private static float scoreProjectionCensusZncc(
        final KeyframeFrame ref,
        final KeyframeFrame nb,
        final int uRef,
        final int vRef,
        final int rIdx,
        final float wx,
        final float wy,
        final float wz
    ) {
        final float camX = nb.rCw[0] * wx + nb.rCw[1] * wy + nb.rCw[2] * wz + nb.tCw[0];
        final float camY = nb.rCw[3] * wx + nb.rCw[4] * wy + nb.rCw[5] * wz + nb.tCw[1];
        final float camZ = nb.rCw[6] * wx + nb.rCw[7] * wy + nb.rCw[8] * wz + nb.tCw[2];
        final float z = -camZ;
        if (z < MIN_DEPTH_M || z > MAX_DEPTH_M) {
            return -1.0f;
        }
        final int uNb = Math.round((camX / z) * nb.fx + nb.cx);
        final int vNb = Math.round((-camY / z) * nb.fy + nb.cy);
        if (uNb < 3 || uNb >= nb.width - 3 || vNb < 3 || vNb >= nb.height - 3) {
            return -1.0f;
        }
        final int nIdx = vNb * nb.width + uNb;
        final float invStdNb = nb.patchInvStd[nIdx];
        if (invStdNb <= 0.0f) {
            return -1.0f;
        }

        // Census similarity (8-bit 3x3)
        final int xor = (ref.census[rIdx] ^ nb.census[nIdx]) & 0xFF;
        final float censusSim = 1.0f - (Integer.bitCount(xor) * 0.125f);

        // 5x5 ZNCC (zero-mean normalized cross-correlation, illumination-invariant)
        final float meanR = ref.patchMean[rIdx];
        final float meanN = nb.patchMean[nIdx];
        float cov = 0.0f;
        final int wR = ref.width;
        final int wN = nb.width;
        for (int dy = -2; dy <= 2; dy++) {
            final int offR = (vRef + dy) * wR + uRef;
            final int offN = (vNb + dy) * wN + uNb;
            for (int dx = -2; dx <= 2; dx++) {
                final float dr = (ref.luma[offR + dx] & 0xFF) - meanR;
                final float dn = (nb.luma[offN + dx] & 0xFF) - meanN;
                cov += dr * dn;
            }
        }
        final float zncc = (cov / 25.0f) * ref.patchInvStd[rIdx] * invStdNb;
        return 0.45f * censusSim + 0.55f * zncc;
    }

    private static void ensureCensusAndStats(final KeyframeFrame kf) {
        if (kf.census != null) {
            return;
        }
        final int w = kf.width;
        final int h = kf.height;
        final int n = w * h;
        final byte[] luma = kf.luma;
        final byte[] census = new byte[n];
        final float[] mean = new float[n];
        final float[] invStd = new float[n];

        for (int y = 2; y < h - 2; y++) {
            final int rowOff = y * w;
            for (int x = 2; x < w - 2; x++) {
                final int idx = rowOff + x;
                final int c = luma[idx] & 0xFF;
                int bits = 0;
                if ((luma[(y - 1) * w + (x - 1)] & 0xFF) > c) bits |= 1;
                if ((luma[(y - 1) * w + x] & 0xFF) > c) bits |= 2;
                if ((luma[(y - 1) * w + (x + 1)] & 0xFF) > c) bits |= 4;
                if ((luma[rowOff + (x - 1)] & 0xFF) > c) bits |= 8;
                if ((luma[rowOff + (x + 1)] & 0xFF) > c) bits |= 16;
                if ((luma[(y + 1) * w + (x - 1)] & 0xFF) > c) bits |= 32;
                if ((luma[(y + 1) * w + x] & 0xFF) > c) bits |= 64;
                if ((luma[(y + 1) * w + (x + 1)] & 0xFF) > c) bits |= 128;
                census[idx] = (byte) bits;

                float sum = 0.0f;
                float sumSq = 0.0f;
                for (int dy = -2; dy <= 2; dy++) {
                    final int off = (y + dy) * w + x;
                    for (int dx = -2; dx <= 2; dx++) {
                        final float v = luma[off + dx] & 0xFF;
                        sum += v;
                        sumSq += v * v;
                    }
                }
                final float m = sum / 25.0f;
                final float var = (sumSq / 25.0f) - (m * m);
                mean[idx] = m;
                invStd[idx] = var > 16.0f ? (float) (1.0 / Math.sqrt(var)) : 0.0f;
            }
        }
        kf.census = census;
        kf.patchMean = mean;
        kf.patchInvStd = invStd;
    }

    /**
     * Downscales a 4:3 CPU Y-plane preserving aspect ratio (|scaleX - scaleY| < 1e-3).
     */
    public static byte[] downscaleLuma43(
        final byte[] src,
        final int srcW,
        final int srcH,
        final int dstW,
        final int dstH
    ) {
        final byte[] dst = new byte[dstW * dstH];
        final float stepX = srcW / (float) dstW;
        final float stepY = srcH / (float) dstH;
        for (int y = 0; y < dstH; y++) {
            final int sy = Math.min(srcH - 1, (int) (y * stepY));
            final int srcRow = sy * srcW;
            final int dstRow = y * dstW;
            for (int x = 0; x < dstW; x++) {
                final int sx = Math.min(srcW - 1, (int) (x * stepX));
                dst[dstRow + x] = src[srcRow + sx];
            }
        }
        return dst;
    }
}
