package com.minreport.app;

import android.opengl.GLES20;
import android.opengl.Matrix;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/**
 * GLES 2.0 Real-Time 3D Volume Recognition Overlay Renderer (MINREPORT ANSI/ISA-101 HMI):
 * - Verified surface mesh: translucent Cyan #00AEEF at <= 12% alpha
 * - Elevation contours (0.5 m): Cyan #00AEEF at 72% alpha
 * - Gaps / low-density wireframe: Copper #C68346 at 65% alpha
 * - Perimeter Toe loop: Cyan #00AEEF (anchored) vs Copper #C68346 (open/unanchored)
 * - Crown / Toe 8% NDC border framing check (Dark Cockpit exception-only)
 *
 * Uses GL_DYNAMIC_DRAW VBOs capped <= 4,096 vertices (< 1.2 ms GPU on Mali-G57 MC2).
 */
public final class Live3DOverlayRenderer {

    private static final int MAX_VERTICES_PER_BUFFER = 4096;
    private static final int FLOATS_PER_VERTEX = 3;

    private static final String VERT_SHADER =
        "uniform mat4 u_MvpMatrix;\n" +
        "attribute vec3 a_Position;\n" +
        "void main() {\n" +
        "    gl_Position = u_MvpMatrix * vec4(a_Position, 1.0);\n" +
        "}\n";

    private static final String FRAG_SHADER =
        "precision mediump float;\n" +
        "uniform vec4 u_Color;\n" +
        "void main() {\n" +
        "    gl_FragColor = u_Color;\n" +
        "}\n";

    // ANSI/ISA-101 MINREPORT palette
    private static final float[] COLOR_CYAN_MESH = { 0.0f, 0.682f, 0.937f, 0.12f };      // #00AEEF 12%
    private static final float[] COLOR_CYAN_CONTOUR = { 0.0f, 0.682f, 0.937f, 0.72f };   // #00AEEF 72%
    private static final float[] COLOR_CYAN_TOE = { 0.0f, 0.682f, 0.937f, 0.95f };       // #00AEEF 95%
    private static final float[] COLOR_COPPER_GAP = { 0.776f, 0.514f, 0.275f, 0.65f };   // #C68346 65%
    private static final float[] COLOR_COPPER_TOE = { 0.776f, 0.514f, 0.275f, 0.95f };   // #C68346 95%

    public static final class FramingStatus {
        public final boolean crownClipped;
        public final boolean toeClipped;

        public FramingStatus(final boolean crownClipped, final boolean toeClipped) {
            this.crownClipped = crownClipped;
            this.toeClipped = toeClipped;
        }
    }

    private int programId = 0;
    private int mvpUniform = -1;
    private int colorUniform = -1;
    private int posAttrib = -1;

    // 5 dynamic VBOs: 0=verifiedTris, 1=gapLines, 2=contours, 3=toeAnchored, 4=toeOpen
    private final int[] vboIds = new int[5];
    private final int[] vboVertCounts = new int[5];
    private boolean glInitialized = false;

    private final Object snapshotLock = new Object();
    private WalkRingToeSolver.LiveOverlaySnapshot pendingSnapshot = null;
    private WalkRingToeSolver.LiveOverlaySnapshot activeSnapshot = null;
    private boolean snapshotDirty = false;

    private final float[] vpMatrix = new float[16];
    private final float[] tmpVecIn = new float[4];
    private final float[] tmpVecOut = new float[4];
    private FloatBuffer uploadBuffer = null;

