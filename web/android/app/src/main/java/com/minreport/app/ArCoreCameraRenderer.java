package com.minreport.app;

import android.content.Context;
import android.hardware.display.DisplayManager;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.util.Log;
import android.view.Display;
import android.view.Surface;
import com.google.ar.core.Camera;
import com.google.ar.core.Coordinates2d;
import com.google.ar.core.Frame;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import com.google.ar.core.exceptions.CameraNotAvailableException;
import com.google.ar.core.exceptions.DeadlineExceededException;
import com.google.ar.core.exceptions.SessionPausedException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * Minimal GLES 2.0 renderer for the live ARCore camera feed with integrated DisplayRotationHelper.
 */
public class ArCoreCameraRenderer implements GLSurfaceView.Renderer {

    private static final String TAG = "ArCoreCameraRenderer";
    private static final int MAX_GL_FALLBACK_WIDTH = 640;
    private static final int MAX_GL_FALLBACK_HEIGHT = 480;

    /**
     * Captured RGBA frame read back from OpenGL right after drawCameraQuad() (before 3D overlays)
     * when ARCore acquireCameraImage() fails persistently on MediaTek HALs.
     */
    public static final class GlFallbackFrame {
        public final byte[] rgbaBytes;
        public final int width;
        public final int height;

        public GlFallbackFrame(final byte[] rgbaBytes, final int width, final int height) {
            this.rgbaBytes = rgbaBytes;
            this.width = width;
            this.height = height;
        }
    }

    /**
     * Callback invoked on the GL thread immediately after each successful ARCore frame update.
     */
    public interface FrameListener {
        void onArFrame(Session session, Frame frame);

        default void onArRenderError(String errorCode) {}
    }

    private static final String VERTEX_SHADER =
        "attribute vec4 a_Position;\n" +
        "attribute vec2 a_TexCoord;\n" +
        "varying vec2 v_TexCoord;\n" +
        "void main() {\n" +
        "    gl_Position = a_Position;\n" +
        "    v_TexCoord = a_TexCoord;\n" +
        "}\n";

    private static final String FRAGMENT_SHADER =
        "#extension GL_OES_EGL_image_external : require\n" +
        "precision mediump float;\n" +
        "varying vec2 v_TexCoord;\n" +
        "uniform samplerExternalOES s_Texture;\n" +
        "void main() {\n" +
        "    gl_FragColor = texture2D(s_Texture, v_TexCoord);\n" +
        "}\n";

    private static final float[] NDC_QUAD_COORDS = new float[] {
        -1.0f, -1.0f,
        +1.0f, -1.0f,
        -1.0f, +1.0f,
        +1.0f, +1.0f
    };

    private static final float[] DEFAULT_TEX_COORDS = new float[] {
        0.0f, 1.0f,
        1.0f, 1.0f,
        0.0f, 0.0f,
        1.0f, 0.0f
    };

    private final DisplayRotationHelper displayRotationHelper;
    private final FrameListener frameListener;
    private final Live3DOverlayRenderer overlayRenderer = new Live3DOverlayRenderer();
    private final FloatBuffer quadCoords;
    private final FloatBuffer quadTexCoords;
    private final float[] viewMatrix = new float[16];
    private final float[] projectionMatrix = new float[16];

    private volatile Live3DOverlayRenderer.FramingStatus lastFramingStatus =
        new Live3DOverlayRenderer.FramingStatus(false, false);

    private Session session;
    private int cameraTextureId = -1;
    private boolean textureBoundToSession = false;
    private boolean texCoordsInitialized = false;

    private int programId = 0;
    private int positionAttrib = -1;
    private int texCoordAttrib = -1;
    private int textureUniform = -1;

    // Anti-HAL MediaTek GL Readback fallback (offscreen FBO <= 640x480, disposed cleanly)
    private volatile boolean glFallbackRequested = false;
    private GlFallbackFrame pendingGlFallbackFrame = null;
    private int fallbackFboId = 0;
    private int fallbackTexId = 0;
    private int fallbackWidth = 0;
    private int fallbackHeight = 0;
    private ByteBuffer fallbackReadBuffer = null;

