package com.minreport.app;

import android.opengl.GLES20;
import android.opengl.Matrix;
import android.util.Log;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.Arrays;

/**
 * GLES 2.0 Real-Time 3D Volume Recognition & Real Object Silhouette Overlay Renderer (MINREPORT ANSI/ISA-101 HMI):
 * - Real 3D Fused Target Surface (Depth + MagicTouch): Cyan #00AEEF 24% fill + 85% 3D contour loop
 * - Fallback Anchored Mask Quad (MagicTouch without Depth): pre-allocated 256x192 GL_ALPHA texture
 *   updated via glTexSubImage2D, #00AEEF 24% interior fill + 85% 4-neighbor contour edge
 * - Small Anchor Reticle while MagicTouch runs (0-300 ms); NO blind 1.20 m cone/pyramid by default
 * - Optional manual valley POLYGON mode extruded in #00AEEF
 * - Attenuated horizontal ground planes (#8A93A6 12%), omitted whenever targetConstraint.active == true
 * - Dual-Color Live Point Cloud (ISA-101, filtered with groundY):
 *   - Inside TargetVolumeConstraint above floor: Cyan #00AEEF at 90% alpha, 10 px
 *   - Outside / floor / neighbors: Neutral Gray #8A93A6 at 18% alpha, 5 px
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
    public static final int MASK_TEX_WIDTH = 256;
    public static final int MASK_TEX_HEIGHT = 192;
    private static final int MAX_VERTICES_PER_BUFFER = 4096;
    private static final int FLOATS_PER_VERTEX = 3;
    private static final int TARGET_RING_SEGMENTS = 24;
    private static final float ANCHOR_RETICLE_RADIUS_M = 0.08f;

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

    private static final String MASK_QUAD_VERT_SHADER =
        "uniform mat4 u_MvpMatrix;\n" +
        "attribute vec3 a_Position;\n" +
        "attribute vec2 a_TexCoord;\n" +
        "varying vec2 v_TexCoord;\n" +
        "void main() {\n" +
        "    gl_Position = u_MvpMatrix * vec4(a_Position, 1.0);\n" +
        "    v_TexCoord = a_TexCoord;\n" +
        "}\n";

    private static final String MASK_QUAD_FRAG_SHADER =
        "precision mediump float;\n" +
        "uniform sampler2D u_MaskTex;\n" +
        "uniform vec3 u_Color;\n" +
        "uniform vec2 u_TexelSize;\n" +
        "varying vec2 v_TexCoord;\n" +
        "void main() {\n" +
        "    float c = texture2D(u_MaskTex, v_TexCoord).a;\n" +
        "    if (c < 0.5) {\n" +
        "        discard;\n" +
        "    }\n" +
        "    float l = texture2D(u_MaskTex, v_TexCoord - vec2(u_TexelSize.x, 0.0)).a;\n" +
        "    float r = texture2D(u_MaskTex, v_TexCoord + vec2(u_TexelSize.x, 0.0)).a;\n" +
        "    float u = texture2D(u_MaskTex, v_TexCoord - vec2(0.0, u_TexelSize.y)).a;\n" +
        "    float d = texture2D(u_MaskTex, v_TexCoord + vec2(0.0, u_TexelSize.y)).a;\n" +
        "    float minN = min(min(l, r), min(u, d));\n" +
        "    float alpha = (minN < 0.5) ? 0.85 : 0.24;\n" +
        "    gl_FragColor = vec4(u_Color, alpha);\n" +
        "}\n";

    // ANSI/ISA-101 MINREPORT palette
    private static final float[] COLOR_CYAN_MESH = { 0.0f, 0.682f, 0.937f, 0.19f };          // #00AEEF 19%
    private static final float[] COLOR_CYAN_FUSED_FILL = { 0.0f, 0.682f, 0.937f, 0.24f };    // #00AEEF 24%
    private static final float[] COLOR_CYAN_FUSED_CONTOUR = { 0.0f, 0.682f, 0.937f, 0.85f }; // #00AEEF 85%
    private static final float[] COLOR_CYAN_TARGET_FILL = { 0.0f, 0.682f, 0.937f, 0.20f };   // #00AEEF 20%
    private static final float[] COLOR_CYAN_TARGET_RING = { 0.0f, 0.682f, 0.937f, 0.72f };   // #00AEEF 72%
    private static final float[] COLOR_CYAN_CONTOUR = { 0.0f, 0.682f, 0.937f, 0.72f };       // #00AEEF 72%
    private static final float[] COLOR_CYAN_TOE = { 0.0f, 0.682f, 0.937f, 0.95f };           // #00AEEF 95%
    private static final float[] COLOR_CYAN_TARGET_POINTS = { 0.0f, 0.682f, 0.937f, 0.90f }; // #00AEEF 90%
    private static final float[] COLOR_GRAY_ENV_POINTS = { 0.541f, 0.576f, 0.651f, 0.18f };  // #8A93A6 18%
    private static final float[] COLOR_GROUND_PLANE = { 0.54f, 0.58f, 0.65f, 0.12f };        // #8A93A6 12%
    private static final float[] COLOR_COPPER_GAP = { 0.776f, 0.514f, 0.275f, 0.65f };       // #C68346 65%
    private static final float[] COLOR_COPPER_TOE = { 0.776f, 0.514f, 0.275f, 0.95f };       // #C68346 95%
    private static final float[] COLOR_CYAN_RGB = { 0.0f, 0.682f, 0.937f };                  // #00AEEF RGB

    private static volatile Live3DOverlayRenderer latestInstance = null;

    public static Live3DOverlayRenderer getLatestInstance() {
        return latestInstance;
    }

    public Live3DOverlayRenderer() {
        latestInstance = this;
    }

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
     * Pure-Java geometry bundle for target volume overlay (<= 384 total vertices).
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

    // Primary color shader
    private int programId = 0;
    private int mvpUniform = -1;
    private int pointSizeUniform = -1;
    private int colorUniform = -1;
    private int posAttrib = -1;

    // Fallback GL_ALPHA silhouette quad shader
    private int maskProgramId = 0;
    private int maskMvpUniform = -1;
    private int maskTexUniform = -1;
    private int maskColorUniform = -1;
    private int maskTexelSizeUniform = -1;
    private int maskPosAttrib = -1;
    private int maskTexCoordAttrib = -1;
    private int maskTextureId = 0;

    // 13 dynamic VBOs:
    // 0=verifiedTris, 1=gapLines, 2=contours, 3=toeAnchored, 4=toeOpen,
    // 5=targetLivePoints (GL_POINTS #00AEEF 90% 10px), 6=livePlaneLines (GL_LINES #8A93A6 12%),
    // 7=envLivePoints (GL_POINTS #8A93A6 18% 5px),
    // 8=targetPolygonFill (GL_TRIANGLES #00AEEF 20%), 9=targetReticleOrRing (GL_LINES #00AEEF 72%),
    // 10=fusedTargetTris (GL_TRIANGLES #00AEEF 24%), 11=fusedTargetContour (GL_LINE_LOOP #00AEEF 85%),
    // 12=fallbackMaskQuad (GL_TRIANGLE_STRIP xyzuv)
    private final int[] vboIds = new int[13];
    private final int[] vboVertCounts = new int[13];
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
    private float currentGroundY = Float.NaN;
    private boolean targetSegmenting = false;
    private float[] pendingTargetFillVerts = null;
    private float[] pendingTargetRingVerts = null;
    private boolean targetVolumeDirty = false;
    private float[] pendingFusedTriVerts = null;
    private float[] pendingFusedContourVerts = null;
    private boolean fusedSurfaceDirty = false;
    private byte[] pendingMaskTexBytes = null;
    private float[] pendingMaskQuadVerts = null;
    private boolean pendingFallbackQuadActive = false;
    private boolean fallbackMaskDirty = false;
    private boolean fallbackQuadActiveGl = false;
    private boolean captureActive = false;

    private final float[] vpMatrix = new float[16];
    private final float[] tmpVecIn = new float[4];
    private final float[] tmpVecOut = new float[4];
    private FloatBuffer uploadBuffer = null;
    private ByteBuffer maskTexUploadBuffer = null;

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

        initMaskQuadPipeline();

        GLES20.glGenBuffers(vboIds.length, vboIds, 0);
        Arrays.fill(vboVertCounts, 0);
        uploadBuffer = ByteBuffer
            .allocateDirect(MAX_VERTICES_PER_BUFFER * FLOATS_PER_VERTEX * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer();
        maskTexUploadBuffer = ByteBuffer
            .allocateDirect(MASK_TEX_WIDTH * MASK_TEX_HEIGHT)
            .order(ByteOrder.nativeOrder());
        fallbackQuadActiveGl = false;
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
            if (pendingFusedTriVerts != null || pendingFusedContourVerts != null) {
                fusedSurfaceDirty = true;
            }
            if (pendingFallbackQuadActive && pendingMaskTexBytes != null && pendingMaskQuadVerts != null) {
                fallbackMaskDirty = true;
            }
        }
    }

    private void initMaskQuadPipeline() {
        final int vs = compileShader(GLES20.GL_VERTEX_SHADER, MASK_QUAD_VERT_SHADER);
        final int fs = compileShader(GLES20.GL_FRAGMENT_SHADER, MASK_QUAD_FRAG_SHADER);
        if (vs == 0 || fs == 0) {
            if (vs != 0) GLES20.glDeleteShader(vs);
            if (fs != 0) GLES20.glDeleteShader(fs);
            maskProgramId = 0;
            return;
        }
        maskProgramId = GLES20.glCreateProgram();
        GLES20.glAttachShader(maskProgramId, vs);
        GLES20.glAttachShader(maskProgramId, fs);
        GLES20.glLinkProgram(maskProgramId);

        final int[] link = new int[1];
        GLES20.glGetProgramiv(maskProgramId, GLES20.GL_LINK_STATUS, link, 0);
        GLES20.glDeleteShader(vs);
        GLES20.glDeleteShader(fs);
        if (link[0] == 0) {
            Log.e(TAG, "Failed to link mask quad GLES 2.0 program: " + GLES20.glGetProgramInfoLog(maskProgramId));
            GLES20.glDeleteProgram(maskProgramId);
            maskProgramId = 0;
            return;
        }

        maskMvpUniform = GLES20.glGetUniformLocation(maskProgramId, "u_MvpMatrix");
        maskTexUniform = GLES20.glGetUniformLocation(maskProgramId, "u_MaskTex");
        maskColorUniform = GLES20.glGetUniformLocation(maskProgramId, "u_Color");
        maskTexelSizeUniform = GLES20.glGetUniformLocation(maskProgramId, "u_TexelSize");
        maskPosAttrib = GLES20.glGetAttribLocation(maskProgramId, "a_Position");
        maskTexCoordAttrib = GLES20.glGetAttribLocation(maskProgramId, "a_TexCoord");

        final int[] tex = new int[1];
        GLES20.glGenTextures(1, tex, 0);
        maskTextureId = tex[0];
        if (maskTextureId != 0) {
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, maskTextureId);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
            GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 1);
            // Pre-allocate 256x192 GL_ALPHA texture once; all updates use glTexSubImage2D
            GLES20.glTexImage2D(
                GLES20.GL_TEXTURE_2D,
                0,
                GLES20.GL_ALPHA,
                MASK_TEX_WIDTH,
                MASK_TEX_HEIGHT,
                0,
                GLES20.GL_ALPHA,
                GLES20.GL_UNSIGNED_BYTE,
                null
            );
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0);
        }
    }

    public void setCaptureActive(final boolean active) {
        synchronized (snapshotLock) {
            this.captureActive = active;
        }
    }

    /**
     * Updates the estimated floor Y elevation so live point cloud partitioning strictly separates
     * floor pixels (gray #8A93A6 18% 5px) from target object points (cyan #00AEEF 90% 10px).
     */
    public void setGroundY(final float groundY) {
        if (!Float.isFinite(groundY)) {
            return;
        }
        synchronized (snapshotLock) {
            if (Float.isFinite(this.currentGroundY) && Math.abs(this.currentGroundY - groundY) < 0.005f) {
                return;
            }
            this.currentGroundY = groundY;
            if (rawLivePoints != null) {
                final PartitionedPoints partitioned = partitionPointsByTarget(
                    rawLivePoints,
                    this.targetConstraint,
                    this.currentGroundY
                );
                this.pendingTargetLivePoints = partitioned.targetPointsXyz;
                this.pendingEnvLivePoints = partitioned.envPointsXyz;
                this.livePointsDirty = true;
            }
        }
    }

    /**
     * Signals whether MagicTouch segmentation is currently in flight (0-300 ms).
     * While active, clears stale fused geometry/mask quad and displays only a compact #00AEEF reticle at anchor.
     */
    public void setTargetSegmenting(final boolean segmenting) {
        synchronized (snapshotLock) {
            this.targetSegmenting = segmenting;
            if (segmenting) {
                this.pendingFusedTriVerts = null;
                this.pendingFusedContourVerts = null;
                this.fusedSurfaceDirty = true;
                this.pendingFallbackQuadActive = false;
                this.fallbackMaskDirty = true;
                if (this.targetConstraint != null && this.targetConstraint.active && !this.targetConstraint.hasValidPolygon()) {
                    this.pendingTargetFillVerts = null;
                    this.pendingTargetRingVerts = buildAnchorReticleLines(this.targetConstraint);
                    this.targetVolumeDirty = true;
                }
            } else {
                refreshNonPolygonRingLocked();
            }
        }
    }

    private void refreshNonPolygonRingLocked() {
        if (this.targetConstraint != null && this.targetConstraint.active && !this.targetConstraint.hasValidPolygon()) {
            final TargetVolumeGeometry geom = buildTargetVolumeGeometry(this.targetConstraint);
            this.pendingTargetFillVerts = null;
            this.pendingTargetRingVerts = geom != null ? geom.baseRingLineVerts : null;
            this.targetVolumeDirty = true;
        }
    }

    /**
     * Uploads real 3D target surface triangles + 3D perimeter contour loop fused from Depth + MagicTouch.
     */
    public void setFusedTargetSurface(final float[] triVerticesXyz, final float[] contourLoopXyz) {
        final float[] triCopy = (triVerticesXyz != null && triVerticesXyz.length >= FLOATS_PER_VERTEX * 3)
            ? Arrays.copyOf(triVerticesXyz, Math.min(triVerticesXyz.length, MAX_VERTICES_PER_BUFFER * FLOATS_PER_VERTEX))
            : null;
        final float[] contourCopy = (contourLoopXyz != null && contourLoopXyz.length >= FLOATS_PER_VERTEX * 3)
            ? Arrays.copyOf(contourLoopXyz, Math.min(contourLoopXyz.length, MAX_VERTICES_PER_BUFFER * FLOATS_PER_VERTEX))
            : null;
        synchronized (snapshotLock) {
            this.targetSegmenting = false;
            this.pendingFusedTriVerts = triCopy;
            this.pendingFusedContourVerts = contourCopy;
            this.fusedSurfaceDirty = true;
            if (triCopy != null) {
                this.pendingFallbackQuadActive = false;
                this.fallbackMaskDirty = true;
            }
            refreshNonPolygonRingLocked();
        }
    }

    /**
     * Uploads a real MagicTouch object silhouette mask onto a world-space 3D quad anchored to the
     * object when ARCore Depth is unavailable (usedDepth == false).
     * Resamples maskConf into 256x192 off the GL thread; GL thread only runs glTexSubImage2D (0 allocs).
     *
     * @param quadCornersWorld12 12 floats: TL(u=0,v=0), TR(u=1,v=0), BL(u=0,v=1), BR(u=1,v=1)
     */
    public void setFallbackMaskQuad(
        final byte[] maskConf,
        final int maskW,
        final int maskH,
        final float[] quadCornersWorld12
    ) {
        if (
            maskConf == null ||
            maskW <= 0 ||
            maskH <= 0 ||
            maskConf.length < maskW * maskH ||
            quadCornersWorld12 == null ||
            quadCornersWorld12.length < 12
        ) {
            synchronized (snapshotLock) {
                this.pendingFallbackQuadActive = false;
                this.fallbackMaskDirty = true;
            }
            return;
        }

        // Resample maskConf into fixed 256x192 GL_ALPHA buffer outside draw()
        final byte[] resampled = new byte[MASK_TEX_WIDTH * MASK_TEX_HEIGHT];
        int outIdx = 0;
        for (int y = 0; y < MASK_TEX_HEIGHT; y++) {
            final int sy = Math.min(maskH - 1, (y * maskH) / MASK_TEX_HEIGHT);
            final int srcRow = sy * maskW;
            for (int x = 0; x < MASK_TEX_WIDTH; x++) {
                final int sx = Math.min(maskW - 1, (x * maskW) / MASK_TEX_WIDTH);
                resampled[outIdx++] = maskConf[srcRow + sx];
            }
        }

        // Interleaved 4 vertices for GL_TRIANGLE_STRIP: (x, y, z, u, v)
        final float[] quadVerts = new float[] {
            quadCornersWorld12[0], quadCornersWorld12[1], quadCornersWorld12[2], 0.0f, 0.0f,
            quadCornersWorld12[3], quadCornersWorld12[4], quadCornersWorld12[5], 1.0f, 0.0f,
            quadCornersWorld12[6], quadCornersWorld12[7], quadCornersWorld12[8], 0.0f, 1.0f,
            quadCornersWorld12[9], quadCornersWorld12[10], quadCornersWorld12[11], 1.0f, 1.0f
        };

        synchronized (snapshotLock) {
            this.targetSegmenting = false;
            this.pendingFusedTriVerts = null;
            this.pendingFusedContourVerts = null;
            this.fusedSurfaceDirty = true;
            this.pendingMaskTexBytes = resampled;
            this.pendingMaskQuadVerts = quadVerts;
            this.pendingFallbackQuadActive = true;
            this.fallbackMaskDirty = true;
            refreshNonPolygonRingLocked();
        }
    }

    public void clearFusedTargetSurface() {
        synchronized (snapshotLock) {
            this.targetSegmenting = false;
            this.pendingFusedTriVerts = null;
            this.pendingFusedContourVerts = null;
            this.fusedSurfaceDirty = true;
            this.pendingFallbackQuadActive = false;
            this.fallbackMaskDirty = true;
            refreshNonPolygonRingLocked();
        }
    }

    public void updateTargetVolumeConstraint(final TargetVolumeConstraint constraint) {
        final TargetVolumeConstraint safe = constraint != null ? constraint : TargetVolumeConstraint.inactive();
        final TargetVolumeGeometry geom = buildTargetVolumeGeometry(safe);
        synchronized (snapshotLock) {
            this.targetConstraint = safe;
            if (!safe.active) {
                this.targetSegmenting = false;
                this.pendingFusedTriVerts = null;
                this.pendingFusedContourVerts = null;
                this.fusedSurfaceDirty = true;
                this.pendingFallbackQuadActive = false;
                this.fallbackMaskDirty = true;
                this.pendingTargetFillVerts = null;
                this.pendingTargetRingVerts = null;
            } else if (safe.hasValidPolygon()) {
                this.pendingTargetFillVerts = geom != null ? geom.fillTriVerts : null;
                this.pendingTargetRingVerts = geom != null ? geom.baseRingLineVerts : null;
            } else if (this.targetSegmenting) {
                this.pendingTargetFillVerts = null;
                this.pendingTargetRingVerts = buildAnchorReticleLines(safe);
            } else {
                // Non-polygon: never draw a giant blind cone; only subtle base footprint ring
                this.pendingTargetFillVerts = null;
                this.pendingTargetRingVerts = geom != null ? geom.baseRingLineVerts : null;
            }
            this.targetVolumeDirty = true;

            if (rawLivePoints != null) {
                final PartitionedPoints partitioned = partitionPointsByTarget(
                    rawLivePoints,
                    safe,
                    this.currentGroundY
                );
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
                final PartitionedPoints partitioned = partitionPointsByTarget(
                    capped,
                    this.targetConstraint,
                    this.currentGroundY
                );
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
     * Pure-Java geometry builder for target volume indicator (<= 384 total vertices):
     * - Manual POLYGON mode: extruded valley prism + base perimeter ring (<= 82 verts)
     * - Default ANCHOR mode: NO blind 1.20 m cone/pyramid; lightweight horizontal base ring only (48 verts)
     *   while real 3D fused surface or GL_ALPHA silhouette quad represents the actual object geometry.
     */
    public static TargetVolumeGeometry buildTargetVolumeGeometry(final TargetVolumeConstraint c) {
        if (c == null || !c.active) {
            return null;
        }
        final float baseY = (c.hasPadReferenceY ? c.padReferenceY : c.anchorY) + 0.01f;

        if (c.hasValidPolygon()) {
            final float effR = c.getEffectiveRadiusM();
            final float volumeHeight = Math.max(0.45f, Math.min(3.0f, effR * 0.85f));
            final float topY = baseY + volumeHeight;
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

        // Non-polygon: horizontal base footprint ring only (48 verts <= 384; zero opaque blind cone)
        final int seg = TARGET_RING_SEGMENTS;
        final float r = c.radiusM;
        final float[] ring = new float[seg * 2 * FLOATS_PER_VERTEX];
        int rOff = 0;
        for (int i = 0; i < seg; i++) {
            final double a0 = (2.0 * Math.PI * i) / seg;
            final double a1 = (2.0 * Math.PI * ((i + 1) % seg)) / seg;
            final float bx0 = c.anchorX + r * (float) Math.cos(a0);
            final float bz0 = c.anchorZ + r * (float) Math.sin(a0);
            final float bx1 = c.anchorX + r * (float) Math.cos(a1);
            final float bz1 = c.anchorZ + r * (float) Math.sin(a1);
            ring[rOff++] = bx0; ring[rOff++] = baseY; ring[rOff++] = bz0;
            ring[rOff++] = bx1; ring[rOff++] = baseY; ring[rOff++] = bz1;
        }
        return new TargetVolumeGeometry(new float[0], ring);
    }

    /**
     * Compact #00AEEF reticle/ring at the ARCore Anchor shown during the 0-300 ms MagicTouch window.
     */
    private static float[] buildAnchorReticleLines(final TargetVolumeConstraint c) {
        final int seg = 16;
        final float r = ANCHOR_RETICLE_RADIUS_M;
        final float cross = r * 0.55f;
        final float y = c.anchorY + 0.01f;
        final float[] lines = new float[(seg * 2 + 4) * FLOATS_PER_VERTEX];
        int off = 0;
        for (int i = 0; i < seg; i++) {
            final double a0 = (2.0 * Math.PI * i) / seg;
            final double a1 = (2.0 * Math.PI * ((i + 1) % seg)) / seg;
            lines[off++] = c.anchorX + r * (float) Math.cos(a0);
            lines[off++] = y;
            lines[off++] = c.anchorZ + r * (float) Math.sin(a0);
            lines[off++] = c.anchorX + r * (float) Math.cos(a1);
            lines[off++] = y;
            lines[off++] = c.anchorZ + r * (float) Math.sin(a1);
        }
        // Subtle center cross
        lines[off++] = c.anchorX - cross; lines[off++] = y; lines[off++] = c.anchorZ;
        lines[off++] = c.anchorX + cross; lines[off++] = y; lines[off++] = c.anchorZ;
        lines[off++] = c.anchorX; lines[off++] = y; lines[off++] = c.anchorZ - cross;
        lines[off++] = c.anchorX; lines[off++] = y; lines[off++] = c.anchorZ + cross;
        return lines;
    }

    /**
     * Partitions packed XYZ points into target-volume points (Cyan 90% 10px) and environment/floor
     * points (Neutral Gray 18% 5px). Backwards-compatible overload without explicit groundY.
     */
    public static PartitionedPoints partitionPointsByTarget(
        final float[] allXyz,
        final TargetVolumeConstraint c
    ) {
        return partitionPointsByTarget(allXyz, c, Float.NaN);
    }

    /**
     * Partitions packed XYZ points using groundY so floor points stay 100% neutral gray (#8A93A6,
     * 18%, 5px) and only points strictly above the floor inside the target appear Cyan (#00AEEF, 90%, 10px).
     */
    public static PartitionedPoints partitionPointsByTarget(
        final float[] allXyz,
        final TargetVolumeConstraint c,
        final float groundY
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
            if (c.contains3DForVisual(px, py, pz, groundY)) {
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
        float[] fusedTrisToUpload = null;
        float[] fusedContourToUpload = null;
        boolean updateFused = false;
        byte[] maskTexToUpload = null;
        float[] maskQuadToUpload = null;
        boolean nextFallbackQuadActive = false;
        boolean updateFallbackMask = false;
        boolean isCapturing;
        boolean hasActiveTarget;
        boolean hasPolygonTarget;

        synchronized (snapshotLock) {
            isCapturing = captureActive;
            hasActiveTarget = targetConstraint != null && targetConstraint.active;
            hasPolygonTarget = hasActiveTarget && targetConstraint.hasValidPolygon();
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
            if (fusedSurfaceDirty) {
                fusedTrisToUpload = pendingFusedTriVerts;
                fusedContourToUpload = pendingFusedContourVerts;
                updateFused = true;
                fusedSurfaceDirty = false;
            }
            if (fallbackMaskDirty) {
                maskTexToUpload = pendingMaskTexBytes;
                maskQuadToUpload = pendingMaskQuadVerts;
                nextFallbackQuadActive = pendingFallbackQuadActive;
                updateFallbackMask = true;
                fallbackMaskDirty = false;
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
        if (updateFused) {
            uploadVbo(10, fusedTrisToUpload, MAX_VERTICES_PER_BUFFER);
            uploadVbo(11, fusedContourToUpload, MAX_VERTICES_PER_BUFFER);
        }
        if (updateFallbackMask) {
            if (nextFallbackQuadActive && maskTexToUpload != null && maskQuadToUpload != null) {
                uploadFallbackMaskQuad(maskTexToUpload, maskQuadToUpload);
                fallbackQuadActiveGl = true;
            } else {
                fallbackQuadActiveGl = false;
                vboVertCounts[12] = 0;
            }
        }

        Matrix.multiplyMM(vpMatrix, 0, projectionMatrix, 0, viewMatrix, 0);

        GLES20.glEnable(GLES20.GL_BLEND);
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA);
        GLES20.glDisable(GLES20.GL_DEPTH_TEST);
        GLES20.glDepthMask(false);

        // 0. Fallback anchored GL_ALPHA silhouette quad (when usedDepth == false & no verified mesh yet)
        final boolean showPreCaptureTarget = !isCapturing || vboVertCounts[0] == 0;
        if (
            hasActiveTarget &&
            !hasPolygonTarget &&
            showPreCaptureTarget &&
            vboVertCounts[10] == 0 &&
            fallbackQuadActiveGl &&
            vboVertCounts[12] == 4
        ) {
            drawFallbackMaskQuad();
        }

        GLES20.glUseProgram(programId);
        GLES20.glUniformMatrix4fv(mvpUniform, 1, false, vpMatrix, 0);
        GLES20.glEnableVertexAttribArray(posAttrib);

        // 1. Detected horizontal ground planes: subtle gray #8A93A6 12%, omitted when target is active
        if (!hasActiveTarget) {
            drawVbo(6, GLES20.GL_LINES, COLOR_GROUND_PLANE, 1.5f, POINT_SIZE_ENV_PX);
        }

        // 2. Active Target Representation (NO giant blind cone by default):
        //    - Manual POLYGON mode -> translucent valley polygon prism + base ring
        //    - Real 3D Fused Target Surface (Depth + MagicTouch) -> #00AEEF 24% mesh + 85% contour loop
        //    - Otherwise (0-300 ms MagicTouch reticle or manual radius ring) -> crisp lines only
        if (hasActiveTarget && showPreCaptureTarget) {
            if (hasPolygonTarget) {
                drawVbo(8, GLES20.GL_TRIANGLES, COLOR_CYAN_TARGET_FILL, 1.0f, POINT_SIZE_TARGET_PX);
                drawVbo(9, GLES20.GL_LINES, COLOR_CYAN_TARGET_RING, 3.0f, POINT_SIZE_TARGET_PX);
            } else if (vboVertCounts[10] > 0) {
                drawVbo(10, GLES20.GL_TRIANGLES, COLOR_CYAN_FUSED_FILL, 1.0f, POINT_SIZE_TARGET_PX);
                drawVbo(11, GLES20.GL_LINE_LOOP, COLOR_CYAN_FUSED_CONTOUR, 3.0f, POINT_SIZE_TARGET_PX);
            } else if (!fallbackQuadActiveGl) {
                drawVbo(9, GLES20.GL_LINES, COLOR_CYAN_TARGET_RING, 2.5f, POINT_SIZE_TARGET_PX);
            }
        } else if (hasActiveTarget) {
            // During CAPTURING_WALK once verified mesh is present, keep subtle perimeter contour/ring locked
            if (vboVertCounts[11] > 0) {
                drawVbo(11, GLES20.GL_LINE_LOOP, COLOR_CYAN_TARGET_RING, 2.0f, POINT_SIZE_TARGET_PX);
            } else {
                drawVbo(9, GLES20.GL_LINES, COLOR_CYAN_TARGET_RING, 2.0f, POINT_SIZE_TARGET_PX);
            }
        }

        // 3. Progressive translucent verified surface mesh (#00AEEF 19%)
        drawVbo(0, GLES20.GL_TRIANGLES, COLOR_CYAN_MESH, 1.0f, POINT_SIZE_TARGET_PX);
        // 4. Gap wireframe (#C68346 65%)
        drawVbo(1, GLES20.GL_LINES, COLOR_COPPER_GAP, 1.5f, POINT_SIZE_TARGET_PX);
        // 5. 0.5m elevation contour lines (#00AEEF 72%)
        drawVbo(2, GLES20.GL_LINES, COLOR_CYAN_CONTOUR, 1.8f, POINT_SIZE_TARGET_PX);
        // 6. Perimeter Toe anchored (#00AEEF) and open (#C68346)
        drawVbo(3, GLES20.GL_LINES, COLOR_CYAN_TOE, 3.0f, POINT_SIZE_TARGET_PX);
        drawVbo(4, GLES20.GL_LINES, COLOR_COPPER_TOE, 3.0f, POINT_SIZE_TARGET_PX);

        // 7. Dual-color ISA-101 point cloud: floor/env first (#8A93A6 18%, 5px), then target (#00AEEF 90%, 10px)
        drawVbo(7, GLES20.GL_POINTS, COLOR_GRAY_ENV_POINTS, 1.0f, POINT_SIZE_ENV_PX);
        drawVbo(5, GLES20.GL_POINTS, COLOR_CYAN_TARGET_POINTS, 1.0f, POINT_SIZE_TARGET_PX);

        GLES20.glDisableVertexAttribArray(posAttrib);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
        GLES20.glDepthMask(true);
        GLES20.glDisable(GLES20.GL_BLEND);

        return evaluateFramingGuard(activeSnapshot, vpMatrix);
    }

    private void uploadFallbackMaskQuad(final byte[] texBytes, final float[] quadVerts20) {
        if (maskTextureId == 0 || maskTexUploadBuffer == null || uploadBuffer == null) {
            vboVertCounts[12] = 0;
            return;
        }
        final int expected = MASK_TEX_WIDTH * MASK_TEX_HEIGHT;
        if (texBytes.length < expected || quadVerts20.length < 20) {
            vboVertCounts[12] = 0;
            return;
        }
        maskTexUploadBuffer.clear();
        maskTexUploadBuffer.put(texBytes, 0, expected);
        maskTexUploadBuffer.flip();

        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, maskTextureId);
        GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 1);
        GLES20.glTexSubImage2D(
            GLES20.GL_TEXTURE_2D,
            0,
            0,
            0,
            MASK_TEX_WIDTH,
            MASK_TEX_HEIGHT,
            GLES20.GL_ALPHA,
            GLES20.GL_UNSIGNED_BYTE,
            maskTexUploadBuffer
        );
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0);

        uploadBuffer.clear();
        uploadBuffer.put(quadVerts20, 0, 20);
        uploadBuffer.flip();
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vboIds[12]);
        GLES20.glBufferData(GLES20.GL_ARRAY_BUFFER, 20 * 4, uploadBuffer, GLES20.GL_DYNAMIC_DRAW);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
        vboVertCounts[12] = 4;
    }

    private void drawFallbackMaskQuad() {
        if (maskProgramId == 0 || maskTextureId == 0 || vboVertCounts[12] != 4) {
            return;
        }
        GLES20.glUseProgram(maskProgramId);
        GLES20.glUniformMatrix4fv(maskMvpUniform, 1, false, vpMatrix, 0);
        GLES20.glUniform3fv(maskColorUniform, 1, COLOR_CYAN_RGB, 0);
        GLES20.glUniform2f(maskTexelSizeUniform, 1.0f / MASK_TEX_WIDTH, 1.0f / MASK_TEX_HEIGHT);

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, maskTextureId);
        GLES20.glUniform1i(maskTexUniform, 0);

        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vboIds[12]);
        final int strideBytes = 5 * 4;
        GLES20.glEnableVertexAttribArray(maskPosAttrib);
        GLES20.glVertexAttribPointer(maskPosAttrib, 3, GLES20.GL_FLOAT, false, strideBytes, 0);
        GLES20.glEnableVertexAttribArray(maskTexCoordAttrib);
        GLES20.glVertexAttribPointer(maskTexCoordAttrib, 2, GLES20.GL_FLOAT, false, strideBytes, 3 * 4);

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);

        GLES20.glDisableVertexAttribArray(maskPosAttrib);
        GLES20.glDisableVertexAttribArray(maskTexCoordAttrib);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
    }

    public void release() {
        if (glInitialized) {
            GLES20.glDeleteBuffers(vboIds.length, vboIds, 0);
            if (maskTextureId != 0) {
                GLES20.glDeleteTextures(1, new int[] { maskTextureId }, 0);
                maskTextureId = 0;
            }
            if (maskProgramId != 0) {
                GLES20.glDeleteProgram(maskProgramId);
                maskProgramId = 0;
            }
            if (programId != 0) {
                GLES20.glDeleteProgram(programId);
                programId = 0;
            }
            fallbackQuadActiveGl = false;
            glInitialized = false;
        }
        if (latestInstance == this) {
            latestInstance = null;
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
