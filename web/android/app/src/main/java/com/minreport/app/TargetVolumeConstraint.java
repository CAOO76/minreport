package com.minreport.app;

import java.util.Arrays;

/**
 * Pure-Java, immutable Target Object Volume Constraint for MINREPORT · ACOPIOS (2.1.0).
 * Encapsulates user-selected ARCore target Anchor, adjustable horizontal radius (default 1.20 m,
 * clamped [0.20 m, 15.0 m]), optional 3..8 vertex XZ valley polygon for adjacent stockpiles,
 * and optional explicit 1-tap patio floor elevation (padReferenceY).
 *
 * Zero Android framework dependencies for deterministic JVM JUnit verification.
 */
public final class TargetVolumeConstraint {

    public static final float DEFAULT_RADIUS_M = 1.20f;
    public static final float MIN_RADIUS_M = 0.20f;
    public static final float MAX_RADIUS_M = 15.0f;
    public static final int MIN_POLYGON_VERTICES = 3;
    public static final int MAX_POLYGON_VERTICES = 8;

    private static final float[] EMPTY_POLY = new float[0];
    private static final TargetVolumeConstraint INACTIVE = new TargetVolumeConstraint(
        false,
        0.0f,
        0.0f,
        0.0f,
        DEFAULT_RADIUS_M,
        EMPTY_POLY,
        false,
        0.0f
    );

    public final boolean active;
    public final float anchorX;
    public final float anchorY;
    public final float anchorZ;
    public final float radiusM;
    /** 0 floats when unused, or 6..16 floats (3..8 XZ vertex pairs: x0, z0, x1, z1, ...). */
    public final float[] polygonXZ;
    public final boolean hasPadReferenceY;
    public final float padReferenceY;

    public TargetVolumeConstraint(
        final boolean active,
        final float anchorX,
        final float anchorY,
        final float anchorZ,
        final float radiusM,
        final float[] polygonXZ,
        final boolean hasPadReferenceY,
        final float padReferenceY
    ) {
        final boolean validAnchor = Float.isFinite(anchorX) && Float.isFinite(anchorY) && Float.isFinite(anchorZ);
        this.active = active && validAnchor;
        this.anchorX = validAnchor ? anchorX : 0.0f;
        this.anchorY = validAnchor ? anchorY : 0.0f;
        this.anchorZ = validAnchor ? anchorZ : 0.0f;
        this.radiusM = clampRadius(radiusM);
        this.polygonXZ = sanitizePolygon(polygonXZ);
        this.hasPadReferenceY = hasPadReferenceY && Float.isFinite(padReferenceY);
        this.padReferenceY = this.hasPadReferenceY ? padReferenceY : 0.0f;
    }

    public static TargetVolumeConstraint inactive() {
        return INACTIVE;
    }

    public static TargetVolumeConstraint fromAnchor(
        final float anchorX,
        final float anchorY,
        final float anchorZ,
        final float radiusM
    ) {
        return new TargetVolumeConstraint(true, anchorX, anchorY, anchorZ, radiusM, EMPTY_POLY, false, 0.0f);
    }

    public static TargetVolumeConstraint fromAnchorWithPad(
        final float anchorX,
        final float anchorY,
        final float anchorZ,
        final float radiusM,
        final float padReferenceY
    ) {
        return new TargetVolumeConstraint(true, anchorX, anchorY, anchorZ, radiusM, EMPTY_POLY, true, padReferenceY);
    }

    public static TargetVolumeConstraint fromAnchorWithPolygon(
        final float anchorX,
        final float anchorY,
        final float anchorZ,
        final float radiusM,
        final float[] polygonXZ,
        final boolean hasPadReferenceY,
        final float padReferenceY
    ) {
        return new TargetVolumeConstraint(
            true,
            anchorX,
            anchorY,
            anchorZ,
            radiusM,
            polygonXZ,
            hasPadReferenceY,
            padReferenceY
        );
    }

