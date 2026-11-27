package com.minreport.app;

import android.opengl.GLES20;
import android.opengl.Matrix;
import android.util.Log;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.Arrays;

/**
 * GLES 2.0 Real-Time 3D Volume Recognition & Target Selection Overlay Renderer (MINREPORT ANSI/ISA-101 HMI):
 * - Target Volume Pre-Capture Envelope: translucent Cyan #00AEEF at 20% alpha + base ring at 72% alpha (<= 384 verts)
 * - Dual-Color Live Point Cloud (ISA-101):
 *   - Inside TargetVolumeConstraint: Cyan #00AEEF at 90% alpha, 10 px
 *   - Outside (floor/environment/neighbors): Neutral Gray #8A93A6 at 18% alpha, 5 px
 * - Progressive Verified Surface Mesh (CAPTURING_WALK): translucent Cyan #00AEEF at 19% alpha
 * - Elevation contours (0.5 m): Cyan #00AEEF at 72% alpha
 * - Gaps / low-density wireframe: Copper #C68346 at 65% alpha
 * - Perimeter Toe loop: Cyan #00AEEF (anchored) vs Copper #C68346 (open/unanchored)
 * - Crown / Toe 8% NDC border framing check (Dark Cockpit exception-only)
 *
 * Strictly zero heap allocations inside draw() (<= 3 ms/frame on Mali-G57 MC2).
 */
public final class Live3DOverlayRenderer {

    private static final String TAG = "Live3DOverlayRenderer";
    public static final int MAX_LIVE_POINTS = 2048;
    public static final int MAX_TARGET_VOLUME_VERTICES = 384;
    private static final int MAX_VERTICES_PER_BUFFER = 4096;
    private static final int FLOATS_PER_VERTEX = 3;
    private static final int TARGET_RING_SEGMENTS = 24;

    private static final float POINT_SIZE_TARGET_PX = 10.0f;
    private static final float POINT_SIZE_ENV_PX = 5.0f;

    private static final String VERT_SHADER =
        "uniform mat4 u_MvpMatrix;\n" +
        "uniform float u_PointSize;\n" +
        "attribute vec3 a_Position;\n" +
        "void main() {\n" +
        "    gl_Position = u_MvpMatrix * vec4(a_Position, 1.0);\n" +
        "    gl_PointSize = u_PointSize;\n" +
        "}\n";

    private static final String FRAG_SHADER =
        "precision mediump float;\n" +
        "uniform vec4 u_Color;\n" +
        "void main() {\n" +
        "    gl_FragColor = u_Color;\n" +
        "}\n";

    // ANSI/ISA-101 MINREPORT palette
    private static final float[] COLOR_CYAN_MESH = { 0.0f, 0.682f, 0.937f, 0.19f };          // #00AEEF 19%
    private static final float[] COLOR_CYAN_TARGET_FILL = { 0.0f, 0.682f, 0.937f, 0.20f };   // #00AEEF 20%
    private static final float[] COLOR_CYAN_TARGET_RING = { 0.0f, 0.682f, 0.937f, 0.72f };   // #00AEEF 72%
    private static final float[] COLOR_CYAN_CONTOUR = { 0.0f, 0.682f, 0.937f, 0.72f };       // #00AEEF 72%
    private static final float[] COLOR_CYAN_TOE = { 0.0f, 0.682f, 0.937f, 0.95f };           // #00AEEF 95%
    private static final float[] COLOR_CYAN_TARGET_POINTS = { 0.0f, 0.682f, 0.937f, 0.90f }; // #00AEEF 90%
    private static final float[] COLOR_GRAY_ENV_POINTS = { 0.541f, 0.576f, 0.651f, 0.18f };  // #8A93A6 18%
    private static final float[] COLOR_CYAN_PLANE_OUTLINE = { 0.0f, 0.682f, 0.937f, 0.45f }; // #00AEEF 45%
    private static final float[] COLOR_COPPER_GAP = { 0.776f, 0.514f, 0.275f, 0.65f };       // #C68346 65%
    private static final float[] COLOR_COPPER_TOE = { 0.776f, 0.514f, 0.275f, 0.95f };       // #C68346 95%

    public static final class FramingStatus {
        public final boolean crownClipped;
        public final boolean toeClipped;

