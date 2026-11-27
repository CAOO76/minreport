package com.minreport.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.PriorityQueue;

/**
 * Pure-Java Walk-Ring Toe Solver, Gravity-Regularized Huber IRLS Ground Plane Estimator,
 * Dual-Hysteresis + 3D Marker-Controlled Watershed Object Segmenter, Crater-Free 2.5D DEM Integrator,
 * Strict Object-Flank Slope Estimator (up to 89.5 deg), Honest Uncertainty Engine, and Live 3D Overlay Builder.
 *
 * Zero Android framework dependencies so it executes both on-device and in JVM JUnit tests.
 */
public final class WalkRingToeSolver {

    public static final int SECTOR_COUNT = 16;
    public static final String SLOPE_PROFILE_NATURAL_REPOSE = "NATURAL_REPOSE";
    public static final String SLOPE_PROFILE_STEEP_ALERT = "STEEP_ALERT";
    public static final String SLOPE_PROFILE_VERTICAL_STRUCTURE = "VERTICAL_STRUCTURE";

    private static final int MAX_DEM_DIM = 64;
    private static final int PREVIEW_MAX_DIM = 48;
    private static final float MIN_CELL_SIZE_M = 0.03f;
    private static final float MAX_CELL_SIZE_M = 0.75f;
    private static final float MAX_GRAVITY_MISMATCH_DEG = 3.5f;
    private static final float DEFAULT_FORWARD_PROJECTION_M = 3.0f;
    private static final float LOCAL_GROUND_CLEARANCE_M = 0.55f;
    private static final float MIN_SIGMA_GROUND_M = 0.012f;
    private static final float MAX_SIGMA_GROUND_M = 0.060f;
    private static final double MIN_FLANK_SLOPE_DEG = 12.0;
    private static final double MAX_SLOPE_CEILING_DEG = 89.5;

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
        public final String format;
        public final float originX;
        public final float originZ;
        public final float cellSizeM;
        public final int cols;
        public final int rows;
        public final float[] heightsM;
        public final byte[] observedMask;
        public final byte[] confidenceMask; // 0=empty, 1=interpolated, 2=observed
        public final double planeA;
        public final double planeB;
        public final double planeD;
        public final float groundSlopeDeg;
        public final float volumeM3;
        public final float maxHeightM;
        /** Optional Base64-encoded per-cell RGB bytes (cols * rows * 3); when non-null, format = "dem_grid_v2". */
        public final String rgbB64;

        public LocalPreviewMesh(
            final float originX,
            final float originZ,
            final float cellSizeM,
            final int cols,
            final int rows,
            final float[] heightsM,
            final byte[] observedMask,
            final byte[] confidenceMask,
            final double planeA,
            final double planeB,
            final double planeD,
            final float groundSlopeDeg,
            final float volumeM3,
            final float maxHeightM
        ) {
            this(
                originX,
                originZ,
                cellSizeM,
                cols,
                rows,
                heightsM,
                observedMask,
                confidenceMask,
                planeA,
                planeB,
                planeD,
                groundSlopeDeg,
                volumeM3,
                maxHeightM,
                null
            );
        }

        public LocalPreviewMesh(
            final float originX,
            final float originZ,
            final float cellSizeM,
            final int cols,
            final int rows,
            final float[] heightsM,
            final byte[] observedMask,
            final byte[] confidenceMask,
            final double planeA,
            final double planeB,
            final double planeD,
            final float groundSlopeDeg,
            final float volumeM3,
            final float maxHeightM,
            final String rgbB64
        ) {
            this.rgbB64 = rgbB64;
            this.format = rgbB64 != null ? "dem_grid_v2" : "dem_grid_v1";
            this.originX = originX;
            this.originZ = originZ;
            this.cellSizeM = cellSizeM;
            this.cols = cols;
            this.rows = rows;
            this.heightsM = heightsM;
            this.observedMask = observedMask;
            this.confidenceMask = confidenceMask;
            this.planeA = planeA;
            this.planeB = planeB;
            this.planeD = planeD;
            this.groundSlopeDeg = groundSlopeDeg;
            this.volumeM3 = volumeM3;
            this.maxHeightM = maxHeightM;
        }