    public static float clampRadius(final float r) {
        if (!Float.isFinite(r)) {
            return DEFAULT_RADIUS_M;
        }
        return Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, r));
    }

    /**
     * Ergonomic step for tactile - / + radius buttons covering both 33 cm test cylinders
     * and 15 m industrial stockpiles.
     */
    public static float radiusStepFor(final float currentRadiusM, final boolean increase) {
        final float r = clampRadius(currentRadiusM);
        if (increase) {
            if (r < 0.80f) return 0.15f;
            if (r < 2.40f) return 0.30f;
            if (r < 6.00f) return 0.50f;
            return 1.00f;
        } else {
            if (r <= 0.95f) return -0.15f;
            if (r <= 2.70f) return -0.30f;
            if (r <= 6.50f) return -0.50f;
            return -1.00f;
        }
    }

    public TargetVolumeConstraint withAnchorPosition(final float x, final float y, final float z) {
        return new TargetVolumeConstraint(
            true,
            x,
            y,
            z,
            this.radiusM,
            this.polygonXZ,
            this.hasPadReferenceY,
            this.padReferenceY
        );
    }

    public TargetVolumeConstraint withRadius(final float newRadiusM) {
        return new TargetVolumeConstraint(
            this.active,
            this.anchorX,
            this.anchorY,
            this.anchorZ,
            newRadiusM,
            this.polygonXZ,
            this.hasPadReferenceY,
            this.padReferenceY
        );
    }

    public TargetVolumeConstraint withPolygon(final float[] newPolyXZ) {
        return new TargetVolumeConstraint(
            this.active,
            this.anchorX,
            this.anchorY,
            this.anchorZ,
            this.radiusM,
            newPolyXZ,
            this.hasPadReferenceY,
            this.padReferenceY
        );
    }

    public TargetVolumeConstraint withPadReferenceY(final float padY) {
        return new TargetVolumeConstraint(
            this.active,
            this.anchorX,
            this.anchorY,
            this.anchorZ,
            this.radiusM,
            this.polygonXZ,
            true,
            padY
        );
    }

    public boolean hasValidPolygon() {
        return polygonXZ.length >= MIN_POLYGON_VERTICES * 2 && (polygonXZ.length % 2) == 0;
    }

    public int getPolygonVertexCount() {
        return hasValidPolygon() ? polygonXZ.length / 2 : 0;
    }

    public float[] getEffectiveCenterXZ() {
        return new float[] { anchorX, anchorZ };
    }

    /**
     * Effective horizontal radius covering either radiusM or the farthest polygon vertex from anchor.
     */
    public float getEffectiveRadiusM() {
        if (!active) {
            return DEFAULT_RADIUS_M;
        }
        if (!hasValidPolygon()) {
            return radiusM;
        }
        float maxR = 0.20f;
        final int n = polygonXZ.length / 2;
        for (int i = 0; i < n; i++) {
            final float d = (float) Math.hypot(polygonXZ[i * 2] - anchorX, polygonXZ[i * 2 + 1] - anchorZ);
            if (d > maxR) {
                maxR = d;
            }
        }
        return clampRadius(maxR);
    }

    /**
     * Returns true if (x, z) lies inside the active target volume (exact polygon or radiusM circle).
     */
    public boolean containsXZ(final float x, final float z) {
        return containsXZ(x, z, 1.0f);
    }

    /**
     * Returns true if (x, z) lies inside the active target volume expanded by radiusScale (>= 1.0f).
     * When inactive, returns true for all points.
     */
    public boolean containsXZ(final float x, final float z, final float radiusScale) {
        if (!active) {
            return true;
        }
        if (!Float.isFinite(x) || !Float.isFinite(z)) {
            return false;
        }
        final float scale = Math.max(0.5f, radiusScale);
        if (hasValidPolygon()) {
            if (scale <= 1.001f) {
                return pointInPolygonXZ(x, z, polygonXZ);
            }
            final float[] centroid = computePolygonCentroidXZ(polygonXZ);
            final float sx = centroid[0] + (x - centroid[0]) / scale;
            final float sz = centroid[1] + (z - centroid[1]) / scale;
            return pointInPolygonXZ(sx, sz, polygonXZ);
        }
        final float dx = x - anchorX;
        final float dz = z - anchorZ;
        final float r = radiusM * scale;
        return (dx * dx + dz * dz) <= (r * r);
    }

    /**
     * Returns true if 3D point (x, y, z) belongs to the target object volume for live dual-color
     * point cloud visualization (excludes floor points below padReferenceY + 0.025m when pad is set).
     */
    public boolean contains3DForVisual(final float x, final float y, final float z) {
        if (!active) {
            return true;
        }
        if (!Float.isFinite(y)) {
            return false;
        }
        if (!containsXZ(x, z, 1.0f)) {
            return false;
        }
        final float baseY = hasPadReferenceY ? padReferenceY : (anchorY - 0.12f);
        final float topY = baseY + Math.max(1.20f, getEffectiveRadiusM() * 1.65f);
        return y >= (baseY - 0.02f) && y <= topY;
    }

    /**
     * Computes an axis-aligned 3D bounding box [minX, minY, minZ, maxX, maxY, maxZ]
     * expanded horizontally by marginScale (e.g. 1.25f to capture the toe in MVS plane sweep).
     */
    public float[] getBoundingBox3D(
        final float marginScale,
        final float minBelowBaseM,
        final float maxAboveBaseM
    ) {
        final float scale = Math.max(1.0f, marginScale);
        final float minX;
        final float maxX;
        final float minZ;
        final float maxZ;
        if (hasValidPolygon()) {
            final float[] centroid = computePolygonCentroidXZ(polygonXZ);
            float lx = Float.MAX_VALUE;
            float ux = -Float.MAX_VALUE;
            float lz = Float.MAX_VALUE;
            float uz = -Float.MAX_VALUE;
            final int n = polygonXZ.length / 2;
            for (int i = 0; i < n; i++) {
                final float px = centroid[0] + (polygonXZ[i * 2] - centroid[0]) * scale;
                final float pz = centroid[1] + (polygonXZ[i * 2 + 1] - centroid[1]) * scale;
                if (px < lx) lx = px;
                if (px > ux) ux = px;
                if (pz < lz) lz = pz;
                if (pz > uz) uz = pz;
            }
            minX = lx;
            maxX = ux;
            minZ = lz;
            maxZ = uz;
        } else {
            final float r = radiusM * scale;
            minX = anchorX - r;
            maxX = anchorX + r;
            minZ = anchorZ - r;
            maxZ = anchorZ + r;
        }
        final float baseY = hasPadReferenceY ? Math.min(anchorY, padReferenceY) : anchorY;
        final float minY = baseY - Math.max(0.05f, minBelowBaseM);
        final float maxY = Math.max(anchorY, baseY) + Math.max(0.50f, maxAboveBaseM);
        return new float[] { minX, minY, minZ, maxX, maxY, maxZ };
    }

    public static float[] computePolygonCentroidXZ(final float[] polyXZ) {
        if (polyXZ == null || polyXZ.length < 2) {
            return new float[] { 0.0f, 0.0f };
        }
        final int n = polyXZ.length / 2;
        double sx = 0.0;
        double sz = 0.0;
        for (int i = 0; i < n; i++) {
            sx += polyXZ[i * 2];
            sz += polyXZ[i * 2 + 1];
        }
        return new float[] { (float) (sx / n), (float) (sz / n) };
    }

    /**
     * Deterministic ray-casting point-in-polygon check in the XZ plane (with boundary inclusion).
     */
    public static boolean pointInPolygonXZ(final float x, final float z, final float[] polyXZ) {
        if (polyXZ == null || polyXZ.length < MIN_POLYGON_VERTICES * 2) {
            return false;
        }
        final int n = polyXZ.length / 2;
        boolean inside = false;
        for (int i = 0, j = n - 1; i < n; j = i++) {
            final float xi = polyXZ[i * 2];
            final float zi = polyXZ[i * 2 + 1];
            final float xj = polyXZ[j * 2];
            final float zj = polyXZ[j * 2 + 1];

            // Boundary tolerance check
            if (pointToSegmentDistSq(x, z, xi, zi, xj, zj) <= 1e-6f) {
                return true;
            }

            final boolean intersect =
                ((zi > z) != (zj > z)) &&
                (x < (xj - xi) * (z - zi) / ((zj - zi) + 1e-12f) + xi);
            if (intersect) {
                inside = !inside;
            }
        }
        return inside;
    }

    private static float pointToSegmentDistSq(
        final float px,
        final float pz,
        final float ax,
        final float az,
        final float bx,
        final float bz
    ) {
        final float abx = bx - ax;
        final float abz = bz - az;
        final float apx = px - ax;
        final float apz = pz - az;
        final float abLenSq = abx * abx + abz * abz;
        if (abLenSq <= 1e-10f) {
            return apx * apx + apz * apz;
        }
        final float t = Math.max(0.0f, Math.min(1.0f, (apx * abx + apz * abz) / abLenSq));
        final float cx = ax + t * abx;
        final float cz = az + t * abz;
        final float dx = px - cx;
        final float dz = pz - cz;
        return dx * dx + dz * dz;
    }

    private static float[] sanitizePolygon(final float[] raw) {
        if (raw == null || raw.length < MIN_POLYGON_VERTICES * 2) {
            return EMPTY_POLY;
        }
        final int pairs = Math.min(MAX_POLYGON_VERTICES, raw.length / 2);
        if (pairs < MIN_POLYGON_VERTICES) {
            return EMPTY_POLY;
        }
        final float[] out = new float[pairs * 2];
        for (int i = 0; i < out.length; i++) {
            if (!Float.isFinite(raw[i])) {
                return EMPTY_POLY;
            }
            out[i] = raw[i];
        }
        return out;
    }

    public float[] copyPolygonXZ() {
        return Arrays.copyOf(polygonXZ, polygonXZ.length);
    }
}