        public FramingStatus(final boolean crownClipped, final boolean toeClipped) {
            this.crownClipped = crownClipped;
            this.toeClipped = toeClipped;
        }
    }

    // Pre-allocated FramingStatus instances -> 0 heap allocations inside draw()
    private static final FramingStatus FRAMING_OK = new FramingStatus(false, false);
    private static final FramingStatus FRAMING_CROWN = new FramingStatus(true, false);
    private static final FramingStatus FRAMING_TOE = new FramingStatus(false, true);
    private static final FramingStatus FRAMING_BOTH = new FramingStatus(true, true);

    /**
     * Pure-Java geometry bundle for target volume envelope (<= 384 total vertices).
     */
    public static final class TargetVolumeGeometry {
        public final float[] fillTriVerts;
        public final float[] baseRingLineVerts;
        public final int totalVertexCount;

        public TargetVolumeGeometry(final float[] fillTriVerts, final float[] baseRingLineVerts) {
            this.fillTriVerts = fillTriVerts;
            this.baseRingLineVerts = baseRingLineVerts;
            final int fillV = fillTriVerts != null ? fillTriVerts.length / FLOATS_PER_VERTEX : 0;
            final int ringV = baseRingLineVerts != null ? baseRingLineVerts.length / FLOATS_PER_VERTEX : 0;
            this.totalVertexCount = fillV + ringV;
        }
    }

    /**
     * Pure-Java dual point cloud partition (inside target vs outside floor/environment).
     */
    public static final class PartitionedPoints {
        public final float[] targetPointsXyz;
        public final float[] envPointsXyz;

        public PartitionedPoints(final float[] targetPointsXyz, final float[] envPointsXyz) {
            this.targetPointsXyz = targetPointsXyz;
            this.envPointsXyz = envPointsXyz;
        }
    }

    private int programId = 0;
    private int mvpUniform = -1;
    private int pointSizeUniform = -1;
    private int colorUniform = -1;
    private int posAttrib = -1;

    // 10 dynamic VBOs:
    // 0=verifiedTris, 1=gapLines, 2=contours, 3=toeAnchored, 4=toeOpen,
    // 5=targetLivePoints (GL_POINTS #00AEEF 90% 10px), 6=livePlaneLines (GL_LINES),
    // 7=envLivePoints (GL_POINTS #8A93A6 18% 5px),
    // 8=targetVolumeFill (GL_TRIANGLES #00AEEF 20%), 9=targetVolumeRing (GL_LINES #00AEEF 72%)
    private final int[] vboIds = new int[10];
    private final int[] vboVertCounts = new int[10];
    private boolean glInitialized = false;

    private final Object snapshotLock = new Object();
    private WalkRingToeSolver.LiveOverlaySnapshot pendingSnapshot = null;
    private WalkRingToeSolver.LiveOverlaySnapshot activeSnapshot = null;
    private boolean snapshotDirty = false;
    private float[] rawLivePoints = null;
    private float[] pendingTargetLivePoints = null;
    private float[] pendingEnvLivePoints = null;
    private boolean livePointsDirty = false;
    private float[] pendingLivePlaneLines = null;
    private boolean livePlanesDirty = false;

    private TargetVolumeConstraint targetConstraint = TargetVolumeConstraint.inactive();
    private float[] pendingTargetFillVerts = null;
    private float[] pendingTargetRingVerts = null;
    private boolean targetVolumeDirty = false;
    private boolean captureActive = false;

    private final float[] vpMatrix = new float[16];
    private final float[] tmpVecIn = new float[4];
    private final float[] tmpVecOut = new float[4];
    private FloatBuffer uploadBuffer = null;

