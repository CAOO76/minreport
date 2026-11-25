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

    /**
     * Callback invoked on the GL thread immediately after each successful ARCore frame update.
     */
    public interface FrameListener {
        void onArFrame(Session session, Frame frame);
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

    public void clearLiveOverlay() {
        overlayRenderer.clearSnapshot();
    }

    public Live3DOverlayRenderer.FramingStatus getLastFramingStatus() {
        return lastFramingStatus;
    }

    public void releaseGlResources() {
        overlayRenderer.release();
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
        synchronized (this) {
            activeSession = this.session;
            if (activeSession == null || cameraTextureId == -1 || programId == 0) {
                return;
            }
            if (!textureBoundToSession) {
                activeSession.setCameraTextureName(cameraTextureId);
                textureBoundToSession = true;
            }
        }

        displayRotationHelper.updateSessionIfNeeded(activeSession);

        try {
            final Frame frame = activeSession.update();
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

            final Camera camera = frame.getCamera();
            if (camera.getTrackingState() == TrackingState.TRACKING) {
                camera.getViewMatrix(viewMatrix, 0);
                camera.getProjectionMatrix(projectionMatrix, 0, 0.1f, 60.0f);
                lastFramingStatus = overlayRenderer.draw(viewMatrix, projectionMatrix);
            } else {
                lastFramingStatus = new Live3DOverlayRenderer.FramingStatus(false, false);
            }

            if (frameListener != null) {
                frameListener.onArFrame(activeSession, frame);
            }
        } catch (CameraNotAvailableException | SessionPausedException | DeadlineExceededException transientEx) {
            // Expected transient ARCore lifecycle states during pause/resume transitions.
        } catch (RuntimeException unexpectedEx) {
            Log.w(TAG, "Unexpected ARCore render frame error", unexpectedEx);
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
