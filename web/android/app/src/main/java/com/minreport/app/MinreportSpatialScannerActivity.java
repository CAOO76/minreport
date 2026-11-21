package com.minreport.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.YuvImage;
import android.graphics.drawable.GradientDrawable;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.Image;
import android.opengl.GLSurfaceView;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Camera;
import com.google.ar.core.CameraIntrinsics;
import com.google.ar.core.Config;
import com.google.ar.core.Frame;
import com.google.ar.core.HitResult;
import com.google.ar.core.Plane;
import com.google.ar.core.Point;
import com.google.ar.core.PointCloud;
import com.google.ar.core.Pose;
import com.google.ar.core.Session;
import com.google.ar.core.Trackable;
import com.google.ar.core.TrackingState;
import com.google.ar.core.exceptions.CameraNotAvailableException;
import com.google.ar.core.exceptions.NotYetAvailableException;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Full-screen native ARCore VIO + Depth spatial scanner activity for camera-only
 * volumetric stockpile capture with Blur Gate, voxel fusion, and loop closure.
 */
public class MinreportSpatialScannerActivity
    extends AppCompatActivity
    implements ArCoreCameraRenderer.FrameListener {

    public static final String EXTRA_RESULT_FILE_PATH = "minreport_spatial_scan_result_file";

    private static final int KEYCODE_XCOVER_KEY = 1015;
    private static final int KEYCODE_XCOVER_TOP_KEY = 1079;

    private static final int SECTOR_COUNT = 16;
    private static final float VOXEL_SIZE_M = 0.08f;
    private static final int MAX_VOXEL_POINTS = 6000;
    private static final int MAX_GROUND_SAMPLES = 400;
    private static final int MAX_KEYFRAME_PHOTOS = 4;
    private static final int MAX_PHOTO_DIMENSION_PX = 1280;
    private static final int JPEG_QUALITY = 85;
    private static final int MIN_DEPTH_CONFIDENCE = 96;
    private static final float MIN_DEPTH_M = 0.45f;
    private static final float MAX_DEPTH_M = 22.0f;
    private static final float MAX_ANCHOR_RADIUS_M = 22.0f;
    private static final double BLUR_VARIANCE_THRESHOLD = 28.0;
    private static final double MIN_KEYFRAME_ANGULAR_SEPARATION_DEG = 60.0;
    private static final int MIN_POINTS_TO_FINISH = 20;

    private static final int COLOR_BG_BAR = 0xCC000000;
    private static final int COLOR_SURFACE = 0xFF12151C;
    private static final int COLOR_CYAN = 0xFF00AEEF;
    private static final int COLOR_COPPER = 0xFFC68346;
    private static final int COLOR_TEXT_PRIMARY = 0xFFF3F4F6;
    private static final int COLOR_TEXT_SECONDARY = 0xFF8A93A6;

    private GLSurfaceView glSurfaceView;
    private ArCoreCameraRenderer renderer;
    private Session session;
    private boolean installRequested = false;

    private View statusSquare;
    private TextView headerStatusText;
    private View reticleView;
    private TextView footerMetricsText;
    private Button captureButton;
    private Button primaryActionButton;

    private ExecutorService ioExecutor;
    private int rearSensorOrientation = 90;

    private final Object scanLock = new Object();
    private String scanId;
    private String configuredDepthMode = "VIO_POINTCLOUD";
    private boolean scanActive = false;
    private boolean pendingStartScan = false;
    private boolean manualCaptureRequested = false;
    private boolean finishing = false;

    private float[] anchorCenter = null;
    private final boolean[] visitedSectors = new boolean[SECTOR_COUNT];
    private int sectorsCovered = 0;
    private int startSector = -1;
    private boolean visitedOppositeSector = false;
    private boolean returnedNearStartSector = false;
    private int fusedKeyframeCount = 0;
    private int rejectedBlurCount = 0;
    private long lastBlurCountAtMs = 0L;
    private long lastGroundSampleAtMs = 0L;
    private long lastUiUpdateAtMs = 0L;
    private boolean lastFrameHadDepth = false;
    private TrackingState lastTrackingState = TrackingState.PAUSED;

    private final Map<Long, float[]> voxelGrid = new HashMap<>();
    private final Map<Long, float[]> groundSampleGrid = new HashMap<>();
    private final List<KeyframeMeta> savedKeyframes = new ArrayList<>();

    private static final class KeyframeMeta {
        final int index;
        final double angleDeg;
        final double blurScore;
        final String photoPath;

        KeyframeMeta(final int index, final double angleDeg, final double blurScore, final String photoPath) {
            this.index = index;
            this.angleDeg = angleDeg;
            this.blurScore = blurScore;
            this.photoPath = photoPath;
        }
    }

    @Override
    protected void onCreate(final Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        configureSystemBars();

        this.scanId = "scan-" + System.currentTimeMillis();
        this.ioExecutor = Executors.newSingleThreadExecutor();
        this.rearSensorOrientation = resolveRearCameraSensorOrientation();

        buildMinimalHudLayout();

        this.renderer = new ArCoreCameraRenderer(this, this);
        this.glSurfaceView.setEGLContextClientVersion(2);
        this.glSurfaceView.setPreserveEGLContextOnPause(true);
        this.glSurfaceView.setRenderer(this.renderer);
        this.glSurfaceView.setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
    }

    @Override
    protected void onResume() {
        super.onResume();

        if (
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            setResult(RESULT_CANCELED);
            finish();
            return;
        }

        if (session == null) {
            try {
                final ArCoreApk.InstallStatus installStatus =
                    ArCoreApk.getInstance().requestInstall(this, !installRequested);
                if (installStatus == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
                    installRequested = true;
                    return;
                }

                session = new Session(this);
                configureArSession(session);
                renderer.setSession(session);
            } catch (Exception e) {
                setResult(RESULT_CANCELED);
                finish();
                return;
            }
        }

        try {
            session.resume();
        } catch (CameraNotAvailableException e) {
            setResult(RESULT_CANCELED);
            finish();
            return;
        }

        glSurfaceView.onResume();
        renderer.onResume();
        updateHudFromState(true);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (renderer != null) {
            renderer.onPause();
        }
        if (glSurfaceView != null) {
            glSurfaceView.onPause();
        }
        if (session != null) {
            session.pause();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (session != null) {
            try {
                session.close();
            } catch (Exception ignored) {
            }
            session = null;
        }
        if (ioExecutor != null) {
            ioExecutor.shutdown();
            ioExecutor = null;
        }
    }

    @Override
    public boolean dispatchKeyEvent(final KeyEvent event) {
        if (event == null) {
            return super.dispatchKeyEvent(event);
        }
        final int keyCode = event.getKeyCode();
        final boolean isXCoverTrigger =
            keyCode == KEYCODE_XCOVER_KEY ||
            keyCode == KEYCODE_XCOVER_TOP_KEY ||
            keyCode == KeyEvent.KEYCODE_CAMERA ||
            keyCode == KeyEvent.KEYCODE_F1;

        if (!isXCoverTrigger) {
            return super.dispatchKeyEvent(event);
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            if (keyCode == KEYCODE_XCOVER_TOP_KEY) {
                synchronized (scanLock) {
                    if (scanActive && voxelGrid.size() >= MIN_POINTS_TO_FINISH) {
                        requestFinishScan();
                        return true;
                    }
                }
            }
            handleHardwareOrPrimaryTrigger();
        }
        return true;
    }

    @Override
    public void onArFrame(final Session activeSession, final Frame frame) {
        final Camera camera = frame.getCamera();
        final TrackingState trackingState = camera.getTrackingState();

        boolean shouldAutoFinish = false;
        synchronized (scanLock) {
            lastTrackingState = trackingState;
            if (finishing) {
                return;
            }

            if (trackingState != TrackingState.TRACKING) {
                updateHudThrottled(false);
                return;
            }

            if (pendingStartScan && !scanActive) {
                anchorCenter = computeInitialAnchorCenter(frame, camera);
                scanActive = true;
                pendingStartScan = false;
                manualCaptureRequested = true;
            }

            if (!scanActive || anchorCenter == null) {
                lastFrameHadDepth = probeHasLiveDepth(frame);
                updateHudThrottled(false);
                return;
            }

            final long nowMs = System.currentTimeMillis();
            if (nowMs - lastGroundSampleAtMs >= 350L) {
                collectHorizontalGroundSamples(activeSession);
                lastGroundSampleAtMs = nowMs;
            }

            final float[] camPos = camera.getPose().getTranslation();
            final double angleDeg = computeSectorAngleDeg(camPos, anchorCenter);
            final int sector = Math.min(SECTOR_COUNT - 1, Math.max(0, (int) Math.floor(angleDeg / 22.5)));

            final boolean isNewSector = !visitedSectors[sector];
            final boolean shouldCapture = isNewSector || manualCaptureRequested;

            if (shouldCapture) {
                processSectorCapture(frame, camera, sector, angleDeg, nowMs);
            }

            if (
                sectorsCovered >= SECTOR_COUNT &&
                savedKeyframes.size() >= 3 &&
                voxelGrid.size() >= MIN_POINTS_TO_FINISH
            ) {
                finishing = true;
                shouldAutoFinish = true;
            }
        }

        if (shouldAutoFinish) {
            runOnUiThread(this::finalizeAndReturnScan);
        } else {
            updateHudThrottled(false);
        }
    }

    private void configureSystemBars() {
        final Window window = getWindow();
        if (window != null) {
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.BLACK);
            window.setNavigationBarColor(Color.BLACK);
            final WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
            if (controller != null) {
                controller.setAppearanceLightStatusBars(false);
                controller.setAppearanceLightNavigationBars(false);
            }
        }
    }

    private void buildMinimalHudLayout() {
        final FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        this.glSurfaceView = new GLSurfaceView(this);
        root.addView(
            this.glSurfaceView,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );

        // Center hairline reticle (0px corner radius)
        this.reticleView = new View(this);
        this.reticleView.setBackground(createSharpDrawable(Color.TRANSPARENT, COLOR_COPPER, dp(1)));
        final FrameLayout.LayoutParams reticleParams = new FrameLayout.LayoutParams(dp(34), dp(34));
        reticleParams.gravity = Gravity.CENTER;
        root.addView(this.reticleView, reticleParams);

        // Top HUD bar (56dp)
        final LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setBackgroundColor(COLOR_BG_BAR);
        topBar.setPadding(dp(4), 0, dp(13), 0);
        final FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(56)
        );
        topParams.gravity = Gravity.TOP;

        final Button closeButton = new Button(this);
        closeButton.setText("×");
        closeButton.setContentDescription("CERRAR");
        closeButton.setTextColor(COLOR_TEXT_PRIMARY);
        closeButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        closeButton.setTypeface(Typeface.MONOSPACE);
        closeButton.setBackgroundColor(Color.TRANSPARENT);
        closeButton.setStateListAnimator(null);
        closeButton.setElevation(0.0f);
        closeButton.setPadding(0, 0, 0, 0);
        closeButton.setMinimumWidth(dp(48));
        closeButton.setMinimumHeight(dp(48));
        closeButton.setOnClickListener(v -> cancelScan());
        topBar.addView(closeButton, new LinearLayout.LayoutParams(dp(48), dp(48)));

        this.statusSquare = new View(this);
        this.statusSquare.setBackgroundColor(COLOR_COPPER);
        final LinearLayout.LayoutParams sqParams = new LinearLayout.LayoutParams(dp(8), dp(8));
        sqParams.setMargins(dp(8), 0, dp(10), 0);
        topBar.addView(this.statusSquare, sqParams);

        this.headerStatusText = new TextView(this);
        this.headerStatusText.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        this.headerStatusText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        this.headerStatusText.setTextColor(COLOR_TEXT_PRIMARY);
        this.headerStatusText.setSingleLine(true);
        this.headerStatusText.setEllipsize(TextUtils.TruncateAt.END);
        this.headerStatusText.setText("ARCORE · INICIANDO");
        topBar.addView(
            this.headerStatusText,
            new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f)
        );
        root.addView(topBar, topParams);

        // Bottom HUD bar (84dp)
        final LinearLayout bottomBar = new LinearLayout(this);
        bottomBar.setOrientation(LinearLayout.HORIZONTAL);
        bottomBar.setGravity(Gravity.CENTER_VERTICAL);
        bottomBar.setBackgroundColor(COLOR_BG_BAR);
        bottomBar.setPadding(dp(13), dp(12), dp(13), dp(12));
        final FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(84)
        );
        bottomParams.gravity = Gravity.BOTTOM;

        this.footerMetricsText = new TextView(this);
        this.footerMetricsText.setTypeface(Typeface.MONOSPACE);
        this.footerMetricsText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        this.footerMetricsText.setTextColor(COLOR_TEXT_SECONDARY);
        this.footerMetricsText.setText("0/16 · 0%\nPTS: 0 · BLUR: 0");
        bottomBar.addView(
            this.footerMetricsText,
            new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f)
        );

        this.captureButton = new Button(this);
        this.captureButton.setText("CAPTURAR");
        this.captureButton.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        this.captureButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        this.captureButton.setTextColor(COLOR_TEXT_PRIMARY);
        this.captureButton.setBackground(createSharpDrawable(COLOR_SURFACE, COLOR_COPPER, dp(1)));
        this.captureButton.setStateListAnimator(null);
        this.captureButton.setElevation(0.0f);
        this.captureButton.setPadding(dp(13), 0, dp(13), 0);
        this.captureButton.setVisibility(View.GONE);
        this.captureButton.setOnClickListener(v -> {
            synchronized (scanLock) {
                if (scanActive && !finishing) {
                    manualCaptureRequested = true;
                }
            }
        });
        final LinearLayout.LayoutParams capParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(56)
        );
        capParams.setMargins(0, 0, dp(8), 0);
        bottomBar.addView(this.captureButton, capParams);

        this.primaryActionButton = new Button(this);
        this.primaryActionButton.setText("FIJAR CENTRO / INICIAR");
        this.primaryActionButton.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        this.primaryActionButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        this.primaryActionButton.setTextColor(Color.BLACK);
        this.primaryActionButton.setBackgroundColor(COLOR_COPPER);
        this.primaryActionButton.setStateListAnimator(null);
        this.primaryActionButton.setElevation(0.0f);
        this.primaryActionButton.setPadding(dp(14), 0, dp(14), 0);
        this.primaryActionButton.setOnClickListener(v -> onPrimaryActionClick());
        bottomBar.addView(
            this.primaryActionButton,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(56))
        );

        root.addView(bottomBar, bottomParams);
        setContentView(root);
    }

    private void onPrimaryActionClick() {
        boolean shouldFinishNow = false;
        synchronized (scanLock) {
            if (finishing) {
                return;
            }
            if (!scanActive) {
                pendingStartScan = true;
            } else if (voxelGrid.size() >= MIN_POINTS_TO_FINISH) {
                finishing = true;
                shouldFinishNow = true;
            } else {
                manualCaptureRequested = true;
            }
        }
        if (shouldFinishNow) {
            finalizeAndReturnScan();
        } else {
            updateHudFromState(true);
        }
    }

    private void handleHardwareOrPrimaryTrigger() {
        synchronized (scanLock) {
            if (finishing) {
                return;
            }
            if (!scanActive) {
                pendingStartScan = true;
                runOnUiThread(() -> updateHudFromState(true));
                return;
            }
            manualCaptureRequested = true;
        }
    }

    private void requestFinishScan() {
        synchronized (scanLock) {
            if (finishing) {
                return;
            }
            finishing = true;
        }
        runOnUiThread(this::finalizeAndReturnScan);
    }

    private void cancelScan() {
        synchronized (scanLock) {
            finishing = true;
        }
        setResult(RESULT_CANCELED);
        finish();
    }

    private void configureArSession(final Session targetSession) {
        final Config config = new Config(targetSession);
        config.setFocusMode(Config.FocusMode.AUTO);
        config.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);
        config.setPlaneFindingMode(Config.PlaneFindingMode.HORIZONTAL);

        if (targetSession.isDepthModeSupported(Config.DepthMode.RAW_DEPTH_ONLY)) {
            config.setDepthMode(Config.DepthMode.RAW_DEPTH_ONLY);
            configuredDepthMode = "RAW_DEPTH_ONLY";
        } else if (targetSession.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) {
            config.setDepthMode(Config.DepthMode.AUTOMATIC);
            configuredDepthMode = "AUTOMATIC";
        } else {
            config.setDepthMode(Config.DepthMode.DISABLED);
            configuredDepthMode = "VIO_POINTCLOUD";
        }

        targetSession.configure(config);
    }

    private boolean probeHasLiveDepth(final Frame frame) {
        if ("RAW_DEPTH_ONLY".equals(configuredDepthMode)) {
            try (Image raw = frame.acquireRawDepthImage16Bits()) {
                return raw.getWidth() > 0;
            } catch (NotYetAvailableException e) {
                return false;
            } catch (Exception ignored) {
                return false;
            }
        }
        if ("AUTOMATIC".equals(configuredDepthMode)) {
            try (Image smooth = frame.acquireDepthImage16Bits()) {
                return smooth.getWidth() > 0;
            } catch (NotYetAvailableException e) {
                return false;
            } catch (Exception ignored) {
                return false;
            }
        }
        return false;
    }

    private float[] computeInitialAnchorCenter(final Frame frame, final Camera camera) {
        final Pose camPose = camera.getPose();

        // 1. Prefer median depth in the center third of the frame
        final float medianCenterDepth = readCenterMedianDepthMeters(frame);
        if (medianCenterDepth >= MIN_DEPTH_M && medianCenterDepth <= MAX_DEPTH_M) {
            return camPose.transformPoint(new float[] { 0.0f, 0.0f, -medianCenterDepth });
        }

        // 2. Try hitTest at viewport center
        final int vw = renderer != null ? renderer.getViewportWidth() : 0;
        final int vh = renderer != null ? renderer.getViewportHeight() : 0;
        if (vw > 0 && vh > 0) {
            try {
                final List<HitResult> hits = frame.hitTest(vw * 0.5f, vh * 0.5f);
                for (HitResult hit : hits) {
                    final Trackable trackable = hit.getTrackable();
                    if (
                        (trackable instanceof Plane &&
                            ((Plane) trackable).isPoseInPolygon(hit.getHitPose())) ||
                        trackable instanceof Point
                    ) {
                        final float dist = hit.getDistance();
                        if (dist >= MIN_DEPTH_M && dist <= MAX_DEPTH_M) {
                            return hit.getHitPose().getTranslation();
                        }
                    }
                }
            } catch (Exception ignored) {
            }
        }

        // 3. Fallback 3.5m ahead along camera -Z
        return camPose.transformPoint(new float[] { 0.0f, 0.0f, -3.5f });
    }

    private float readCenterMedianDepthMeters(final Frame frame) {
        if ("RAW_DEPTH_ONLY".equals(configuredDepthMode)) {
            try (
                Image depthImg = frame.acquireRawDepthImage16Bits();
                Image confImg = frame.acquireRawDepthConfidenceImage()
            ) {
                return extractCenterMedianMeters(depthImg, confImg);
            } catch (Exception ignored) {
            }
        }
        if ("AUTOMATIC".equals(configuredDepthMode) || "RAW_DEPTH_ONLY".equals(configuredDepthMode)) {
            try (Image depthImg = frame.acquireDepthImage16Bits()) {
                return extractCenterMedianMeters(depthImg, null);
            } catch (Exception ignored) {
            }
        }
        return -1.0f;
    }

    private float extractCenterMedianMeters(final Image depthImg, final Image confImg) {
        final int w = depthImg.getWidth();
        final int h = depthImg.getHeight();
        if (w <= 0 || h <= 0) {
            return -1.0f;
        }
        final Image.Plane dPlane = depthImg.getPlanes()[0];
        final ByteBuffer dBuf = dPlane.getBuffer().duplicate().order(ByteOrder.LITTLE_ENDIAN);
        final int dRowStride = dPlane.getRowStride();
        final int dPixelStride = dPlane.getPixelStride();

        final ByteBuffer cBuf = confImg != null ? confImg.getPlanes()[0].getBuffer().duplicate() : null;
        final int cRowStride = confImg != null ? confImg.getPlanes()[0].getRowStride() : 0;
        final int cPixelStride = confImg != null ? confImg.getPlanes()[0].getPixelStride() : 0;

        final int minU = w / 3;
        final int maxU = (w * 2) / 3;
        final int minV = h / 3;
        final int maxV = (h * 2) / 3;

        final float[] samples = new float[512];
        int count = 0;
        final int step = Math.max(1, (maxU - minU) / 20);
        for (int v = minV; v < maxV && count < samples.length; v += step) {
            for (int u = minU; u < maxU && count < samples.length; u += step) {
                if (cBuf != null) {
                    final int cIdx = v * cRowStride + u * cPixelStride;
                    if (cIdx >= cBuf.limit() || (cBuf.get(cIdx) & 0xFF) < MIN_DEPTH_CONFIDENCE) {
                        continue;
                    }
                }
                final int dIdx = v * dRowStride + u * dPixelStride;
                if (dIdx + 1 >= dBuf.limit()) {
                    continue;
                }
                final int mm = dBuf.getShort(dIdx) & 0xFFFF;
                final float zM = mm * 0.001f;
                if (zM >= MIN_DEPTH_M && zM <= MAX_DEPTH_M) {
                    samples[count++] = zM;
                }
            }
        }
        if (count < 5) {
            return -1.0f;
        }
        Arrays.sort(samples, 0, count);
        return samples[count / 2];
    }

    private void processSectorCapture(
        final Frame frame,
        final Camera camera,
        final int sector,
        final double angleDeg,
        final long nowMs
    ) {
        byte[] nv21Snapshot = null;
        int imgW = 0;
        int imgH = 0;
        double blurScore = 0.0;

        try (Image camImg = frame.acquireCameraImage()) {
            if (camImg.getFormat() != ImageFormat.YUV_420_888) {
                return;
            }
            blurScore = computeLaplacianVariance(camImg);
            if (blurScore < BLUR_VARIANCE_THRESHOLD) {
                if (nowMs - lastBlurCountAtMs >= 250L) {
                    rejectedBlurCount++;
                    lastBlurCountAtMs = nowMs;
                }
                manualCaptureRequested = false;
                return;
            }

            if (shouldSaveKeyframePhoto(angleDeg, manualCaptureRequested)) {
                imgW = camImg.getWidth();
                imgH = camImg.getHeight();
                nv21Snapshot = extractNv21Bytes(camImg);
            }
        } catch (NotYetAvailableException e) {
            return;
        } catch (Exception ignored) {
            return;
        }

        // Mark sector coverage & loop closure state
        if (!visitedSectors[sector]) {
            visitedSectors[sector] = true;
            sectorsCovered++;
            if (startSector < 0) {
                startSector = sector;
            }
        }
        if (startSector >= 0) {
            final int delta = Math.abs(sector - startSector);
            final int circularDelta = Math.min(delta, SECTOR_COUNT - delta);
            if (circularDelta >= 6) {
                visitedOppositeSector = true;
            }
            if (visitedOppositeSector && circularDelta <= 1) {
                returnedNearStartSector = true;
            }
        }

        fusedKeyframeCount++;

        // Fuse Depth + VIO PointCloud into 0.08m metric voxel grid
        final boolean gotDepth = ingestFrameDepth(frame, camera);
        lastFrameHadDepth = gotDepth;
        ingestFramePointCloud(frame, camera.getPose().getTranslation());

        // Persist sharp keyframe photo asynchronously
        if (nv21Snapshot != null && imgW > 0 && imgH > 0) {
            final int kfIndex = savedKeyframes.size();
            final File photoFile = new File(
                getCacheDir(),
                String.format(Locale.US, "minreport_%s_kf_%d.jpg", scanId, kfIndex)
            );
            savedKeyframes.add(new KeyframeMeta(kfIndex, round1(angleDeg), round1(blurScore), photoFile.getAbsolutePath()));
            final int rotDeg = (rearSensorOrientation - renderer.getDisplayRotationDegrees() + 360) % 360;
            final byte[] bytesToEncode = nv21Snapshot;
            final int encodeW = imgW;
            final int encodeH = imgH;
            if (ioExecutor != null && !ioExecutor.isShutdown()) {
                ioExecutor.execute(() -> saveNv21AsJpeg(bytesToEncode, encodeW, encodeH, rotDeg, photoFile));
            }
        }

        manualCaptureRequested = false;
    }

    private boolean shouldSaveKeyframePhoto(final double angleDeg, final boolean manualRequested) {
        if (savedKeyframes.size() >= MAX_KEYFRAME_PHOTOS) {
            return false;
        }
        if (savedKeyframes.isEmpty()) {
            return true;
        }
        double minSep = 360.0;
        for (KeyframeMeta meta : savedKeyframes) {
            final double diff = Math.abs(angleDeg - meta.angleDeg);
            final double sep = Math.min(diff, 360.0 - diff);
            if (sep < minSep) {
                minSep = sep;
            }
        }
        return manualRequested ? minSep >= 15.0 : minSep >= MIN_KEYFRAME_ANGULAR_SEPARATION_DEG;
    }

    private boolean ingestFrameDepth(final Frame frame, final Camera camera) {
        final CameraIntrinsics intr = camera.getImageIntrinsics();
        final float[] focal = intr.getFocalLength();
        final float[] principal = intr.getPrincipalPoint();
        final int[] cpuDims = intr.getImageDimensions();
        if (cpuDims[0] <= 0 || cpuDims[1] <= 0) {
            return false;
        }
        final Pose camPose = camera.getPose();

        if ("RAW_DEPTH_ONLY".equals(configuredDepthMode)) {
            try (
                Image depthImg = frame.acquireRawDepthImage16Bits();
                Image confImg = frame.acquireRawDepthConfidenceImage()
            ) {
                unprojectDepthImage(depthImg, confImg, focal, principal, cpuDims, camPose);
                return true;
            } catch (NotYetAvailableException e) {
                // Fall through to smoothed depth if available
            } catch (Exception ignored) {
            }
        }

        if ("AUTOMATIC".equals(configuredDepthMode) || "RAW_DEPTH_ONLY".equals(configuredDepthMode)) {
            try (Image depthImg = frame.acquireDepthImage16Bits()) {
                unprojectDepthImage(depthImg, null, focal, principal, cpuDims, camPose);
                return true;
            } catch (Exception ignored) {
            }
        }
        return false;
    }

    private void unprojectDepthImage(
        final Image depthImg,
        final Image confImg,
        final float[] focal,
        final float[] principal,
        final int[] cpuDims,
        final Pose camPose
    ) {
        final int depthW = depthImg.getWidth();
        final int depthH = depthImg.getHeight();
        if (depthW <= 0 || depthH <= 0) {
            return;
        }

        final float scaleX = depthW / (float) cpuDims[0];
        final float scaleY = depthH / (float) cpuDims[1];
        final float fxD = focal[0] * scaleX;
        final float fyD = focal[1] * scaleY;
        final float cxD = principal[0] * scaleX;
        final float cyD = principal[1] * scaleY;
        if (fxD <= 1.0f || fyD <= 1.0f) {
            return;
        }

        final Image.Plane dPlane = depthImg.getPlanes()[0];
        final ByteBuffer dBuf = dPlane.getBuffer().duplicate().order(ByteOrder.LITTLE_ENDIAN);
        final int dRowStride = dPlane.getRowStride();
        final int dPixelStride = dPlane.getPixelStride();

        final ByteBuffer cBuf = confImg != null ? confImg.getPlanes()[0].getBuffer().duplicate() : null;
        final int cRowStride = confImg != null ? confImg.getPlanes()[0].getRowStride() : 0;
        final int cPixelStride = confImg != null ? confImg.getPlanes()[0].getPixelStride() : 0;

        final float[] camPt = new float[3];
        final float[] worldPt = new float[3];
        final int step = 2;

        for (int v = 0; v < depthH; v += step) {
            for (int u = 0; u < depthW; u += step) {
                if (cBuf != null) {
                    final int cIdx = v * cRowStride + u * cPixelStride;
                    if (cIdx >= cBuf.limit() || (cBuf.get(cIdx) & 0xFF) < MIN_DEPTH_CONFIDENCE) {
                        continue;
                    }
                }
                final int dIdx = v * dRowStride + u * dPixelStride;
                if (dIdx + 1 >= dBuf.limit()) {
                    continue;
                }
                final int depthMm = dBuf.getShort(dIdx) & 0xFFFF;
                final float zM = depthMm * 0.001f;
                if (zM < MIN_DEPTH_M || zM > MAX_DEPTH_M) {
                    continue;
                }

                camPt[0] = ((u - cxD) / fxD) * zM;
                camPt[1] = -((v - cyD) / fyD) * zM;
                camPt[2] = -zM;
                camPose.transformPoint(camPt, 0, worldPt, 0);
                insertVoxelPoint(worldPt[0], worldPt[1], worldPt[2]);
            }
        }
    }

    private void ingestFramePointCloud(final Frame frame, final float[] camPos) {
        try (PointCloud pc = frame.acquirePointCloud()) {
            final FloatBuffer pts = pc.getPoints();
            final int limit = pts.limit();
            for (int i = 0; i + 3 < limit; i += 4) {
                final float x = pts.get(i);
                final float y = pts.get(i + 1);
                final float z = pts.get(i + 2);
                final float conf = pts.get(i + 3);
                if (conf < 0.35f) {
                    continue;
                }
                final float dx = x - camPos[0];
                final float dy = y - camPos[1];
                final float dz = z - camPos[2];
                final float distSq = dx * dx + dy * dy + dz * dz;
                if (distSq < (MIN_DEPTH_M * MIN_DEPTH_M) || distSq > (MAX_DEPTH_M * MAX_DEPTH_M)) {
                    continue;
                }
                insertVoxelPoint(x, y, z);
            }
        } catch (Exception ignored) {
        }
    }

    private void insertVoxelPoint(final float wx, final float wy, final float wz) {
        if (anchorCenter != null) {
            final float ax = wx - anchorCenter[0];
            final float az = wz - anchorCenter[2];
            if ((ax * ax + az * az) > (MAX_ANCHOR_RADIUS_M * MAX_ANCHOR_RADIUS_M)) {
                return;
            }
        }
        final int vx = (int) Math.floor(wx / VOXEL_SIZE_M);
        final int vy = (int) Math.floor(wy / VOXEL_SIZE_M);
        final int vz = (int) Math.floor(wz / VOXEL_SIZE_M);
        final long key = (((long) (vx & 0x1FFFFFL)) << 42)
            | (((long) (vy & 0x1FFFFFL)) << 21)
            | ((long) (vz & 0x1FFFFFL));

        float[] acc = voxelGrid.get(key);
        if (acc == null) {
            if (voxelGrid.size() >= MAX_VOXEL_POINTS * 4) {
                return;
            }
            voxelGrid.put(key, new float[] { wx, wy, wz, 1.0f });
        } else {
            acc[0] += wx;
            acc[1] += wy;
            acc[2] += wz;
            acc[3] += 1.0f;
        }
    }

    private void collectHorizontalGroundSamples(final Session activeSession) {
        if (groundSampleGrid.size() >= MAX_GROUND_SAMPLES) {
            return;
        }
        for (Plane plane : activeSession.getAllTrackables(Plane.class)) {
            if (
                plane.getTrackingState() != TrackingState.TRACKING ||
                plane.getSubsumedBy() != null ||
                plane.getType() != Plane.Type.HORIZONTAL_UPWARD_FACING
            ) {
                continue;
            }
            final Pose centerPose = plane.getCenterPose();
            addGroundSampleIfNearAnchor(centerPose.getTranslation());

            final FloatBuffer poly = plane.getPolygon();
            final int limit = poly.limit();
            final float[] localPt = new float[3];
            final float[] worldPt = new float[3];
            float prevLocalX = 0.0f;
            float prevLocalZ = 0.0f;
            boolean hasPrev = false;
            for (int i = 0; i + 1 < limit && groundSampleGrid.size() < MAX_GROUND_SAMPLES; i += 2) {
                final float lx = poly.get(i);
                final float lz = poly.get(i + 1);
                localPt[0] = lx;
                localPt[1] = 0.0f;
                localPt[2] = lz;
                centerPose.transformPoint(localPt, 0, worldPt, 0);
                addGroundSampleIfNearAnchor(worldPt);

                if (hasPrev) {
                    localPt[0] = (prevLocalX + lx) * 0.5f;
                    localPt[1] = 0.0f;
                    localPt[2] = (prevLocalZ + lz) * 0.5f;
                    centerPose.transformPoint(localPt, 0, worldPt, 0);
                    addGroundSampleIfNearAnchor(worldPt);
                }
                prevLocalX = lx;
                prevLocalZ = lz;
                hasPrev = true;
            }
        }
    }

    private void addGroundSampleIfNearAnchor(final float[] pt) {
        if (groundSampleGrid.size() >= MAX_GROUND_SAMPLES) {
            return;
        }
        if (anchorCenter != null) {
            final float dx = pt[0] - anchorCenter[0];
            final float dz = pt[2] - anchorCenter[2];
            if ((dx * dx + dz * dz) > (MAX_ANCHOR_RADIUS_M * MAX_ANCHOR_RADIUS_M)) {
                return;
            }
        }
        final int gx = (int) Math.floor(pt[0] / 0.25f);
        final int gz = (int) Math.floor(pt[2] / 0.25f);
        final long key = (((long) (gx & 0xFFFFFFFFL)) << 32) | ((long) (gz & 0xFFFFFFFFL));
        if (!groundSampleGrid.containsKey(key)) {
            groundSampleGrid.put(key, new float[] { pt[0], pt[1], pt[2] });
        }
    }

    private double computeLaplacianVariance(final Image camImg) {
        final Image.Plane yPlane = camImg.getPlanes()[0];
        final ByteBuffer yBuf = yPlane.getBuffer();
        final int width = camImg.getWidth();
        final int height = camImg.getHeight();
        final int rowStride = yPlane.getRowStride();
        final int pixelStride = yPlane.getPixelStride();
        final int step = 4;
        if (width <= step * 2 || height <= step * 2) {
            return 0.0;
        }

        final int startX = Math.max(step, width / 8);
        final int endX = Math.min(width - step, (width * 7) / 8);
        final int startY = Math.max(step, height / 8);
        final int endY = Math.min(height - step, (height * 7) / 8);
        final int bufLimit = yBuf.limit();

        double sum = 0.0;
        double sumSq = 0.0;
        int count = 0;

        for (int y = startY; y < endY; y += step) {
            final int rowOffset = y * rowStride;
            final int upOffset = (y - step) * rowStride;
            final int downOffset = (y + step) * rowStride;
            for (int x = startX; x < endX; x += step) {
                final int xOff = x * pixelStride;
                final int cIdx = rowOffset + xOff;
                final int lIdx = rowOffset + (x - step) * pixelStride;
                final int rIdx = rowOffset + (x + step) * pixelStride;
                final int uIdx = upOffset + xOff;
                final int dIdx = downOffset + xOff;
                if (dIdx >= bufLimit || rIdx >= bufLimit) {
                    continue;
                }
                final int c = yBuf.get(cIdx) & 0xFF;
                final int l = yBuf.get(lIdx) & 0xFF;
                final int r = yBuf.get(rIdx) & 0xFF;
                final int u = yBuf.get(uIdx) & 0xFF;
                final int d = yBuf.get(dIdx) & 0xFF;
                final double lap = (4.0 * c) - l - r - u - d;
                sum += lap;
                sumSq += lap * lap;
                count++;
            }
        }
        if (count < 16) {
            return 0.0;
        }
        final double mean = sum / count;
        return Math.max(0.0, (sumSq / count) - (mean * mean));
    }

    private byte[] extractNv21Bytes(final Image image) {
        final int width = image.getWidth();
        final int height = image.getHeight();
        final Image.Plane[] planes = image.getPlanes();
        final byte[] nv21 = new byte[(width * height * 3) / 2];

        final Image.Plane yPlane = planes[0];
        final ByteBuffer yBuffer = yPlane.getBuffer().duplicate();
        final int yRowStride = yPlane.getRowStride();
        final int yPixelStride = yPlane.getPixelStride();
        int pos = 0;
        if (yPixelStride == 1 && yRowStride == width) {
            yBuffer.position(0);
            yBuffer.get(nv21, 0, Math.min(width * height, yBuffer.remaining()));
            pos = width * height;
        } else {
            final byte[] rowData = new byte[yRowStride];
            for (int row = 0; row < height; row++) {
                final int offset = row * yRowStride;
                if (offset >= yBuffer.limit()) {
                    break;
                }
                yBuffer.position(offset);
                final int len = Math.min(yBuffer.remaining(), yRowStride);
                yBuffer.get(rowData, 0, len);
                for (int col = 0; col < width && pos < width * height; col++) {
                    final int idx = col * yPixelStride;
                    nv21[pos++] = idx < len ? rowData[idx] : 0;
                }
            }
        }

        final Image.Plane uPlane = planes[1];
        final Image.Plane vPlane = planes[2];
        final ByteBuffer uBuffer = uPlane.getBuffer().duplicate();
        final ByteBuffer vBuffer = vPlane.getBuffer().duplicate();
        final int uRowStride = uPlane.getRowStride();
        final int vRowStride = vPlane.getRowStride();
        final int uPixelStride = uPlane.getPixelStride();
        final int vPixelStride = vPlane.getPixelStride();
        final int chromaHeight = height / 2;
        final int chromaWidth = width / 2;

        for (int row = 0; row < chromaHeight; row++) {
            final int uRowOffset = row * uRowStride;
            final int vRowOffset = row * vRowStride;
            for (int col = 0; col < chromaWidth && pos + 1 < nv21.length; col++) {
                final int vIndex = vRowOffset + col * vPixelStride;
                final int uIndex = uRowOffset + col * uPixelStride;
                nv21[pos++] = vIndex < vBuffer.limit() ? vBuffer.get(vIndex) : 0;
                nv21[pos++] = uIndex < uBuffer.limit() ? uBuffer.get(uIndex) : 0;
            }
        }
        return nv21;
    }

    private void saveNv21AsJpeg(
        final byte[] nv21,
        final int width,
        final int height,
        final int rotationDegrees,
        final File outFile
    ) {
        Bitmap decoded = null;
        Bitmap rotated = null;
        Bitmap scaled = null;
        try {
            final YuvImage yuvImage = new YuvImage(nv21, ImageFormat.NV21, width, height, null);
            final ByteArrayOutputStream rawOut = new ByteArrayOutputStream();
            yuvImage.compressToJpeg(new Rect(0, 0, width, height), 90, rawOut);
            final byte[] rawJpeg = rawOut.toByteArray();

            decoded = BitmapFactory.decodeByteArray(rawJpeg, 0, rawJpeg.length);
            if (decoded == null) {
                return;
            }

            Bitmap current = decoded;
            if (rotationDegrees != 0) {
                final Matrix matrix = new Matrix();
                matrix.postRotate(rotationDegrees);
                rotated = Bitmap.createBitmap(
                    current,
                    0,
                    0,
                    current.getWidth(),
                    current.getHeight(),
                    matrix,
                    true
                );
                current = rotated;
            }

            final int maxDim = Math.max(current.getWidth(), current.getHeight());
            if (maxDim > MAX_PHOTO_DIMENSION_PX) {
                final float ratio = MAX_PHOTO_DIMENSION_PX / (float) maxDim;
                final int targetW = Math.max(1, Math.round(current.getWidth() * ratio));
                final int targetH = Math.max(1, Math.round(current.getHeight() * ratio));
                scaled = Bitmap.createScaledBitmap(current, targetW, targetH, true);
                current = scaled;
            }

            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                current.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, fos);
                fos.flush();
            }
        } catch (Exception ignored) {
        } finally {
            if (scaled != null && scaled != rotated && scaled != decoded) {
                scaled.recycle();
            }
            if (rotated != null && rotated != decoded) {
                rotated.recycle();
            }
            if (decoded != null) {
                decoded.recycle();
            }
        }
    }

    private void finalizeAndReturnScan() {
        primaryActionButton.setEnabled(false);
        captureButton.setEnabled(false);
        headerStatusText.setText("PROCESANDO NUBE 3D...");

        if (ioExecutor != null && !ioExecutor.isShutdown()) {
            ioExecutor.shutdown();
            try {
                ioExecutor.awaitTermination(4, TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }

        try {
            final JSONObject payload = buildResultJson();
            final File resultFile = new File(getCacheDir(), scanId + "_result.json");
            try (FileOutputStream fos = new FileOutputStream(resultFile)) {
                fos.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }

            final Intent resultIntent = new Intent();
            resultIntent.putExtra(EXTRA_RESULT_FILE_PATH, resultFile.getAbsolutePath());
            setResult(RESULT_OK, resultIntent);
            finish();
        } catch (Exception e) {
            setResult(RESULT_CANCELED);
            finish();
        }
    }

    private JSONObject buildResultJson() throws Exception {
        final JSONObject root = new JSONObject();

        final int covered;
        final double coveragePct;
        final boolean loopClosed;
        final int kfCount;
        final int blurRejected;
        final float[] anchorSnapshot;
        final List<float[]> groundSnapshot;
        final List<KeyframeMeta> keyframeSnapshot;
        final List<float[]> voxelSnapshot;

        synchronized (scanLock) {
            covered = sectorsCovered;
            coveragePct = round1((covered / (double) SECTOR_COUNT) * 100.0);
            loopClosed = (covered >= 15) || (covered >= 12 && visitedOppositeSector && returnedNearStartSector);
            kfCount = Math.max(fusedKeyframeCount, savedKeyframes.size());
            blurRejected = rejectedBlurCount;
            anchorSnapshot = anchorCenter != null
                ? new float[] { anchorCenter[0], anchorCenter[1], anchorCenter[2] }
                : new float[] { 0.0f, 0.0f, 0.0f };
            groundSnapshot = new ArrayList<>(groundSampleGrid.values());
            keyframeSnapshot = new ArrayList<>(savedKeyframes);

            voxelSnapshot = new ArrayList<>(Math.min(MAX_VOXEL_POINTS, voxelGrid.size()));
            final int totalVoxels = voxelGrid.size();
            final int stride = totalVoxels > MAX_VOXEL_POINTS
                ? (int) Math.ceil(totalVoxels / (double) MAX_VOXEL_POINTS)
                : 1;
            int idx = 0;
            for (float[] acc : voxelGrid.values()) {
                if (idx % stride == 0 && voxelSnapshot.size() < MAX_VOXEL_POINTS) {
                    final float c = acc[3] > 0.0f ? acc[3] : 1.0f;
                    voxelSnapshot.add(new float[] { acc[0] / c, acc[1] / c, acc[2] / c });
                }
                idx++;
            }
        }

        final String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER : "";
        final String model = Build.MODEL != null ? Build.MODEL : "";
        final String deviceModel = (manufacturer + " " + model).trim();

        root.put("cancelled", false);
        root.put("scanId", scanId);
        root.put("deviceModel", deviceModel);
        root.put("depthMode", configuredDepthMode);
        root.put("coveragePct", coveragePct);
        root.put("sectorsCovered", covered);
        root.put("keyframeCount", kfCount);
        root.put("loopClosed", loopClosed);
        root.put("rejectedBlurCount", blurRejected);

        final JSONObject anchorJson = new JSONObject();
        anchorJson.put("x", round3(anchorSnapshot[0]));
        anchorJson.put("y", round3(anchorSnapshot[1]));
        anchorJson.put("z", round3(anchorSnapshot[2]));
        root.put("anchorCenter", anchorJson);

        final JSONArray pointsArr = new JSONArray();
        for (float[] p : voxelSnapshot) {
            final JSONArray pt = new JSONArray();
            pt.put(round3(p[0]));
            pt.put(round3(p[1]));
            pt.put(round3(p[2]));
            pointsArr.put(pt);
        }
        root.put("pointsM", pointsArr);

        final JSONArray groundArr = new JSONArray();
        for (float[] g : groundSnapshot) {
            final JSONArray pt = new JSONArray();
            pt.put(round3(g[0]));
            pt.put(round3(g[1]));
            pt.put(round3(g[2]));
            groundArr.put(pt);
        }
        root.put("groundSamplesM", groundArr);

        final JSONArray kfArr = new JSONArray();
        for (KeyframeMeta meta : keyframeSnapshot) {
            final File photoFile = new File(meta.photoPath);
            if (!photoFile.exists() || photoFile.length() <= 0L) {
                continue;
            }
            final JSONObject kfJson = new JSONObject();
            kfJson.put("index", meta.index);
            kfJson.put("angleDeg", meta.angleDeg);
            kfJson.put("blurScore", meta.blurScore);
            kfJson.put("photoPath", meta.photoPath);
            kfArr.put(kfJson);
        }
        root.put("keyframes", kfArr);

        return root;
    }

    private void updateHudThrottled(final boolean force) {
        final long now = System.currentTimeMillis();
        if (!force && (now - lastUiUpdateAtMs) < 150L) {
            return;
        }
        lastUiUpdateAtMs = now;
        runOnUiThread(() -> updateHudFromState(false));
    }

    private void updateHudFromState(final boolean ignoreFinishing) {
        final boolean isScanning;
        final boolean isPending;
        final boolean isTracking;
        final boolean hasDepth;
        final int covered;
        final int ptsCount;
        final int blurCount;
        final String mode;

        synchronized (scanLock) {
            if (!ignoreFinishing && finishing) {
                return;
            }
            isScanning = scanActive;
            isPending = pendingStartScan;
            isTracking = lastTrackingState == TrackingState.TRACKING;
            hasDepth = lastFrameHadDepth || !"VIO_POINTCLOUD".equals(configuredDepthMode);
            covered = sectorsCovered;
            ptsCount = voxelGrid.size();
            blurCount = rejectedBlurCount;
            mode = configuredDepthMode;
        }

        final int coverageInt = (int) Math.round((covered / (double) SECTOR_COUNT) * 100.0);
        final boolean optimalBadge = isTracking && hasDepth;
        statusSquare.setBackgroundColor(optimalBadge ? COLOR_CYAN : COLOR_COPPER);
        reticleView.setBackground(
            createSharpDrawable(Color.TRANSPARENT, optimalBadge ? COLOR_CYAN : COLOR_COPPER, dp(1))
        );

        final String shortDepth = "RAW_DEPTH_ONLY".equals(mode)
            ? "RAW DEPTH"
            : ("AUTOMATIC".equals(mode) ? "DEPTH" : "VIO");
        final String trackLabel = isTracking ? "TRACKING" : "BUSCANDO AR";

        if (!isScanning) {
            headerStatusText.setText(
                isPending
                    ? "ANCLANDO CENTRO..."
                    : String.format(Locale.US, "%s · %s · LISTO", trackLabel, shortDepth)
            );
            footerMetricsText.setText(String.format(Locale.US, "0/16 · 0%%\nMODO: %s", shortDepth));
            captureButton.setVisibility(View.GONE);
            primaryActionButton.setText("FIJAR CENTRO / INICIAR");
            primaryActionButton.setBackgroundColor(COLOR_COPPER);
            primaryActionButton.setTextColor(Color.BLACK);
        } else {
            headerStatusText.setText(
                String.format(
                    Locale.US,
                    "%s / %s / %d/%d SECTORES · %d PTS",
                    trackLabel,
                    shortDepth,
                    covered,
                    SECTOR_COUNT,
                    ptsCount
                )
            );
            footerMetricsText.setText(
                String.format(
                    Locale.US,
                    "%d/%d · %d%%\nPTS: %d · BLUR: %d",
                    covered,
                    SECTOR_COUNT,
                    coverageInt,
                    ptsCount,
                    blurCount
                )
            );
            captureButton.setVisibility(View.VISIBLE);
            if (ptsCount >= MIN_POINTS_TO_FINISH) {
                primaryActionButton.setText(String.format(Locale.US, "FINALIZAR (%d/16)", covered));
                primaryActionButton.setBackgroundColor(coverageInt >= 75 ? COLOR_CYAN : COLOR_COPPER);
                primaryActionButton.setTextColor(Color.BLACK);
            } else {
                primaryActionButton.setText(String.format(Locale.US, "CAMINE (%d/%d)", ptsCount, MIN_POINTS_TO_FINISH));
                primaryActionButton.setBackgroundColor(COLOR_COPPER);
                primaryActionButton.setTextColor(Color.BLACK);
            }
        }
    }

    private int resolveRearCameraSensorOrientation() {
        try {
            final CameraManager cameraManager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
            if (cameraManager != null) {
                for (String cameraId : cameraManager.getCameraIdList()) {
                    final CameraCharacteristics chars = cameraManager.getCameraCharacteristics(cameraId);
                    final Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
                    if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                        final Integer sensorOrientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION);
                        if (sensorOrientation != null) {
                            return sensorOrientation;
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return 90;
    }

    private static double computeSectorAngleDeg(final float[] camPos, final float[] center) {
        final double dx = camPos[0] - center[0];
        final double dz = camPos[2] - center[2];
        double deg = Math.toDegrees(Math.atan2(dz, dx));
        if (deg < 0.0) {
            deg += 360.0;
        }
        return deg;
    }

    private static double round1(final double val) {
        return Math.round(val * 10.0) / 10.0;
    }

    private static double round3(final double val) {
        return Math.round(val * 1000.0) / 1000.0;
    }

    private int dp(final int value) {
        return Math.round(
            TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value,
                getResources().getDisplayMetrics()
            )
        );
    }

    private static GradientDrawable createSharpDrawable(final int fillColor, final int strokeColor, final int strokePx) {
        final GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setCornerRadius(0.0f);
        drawable.setColor(fillColor);
        if (strokePx > 0) {
            drawable.setStroke(strokePx, strokeColor);
        }
        return drawable;
    }
}
