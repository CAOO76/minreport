package com.minreport.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.YuvImage;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.Image;
import android.opengl.GLSurfaceView;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
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
import com.google.ar.core.DepthPoint;
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
 * Full-screen senior-ergonomic ARCore VIO + Depth activity supporting:
 * - SCAN mode: 3-step ROI flow (Center -> Edge -> 8-sector walkaround + 4 auto keyframes)
 * - CALIBRATE mode: 3-step 2.00 m flat-floor tape calibration with [0.85, 1.15] gate
 */
public class MinreportSpatialScannerActivity
    extends AppCompatActivity
    implements ArCoreCameraRenderer.FrameListener {

    public static final String EXTRA_RESULT_FILE_PATH = "minreport_spatial_scan_result_file";
    public static final String EXTRA_SCAN_MODE = "minreport_spatial_scan_mode";
    public static final String MODE_SCAN = "SCAN";
    public static final String MODE_CALIBRATE = "CALIBRATE";
    public static final String PREFS_CALIBRATION_NAME = "minreport_spatial_calibration";

    private static final int KEYCODE_XCOVER_KEY = 1015;
    private static final int KEYCODE_XCOVER_TOP_KEY = 1079;

    private static final int SECTOR_COUNT = 8;
    private static final float MIN_ROI_RADIUS_M = 0.35f;
    private static final float MAX_ROI_RADIUS_M = 35.0f;
    private static final float ROI_MARGIN_FACTOR = 1.15f;
    private static final int MAX_VOXEL_POINTS = 6000;
    private static final int MAX_GROUND_SAMPLES = 400;
    private static final int MAX_KEYFRAME_PHOTOS = 4;
    private static final int MAX_PHOTO_DIMENSION_PX = 1280;
    private static final int JPEG_QUALITY = 85;
    private static final int MIN_DEPTH_CONFIDENCE = 96;
    private static final float MIN_DEPTH_M = 0.25f;
    private static final float MAX_DEPTH_M = 35.0f;
    private static final double BLUR_VARIANCE_THRESHOLD = 28.0;
    private static final double MIN_KEYFRAME_ANGULAR_SEPARATION_DEG = 60.0;

    private static final long CAL_FLOOR_DURATION_MS = 3000L;
    private static final float MAX_CAL_FLOOR_NOISE_RMS_M = 0.035f;
    private static final float CAL_REFERENCE_DISTANCE_M = 2.0f;
    private static final float MIN_CAL_DISTANCE_M = 0.1f;
    private static final float MIN_SCALE_FACTOR = 0.85f;
    private static final float MAX_SCALE_FACTOR = 1.15f;

    private static final int COLOR_HUD_BG = 0xFF000000;
    private static final int COLOR_GRAY_IDLE = 0xFF2A2F3A;
    private static final int COLOR_CYAN = 0xFF00AEEF;
    private static final int COLOR_COPPER = 0xFFC68346;
    private static final int COLOR_WHITE = 0xFFFFFFFF;
    private static final int COLOR_MUTED = 0xFF8A93A6;

    private enum FlowStep {
        STEP_CENTER,
        STEP_EDGE,
        STEP_WALK,
        CAL_FLOOR,
        CAL_FLOOR_ERROR,
        CAL_START,
        CAL_END,
        CAL_RANGE_ERROR
    }

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

    private static final class CrosshairOverlayView extends View {
        private final Paint shadowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint linePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int accentColor = COLOR_WHITE;

        CrosshairOverlayView(final Context context) {
            super(context);
            shadowPaint.setColor(0xAA000000);
            shadowPaint.setStyle(Paint.Style.STROKE);
            shadowPaint.setStrokeCap(Paint.Cap.SQUARE);
            shadowPaint.setStrokeWidth(6.0f);

            linePaint.setColor(accentColor);
            linePaint.setStyle(Paint.Style.STROKE);
            linePaint.setStrokeCap(Paint.Cap.SQUARE);
            linePaint.setStrokeWidth(3.0f);
        }

        void setAccentColor(final int color) {
            if (this.accentColor != color) {
                this.accentColor = color;
                this.linePaint.setColor(color);
                invalidate();
            }
        }

        @Override
        protected void onDraw(final Canvas canvas) {
            super.onDraw(canvas);
            final float cx = getWidth() * 0.5f;
            final float cy = getHeight() * 0.5f;
            final float arm = Math.min(getWidth(), getHeight()) * 0.38f;
            final float gap = Math.min(getWidth(), getHeight()) * 0.12f;

            drawArms(canvas, cx, cy, arm, gap, shadowPaint);
            drawArms(canvas, cx, cy, arm, gap, linePaint);

            shadowPaint.setStyle(Paint.Style.FILL);
            canvas.drawRect(cx - 4.0f, cy - 4.0f, cx + 4.0f, cy + 4.0f, shadowPaint);
            shadowPaint.setStyle(Paint.Style.STROKE);

            linePaint.setStyle(Paint.Style.FILL);
            canvas.drawRect(cx - 2.5f, cy - 2.5f, cx + 2.5f, cy + 2.5f, linePaint);
            linePaint.setStyle(Paint.Style.STROKE);
        }

        private static void drawArms(
            final Canvas canvas,
            final float cx,
            final float cy,
            final float arm,
            final float gap,
            final Paint paint
        ) {
            canvas.drawLine(cx - arm, cy, cx - gap, cy, paint);
            canvas.drawLine(cx + gap, cy, cx + arm, cy, paint);
            canvas.drawLine(cx, cy - arm, cx, cy - gap, paint);
            canvas.drawLine(cx, cy + gap, cx, cy + arm, paint);
        }
    }

    private GLSurfaceView glSurfaceView;
    private ArCoreCameraRenderer renderer;
    private Session session;
    private boolean installRequested = false;

    private View rootView;
    private TextView stepTitleText;
    private TextView liveMetricText;
    private LinearLayout sectorBlocksRow;
    private final View[] sectorBlocks = new View[SECTOR_COUNT];
    private TextView exceptionBannerText;
    private CrosshairOverlayView crosshairView;
    private Button primaryActionButton;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ExecutorService ioExecutor;
    private int rearSensorOrientation = 90;

    private final Object stateLock = new Object();
    private String mode = MODE_SCAN;
    private FlowStep currentStep = FlowStep.STEP_CENTER;
    private String scanId;
    private String configuredDepthMode = "VIO_POINTCLOUD";
    private boolean finishing = false;

    private TrackingState lastTrackingState = TrackingState.PAUSED;
    private float[] latestTargetHit = null;
    private float[] anchorCenter = null;
    private float roiRadiusM = 1.5f;
    private float liveMeasuredRadiusM = -1.0f;

    private final boolean[] visitedSectors = new boolean[SECTOR_COUNT];
    private int sectorsCovered = 0;
    private int startSector = -1;
    private boolean visitedOppositeSector = false;
    private boolean returnedNearStartSector = false;
    private boolean readyHapticFired = false;
    private int fusedKeyframeCount = 0;
    private int rejectedBlurCount = 0;
    private long lastBlurWarningAtMs = 0L;
    private long lastBlurCountAtMs = 0L;
    private long lastDensitySampleAtMs = 0L;
    private long lastGroundSampleAtMs = 0L;
    private long lastTargetPromptAtMs = 0L;
    private long lastUiUpdateAtMs = 0L;
    private boolean manualSampleRequested = false;

    private final Map<Long, float[]> voxelGrid = new HashMap<>();
    private final Map<Long, float[]> groundSampleGrid = new HashMap<>();
    private final List<KeyframeMeta> savedKeyframes = new ArrayList<>();

    // Calibration state
    private long calFloorStartedAtMs = 0L;
    private long lastCalSampleAtMs = 0L;
    private final List<float[]> calFloorSamples = new ArrayList<>();
    private float calPlaneNoiseRmsM = 0.0f;
    private float calImuPitchOffsetDeg = 0.0f;
    private float calImuRollOffsetDeg = 0.0f;
    private float[] calPointA = null;
    private float liveCalDistanceM = -1.0f;

    @Override
    protected void onCreate(final Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        configureSystemBars();

        final String requestedMode = getIntent() != null ? getIntent().getStringExtra(EXTRA_SCAN_MODE) : null;
        this.mode = MODE_CALIBRATE.equals(requestedMode) ? MODE_CALIBRATE : MODE_SCAN;
        this.currentStep = MODE_CALIBRATE.equals(this.mode) ? FlowStep.CAL_FLOOR : FlowStep.STEP_CENTER;
        this.scanId = "scan-" + System.currentTimeMillis();
        this.ioExecutor = Executors.newSingleThreadExecutor();
        this.rearSensorOrientation = resolveRearCameraSensorOrientation();

        buildSeniorHudLayout();

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
        mainHandler.removeCallbacksAndMessages(null);
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
            onPrimaryActionClick();
        }
        return true;
    }

    @Override
    public void onArFrame(final Session activeSession, final Frame frame) {
        final Camera camera = frame.getCamera();
        final TrackingState trackingState = camera.getTrackingState();

        boolean fireSectorPulse = false;
        boolean fireDoubleReadyPulse = false;
        boolean advanceToCalStart = false;
        boolean failCalFloor = false;

        synchronized (stateLock) {
            lastTrackingState = trackingState;
            if (finishing) {
                return;
            }

            if (trackingState != TrackingState.TRACKING) {
                latestTargetHit = null;
                liveMeasuredRadiusM = -1.0f;
                liveCalDistanceM = -1.0f;
                updateHudThrottled(false);
                return;
            }

            final long nowMs = System.currentTimeMillis();

            if (
                currentStep == FlowStep.STEP_CENTER ||
                currentStep == FlowStep.STEP_EDGE ||
                currentStep == FlowStep.CAL_START ||
                currentStep == FlowStep.CAL_END
            ) {
                final boolean preferFloorPlane =
                    currentStep == FlowStep.CAL_START || currentStep == FlowStep.CAL_END;
                latestTargetHit = resolveCrosshairWorldPoint(frame, camera, preferFloorPlane);

                if (currentStep == FlowStep.STEP_EDGE && anchorCenter != null && latestTargetHit != null) {
                    liveMeasuredRadiusM = (float) Math.hypot(
                        latestTargetHit[0] - anchorCenter[0],
                        latestTargetHit[2] - anchorCenter[2]
                    );
                } else if (currentStep != FlowStep.STEP_EDGE) {
                    liveMeasuredRadiusM = -1.0f;
                }

                if (currentStep == FlowStep.CAL_END && calPointA != null && latestTargetHit != null) {
                    liveCalDistanceM = dist3D(calPointA, latestTargetHit);
                } else if (currentStep != FlowStep.CAL_END) {
                    liveCalDistanceM = -1.0f;
                }
            } else if (currentStep == FlowStep.CAL_FLOOR) {
                if (calFloorStartedAtMs == 0L) {
                    calFloorStartedAtMs = nowMs;
                }
                if (nowMs - lastCalSampleAtMs >= 120L) {
                    collectCalibrationFloorSamples(frame, camera);
                    lastCalSampleAtMs = nowMs;
                }
                if (nowMs - calFloorStartedAtMs >= CAL_FLOOR_DURATION_MS) {
                    if (evaluateCalibrationFloorNoise()) {
                        advanceToCalStart = true;
                        currentStep = FlowStep.CAL_START;
                    } else {
                        failCalFloor = true;
                        currentStep = FlowStep.CAL_FLOOR_ERROR;
                    }
                }
            } else if (currentStep == FlowStep.STEP_WALK && anchorCenter != null) {
                if (nowMs - lastGroundSampleAtMs >= 350L) {
                    collectHorizontalGroundSamples(activeSession);
                    lastGroundSampleAtMs = nowMs;
                }

                final float[] camPos = camera.getPose().getTranslation();
                final double angleDeg = computeSectorAngleDeg(camPos, anchorCenter);
                final int sector = Math.min(SECTOR_COUNT - 1, Math.max(0, (int) Math.floor(angleDeg / 45.0)));

                final boolean isNewSector = !visitedSectors[sector];
                final boolean densityRefreshDue =
                    voxelGrid.size() < 2500 && (nowMs - lastDensitySampleAtMs >= 800L);
                if (isNewSector || manualSampleRequested || densityRefreshDue) {
                    final boolean capturedNewSector = processWalkFrame(
                        frame,
                        camera,
                        sector,
                        angleDeg,
                        nowMs,
                        isNewSector
                    );
                    if (capturedNewSector) {
                        fireSectorPulse = true;
                    }
                    lastDensitySampleAtMs = nowMs;
                }

                if (sectorsCovered >= 6 && !readyHapticFired) {
                    readyHapticFired = true;
                    fireDoubleReadyPulse = true;
                }
            }
        }

        if (advanceToCalStart || fireSectorPulse) {
            mainHandler.post(this::triggerShortHaptic);
        }
        if (fireDoubleReadyPulse) {
            mainHandler.post(this::triggerDoubleHaptic);
        }
        if (advanceToCalStart || failCalFloor) {
            mainHandler.post(() -> updateHudFromState(true));
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

    private void buildSeniorHudLayout() {
        final FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        this.rootView = root;

        this.glSurfaceView = new GLSurfaceView(this);
        root.addView(
            this.glSurfaceView,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );

        // Large central crosshair for clear aiming in sunlight
        this.crosshairView = new CrosshairOverlayView(this);
        final FrameLayout.LayoutParams crosshairParams = new FrameLayout.LayoutParams(dp(72), dp(72));
        crosshairParams.gravity = Gravity.CENTER;
        root.addView(this.crosshairView, crosshairParams);

        // Top HUD container (#000000, 0dp corners)
        final LinearLayout topContainer = new LinearLayout(this);
        topContainer.setOrientation(LinearLayout.VERTICAL);
        topContainer.setBackgroundColor(COLOR_HUD_BG);
        final FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        topParams.gravity = Gravity.TOP;

        final LinearLayout headerRow = new LinearLayout(this);
        headerRow.setOrientation(LinearLayout.HORIZONTAL);
        headerRow.setGravity(Gravity.CENTER_VERTICAL);
        headerRow.setPadding(dp(4), dp(8), dp(14), dp(8));

        final Button closeButton = new Button(this);
        closeButton.setText("×");
        closeButton.setContentDescription("CERRAR");
        closeButton.setTextColor(COLOR_WHITE);
        closeButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        closeButton.setTypeface(Typeface.DEFAULT_BOLD);
        closeButton.setBackgroundColor(Color.TRANSPARENT);
        closeButton.setStateListAnimator(null);
        closeButton.setElevation(0.0f);
        closeButton.setPadding(0, 0, 0, 0);
        closeButton.setMinimumWidth(dp(56));
        closeButton.setMinimumHeight(dp(56));
        closeButton.setOnClickListener(v -> cancelAndExit());
        headerRow.addView(closeButton, new LinearLayout.LayoutParams(dp(56), dp(56)));

        this.stepTitleText = new TextView(this);
        this.stepTitleText.setTypeface(Typeface.DEFAULT_BOLD);
        this.stepTitleText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 21);
        this.stepTitleText.setTextColor(COLOR_WHITE);
        this.stepTitleText.setMaxLines(2);
        this.stepTitleText.setPadding(dp(6), 0, 0, 0);
        headerRow.addView(
            this.stepTitleText,
            new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f)
        );
        topContainer.addView(headerRow);

        // Live metric row (used only for Radio / Distancia in Step 2 & Cal 3)
        this.liveMetricText = new TextView(this);
        this.liveMetricText.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        this.liveMetricText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        this.liveMetricText.setTextColor(COLOR_CYAN);
        this.liveMetricText.setGravity(Gravity.CENTER_HORIZONTAL);
        this.liveMetricText.setPadding(dp(14), dp(4), dp(14), dp(10));
        this.liveMetricText.setVisibility(View.GONE);
        topContainer.addView(
            this.liveMetricText,
            new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        );

        // 8 visual sector blocks row (visible only in STEP_WALK)
        this.sectorBlocksRow = new LinearLayout(this);
        this.sectorBlocksRow.setOrientation(LinearLayout.HORIZONTAL);
        this.sectorBlocksRow.setPadding(dp(12), dp(4), dp(12), dp(12));
        this.sectorBlocksRow.setVisibility(View.GONE);
        for (int i = 0; i < SECTOR_COUNT; i++) {
            final View block = new View(this);
            block.setBackgroundColor(COLOR_GRAY_IDLE);
            final LinearLayout.LayoutParams blockParams = new LinearLayout.LayoutParams(0, dp(22), 1.0f);
            if (i < SECTOR_COUNT - 1) {
                blockParams.setMargins(0, 0, dp(4), 0);
            }
            this.sectorBlocks[i] = block;
            this.sectorBlocksRow.addView(block, blockParams);
        }
        topContainer.addView(
            this.sectorBlocksRow,
            new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        );

        // Exception-only banner (ANSI/ISA-101)
        this.exceptionBannerText = new TextView(this);
        this.exceptionBannerText.setTypeface(Typeface.DEFAULT_BOLD);
        this.exceptionBannerText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        this.exceptionBannerText.setTextColor(Color.BLACK);
        this.exceptionBannerText.setBackgroundColor(COLOR_COPPER);
        this.exceptionBannerText.setGravity(Gravity.CENTER);
        this.exceptionBannerText.setPadding(dp(12), dp(10), dp(12), dp(10));
        this.exceptionBannerText.setVisibility(View.GONE);
        topContainer.addView(
            this.exceptionBannerText,
            new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        );

        root.addView(topContainer, topParams);

        // Bottom HUD: single full-width button >= 68dp (#000000 backdrop, 0dp corners)
        final FrameLayout bottomBar = new FrameLayout(this);
        bottomBar.setBackgroundColor(COLOR_HUD_BG);
        bottomBar.setPadding(dp(12), dp(12), dp(12), dp(14));
        final FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        bottomParams.gravity = Gravity.BOTTOM;

        this.primaryActionButton = new Button(this);
        this.primaryActionButton.setTypeface(Typeface.DEFAULT_BOLD);
        this.primaryActionButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        this.primaryActionButton.setAllCaps(true);
        this.primaryActionButton.setStateListAnimator(null);
        this.primaryActionButton.setElevation(0.0f);
        this.primaryActionButton.setMinimumHeight(dp(68));
        this.primaryActionButton.setOnClickListener(v -> onPrimaryActionClick());
        bottomBar.addView(
            this.primaryActionButton,
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(68))
        );

        root.addView(bottomBar, bottomParams);
        setContentView(root);
        updateHudFromState(true);
    }

    private void onPrimaryActionClick() {
        boolean shouldFinishScan = false;
        boolean shouldFinishCalibration = false;
        boolean hapticSuccess = false;
        boolean hapticDouble = false;

        float[] finishCalPointA = null;
        float[] finishCalPointB = null;
        float measuredDist = 0.0f;
        float computedScale = 1.0f;

        synchronized (stateLock) {
            if (finishing) {
                return;
            }
            final long nowMs = System.currentTimeMillis();

            if (currentStep == FlowStep.STEP_CENTER) {
                if (lastTrackingState != TrackingState.TRACKING || latestTargetHit == null) {
                    lastTargetPromptAtMs = nowMs;
                } else {
                    anchorCenter = new float[] {
                        latestTargetHit[0],
                        latestTargetHit[1],
                        latestTargetHit[2]
                    };
                    latestTargetHit = null;
                    liveMeasuredRadiusM = -1.0f;
                    currentStep = FlowStep.STEP_EDGE;
                    hapticSuccess = true;
                }
            } else if (currentStep == FlowStep.STEP_EDGE) {
                if (
                    lastTrackingState != TrackingState.TRACKING ||
                    latestTargetHit == null ||
                    anchorCenter == null
                ) {
                    lastTargetPromptAtMs = nowMs;
                } else {
                    final float distXZ = (float) Math.hypot(
                        latestTargetHit[0] - anchorCenter[0],
                        latestTargetHit[2] - anchorCenter[2]
                    );
                    roiRadiusM = clamp(distXZ, MIN_ROI_RADIUS_M, MAX_ROI_RADIUS_M);
                    currentStep = FlowStep.STEP_WALK;
                    manualSampleRequested = true;
                    hapticSuccess = true;
                }
            } else if (currentStep == FlowStep.STEP_WALK) {
                final boolean ready =
                    (sectorsCovered >= 5) ||
                    (sectorsCovered >= 3 && voxelGrid.size() >= 120);
                if (ready) {
                    finishing = true;
                    shouldFinishScan = true;
                } else {
                    manualSampleRequested = true;
                }
            } else if (currentStep == FlowStep.CAL_FLOOR_ERROR) {
                calFloorSamples.clear();
                calFloorStartedAtMs = nowMs;
                lastCalSampleAtMs = 0L;
                currentStep = FlowStep.CAL_FLOOR;
            } else if (currentStep == FlowStep.CAL_START) {
                if (lastTrackingState != TrackingState.TRACKING || latestTargetHit == null) {
                    lastTargetPromptAtMs = nowMs;
                } else {
                    calPointA = new float[] {
                        latestTargetHit[0],
                        latestTargetHit[1],
                        latestTargetHit[2]
                    };
                    latestTargetHit = null;
                    liveCalDistanceM = -1.0f;
                    currentStep = FlowStep.CAL_END;
                    hapticSuccess = true;
                }
            } else if (currentStep == FlowStep.CAL_END) {
                if (
                    lastTrackingState != TrackingState.TRACKING ||
                    latestTargetHit == null ||
                    calPointA == null
                ) {
                    lastTargetPromptAtMs = nowMs;
                } else {
                    finishCalPointA = calPointA;
                    finishCalPointB = new float[] {
                        latestTargetHit[0],
                        latestTargetHit[1],
                        latestTargetHit[2]
                    };
                    measuredDist = dist3D(finishCalPointA, finishCalPointB);
                    if (measuredDist <= MIN_CAL_DISTANCE_M) {
                        currentStep = FlowStep.CAL_RANGE_ERROR;
                    } else {
                        computedScale = CAL_REFERENCE_DISTANCE_M / measuredDist;
                        if (computedScale < MIN_SCALE_FACTOR || computedScale > MAX_SCALE_FACTOR) {
                            currentStep = FlowStep.CAL_RANGE_ERROR;
                        } else {
                            finishing = true;
                            shouldFinishCalibration = true;
                            hapticDouble = true;
                        }
                    }
                }
            } else if (currentStep == FlowStep.CAL_RANGE_ERROR) {
                calPointA = null;
                latestTargetHit = null;
                liveCalDistanceM = -1.0f;
                currentStep = FlowStep.CAL_START;
            }
        }

        if (hapticSuccess) {
            triggerShortHaptic();
        }
        if (hapticDouble) {
            triggerDoubleHaptic();
        }
        if (shouldFinishScan) {
            finalizeAndReturnScan();
        } else if (shouldFinishCalibration) {
            finalizeAndReturnCalibration(measuredDist, computedScale);
        } else {
            updateHudFromState(true);
        }
    }

    private void cancelAndExit() {
        synchronized (stateLock) {
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

    private float[] resolveCrosshairWorldPoint(
        final Frame frame,
        final Camera camera,
        final boolean preferFloorPlane
    ) {
        final int vw = renderer != null ? renderer.getViewportWidth() : 0;
        final int vh = renderer != null ? renderer.getViewportHeight() : 0;
        final float cxPx = vw * 0.5f;
        final float cyPx = vh * 0.5f;

        if (preferFloorPlane && vw > 0 && vh > 0) {
            final float[] planeHit = hitTestPlane(frame, cxPx, cyPx);
            if (planeHit != null) {
                return planeHit;
            }
        }

        if (vw > 0 && vh > 0) {
            final float[] depthPointHit = hitTestDepthOrPoint(frame, cxPx, cyPx);
            if (depthPointHit != null) {
                return depthPointHit;
            }
        }

        final float[] depthCenterHit = unprojectCenterDepthPatch(frame, camera);
        if (depthCenterHit != null) {
            return depthCenterHit;
        }

        if (!preferFloorPlane && vw > 0 && vh > 0) {
            final float[] planeHit = hitTestPlane(frame, cxPx, cyPx);
            if (planeHit != null) {
                return planeHit;
            }
        }

        return findClosestPointCloudHitAlongCenterRay(frame, camera);
    }

    private static float[] hitTestPlane(final Frame frame, final float cxPx, final float cyPx) {
        try {
            final List<HitResult> hits = frame.hitTest(cxPx, cyPx);
            for (HitResult hit : hits) {
                final Trackable trackable = hit.getTrackable();
                if (
                    trackable instanceof Plane &&
                    ((Plane) trackable).getType() == Plane.Type.HORIZONTAL_UPWARD_FACING &&
                    ((Plane) trackable).isPoseInPolygon(hit.getHitPose())
                ) {
                    final float dist = hit.getDistance();
                    if (dist >= MIN_DEPTH_M && dist <= MAX_DEPTH_M) {
                        return hit.getHitPose().getTranslation();
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private static float[] hitTestDepthOrPoint(final Frame frame, final float cxPx, final float cyPx) {
        try {
            final List<HitResult> hits = frame.hitTest(cxPx, cyPx);
            for (HitResult hit : hits) {
                final Trackable trackable = hit.getTrackable();
                if (trackable instanceof DepthPoint || trackable instanceof Point) {
                    final float dist = hit.getDistance();
                    if (dist >= MIN_DEPTH_M && dist <= MAX_DEPTH_M) {
                        return hit.getHitPose().getTranslation();
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private float[] unprojectCenterDepthPatch(final Frame frame, final Camera camera) {
        final float zM = readCenterPatchMedianDepthMeters(frame);
        if (zM < MIN_DEPTH_M || zM > MAX_DEPTH_M) {
            return null;
        }
        return camera.getPose().transformPoint(new float[] { 0.0f, 0.0f, -zM });
    }

    private float readCenterPatchMedianDepthMeters(final Frame frame) {
        if ("RAW_DEPTH_ONLY".equals(configuredDepthMode)) {
            try (
                Image depthImg = frame.acquireRawDepthImage16Bits();
                Image confImg = frame.acquireRawDepthConfidenceImage()
            ) {
                return extractCenterPatchMedianMeters(depthImg, confImg);
            } catch (Exception ignored) {
            }
        }
        if ("AUTOMATIC".equals(configuredDepthMode) || "RAW_DEPTH_ONLY".equals(configuredDepthMode)) {
            try (Image depthImg = frame.acquireDepthImage16Bits()) {
                return extractCenterPatchMedianMeters(depthImg, null);
            } catch (Exception ignored) {
            }
        }
        return -1.0f;
    }

    private float extractCenterPatchMedianMeters(final Image depthImg, final Image confImg) {
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

        final int minU = Math.round(w * 0.43f);
        final int maxU = Math.round(w * 0.57f);
        final int minV = Math.round(h * 0.43f);
        final int maxV = Math.round(h * 0.57f);

        final float[] samples = new float[256];
        int count = 0;
        final int step = Math.max(1, (maxU - minU) / 12);
        for (int v = minV; v <= maxV && count < samples.length; v += step) {
            for (int u = minU; u <= maxU && count < samples.length; u += step) {
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
        if (count < 3) {
            return -1.0f;
        }
        Arrays.sort(samples, 0, count);
        return samples[count / 2];
    }

    private float[] findClosestPointCloudHitAlongCenterRay(final Frame frame, final Camera camera) {
        final Pose camPose = camera.getPose();
        final float[] origin = camPose.getTranslation();
        final float[] zAxis = camPose.getZAxis();
        final float dirX = -zAxis[0];
        final float dirY = -zAxis[1];
        final float dirZ = -zAxis[2];
        final double minCos = Math.cos(Math.toRadians(7.0));

        float bestScore = Float.MAX_VALUE;
        float[] bestPt = null;

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
                final float vx = x - origin[0];
                final float vy = y - origin[1];
                final float vz = z - origin[2];
                final float dist = (float) Math.sqrt(vx * vx + vy * vy + vz * vz);
                if (dist < MIN_DEPTH_M || dist > MAX_DEPTH_M) {
                    continue;
                }
                final float dot = (vx * dirX + vy * dirY + vz * dirZ) / dist;
                if (dot >= minCos) {
                    final float anglePenalty = (1.0f - dot) * 40.0f + dist * 0.05f;
                    if (anglePenalty < bestScore) {
                        bestScore = anglePenalty;
                        bestPt = new float[] { x, y, z };
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return bestPt;
    }

    private void collectCalibrationFloorSamples(final Frame frame, final Camera camera) {
        if (calFloorSamples.size() >= 600) {
            return;
        }
        final CameraIntrinsics intr = camera.getImageIntrinsics();
        final float[] focal = intr.getFocalLength();
        final float[] principal = intr.getPrincipalPoint();
        final int[] cpuDims = intr.getImageDimensions();
        final Pose camPose = camera.getPose();

        if (cpuDims[0] > 0 && cpuDims[1] > 0) {
            if ("RAW_DEPTH_ONLY".equals(configuredDepthMode)) {
                try (
                    Image depthImg = frame.acquireRawDepthImage16Bits();
                    Image confImg = frame.acquireRawDepthConfidenceImage()
                ) {
                    appendCenterFloorDepthSamples(depthImg, confImg, focal, principal, cpuDims, camPose);
                    return;
                } catch (Exception ignored) {
                }
            }
            if ("AUTOMATIC".equals(configuredDepthMode) || "RAW_DEPTH_ONLY".equals(configuredDepthMode)) {
                try (Image depthImg = frame.acquireDepthImage16Bits()) {
                    appendCenterFloorDepthSamples(depthImg, null, focal, principal, cpuDims, camPose);
                    return;
                } catch (Exception ignored) {
                }
            }
        }

        // VIO PointCloud fallback
        final float[] pt = findClosestPointCloudHitAlongCenterRay(frame, camera);
        if (pt != null && calFloorSamples.size() < 600) {
            calFloorSamples.add(pt);
        }
    }

    private void appendCenterFloorDepthSamples(
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

        final int minU = Math.round(depthW * 0.35f);
        final int maxU = Math.round(depthW * 0.65f);
        final int minV = Math.round(depthH * 0.35f);
        final int maxV = Math.round(depthH * 0.65f);
        final int step = Math.max(2, (maxU - minU) / 6);

        final float[] camPt = new float[3];
        final float[] worldPt = new float[3];
        for (int v = minV; v <= maxV && calFloorSamples.size() < 600; v += step) {
            for (int u = minU; u <= maxU && calFloorSamples.size() < 600; u += step) {
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
                final float zM = (dBuf.getShort(dIdx) & 0xFFFF) * 0.001f;
                if (zM < MIN_DEPTH_M || zM > 6.0f) {
                    continue;
                }
                camPt[0] = ((u - cxD) / fxD) * zM;
                camPt[1] = -((v - cyD) / fyD) * zM;
                camPt[2] = -zM;
                camPose.transformPoint(camPt, 0, worldPt, 0);
                calFloorSamples.add(new float[] { worldPt[0], worldPt[1], worldPt[2] });
            }
        }
    }

    private boolean evaluateCalibrationFloorNoise() {
        final int n = calFloorSamples.size();
        if (n < 12) {
            calPlaneNoiseRmsM = 0.099f;
            return false;
        }

        // Ordinary least squares plane y = a*x + b*z + d
        double sXX = 0.0;
        double sXZ = 0.0;
        double sX = 0.0;
        double sZZ = 0.0;
        double sZ = 0.0;
        double sXY = 0.0;
        double sZY = 0.0;
        double sY = 0.0;
        for (float[] p : calFloorSamples) {
            final double x = p[0];
            final double y = p[1];
            final double z = p[2];
            sXX += x * x;
            sXZ += x * z;
            sX += x;
            sZZ += z * z;
            sZ += z;
            sXY += x * y;
            sZY += z * y;
            sY += y;
        }

        final double[] coeffs = solve3x3(
            new double[][] {
                { sXX, sXZ, sX },
                { sXZ, sZZ, sZ },
                { sX, sZ, n }
            },
            new double[] { sXY, sZY, sY }
        );

        final double a = coeffs != null ? coeffs[0] : 0.0;
        final double b = coeffs != null ? coeffs[1] : 0.0;
        final double d = coeffs != null ? coeffs[2] : (sY / n);

        double sumSqErr = 0.0;
        final double normScale = 1.0 / Math.sqrt(1.0 + a * a + b * b);
        for (float[] p : calFloorSamples) {
            final double err = (p[1] - (a * p[0] + b * p[2] + d)) * normScale;
            sumSqErr += err * err;
        }

        calPlaneNoiseRmsM = (float) Math.sqrt(sumSqErr / n);
        calImuPitchOffsetDeg = (float) Math.toDegrees(Math.atan(b));
        calImuRollOffsetDeg = (float) Math.toDegrees(Math.atan(a));
        return calPlaneNoiseRmsM <= MAX_CAL_FLOOR_NOISE_RMS_M;
    }

    private static double[] solve3x3(final double[][] mat, final double[] rhs) {
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
                if (row == col) {
                    continue;
                }
                final double factor = m[row][col];
                for (int c = col; c < 4; c++) {
                    m[row][c] -= factor * m[col][c];
                }
            }
        }
        return new double[] { m[0][3], m[1][3], m[2][3] };
    }

    private boolean processWalkFrame(
        final Frame frame,
        final Camera camera,
        final int sector,
        final double angleDeg,
        final long nowMs,
        final boolean isNewSector
    ) {
        byte[] nv21Snapshot = null;
        int imgW = 0;
        int imgH = 0;
        double blurScore = 0.0;

        try (Image camImg = frame.acquireCameraImage()) {
            if (camImg.getFormat() != ImageFormat.YUV_420_888) {
                return false;
            }
            blurScore = computeLaplacianVariance(camImg);
            if (blurScore < BLUR_VARIANCE_THRESHOLD) {
                if (nowMs - lastBlurCountAtMs >= 250L) {
                    rejectedBlurCount++;
                    lastBlurCountAtMs = nowMs;
                }
                lastBlurWarningAtMs = nowMs;
                manualSampleRequested = false;
                return false;
            }

            if (shouldSaveKeyframePhoto(angleDeg)) {
                imgW = camImg.getWidth();
                imgH = camImg.getHeight();
                nv21Snapshot = extractNv21Bytes(camImg);
            }
        } catch (NotYetAvailableException e) {
            return false;
        } catch (Exception ignored) {
            return false;
        }

        boolean newlyAddedSector = false;
        if (isNewSector && !visitedSectors[sector]) {
            visitedSectors[sector] = true;
            sectorsCovered++;
            newlyAddedSector = true;
            if (startSector < 0) {
                startSector = sector;
            }
        }
        if (startSector >= 0) {
            final int delta = Math.abs(sector - startSector);
            final int circularDelta = Math.min(delta, SECTOR_COUNT - delta);
            if (circularDelta >= 3) {
                visitedOppositeSector = true;
            }
            if (visitedOppositeSector && circularDelta <= 1) {
                returnedNearStartSector = true;
            }
        }

        fusedKeyframeCount++;

        ingestFrameDepth(frame, camera);
        ingestFramePointCloud(frame, camera.getPose().getTranslation());

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

        manualSampleRequested = false;
        return newlyAddedSector;
    }

    private boolean shouldSaveKeyframePhoto(final double angleDeg) {
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
        return minSep >= MIN_KEYFRAME_ANGULAR_SEPARATION_DEG;
    }

    private void ingestFrameDepth(final Frame frame, final Camera camera) {
        final CameraIntrinsics intr = camera.getImageIntrinsics();
        final float[] focal = intr.getFocalLength();
        final float[] principal = intr.getPrincipalPoint();
        final int[] cpuDims = intr.getImageDimensions();
        if (cpuDims[0] <= 0 || cpuDims[1] <= 0) {
            return;
        }
        final Pose camPose = camera.getPose();

        if ("RAW_DEPTH_ONLY".equals(configuredDepthMode)) {
            try (
                Image depthImg = frame.acquireRawDepthImage16Bits();
                Image confImg = frame.acquireRawDepthConfidenceImage()
            ) {
                unprojectDepthImage(depthImg, confImg, focal, principal, cpuDims, camPose);
                return;
            } catch (NotYetAvailableException e) {
                // Fall through to smoothed depth if available
            } catch (Exception ignored) {
            }
        }

        if ("AUTOMATIC".equals(configuredDepthMode) || "RAW_DEPTH_ONLY".equals(configuredDepthMode)) {
            try (Image depthImg = frame.acquireDepthImage16Bits()) {
                unprojectDepthImage(depthImg, null, focal, principal, cpuDims, camPose);
            } catch (Exception ignored) {
            }
        }
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
        final int step = roiRadiusM <= 2.5f ? 1 : 2;

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
                final float zM = (dBuf.getShort(dIdx) & 0xFFFF) * 0.001f;
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
        if (anchorCenter == null) {
            return;
        }
        final float maxLateralRadius = roiRadiusM * ROI_MARGIN_FACTOR;
        final float ax = wx - anchorCenter[0];
        final float az = wz - anchorCenter[2];
        if ((ax * ax + az * az) > (maxLateralRadius * maxLateralRadius)) {
            return;
        }
        final float maxVerticalSpan = Math.max(6.0f, roiRadiusM * 2.0f);
        if (Math.abs(wy - anchorCenter[1]) > maxVerticalSpan) {
            return;
        }

        final float voxelSizeM = roiRadiusM <= 2.5f ? 0.04f : 0.08f;
        final int vx = (int) Math.floor(wx / voxelSizeM);
        final int vy = (int) Math.floor(wy / voxelSizeM);
        final int vz = (int) Math.floor(wz / voxelSizeM);
        final long key = (((long) (vx & 0x1FFFFFL)) << 42)
            | (((long) (vy & 0x1FFFFFL)) << 21)
            | ((long) (vz & 0x1FFFFFL));

        final float[] acc = voxelGrid.get(key);
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
        if (groundSampleGrid.size() >= MAX_GROUND_SAMPLES || anchorCenter == null) {
            return;
        }
        final float groundLimit = Math.max(roiRadiusM * 1.6f, 2.5f);
        final float dx = pt[0] - anchorCenter[0];
        final float dz = pt[2] - anchorCenter[2];
        if ((dx * dx + dz * dz) > (groundLimit * groundLimit)) {
            return;
        }
        final float cell = roiRadiusM <= 2.5f ? 0.15f : 0.25f;
        final int gx = (int) Math.floor(pt[0] / cell);
        final int gz = (int) Math.floor(pt[2] / cell);
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
        primaryActionButton.setText("PROCESANDO...");

        if (ioExecutor != null && !ioExecutor.isShutdown()) {
            ioExecutor.shutdown();
            try {
                ioExecutor.awaitTermination(4, TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }

        try {
            final JSONObject payload = buildScanResultJson();
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

    private JSONObject buildScanResultJson() throws Exception {
        final JSONObject root = new JSONObject();

        final int covered;
        final double coveragePct;
        final boolean loopClosed;
        final int kfCount;
        final int blurRejected;
        final float radiusSnapshot;
        final float[] anchorSnapshot;
        final List<float[]> groundSnapshot;
        final List<KeyframeMeta> keyframeSnapshot;
        final List<float[]> voxelSnapshot;

        synchronized (stateLock) {
            covered = sectorsCovered;
            coveragePct = round1((covered / (double) SECTOR_COUNT) * 100.0);
            loopClosed = (covered >= 7) || (covered >= 6 && visitedOppositeSector && returnedNearStartSector);
            kfCount = Math.max(1, Math.max(fusedKeyframeCount, savedKeyframes.size()));
            blurRejected = rejectedBlurCount;
            radiusSnapshot = roiRadiusM;
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
        root.put("roiRadiusM", round3(radiusSnapshot));
        root.put("sectorsTotal", SECTOR_COUNT);
        root.put("sectorsCovered", covered);
        root.put("coveragePct", coveragePct);
        root.put("keyframeCount", kfCount);
        root.put("loopClosed", loopClosed);
        root.put("rejectedBlurCount", blurRejected);

        // Attach stored calibration metadata without pre-scaling raw ARCore metric coordinates
        final SharedPreferences calPrefs = getSharedPreferences(PREFS_CALIBRATION_NAME, Context.MODE_PRIVATE);
        final boolean hasCal = calPrefs.getBoolean("calibrated", false);
        final float calScale = calPrefs.getFloat("scaleFactor", 1.0f);
        if (hasCal && calScale >= MIN_SCALE_FACTOR && calScale <= MAX_SCALE_FACTOR) {
            root.put("calibrationScaleFactor", round4(calScale));
            root.put("calibrationPlaneNoiseRmsM", round4(calPrefs.getFloat("planeNoiseRmsM", 0.0f)));
            root.put("deviceCalibratedAt", calPrefs.getLong("calibratedAt", 0L));
        }

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

    private void finalizeAndReturnCalibration(final float measuredDistanceM, final float scaleFactor) {
        final long calibratedAt = System.currentTimeMillis();
        final float planeNoiseRms;
        final float pitchDeg;
        final float rollDeg;
        synchronized (stateLock) {
            planeNoiseRms = calPlaneNoiseRmsM;
            pitchDeg = calImuPitchOffsetDeg;
            rollDeg = calImuRollOffsetDeg;
        }

        getSharedPreferences(PREFS_CALIBRATION_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("calibrated", true)
            .putFloat("scaleFactor", scaleFactor)
            .putFloat("referenceDistanceM", CAL_REFERENCE_DISTANCE_M)
            .putFloat("measuredDistanceM", measuredDistanceM)
            .putFloat("planeNoiseRmsM", planeNoiseRms)
            .putFloat("imuPitchOffsetDeg", pitchDeg)
            .putFloat("imuRollOffsetDeg", rollDeg)
            .putLong("calibratedAt", calibratedAt)
            .commit();

        try {
            final JSONObject payload = new JSONObject();
            payload.put("calibrated", true);
            payload.put("scaleFactor", round4(scaleFactor));
            payload.put("referenceDistanceM", round2(CAL_REFERENCE_DISTANCE_M));
            payload.put("measuredDistanceM", round4(measuredDistanceM));
            payload.put("planeNoiseRmsM", round4(planeNoiseRms));
            payload.put("imuPitchOffsetDeg", round2(pitchDeg));
            payload.put("imuRollOffsetDeg", round2(rollDeg));
            payload.put("calibratedAt", calibratedAt);

            final File resultFile = new File(getCacheDir(), scanId + "_calibration.json");
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

    private void updateHudThrottled(final boolean force) {
        final long now = System.currentTimeMillis();
        if (!force && (now - lastUiUpdateAtMs) < 120L) {
            return;
        }
        lastUiUpdateAtMs = now;
        runOnUiThread(() -> updateHudFromState(false));
    }

    private void updateHudFromState(final boolean ignoreFinishing) {
        final FlowStep step;
        final boolean isTracking;
        final boolean hasHit;
        final float radiusPreview;
        final float calDistPreview;
        final boolean[] sectorsSnapshot = new boolean[SECTOR_COUNT];
        final int covered;
        final int ptsCount;
        final long nowMs = System.currentTimeMillis();
        final boolean showSlowWarning;
        final boolean showAimWarning;

        synchronized (stateLock) {
            if (!ignoreFinishing && finishing) {
                return;
            }
            step = currentStep;
            isTracking = lastTrackingState == TrackingState.TRACKING;
            hasHit = latestTargetHit != null;
            radiusPreview = liveMeasuredRadiusM;
            calDistPreview = liveCalDistanceM;
            System.arraycopy(visitedSectors, 0, sectorsSnapshot, 0, SECTOR_COUNT);
            covered = sectorsCovered;
            ptsCount = voxelGrid.size();
            showSlowWarning = (nowMs - lastBlurWarningAtMs) < 1800L;
            showAimWarning = (nowMs - lastTargetPromptAtMs) < 1800L || !isTracking;
        }

        switch (step) {
            case STEP_CENTER:
                stepTitleText.setText("1/3 · APUNTA AL CENTRO DEL ACOPIO");
                liveMetricText.setVisibility(View.GONE);
                sectorBlocksRow.setVisibility(View.GONE);
                crosshairView.setAccentColor(hasHit ? COLOR_CYAN : COLOR_COPPER);
                primaryActionButton.setEnabled(true);
                primaryActionButton.setText("MARCAR CENTRO");
                primaryActionButton.setBackgroundColor(COLOR_COPPER);
                primaryActionButton.setTextColor(Color.BLACK);
                showExceptionIfAny(showAimWarning ? "APUNTA AL ACOPIO" : null);
                break;

            case STEP_EDGE:
                stepTitleText.setText("2/3 · APUNTA AL BORDE DEL ACOPIO");
                liveMetricText.setVisibility(View.VISIBLE);
                liveMetricText.setText(
                    radiusPreview > 0.0f
                        ? String.format(Locale.US, "RADIO: %.2f m", clamp(radiusPreview, MIN_ROI_RADIUS_M, MAX_ROI_RADIUS_M))
                        : "RADIO: --.-- m"
                );
                liveMetricText.setTextColor(radiusPreview > 0.0f ? COLOR_CYAN : COLOR_WHITE);
                sectorBlocksRow.setVisibility(View.GONE);
                crosshairView.setAccentColor(hasHit ? COLOR_CYAN : COLOR_COPPER);
                primaryActionButton.setEnabled(true);
                primaryActionButton.setText("MARCAR BORDE");
                primaryActionButton.setBackgroundColor(COLOR_COPPER);
                primaryActionButton.setTextColor(Color.BLACK);
                showExceptionIfAny(showAimWarning ? "APUNTA AL ACOPIO" : null);
                break;

            case STEP_WALK:
                stepTitleText.setText("3/3 · CAMINA ALREDEDOR DESPACIO");
                liveMetricText.setVisibility(View.GONE);
                sectorBlocksRow.setVisibility(View.VISIBLE);
                for (int i = 0; i < SECTOR_COUNT; i++) {
                    sectorBlocks[i].setBackgroundColor(sectorsSnapshot[i] ? COLOR_CYAN : COLOR_GRAY_IDLE);
                }
                crosshairView.setAccentColor(isTracking ? COLOR_WHITE : COLOR_COPPER);

                final boolean canFinish = (covered >= 5) || (covered >= 3 && ptsCount >= 120);
                final boolean optimalCoverage = covered >= 6;
                primaryActionButton.setEnabled(canFinish);
                primaryActionButton.setText("TERMINAR MEDICIÓN");
                if (!canFinish) {
                    primaryActionButton.setBackgroundColor(COLOR_GRAY_IDLE);
                    primaryActionButton.setTextColor(COLOR_MUTED);
                } else {
                    primaryActionButton.setBackgroundColor(optimalCoverage ? COLOR_CYAN : COLOR_COPPER);
                    primaryActionButton.setTextColor(Color.BLACK);
                }

                if (showSlowWarning) {
                    showExceptionIfAny("MUÉVETE MÁS LENTO");
                } else if (!isTracking) {
                    showExceptionIfAny("APUNTA AL ACOPIO");
                } else {
                    showExceptionIfAny(null);
                }
                break;

            case CAL_FLOOR:
                stepTitleText.setText("1/3 · APUNTA AL SUELO PLANO SIN MOVERTE");
                liveMetricText.setVisibility(View.GONE);
                sectorBlocksRow.setVisibility(View.GONE);
                crosshairView.setAccentColor(isTracking ? COLOR_CYAN : COLOR_COPPER);
                primaryActionButton.setEnabled(false);
                primaryActionButton.setText("ANALIZANDO SUELO...");
                primaryActionButton.setBackgroundColor(COLOR_GRAY_IDLE);
                primaryActionButton.setTextColor(COLOR_WHITE);
                showExceptionIfAny(!isTracking ? "APUNTA AL SUELO PLANO" : null);
                break;

            case CAL_FLOOR_ERROR:
                stepTitleText.setText("1/3 · APUNTA AL SUELO PLANO SIN MOVERTE");
                liveMetricText.setVisibility(View.GONE);
                sectorBlocksRow.setVisibility(View.GONE);
                crosshairView.setAccentColor(COLOR_COPPER);
                primaryActionButton.setEnabled(true);
                primaryActionButton.setText("REINTENTAR");
                primaryActionButton.setBackgroundColor(COLOR_COPPER);
                primaryActionButton.setTextColor(Color.BLACK);
                showExceptionIfAny("LENTE SUCIO O POCA LUZ");
                break;

            case CAL_START:
                stepTitleText.setText("2/3 · APUNTA AL 0.00 m DE LA HUINCHA");
                liveMetricText.setVisibility(View.GONE);
                sectorBlocksRow.setVisibility(View.GONE);
                crosshairView.setAccentColor(hasHit ? COLOR_CYAN : COLOR_COPPER);
                primaryActionButton.setEnabled(true);
                primaryActionButton.setText("MARCAR 0.00 m");
                primaryActionButton.setBackgroundColor(COLOR_COPPER);
                primaryActionButton.setTextColor(Color.BLACK);
                showExceptionIfAny(showAimWarning ? "APUNTA AL SUELO" : null);
                break;

            case CAL_END:
                stepTitleText.setText("3/3 · APUNTA A LOS 2.00 m DE LA HUINCHA");
                liveMetricText.setVisibility(View.VISIBLE);
                liveMetricText.setText(
                    calDistPreview > 0.0f
                        ? String.format(Locale.US, "DISTANCIA: %.2f m", calDistPreview)
                        : "DISTANCIA: --.-- m"
                );
                liveMetricText.setTextColor(calDistPreview > 0.0f ? COLOR_CYAN : COLOR_WHITE);
                sectorBlocksRow.setVisibility(View.GONE);
                crosshairView.setAccentColor(hasHit ? COLOR_CYAN : COLOR_COPPER);
                primaryActionButton.setEnabled(true);
                primaryActionButton.setText("MARCAR 2.00 m");
                primaryActionButton.setBackgroundColor(COLOR_COPPER);
                primaryActionButton.setTextColor(Color.BLACK);
                showExceptionIfAny(showAimWarning ? "APUNTA AL SUELO" : null);
                break;

            case CAL_RANGE_ERROR:
                stepTitleText.setText("3/3 · APUNTA A LOS 2.00 m DE LA HUINCHA");
                liveMetricText.setVisibility(View.GONE);
                sectorBlocksRow.setVisibility(View.GONE);
                crosshairView.setAccentColor(COLOR_COPPER);
                primaryActionButton.setEnabled(true);
                primaryActionButton.setText("REINTENTAR");
                primaryActionButton.setBackgroundColor(COLOR_COPPER);
                primaryActionButton.setTextColor(Color.BLACK);
                showExceptionIfAny("DISTANCIA FUERA DE RANGO — REPITE LOS 2 PUNTOS");
                break;
        }
    }

    private void showExceptionIfAny(final String message) {
        if (message == null || message.isEmpty()) {
            exceptionBannerText.setVisibility(View.GONE);
        } else {
            exceptionBannerText.setText(message);
            exceptionBannerText.setVisibility(View.VISIBLE);
        }
    }

    private void triggerShortHaptic() {
        if (rootView != null) {
            rootView.performHapticFeedback(
                HapticFeedbackConstants.VIRTUAL_KEY,
                HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING
            );
        }
    }

    private void triggerDoubleHaptic() {
        triggerShortHaptic();
        mainHandler.postDelayed(this::triggerShortHaptic, 110L);
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

    private static float clamp(final float val, final float minVal, final float maxVal) {
        return Math.max(minVal, Math.min(maxVal, val));
    }

    private static float dist3D(final float[] a, final float[] b) {
        final float dx = b[0] - a[0];
        final float dy = b[1] - a[1];
        final float dz = b[2] - a[2];
        return (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
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

    private static double round2(final double val) {
        return Math.round(val * 100.0) / 100.0;
    }

    private static double round3(final double val) {
        return Math.round(val * 1000.0) / 1000.0;
    }

    private static double round4(final double val) {
        return Math.round(val * 10000.0) / 10000.0;
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
}