    public ArCoreCameraRenderer(final Context context, final FrameListener frameListener) {
        this.displayRotationHelper = new DisplayRotationHelper(context);
        this.frameListener = frameListener;

        this.quadCoords = ByteBuffer.allocateDirect(NDC_QUAD_COORDS.length * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer();
        this.quadCoords.put(NDC_QUAD_COORDS);
        this.quadCoords.position(0);

        this.quadTexCoords = ByteBuffer.allocateDirect(DEFAULT_TEX_COORDS.length * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer();
        this.quadTexCoords.put(DEFAULT_TEX_COORDS);
        this.quadTexCoords.position(0);
    }

    public synchronized void setSession(final Session session) {
        this.session = session;
        this.textureBoundToSession = false;
        this.texCoordsInitialized = false;
    }

    public void onResume() {
        displayRotationHelper.onResume();
    }

    public void onPause() {
        displayRotationHelper.onPause();
    }

    public int getViewportWidth() {
        return displayRotationHelper.getViewportWidth();
    }

    public int getViewportHeight() {
        return displayRotationHelper.getViewportHeight();
    }

    public int getDisplayRotationDegrees() {
        return displayRotationHelper.getDisplayRotationDegrees();
    }

    public void updateLiveOverlay(final WalkRingToeSolver.LiveOverlaySnapshot snapshot) {
        overlayRenderer.updateSnapshot(snapshot);
    }

    public void updateLivePointCloud(final float[] pointVertsXyz) {
        overlayRenderer.updateLivePointCloud(pointVertsXyz);
    }

    public void updateLivePlaneOutlines(final float[] lineVertsXyz) {
        overlayRenderer.updateLivePlaneOutlines(lineVertsXyz);
    }

    public void clearLiveTrackingVisuals() {
        overlayRenderer.clearLiveTrackingVisuals();
    }

    public void clearLiveOverlay() {
        overlayRenderer.clearSnapshot();
    }

    public void requestGlFallbackFrame() {
        this.glFallbackRequested = true;
    }

    public void clearGlFallbackRequest() {
        this.glFallbackRequested = false;
        this.pendingGlFallbackFrame = null;
    }

    public GlFallbackFrame consumeGlFallbackFrame() {
        final GlFallbackFrame frame = this.pendingGlFallbackFrame;
        this.pendingGlFallbackFrame = null;
        return frame;
    }

    public Live3DOverlayRenderer.FramingStatus getLastFramingStatus() {
        return lastFramingStatus;
    }

    public void releaseGlResources() {
        overlayRenderer.release();
        releaseFallbackFbo();
        if (programId != 0) {
            GLES20.glDeleteProgram(programId);
            programId = 0;
        }
        if (cameraTextureId != -1) {
            GLES20.glDeleteTextures(1, new int[] { cameraTextureId }, 0);
            cameraTextureId = -1;
        }
    }

    @Override
    public void onSurfaceCreated(final GL10 gl, final EGLConfig config) {
        GLES20.glClearColor(0.0f, 0.0f, 0.0f, 1.0f);

        final int[] textures = new int[1];
        GLES20.glGenTextures(1, textures, 0);
        cameraTextureId = textures[0];

        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, cameraTextureId);
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES20.GL_TEXTURE_WRAP_S,
            GLES20.GL_CLAMP_TO_EDGE
        );
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES20.GL_TEXTURE_WRAP_T,
            GLES20.GL_CLAMP_TO_EDGE
        );
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES20.GL_TEXTURE_MIN_FILTER,
            GLES20.GL_LINEAR
        );
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES20.GL_TEXTURE_MAG_FILTER,
            GLES20.GL_LINEAR
        );

        final int vertexShader = compileShader(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER);
        final int fragmentShader = compileShader(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER);

        programId = GLES20.glCreateProgram();
        GLES20.glAttachShader(programId, vertexShader);
        GLES20.glAttachShader(programId, fragmentShader);
        GLES20.glLinkProgram(programId);

        final int[] linkStatus = new int[1];
        GLES20.glGetProgramiv(programId, GLES20.GL_LINK_STATUS, linkStatus, 0);
        if (linkStatus[0] == 0) {
            final String log = GLES20.glGetProgramInfoLog(programId);
            GLES20.glDeleteProgram(programId);
            programId = 0;
            throw new RuntimeException("Failed to link AR camera GLES program: " + log);
        }

        GLES20.glDeleteShader(vertexShader);
        GLES20.glDeleteShader(fragmentShader);

        positionAttrib = GLES20.glGetAttribLocation(programId, "a_Position");
        texCoordAttrib = GLES20.glGetAttribLocation(programId, "a_TexCoord");
        textureUniform = GLES20.glGetUniformLocation(programId, "s_Texture");

        synchronized (this) {
            textureBoundToSession = false;
            texCoordsInitialized = false;
        }
        fallbackFboId = 0;
        fallbackTexId = 0;
        fallbackWidth = 0;
        fallbackHeight = 0;
        overlayRenderer.onSurfaceCreated();
    }

    @Override
    public void onSurfaceChanged(final GL10 gl, final int width, final int height) {
        GLES20.glViewport(0, 0, width, height);
        displayRotationHelper.onSurfaceChanged(width, height);
    }

    @Override
    public void onDrawFrame(final GL10 gl) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);

        final Session activeSession;
        final boolean needsTextureBind;
        synchronized (this) {
            activeSession = this.session;
            if (activeSession == null || cameraTextureId == -1 || programId == 0) {
                return;
            }
            needsTextureBind = !textureBoundToSession;
        }

        try {
            if (needsTextureBind) {
                activeSession.setCameraTextureName(cameraTextureId);
                synchronized (this) {
                    if (this.session == activeSession) {
                        textureBoundToSession = true;
                    }
                }
            }

            displayRotationHelper.updateSessionIfNeeded(activeSession);

            final Frame frame = activeSession.update();
            final long frameTimestamp = frame.getTimestamp();
            if (frameTimestamp != 0L) {
                if (!texCoordsInitialized || frame.hasDisplayGeometryChanged()) {
                    quadCoords.position(0);
                    quadTexCoords.position(0);
                    frame.transformCoordinates2d(
                        Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES,
                        quadCoords,
                        Coordinates2d.TEXTURE_NORMALIZED,
                        quadTexCoords
                    );
                    texCoordsInitialized = true;
                }

                drawCameraQuad();
            }

            pendingGlFallbackFrame = null;
            final Camera camera = frame.getCamera();
            if (
                glFallbackRequested &&
                frameTimestamp != 0L &&
                camera.getTrackingState() == TrackingState.TRACKING
            ) {
                glFallbackRequested = false;
                pendingGlFallbackFrame = captureCameraQuadFallback(
                    displayRotationHelper.getViewportWidth(),
                    displayRotationHelper.getViewportHeight()
                );
            }

            if (frameListener != null) {
                try {
                    frameListener.onArFrame(activeSession, frame);
                } finally {
                    pendingGlFallbackFrame = null;
                }
            } else {
                pendingGlFallbackFrame = null;
            }

            // Draw 3D overlay AFTER onArFrame() so live points/planes/mesh appear on the same frame
            if (frameTimestamp != 0L && camera.getTrackingState() == TrackingState.TRACKING) {
                camera.getViewMatrix(viewMatrix, 0);
                camera.getProjectionMatrix(projectionMatrix, 0, 0.1f, 60.0f);
                lastFramingStatus = overlayRenderer.draw(viewMatrix, projectionMatrix);
            } else {
                lastFramingStatus = new Live3DOverlayRenderer.FramingStatus(false, false);
            }
        } catch (CameraNotAvailableException | SessionPausedException | DeadlineExceededException transientEx) {
            // Expected transient ARCore lifecycle states during pause/resume transitions.
        } catch (Throwable unexpectedEx) {
            Log.w(TAG, "Unexpected ARCore render frame error", unexpectedEx);
            if (frameListener != null) {
                frameListener.onArRenderError(unexpectedEx.getClass().getSimpleName());
            }
        }
    }

    private void drawCameraQuad() {
        GLES20.glDisable(GLES20.GL_DEPTH_TEST);
        GLES20.glDepthMask(false);

        GLES20.glUseProgram(programId);

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, cameraTextureId);
        GLES20.glUniform1i(textureUniform, 0);

        quadCoords.position(0);
        GLES20.glVertexAttribPointer(positionAttrib, 2, GLES20.GL_FLOAT, false, 0, quadCoords);
        GLES20.glEnableVertexAttribArray(positionAttrib);

        quadTexCoords.position(0);
        GLES20.glVertexAttribPointer(texCoordAttrib, 2, GLES20.GL_FLOAT, false, 0, quadTexCoords);
        GLES20.glEnableVertexAttribArray(texCoordAttrib);

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);

        GLES20.glDisableVertexAttribArray(positionAttrib);
        GLES20.glDisableVertexAttribArray(texCoordAttrib);
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, 0);

        GLES20.glDepthMask(true);
        GLES20.glEnable(GLES20.GL_DEPTH_TEST);
    }

    /**
     * Reads back a clean camera-only RGBA frame (<= 640x480, even dimensions) using an offscreen
     * FBO to preserve full FOV matching camera.getTextureIntrinsics(), falling back to centered
     * default-framebuffer glReadPixels if FBO allocation is unsupported.
     */
    private GlFallbackFrame captureCameraQuadFallback(final int vw, final int vh) {
        if (vw < 4 || vh < 4) {
            return null;
        }
        final float scale = Math.min(
            1.0f,
            Math.min(MAX_GL_FALLBACK_WIDTH / (float) vw, MAX_GL_FALLBACK_HEIGHT / (float) vh)
        );
        final int targetW = Math.max(4, ((int) Math.floor(vw * scale)) & ~1);
        final int targetH = Math.max(4, ((int) Math.floor(vh * scale)) & ~1);

        try {
            while (GLES20.glGetError() != GLES20.GL_NO_ERROR) {
                // Drain prior GL error state before validating offscreen FBO readback.
            }
            if (ensureFallbackFbo(targetW, targetH)) {
                GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fallbackFboId);
                GLES20.glViewport(0, 0, targetW, targetH);
                drawCameraQuad();
                GLES20.glPixelStorei(GLES20.GL_PACK_ALIGNMENT, 1);
                fallbackReadBuffer.clear();
                GLES20.glReadPixels(
                    0,
                    0,
                    targetW,
                    targetH,
                    GLES20.GL_RGBA,
                    GLES20.GL_UNSIGNED_BYTE,
                    fallbackReadBuffer
                );
                final int glErr = GLES20.glGetError();
                GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
                GLES20.glViewport(0, 0, vw, vh);

                if (glErr == GLES20.GL_NO_ERROR) {
                    final byte[] out = new byte[targetW * targetH * 4];
                    fallbackReadBuffer.position(0);
                    fallbackReadBuffer.get(out);
                    if (hasNonBlackRgbSample(out, targetW, targetH)) {
                        return new GlFallbackFrame(out, targetW, targetH);
                    }
                    Log.w(TAG, "Offscreen FBO readback returned black pixels; falling back to default FBO");
                } else {
                    Log.w(TAG, "Offscreen FBO glReadPixels error=" + glErr + "; falling back to default FBO");
                }
                releaseFallbackFbo();
            }
        } catch (Throwable t) {
            Log.w(TAG, "Offscreen FBO readback failed; falling back to centered default FBO readback", t);
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
            GLES20.glViewport(0, 0, vw, vh);
            releaseFallbackFbo();
        }

        // Secondary fallback: centered read directly from default framebuffer (already rendered by drawCameraQuad)
        try {
            final int readW = Math.max(4, Math.min(vw, MAX_GL_FALLBACK_WIDTH) & ~1);
            final int readH = Math.max(4, Math.min(vh, MAX_GL_FALLBACK_HEIGHT) & ~1);
            final int x0 = Math.max(0, (vw - readW) / 2);
            final int y0 = Math.max(0, (vh - readH) / 2);
            final int bytesNeeded = readW * readH * 4;
            if (fallbackReadBuffer == null || fallbackReadBuffer.capacity() < bytesNeeded) {
                fallbackReadBuffer = ByteBuffer.allocateDirect(bytesNeeded).order(ByteOrder.nativeOrder());
            }
            GLES20.glPixelStorei(GLES20.GL_PACK_ALIGNMENT, 1);
            fallbackReadBuffer.clear();
            fallbackReadBuffer.limit(bytesNeeded);
            GLES20.glReadPixels(
                x0,
                y0,
                readW,
                readH,
                GLES20.GL_RGBA,
                GLES20.GL_UNSIGNED_BYTE,
                fallbackReadBuffer
            );
            final byte[] out = new byte[bytesNeeded];
            fallbackReadBuffer.position(0);
            fallbackReadBuffer.get(out);
            return new GlFallbackFrame(out, readW, readH);
        } catch (Throwable t) {
            Log.w(TAG, "Default FBO glReadPixels fallback failed", t);
            return null;
        }
    }

    private static boolean hasNonBlackRgbSample(final byte[] rgba, final int width, final int height) {
        if (rgba == null || width <= 0 || height <= 0) {
            return false;
        }
        final int stepX = Math.max(1, width / 5);
        final int stepY = Math.max(1, height / 5);
        for (int y = stepY / 2; y < height; y += stepY) {
            for (int x = stepX / 2; x < width; x += stepX) {
                final int off = (y * width + x) * 4;
                if (off + 2 >= rgba.length) {
                    continue;
                }
                final int r = rgba[off] & 0xFF;
                final int g = rgba[off + 1] & 0xFF;
                final int b = rgba[off + 2] & 0xFF;
                if (r > 4 || g > 4 || b > 4) {
                    return true;
                }
            }
        }
        return false;
    }

    private boolean ensureFallbackFbo(final int width, final int height) {
        if (
            fallbackFboId != 0 &&
            fallbackTexId != 0 &&
            fallbackWidth == width &&
            fallbackHeight == height &&
            fallbackReadBuffer != null &&
            fallbackReadBuffer.capacity() >= width * height * 4
        ) {
            return true;
        }
        releaseFallbackFbo();

        final int[] tex = new int[1];
        GLES20.glGenTextures(1, tex, 0);
        if (tex[0] == 0) {
            return false;
        }
        fallbackTexId = tex[0];
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, fallbackTexId);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexImage2D(
            GLES20.GL_TEXTURE_2D,
            0,
            GLES20.GL_RGBA,
            width,
            height,
            0,
            GLES20.GL_RGBA,
            GLES20.GL_UNSIGNED_BYTE,
            null
        );
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0);

        final int[] fbo = new int[1];
        GLES20.glGenFramebuffers(1, fbo, 0);
        if (fbo[0] == 0) {
            releaseFallbackFbo();
            return false;
        }
        fallbackFboId = fbo[0];
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fallbackFboId);
        GLES20.glFramebufferTexture2D(
            GLES20.GL_FRAMEBUFFER,
            GLES20.GL_COLOR_ATTACHMENT0,
            GLES20.GL_TEXTURE_2D,
            fallbackTexId,
            0
        );
        final int status = GLES20.glCheckFramebufferStatus(GLES20.GL_FRAMEBUFFER);
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
        if (status != GLES20.GL_FRAMEBUFFER_COMPLETE) {
            releaseFallbackFbo();
            return false;
        }
        fallbackWidth = width;
        fallbackHeight = height;
        fallbackReadBuffer = ByteBuffer.allocateDirect(width * height * 4).order(ByteOrder.nativeOrder());
        return true;
    }

    private void releaseFallbackFbo() {
        if (fallbackFboId != 0) {
            GLES20.glDeleteFramebuffers(1, new int[] { fallbackFboId }, 0);
            fallbackFboId = 0;
        }
        if (fallbackTexId != 0) {
            GLES20.glDeleteTextures(1, new int[] { fallbackTexId }, 0);
            fallbackTexId = 0;
        }
        fallbackWidth = 0;
        fallbackHeight = 0;
        fallbackReadBuffer = null;
    }

    private static int compileShader(final int type, final String source) {
        final int shader = GLES20.glCreateShader(type);
        GLES20.glShaderSource(shader, source);
        GLES20.glCompileShader(shader);

        final int[] compiled = new int[1];
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compiled, 0);
        if (compiled[0] == 0) {
            final String log = GLES20.glGetShaderInfoLog(shader);
            GLES20.glDeleteShader(shader);
            throw new RuntimeException("Failed to compile AR camera shader: " + log);
        }
        return shader;
    }

    private static final class DisplayRotationHelper implements DisplayManager.DisplayListener {
        private final DisplayManager displayManager;
        private volatile boolean viewportChanged = false;
        private volatile int viewportWidth = 0;
        private volatile int viewportHeight = 0;

        DisplayRotationHelper(final Context context) {
            this.displayManager = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
        }

        void onResume() {
            viewportChanged = true;
            if (displayManager != null) {
                displayManager.registerDisplayListener(this, null);
            }
        }

        void onPause() {
            if (displayManager != null) {
                displayManager.unregisterDisplayListener(this);
            }
        }

        void onSurfaceChanged(final int width, final int height) {
            this.viewportWidth = width;
            this.viewportHeight = height;
            this.viewportChanged = true;
        }

        void updateSessionIfNeeded(final Session session) {
            if (viewportChanged && viewportWidth > 0 && viewportHeight > 0) {
                session.setDisplayGeometry(getDisplayRotation(), viewportWidth, viewportHeight);
                viewportChanged = false;
            }
        }

        int getViewportWidth() {
            return viewportWidth;
        }

        int getViewportHeight() {
            return viewportHeight;
        }

        int getDisplayRotation() {
            if (displayManager != null) {
                final Display display = displayManager.getDisplay(Display.DEFAULT_DISPLAY);
                if (display != null) {
                    return display.getRotation();
                }
            }
            return Surface.ROTATION_0;
        }

        int getDisplayRotationDegrees() {
            final int rotation = getDisplayRotation();
            if (rotation == Surface.ROTATION_90) {
                return 90;
            }
            if (rotation == Surface.ROTATION_180) {
                return 180;
            }
            if (rotation == Surface.ROTATION_270) {
                return 270;
            }
            return 0;
        }

        @Override
        public void onDisplayAdded(final int displayId) {}

        @Override
        public void onDisplayRemoved(final int displayId) {}

        @Override
        public void onDisplayChanged(final int displayId) {
            viewportChanged = true;
        }
    }
}