    public void onSurfaceCreated() {
        final int vs = compileShader(GLES20.GL_VERTEX_SHADER, VERT_SHADER);
        final int fs = compileShader(GLES20.GL_FRAGMENT_SHADER, FRAG_SHADER);
        programId = GLES20.glCreateProgram();
        GLES20.glAttachShader(programId, vs);
        GLES20.glAttachShader(programId, fs);
        GLES20.glLinkProgram(programId);

        final int[] link = new int[1];
        GLES20.glGetProgramiv(programId, GLES20.GL_LINK_STATUS, link, 0);
        GLES20.glDeleteShader(vs);
        GLES20.glDeleteShader(fs);
        if (link[0] == 0) {
            GLES20.glDeleteProgram(programId);
            programId = 0;
            return;
        }

        mvpUniform = GLES20.glGetUniformLocation(programId, "u_MvpMatrix");
        colorUniform = GLES20.glGetUniformLocation(programId, "u_Color");
        posAttrib = GLES20.glGetAttribLocation(programId, "a_Position");

        GLES20.glGenBuffers(vboIds.length, vboIds, 0);
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
        }
    }

    public void updateSnapshot(final WalkRingToeSolver.LiveOverlaySnapshot snapshot) {
        synchronized (snapshotLock) {
            this.pendingSnapshot = snapshot;
            this.snapshotDirty = true;
        }
    }

    public void clearSnapshot() {
        synchronized (snapshotLock) {
            this.pendingSnapshot = null;
            this.activeSnapshot = null;
            this.snapshotDirty = true;
        }
    }

    public FramingStatus draw(final float[] viewMatrix, final float[] projectionMatrix) {
        if (!glInitialized || programId == 0) {
            return new FramingStatus(false, false);
        }

        WalkRingToeSolver.LiveOverlaySnapshot toUpload = null;
        boolean needsClear = false;
        synchronized (snapshotLock) {
            if (snapshotDirty) {
                toUpload = pendingSnapshot;
                activeSnapshot = pendingSnapshot;
                needsClear = (pendingSnapshot == null);
                snapshotDirty = false;
            }
        }

        if (needsClear) {
            for (int i = 0; i < vboVertCounts.length; i++) {
                vboVertCounts[i] = 0;
            }
        } else if (toUpload != null) {
            uploadVbo(0, toUpload.verifiedTriVerts);
            uploadVbo(1, toUpload.gapLineVerts);
            uploadVbo(2, toUpload.contourLineVerts);
            uploadVbo(3, toUpload.toeAnchoredLineVerts);
            uploadVbo(4, toUpload.toeOpenLineVerts);
        }

        Matrix.multiplyMM(vpMatrix, 0, projectionMatrix, 0, viewMatrix, 0);

        GLES20.glEnable(GLES20.GL_BLEND);
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA);
        GLES20.glDisable(GLES20.GL_DEPTH_TEST);
        GLES20.glDepthMask(false);

        GLES20.glUseProgram(programId);
        GLES20.glUniformMatrix4fv(mvpUniform, 1, false, vpMatrix, 0);
        GLES20.glEnableVertexAttribArray(posAttrib);

        // 1. Translucent verified surface (#00AEEF <= 12%)
        drawVbo(0, GLES20.GL_TRIANGLES, COLOR_CYAN_MESH, 1.0f);
        // 2. Gap wireframe (#C68346 65%)
        drawVbo(1, GLES20.GL_LINES, COLOR_COPPER_GAP, 1.5f);
        // 3. 0.5m elevation contour lines (#00AEEF 72%)
        drawVbo(2, GLES20.GL_LINES, COLOR_CYAN_CONTOUR, 1.8f);
        // 4. Perimeter Toe anchored (#00AEEF) and open (#C68346)
        drawVbo(3, GLES20.GL_LINES, COLOR_CYAN_TOE, 3.0f);
        drawVbo(4, GLES20.GL_LINES, COLOR_COPPER_TOE, 3.0f);

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

    private void uploadVbo(final int slot, final float[] data) {
        if (data == null || data.length < FLOATS_PER_VERTEX || uploadBuffer == null) {
            vboVertCounts[slot] = 0;
            return;
        }
        final int maxFloats = MAX_VERTICES_PER_BUFFER * FLOATS_PER_VERTEX;
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

    private void drawVbo(final int slot, final int mode, final float[] rgba, final float lineWidth) {
        final int count = vboVertCounts[slot];
        if (count <= 0) {
            return;
        }
        if (mode == GLES20.GL_LINES || mode == GLES20.GL_LINE_LOOP) {
            GLES20.glLineWidth(lineWidth);
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
            return new FramingStatus(false, false);
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
        return new FramingStatus(crownClipped, toeClipped);
    }

    private static int compileShader(final int type, final String src) {
        final int shader = GLES20.glCreateShader(type);
        GLES20.glShaderSource(shader, src);
        GLES20.glCompileShader(shader);
        final int[] ok = new int[1];
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, ok, 0);
        if (ok[0] == 0) {
            GLES20.glDeleteShader(shader);
            return 0;
        }
        return shader;
    }
}