    public void onSurfaceCreated() {
        final int vs = compileShader(GLES20.GL_VERTEX_SHADER, VERT_SHADER);
        final int fs = compileShader(GLES20.GL_FRAGMENT_SHADER, FRAG_SHADER);
        if (vs == 0 || fs == 0) {
            if (vs != 0) GLES20.glDeleteShader(vs);
            if (fs != 0) GLES20.glDeleteShader(fs);
            Log.e(TAG, "Aborting Live3DOverlayRenderer init due to shader compile failure");
            programId = 0;
            return;
        }
        programId = GLES20.glCreateProgram();
        GLES20.glAttachShader(programId, vs);
        GLES20.glAttachShader(programId, fs);
        GLES20.glLinkProgram(programId);

        final int[] link = new int[1];
        GLES20.glGetProgramiv(programId, GLES20.GL_LINK_STATUS, link, 0);
        GLES20.glDeleteShader(vs);
        GLES20.glDeleteShader(fs);
        if (link[0] == 0) {
            final String log = GLES20.glGetProgramInfoLog(programId);
            Log.e(TAG, "Failed to link Live3DOverlayRenderer GLES 2.0 program: " + log);
            GLES20.glDeleteProgram(programId);
            programId = 0;
            return;
        }

        mvpUniform = GLES20.glGetUniformLocation(programId, "u_MvpMatrix");
        pointSizeUniform = GLES20.glGetUniformLocation(programId, "u_PointSize");
        colorUniform = GLES20.glGetUniformLocation(programId, "u_Color");
        posAttrib = GLES20.glGetAttribLocation(programId, "a_Position");

        GLES20.glGenBuffers(vboIds.length, vboIds, 0);
        Arrays.fill(vboVertCounts, 0);
        uploadBuffer = ByteBuffer
            .allocateDirect(MAX_VERTICES_PER_BUFFER * FLOATS_PER_VERTEX * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer();
        glInitialized = true;

        synchronized (snapshotLock) {
            if (activeSnapshot != null) {
                pendingSnapshot = activeSnapshot;
                snapshotDirty = true;
            }
            if (pendingTargetLivePoints != null || pendingEnvLivePoints != null) {
                livePointsDirty = true;
            }
            if (pendingLivePlaneLines != null) {
                livePlanesDirty = true;
            }
            if (pendingTargetFillVerts != null || pendingTargetRingVerts != null) {
                targetVolumeDirty = true;
            }
        }
    }

    public void setCaptureActive(final boolean active) {
        synchronized (snapshotLock) {
            this.captureActive = active;
        }
    }

    public void updateTargetVolumeConstraint(final TargetVolumeConstraint constraint) {
        final TargetVolumeConstraint safe = constraint != null ? constraint : TargetVolumeConstraint.inactive();
        final TargetVolumeGeometry geom = buildTargetVolumeGeometry(safe);
        synchronized (snapshotLock) {
            this.targetConstraint = safe;
            this.pendingTargetFillVerts = geom != null ? geom.fillTriVerts : null;
            this.pendingTargetRingVerts = geom != null ? geom.baseRingLineVerts : null;
            this.targetVolumeDirty = true;
            if (rawLivePoints != null) {
                final PartitionedPoints partitioned = partitionPointsByTarget(rawLivePoints, safe);
                this.pendingTargetLivePoints = partitioned.targetPointsXyz;
                this.pendingEnvLivePoints = partitioned.envPointsXyz;
                this.livePointsDirty = true;
            }
        }
    }

    public void updateSnapshot(final WalkRingToeSolver.LiveOverlaySnapshot snapshot) {
        synchronized (snapshotLock) {
            this.pendingSnapshot = snapshot;
            this.snapshotDirty = true;
        }
    }

    public void updateLivePointCloud(final float[] pointVertsXyz) {
        final float[] capped;
        if (pointVertsXyz == null || pointVertsXyz.length < FLOATS_PER_VERTEX) {
            capped = null;
        } else {
            final int maxFloats = MAX_LIVE_POINTS * FLOATS_PER_VERTEX;
            final int len = Math.min(pointVertsXyz.length, maxFloats);
            final int alignedLen = len - (len % FLOATS_PER_VERTEX);
            capped = new float[alignedLen];
            System.arraycopy(pointVertsXyz, 0, capped, 0, alignedLen);
        }
        synchronized (snapshotLock) {
            this.rawLivePoints = capped;
            if (capped == null) {
                this.pendingTargetLivePoints = null;
                this.pendingEnvLivePoints = null;
            } else {
                final PartitionedPoints partitioned = partitionPointsByTarget(capped, this.targetConstraint);
                this.pendingTargetLivePoints = partitioned.targetPointsXyz;
                this.pendingEnvLivePoints = partitioned.envPointsXyz;
            }
            this.livePointsDirty = true;
        }
    }

    public void updateLivePlaneOutlines(final float[] lineVertsXyz) {
        final float[] capped;
        if (lineVertsXyz == null || lineVertsXyz.length < FLOATS_PER_VERTEX * 2) {
            capped = null;
        } else {
            final int maxFloats = MAX_VERTICES_PER_BUFFER * FLOATS_PER_VERTEX;
            final int len = Math.min(lineVertsXyz.length, maxFloats);
            final int alignedLen = len - (len % (FLOATS_PER_VERTEX * 2));
            capped = new float[alignedLen];
            System.arraycopy(lineVertsXyz, 0, capped, 0, alignedLen);
        }
        synchronized (snapshotLock) {
            this.pendingLivePlaneLines = capped;
            this.livePlanesDirty = true;
        }
    }

    public void clearLiveTrackingVisuals() {
        synchronized (snapshotLock) {
            this.rawLivePoints = null;
            this.pendingTargetLivePoints = null;
            this.pendingEnvLivePoints = null;
            this.livePointsDirty = true;
            this.pendingLivePlaneLines = null;
            this.livePlanesDirty = true;
        }
    }

    public void clearSnapshot() {
        synchronized (snapshotLock) {
            this.pendingSnapshot = null;
            this.activeSnapshot = null;
            this.snapshotDirty = true;
        }
    }

    int getLivePointCount() {
        synchronized (snapshotLock) {
            if (rawLivePoints != null) {
                return rawLivePoints.length / FLOATS_PER_VERTEX;
            }
            return vboVertCounts[5] + vboVertCounts[7];
        }
    }

    int getTargetLivePointCount() {
        synchronized (snapshotLock) {
            if (pendingTargetLivePoints != null) {
                return pendingTargetLivePoints.length / FLOATS_PER_VERTEX;
            }
            return vboVertCounts[5];
        }
    }

    int getEnvLivePointCount() {
        synchronized (snapshotLock) {
            if (pendingEnvLivePoints != null) {
                return pendingEnvLivePoints.length / FLOATS_PER_VERTEX;
            }
            return vboVertCounts[7];
        }
    }

    int getLivePlaneLineVertexCount() {
        synchronized (snapshotLock) {
            if (pendingLivePlaneLines != null) {
                return pendingLivePlaneLines.length / FLOATS_PER_VERTEX;
            }
            return vboVertCounts[6];
        }
    }

    /**
     * Pure-Java geometry builder for the pre-capture / capture target volume envelope:
     * - Cylinder + tapered dome (24 segments = 216 fill verts + 48 base ring verts = 264 <= 384)
     * - Or extruded polygon prism when 3..8 XZ valley vertices are defined (<= 66 + 16 = 82 <= 384).
     */
    public static TargetVolumeGeometry buildTargetVolumeGeometry(final TargetVolumeConstraint c) {
        if (c == null || !c.active) {
            return null;
        }
        final float baseY = (c.hasPadReferenceY ? c.padReferenceY : c.anchorY) + 0.01f;
        final float effR = c.getEffectiveRadiusM();
        final float volumeHeight = Math.max(0.45f, Math.min(3.0f, effR * 0.85f));
        final float topY = baseY + volumeHeight;

        if (c.hasValidPolygon()) {
            final int k = c.getPolygonVertexCount();
            final float[] poly = c.polygonXZ;
            final float[] ring = new float[k * 2 * FLOATS_PER_VERTEX];
            final int sideTris = k * 2;
            final int capTris = Math.max(0, k - 2);
            final float[] fill = new float[(sideTris + capTris) * 3 * FLOATS_PER_VERTEX];

            int rOff = 0;
            int fOff = 0;
            for (int i = 0; i < k; i++) {
                final int next = (i + 1) % k;
                final float x0 = poly[i * 2];
                final float z0 = poly[i * 2 + 1];
                final float x1 = poly[next * 2];
                final float z1 = poly[next * 2 + 1];

                // Base ring segment
                ring[rOff++] = x0; ring[rOff++] = baseY; ring[rOff++] = z0;
                ring[rOff++] = x1; ring[rOff++] = baseY; ring[rOff++] = z1;

                // Side quad -> 2 triangles
                fill[fOff++] = x0; fill[fOff++] = baseY; fill[fOff++] = z0;
                fill[fOff++] = x1; fill[fOff++] = baseY; fill[fOff++] = z1;
                fill[fOff++] = x1; fill[fOff++] = topY;  fill[fOff++] = z1;

                fill[fOff++] = x0; fill[fOff++] = baseY; fill[fOff++] = z0;
                fill[fOff++] = x1; fill[fOff++] = topY;  fill[fOff++] = z1;
                fill[fOff++] = x0; fill[fOff++] = topY;  fill[fOff++] = z0;
            }
            // Top cap triangle fan
            final float xA = poly[0];
            final float zA = poly[1];
            for (int i = 1; i + 1 < k; i++) {
                fill[fOff++] = xA;             fill[fOff++] = topY; fill[fOff++] = zA;
                fill[fOff++] = poly[i * 2];    fill[fOff++] = topY; fill[fOff++] = poly[i * 2 + 1];
                fill[fOff++] = poly[(i+1)*2];  fill[fOff++] = topY; fill[fOff++] = poly[(i+1)*2 + 1];
            }
            return new TargetVolumeGeometry(fill, ring);
        }

        // Circular cylinder + tapered dome: 24 segments -> 216 fill verts + 48 ring verts = 264 <= 384
        final int seg = TARGET_RING_SEGMENTS;
        final float r = c.radiusM;
        final float shoulderY = baseY + volumeHeight * 0.65f;
        final float shoulderR = r * 0.72f;
        final float[] ring = new float[seg * 2 * FLOATS_PER_VERTEX];
        final float[] fill = new float[seg * 3 * 3 * FLOATS_PER_VERTEX]; // 2 side tris + 1 dome cap tri per seg

        int rOff = 0;
        int fOff = 0;
        for (int i = 0; i < seg; i++) {
            final double a0 = (2.0 * Math.PI * i) / seg;
            final double a1 = (2.0 * Math.PI * ((i + 1) % seg)) / seg;
            final float cos0 = (float) Math.cos(a0);
            final float sin0 = (float) Math.sin(a0);
            final float cos1 = (float) Math.cos(a1);
            final float sin1 = (float) Math.sin(a1);

            final float bx0 = c.anchorX + r * cos0;
            final float bz0 = c.anchorZ + r * sin0;
            final float bx1 = c.anchorX + r * cos1;
            final float bz1 = c.anchorZ + r * sin1;

            final float sx0 = c.anchorX + shoulderR * cos0;
            final float sz0 = c.anchorZ + shoulderR * sin0;
            final float sx1 = c.anchorX + shoulderR * cos1;
            final float sz1 = c.anchorZ + shoulderR * sin1;

            // Base ring segment (#00AEEF 72%)
            ring[rOff++] = bx0; ring[rOff++] = baseY; ring[rOff++] = bz0;
            ring[rOff++] = bx1; ring[rOff++] = baseY; ring[rOff++] = bz1;

            // Lower tapered wall quad (2 triangles)
            fill[fOff++] = bx0; fill[fOff++] = baseY;     fill[fOff++] = bz0;
            fill[fOff++] = bx1; fill[fOff++] = baseY;     fill[fOff++] = bz1;
            fill[fOff++] = sx1; fill[fOff++] = shoulderY; fill[fOff++] = sz1;

            fill[fOff++] = bx0; fill[fOff++] = baseY;     fill[fOff++] = bz0;
            fill[fOff++] = sx1; fill[fOff++] = shoulderY; fill[fOff++] = sz1;
            fill[fOff++] = sx0; fill[fOff++] = shoulderY; fill[fOff++] = sz0;

            // Upper dome apex triangle
            fill[fOff++] = sx0;       fill[fOff++] = shoulderY; fill[fOff++] = sz0;
            fill[fOff++] = sx1;       fill[fOff++] = shoulderY; fill[fOff++] = sz1;
            fill[fOff++] = c.anchorX; fill[fOff++] = topY;      fill[fOff++] = c.anchorZ;
        }
        return new TargetVolumeGeometry(fill, ring);
    }

    /**
     * Partitions packed XYZ points into target-volume points (Cyan 90% 10px) and environment/floor
     * points (Neutral Gray 18% 5px). When constraint is inactive, all points stay in target bucket.
     */
    public static PartitionedPoints partitionPointsByTarget(
        final float[] allXyz,
        final TargetVolumeConstraint c
    ) {
        if (allXyz == null || allXyz.length < FLOATS_PER_VERTEX) {
            return new PartitionedPoints(null, null);
        }
        if (c == null || !c.active) {
            return new PartitionedPoints(allXyz, null);
        }
        final int nPts = allXyz.length / FLOATS_PER_VERTEX;
        final float[] targetTmp = new float[nPts * FLOATS_PER_VERTEX];
        final float[] envTmp = new float[nPts * FLOATS_PER_VERTEX];
        int tLen = 0;
        int eLen = 0;
        for (int i = 0; i + 2 < allXyz.length; i += FLOATS_PER_VERTEX) {
            final float px = allXyz[i];
            final float py = allXyz[i + 1];
            final float pz = allXyz[i + 2];
            if (c.contains3DForVisual(px, py, pz)) {
                targetTmp[tLen++] = px;
                targetTmp[tLen++] = py;
                targetTmp[tLen++] = pz;
            } else {
                envTmp[eLen++] = px;
                envTmp[eLen++] = py;
                envTmp[eLen++] = pz;
            }
        }
        final float[] targetOut = tLen > 0 ? Arrays.copyOf(targetTmp, tLen) : null;
        final float[] envOut = eLen > 0 ? Arrays.copyOf(envTmp, eLen) : null;
        return new PartitionedPoints(targetOut, envOut);
    }

    /**
     * Draws all active 3D overlays with ZERO heap allocations per frame.
     */
    public FramingStatus draw(final float[] viewMatrix, final float[] projectionMatrix) {
        if (!glInitialized || programId == 0) {
            return FRAMING_OK;
        }

        WalkRingToeSolver.LiveOverlaySnapshot toUpload = null;
        boolean needsClearSnapshot = false;
        float[] targetPtsToUpload = null;
        float[] envPtsToUpload = null;
        boolean updatePoints = false;
        float[] planesToUpload = null;
        boolean updatePlanes = false;
        float[] targetFillToUpload = null;
        float[] targetRingToUpload = null;
        boolean updateTargetVol = false;
        boolean isCapturing;

        synchronized (snapshotLock) {
            isCapturing = captureActive;
            if (snapshotDirty) {
                toUpload = pendingSnapshot;
                activeSnapshot = pendingSnapshot;
                needsClearSnapshot = (pendingSnapshot == null);
                snapshotDirty = false;
            }
            if (livePointsDirty) {
                targetPtsToUpload = pendingTargetLivePoints;
                envPtsToUpload = pendingEnvLivePoints;
                updatePoints = true;
                livePointsDirty = false;
            }
            if (livePlanesDirty) {
                planesToUpload = pendingLivePlaneLines;
                updatePlanes = true;
                livePlanesDirty = false;
            }
            if (targetVolumeDirty) {
                targetFillToUpload = pendingTargetFillVerts;
                targetRingToUpload = pendingTargetRingVerts;
                updateTargetVol = true;
                targetVolumeDirty = false;
            }
        }

        if (needsClearSnapshot) {
            for (int i = 0; i < 5; i++) {
                vboVertCounts[i] = 0;
            }
        } else if (toUpload != null) {
            uploadVbo(0, toUpload.verifiedTriVerts, MAX_VERTICES_PER_BUFFER);
            uploadVbo(1, toUpload.gapLineVerts, MAX_VERTICES_PER_BUFFER);
            uploadVbo(2, toUpload.contourLineVerts, MAX_VERTICES_PER_BUFFER);
            uploadVbo(3, toUpload.toeAnchoredLineVerts, MAX_VERTICES_PER_BUFFER);
            uploadVbo(4, toUpload.toeOpenLineVerts, MAX_VERTICES_PER_BUFFER);
        }
        if (updatePoints) {
            uploadVbo(5, targetPtsToUpload, MAX_LIVE_POINTS);
            uploadVbo(7, envPtsToUpload, MAX_LIVE_POINTS);
        }
        if (updatePlanes) {
            uploadVbo(6, planesToUpload, MAX_VERTICES_PER_BUFFER);
        }
        if (updateTargetVol) {
            uploadVbo(8, targetFillToUpload, MAX_TARGET_VOLUME_VERTICES);
            uploadVbo(9, targetRingToUpload, MAX_TARGET_VOLUME_VERTICES);
        }

        Matrix.multiplyMM(vpMatrix, 0, projectionMatrix, 0, viewMatrix, 0);

        GLES20.glEnable(GLES20.GL_BLEND);
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA);
        GLES20.glDisable(GLES20.GL_DEPTH_TEST);
        GLES20.glDepthMask(false);

        GLES20.glUseProgram(programId);
        GLES20.glUniformMatrix4fv(mvpUniform, 1, false, vpMatrix, 0);
        GLES20.glEnableVertexAttribArray(posAttrib);

        // 0. Detected horizontal ground plane outlines (subtle #00AEEF)
        drawVbo(6, GLES20.GL_LINES, COLOR_CYAN_PLANE_OUTLINE, 2.0f, POINT_SIZE_ENV_PX);

        // 1. Pre-capture target volume envelope (#00AEEF 20% fill + 72% base ring).
        //    During CAPTURING_WALK once verified mesh triangles arrive, verified mesh replaces the cylinder fill
        //    while keeping the base ring locked to the target perimeter.
        if (!isCapturing || vboVertCounts[0] == 0) {
            drawVbo(8, GLES20.GL_TRIANGLES, COLOR_CYAN_TARGET_FILL, 1.0f, POINT_SIZE_TARGET_PX);
        }
        drawVbo(9, GLES20.GL_LINES, COLOR_CYAN_TARGET_RING, 3.0f, POINT_SIZE_TARGET_PX);

        // 2. Progressive translucent verified surface mesh (#00AEEF 19%)
        drawVbo(0, GLES20.GL_TRIANGLES, COLOR_CYAN_MESH, 1.0f, POINT_SIZE_TARGET_PX);
        // 3. Gap wireframe (#C68346 65%)
        drawVbo(1, GLES20.GL_LINES, COLOR_COPPER_GAP, 1.5f, POINT_SIZE_TARGET_PX);
        // 4. 0.5m elevation contour lines (#00AEEF 72%)
        drawVbo(2, GLES20.GL_LINES, COLOR_CYAN_CONTOUR, 1.8f, POINT_SIZE_TARGET_PX);
        // 5. Perimeter Toe anchored (#00AEEF) and open (#C68346)
        drawVbo(3, GLES20.GL_LINES, COLOR_CYAN_TOE, 3.0f, POINT_SIZE_TARGET_PX);
        drawVbo(4, GLES20.GL_LINES, COLOR_COPPER_TOE, 3.0f, POINT_SIZE_TARGET_PX);

        // 6. Dual-color ISA-101 point cloud: environment first (#8A93A6 18%, 5px), then target (#00AEEF 90%, 10px)
        drawVbo(7, GLES20.GL_POINTS, COLOR_GRAY_ENV_POINTS, 1.0f, POINT_SIZE_ENV_PX);
        drawVbo(5, GLES20.GL_POINTS, COLOR_CYAN_TARGET_POINTS, 1.0f, POINT_SIZE_TARGET_PX);

        GLES20.glDisableVertexAttribArray(posAttrib);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
        GLES20.glDepthMask(true);
        GLES20.glDisable(GLES20.GL_BLEND);

        return evaluateFramingGuard(activeSnapshot, vpMatrix);
    }