        public LocalPreviewMesh withRgbB64(final String newRgbB64) {
            return new LocalPreviewMesh(
                originX,
                originZ,
                cellSizeM,
                cols,
                rows,
                heightsM,
                observedMask,
                confidenceMask,
                planeA,
                planeB,
                planeD,
                groundSlopeDeg,
                volumeM3,
                maxHeightM,
                newRgbB64
            );
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
        public final double footprintAreaM2;
        public final double dimA;
        public final double dimB;
        public final double dimH;
        public final double groundSlopeDeg;
        public final double slopeAngleAvgDeg;
        public final String slopeProfile;
        public final double sigmaGroundM;
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
            final double footprintAreaM2,
            final double dimA,
            final double dimB,
            final double dimH,
            final double groundSlopeDeg,
            final double slopeAngleAvgDeg,
            final String slopeProfile,
            final double sigmaGroundM,
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
            this.footprintAreaM2 = footprintAreaM2;
            this.dimA = dimA;
            this.dimB = dimB;
            this.dimH = dimH;
            this.groundSlopeDeg = groundSlopeDeg;
            this.slopeAngleAvgDeg = slopeAngleAvgDeg;
            this.slopeProfile = slopeProfile != null ? slopeProfile : classifySlopeProfile(slopeAngleAvgDeg);
            this.sigmaGroundM = sigmaGroundM;
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

    public static String classifySlopeProfile(final double slopeAngleAvgDeg) {
        if (slopeAngleAvgDeg > 65.0) {
            return SLOPE_PROFILE_VERTICAL_STRUCTURE;
        }
        if (slopeAngleAvgDeg > 38.0) {
            return SLOPE_PROFILE_STEEP_ALERT;
        }
        return SLOPE_PROFILE_NATURAL_REPOSE;
    }

    /**
     * Estimates the horizontal stockpile center (cx, cz) by least-squares intersection of camera -Z optical rays.
     * Robust both for full 360-degree walk-rings and partial 150-240 degree arcs against walls/bunkers.
     */
    public static float[] estimateAutoCenterXZ(
        final List<WalkPose> walkPoses,
        final List<float[]> points3D
    ) {
        if (walkPoses != null && !walkPoses.isEmpty()) {
            double h00 = 0.0;
            double h01 = 0.0;
            double h11 = 0.0;
            double b0 = 0.0;
            double b1 = 0.0;
            int validRays = 0;

            double sumPx = 0.0;
            double sumPz = 0.0;
            double sumFwdX = 0.0;
            double sumFwdZ = 0.0;
            for (WalkPose wp : walkPoses) {
                sumPx += wp.x;
                sumPz += wp.z;
                final double lenXZ = Math.hypot(wp.fwdX, wp.fwdZ);
                if (lenXZ < 0.15) {
                    continue;
                }
                final double dx = wp.fwdX / lenXZ;
                final double dz = wp.fwdZ / lenXZ;
                sumFwdX += dx;
                sumFwdZ += dz;
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

            if (walkPoses.size() >= 3 && validRays >= 3) {
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

            // Fallback when < 3 poses or ray intersection does not converge:
            // project +3.0 m forward along mean horizontal optical direction (never {0,0} or {meanPx,meanPz}).
            final double meanFwdLen = Math.hypot(sumFwdX, sumFwdZ);
            if (meanFwdLen > 1e-4) {
                final double dirX = sumFwdX / meanFwdLen;
                final double dirZ = sumFwdZ / meanFwdLen;
                return new float[] {
                    (float) (meanPx + dirX * DEFAULT_FORWARD_PROJECTION_M),
                    (float) (meanPz + dirZ * DEFAULT_FORWARD_PROJECTION_M)
                };
            }
            if (points3D != null && !points3D.isEmpty()) {
                return computeMedianPointsXZ(points3D);
            }
            return new float[] { (float) meanPx, (float) (meanPz - DEFAULT_FORWARD_PROJECTION_M) };
        }

        if (points3D != null && !points3D.isEmpty()) {
            return computeMedianPointsXZ(points3D);
        }
        return new float[] { 0.0f, -DEFAULT_FORWARD_PROJECTION_M };
    }

    private static float[] computeMedianPointsXZ(final List<float[]> points3D) {
        final float[] xs = new float[points3D.size()];
        final float[] zs = new float[points3D.size()];
        int valid = 0;
        for (int i = 0; i < points3D.size(); i++) {
            final float[] p = points3D.get(i);
            if (p == null || p.length < 3 || !Float.isFinite(p[0]) || !Float.isFinite(p[2])) {
                continue;
            }
            xs[valid] = p[0];
            zs[valid] = p[2];
            valid++;
        }
        if (valid == 0) {
            return new float[] { 0.0f, -DEFAULT_FORWARD_PROJECTION_M };
        }
        Arrays.sort(xs, 0, valid);
        Arrays.sort(zs, 0, valid);
        return new float[] { xs[valid / 2], zs[valid / 2] };
    }

    /**
     * Backwards-compatible solve overload without TargetVolumeConstraint or VisualHullResult.
     */
    public static MetrologyResult solve(
        final List<float[]> rawPoints3D,
        final List<WalkPose> walkPoses,
        final List<float[]> rawGroundSamples,
        final boolean hasScaleAnchor,
        final double explicitLoopDriftPct
    ) {
        return solve(rawPoints3D, walkPoses, rawGroundSamples, hasScaleAnchor, explicitLoopDriftPct, null, null);
    }

    /**
     * Backwards-compatible solve overload with optional TargetVolumeConstraint (without VisualHullResult).
     */
    public static MetrologyResult solve(
        final List<float[]> rawPoints3D,
        final List<WalkPose> walkPoses,
        final List<float[]> rawGroundSamples,
        final boolean hasScaleAnchor,
        final double explicitLoopDriftPct,
        final TargetVolumeConstraint targetConstraint
    ) {
        return solve(rawPoints3D, walkPoses, rawGroundSamples, hasScaleAnchor, explicitLoopDriftPct, targetConstraint, null);
    }

    /**
     * Full Tri-Modal in-situ stockpile metrology solver with optional TargetVolumeConstraint and
     * optional VisualHullCarver.VisualHullResult:
     * - Unbiased p50 + Huber IRLS ground plane with padReferenceY anchoring and empirical sigmaGround
     * - Tri-Modal DEM fusion (MVS/Depth + Probabilistic Visual Hull carving concavities via min(H_hull, H_obs)
     *   and completing textureless smooth walls from silhouette height)
     * - Dual-hysteresis toe segmentation + 8-connected clustering + 3D marker-controlled Priority-Flood Watershed
     * - Bounded geodesic toe expansion + interior-only crater-free hole filling (no global scanline bridges)
     * - Strict object-flank slope angle via 16-sector radial Theil-Sen + gravity-corrected DEM gradient (up to 89.5 deg)
     */
    public static MetrologyResult solve(
        final List<float[]> rawPoints3D,
        final List<WalkPose> walkPoses,
        final List<float[]> rawGroundSamples,
        final boolean hasScaleAnchor,
        final double explicitLoopDriftPct,
        final TargetVolumeConstraint targetConstraint,
        final VisualHullCarver.VisualHullResult visualHull
    ) {
        final List<float[]> points = rawPoints3D != null ? rawPoints3D : new ArrayList<>();
        final List<WalkPose> poses = walkPoses != null ? walkPoses : new ArrayList<>();
        final List<float[]> groundInput = rawGroundSamples != null ? rawGroundSamples : new ArrayList<>();
        final boolean hasTarget = targetConstraint != null && targetConstraint.active;
        final boolean hasVisualHull = visualHull != null && visualHull.isValid();

        if (points.size() < 12 && !hasVisualHull) {
            return buildRejectedResult(points, groundInput, poses, explicitLoopDriftPct);
        }

        final float[] centerXZ = hasTarget
            ? targetConstraint.getEffectiveCenterXZ()
            : ((poses.isEmpty() && points.isEmpty() && hasVisualHull)
                ? computeVisualHullCentroidXZ(visualHull)
                : estimateAutoCenterXZ(poses, points));
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

        // 2. Filter ground samples strictly below local camera corridor (y <= nearestCamY - 0.55f)
        final List<float[]> filteredGround = new ArrayList<>();
        for (float[] g : groundInput) {
            if (g == null || g.length < 3) {
                continue;
            }
            if (!Float.isFinite(g[0]) || !Float.isFinite(g[1]) || !Float.isFinite(g[2])) {
                continue;
            }
            final float localMaxGroundY;
            if (!poses.isEmpty()) {
                float nearestCamY = medianCamY;
                float bestDistSq = Float.MAX_VALUE;
                for (WalkPose wp : poses) {
                    final float ddx = g[0] - wp.x;
                    final float ddz = g[2] - wp.z;
                    final float dSq = ddx * ddx + ddz * ddz;
                    if (dSq < bestDistSq) {
                        bestDistSq = dSq;
                        nearestCamY = wp.y;
                    }
                }
                localMaxGroundY = nearestCamY - LOCAL_GROUND_CLEARANCE_M;
            } else {
                localMaxGroundY = Float.MAX_VALUE;
            }
            if (g[1] <= localMaxGroundY) {
                filteredGround.add(new float[] { g[0], g[1], g[2] });
            }
        }

        // 3. Soft radial envelope from walk ring or target constraint (never hard-truncates large piles)
        final float radialEnvelope;
        if (hasTarget) {
            radialEnvelope = Math.max(targetConstraint.getEffectiveRadiusM() * 1.35f, 0.50f);
        } else if (hasWalkPoses && walkMedianRadius > 1.2f) {
            radialEnvelope = Math.max(walkMedianRadius * 1.15f, walkMinRadius + 0.5f);
        } else {
            radialEnvelope = estimatePointCloudP98Radius(points, cx, cz) * 1.05f;
        }

        final boolean hasValidPolygon = hasTarget && targetConstraint.hasValidPolygon();
        final List<float[]> allFinitePoints = new ArrayList<>(points.size());
        final List<float[]> inEnvelopePoints = new ArrayList<>(points.size());
        for (float[] p : points) {
            if (p == null || p.length < 3) {
                continue;
            }
            if (!Float.isFinite(p[0]) || !Float.isFinite(p[1]) || !Float.isFinite(p[2])) {
                continue;
            }
            allFinitePoints.add(p);
            if (hasTarget) {
                final boolean inTarget = targetConstraint.containsXZ(p[0], p[2], 1.25f);
                final boolean inHullNoPoly = !hasValidPolygon && hasVisualHull &&
                    isWithinVisualHullMargin(visualHull, p[0], p[2], 2);
                if (inTarget || inHullNoPoly) {
                    inEnvelopePoints.add(p);
                }
            } else {
                final float r = (float) Math.hypot(p[0] - cx, p[2] - cz);
                if (r <= radialEnvelope) {
                    inEnvelopePoints.add(p);
                }
            }
        }
        if (inEnvelopePoints.size() < 12) {
            if (hasTarget) {
                // NEVER fall back to entire room cloud when targetConstraint is active!
                if (!hasVisualHull) {
                    return buildRejectedResult(inEnvelopePoints, filteredGround, poses, loopDriftPct);
                }
            } else {
                inEnvelopePoints.clear();
                inEnvelopePoints.addAll(allFinitePoints);
            }
        }

        // 4. Gravity-Regularized Unbiased Ground Plane Solver (p50 + Huber IRLS + padReferenceY + sigmaGround)
        final double walkRingSlopeDeg = estimateWalkRingSlopeDeg(poses);
        final double[] groundPlaneOut = fitGravityRegularizedGroundPlane(
            allFinitePoints,
            filteredGround,
            poses,
            cx,
            cz,
            walkRingSlopeDeg,
            targetConstraint
        );
        final double planeA = groundPlaneOut[0];
        final double planeB = groundPlaneOut[1];
        final double planeD = groundPlaneOut[2];
        final double groundRmsM = groundPlaneOut[3];
        final double sigmaGround = clampDouble(groundPlaneOut[4], MIN_SIGMA_GROUND_M, MAX_SIGMA_GROUND_M);
        final double groundSlopeDeg = Math.toDegrees(Math.atan(Math.hypot(planeA, planeB)));
        final double planeMismatchDeg = Math.abs(groundSlopeDeg - walkRingSlopeDeg);

        // 5. Detect wall confinement (SINGLE_WALL / BUNKER_3_WALLS) for partial arcs
        final String wallConfinement = detectWallConfinement(
            inEnvelopePoints,
            arcSpanDeg,
            planeA,
            planeB,
            planeD
        );

        // 6. Estimate peak height & dual-hysteresis thresholds BEFORE building DEM so small targets get crisp resolution
        final float[] posHeightsTmp = new float[inEnvelopePoints.size()];
        int posCount = 0;
        for (float[] p : inEnvelopePoints) {
            if (hasTarget && (hasValidPolygon || !hasVisualHull) && !targetConstraint.containsXZ(p[0], p[2], 1.05f)) {
                continue;
            }
            if (hasVisualHull && visualHull.viewsUsed >= 6 && !isWithinVisualHullMargin(visualHull, p[0], p[2], 1)) {
                continue;
            }
            final float h = (float) (p[1] - (planeA * p[0] + planeB * p[2] + planeD));
            if (h > 0.0f) {
                posHeightsTmp[posCount++] = h;
            }
        }
        float hPeakFromHull = 0.0f;
        int hullPosCount = 0;
        if (hasVisualHull) {
            final float[] hullHeightsTmp = new float[visualHull.cols * visualHull.rows];
            for (int hr = 0; hr < visualHull.rows; hr++) {
                final float wz = visualHull.originZ + (hr + 0.5f) * visualHull.cellSizeM;
                for (int hc = 0; hc < visualHull.cols; hc++) {
                    final int hi = hr * visualHull.cols + hc;
                    if (visualHull.hullFootprintMask[hi] == 0) {
                        continue;
                    }
                    final float hh = visualHull.hullHeightsM[hi];
                    if (hh <= 0.0f) {
                        continue;
                    }
                    final float wx = visualHull.originX + (hc + 0.5f) * visualHull.cellSizeM;
                    if (hasValidPolygon && !targetConstraint.containsXZ(wx, wz, 1.05f)) {
                        continue;
                    }
                    hullHeightsTmp[hullPosCount++] = hh;
                }
            }
            if (hullPosCount > 0) {
                Arrays.sort(hullHeightsTmp, 0, hullPosCount);
                hPeakFromHull = hullHeightsTmp[Math.min(hullPosCount - 1, (int) Math.floor(hullPosCount * 0.995))];
            }
        }
        if (posCount < 8 && hullPosCount < 4) {
            return buildRejectedResult(inEnvelopePoints, filteredGround, poses, loopDriftPct);
        }
        final float hPeakFromPts;
        if (posCount >= 8) {
            Arrays.sort(posHeightsTmp, 0, posCount);
            hPeakFromPts = posHeightsTmp[Math.min(posCount - 1, (int) Math.floor(posCount * 0.995))];
        } else {
            hPeakFromPts = 0.0f;
        }
        final float hPeakInitial;
        if (hasVisualHull && hPeakFromHull > 0.05f) {
            hPeakInitial = posCount >= 8
                ? Math.min(Math.max(hPeakFromPts, hPeakFromHull), hPeakFromHull * 1.15f)
                : hPeakFromHull;
        } else {
            hPeakInitial = hPeakFromPts;
        }
        if (hPeakInitial < 0.05f) {
            return buildRejectedResult(inEnvelopePoints, filteredGround, poses, loopDriftPct);
        }

        final float hSeed = (float) Math.max(0.08, Math.max(3.5 * sigmaGround, 0.15 * hPeakInitial));
        final float hToe = (float) Math.max(0.03, Math.max(2.0 * sigmaGround, 0.04 * hPeakInitial));

        // Compute tight DEM bounds from points >= hToe and valid Visual Hull cells (prevents noisy patio from coarsening small-object grid)
        float minX = Float.MAX_VALUE;
        float maxX = -Float.MAX_VALUE;
        float minZ = Float.MAX_VALUE;
        float maxZ = -Float.MAX_VALUE;
        final List<float[]> aboveToePts = new ArrayList<>();
        for (float[] p : inEnvelopePoints) {
            if (hasTarget && targetConstraint.hasValidPolygon() && !targetConstraint.containsXZ(p[0], p[2], 1.02f)) {
                continue;
            }
            if (hasVisualHull && visualHull.viewsUsed >= 6 && !isWithinVisualHullMargin(visualHull, p[0], p[2], 1)) {
                continue;
            }
            final double gy = planeA * p[0] + planeB * p[2] + planeD;
            final double h = p[1] - gy;
            if (h >= hToe) {
                if (p[0] < minX) minX = p[0];
                if (p[0] > maxX) maxX = p[0];
                if (p[2] < minZ) minZ = p[2];
                if (p[2] > maxZ) maxZ = p[2];
                aboveToePts.add(p);
            }
        }
        int hullAboveToeCount = 0;
        if (hasVisualHull) {
            final float halfHullCell = 0.5f * visualHull.cellSizeM;
            for (int hr = 0; hr < visualHull.rows; hr++) {
                final float wz = visualHull.originZ + (hr + 0.5f) * visualHull.cellSizeM;
                for (int hc = 0; hc < visualHull.cols; hc++) {
                    final int hi = hr * visualHull.cols + hc;
                    if (visualHull.hullFootprintMask[hi] == 0 || visualHull.hullHeightsM[hi] < hToe) {
                        continue;
                    }
                    final float wx = visualHull.originX + (hc + 0.5f) * visualHull.cellSizeM;
                    if (hasTarget && targetConstraint.hasValidPolygon() && !targetConstraint.containsXZ(wx, wz, 1.02f)) {
                        continue;
                    }
                    if (wx - halfHullCell < minX) minX = wx - halfHullCell;
                    if (wx + halfHullCell > maxX) maxX = wx + halfHullCell;
                    if (wz - halfHullCell < minZ) minZ = wz - halfHullCell;
                    if (wz + halfHullCell > maxZ) maxZ = wz + halfHullCell;
                    hullAboveToeCount++;
                }
            }
        }
        final int aboveToeCount = aboveToePts.size();
        if (aboveToeCount + hullAboveToeCount < 6 || maxX <= minX || maxZ <= minZ) {
            return buildRejectedResult(inEnvelopePoints, filteredGround, poses, loopDriftPct);
        }

        final float spanX = maxX - minX;
        final float spanZ = maxZ - minZ;
        final float maxSpan = Math.max(spanX, spanZ);
        final float effectiveMinCellM = hasVisualHull
            ? Math.max(0.010f, Math.min(MIN_CELL_SIZE_M, visualHull.cellSizeM))
            : (maxSpan < 1.5f ? 0.020f : MIN_CELL_SIZE_M);
        final float nnSpacingM = hasVisualHull ? 0.0f : estimateLocalPointSpacingXZ(aboveToePts);
        final float densityFloorCellM = Float.isFinite(nnSpacingM) && nnSpacingM > 0.0f
            ? nnSpacingM * 1.10f
            : effectiveMinCellM;
        final float spanFitCellM = maxSpan / (MAX_DEM_DIM - 5.0f);
        final float cellSizeM = clamp(
            Math.max(Math.max(maxSpan / 52.0f, spanFitCellM), densityFloorCellM),
            effectiveMinCellM,
            MAX_CELL_SIZE_M
        );

        // Center DEM grid symmetrically on [minX, maxX] x [minZ, maxZ] with 2-cell exterior padding
        // so wall points on maxX/maxZ never spill into an extra quantization-inflated outer cell.
        final int cols = Math.min(MAX_DEM_DIM, Math.max(6, (int) Math.ceil(spanX / cellSizeM) + 4));
        final int rows = Math.min(MAX_DEM_DIM, Math.max(6, (int) Math.ceil(spanZ / cellSizeM) + 4));
        final float midX = 0.5f * (minX + maxX);
        final float midZ = 0.5f * (minZ + maxZ);
        final float originX = midX - 0.5f * cols * cellSizeM;
        final float originZ = midZ - 0.5f * rows * cellSizeM;
        final int cellCount = cols * rows;

        // Bucket heights per cell to compute robust p50 median + obs count
        @SuppressWarnings("unchecked")
        final ArrayList<Float>[] buckets = new ArrayList[cellCount];
        final int[] obsCount = new int[cellCount];
        for (float[] p : inEnvelopePoints) {
            final double gy = planeA * p[0] + planeB * p[2] + planeD;
            final float h = (float) (p[1] - gy);
            if (h < -0.10f) {
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
            buckets[idx].add(Math.max(0.0f, h));
            obsCount[idx] += (p.length >= 4 && p[3] >= 1.0f) ? Math.round(p[3]) : 1;
        }

        final float[] rawHeights = new float[cellCount];
        final byte[] rawObserved = new byte[cellCount];
        final boolean[] inAllowedRegion = new boolean[cellCount];
        final float[] upperEnvHeights = new float[cellCount];
        final float[] cellIqrM = new float[cellCount];
        final boolean[] hasObsBucketArr = new boolean[cellCount];
        final float[] hullHeightsGrid = hasVisualHull ? new float[cellCount] : null;
        final byte[] hullMaskGrid = hasVisualHull ? new byte[cellCount] : null;

        for (int r = 0; r < rows; r++) {
            final float wz = originZ + (r + 0.5f) * cellSizeM;
            for (int c = 0; c < cols; c++) {
                final int idx = r * cols + c;
                final float wx = originX + (c + 0.5f) * cellSizeM;
                if (hasTarget) {
                    if (hasValidPolygon) {
                        inAllowedRegion[idx] = targetConstraint.containsXZ(wx, wz, 1.0f);
                    } else if (hasVisualHull) {
                        inAllowedRegion[idx] =
                            targetConstraint.containsXZ(wx, wz, 1.15f) ||
                            isWithinVisualHullMargin(visualHull, wx, wz, 1);
                    } else {
                        inAllowedRegion[idx] = targetConstraint.containsXZ(wx, wz, 1.15f);
                    }
                } else {
                    inAllowedRegion[idx] = true;
                }
                final ArrayList<Float> list = buckets[idx];
                final boolean hasObsBucket = list != null && !list.isEmpty();
                hasObsBucketArr[idx] = hasObsBucket;
                if (hasObsBucket) {
                    final float[] arr = new float[list.size()];
                    for (int k = 0; k < list.size(); k++) {
                        arr[k] = list.get(k);
                    }
                    Arrays.sort(arr);
                    final float upperEnv = computeRobustUpperEnvelope(arr);
                    upperEnvHeights[idx] = upperEnv;
                    cellIqrM[idx] = arr.length >= 2
                        ? (percentileSorted(arr, arr.length, 0.75) - percentileSorted(arr, arr.length, 0.25))
                        : 0.0f;
                    if (upperEnv > 0.0f) {
                        rawHeights[idx] = upperEnv;
                        rawObserved[idx] = 1;
                    }
                }
                if (hasVisualHull) {
                    if (visualHull.viewsUsed >= 6 && !isWithinVisualHullMargin(visualHull, wx, wz, 1)) {
                        inAllowedRegion[idx] = false;
                        rawHeights[idx] = 0.0f;
                        rawObserved[idx] = 0;
                    } else if (inAllowedRegion[idx]) {
                        final float hHull = sampleVisualHullHeight(visualHull, wx, wz);
                        hullHeightsGrid[idx] = hHull;
                        if (hHull >= hToe) {
                            hullMaskGrid[idx] = 1;
                        } else if (visualHull.viewsUsed >= 6) {
                            // Strictly outside 6+ view carved visual hull: discard stray exterior depth/MVS bleed
                            rawHeights[idx] = 0.0f;
                            rawObserved[idx] = 0;
                        }
                    }
                }
            }
        }

        // Tri-Modal Visual Hull fusion without wall erosion:
        // - Allow Math.min(hHull, hUpperEnv) ONLY in the deep interior (dEdge >= 2 * cellSizeM) with
        //   strong, low-variance horizontal/sloped observation support (obsCount >= 5 && IQR < 0.08 m,
        //   or spatially coherent 3x3 interior concavity with >= 5 local obs & IQR < 0.08 m).
        // - On border/wall rings (dEdge < 2 * cellSizeM) or high vertical variance (real vertical walls):
        //   preserve hHull (or max(hHull, hUpperEnv) capped at 1.05 * hHull) so Raw Depth never erodes a wall!
        if (hasVisualHull) {
            final float[] hullDEdgeM = computeDistanceToExteriorM(hullMaskGrid, cols, rows, cellSizeM);
            final float deepInteriorDistM = 2.0f * cellSizeM - 1e-4f;
            final float[] nbHeightsTmp = new float[9];

            for (int r = 0; r < rows; r++) {
                for (int c = 0; c < cols; c++) {
                    final int idx = r * cols + c;
                    if (!inAllowedRegion[idx] || hullMaskGrid[idx] == 0) {
                        continue;
                    }
                    final float hHull = hullHeightsGrid[idx];
                    final boolean hasObsBucket = hasObsBucketArr[idx];
                    final float hUpperEnv = upperEnvHeights[idx];
                    final boolean isDeepInterior = hullDEdgeM[idx] >= deepInteriorDistM;
                    final boolean cellLowSpread = cellIqrM[idx] < 0.08f;

                    boolean allowCarveDown = false;
                    if (isDeepInterior && hasObsBucket && cellLowSpread) {
                        if (obsCount[idx] >= 5) {
                            allowCarveDown = true;
                        } else if (obsCount[idx] >= 1 && hUpperEnv < hHull) {
                            // Check 3x3 neighborhood for spatially coherent interior surface / concavity
                            int localObs = 0;
                            int localCells = 0;
                            int localBelowHull = 0;
                            for (int dr = -1; dr <= 1; dr++) {
                                final int nr = r + dr;
                                if (nr < 0 || nr >= rows) continue;
                                for (int dc = -1; dc <= 1; dc++) {
                                    final int nc = c + dc;
                                    if (nc < 0 || nc >= cols) continue;
                                    final int ni = nr * cols + nc;
                                    if (hasObsBucketArr[ni] && hullMaskGrid[ni] != 0) {
                                        localObs += obsCount[ni];
                                        nbHeightsTmp[localCells++] = upperEnvHeights[ni];
                                        if (upperEnvHeights[ni] < hullHeightsGrid[ni] - 0.005f) {
                                            localBelowHull++;
                                        }
                                    }
                                }
                            }
                            if (localObs >= 5 && localCells >= 4 && localBelowHull * 4 >= localCells * 3) {
                                Arrays.sort(nbHeightsTmp, 0, localCells);
                                final float nbIqr =
                                    percentileSorted(nbHeightsTmp, localCells, 0.75) -
                                    percentileSorted(nbHeightsTmp, localCells, 0.25);
                                if (nbIqr < 0.08f) {
                                    allowCarveDown = true;
                                }
                            }
                        }
                    }

                    if (allowCarveDown) {
                        final float fusedH = Math.min(hHull, hUpperEnv);
                        rawHeights[idx] = fusedH;
                        rawObserved[idx] = fusedH > 0.0f ? (byte) 1 : (byte) 0;
                    } else {
                        final float fusedH = (hasObsBucket && hUpperEnv > hHull)
                            ? Math.min(hUpperEnv, hHull * 1.05f)
                            : hHull;
                        rawHeights[idx] = fusedH;
                        rawObserved[idx] = 1;
                        obsCount[idx] = Math.max(obsCount[idx], 2);
                    }
                }
            }
        }

        // 7. Dual-Hysteresis + 8-Connected Clustering + 3D Marker-Controlled Watershed + Bounded Toe Expansion
        final byte[] objectMask = segmentTargetObjectMask(
            rawHeights,
            rawObserved,
            inAllowedRegion,
            originX,
            originZ,
            cellSizeM,
            cols,
            rows,
            hSeed,
            hToe,
            (float) sigmaGround,
            hasTarget ? targetConstraint : null
        );

        // Restrict observedMask strictly to objectMask cells above hToe, then fill ONLY enclosed interior holes
        final byte[] observedMask = new byte[cellCount];
        int observedCells = 0;
        for (int i = 0; i < cellCount; i++) {
            if (objectMask[i] != 0 && rawObserved[i] != 0 && rawHeights[i] >= hToe) {
                observedMask[i] = 1;
                observedCells++;
            } else if (objectMask[i] == 0) {
                rawHeights[i] = 0.0f;
            }
        }
        if (observedCells == 0) {
            return buildRejectedResult(inEnvelopePoints, filteredGround, poses, loopDriftPct);
        }

        // Interior-only hole filling via exterior flood-fill (eliminates global H/V scanline bridges)
        final byte[] footprintMask = fillEnclosedInteriorHolesOnly(objectMask, cols, rows);

        // 8. Crater-Free Multiscale / Harmonic IDW interpolation (guarantees zeroCellsInside == 0)
        final float[] heights = Arrays.copyOf(rawHeights, cellCount);
        for (int i = 0; i < cellCount; i++) {
            if (footprintMask[i] == 0) {
                heights[i] = 0.0f;
            }
        }
        fillInteriorHolesCraterFree(heights, observedMask, footprintMask, cols, rows);

        // Verify zeroCellsInside and compute volume, occludedVolumePct, and p99 height
        final float cellArea = cellSizeM * cellSizeM;
        double totalVol = 0.0;
        double occludedVol = 0.0;
        int totalFootprintCells = 0;
        int zeroCellsInside = 0;
        final float[] fpHeights = new float[cellCount];
        int fpCount = 0;
        double objCenterSumX = 0.0;
        double objCenterSumZ = 0.0;

        for (int r = 0; r < rows; r++) {
            final float wz = originZ + (r + 0.5f) * cellSizeM;
            for (int c = 0; c < cols; c++) {
                final int idx = r * cols + c;
                if (footprintMask[idx] == 0) {
                    continue;
                }
                totalFootprintCells++;
                final float wx = originX + (c + 0.5f) * cellSizeM;
                objCenterSumX += wx;
                objCenterSumZ += wz;
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

        final float objCx = (float) (objCenterSumX / totalFootprintCells);
        final float objCz = (float) (objCenterSumZ / totalFootprintCells);
        Arrays.sort(fpHeights, 0, fpCount);
        final int dimHIdx = fpCount >= 20
            ? Math.max(fpCount - 2, (int) Math.floor(fpCount * 0.997))
            : (fpCount - 1);
        final double dimH = fpHeights[Math.min(fpCount - 1, dimHIdx)];
        final double occludedVolumePct = totalVol > 0.0 ? (occludedVol / totalVol) * 100.0 : 0.0;

        // 9. Footprint principal dimensions (a, b) via 2D covariance eigenvalues
        final double[] dimsAB = computeFootprintDimensionsAB(footprintMask, cols, rows, cellSizeM);
        final double dimA = dimsAB[0];
        final double dimB = dimsAB[1];

        // 10. Strict object-flank slope angle relative to +Y gravity (Theil-Sen radial + gravity-corrected DEM up to 89.5 deg)
        final double slopeAngleAvgDeg = computeStrictObjectSlopeAngleDeg(
            heights,
            observedMask,
            footprintMask,
            originX,
            originZ,
            cols,
            rows,
            cellSizeM,
            (float) dimH,
            hToe,
            (float) sigmaGround,
            planeA,
            planeB,
            objCx,
            objCz
        );
        final String slopeProfile = classifySlopeProfile(slopeAngleAvgDeg);

        // 11. Toe coverage score across 16 sectors + honest uncertainty formula
        final boolean[] toeSectorAnchored = computeToeSectorAnchored(
            filteredGround,
            allFinitePoints,
            objCx,
            objCz,
            planeA,
            planeB,
            planeD,
            targetConstraint != null && targetConstraint.hasPadReferenceY && Float.isFinite(targetConstraint.padReferenceY)
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
            totalVol <= 0.003
        ) {
            metrologyGrade = "REJECTED";
        } else if (uncertaintyPct > 12.0) {
            metrologyGrade = "LOW_CONFIDENCE_RECAPTURE";
        } else {
            metrologyGrade = "VALID_IN_SITU";
        }

        final float anchorOutX = objCx;
        final float anchorOutZ = objCz;
        final float anchorY = (float) (planeA * anchorOutX + planeB * anchorOutZ + planeD);
        final float effectiveRadiusM = (float) Math.max(0.15, Math.max(dimA, dimB) * 0.65 + 0.15);
        final double footprintAreaM2 = totalFootprintCells * (double) cellArea;

        // 12. Build compact < 60 KB localPreviewMesh (<= 32x32)
        final LocalPreviewMesh previewMesh = buildLocalPreviewMesh(
            originX,
            originZ,
            cellSizeM,
            cols,
            rows,
            heights,
            observedMask,
            footprintMask,
            planeA,
            planeB,
            planeD,
            (float) groundSlopeDeg,
            (float) totalVol,
            (float) dimH
        );

        // 13. Build stratified output cloud (strictly segmented to object footprint)
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
            objCx,
            anchorY,
            objCz,
            (float) Math.max(dimA, dimB),
            (float) dimH,
            (float) totalVol
        );

        return new MetrologyResult(
            totalVol,
            footprintAreaM2,
            dimA,
            dimB,
            dimH,
            groundSlopeDeg,
            slopeAngleAvgDeg,
            slopeProfile,
            sigmaGround,
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
            anchorOutX,
            anchorY,
            anchorOutZ,
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
            c[0], c[1], 0.25f, 1, 1, new float[] { 0.0f }, new byte[] { 0 }, new byte[] { 0 },
            0.0, 0.0, 0.0, 0.0f, 0.0f, 0.0f
        );
        return new MetrologyResult(
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SLOPE_PROFILE_NATURAL_REPOSE, MIN_SIGMA_GROUND_M,
            0.0, 100.0, Math.max(0.0, driftPct), 0.0, 45.0, 0, 0, 0, points.size(),
            false, "REJECTED", "NONE",
            c[0], 0.0f, c[1], 1.0f,
            0.0, 0.0, 0.0,
            emptyMesh, points, ground, null
        );
    }

    /**
     * Fits gravity-regularized ground plane y = a*x + b*z + d using deterministic RANSAC + Huber IRLS
     * + unbiased p50 median offset (eliminating -3*sigma p15 bias), anchoring to explicit padReferenceY
     * when provided, and returning { a, b, d, rms, sigmaGround }.
     */
    private static double[] fitGravityRegularizedGroundPlane(
        final List<float[]> points,
        final List<float[]> groundSamples,
        final List<WalkPose> walkPoses,
        final float cx,
        final float cz,
        final double walkRingSlopeDeg,
        final TargetVolumeConstraint targetConstraint
    ) {
        final boolean hasPadRef =
            targetConstraint != null &&
            targetConstraint.hasPadReferenceY &&
            Float.isFinite(targetConstraint.padReferenceY);
        final double padRefY = hasPadRef ? targetConstraint.padReferenceY : 0.0;

        final List<float[]> candidates = new ArrayList<>();
        if (hasPadRef) {
            // Keep ground samples consistent with the operator's explicit patio tap (within +/- 0.18 m)
            for (float[] g : groundSamples) {
                if (Math.abs(g[1] - padRefY) <= 0.18) {
                    candidates.add(g);
                }
            }
        } else {
            candidates.addAll(groundSamples);
        }

        // Supplement with outer-band floor points ONLY when explicit ARCore ground samples are sparse
        if (candidates.size() < 16) {
            @SuppressWarnings("unchecked")
            final ArrayList<float[]>[] sectorPts = new ArrayList[SECTOR_COUNT];
            final float[] sectorMaxR = new float[SECTOR_COUNT];
            for (float[] p : points) {
                final double dx = p[0] - cx;
                final double dz = p[2] - cz;
                final float r = (float) Math.hypot(dx, dz);
                final int s = sectorOf(dx, dz);
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
                final float refBandY = hasPadRef
                    ? (float) padRefY
                    : outer.get(Math.min(outer.size() - 1, (int) Math.floor(outer.size() * 0.15)))[1];
                int added = 0;
                for (float[] p : outer) {
                    if (Math.abs(p[1] - refBandY) <= 0.10f) {
                        candidates.add(p);
                        added++;
                        if (added >= 12) {
                            break;
                        }
                    }
                }
            }
        }

        if (hasPadRef && candidates.size() < 6) {
            // Confined pile with explicit patio tap and sparse floor samples: lock horizontal plane at padReferenceY
            return new double[] { 0.0, 0.0, padRefY, 0.015, MIN_SIGMA_GROUND_M };
        }

        if (candidates.size() < 3) {
            final double fallbackY = hasPadRef ? padRefY : (!points.isEmpty() ? medianY(points) : 0.0);
            return new double[] { 0.0, 0.0, fallbackY, 0.03, 0.025 };
        }

        // Deterministic RANSAC over candidate triplets
        final int n = candidates.size();
        double bestScore = -Double.MAX_VALUE;
        double bestA = 0.0;
        double bestB = 0.0;
        double bestD = hasPadRef ? padRefY : medianY(candidates);
        final double maxSlopeTan = Math.tan(Math.toRadians(Math.min(14.0, walkRingSlopeDeg + MAX_GRAVITY_MISMATCH_DEG + 4.0)));

        final int trials = Math.min(120, Math.max(24, n * 2));
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
            final double[] plane = fitPlane3Points(candidates.get(i0), candidates.get(i1), candidates.get(i2));
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
            int outliers = 0;
            for (float[] c : candidates) {
                final double err = (c[1] - (a * c[0] + b * c[2] + d)) * invNorm;
                if (Math.abs(err) <= 0.06) {
                    inliers++;
                } else {
                    outliers++;
                }
            }
            final double slopeDeg = Math.toDegrees(Math.atan(slopeTan));
            final double gravityPenalty = Math.max(0.0, Math.abs(slopeDeg - walkRingSlopeDeg) - 1.5) * 1.5;
            final double padPenalty = hasPadRef
                ? Math.abs((a * cx + b * cz + d) - padRefY) * 25.0
                : 0.0;
            final double score = inliers - outliers * 0.25 - gravityPenalty - padPenalty;
            if (score > bestScore) {
                bestScore = score;
                bestA = a;
                bestB = b;
                bestD = d;
            }
        }

        // Collect inliers around RANSAC plane and refine with Huber IRLS (unbiased symmetric M-estimator)
        final double invBestNorm = 1.0 / Math.sqrt(1.0 + bestA * bestA + bestB * bestB);
        final List<float[]> inliers = new ArrayList<>();
        for (float[] c : candidates) {
            final double err = (c[1] - (bestA * c[0] + bestB * c[2] + bestD)) * invBestNorm;
            if (Math.abs(err) <= 0.10) {
                inliers.add(c);
            }
        }
        final List<float[]> fitList = inliers.size() >= 3 ? inliers : candidates;
        final double[] huber = fitPlaneHuberIRLS(fitList, bestA, bestB, bestD, 0.035, 6);
        if (huber != null) {
            bestA = huber[0];
            bestB = huber[1];
            bestD = huber[2];
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
            // Refit d at unbiased p50 median of ground offsets (replaces legacy biased p15!)
            final double[] offsets = new double[fitList.size()];
            for (int i = 0; i < fitList.size(); i++) {
                final float[] p = fitList.get(i);
                offsets[i] = p[1] - (bestA * p[0] + bestB * p[2]);
            }
            bestD = medianDouble(offsets, offsets.length);
        }

        // If operator explicitly tapped patio floor elevation (padReferenceY), anchor plane offset to padReferenceY
        if (hasPadRef) {
            bestD = padRefY - (bestA * cx + bestB * cz);
        }

        // Compute RMS and empirical ground noise sigmaGround = clamp(1.4826 * MAD, 0.012, 0.06)
        final int m = fitList.size();
        final double[] residuals = new double[m];
        final double norm = 1.0 / Math.sqrt(1.0 + bestA * bestA + bestB * bestB);
        double sumSq = 0.0;
        for (int i = 0; i < m; i++) {
            final float[] p = fitList.get(i);
            final double err = (p[1] - (bestA * p[0] + bestB * p[2] + bestD)) * norm;
            residuals[i] = err;
            sumSq += err * err;
        }
        final double rms = Math.sqrt(sumSq / Math.max(1, m));
        final double medRes = medianDouble(residuals, m);
        final double[] absDev = new double[m];
        for (int i = 0; i < m; i++) {
            absDev[i] = Math.abs(residuals[i] - medRes);
        }
        final double mad = medianDouble(absDev, m);
        final double sigmaGround = clampDouble(1.4826 * mad, MIN_SIGMA_GROUND_M, MAX_SIGMA_GROUND_M);

        return new double[] { bestA, bestB, bestD, rms, sigmaGround };
    }

    /**
     * Iteratively Reweighted Least Squares (Huber M-estimator) for plane y = a*x + b*z + d.
     */
    private static double[] fitPlaneHuberIRLS(
        final List<float[]> pts,
        final double initA,
        final double initB,
        final double initD,
        final double huberDelta,
        final int iterations
    ) {
        final int n = pts.size();
        if (n < 3) {
            return null;
        }
        double a = initA;
        double b = initB;
        double d = initD;
        for (int iter = 0; iter < iterations; iter++) {
            double sXX = 0, sXZ = 0, sX = 0, sZZ = 0, sZ = 0, sW = 0, sXY = 0, sZY = 0, sY = 0;
            for (int i = 0; i < n; i++) {
                final float[] p = pts.get(i);
                final double x = p[0];
                final double y = p[1];
                final double z = p[2];
                final double r = Math.abs(y - (a * x + b * z + d));
                final double w = r <= huberDelta ? 1.0 : (huberDelta / Math.max(1e-6, r));
                sXX += w * x * x;
                sXZ += w * x * z;
                sX += w * x;
                sZZ += w * z * z;
                sZ += w * z;
                sW += w;
                sXY += w * x * y;
                sZY += w * z * y;
                sY += w * y;
            }
            final double[] sol = solve3x3(
                new double[][] {
                    { sXX, sXZ, sX },
                    { sXZ, sZZ, sZ },
                    { sX, sZ, sW }
                },
                new double[] { sXY, sZY, sY }
            );
            if (sol == null) {
                break;
            }
            a = sol[0];
            b = sol[1];
            d = sol[2];
        }
        return new double[] { a, b, d };
    }

    /**
     * Dual-hysteresis toe segmentation + 8-connected component selection + 3D Marker-Controlled
     * Priority-Flood Watershed on -h(x, z) + bounded geodesic toe expansion.
     */
    private static byte[] segmentTargetObjectMask(
        final float[] rawHeights,
        final byte[] rawObserved,
        final boolean[] inAllowedRegion,
        final float originX,
        final float originZ,
        final float cellSizeM,
        final int cols,
        final int rows,
        final float hSeed,
        final float hToe,
        final float sigmaGround,
        final TargetVolumeConstraint targetConstraint
    ) {
        final int n = cols * rows;
        final boolean hasTarget = targetConstraint != null && targetConstraint.active;

        // 1. Seed mask: observed cells inside allowed region with h >= hSeed
        final byte[] seedMask = new byte[n];
        int seedCount = 0;
        for (int i = 0; i < n; i++) {
            if (inAllowedRegion[i] && rawObserved[i] != 0 && rawHeights[i] >= hSeed) {
                seedMask[i] = 1;
                seedCount++;
            }
        }
        if (seedCount == 0) {
            return new byte[n];
        }

        // 2. 8-connected component labeling on seedMask
        final int[] compId = new int[n];
        final int[] queue = new int[n];
        final List<Integer> compSizes = new ArrayList<>();
        final List<Double> compVols = new ArrayList<>();
        final List<Double> compMinAnchorDistSq = new ArrayList<>();
        int nextComp = 0;

        for (int i = 0; i < n; i++) {
            if (seedMask[i] == 0 || compId[i] != 0) {
                continue;
            }
            nextComp++;
            int head = 0;
            int tail = 0;
            compId[i] = nextComp;
            queue[tail++] = i;
            int sz = 0;
            double vol = 0.0;
            double bestDistSq = Double.MAX_VALUE;

            while (head < tail) {
                final int cur = queue[head++];
                sz++;
                vol += rawHeights[cur];
                final int cr = cur / cols;
                final int cc = cur % cols;
                if (hasTarget) {
                    final double wx = originX + (cc + 0.5) * cellSizeM;
                    final double wz = originZ + (cr + 0.5) * cellSizeM;
                    final double dSq =
                        (wx - targetConstraint.anchorX) * (wx - targetConstraint.anchorX) +
                        (wz - targetConstraint.anchorZ) * (wz - targetConstraint.anchorZ);
                    if (dSq < bestDistSq) {
                        bestDistSq = dSq;
                    }
                }
                for (int dr = -1; dr <= 1; dr++) {
                    final int nr = cr + dr;
                    if (nr < 0 || nr >= rows) continue;
                    for (int dc = -1; dc <= 1; dc++) {
                        if (dr == 0 && dc == 0) continue;
                        final int nc = cc + dc;
                        if (nc < 0 || nc >= cols) continue;
                        final int ni = nr * cols + nc;
                        if (seedMask[ni] != 0 && compId[ni] == 0) {
                            compId[ni] = nextComp;
                            queue[tail++] = ni;
                        }
                    }
                }
            }
            compSizes.add(sz);
            compVols.add(vol);
            compMinAnchorDistSq.add(bestDistSq);
        }

        // Pick target component: closest to Anchor if active (preferring components >= 2 cells), else dominant volume
        int chosenComp = 1;
        if (hasTarget) {
            double bestDistSq = Double.MAX_VALUE;
            int bestAnyComp = 1;
            double bestAnyDistSq = Double.MAX_VALUE;
            for (int c = 1; c <= nextComp; c++) {
                final double dSq = compMinAnchorDistSq.get(c - 1);
                if (dSq < bestAnyDistSq) {
                    bestAnyDistSq = dSq;
                    bestAnyComp = c;
                }
                if (compSizes.get(c - 1) >= 2 && dSq < bestDistSq) {
                    bestDistSq = dSq;
                    chosenComp = c;
                }
            }
            if (bestDistSq == Double.MAX_VALUE) {
                chosenComp = bestAnyComp;
            }
        } else {
            double bestVol = -1.0;
            for (int c = 1; c <= nextComp; c++) {
                final double v = compVols.get(c - 1);
                if (v > bestVol) {
                    bestVol = v;
                    chosenComp = c;
                }
            }
        }

        // 3. Build 3x3 lightly smoothed height field for marker-controlled 3D Watershed
        final float[] smoothH = new float[n];
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                final int idx = r * cols + c;
                if (!inAllowedRegion[idx] || rawObserved[idx] == 0) {
                    continue;
                }
                float sum = rawHeights[idx] * 2.0f;
                float wSum = 2.0f;
                for (int dr = -1; dr <= 1; dr++) {
                    final int nr = r + dr;
                    if (nr < 0 || nr >= rows) continue;
                    for (int dc = -1; dc <= 1; dc++) {
                        if (dr == 0 && dc == 0) continue;
                        final int nc = c + dc;
                        if (nc < 0 || nc >= cols) continue;
                        final int ni = nr * cols + nc;
                        if (inAllowedRegion[ni] && rawObserved[ni] != 0) {
                            sum += rawHeights[ni];
                            wSum += 1.0f;
                        }
                    }
                }
                smoothH[idx] = sum / wSum;
            }
        }

        // 4. Marker-Controlled Priority-Flood Watershed on -h(x, z) when a real competitor peak exists
        final int[] watershedLabel = runMarkerControlledWatershed(
            rawHeights,
            smoothH,
            rawObserved,
            inAllowedRegion,
            compId,
            chosenComp,
            originX,
            originZ,
            cellSizeM,
            cols,
            rows,
            hToe,
            sigmaGround,
            targetConstraint
        );

        // 5. Core mask = chosen seed component (intersected with watershed target label 1 if watershed ran)
        final byte[] objectMask = new byte[n];
        final int[] distCells = new int[n];
        Arrays.fill(distCells, Integer.MAX_VALUE);
        int qHead = 0;
        int qTail = 0;
        int coreCount = 0;

        for (int i = 0; i < n; i++) {
            if (compId[i] == chosenComp && (watershedLabel == null || watershedLabel[i] == 1)) {
                objectMask[i] = 1;
                distCells[i] = 0;
                queue[qTail++] = i;
                coreCount++;
            }
        }
        if (coreCount == 0) {
            // Fallback: keep chosenComp without watershed cut if marker missed
            for (int i = 0; i < n; i++) {
                if (compId[i] == chosenComp) {
                    objectMask[i] = 1;
                    distCells[i] = 0;
                    queue[qTail++] = i;
                    coreCount++;
                }
            }
        }

        // 6. Bounded geodesic expansion from core down to hToe along contiguous border
        //    maxExpand <= max(2 cells, ceil(0.25 * rCore / cellSizeM))
        final double rCoreM = Math.sqrt((coreCount * (double) cellSizeM * (double) cellSizeM) / Math.PI);
        final int maxExpandCells = Math.max(2, (int) Math.ceil((0.25 * rCoreM) / cellSizeM));

        while (qHead < qTail) {
            final int cur = queue[qHead++];
            final int curDist = distCells[cur];
            if (curDist >= maxExpandCells) {
                continue;
            }
            final int cr = cur / cols;
            final int cc = cur % cols;
            for (int dr = -1; dr <= 1; dr++) {
                final int nr = cr + dr;
                if (nr < 0 || nr >= rows) continue;
                for (int dc = -1; dc <= 1; dc++) {
                    if (dr == 0 && dc == 0) continue;
                    final int nc = cc + dc;
                    if (nc < 0 || nc >= cols) continue;
                    final int ni = nr * cols + nc;
                    if (
                        objectMask[ni] == 0 &&
                        inAllowedRegion[ni] &&
                        rawObserved[ni] != 0 &&
                        rawHeights[ni] >= hToe &&
                        (watershedLabel == null || watershedLabel[ni] == 1)
                    ) {
                        objectMask[ni] = 1;
                        distCells[ni] = curDist + 1;
                        queue[qTail++] = ni;
                    }
                }
            }
        }

        return objectMask;
    }

    /**
     * Detects target peak vs genuine competitor peaks (>= max(0.20, 0.25 * hTarget) separated by a real
     * valley/saddle) and runs Priority-Flood Watershed on -h(x, z) to cut cleanly along the valley line.
     * Returns label array (1 = target, >= 2 = competitor) or null if no competitor peak exists.
     */
    private static int[] runMarkerControlledWatershed(
        final float[] rawHeights,
        final float[] smoothH,
        final byte[] rawObserved,
        final boolean[] inAllowedRegion,
        final int[] compId,
        final int chosenComp,
        final float originX,
        final float originZ,
        final float cellSizeM,
        final int cols,
        final int rows,
        final float hToe,
        final float sigmaGround,
        final TargetVolumeConstraint targetConstraint
    ) {
        final int n = cols * rows;
        final boolean hasTarget = targetConstraint != null && targetConstraint.active;
        final int peakRadiusCells = Math.max(2, (int) Math.round(0.30f / cellSizeM));

        // Candidate peaks: local maxima within peakRadiusCells on smoothH inside allowed region
        final List<Integer> localPeaks = new ArrayList<>();
        for (int r = 1; r < rows - 1; r++) {
            for (int c = 1; c < cols - 1; c++) {
                final int idx = r * cols + c;
                if (!inAllowedRegion[idx] || rawObserved[idx] == 0 || smoothH[idx] < Math.max(0.15f, hToe)) {
                    continue;
                }
                final float val = smoothH[idx];
                boolean isMax = true;
                for (int dr = -peakRadiusCells; dr <= peakRadiusCells && isMax; dr++) {
                    final int nr = r + dr;
                    if (nr < 0 || nr >= rows) continue;
                    for (int dc = -peakRadiusCells; dc <= peakRadiusCells; dc++) {
                        if (dr == 0 && dc == 0) continue;
                        final int nc = c + dc;
                        if (nc < 0 || nc >= cols) continue;
                        final int ni = nr * cols + nc;
                        if (smoothH[ni] > val || (smoothH[ni] == val && ni < idx)) {
                            isMax = false;
                            break;
                        }
                    }
                }
                if (isMax) {
                    localPeaks.add(idx);
                }
            }
        }
        if (localPeaks.size() < 2) {
            return null;
        }

        // Select target peak: closest to Anchor (or steepest ascent from Anchor), else highest peak in chosenComp
        int targetPeak = -1;
        if (hasTarget) {
            final int anchorCol = Math.max(0, Math.min(cols - 1, (int) Math.floor((targetConstraint.anchorX - originX) / cellSizeM)));
            final int anchorRow = Math.max(0, Math.min(rows - 1, (int) Math.floor((targetConstraint.anchorZ - originZ) / cellSizeM)));
            // Follow steepest ascent on smoothH from anchor neighborhood to find the exact peak owning Anchor
            int cur = anchorRow * cols + anchorCol;
            if (smoothH[cur] < hToe) {
                // Snap to closest seed cell in chosenComp
                double bestD = Double.MAX_VALUE;
                for (int i = 0; i < n; i++) {
                    if (compId[i] != chosenComp) continue;
                    final double d = Math.hypot((i % cols) - anchorCol, (i / cols) - anchorRow);
                    if (d < bestD) {
                        bestD = d;
                        cur = i;
                    }
                }
            }
            for (int step = 0; step < Math.max(cols, rows); step++) {
                final int cr = cur / cols;
                final int cc = cur % cols;
                int bestNb = cur;
                float bestVal = smoothH[cur];
                for (int dr = -1; dr <= 1; dr++) {
                    final int nr = cr + dr;
                    if (nr < 0 || nr >= rows) continue;
                    for (int dc = -1; dc <= 1; dc++) {
                        final int nc = cc + dc;
                        if (nc < 0 || nc >= cols) continue;
                        final int ni = nr * cols + nc;
                        if (smoothH[ni] > bestVal) {
                            bestVal = smoothH[ni];
                            bestNb = ni;
                        }
                    }
                }
                if (bestNb == cur) break;
                cur = bestNb;
            }
            // Match climbed summit to nearest local peak
            double bestPeakDist = Double.MAX_VALUE;
            final int cr = cur / cols;
            final int cc = cur % cols;
            for (int pIdx : localPeaks) {
                final double d = Math.hypot((pIdx % cols) - cc, (pIdx / cols) - cr);
                if (d < bestPeakDist) {
                    bestPeakDist = d;
                    targetPeak = pIdx;
                }
            }
        } else {
            float bestH = -1.0f;
            for (int pIdx : localPeaks) {
                if (compId[pIdx] == chosenComp && smoothH[pIdx] > bestH) {
                    bestH = smoothH[pIdx];
                    targetPeak = pIdx;
                }
            }
        }
        if (targetPeak < 0) {
            return null;
        }

        final float hTarget = smoothH[targetPeak];
        final float minCompH = Math.max(0.20f, 0.25f * hTarget);
        final float minSepM = Math.max(3.0f * cellSizeM, 0.45f);
        final float minValleyDrop = Math.max(0.08f, 2.5f * sigmaGround);

        // Filter genuine competitor peaks (sufficient height, separation, and valley dip along connecting line)
        final List<Integer> competitors = new ArrayList<>();
        final int tr = targetPeak / cols;
        final int tc = targetPeak % cols;
        for (int pIdx : localPeaks) {
            if (pIdx == targetPeak || smoothH[pIdx] < minCompH) {
                continue;
            }
            final int pr = pIdx / cols;
            final int pc = pIdx % cols;
            final float distM = (float) Math.hypot((pc - tc) * cellSizeM, (pr - tr) * cellSizeM);
            if (distM < minSepM) {
                continue;
            }
            // Check minimum height along the straight segment between targetPeak and competitor peak
            final int steps = Math.max(4, (int) Math.ceil(Math.hypot(pc - tc, pr - tr) * 2.0));
            float minLineH = Float.MAX_VALUE;
            for (int s = 1; s < steps; s++) {
                final float t = s / (float) steps;
                final int sr = Math.max(0, Math.min(rows - 1, Math.round(tr + t * (pr - tr))));
                final int sc = Math.max(0, Math.min(cols - 1, Math.round(tc + t * (pc - tc))));
                final float sh = smoothH[sr * cols + sc];
                if (sh < minLineH) {
                    minLineH = sh;
                }
            }
            final float lowerPeak = Math.min(hTarget, smoothH[pIdx]);
            if ((lowerPeak - minLineH) >= minValleyDrop) {
                competitors.add(pIdx);
            }
        }
        if (competitors.isEmpty()) {
            return null;
        }

        // Priority-Flood Watershed on -h(x, z): max-heap ordered by descending smoothH
        final int[] labels = new int[n];
        final PriorityQueue<Integer> pq = new PriorityQueue<>(
            Math.max(16, n / 4),
            (a, b) -> Float.compare(smoothH[b], smoothH[a])
        );
        labels[targetPeak] = 1;
        pq.offer(targetPeak);
        int compLabel = 2;
        for (int pIdx : competitors) {
            if (labels[pIdx] == 0) {
                labels[pIdx] = compLabel++;
                pq.offer(pIdx);
            }
        }

        while (!pq.isEmpty()) {
            final int cur = pq.poll();
            final int lbl = labels[cur];
            final int cr = cur / cols;
            final int cc = cur % cols;
            for (int dr = -1; dr <= 1; dr++) {
                final int nr = cr + dr;
                if (nr < 0 || nr >= rows) continue;
                for (int dc = -1; dc <= 1; dc++) {
                    if (dr == 0 && dc == 0) continue;
                    final int nc = cc + dc;
                    if (nc < 0 || nc >= cols) continue;
                    final int ni = nr * cols + nc;
                    if (
                        labels[ni] == 0 &&
                        inAllowedRegion[ni] &&
                        rawObserved[ni] != 0 &&
                        (rawHeights[ni] >= hToe || smoothH[ni] >= hToe * 0.5f)
                    ) {
                        labels[ni] = lbl;
                        pq.offer(ni);
                    }
                }
            }
        }
        return labels;
    }

    /**
     * Fills strictly enclosed interior holes via 4-connected exterior flood-fill from grid borders.
     * Eliminates global H/V scanline bridges that previously absorbed detached ground cells.
     */
    private static byte[] fillEnclosedInteriorHolesOnly(final byte[] objectMask, final int cols, final int rows) {
        final int n = cols * rows;
        final byte[] mask = Arrays.copyOf(objectMask, n);
        final byte[] exterior = new byte[n];
        final int[] queue = new int[n];
        int head = 0;
        int tail = 0;

        for (int c = 0; c < cols; c++) {
            if (mask[c] == 0 && exterior[c] == 0) {
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

        for (int i = 0; i < n; i++) {
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

    /**
     * Strict object-flank slope estimator relative to +Y gravity (ceiling 89.5 deg, discards plateaus < 12 deg):
     * - Primary: 16-sector radial profile h(d_edge) Theil-Sen median(atan2(|dh|, |dd_edge|)) on observed
     *   flank cells h in [max(0.18*H, hToe + 2*sigmaGround), 0.82*H] (plus vertical rim cliff cells bordering exterior).
     * - Secondary / Gravity-Corrected DEM Gradient: dh/dx + planeA, dh/dz + planeB including unilateral border
     *   differences at the objectMask boundary.
     */
    private static double computeStrictObjectSlopeAngleDeg(
        final float[] heights,
        final byte[] observedMask,
        final byte[] objectMask,
        final float originX,
        final float originZ,
        final int cols,
        final int rows,
        final float cellSizeM,
        final float dimH,
        final float hToe,
        final float sigmaGround,
        final double planeA,
        final double planeB,
        final float objCx,
        final float objCz
    ) {
        if (dimH < 0.12f) {
            return 0.0;
        }
        final int n = cols * rows;
        final float hLo = Math.max(0.18f * dimH, hToe + 2.0f * sigmaGround);
        final float hHi = 0.82f * dimH;

        // 1. Exact Euclidean distance transform d_edge (meters) from every object cell to nearest exterior cell
        final float[] dEdgeM = computeDistanceToExteriorM(objectMask, cols, rows, cellSizeM);

        // Identify rim cells directly bordering exterior (captures vertical structures/cylinders where h jumps to H)
        final boolean[] isRimCell = new boolean[n];
        int interiorFlankCount = 0;
        for (int r = 1; r < rows - 1; r++) {
            for (int c = 1; c < cols - 1; c++) {
                final int idx = r * cols + c;
                if (objectMask[idx] == 0 || observedMask[idx] == 0) {
                    continue;
                }
                final boolean bordersExt =
                    objectMask[idx - 1] == 0 ||
                    objectMask[idx + 1] == 0 ||
                    objectMask[idx - cols] == 0 ||
                    objectMask[idx + cols] == 0;
                isRimCell[idx] = bordersExt;
                if (heights[idx] >= hLo && heights[idx] <= hHi) {
                    interiorFlankCount++;
                }
            }
        }

        // 2. Primary: 16-sector radial profile h(d_edge) Theil-Sen
        @SuppressWarnings("unchecked")
        final ArrayList<float[]>[] sectorSamples = new ArrayList[SECTOR_COUNT];
        for (int r = 1; r < rows - 1; r++) {
            final float wz = originZ + (r + 0.5f) * cellSizeM;
            for (int c = 1; c < cols - 1; c++) {
                final int idx = r * cols + c;
                if (objectMask[idx] == 0 || observedMask[idx] == 0) {
                    continue;
                }
                final float h = heights[idx];
                final boolean inBelt = (h >= hLo && h <= hHi);
                final boolean isVerticalCliffRim = isRimCell[idx] && h >= hLo;
                if (!inBelt && !isVerticalCliffRim) {
                    continue;
                }
                final int s = sectorOf(originX + (c + 0.5f) * cellSizeM - objCx, wz - objCz);
                if (sectorSamples[s] == null) {
                    sectorSamples[s] = new ArrayList<>(16);
                }
                sectorSamples[s].add(new float[] { dEdgeM[idx], h });
            }
        }

        final double[] sectorTheilSenDeg = new double[SECTOR_COUNT];
        int validSectors = 0;
        for (int s = 0; s < SECTOR_COUNT; s++) {
            final ArrayList<float[]> list = sectorSamples[s];
            if (list == null || list.isEmpty()) {
                continue;
            }
            // Radial inward unit direction for sector s -> gravity plane slope component along radius
            final double secAng = Math.toRadians((s + 0.5) * (360.0 / SECTOR_COUNT));
            final double radialPlaneSlope = -(planeA * Math.cos(secAng) + planeB * Math.sin(secAng));

            final ArrayList<Double> pairSlopes = new ArrayList<>(64);
            final int m = list.size();
            // Include pairwise slopes within flank belt
            final int maxPairs = 120;
            final int step = m > 18 ? Math.max(1, m / 16) : 1;
            for (int i = 0; i < m && pairSlopes.size() < maxPairs; i += step) {
                final float di = list.get(i)[0];
                final float hi = list.get(i)[1];
                // Anchor to exterior toe (d_edge = 0, h = 0) when cell is a rim cliff or few interior samples exist
                if (interiorFlankCount < 10 || di <= cellSizeM * 1.6f) {
                    final double dEff = Math.max(0.5 * cellSizeM, di);
                    final double slopeVal = Math.abs((hi / dEff) + radialPlaneSlope);
                    final double deg = Math.min(MAX_SLOPE_CEILING_DEG, Math.toDegrees(Math.atan(slopeVal)));
                    if (deg >= MIN_FLANK_SLOPE_DEG) {
                        pairSlopes.add(deg);
                    }
                }
                for (int j = i + step; j < m && pairSlopes.size() < maxPairs; j += step) {
                    final double dd = list.get(j)[0] - di;
                    if (Math.abs(dd) < cellSizeM * 0.5) {
                        continue;
                    }
                    final double dh = list.get(j)[1] - hi;
                    final double deg = Math.min(
                        MAX_SLOPE_CEILING_DEG,
                        Math.toDegrees(Math.atan(Math.abs((dh / dd) + radialPlaneSlope)))
                    );
                    if (deg >= MIN_FLANK_SLOPE_DEG) {
                        pairSlopes.add(deg);
                    }
                }
            }
            if (!pairSlopes.isEmpty()) {
                final double[] arr = new double[pairSlopes.size()];
                for (int k = 0; k < arr.length; k++) {
                    arr[k] = pairSlopes.get(k);
                }
                sectorTheilSenDeg[validSectors++] = medianDouble(arr, arr.length);
            }
        }

        final double radialSlopeDeg = validSectors >= 4
            ? medianDouble(sectorTheilSenDeg, validSectors)
            : -1.0;

        // 3. Secondary: Gravity-corrected DEM gradient (+planeA, +planeB) with unilateral border differences
        final double[] demSlopes = new double[n];
        int demCount = 0;
        for (int r = 1; r < rows - 1; r++) {
            for (int c = 1; c < cols - 1; c++) {
                final int idx = r * cols + c;
                if (objectMask[idx] == 0 || observedMask[idx] == 0) {
                    continue;
                }
                final float h = heights[idx];
                final boolean inBelt = (h >= hLo && h <= hHi);
                final boolean isVerticalCliffRim = isRimCell[idx] && h >= hLo;
                if (!inBelt && !isVerticalCliffRim) {
                    continue;
                }

                // Compute dh/dx using central diff when both inside, else unilateral diff (including exterior h=0)
                final double dhdx;
                final boolean hasLeft = objectMask[idx - 1] != 0 && observedMask[idx - 1] != 0;
                final boolean hasRight = objectMask[idx + 1] != 0 && observedMask[idx + 1] != 0;
                if (hasLeft && hasRight) {
                    dhdx = (heights[idx + 1] - heights[idx - 1]) / (2.0 * cellSizeM);
                } else if (objectMask[idx - 1] == 0 && !hasRight) {
                    dhdx = h / cellSizeM;
                } else if (objectMask[idx + 1] == 0 && !hasLeft) {
                    dhdx = -h / cellSizeM;
                } else if (objectMask[idx - 1] == 0) {
                    final double cliffX = h / cellSizeM;
                    final double inX = (heights[idx + 1] - h) / cellSizeM;
                    dhdx = Math.abs(cliffX) >= Math.abs(inX) ? cliffX : inX;
                } else if (objectMask[idx + 1] == 0) {
                    final double cliffX = -h / cellSizeM;
                    final double inX = (h - heights[idx - 1]) / cellSizeM;
                    dhdx = Math.abs(cliffX) >= Math.abs(inX) ? cliffX : inX;
                } else if (hasRight) {
                    dhdx = (heights[idx + 1] - h) / cellSizeM;
                } else if (hasLeft) {
                    dhdx = (h - heights[idx - 1]) / cellSizeM;
                } else {
                    dhdx = 0.0;
                }

                final double dhdz;
                final boolean hasUp = objectMask[idx - cols] != 0 && observedMask[idx - cols] != 0;
                final boolean hasDn = objectMask[idx + cols] != 0 && observedMask[idx + cols] != 0;
                if (hasUp && hasDn) {
                    dhdz = (heights[idx + cols] - heights[idx - cols]) / (2.0 * cellSizeM);
                } else if (objectMask[idx - cols] == 0 && !hasDn) {
                    dhdz = h / cellSizeM;
                } else if (objectMask[idx + cols] == 0 && !hasUp) {
                    dhdz = -h / cellSizeM;
                } else if (objectMask[idx - cols] == 0) {
                    final double cliffZ = h / cellSizeM;
                    final double inZ = (heights[idx + cols] - h) / cellSizeM;
                    dhdz = Math.abs(cliffZ) >= Math.abs(inZ) ? cliffZ : inZ;
                } else if (objectMask[idx + cols] == 0) {
                    final double cliffZ = -h / cellSizeM;
                    final double inZ = (h - heights[idx - cols]) / cellSizeM;
                    dhdz = Math.abs(cliffZ) >= Math.abs(inZ) ? cliffZ : inZ;
                } else if (hasDn) {
                    dhdz = (heights[idx + cols] - h) / cellSizeM;
                } else if (hasUp) {
                    dhdz = (h - heights[idx - cols]) / cellSizeM;
                } else {
                    dhdz = 0.0;
                }

                // True world gradient relative to +Y gravity: add ground plane slopes +planeA, +planeB
                final double grad = Math.hypot(dhdx + planeA, dhdz + planeB);
                final double deg = Math.min(MAX_SLOPE_CEILING_DEG, Math.toDegrees(Math.atan(grad)));
                if (deg >= MIN_FLANK_SLOPE_DEG) {
                    demSlopes[demCount++] = deg;
                }
            }
        }
        final double demSlopeDeg = demCount > 0 ? medianDouble(demSlopes, demCount) : -1.0;

        if (radialSlopeDeg > 0.0 && demSlopeDeg > 0.0) {
            // Primary radial Theil-Sen; if object is a sheer vertical rim with few interior flank cells, honor steeper rim
            if (interiorFlankCount < 10) {
                return Math.min(MAX_SLOPE_CEILING_DEG, Math.max(radialSlopeDeg, demSlopeDeg));
            }
            return Math.min(MAX_SLOPE_CEILING_DEG, radialSlopeDeg);
        }
        if (radialSlopeDeg > 0.0) {
            return Math.min(MAX_SLOPE_CEILING_DEG, radialSlopeDeg);
        }
        if (demSlopeDeg > 0.0) {
            return Math.min(MAX_SLOPE_CEILING_DEG, demSlopeDeg);
        }
        return 0.0;
    }

    /**
     * Exact Euclidean distance (meters) from each interior object cell to the nearest exterior cell
     * using two-pass Chamfer-3-4 / exact boundary-seeded transform (fast on <= 64x64 grid).
     */
    private static float[] computeDistanceToExteriorM(
        final byte[] objectMask,
        final int cols,
        final int rows,
        final float cellSizeM
    ) {
        final int n = cols * rows;
        final float[] dist = new float[n];
        final float inf = 1e6f;
        for (int i = 0; i < n; i++) {
            dist[i] = objectMask[i] == 0 ? 0.0f : inf;
        }
        final float dOrtho = cellSizeM;
        final float dDiag = cellSizeM * 1.4142135f;

        // Forward pass
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                final int idx = r * cols + c;
                float best = dist[idx];
                if (best == 0.0f) continue;
                if (r > 0) best = Math.min(best, dist[idx - cols] + dOrtho);
                if (c > 0) best = Math.min(best, dist[idx - 1] + dOrtho);
                if (r > 0 && c > 0) best = Math.min(best, dist[idx - cols - 1] + dDiag);
                if (r > 0 && c + 1 < cols) best = Math.min(best, dist[idx - cols + 1] + dDiag);
                dist[idx] = best;
            }
        }
        // Backward pass
        for (int r = rows - 1; r >= 0; r--) {
            for (int c = cols - 1; c >= 0; c--) {
                final int idx = r * cols + c;
                float best = dist[idx];
                if (best == 0.0f) continue;
                if (r + 1 < rows) best = Math.min(best, dist[idx + cols] + dOrtho);
                if (c + 1 < cols) best = Math.min(best, dist[idx + 1] + dOrtho);
                if (r + 1 < rows && c + 1 < cols) best = Math.min(best, dist[idx + cols + 1] + dDiag);
                if (r + 1 < rows && c > 0) best = Math.min(best, dist[idx + cols - 1] + dDiag);
                dist[idx] = best;
            }
        }
        return dist;
    }

    private static boolean[] computeToeSectorAnchored(
        final List<float[]> groundSamples,
        final List<float[]> points,
        final float cx,
        final float cz,
        final double planeA,
        final double planeB,
        final double planeD,
        final boolean hasExplicitPadRef
    ) {
        final boolean[] anchored = new boolean[SECTOR_COUNT];
        if (hasExplicitPadRef) {
            Arrays.fill(anchored, true);
            return anchored;
        }
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
        final byte[] footprintMask,
        final double planeA,
        final double planeB,
        final double planeD,
        final float groundSlopeDeg,
        final float volumeM3,
        final float maxHeightM
    ) {
        final int stride = Math.max(1, (int) Math.ceil(Math.max(cols, rows) / (double) PREVIEW_MAX_DIM));
        final int pCols = Math.max(2, (cols + stride - 1) / stride);
        final int pRows = Math.max(2, (rows + stride - 1) / stride);
        final float[] pHeights = new float[pCols * pRows];
        final byte[] pObs = new byte[pCols * pRows];
        final byte[] pConf = new byte[pCols * pRows];

        for (int pr = 0; pr < pRows; pr++) {
            final int r0 = pr * stride;
            final int r1 = Math.min(rows, r0 + stride);
            for (int pc = 0; pc < pCols; pc++) {
                final int c0 = pc * stride;
                final int c1 = Math.min(cols, c0 + stride);
                final int totalSubcells = Math.max(1, (r1 - r0) * (c1 - c0));
                float sumActiveH = 0.0f;
                int activeCount = 0;
                boolean anyObsActive = false;
                for (int r = r0; r < r1; r++) {
                    for (int c = c0; c < c1; c++) {
                        final int idx = r * cols + c;
                        if (footprintMask[idx] != 0) {
                            sumActiveH += heights[idx];
                            activeCount++;
                            if (observedMask[idx] != 0) {
                                anyObsActive = true;
                            }
                        }
                    }
                }
                final int pIdx = pr * pCols + pc;
                // Average ONLY active footprint cells and activate macro-cell only if activeCount >= totalSubcells / 2
                if (activeCount > 0 && activeCount * 2 >= totalSubcells) {
                    final float avgH = Math.round((sumActiveH / activeCount) * 1000.0f) / 1000.0f;
                    pHeights[pIdx] = avgH;
                    pObs[pIdx] = anyObsActive ? (byte) 1 : (byte) 0;
                    if (anyObsActive) {
                        pConf[pIdx] = 2; // directly observed
                    } else if (avgH > 1e-4f) {
                        pConf[pIdx] = 1; // interpolated inside footprint
                    } else {
                        pConf[pIdx] = 0;
                    }
                } else {
                    pHeights[pIdx] = 0.0f;
                    pObs[pIdx] = 0;
                    pConf[pIdx] = 0;
                }
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
            pConf,
            planeA,
            planeB,
            planeD,
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
        // Supplement strictly with raw points falling inside the segmented object footprint
        if (out.size() < 3500 && !rawPoints.isEmpty()) {
            final int budget = 4000 - out.size();
            final int step = Math.max(1, rawPoints.size() / Math.max(1, budget));
            for (int i = 0; i < rawPoints.size() && out.size() < 4000; i += step) {
                final float[] p = rawPoints.get(i);
                final int col = (int) Math.floor((p[0] - originX) / cellSizeM);
                final int row = (int) Math.floor((p[2] - originZ) / cellSizeM);
                if (col >= 0 && col < cols && row >= 0 && row < rows && footprintMask[row * cols + col] != 0) {
                    out.add(new float[] { p[0], p[1], p[2] });
                }
            }
        }
        return out;
    }

    /**
     * Builds GLES 2.0 vertex arrays (capped <= 4096 vertices) for the real-time 3D HUD overlay:
     * verified surface triangles (#00AEEF 19%), gap wireframes (#C68346), 0.5 m contour lines,
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
                // Strictly require all 4 corners active inside footprint (zero spikes dropping to exterior floor!)
                final boolean allFourActive =
                    footprintMask[i00] != 0 &&
                    footprintMask[i10] != 0 &&
                    footprintMask[i01] != 0 &&
                    footprintMask[i11] != 0;
                if (!allFourActive) {
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
                    addPt(triVerts, x0, y00, z0);
                    addPt(triVerts, x0, y01, z1);
                    addPt(triVerts, x1, y10, z0);

                    addPt(triVerts, x1, y10, z0);
                    addPt(triVerts, x0, y01, z1);
                    addPt(triVerts, x1, y11, z1);
                } else if (!verified && gapLines.size() < 2400) {
                    // Only interior unobserved quads (all 4 corners inside footprint)
                    addPt(gapLines, x0, y00, z0);
                    addPt(gapLines, x1, y10, z0);
                    addPt(gapLines, x0, y00, z0);
                    addPt(gapLines, x0, y01, z1);
                }

                // True Marching-Squares contour lines strictly inside fully active quads
                if (contourLines.size() < 2400) {
                    final float h00 = heights[i00];
                    final float h10 = heights[i10];
                    final float h01 = heights[i01];
                    final float h11 = heights[i11];
                    final float hMin = Math.min(Math.min(h00, h10), Math.min(h01, h11));
                    final float hMax = Math.max(Math.max(h00, h10), Math.max(h01, h11));
                    final int kStart = (int) Math.floor(hMin / 0.5f) + 1;
                    final int kEnd = (int) Math.floor(hMax / 0.5f);
                    for (int k = kStart; k <= kEnd && contourLines.size() + 6 <= 2400; k++) {
                        final float level = k * 0.5f;
                        emitMarchingSquaresContour(
                            contourLines,
                            level,
                            x0, x1, z0, z1,
                            h00, h10, h01, h11,
                            planeA, planeB, planeD
                        );
                    }
                }

                if (heights[i00] >= crownThreshold && crownPts.size() < 96) {
                    addPt(crownPts, x0, y00, z0);
                }
            }
        }

        // Toe perimeter ring: radial p90 per populated sector, omitting empty sectors (never fallbackR spikes)
        @SuppressWarnings("unchecked")
        final ArrayList<float[]>[] sectorFootprint = new ArrayList[SECTOR_COUNT];
        for (int r = 0; r < rows; r++) {
            final float wz = originZ + (r + 0.5f) * cellSizeM;
            for (int c = 0; c < cols; c++) {
                final int idx = r * cols + c;
                if (footprintMask[idx] == 0) continue;
                final float wx = originX + (c + 0.5f) * cellSizeM;
                final float d = (float) Math.hypot(wx - cx, wz - cz);
                final int s = sectorOf(wx - cx, wz - cz);
                if (sectorFootprint[s] == null) {
                    sectorFootprint[s] = new ArrayList<>(8);
                }
                sectorFootprint[s].add(new float[] { d, wx, wz });
            }
        }

        final float[] sectorToeX = new float[SECTOR_COUNT];
        final float[] sectorToeZ = new float[SECTOR_COUNT];
        final boolean[] sectorHasToe = new boolean[SECTOR_COUNT];
        final ArrayList<Float> toeAnchored = new ArrayList<>(128);
        final ArrayList<Float> toeOpen = new ArrayList<>(128);

        for (int s = 0; s < SECTOR_COUNT; s++) {
            final ArrayList<float[]> list = sectorFootprint[s];
            if (list == null || list.isEmpty()) {
                continue;
            }
            list.sort((a, b) -> Float.compare(a[0], b[0]));
            final int p90Idx = Math.min(list.size() - 1, (int) Math.floor((list.size() - 1) * 0.90));
            final float[] chosen = list.get(p90Idx);
            sectorHasToe[s] = true;
            sectorToeX[s] = chosen[1];
            sectorToeZ[s] = chosen[2];
            final float ty = (float) (planeA * chosen[1] + planeB * chosen[2] + planeD) + 0.02f;
            addPt(toePts, chosen[1], ty, chosen[2]);
        }

        for (int s = 0; s < SECTOR_COUNT; s++) {
            if (!sectorHasToe[s]) {
                continue;
            }
            // Connect to the next populated sector within <= 2 sector steps (never bridge wide empty gaps)
            int next = -1;
            for (int step = 1; step <= 2; step++) {
                final int cand = (s + step) % SECTOR_COUNT;
                if (sectorHasToe[cand]) {
                    next = cand;
                    break;
                }
            }
            if (next < 0 || next == s) {
                continue;
            }
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

    /**
     * Robust upper envelope for a sorted ascending column of cell heights (replaces p50 median):
     * rejects upper outliers > p85 + 2.5*MAD, then takes p90 (count >= 5), p80 (count == 3..4), or max (<= 2).
     */
    private static float computeRobustUpperEnvelope(final float[] sorted) {
        final int n = sorted.length;
        if (n == 0) {
            return 0.0f;
        }
        if (n == 1) {
            return sorted[0];
        }
        int cleanLen = n;
        if (n >= 4) {
            final float med = percentileSorted(sorted, n, 0.50);
            final float[] devs = new float[n];
            for (int i = 0; i < n; i++) {
                devs[i] = Math.abs(sorted[i] - med);
            }
            Arrays.sort(devs);
            final float mad = Math.max(percentileSorted(devs, n, 0.50), 0.015f);
            final float p85 = percentileSorted(sorted, n, 0.85);
            final float upperFence = p85 + 2.5f * mad;
            while (cleanLen > 1 && sorted[cleanLen - 1] > upperFence) {
                cleanLen--;
            }
        }
        if (cleanLen >= 5) {
            return percentileSorted(sorted, cleanLen, 0.90);
        }
        if (cleanLen >= 3) {
            return percentileSorted(sorted, cleanLen, 0.80);
        }
        return sorted[cleanLen - 1];
    }

    private static float percentileSorted(final float[] sorted, final int len, final double p) {
        if (len <= 0) {
            return 0.0f;
        }
        if (len == 1) {
            return sorted[0];
        }
        final double idx = p * (len - 1);
        final int lo = Math.max(0, Math.min(len - 1, (int) Math.floor(idx)));
        final int hi = Math.min(len - 1, lo + 1);
        final double frac = idx - lo;
        return (float) (sorted[lo] + (sorted[hi] - sorted[lo]) * frac);
    }

    private static void emitMarchingSquaresContour(
        final ArrayList<Float> contourLines,
        final float level,
        final float x0,
        final float x1,
        final float z0,
        final float z1,
        final float h00,
        final float h10,
        final float h01,
        final float h11,
        final double planeA,
        final double planeB,
        final double planeD
    ) {
        final float[] pts = new float[8]; // up to 4 edge intersections (x, z)
        int count = 0;
        if ((h00 < level) != (h10 < level)) {
            final float t = (level - h00) / (h10 - h00);
            pts[count * 2] = x0 + t * (x1 - x0);
            pts[count * 2 + 1] = z0;
            count++;
        }
        if ((h10 < level) != (h11 < level)) {
            final float t = (level - h10) / (h11 - h10);
            pts[count * 2] = x1;
            pts[count * 2 + 1] = z0 + t * (z1 - z0);
            count++;
        }
        if ((h01 < level) != (h11 < level)) {
            final float t = (level - h01) / (h11 - h01);
            pts[count * 2] = x0 + t * (x1 - x0);
            pts[count * 2 + 1] = z1;
            count++;
        }
        if ((h00 < level) != (h01 < level)) {
            final float t = (level - h00) / (h01 - h00);
            pts[count * 2] = x0;
            pts[count * 2 + 1] = z0 + t * (z1 - z0);
            count++;
        }
        if (count >= 2) {
            final float ax = pts[0], az = pts[1];
            final float bx = pts[2], bz = pts[3];
            final float ay = (float) (planeA * ax + planeB * az + planeD + level) + 0.01f;
            final float by = (float) (planeA * bx + planeB * bz + planeD + level) + 0.01f;
            addPt(contourLines, ax, ay, az);
            addPt(contourLines, bx, by, bz);
        }
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

    private static double medianDouble(final double[] values, final int len) {
        if (values == null || len <= 0) {
            return 0.0;
        }
        final double[] copy = Arrays.copyOf(values, len);
        Arrays.sort(copy);
        final int mid = len / 2;
        return (len % 2 == 0) ? 0.5 * (copy[mid - 1] + copy[mid]) : copy[mid];
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

    private static float estimateLocalPointSpacingXZ(final List<float[]> pts) {
        final int total = pts.size();
        if (total < 2) {
            return 0.0f;
        }
        final int probeTarget = Math.min(48, total);
        final int probeStep = Math.max(1, total / probeTarget);
        final int refStep = total > 1500 ? Math.max(1, total / 1500) : 1;

        final float[] nnDists = new float[probeTarget];
        int nnCount = 0;
        for (int i = 0; i < total && nnCount < probeTarget; i += probeStep) {
            final float[] p = pts.get(i);
            float bestDistSq = Float.MAX_VALUE;
            for (int j = 0; j < total; j += refStep) {
                if (i == j) continue;
                final float[] q = pts.get(j);
                final float dx = p[0] - q[0];
                final float dz = p[2] - q[2];
                final float dSq = dx * dx + dz * dz;
                if (dSq > 1e-8f && dSq < bestDistSq) {
                    bestDistSq = dSq;
                }
            }
            if (bestDistSq < Float.MAX_VALUE) {
                nnDists[nnCount++] = (float) Math.sqrt(bestDistSq);
            }
        }
        if (nnCount == 0) {
            return 0.0f;
        }
        Arrays.sort(nnDists, 0, nnCount);
        final int p75Idx = Math.min(nnCount - 1, (int) Math.floor((nnCount - 1) * 0.75));
        return nnDists[p75Idx];
    }

    private static float sampleVisualHullHeight(
        final VisualHullCarver.VisualHullResult hull,
        final float wx,
        final float wz
    ) {
        if (hull == null || !hull.isValid() || hull.cellSizeM <= 1e-6f) {
            return 0.0f;
        }
        final int hc = Math.round((wx - hull.originX) / hull.cellSizeM - 0.5f);
        final int hr = Math.round((wz - hull.originZ) / hull.cellSizeM - 0.5f);
        if (hc < 0 || hc >= hull.cols || hr < 0 || hr >= hull.rows) {
            return 0.0f;
        }
        final int idx = hr * hull.cols + hc;
        return hull.hullFootprintMask[idx] != 0 ? hull.hullHeightsM[idx] : 0.0f;
    }

    private static boolean isWithinVisualHullMargin(
        final VisualHullCarver.VisualHullResult hull,
        final float wx,
        final float wz,
        final int marginCells
    ) {
        if (hull == null || !hull.isValid() || hull.cellSizeM <= 1e-6f) {
            return false;
        }
        final int hc = Math.round((wx - hull.originX) / hull.cellSizeM - 0.5f);
        final int hr = Math.round((wz - hull.originZ) / hull.cellSizeM - 0.5f);
        final int r0 = Math.max(0, hr - marginCells);
        final int r1 = Math.min(hull.rows - 1, hr + marginCells);
        final int c0 = Math.max(0, hc - marginCells);
        final int c1 = Math.min(hull.cols - 1, hc + marginCells);
        if (r0 > r1 || c0 > c1) {
            return false;
        }
        for (int r = r0; r <= r1; r++) {
            final int rowOff = r * hull.cols;
            for (int c = c0; c <= c1; c++) {
                if (hull.hullFootprintMask[rowOff + c] != 0) {
                    return true;
                }
            }
        }
        return false;
    }

    private static float[] computeVisualHullCentroidXZ(final VisualHullCarver.VisualHullResult hull) {
        if (hull == null || !hull.isValid()) {
            return new float[] { 0.0f, -DEFAULT_FORWARD_PROJECTION_M };
        }
        double sumX = 0.0;
        double sumZ = 0.0;
        int count = 0;
        for (int r = 0; r < hull.rows; r++) {
            final float wz = hull.originZ + (r + 0.5f) * hull.cellSizeM;
            for (int c = 0; c < hull.cols; c++) {
                if (hull.hullFootprintMask[r * hull.cols + c] != 0) {
                    sumX += hull.originX + (c + 0.5f) * hull.cellSizeM;
                    sumZ += wz;
                    count++;
                }
            }
        }
        if (count == 0) {
            return new float[] { 0.0f, -DEFAULT_FORWARD_PROJECTION_M };
        }
        return new float[] { (float) (sumX / count), (float) (sumZ / count) };
    }

    private static float clamp(final float v, final float min, final float max) {
        return Math.max(min, Math.min(max, v));
    }

    private static double clampDouble(final double v, final double min, final double max) {
        return Math.max(min, Math.min(max, v));
    }
}
