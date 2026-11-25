package com.minreport.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Pure-Java Walk-Ring Toe Solver, Gravity-Regularized Ground Plane Estimator,
 * Crater-Free 2.5D DEM Integrator, Honest Uncertainty Engine, and Live 3D Overlay Builder.
 *
 * Zero Android framework dependencies so it executes both on-device and in JVM JUnit tests.
 */
public final class WalkRingToeSolver {

    public static final int SECTOR_COUNT = 16;
    private static final int MAX_DEM_DIM = 64;
    private static final int PREVIEW_MAX_DIM = 32;
    private static final float MIN_CELL_SIZE_M = 0.08f;
    private static final float MAX_CELL_SIZE_M = 0.25f;
    private static final float MAX_GRAVITY_MISMATCH_DEG = 3.5f;

    private WalkRingToeSolver() {}

    public static final class WalkPose {
        public final float x;
        public final float y;
        public final float z;
        public final float fwdX;
        public final float fwdY;
        public final float fwdZ;
        public final long timestampNs;

        public WalkPose(
            final float x,
            final float y,
            final float z,
            final float fwdX,
            final float fwdY,
            final float fwdZ,
            final long timestampNs
        ) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.fwdX = fwdX;
            this.fwdY = fwdY;
            this.fwdZ = fwdZ;
            this.timestampNs = timestampNs;
        }
    }

    public static final class LocalPreviewMesh {
        public final String format = "dem_grid_v1";
        public final float originX;
        public final float originZ;
        public final float cellSizeM;
        public final int cols;
        public final int rows;
        public final float[] heightsM;
        public final byte[] observedMask;
        public final float groundSlopeDeg;
        public final float volumeM3;
        public final float maxHeightM;

        public LocalPreviewMesh(
            final float originX,
            final float originZ,
            final float cellSizeM,
            final int cols,
            final int rows,
            final float[] heightsM,
            final byte[] observedMask,
            final float groundSlopeDeg,
            final float volumeM3,
            final float maxHeightM
        ) {
            this.originX = originX;
            this.originZ = originZ;
            this.cellSizeM = cellSizeM;
            this.cols = cols;
            this.rows = rows;
            this.heightsM = heightsM;
            this.observedMask = observedMask;
            this.groundSlopeDeg = groundSlopeDeg;
            this.volumeM3 = volumeM3;
            this.maxHeightM = maxHeightM;
        }
    }

    public static final class LiveOverlaySnapshot {
        public final float[] verifiedTriVerts;
        public final float[] gapLineVerts;
        public final float[] contourLineVerts;
        public final float[] toeAnchoredLineVerts;
        public final float[] toeOpenLineVerts;
        public final float[] crownSamplePoints;
        public final float[] toeSamplePoints;
        public final float centerX;
        public final float centerY;
        public final float centerZ;
        public final float estDiameterM;
        public final float estHeightM;
        public final float estVolumeM3;

        public LiveOverlaySnapshot(
            final float[] verifiedTriVerts,
            final float[] gapLineVerts,
            final float[] contourLineVerts,
            final float[] toeAnchoredLineVerts,
            final float[] toeOpenLineVerts,
            final float[] crownSamplePoints,
            final float[] toeSamplePoints,
            final float centerX,
            final float centerY,
            final float centerZ,
            final float estDiameterM,
            final float estHeightM,
            final float estVolumeM3
        ) {
            this.verifiedTriVerts = verifiedTriVerts;
            this.gapLineVerts = gapLineVerts;
            this.contourLineVerts = contourLineVerts;
            this.toeAnchoredLineVerts = toeAnchoredLineVerts;
            this.toeOpenLineVerts = toeOpenLineVerts;
            this.crownSamplePoints = crownSamplePoints;
            this.toeSamplePoints = toeSamplePoints;
            this.centerX = centerX;
            this.centerY = centerY;
            this.centerZ = centerZ;
            this.estDiameterM = estDiameterM;
            this.estHeightM = estHeightM;
            this.estVolumeM3 = estVolumeM3;
        }
    }

    public static final class MetrologyResult {
        public final double volumeM3;
        public final double dimA;
        public final double dimB;
        public final double dimH;
        public final double groundSlopeDeg;
        public final double slopeAngleAvgDeg;
        public final double toeScore;
        public final double occludedVolumePct;
        public final double loopDriftPct;
        public final double planeMismatchDeg;
        public final double uncertaintyPct;
        public final int zeroCellsInside;
        public final int observedCells;
        public final int totalFootprintCells;
        public final int densePointsCount;
        public final boolean loopClosed;
        public final String metrologyGrade;
        public final String wallConfinement;
        public final float anchorX;
        public final float anchorY;
        public final float anchorZ;
        public final float roiRadiusM;
        public final double planeA;
        public final double planeB;
        public final double planeD;
        public final LocalPreviewMesh previewMesh;
        public final List<float[]> stratifiedPointsM;
        public final List<float[]> filteredGroundM;
        public final LiveOverlaySnapshot liveOverlay;

        public MetrologyResult(
            final double volumeM3,
            final double dimA,
            final double dimB,
            final double dimH,
            final double groundSlopeDeg,
            final double slopeAngleAvgDeg,
            final double toeScore,
            final double occludedVolumePct,
            final double loopDriftPct,
            final double planeMismatchDeg,
            final double uncertaintyPct,
            final int zeroCellsInside,
            final int observedCells,
            final int totalFootprintCells,
            final int densePointsCount,
            final boolean loopClosed,
            final String metrologyGrade,
            final String wallConfinement,
            final float anchorX,
            final float anchorY,
            final float anchorZ,
            final float roiRadiusM,
            final double planeA,
            final double planeB,
            final double planeD,
            final LocalPreviewMesh previewMesh,
            final List<float[]> stratifiedPointsM,
            final List<float[]> filteredGroundM,
            final LiveOverlaySnapshot liveOverlay
        ) {
            this.volumeM3 = volumeM3;
            this.dimA = dimA;
            this.dimB = dimB;
            this.dimH = dimH;
            this.groundSlopeDeg = groundSlopeDeg;
            this.slopeAngleAvgDeg = slopeAngleAvgDeg;
            this.toeScore = toeScore;
            this.occludedVolumePct = occludedVolumePct;
            this.loopDriftPct = loopDriftPct;
            this.planeMismatchDeg = planeMismatchDeg;
            this.uncertaintyPct = uncertaintyPct;
            this.zeroCellsInside = zeroCellsInside;
            this.observedCells = observedCells;
            this.totalFootprintCells = totalFootprintCells;
            this.densePointsCount = densePointsCount;
            this.loopClosed = loopClosed;
            this.metrologyGrade = metrologyGrade;
            this.wallConfinement = wallConfinement;
            this.anchorX = anchorX;
            this.anchorY = anchorY;
            this.anchorZ = anchorZ;
            this.roiRadiusM = roiRadiusM;
            this.planeA = planeA;
            this.planeB = planeB;
            this.planeD = planeD;
            this.previewMesh = previewMesh;
            this.stratifiedPointsM = stratifiedPointsM;
            this.filteredGroundM = filteredGroundM;
            this.liveOverlay = liveOverlay;
        }
    }

    /**
     * Estimates the horizontal stockpile center (cx, cz) by least-squares intersection of camera -Z optical rays.
     * Robust both for full 360-degree walk-rings and partial 150-240 degree arcs against walls/bunkers.
     */
    public static float[] estimateAutoCenterXZ(
        final List<WalkPose> walkPoses,
        final List<float[]> points3D
    ) {
        if (walkPoses != null && walkPoses.size() >= 3) {
            double h00 = 0.0;
            double h01 = 0.0;
            double h11 = 0.0;
            double b0 = 0.0;
            double b1 = 0.0;
            int validRays = 0;

            double sumPx = 0.0;
            double sumPz = 0.0;
            for (WalkPose wp : walkPoses) {
                sumPx += wp.x;
                sumPz += wp.z;
                final double lenXZ = Math.hypot(wp.fwdX, wp.fwdZ);
                if (lenXZ < 0.15) {
                    continue;
                }
                final double dx = wp.fwdX / lenXZ;
                final double dz = wp.fwdZ / lenXZ;
                final double nx = -dz;
                final double nz = dx;
                final double rhs = nx * wp.x + nz * wp.z;
                h00 += nx * nx;
                h01 += nx * nz;
                h11 += nz * nz;
                b0 += nx * rhs;
                b1 += nz * rhs;
                validRays++;
            }

            final double meanPx = sumPx / walkPoses.size();
            final double meanPz = sumPz / walkPoses.size();

            if (validRays >= 3) {
                final double det = h00 * h11 - h01 * h01;
                if (Math.abs(det) > 1e-5) {
                    final double cx = (h11 * b0 - h01 * b1) / det;
                    final double cz = (-h01 * b0 + h00 * b1) / det;

                    // Verify majority of rays point forward toward (cx, cz) and distance is sane (< 25m)
                    int forwardOk = 0;
                    double meanDist = 0.0;
                    for (WalkPose wp : walkPoses) {
                        final double vx = cx - wp.x;
                        final double vz = cz - wp.z;
                        final double d = Math.hypot(vx, vz);
                        meanDist += d;
                        if (vx * wp.fwdX + vz * wp.fwdZ > 0.0) {
                            forwardOk++;
                        }
                    }
                    meanDist /= walkPoses.size();
                    if (forwardOk >= (walkPoses.size() * 6) / 10 && meanDist >= 0.4 && meanDist <= 25.0) {
                        return new float[] { (float) cx, (float) cz };
                    }
                }
            }
            return new float[] { (float) meanPx, (float) meanPz };
        }

        if (points3D != null && !points3D.isEmpty()) {
            final float[] xs = new float[points3D.size()];
            final float[] zs = new float[points3D.size()];
            for (int i = 0; i < points3D.size(); i++) {
                final float[] p = points3D.get(i);
                xs[i] = p[0];
                zs[i] = p[2];
            }
            Arrays.sort(xs);
            Arrays.sort(zs);
            return new float[] { xs[xs.length / 2], zs[zs.length / 2] };
        }
        return new float[] { 0.0f, 0.0f };
    }

    public static MetrologyResult solve(
        final List<float[]> rawPoints3D,
        final List<WalkPose> walkPoses,
        final List<float[]> rawGroundSamples,
        final boolean hasScaleAnchor,
        final double explicitLoopDriftPct
    ) {
        final List<float[]> points = rawPoints3D != null ? rawPoints3D : new ArrayList<>();
        final List<WalkPose> poses = walkPoses != null ? walkPoses : new ArrayList<>();
        final List<float[]> groundInput = rawGroundSamples != null ? rawGroundSamples : new ArrayList<>();

        if (points.size() < 12) {
            return buildRejectedResult(points, groundInput, poses, explicitLoopDriftPct);
        }

        final float[] centerXZ = estimateAutoCenterXZ(poses, points);
        final float cx = centerXZ[0];
        final float cz = centerXZ[1];

        // 1. Analyze Walk-Ring geometry (median cam Y, perimeter, arc span, radius envelope)
        final float medianCamY = computeMedianCamY(poses);
        final boolean hasWalkPoses = poses.size() >= 3;
        final float walkMinRadius = computeWalkRingMinRadius(poses, cx, cz);
        final float walkMedianRadius = computeWalkRingMedianRadius(poses, cx, cz);
        final double arcSpanDeg = computeWalkArcSpanDeg(poses, cx, cz);
        final boolean loopClosed = computeLoopClosed(poses, cx, cz, arcSpanDeg);
        final double loopDriftPct = explicitLoopDriftPct >= 0.0
            ? explicitLoopDriftPct
            : estimateWalkLoopDriftPct(poses, loopClosed);

        // 2. Filter ground samples strictly below camera corridor (y <= medianCamY - 0.8f)
        final List<float[]> filteredGround = new ArrayList<>();
        final float maxGroundY = hasWalkPoses ? (medianCamY - 0.80f) : Float.MAX_VALUE;
        for (float[] g : groundInput) {
            if (g == null || g.length < 3) {
                continue;
            }
            if (!Float.isFinite(g[0]) || !Float.isFinite(g[1]) || !Float.isFinite(g[2])) {
                continue;
            }
            if (g[1] <= maxGroundY) {
                filteredGround.add(new float[] { g[0], g[1], g[2] });
            }
        }

        // 3. Soft radial envelope from walk ring (NEVER hard-truncates stockpile to 1 m!)
        final float radialEnvelope;
        if (hasWalkPoses && walkMedianRadius > 1.2f) {
            radialEnvelope = Math.max(walkMedianRadius * 1.15f, walkMinRadius + 0.5f);
        } else {
            radialEnvelope = estimatePointCloudP98Radius(points, cx, cz) * 1.05f;
        }

        final List<float[]> inEnvelopePoints = new ArrayList<>(points.size());
        for (float[] p : points) {
            if (p == null || p.length < 3) {
                continue;
            }
            if (!Float.isFinite(p[0]) || !Float.isFinite(p[1]) || !Float.isFinite(p[2])) {
                continue;
            }
            final float r = (float) Math.hypot(p[0] - cx, p[2] - cz);
            if (r <= radialEnvelope) {
                inEnvelopePoints.add(p);
            }
        }
        if (inEnvelopePoints.size() < 12) {
            inEnvelopePoints.clear();
            inEnvelopePoints.addAll(points);
        }

        // 4. Gravity-Regularized Walk-Ring Toe Ground Plane Solver
        final double walkRingSlopeDeg = estimateWalkRingSlopeDeg(poses);
        final double[] groundCandidatesPlane = fitGravityRegularizedGroundPlane(
            inEnvelopePoints,
            filteredGround,
            poses,
            cx,
            cz,
            walkRingSlopeDeg
        );
        final double planeA = groundCandidatesPlane[0];
        final double planeB = groundCandidatesPlane[1];
        final double planeD = groundCandidatesPlane[2];
        final double groundSlopeDeg = Math.toDegrees(Math.atan(Math.hypot(planeA, planeB)));
        final double planeMismatchDeg = Math.abs(groundSlopeDeg - walkRingSlopeDeg);
        final double groundRmsM = groundCandidatesPlane[3];

        // 5. Detect wall confinement (SINGLE_WALL / BUNKER_3_WALLS) for partial arcs
        final String wallConfinement = detectWallConfinement(
            inEnvelopePoints,
            arcSpanDeg,
            planeA,
            planeB,
            planeD
        );

        // 6. Compute adaptive 2.5D DEM grid (cellSizeM in [0.08, 0.25], nx/nz <= 64)
        float minX = Float.MAX_VALUE;
        float maxX = -Float.MAX_VALUE;
        float minZ = Float.MAX_VALUE;
        float maxZ = -Float.MAX_VALUE;
        int aboveCount = 0;
        for (float[] p : inEnvelopePoints) {
            final double gy = planeA * p[0] + planeB * p[2] + planeD;
            final double h = p[1] - gy;
            if (h >= 0.02) {
                if (p[0] < minX) minX = p[0];
                if (p[0] > maxX) maxX = p[0];
                if (p[2] < minZ) minZ = p[2];
                if (p[2] > maxZ) maxZ = p[2];
                aboveCount++;
            }
        }
        if (aboveCount < 8 || maxX <= minX || maxZ <= minZ) {
            return buildRejectedResult(inEnvelopePoints, filteredGround, poses, loopDriftPct);
        }

        final float spanX = maxX - minX;
        final float spanZ = maxZ - minZ;
        final float maxSpan = Math.max(spanX, spanZ);
        final float cellSizeM = clamp((float) (maxSpan / 56.0), MIN_CELL_SIZE_M, MAX_CELL_SIZE_M);

        // Add 1-cell border padding
        final float originX = minX - cellSizeM;
        final float originZ = minZ - cellSizeM;
        final int cols = Math.min(MAX_DEM_DIM, Math.max(4, (int) Math.ceil((spanX + 2.0f * cellSizeM) / cellSizeM)));
        final int rows = Math.min(MAX_DEM_DIM, Math.max(4, (int) Math.ceil((spanZ + 2.0f * cellSizeM) / cellSizeM)));
        final int cellCount = cols * rows;

        // Bucket heights per cell to compute robust p50 median + obs count
        @SuppressWarnings("unchecked")
        final ArrayList<Float>[] buckets = new ArrayList[cellCount];
        final int[] obsCount = new int[cellCount];
        for (float[] p : inEnvelopePoints) {
            final double gy = planeA * p[0] + planeB * p[2] + planeD;
            final float h = (float) (p[1] - gy);
            if (h < 0.0f) {
                continue;
            }
            final int col = (int) Math.floor((p[0] - originX) / cellSizeM);
            final int row = (int) Math.floor((p[2] - originZ) / cellSizeM);
            if (col < 0 || col >= cols || row < 0 || row >= rows) {
                continue;
            }
            final int idx = row * cols + col;
            if (buckets[idx] == null) {
                buckets[idx] = new ArrayList<>(4);
            }
            buckets[idx].add(h);
            obsCount[idx] += (p.length >= 4 && p[3] >= 1.0f) ? Math.round(p[3]) : 1;
        }

        final float[] rawHeights = new float[cellCount];
        final byte[] observedMask = new byte[cellCount];
        int observedCells = 0;
        for (int i = 0; i < cellCount; i++) {
            final ArrayList<Float> list = buckets[i];
            if (list != null && !list.isEmpty()) {
                final float[] arr = new float[list.size()];
                for (int k = 0; k < list.size(); k++) {
                    arr[k] = list.get(k);
                }
                Arrays.sort(arr);
                final float med = arr[arr.length / 2];
                if (med >= 0.02f) {
                    rawHeights[i] = med;
                    observedMask[i] = 1;
                    observedCells++;
                }
            }
        }

        // 7. Build contiguous footprint mask by scanline + radial convex hull closure
        final byte[] footprintMask = buildFootprintMask(observedMask, cols, rows);

        // 8. Crater-Free Multiscale / Harmonic IDW interpolation (guarantees zeroCellsInside == 0)
        final float[] heights = Arrays.copyOf(rawHeights, cellCount);
        fillInteriorHolesCraterFree(heights, observedMask, footprintMask, cols, rows);

        // Verify zeroCellsInside and compute volume, occludedVolumePct, and p99 height
        final float cellArea = cellSizeM * cellSizeM;
        double totalVol = 0.0;
        double occludedVol = 0.0;
        int totalFootprintCells = 0;
        int zeroCellsInside = 0;
        final float[] fpHeights = new float[cellCount];
        int fpCount = 0;

        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                final int idx = r * cols + c;
                if (footprintMask[idx] == 0) {
                    continue;
                }
                totalFootprintCells++;
                final float h = heights[idx];
                if (h <= 1e-4f) {
                    zeroCellsInside++;
                } else {
                    totalVol += h * cellArea;
                    if (observedMask[idx] == 0) {
                        occludedVol += h * cellArea;
                    }
                    fpHeights[fpCount++] = h;
                }
            }
        }

        if (fpCount == 0 || totalVol <= 1e-4) {
            return buildRejectedResult(inEnvelopePoints, filteredGround, poses, loopDriftPct);
        }

        Arrays.sort(fpHeights, 0, fpCount);
        final double dimH = fpHeights[Math.min(fpCount - 1, (int) Math.floor(fpCount * 0.99))];
        final double occludedVolumePct = totalVol > 0.0 ? (occludedVol / totalVol) * 100.0 : 0.0;

        // 9. Footprint principal dimensions (a, b) via 2D covariance eigenvalues
        final double[] dimsAB = computeFootprintDimensionsAB(footprintMask, cols, rows, cellSizeM);
        final double dimA = dimsAB[0];
        final double dimB = dimsAB[1];

        // 10. Slope angle strictly on contiguous observed cells relative to +Y gravity
        final double slopeAngleAvgDeg = computeObservedSlopeAngleDeg(
            heights,
            observedMask,
            cols,
            rows,
            cellSizeM,
            (float) dimH
        );

        // 11. Toe coverage score across 16 sectors + honest uncertainty formula
        final boolean[] toeSectorAnchored = computeToeSectorAnchored(
            filteredGround,
            inEnvelopePoints,
            cx,
            cz,
            planeA,
            planeB,
            planeD
        );
        int anchoredSectors = 0;
        for (boolean anchored : toeSectorAnchored) {
            if (anchored) anchoredSectors++;
        }
        final double angularToePct = (anchoredSectors / (double) SECTOR_COUNT) * 100.0;
        final double rmsScore = clamp((float) (1.0 - (groundRmsM / 0.12)), 0.0f, 1.0f) * 25.0;
        final double obsCoverageRatio = totalFootprintCells > 0
            ? (observedCells / (double) totalFootprintCells)
            : 0.0;
        final double toeScore = clamp(
            (float) (angularToePct * 0.60 + rmsScore + Math.min(1.0, obsCoverageRatio) * 15.0),
            0.0f,
            100.0f
        );

        final double rawUncertainty =
            3.5
            + 1.5 * loopDriftPct
            + 0.35 * occludedVolumePct
            + 0.12 * Math.max(0.0, 80.0 - toeScore)
            + 1.2 * Math.max(0.0, planeMismatchDeg)
            + (loopClosed ? 0.0 : 3.5)
            - (hasScaleAnchor ? 1.5 : 0.0);
        final double uncertaintyPct = Math.max(2.5, Math.min(45.0, rawUncertainty));

        final String metrologyGrade;
        if (
            uncertaintyPct > 25.0 ||
            toeScore < 45.0 ||
            loopDriftPct > 5.0 ||
            occludedVolumePct > 40.0 ||
            totalVol <= 0.02
        ) {
            metrologyGrade = "REJECTED";
        } else if (uncertaintyPct > 12.0) {
            metrologyGrade = "LOW_CONFIDENCE_RECAPTURE";
        } else {
            metrologyGrade = "VALID_IN_SITU";
        }

        final float anchorY = (float) (planeA * cx + planeB * cz + planeD);
        final float effectiveRadiusM = (float) Math.max(0.35, Math.max(dimA, dimB) * 0.5);

        // 12. Build compact < 60 KB localPreviewMesh (<= 32x32)
        final LocalPreviewMesh previewMesh = buildLocalPreviewMesh(
            originX,
            originZ,
            cellSizeM,
            cols,
            rows,
            heights,
            observedMask,
            (float) groundSlopeDeg,
            (float) totalVol,
            (float) dimH
        );

        // 13. Build stratified output cloud (uniformly sampled across DEM + raw high-confidence points)
        final List<float[]> stratifiedPoints = buildStratifiedCloud(
            originX,
            originZ,
            cellSizeM,
            cols,
            rows,
            heights,
            footprintMask,
            planeA,
            planeB,
            planeD,
            inEnvelopePoints
        );

        // 14. Build compact GLES 2.0 live overlay snapshot (<= 4096 vertices)
        final LiveOverlaySnapshot overlay = buildLiveOverlaySnapshot(
            originX,
            originZ,
            cellSizeM,
            cols,
            rows,
            heights,
            observedMask,
            footprintMask,
            obsCount,
            planeA,
            planeB,
            planeD,
            toeSectorAnchored,
            cx,
            anchorY,
            cz,
            (float) Math.max(dimA, dimB),
            (float) dimH,
            (float) totalVol
        );

        return new MetrologyResult(
            totalVol,
            dimA,
            dimB,
            dimH,
            groundSlopeDeg,
            slopeAngleAvgDeg,
            toeScore,
            occludedVolumePct,
            loopDriftPct,
            planeMismatchDeg,
            uncertaintyPct,
            zeroCellsInside,
            observedCells,
            totalFootprintCells,
            inEnvelopePoints.size(),
            loopClosed,
            metrologyGrade,
            wallConfinement,
            cx,
            anchorY,
            cz,
            effectiveRadiusM,
            planeA,
            planeB,
            planeD,
            previewMesh,
            stratifiedPoints,
            filteredGround,
            overlay
        );
    }

    private static MetrologyResult buildRejectedResult(
        final List<float[]> points,
        final List<float[]> ground,
        final List<WalkPose> poses,
        final double driftPct
    ) {
        final float[] c = estimateAutoCenterXZ(poses, points);
        final LocalPreviewMesh emptyMesh = new LocalPreviewMesh(
            c[0], c[1], 0.25f, 1, 1, new float[] { 0.0f }, new byte[] { 0 }, 0.0f, 0.0f, 0.0f
        );
        return new MetrologyResult(
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 100.0,
            Math.max(0.0, driftPct), 0.0, 45.0, 0, 0, 0, points.size(),
            false, "REJECTED", "NONE",
            c[0], 0.0f, c[1], 1.0f,
            0.0, 0.0, 0.0,
            emptyMesh, points, ground, null
        );
    }

    private static double[] fitGravityRegularizedGroundPlane(
        final List<float[]> points,
        final List<float[]> groundSamples,
        final List<WalkPose> walkPoses,
        final float cx,
        final float cz,
        final double walkRingSlopeDeg
    ) {
        final List<float[]> candidates = new ArrayList<>();
        candidates.addAll(groundSamples);

        // Add lower-quantile (p10) outer perimeter points per 16 angular sectors
        @SuppressWarnings("unchecked")
        final ArrayList<float[]>[] sectorPts = new ArrayList[SECTOR_COUNT];
        final float[] sectorMaxR = new float[SECTOR_COUNT];
        for (float[] p : points) {
            final double dx = p[0] - cx;
            final double dz = p[2] - cz;
            final float r = (float) Math.hypot(dx, dz);
            double deg = Math.toDegrees(Math.atan2(dz, dx));
            if (deg < 0.0) deg += 360.0;
            final int s = Math.min(SECTOR_COUNT - 1, Math.max(0, (int) Math.floor(deg / (360.0 / SECTOR_COUNT))));
            if (sectorPts[s] == null) {
                sectorPts[s] = new ArrayList<>();
            }
            sectorPts[s].add(p);
            if (r > sectorMaxR[s]) {
                sectorMaxR[s] = r;
            }
        }

        for (int s = 0; s < SECTOR_COUNT; s++) {
            final ArrayList<float[]> list = sectorPts[s];
            if (list == null || list.isEmpty()) {
                continue;
            }
            final float minOuterR = sectorMaxR[s] * 0.65f;
            final ArrayList<float[]> outer = new ArrayList<>();
            for (float[] p : list) {
                final float r = (float) Math.hypot(p[0] - cx, p[2] - cz);
                if (r >= minOuterR) {
                    outer.add(p);
                }
            }
            if (outer.isEmpty()) {
                continue;
            }
            outer.sort((p1, p2) -> Float.compare(p1[1], p2[1]));
            final int take = Math.max(1, Math.min(4, outer.size() / 6 + 1));
            for (int k = 0; k < take; k++) {
                candidates.add(outer.get(k));
            }
        }

        if (candidates.size() < 3) {
            float minY = Float.MAX_VALUE;
            for (float[] p : points) {
                if (p[1] < minY) minY = p[1];
            }
            return new double[] { 0.0, 0.0, minY == Float.MAX_VALUE ? 0.0 : minY, 0.05 };
        }

        // Deterministic RANSAC over candidate triplets
        final int n = candidates.size();
        double bestScore = -Double.MAX_VALUE;
        double bestA = 0.0;
        double bestB = 0.0;
        double bestD = medianY(candidates);
        final double maxSlopeTan = Math.tan(Math.toRadians(Math.min(14.0, walkRingSlopeDeg + MAX_GRAVITY_MISMATCH_DEG + 4.0)));

        final int trials = Math.min(120, Math.max(20, n * 2));
        long rng = 0x5DEECE66DL;
        for (int t = 0; t < trials; t++) {
            rng = (rng * 25214903917L + 11L) & ((1L << 48) - 1L);
            final int i0 = (int) (rng % n);
            rng = (rng * 25214903917L + 11L) & ((1L << 48) - 1L);
            final int i1 = (int) (rng % n);
            rng = (rng * 25214903917L + 11L) & ((1L << 48) - 1L);
            final int i2 = (int) (rng % n);
            if (i0 == i1 || i1 == i2 || i0 == i2) {
                continue;
            }
            final float[] p0 = candidates.get(i0);
            final float[] p1 = candidates.get(i1);
            final float[] p2 = candidates.get(i2);
            final double[] plane = fitPlane3Points(p0, p1, p2);
            if (plane == null) {
                continue;
            }
            final double a = plane[0];
            final double b = plane[1];
            final double d = plane[2];
            final double slopeTan = Math.hypot(a, b);
            if (slopeTan > maxSlopeTan) {
                continue;
            }

            final double invNorm = 1.0 / Math.sqrt(1.0 + a * a + b * b);
            int inliers = 0;
            int deepBelow = 0;
            for (float[] c : candidates) {
                final double err = (c[1] - (a * c[0] + b * c[2] + d)) * invNorm;
                if (Math.abs(err) <= 0.06) {
                    inliers++;
                } else if (err < -0.06) {
                    deepBelow++;
                }
            }
            final double slopeDeg = Math.toDegrees(Math.atan(slopeTan));
            final double gravityPenalty = Math.max(0.0, Math.abs(slopeDeg - walkRingSlopeDeg) - 1.5) * 1.5;
            final double score = inliers - deepBelow * 1.5 - gravityPenalty;
            if (score > bestScore) {
                bestScore = score;
                bestA = a;
                bestB = b;
                bestD = d;
            }
        }

        // Refine via OLS on inliers
        final double invBestNorm = 1.0 / Math.sqrt(1.0 + bestA * bestA + bestB * bestB);
        final List<float[]> inliers = new ArrayList<>();
        for (float[] c : candidates) {
            final double err = (c[1] - (bestA * c[0] + bestB * c[2] + bestD)) * invBestNorm;
            if (Math.abs(err) <= 0.08) {
                inliers.add(c);
            }
        }
        if (inliers.size() >= 3) {
            final double[] ols = fitPlaneOLS(inliers);
            if (ols != null) {
                bestA = ols[0];
                bestB = ols[1];
                bestD = ols[2];
            }
        }

        // Strict gravity regularization: clamp |slope - walkRingSlope| <= 3.5 deg
        final double fittedSlopeDeg = Math.toDegrees(Math.atan(Math.hypot(bestA, bestB)));
        final double maxAllowedDeg = walkRingSlopeDeg + MAX_GRAVITY_MISMATCH_DEG;
        if (fittedSlopeDeg > maxAllowedDeg) {
            if (walkRingSlopeDeg < 0.8 && groundSamples.size() < 8) {
                bestA = 0.0;
                bestB = 0.0;
            } else {
                final double targetTan = Math.tan(Math.toRadians(maxAllowedDeg));
                final double curTan = Math.hypot(bestA, bestB);
                if (curTan > 1e-6) {
                    final double scale = targetTan / curTan;
                    bestA *= scale;
                    bestB *= scale;
                }
            }
            // Refit d at p15 of ground candidates
            final List<float[]> refList = inliers.size() >= 3 ? inliers : candidates;
            final double[] offsets = new double[refList.size()];
            for (int i = 0; i < refList.size(); i++) {
                final float[] p = refList.get(i);
                offsets[i] = p[1] - (bestA * p[0] + bestB * p[2]);
            }
            Arrays.sort(offsets);
            bestD = offsets[Math.max(0, (int) Math.floor(offsets.length * 0.15))];
        }

        // Compute RMS on ground inliers
        double sumSq = 0.0;
        final List<float[]> rmsPts = !inliers.isEmpty() ? inliers : candidates;
        final double norm = 1.0 / Math.sqrt(1.0 + bestA * bestA + bestB * bestB);
        for (float[] p : rmsPts) {
            final double err = (p[1] - (bestA * p[0] + bestB * p[2] + bestD)) * norm;
            sumSq += err * err;
        }
        final double rms = Math.sqrt(sumSq / Math.max(1, rmsPts.size()));
        return new double[] { bestA, bestB, bestD, rms };
    }

    private static byte[] buildFootprintMask(final byte[] observedMask, final int cols, final int rows) {
        final byte[] mask = Arrays.copyOf(observedMask, cols * rows);

        // 1. Horizontal scanline fill between leftmost and rightmost observed cell per row
        for (int r = 0; r < rows; r++) {
            int first = -1;
            int last = -1;
            for (int c = 0; c < cols; c++) {
                if (observedMask[r * cols + c] != 0) {
                    if (first < 0) first = c;
                    last = c;
                }
            }
            if (first >= 0 && last > first) {
                for (int c = first; c <= last; c++) {
                    mask[r * cols + c] = 1;
                }
            }
        }

        // 2. Vertical scanline fill intersected with morphological hull to close vertical concavities
        final byte[] vMask = Arrays.copyOf(observedMask, cols * rows);
        for (int c = 0; c < cols; c++) {
            int first = -1;
            int last = -1;
            for (int r = 0; r < rows; r++) {
                if (observedMask[r * cols + c] != 0) {
                    if (first < 0) first = r;
                    last = r;
                }
            }
            if (first >= 0 && last > first) {
                for (int r = first; r <= last; r++) {
                    vMask[r * cols + c] = 1;
                }
            }
        }

        // Intersection of H-scanline and V-scanline closes interior holes without inflating exterior corners
        for (int i = 0; i < mask.length; i++) {
            if (observedMask[i] != 0 || (mask[i] != 0 && vMask[i] != 0)) {
                mask[i] = 1;
            } else {
                mask[i] = 0;
            }
        }

        // Close any remaining 1-cell interior gaps (flood-fill exterior from border)
        final byte[] exterior = new byte[cols * rows];
        final int[] queue = new int[cols * rows];
        int head = 0;
        int tail = 0;
        for (int c = 0; c < cols; c++) {
            if (mask[c] == 0) {
                exterior[c] = 1;
                queue[tail++] = c;
            }
            final int bot = (rows - 1) * cols + c;
            if (mask[bot] == 0 && exterior[bot] == 0) {
                exterior[bot] = 1;
                queue[tail++] = bot;
            }
        }
        for (int r = 1; r < rows - 1; r++) {
            final int left = r * cols;
            if (mask[left] == 0 && exterior[left] == 0) {
                exterior[left] = 1;
                queue[tail++] = left;
            }
            final int right = r * cols + (cols - 1);
            if (mask[right] == 0 && exterior[right] == 0) {
                exterior[right] = 1;
                queue[tail++] = right;
            }
        }
        while (head < tail) {
            final int cur = queue[head++];
            final int cr = cur / cols;
            final int cc = cur % cols;
            if (cr > 0) {
                final int ni = cur - cols;
                if (mask[ni] == 0 && exterior[ni] == 0) { exterior[ni] = 1; queue[tail++] = ni; }
            }
            if (cr + 1 < rows) {
                final int ni = cur + cols;
                if (mask[ni] == 0 && exterior[ni] == 0) { exterior[ni] = 1; queue[tail++] = ni; }
            }
            if (cc > 0) {
                final int ni = cur - 1;
                if (mask[ni] == 0 && exterior[ni] == 0) { exterior[ni] = 1; queue[tail++] = ni; }
            }
            if (cc + 1 < cols) {
                final int ni = cur + 1;
                if (mask[ni] == 0 && exterior[ni] == 0) { exterior[ni] = 1; queue[tail++] = ni; }
            }
        }
        for (int i = 0; i < mask.length; i++) {
            if (exterior[i] == 0) {
                mask[i] = 1;
            }
        }
        return mask;
    }

    /**
     * Multiscale IDW seed + Gauss-Seidel harmonic relaxation on all unobserved interior footprint cells.
     * Guarantees zeroCellsInside == 0 without mutating directly observed cells.
     */
    private static void fillInteriorHolesCraterFree(
        final float[] heights,
        final byte[] observedMask,
        final byte[] footprintMask,
        final int cols,
        final int rows
    ) {
        final int n = cols * rows;
        // Collect observed indices for fast IDW fallback seeding
        final int[] obsIdx = new int[n];
        int obsCount = 0;
        for (int i = 0; i < n; i++) {
            if (observedMask[i] != 0 && heights[i] > 0.0f) {
                obsIdx[obsCount++] = i;
            }
        }
        if (obsCount == 0) {
            return;
        }

        // Seed every unobserved footprint cell via local inverse-distance weighting (IDW)
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                final int idx = r * cols + c;
                if (footprintMask[idx] == 0 || observedMask[idx] != 0) {
                    continue;
                }
                double sumW = 0.0;
                double sumWH = 0.0;
                for (int k = 0; k < obsCount; k++) {
                    final int oi = obsIdx[k];
                    final int dr = (oi / cols) - r;
                    final int dc = (oi % cols) - c;
                    final int distSq = dr * dr + dc * dc;
                    if (distSq <= 100) {
                        final double w = 1.0 / distSq;
                        sumW += w;
                        sumWH += w * heights[oi];
                    }
                }
                if (sumW > 0.0) {
                    heights[idx] = (float) (sumWH / sumW);
                } else {
                    // Nearest observed cell
                    int bestDistSq = Integer.MAX_VALUE;
                    float bestH = 0.05f;
                    for (int k = 0; k < obsCount; k++) {
                        final int oi = obsIdx[k];
                        final int dr = (oi / cols) - r;
                        final int dc = (oi % cols) - c;
                        final int distSq = dr * dr + dc * dc;
                        if (distSq < bestDistSq) {
                            bestDistSq = distSq;
                            bestH = heights[oi];
                        }
                    }
                    heights[idx] = bestH;
                }
            }
        }

        // Harmonic Gauss-Seidel relaxation (preserves observed Dirichlet boundaries, smooths interior)
        for (int iter = 0; iter < 32; iter++) {
            for (int r = 1; r < rows - 1; r++) {
                for (int c = 1; c < cols - 1; c++) {
                    final int idx = r * cols + c;
                    if (footprintMask[idx] == 0 || observedMask[idx] != 0) {
                        continue;
                    }
                    float sum = 0.0f;
                    float weight = 0.0f;
                    final int[] nb = new int[] {
                        idx - cols, idx + cols, idx - 1, idx + 1,
                        idx - cols - 1, idx - cols + 1, idx + cols - 1, idx + cols + 1
                    };
                    for (int k = 0; k < 8; k++) {
                        final int ni = nb[k];
                        if (footprintMask[ni] != 0 && heights[ni] > 0.0f) {
                            final float w = k < 4 ? 1.0f : 0.707f;
                            sum += heights[ni] * w;
                            weight += w;
                        }
                    }
                    if (weight > 0.0f) {
                        heights[idx] = sum / weight;
                    }
                }
            }
        }
    }

    private static double[] computeFootprintDimensionsAB(
        final byte[] footprintMask,
        final int cols,
        final int rows,
        final float cellSizeM
    ) {
        double meanX = 0.0;
        double meanZ = 0.0;
        int count = 0;
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                if (footprintMask[r * cols + c] != 0) {
                    meanX += c * cellSizeM;
                    meanZ += r * cellSizeM;
                    count++;
                }
            }
        }
        if (count < 2) {
            return new double[] { cellSizeM, cellSizeM };
        }
        meanX /= count;
        meanZ /= count;

        double cxx = 0.0;
        double cxz = 0.0;
        double czz = 0.0;
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                if (footprintMask[r * cols + c] != 0) {
                    final double dx = c * cellSizeM - meanX;
                    final double dz = r * cellSizeM - meanZ;
                    cxx += dx * dx;
                    cxz += dx * dz;
                    czz += dz * dz;
                }
            }
        }
        final double theta = 0.5 * Math.atan2(2.0 * cxz, cxx - czz);
        final double ux = Math.cos(theta);
        final double uz = Math.sin(theta);
        final double vx = -uz;
        final double vz = ux;

        double minU = Double.MAX_VALUE;
        double maxU = -Double.MAX_VALUE;
        double minV = Double.MAX_VALUE;
        double maxV = -Double.MAX_VALUE;
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                if (footprintMask[r * cols + c] != 0) {
                    final double dx = c * cellSizeM - meanX;
                    final double dz = r * cellSizeM - meanZ;
                    final double pu = dx * ux + dz * uz;
                    final double pv = dx * vx + dz * vz;
                    if (pu < minU) minU = pu;
                    if (pu > maxU) maxU = pu;
                    if (pv < minV) minV = pv;
                    if (pv > maxV) maxV = pv;
                }
            }
        }
        final double spanU = (maxU - minU) + cellSizeM;
        final double spanV = (maxV - minV) + cellSizeM;
        return new double[] { Math.max(spanU, spanV), Math.min(spanU, spanV) };
    }

    private static double computeObservedSlopeAngleDeg(
        final float[] heights,
        final byte[] observedMask,
        final int cols,
        final int rows,
        final float cellSizeM,
        final float dimH
    ) {
        if (dimH < 0.15f) {
            return 0.0;
        }
        final float minH = dimH * 0.15f;
        final float maxH = dimH * 0.85f;
        final float[] slopes = new float[cols * rows];
        int count = 0;

        for (int r = 1; r < rows - 1; r++) {
            for (int c = 1; c < cols - 1; c++) {
                final int idx = r * cols + c;
                if (observedMask[idx] == 0) {
                    continue;
                }
                final float h = heights[idx];
                if (h < minH || h > maxH) {
                    continue;
                }
                if (
                    observedMask[idx - 1] == 0 ||
                    observedMask[idx + 1] == 0 ||
                    observedMask[idx - cols] == 0 ||
                    observedMask[idx + cols] == 0
                ) {
                    continue;
                }
                final float dhdx = (heights[idx + 1] - heights[idx - 1]) / (2.0f * cellSizeM);
                final float dhdz = (heights[idx + cols] - heights[idx - cols]) / (2.0f * cellSizeM);
                final float grad = (float) Math.hypot(dhdx, dhdz);
                if (grad > 0.15f && grad < 3.5f) {
                    slopes[count++] = (float) Math.toDegrees(Math.atan(grad));
                }
            }
        }
        if (count == 0) {
            return 0.0;
        }
        Arrays.sort(slopes, 0, count);
        return slopes[count / 2];
    }

    private static boolean[] computeToeSectorAnchored(
        final List<float[]> groundSamples,
        final List<float[]> points,
        final float cx,
        final float cz,
        final double planeA,
        final double planeB,
        final double planeD
    ) {
        final boolean[] anchored = new boolean[SECTOR_COUNT];
        for (float[] g : groundSamples) {
            final int s = sectorOf(g[0] - cx, g[2] - cz);
            anchored[s] = true;
        }
        for (float[] p : points) {
            final double gy = planeA * p[0] + planeB * p[2] + planeD;
            if (Math.abs(p[1] - gy) <= 0.12) {
                final int s = sectorOf(p[0] - cx, p[2] - cz);
                anchored[s] = true;
            }
        }
        return anchored;
    }

    private static String detectWallConfinement(
        final List<float[]> points,
        final double arcSpanDeg,
        final double planeA,
        final double planeB,
        final double planeD
    ) {
        if (arcSpanDeg >= 260.0 || points.size() < 40) {
            return "NONE";
        }
        // Check if points > 0.5m above ground form a strong vertical plane (|ny| < 0.15)
        final List<float[]> highPts = new ArrayList<>();
        for (float[] p : points) {
            final double h = p[1] - (planeA * p[0] + planeB * p[2] + planeD);
            if (h > 0.50) {
                highPts.add(p);
            }
        }
        if (highPts.size() < 20) {
            return arcSpanDeg < 210.0 ? "SINGLE_WALL" : "NONE";
        }
        int bestVerticalInliers = 0;
        final int n = highPts.size();
        long rng = 0x123456789ABCDEFL;
        for (int t = 0; t < 40; t++) {
            rng = (rng * 25214903917L + 11L) & ((1L << 48) - 1L);
            final float[] p0 = highPts.get((int) (rng % n));
            rng = (rng * 25214903917L + 11L) & ((1L << 48) - 1L);
            final float[] p1 = highPts.get((int) (rng % n));
            rng = (rng * 25214903917L + 11L) & ((1L << 48) - 1L);
            final float[] p2 = highPts.get((int) (rng % n));

            final double ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
            final double vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
            final double nx = uy * vz - uz * vy;
            final double ny = uz * vx - ux * vz;
            final double nz = ux * vy - uy * vx;
            final double norm = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (norm < 1e-4) continue;
            final double unitNy = Math.abs(ny / norm);
            if (unitNy >= 0.15) continue;

            final double unx = nx / norm, uny = ny / norm, unz = nz / norm;
            final double dist0 = unx * p0[0] + uny * p0[1] + unz * p0[2];
            int inliers = 0;
            for (float[] q : highPts) {
                final double err = Math.abs(unx * q[0] + uny * q[1] + unz * q[2] - dist0);
                if (err <= 0.08) inliers++;
            }
            if (inliers > bestVerticalInliers) {
                bestVerticalInliers = inliers;
            }
        }
        if (bestVerticalInliers >= (highPts.size() * 25) / 100) {
            return arcSpanDeg < 150.0 ? "BUNKER_3_WALLS" : "SINGLE_WALL";
        }
        return "NONE";
    }

    private static LocalPreviewMesh buildLocalPreviewMesh(
        final float originX,
        final float originZ,
        final float cellSizeM,
        final int cols,
        final int rows,
        final float[] heights,
        final byte[] observedMask,
        final float groundSlopeDeg,
        final float volumeM3,
        final float maxHeightM
    ) {
        final int stride = Math.max(1, (int) Math.ceil(Math.max(cols, rows) / (double) PREVIEW_MAX_DIM));
        final int pCols = Math.max(2, (cols + stride - 1) / stride);
        final int pRows = Math.max(2, (rows + stride - 1) / stride);
        final float[] pHeights = new float[pCols * pRows];
        final byte[] pObs = new byte[pCols * pRows];

        for (int pr = 0; pr < pRows; pr++) {
            final int r0 = pr * stride;
            final int r1 = Math.min(rows, r0 + stride);
            for (int pc = 0; pc < pCols; pc++) {
                final int c0 = pc * stride;
                final int c1 = Math.min(cols, c0 + stride);
                float sumH = 0.0f;
                int cnt = 0;
                byte obs = 0;
                for (int r = r0; r < r1; r++) {
                    for (int c = c0; c < c1; c++) {
                        final int idx = r * cols + c;
                        sumH += heights[idx];
                        cnt++;
                        if (observedMask[idx] != 0) obs = 1;
                    }
                }
                final int pIdx = pr * pCols + pc;
                pHeights[pIdx] = cnt > 0 ? Math.round((sumH / cnt) * 1000.0f) / 1000.0f : 0.0f;
                pObs[pIdx] = obs;
            }
        }
        return new LocalPreviewMesh(
            originX,
            originZ,
            cellSizeM * stride,
            pCols,
            pRows,
            pHeights,
            pObs,
            groundSlopeDeg,
            volumeM3,
            maxHeightM
        );
    }

    private static List<float[]> buildStratifiedCloud(
        final float originX,
        final float originZ,
        final float cellSizeM,
        final int cols,
        final int rows,
        final float[] heights,
        final byte[] footprintMask,
        final double planeA,
        final double planeB,
        final double planeD,
        final List<float[]> rawPoints
    ) {
        final List<float[]> out = new ArrayList<>(Math.min(6000, cols * rows + 512));
        for (int r = 0; r < rows; r++) {
            final float wz = originZ + (r + 0.5f) * cellSizeM;
            for (int c = 0; c < cols; c++) {
                final int idx = r * cols + c;
                if (footprintMask[idx] == 0) continue;
                final float wx = originX + (c + 0.5f) * cellSizeM;
                final float wy = (float) (planeA * wx + planeB * wz + planeD + heights[idx]);
                out.add(new float[] { wx, wy, wz });
            }
        }
        // Supplement with evenly strided raw points if grid < 3500
        if (out.size() < 3500 && !rawPoints.isEmpty()) {
            final int budget = 4000 - out.size();
            final int step = Math.max(1, rawPoints.size() / Math.max(1, budget));
            for (int i = 0; i < rawPoints.size() && out.size() < 4000; i += step) {
                final float[] p = rawPoints.get(i);
                out.add(new float[] { p[0], p[1], p[2] });
            }
        }
        return out;
    }

    /**
     * Builds GLES 2.0 vertex arrays (capped <= 4096 vertices) for the real-time 3D HUD overlay:
     * verified surface triangles (#00AEEF 12%), gap wireframes (#C68346), 0.5 m contour lines,
     * and anchored vs open perimeter toe segments.
     */
    private static LiveOverlaySnapshot buildLiveOverlaySnapshot(
        final float originX,
        final float originZ,
        final float cellSizeM,
        final int cols,
        final int rows,
        final float[] heights,
        final byte[] observedMask,
        final byte[] footprintMask,
        final int[] obsCount,
        final double planeA,
        final double planeB,
        final double planeD,
        final boolean[] toeSectorAnchored,
        final float cx,
        final float cy,
        final float cz,
        final float estDiameterM,
        final float estHeightM,
        final float estVolumeM3
    ) {
        final int stride = Math.max(1, (int) Math.ceil(Math.max(cols, rows) / 28.0));
        final ArrayList<Float> triVerts = new ArrayList<>(1024);
        final ArrayList<Float> gapLines = new ArrayList<>(512);
        final ArrayList<Float> contourLines = new ArrayList<>(512);
        final ArrayList<Float> crownPts = new ArrayList<>(96);
        final ArrayList<Float> toePts = new ArrayList<>(96);

        final float crownThreshold = estHeightM * 0.80f;

        for (int r = 0; r + stride < rows; r += stride) {
            for (int c = 0; c + stride < cols; c += stride) {
                final int i00 = r * cols + c;
                final int i10 = r * cols + (c + stride);
                final int i01 = (r + stride) * cols + c;
                final int i11 = (r + stride) * cols + (c + stride);
                if (
                    footprintMask[i00] == 0 &&
                    footprintMask[i10] == 0 &&
                    footprintMask[i01] == 0 &&
                    footprintMask[i11] == 0
                ) {
                    continue;
                }
                final float x0 = originX + (c + 0.5f) * cellSizeM;
                final float x1 = originX + (c + stride + 0.5f) * cellSizeM;
                final float z0 = originZ + (r + 0.5f) * cellSizeM;
                final float z1 = originZ + (r + stride + 0.5f) * cellSizeM;

                final float y00 = (float) (planeA * x0 + planeB * z0 + planeD + heights[i00]);
                final float y10 = (float) (planeA * x1 + planeB * z0 + planeD + heights[i10]);
                final float y01 = (float) (planeA * x0 + planeB * z1 + planeD + heights[i01]);
                final float y11 = (float) (planeA * x1 + planeB * z1 + planeD + heights[i11]);

                final boolean verified =
                    observedMask[i00] != 0 &&
                    observedMask[i10] != 0 &&
                    observedMask[i01] != 0 &&
                    observedMask[i11] != 0 &&
                    (obsCount[i00] + obsCount[i10] + obsCount[i01] + obsCount[i11]) >= 4;

                if (verified && triVerts.size() < 9000) {
                    // 2 CCW triangles
                    addPt(triVerts, x0, y00, z0);
                    addPt(triVerts, x0, y01, z1);
                    addPt(triVerts, x1, y10, z0);

                    addPt(triVerts, x1, y10, z0);
                    addPt(triVerts, x0, y01, z1);
                    addPt(triVerts, x1, y11, z1);
                } else if (!verified && gapLines.size() < 2400) {
                    addPt(gapLines, x0, y00, z0);
                    addPt(gapLines, x1, y10, z0);
                    addPt(gapLines, x0, y00, z0);
                    addPt(gapLines, x0, y01, z1);
                }

                // Elevation contour crossings every 0.5m
                if (contourLines.size() < 2400) {
                    final int b00 = (int) Math.floor(heights[i00] / 0.5f);
                    final int b10 = (int) Math.floor(heights[i10] / 0.5f);
                    final int b01 = (int) Math.floor(heights[i01] / 0.5f);
                    if (b00 != b10 || b00 != b01) {
                        addPt(contourLines, x0, y00 + 0.01f, z0);
                        addPt(contourLines, x1, y10 + 0.01f, z0);
                    }
                }

                if (heights[i00] >= crownThreshold && crownPts.size() < 96) {
                    addPt(crownPts, x0, y00, z0);
                }
            }
        }

        // Toe perimeter loop across 16 sectors
        final float[] sectorToeX = new float[SECTOR_COUNT];
        final float[] sectorToeZ = new float[SECTOR_COUNT];
        final float[] sectorMaxDist = new float[SECTOR_COUNT];
        for (int r = 0; r < rows; r++) {
            final float wz = originZ + (r + 0.5f) * cellSizeM;
            for (int c = 0; c < cols; c++) {
                final int idx = r * cols + c;
                if (footprintMask[idx] == 0) continue;
                final float wx = originX + (c + 0.5f) * cellSizeM;
                final float d = (float) Math.hypot(wx - cx, wz - cz);
                final int s = sectorOf(wx - cx, wz - cz);
                if (d > sectorMaxDist[s]) {
                    sectorMaxDist[s] = d;
                    sectorToeX[s] = wx;
                    sectorToeZ[s] = wz;
                }
            }
        }

        final ArrayList<Float> toeAnchored = new ArrayList<>(128);
        final ArrayList<Float> toeOpen = new ArrayList<>(128);
        final float fallbackR = Math.max(0.5f, estDiameterM * 0.5f);
        for (int s = 0; s < SECTOR_COUNT; s++) {
            if (sectorMaxDist[s] <= 0.01f) {
                final double ang = Math.toRadians((s + 0.5) * (360.0 / SECTOR_COUNT));
                sectorToeX[s] = cx + (float) (Math.cos(ang) * fallbackR);
                sectorToeZ[s] = cz + (float) (Math.sin(ang) * fallbackR);
            }
            final float ty = (float) (planeA * sectorToeX[s] + planeB * sectorToeZ[s] + planeD) + 0.02f;
            addPt(toePts, sectorToeX[s], ty, sectorToeZ[s]);
        }

        for (int s = 0; s < SECTOR_COUNT; s++) {
            final int next = (s + 1) % SECTOR_COUNT;
            final float y0 = (float) (planeA * sectorToeX[s] + planeB * sectorToeZ[s] + planeD) + 0.02f;
            final float y1 = (float) (planeA * sectorToeX[next] + planeB * sectorToeZ[next] + planeD) + 0.02f;
            final ArrayList<Float> target = (toeSectorAnchored[s] && toeSectorAnchored[next]) ? toeAnchored : toeOpen;
            addPt(target, sectorToeX[s], y0, sectorToeZ[s]);
            addPt(target, sectorToeX[next], y1, sectorToeZ[next]);
        }

        return new LiveOverlaySnapshot(
            toFloatArray(triVerts),
            toFloatArray(gapLines),
            toFloatArray(contourLines),
            toFloatArray(toeAnchored),
            toFloatArray(toeOpen),
            toFloatArray(crownPts),
            toFloatArray(toePts),
            cx, cy, cz,
            estDiameterM,
            estHeightM,
            estVolumeM3
        );
    }

    private static void addPt(final ArrayList<Float> dst, final float x, final float y, final float z) {
        dst.add(x);
        dst.add(y);
        dst.add(z);
    }

    private static float[] toFloatArray(final ArrayList<Float> list) {
        final float[] arr = new float[list.size()];
        for (int i = 0; i < list.size(); i++) {
            arr[i] = list.get(i);
        }
        return arr;
    }

    private static int sectorOf(final double dx, final double dz) {
        double deg = Math.toDegrees(Math.atan2(dz, dx));
        if (deg < 0.0) deg += 360.0;
        return Math.min(SECTOR_COUNT - 1, Math.max(0, (int) Math.floor(deg / (360.0 / SECTOR_COUNT))));
    }

    private static float computeMedianCamY(final List<WalkPose> poses) {
        if (poses.isEmpty()) return 1.5f;
        final float[] ys = new float[poses.size()];
        for (int i = 0; i < poses.size(); i++) {
            ys[i] = poses.get(i).y;
        }
        Arrays.sort(ys);
        return ys[ys.length / 2];
    }

    private static float computeWalkRingMinRadius(final List<WalkPose> poses, final float cx, final float cz) {
        if (poses.isEmpty()) return 0.0f;
        float minR = Float.MAX_VALUE;
        for (WalkPose wp : poses) {
            final float r = (float) Math.hypot(wp.x - cx, wp.z - cz);
            if (r < minR) minR = r;
        }
        return minR == Float.MAX_VALUE ? 0.0f : minR;
    }

    private static float computeWalkRingMedianRadius(final List<WalkPose> poses, final float cx, final float cz) {
        if (poses.isEmpty()) return 0.0f;
        final float[] rs = new float[poses.size()];
        for (int i = 0; i < poses.size(); i++) {
            rs[i] = (float) Math.hypot(poses.get(i).x - cx, poses.get(i).z - cz);
        }
        Arrays.sort(rs);
        return rs[rs.length / 2];
    }

    private static float estimatePointCloudP98Radius(final List<float[]> pts, final float cx, final float cz) {
        if (pts.isEmpty()) return 1.5f;
        final float[] rs = new float[pts.size()];
        for (int i = 0; i < pts.size(); i++) {
            final float[] p = pts.get(i);
            rs[i] = (float) Math.hypot(p[0] - cx, p[2] - cz);
        }
        Arrays.sort(rs);
        return Math.max(0.5f, rs[Math.min(rs.length - 1, (int) (rs.length * 0.98f))]);
    }

    private static double computeWalkArcSpanDeg(final List<WalkPose> poses, final float cx, final float cz) {
        if (poses.size() < 2) return 0.0;
        final boolean[] visited = new boolean[SECTOR_COUNT];
        int covered = 0;
        for (WalkPose wp : poses) {
            final int s = sectorOf(wp.x - cx, wp.z - cz);
            if (!visited[s]) {
                visited[s] = true;
                covered++;
            }
        }
        return (covered / (double) SECTOR_COUNT) * 360.0;
    }

    private static boolean computeLoopClosed(
        final List<WalkPose> poses,
        final float cx,
        final float cz,
        final double arcSpanDeg
    ) {
        if (poses.size() < 6 || arcSpanDeg < 270.0) {
            return false;
        }
        final WalkPose first = poses.get(0);
        final WalkPose last = poses.get(poses.size() - 1);
        final double endDist = Math.hypot(last.x - first.x, last.z - first.z);
        final float medR = computeWalkRingMedianRadius(poses, cx, cz);
        return arcSpanDeg >= 315.0 || endDist <= Math.max(1.2, medR * 0.45);
    }

    private static double estimateWalkLoopDriftPct(final List<WalkPose> poses, final boolean loopClosed) {
        if (poses.size() < 6) {
            return 2.5;
        }
        double perimeter = 0.0;
        for (int i = 1; i < poses.size(); i++) {
            final WalkPose a = poses.get(i - 1);
            final WalkPose b = poses.get(i);
            perimeter += Math.hypot(b.x - a.x, b.z - a.z);
        }
        if (perimeter < 2.0) {
            return 2.0;
        }
        if (!loopClosed) {
            return 2.2;
        }
        // Vertical (gravity-aligned Y) return closure discrepancy is an honest measure of VIO drift
        final double dy = Math.abs(poses.get(poses.size() - 1).y - poses.get(0).y);
        return clamp((float) ((dy / perimeter) * 100.0), 0.2f, 10.0f);
    }

    private static double estimateWalkRingSlopeDeg(final List<WalkPose> poses) {
        if (poses.size() < 6) {
            return 0.0;
        }
        final List<float[]> pts = new ArrayList<>(poses.size());
        for (WalkPose wp : poses) {
            pts.add(new float[] { wp.x, wp.y, wp.z });
        }
        final double[] ols = fitPlaneOLS(pts);
        if (ols == null) {
            return 0.0;
        }
        return Math.min(12.0, Math.toDegrees(Math.atan(Math.hypot(ols[0], ols[1]))));
    }

    private static double medianY(final List<float[]> pts) {
        final float[] ys = new float[pts.size()];
        for (int i = 0; i < pts.size(); i++) {
            ys[i] = pts.get(i)[1];
        }
        Arrays.sort(ys);
        return ys[ys.length / 2];
    }

    private static double[] fitPlane3Points(final float[] p0, final float[] p1, final float[] p2) {
        final double ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        final double vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        final double nx = uy * vz - uz * vy;
        final double ny = uz * vx - ux * vz;
        final double nz = ux * vy - uy * vx;
        if (Math.abs(ny) < 1e-5) {
            return null;
        }
        final double a = -nx / ny;
        final double b = -nz / ny;
        final double d = p0[1] - a * p0[0] - b * p0[2];
        return new double[] { a, b, d };
    }

    public static double[] fitPlaneOLS(final List<float[]> pts) {
        final int n = pts.size();
        if (n < 3) return null;
        double sXX = 0, sXZ = 0, sX = 0, sZZ = 0, sZ = 0, sXY = 0, sZY = 0, sY = 0;
        for (float[] p : pts) {
            final double x = p[0], y = p[1], z = p[2];
            sXX += x * x;
            sXZ += x * z;
            sX += x;
            sZZ += z * z;
            sZ += z;
            sXY += x * y;
            sZY += z * y;
            sY += y;
        }
        return solve3x3(
            new double[][] {
                { sXX, sXZ, sX },
                { sXZ, sZZ, sZ },
                { sX, sZ, n }
            },
            new double[] { sXY, sZY, sY }
        );
    }

    public static double[] solve3x3(final double[][] mat, final double[] rhs) {
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
            if (Math.abs(m[pivot][col]) < 1e-10) {
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

    private static float clamp(final float v, final float min, final float max) {
        return Math.max(min, Math.min(max, v));
    }
}