    public void release() {
        if (glInitialized) {
            GLES20.glDeleteBuffers(vboIds.length, vboIds, 0);
            if (programId != 0) {
                GLES20.glDeleteProgram(programId);
                programId = 0;
            }
            glInitialized = false;
        }
    }

    private void uploadVbo(final int slot, final float[] data, final int maxVerts) {
        if (data == null || data.length < FLOATS_PER_VERTEX || uploadBuffer == null) {
            vboVertCounts[slot] = 0;
            return;
        }
        final int capVerts = Math.min(MAX_VERTICES_PER_BUFFER, maxVerts);
        final int maxFloats = capVerts * FLOATS_PER_VERTEX;
        final int len = Math.min(data.length, maxFloats);
        final int alignedLen = len - (len % FLOATS_PER_VERTEX);
        uploadBuffer.clear();
        uploadBuffer.put(data, 0, alignedLen);
        uploadBuffer.flip();

        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vboIds[slot]);
        GLES20.glBufferData(
            GLES20.GL_ARRAY_BUFFER,
            alignedLen * 4,
            uploadBuffer,
            GLES20.GL_DYNAMIC_DRAW
        );
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
        vboVertCounts[slot] = alignedLen / FLOATS_PER_VERTEX;
    }

    private void drawVbo(
        final int slot,
        final int mode,
        final float[] rgba,
        final float lineWidth,
        final float pointSizePx
    ) {
        final int count = vboVertCounts[slot];
        if (count <= 0) {
            return;
        }
        if (mode == GLES20.GL_LINES || mode == GLES20.GL_LINE_LOOP) {
            GLES20.glLineWidth(lineWidth);
        }
        if (pointSizeUniform >= 0) {
            GLES20.glUniform1f(pointSizeUniform, pointSizePx);
        }
        GLES20.glUniform4fv(colorUniform, 1, rgba, 0);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vboIds[slot]);
        GLES20.glVertexAttribPointer(posAttrib, FLOATS_PER_VERTEX, GLES20.GL_FLOAT, false, 0, 0);
        GLES20.glDrawArrays(mode, 0, count);
    }

    private FramingStatus evaluateFramingGuard(
        final WalkRingToeSolver.LiveOverlaySnapshot snap,
        final float[] mvp
    ) {
        if (snap == null) {
            return FRAMING_OK;
        }
        boolean crownClipped = false;
        boolean toeClipped = false;

        if (snap.crownSamplePoints != null) {
            for (int i = 0; i + 2 < snap.crownSamplePoints.length; i += 3) {
                tmpVecIn[0] = snap.crownSamplePoints[i];
                tmpVecIn[1] = snap.crownSamplePoints[i + 1];
                tmpVecIn[2] = snap.crownSamplePoints[i + 2];
                tmpVecIn[3] = 1.0f;
                Matrix.multiplyMV(tmpVecOut, 0, mvp, 0, tmpVecIn, 0);
                if (tmpVecOut[3] > 0.2f) {
                    final float ndcX = tmpVecOut[0] / tmpVecOut[3];
                    final float ndcY = tmpVecOut[1] / tmpVecOut[3];
                    // Top 8% border band in NDC [-1, 1] => ndcY > 0.84
                    if (Math.abs(ndcX) <= 0.95f && ndcY > 0.84f) {
                        crownClipped = true;
                        break;
                    }
                }
            }
        }

        if (snap.toeSamplePoints != null) {
            for (int i = 0; i + 2 < snap.toeSamplePoints.length; i += 3) {
                tmpVecIn[0] = snap.toeSamplePoints[i];
                tmpVecIn[1] = snap.toeSamplePoints[i + 1];
                tmpVecIn[2] = snap.toeSamplePoints[i + 2];
                tmpVecIn[3] = 1.0f;
                Matrix.multiplyMV(tmpVecOut, 0, mvp, 0, tmpVecIn, 0);
                if (tmpVecOut[3] > 0.2f) {
                    final float ndcX = tmpVecOut[0] / tmpVecOut[3];
                    final float ndcY = tmpVecOut[1] / tmpVecOut[3];
                    // Bottom 8% border band in NDC [-1, 1] => ndcY < -0.84
                    if (Math.abs(ndcX) <= 0.95f && ndcY < -0.84f) {
                        toeClipped = true;
                        break;
                    }
                }
            }
        }
        if (crownClipped && toeClipped) return FRAMING_BOTH;
        if (crownClipped) return FRAMING_CROWN;
        if (toeClipped) return FRAMING_TOE;
        return FRAMING_OK;
    }

    private static int compileShader(final int type, final String src) {
        final int shader = GLES20.glCreateShader(type);
        GLES20.glShaderSource(shader, src);
        GLES20.glCompileShader(shader);
        final int[] ok = new int[1];
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, ok, 0);
        if (ok[0] == 0) {
            final String log = GLES20.glGetShaderInfoLog(shader);
            Log.e(TAG, "Failed to compile Live3DOverlayRenderer GLES 2.0 shader (type=" + type + "): " + log);
            GLES20.glDeleteShader(shader);
            return 0;
        }
        return shader;
    }
}
