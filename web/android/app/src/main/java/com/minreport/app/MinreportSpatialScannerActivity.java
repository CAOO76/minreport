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
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.YuvImage;
import android.graphics.drawable.GradientDrawable;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.Image;
import android.opengl.GLSurfaceView;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.content.res.ResourcesCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
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
import com.google.ar.core.TrackingFailureReason;
import com.google.ar.core.TrackingState;
import com.google.ar.core.exceptions.CameraNotAvailableException;
import com.google.ar.core.exceptions.NotYetAvailableException;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.FloatBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Full-screen Landscape Golden-Ratio (61.8% 4:3 camera + 38.2% #000000 rail) ARCore VIO + MVS
 * scanner activity for MINREPORT · ACOPIOS:
 * - SCAN mode: 1-button continuous walkaround (READY_TRACKING -> CAPTURING_WALK), 16-32 unrotated
 *   WebP keyframes with SE(3) poses & intrinsics, live GLES 2.0 3D recognition overlay, and
 *   pure-Java offline in-situ metrology (WalkRingToeSolver + OfflineVioMvsEngine).
 * - CALIBRATE mode: optional 2.00 m flat-floor diagnostic scale verification.
 */
public class MinreportSpatialScannerActivity
    extends AppCompatActivity
    implements ArCoreCameraRenderer.FrameListener, SensorEventListener {

    public static final String EXTRA_RESULT_FILE_PATH = "minreport_spatial_scan_result_file";
    public static final String EXTRA_SCAN_MODE = "minreport_spatial_scan_mode";
    public static final String EXTRA_ERROR_CODE = "minreport_spatial_scan_error_code";
    public static final String EXTRA_ERROR_MESSAGE = "minreport_spatial_scan_error_message";
    public static final String MODE_SCAN = "SCAN";
    public static final String MODE_CALIBRATE = "CALIBRATE";
    public static final String PREFS_CALIBRATION_NAME = "minreport_spatial_calibration";

    private static final String TAG = "MinreportSpatialScanner";
    private static final String SCANNER_ENGINE_VERSION = "2.0.3-vio-mvs-java";
    private static final int KEYCODE_XCOVER_KEY = 1015;
    private static final int KEYCODE_XCOVER_TOP_KEY = 1079;

    private static final int SECTOR_COUNT = WalkRingToeSolver.SECTOR_COUNT; // 16 x 22.5 deg
    private static final int MAX_KEYFRAME_PHOTOS = 32;
    private static final int MAX_PHOTO_DIMENSION_PX = 1280;
    private static final int WEBP_QUALITY = 76;
    private static final int MVS_LUMA_W = 320;
    private static final int MVS_LUMA_H = 240;
    private static final int MAX_GROUND_SAMPLES = 600;
    private static final int MAX_EXTRA_VIO_POINTS = 2400;
    private static final float MIN_WALK_POSE_STEP_M = 0.25f;
    private static final float MIN_KF_STEP_M = 0.40f;
    private static final float MAX_KF_STEP_M = 1.30f;
    private static final float MIN_KF_YAW_DEG = 12.0f;
    private static final float GYRO_EMA_ALPHA = 0.25f;
    private static final float SPEED_ALERT_GYRO_RAD_S = 0.75f;
    private static final float MAX_CAPTURE_GYRO_RAD_S = 1.85f;
    private static final float LIVE_VISUAL_POINT_MIN_CONF = 0.1f;
    private static final int LIVE_VISUAL_POINTS_PER_FRAME = 180;
    private static final long CAPTURE_FLASH_DURATION_MS = 120L;
    private static final float LOCAL_GROUND_CLEARANCE_M = 0.55f;

    private static final float MIN_DEPTH_M = 0.25f;
    private static final float MAX_DEPTH_M = 35.0f;
    private static final long CAL_FLOOR_DURATION_MS = 3000L;
    private static final float MAX_CAL_FLOOR_NOISE_RMS_M = 0.035f;
    private static final float CAL_REFERENCE_DISTANCE_M = 2.0f;
    private static final float MIN_CAL_DISTANCE_M = 0.1f;
    private static final float MIN_SCALE_FACTOR = 0.85f;
    private static final float MAX_SCALE_FACTOR = 1.15f;

    // MINREPORT ANSI/ISA-101 Palette (>= 85% neutral monochrome)
    private static final int COLOR_BG = 0xFF000000;
    private static final int COLOR_BORDER = 0xFF12151C;
    private static final int COLOR_BTN_WAITING_BG = 0xFF1E2430;
    private static final int COLOR_BTN_RECORDING_BG = 0xFF14100D;
    private static final int COLOR_GRAY_IDLE = 0xFF2A2F3A;
    private static final int COLOR_CYAN = 0xFF00AEEF;
    private static final int COLOR_COPPER = 0xFFC68346;
    private static final int COLOR_PRIMARY = 0xFFF3F4F6;
    private static final int COLOR_SECONDARY = 0xFF8A93A6;
    private static final int COLOR_DISABLED = 0xFF5A6072;

    private enum FlowStep {
        READY_TRACKING,
        CAPTURING_WALK,
        FINALIZING,
        CAL_FLOOR,
        CAL_FLOOR_ERROR,
        CAL_START,
        CAL_END,
        CAL_RANGE_ERROR
    }

    private static final class KeyframeRecord {
        final int index;
        final double angleDeg;
        final double blurScore;
        final String photoPath;
        final int displayRotationDeg;
        final long timestampNs;
        final float imuPitchDeg;
        final float imuRollDeg;
        final float[] rWc; // 9 row-major
        final float[] tWc; // 3
        final float fx;
        final float fy;
        final float cx;
        final float cy;
        final int imgWidth;
        final int imgHeight;
        final int originalBytes;
        volatile int optimizedBytes;
        volatile double savingsPct;
        volatile String sha256;

        KeyframeRecord(
            final int index,
            final double angleDeg,
            final double blurScore,
            final String photoPath,
            final int displayRotationDeg,
            final long timestampNs,
            final float imuPitchDeg,
            final float imuRollDeg,
            final float[] rWc,
            final float[] tWc,
            final float fx,
            final float fy,
            final float cx,
            final float cy,
            final int imgWidth,
            final int imgHeight,
            final int originalBytes
        ) {
            this.index = index;
            this.angleDeg = angleDeg;
            this.blurScore = blurScore;
            this.photoPath = photoPath;
            this.displayRotationDeg = displayRotationDeg;
            this.timestampNs = timestampNs;
            this.imuPitchDeg = imuPitchDeg;
            this.imuRollDeg = imuRollDeg;
            this.rWc = Arrays.copyOf(rWc, 9);
            this.tWc = Arrays.copyOf(tWc, 3);
            this.fx = fx;
            this.fy = fy;
            this.cx = cx;
            this.cy = cy;
            this.imgWidth = imgWidth;
            this.imgHeight = imgHeight;
            this.originalBytes = originalBytes;
        }
    }

    /**
     * 16-segment minimal 360-degree perimeter ring (strokeCap=BUTT, 0px corners, ANSI/ISA-101).
     */
    private static final class PerimeterRing360View extends View {
        private final Paint arcPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint dotPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF arcBounds = new RectF();
        private final int[] sectorStates = new int[SECTOR_COUNT]; // 0=idle, 1=gap/copper, 2=verified/cyan
        private float headingAngleDeg = 0.0f;
        private boolean showHeading = false;
        private int coveragePctInt = 0;
        private boolean readyHighlight = false;
        private String centerLabelOverride = null;
        private final float maxCenterTextPx;

        PerimeterRing360View(final Context context, final Typeface monoBold) {
            super(context);
            arcPaint.setStyle(Paint.Style.STROKE);
            arcPaint.setStrokeCap(Paint.Cap.BUTT);
            arcPaint.setStrokeWidth(dpStatic(context, 6));

            dotPaint.setStyle(Paint.Style.FILL);
            dotPaint.setColor(COLOR_PRIMARY);

            maxCenterTextPx = TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_SP, 24, context.getResources().getDisplayMetrics()
            );
            textPaint.setTypeface(monoBold);
            textPaint.setTextAlign(Paint.Align.CENTER);
            textPaint.setTextSize(maxCenterTextPx);
            textPaint.setColor(COLOR_PRIMARY);
        }

        void updateState(
            final int[] states,
            final float headingDeg,
            final boolean showHead,
            final int pctInt,
            final boolean isReady,
            final String labelOverride
        ) {
            System.arraycopy(states, 0, this.sectorStates, 0, SECTOR_COUNT);
            this.headingAngleDeg = headingDeg;
            this.showHeading = showHead;
            this.coveragePctInt = pctInt;
            this.readyHighlight = isReady;
            this.centerLabelOverride = labelOverride;
            invalidate();
        }

        @Override
        protected void onDraw(final Canvas canvas) {
            super.onDraw(canvas);
            final float size = Math.min(getWidth(), getHeight());
            final float pad = arcPaint.getStrokeWidth() + 8.0f;
            final float cx = getWidth() * 0.5f;
            final float cy = getHeight() * 0.5f;
            final float r = Math.max(20.0f, size * 0.5f - pad);
            arcBounds.set(cx - r, cy - r, cx + r, cy + r);

            final float sweepTotal = 360.0f / SECTOR_COUNT;
            final float gap = 2.5f;
            for (int i = 0; i < SECTOR_COUNT; i++) {
                final int st = sectorStates[i];
                if (st == 2) {
                    arcPaint.setColor(COLOR_CYAN);
                } else if (st == 1) {
                    arcPaint.setColor(COLOR_COPPER);
                } else {
                    arcPaint.setColor(COLOR_GRAY_IDLE);
                }
                final float startAngle = -90.0f + i * sweepTotal + gap * 0.5f;
                canvas.drawArc(arcBounds, startAngle, sweepTotal - gap, false, arcPaint);
            }

            if (showHeading) {
                final double rad = Math.toRadians(headingAngleDeg - 90.0);
                final float dx = cx + (float) (Math.cos(rad) * r);
                final float dy = cy + (float) (Math.sin(rad) * r);
                canvas.drawRect(dx - 5.0f, dy - 5.0f, dx + 5.0f, dy + 5.0f, dotPaint);
            }

            final float fittedTextPx = Math.min(maxCenterTextPx, Math.max(12.0f, size * 0.23f));
            textPaint.setTextSize(fittedTextPx);
            final String label = centerLabelOverride != null ? centerLabelOverride : (coveragePctInt + "%");
            textPaint.setColor(
                centerLabelOverride != null
                    ? COLOR_SECONDARY
                    : (readyHighlight ? COLOR_CYAN : COLOR_PRIMARY)
            );
            final Paint.FontMetrics fm = textPaint.getFontMetrics();
            final float textY = cy - (fm.ascent + fm.descent) * 0.5f;
            canvas.drawText(label, cx, textY, textPaint);
        }

        private static float dpStatic(final Context ctx, final int dpVal) {
            return TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, dpVal, ctx.getResources().getDisplayMetrics()
            );
        }
    }

    /**
     * Minimal Leica Captivate Micro-Horizon ticks on left/right edges of the 4:3 camera viewport.
     */
    private static final class ImuHorizonView extends View {
        private final Paint tickPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int tickColor = 0x668A93A6;
        private float rollDeg = 0.0f;

        ImuHorizonView(final Context context) {
            super(context);
            tickPaint.setStyle(Paint.Style.STROKE);
            tickPaint.setStrokeWidth(3.0f);
            tickPaint.setColor(tickColor);
        }

        void updateImu(final float pitchDeg, final float rollDeg) {
            this.rollDeg = rollDeg;
            if (Math.abs(rollDeg) > 15.0f || pitchDeg > 0.0f) {
                tickColor = COLOR_COPPER;
            } else if (Math.abs(rollDeg) <= 8.0f && pitchDeg >= -30.0f && pitchDeg <= -10.0f) {
                tickColor = COLOR_CYAN;
            } else {
                tickColor = 0x668A93A6;
            }
            tickPaint.setColor(tickColor);
            invalidate();
        }

        @Override
        protected void onDraw(final Canvas canvas) {
            super.onDraw(canvas);
            final float w = getWidth();
            final float h = getHeight();
            final float cy = h * 0.5f;
            final float tickLen = 32.0f;
            final float offset = Math.max(-40.0f, Math.min(40.0f, rollDeg * 1.5f));
            canvas.drawLine(12.0f, cy - offset, 12.0f + tickLen, cy - offset, tickPaint);
            canvas.drawLine(w - 12.0f - tickLen, cy + offset, w - 12.0f, cy + offset, tickPaint);
        }
    }

    /**
     * Calibration-only crosshair overlay.
     */
    private static final class CrosshairOverlayView extends View {
        private final Paint shadowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint linePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int accentColor = COLOR_PRIMARY;

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
            final float arm = Math.min(getWidth(), getHeight()) * 0.36f;
            final float gap = Math.min(getWidth(), getHeight()) * 0.12f;
            drawArms(canvas, cx, cy, arm, gap, shadowPaint);
            drawArms(canvas, cx, cy, arm, gap, linePaint);
        }

        private static void drawArms(
            final Canvas c,
            final float cx,
            final float cy,
            final float arm,
            final float gap,
            final Paint p
        ) {
            c.drawLine(cx - arm, cy, cx - gap, cy, p);
            c.drawLine(cx + gap, cy, cx + arm, cy, p);
            c.drawLine(cx, cy - arm, cx, cy - gap, p);
            c.drawLine(cx, cy + gap, cx, cy + arm, p);
        }
    }

    private GLSurfaceView glSurfaceView;
    private ArCoreCameraRenderer renderer;
    private Session session;
    private boolean installRequested = false;
    private boolean hasHardwareDepthSensor = false;

    private SensorManager sensorManager;
    private Sensor gyroSensor;
    private Sensor gravitySensor;
    private volatile float liveGyroNormRadS = 0.0f;
    private volatile float liveImuPitchDeg = -18.0f;
    private volatile float liveImuRollDeg = 0.0f;

    private Typeface fontMonoBold;
    private Typeface fontMonoRegular;
    private Typeface fontNextBold;

    private View rootView;
    private FrameLayout cameraContainer;
    private ImuHorizonView imuHorizonView;
    private CrosshairOverlayView calCrosshairView;
    private View crownBorderLine;
    private ImageView crownGuardIcon;
    private View toeBorderLine;
    private ImageView toeGuardIcon;
    private View captureFlashBorderView;
    private final Runnable hideCaptureFlashRunnable = () -> {
        if (captureFlashBorderView != null) {
            captureFlashBorderView.setVisibility(View.GONE);
        }
    };

    // Right rail HUD widgets (zero prose)
    private ImageButton closeButton;
    private TextView trackingCodeText;
    private ImageView trackingIcon;
    private ImageView speedAlertIcon;
    private ImageView anchorDetectedIcon;
    private PerimeterRing360View perimeterRingView;
    private TextView liveVolumeText;
    private TextView liveDimsText;
    private TextView liveKfCountText;
    private TextView hudBuildHeartbeatText;
    private ProgressBar finalizingBar;
    private ImageButton primaryActionButton;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ExecutorService ioExecutor;
    private ExecutorService visionExecutor;
    private int rearSensorOrientation = 90;

    private final Object stateLock = new Object();
    private String mode = MODE_SCAN;
    private FlowStep currentStep = FlowStep.READY_TRACKING;
    private String scanId;
    private String configuredDepthMode = "VIO_MVS_OFFLINE";
    private boolean finishing = false;
    private boolean pendingStartCapture = false;

    private TrackingState lastTrackingState = TrackingState.PAUSED;
    private TrackingFailureReason lastTrackingFailureReason = TrackingFailureReason.NONE;
    private final OfflineVioMvsEngine offlineEngine = new OfflineVioMvsEngine();
    private final List<WalkRingToeSolver.WalkPose> walkRingPoses = new ArrayList<>(256);
    private final List<KeyframeRecord> savedKeyframes = new ArrayList<>(MAX_KEYFRAME_PHOTOS);
    private final Map<Long, float[]> groundSampleGrid = new HashMap<>();
    private final List<float[]> extraVioCloud = new ArrayList<>(1024);
    private final CapturePipelineHelper.LivePointCloudAccumulator livePointAccumulator =
        new CapturePipelineHelper.LivePointCloudAccumulator(Live3DOverlayRenderer.MAX_LIVE_POINTS);

    private volatile long arFrameCounter = 0L;
    private volatile String lastRenderErrorCode = null;
    private volatile long lastRenderErrorAtMs = 0L;
    private volatile long lastMinKfHintAtMs = 0L;
    private float walkDistanceM = 0.0f;
    private long lastTrackingSeenAtMs = 0L;

    private final int[] sectorStates = new int[SECTOR_COUNT];
    private final int[] sectorKfCounts = new int[SECTOR_COUNT];
    private int sectorsCovered = 0;
    private float[] lastSectorCenterXZ = null;
    private float liveHeadingDeg = 0.0f;
    private float liveEstDiameterM = 0.0f;
    private float liveEstHeightM = 0.0f;
    private float liveEstVolumeM3 = 0.0f;
    private boolean hasScaleAnchor = false;
    private boolean readyHapticFired = false;
    private int rejectedBlurCount = 0;

    private float[] lastWalkPosePos = null;
    private float[] lastKfPos = null;
    private float[] lastKfFwdXZ = null;
    private long lastSpeedAlertAtMs = 0L;
    private long lastGroundSampleAtMs = 0L;
    private long lastVioPointCloudAtMs = 0L;
    private long lastUiUpdateAtMs = 0L;
    private long lastLiveOverlaySolveAtMs = 0L;
    private final AtomicBoolean liveOverlayBusy = new AtomicBoolean(false);

    // Atomic Best-of-Burst capture state machine (anti-deadlock + MediaTek GL fallback)
    private final CapturePipelineHelper.BurstCaptureState burstState =
        new CapturePipelineHelper.BurstCaptureState();

    // Optional calibration state
    private float[] latestCalHit = null;
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
        loadMinreportTypefaces();

        final String requestedMode = getIntent() != null ? getIntent().getStringExtra(EXTRA_SCAN_MODE) : null;
        this.mode = MODE_CALIBRATE.equals(requestedMode) ? MODE_CALIBRATE : MODE_SCAN;
        this.currentStep = MODE_CALIBRATE.equals(this.mode) ? FlowStep.CAL_FLOOR : FlowStep.READY_TRACKING;
        this.scanId = "scan-" + System.currentTimeMillis();
        this.ioExecutor = Executors.newSingleThreadExecutor();
        this.visionExecutor = Executors.newSingleThreadExecutor();
        this.rearSensorOrientation = resolveRearCameraSensorOrientation();
        this.hasHardwareDepthSensor = MinreportDeviceCapabilityPlugin.detectRearHardwareDepthSensor(this);

        this.sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (this.sensorManager != null) {
            this.gyroSensor = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
            this.gravitySensor = sensorManager.getDefaultSensor(Sensor.TYPE_GRAVITY);
            if (this.gravitySensor == null) {
                this.gravitySensor = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            }
        }

        buildLandscapeGoldenHudLayout();

        this.renderer = new ArCoreCameraRenderer(this, this);
        this.glSurfaceView.setEGLContextClientVersion(2);
        this.glSurfaceView.setPreserveEGLContextOnPause(true);
        this.glSurfaceView.setRenderer(this.renderer);
        this.glSurfaceView.setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
    }

    private void loadMinreportTypefaces() {
        try {
            fontMonoBold = ResourcesCompat.getFont(this, R.font.atkinson_hyperlegible_mono_bold);
            fontMonoRegular = ResourcesCompat.getFont(this, R.font.atkinson_hyperlegible_mono_regular);
            fontNextBold = ResourcesCompat.getFont(this, R.font.atkinson_hyperlegible_next_bold);
        } catch (Exception ignored) {
        }
        if (fontMonoBold == null) fontMonoBold = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD);
        if (fontMonoRegular == null) fontMonoRegular = Typeface.MONOSPACE;
        if (fontNextBold == null) fontNextBold = Typeface.DEFAULT_BOLD;
    }

    @Override
    protected void onResume() {
        super.onResume();
        configureSystemBars();

        if (
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            finishWithError("CAMERA_PERMISSION_DENIED", "Camera permission is required for spatial scanning");
            return;
        }

        if (sensorManager != null) {
            if (gyroSensor != null) {
                sensorManager.registerListener(this, gyroSensor, SensorManager.SENSOR_DELAY_GAME);
            }
            if (gravitySensor != null) {
                sensorManager.registerListener(this, gravitySensor, SensorManager.SENSOR_DELAY_UI);
            }
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
            } catch (Exception e) {
                Log.e(TAG, "Failed to initialize ARCore session", e);
                finishWithError(
                    "ARCORE_SESSION_INIT_FAILED",
                    e.getMessage() != null ? e.getMessage() : "ARCore session initialization failed"
                );
                return;
            }
        }

        try {
            session.resume();
        } catch (CameraNotAvailableException e) {
            Log.e(TAG, "Camera unavailable while resuming ARCore session", e);
            finishWithError(
                "CAMERA_NOT_AVAILABLE",
                e.getMessage() != null ? e.getMessage() : "Camera not available for ARCore session"
            );
            return;
        } catch (Exception e) {
            Log.e(TAG, "Unexpected failure resuming ARCore session", e);
            finishWithError(
                "ARCORE_SESSION_RESUME_FAILED",
                e.getMessage() != null ? e.getMessage() : "ARCore session resume failed"
            );
            return;
        }

        // Expose session to GLThread strictly AFTER session.resume() and BEFORE glSurfaceView.onResume()
        renderer.setSession(session);
        glSurfaceView.onResume();
        renderer.onResume();
        updateHudFromState(true);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (sensorManager != null) {
            sensorManager.unregisterListener(this);
        }
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
        if (glSurfaceView != null && renderer != null) {
            glSurfaceView.queueEvent(() -> renderer.releaseGlResources());
        }
        if (session != null) {
            try {
                session.close();
            } catch (Exception ignored) {
            }
            session = null;
        }
        if (ioExecutor != null) {
            ioExecutor.shutdownNow();
            ioExecutor = null;
        }
        if (visionExecutor != null) {
            visionExecutor.shutdownNow();
            visionExecutor = null;
        }
    }

    @Override
    public void onSensorChanged(final SensorEvent event) {
        if (event == null || event.values == null || event.values.length < 3) {
            return;
        }
        final int type = event.sensor.getType();
        if (type == Sensor.TYPE_GYROSCOPE) {
            final float gx = event.values[0];
            final float gy = event.values[1];
            final float gz = event.values[2];
            final float rawNorm = (float) Math.sqrt(gx * gx + gy * gy + gz * gz);
            final float prev = liveGyroNormRadS;
            liveGyroNormRadS = prev <= 0.0f
                ? rawNorm
                : (GYRO_EMA_ALPHA * rawNorm + (1.0f - GYRO_EMA_ALPHA) * prev);
        } else if (type == Sensor.TYPE_GRAVITY || type == Sensor.TYPE_ACCELEROMETER) {
            // In landscape orientation, device local Y/X aligns with horizon; compensate ROTATION_270 sign flip
            final float ax = event.values[0];
            final float ay = event.values[1];
            final float az = event.values[2];
            final float norm = (float) Math.sqrt(ax * ax + ay * ay + az * az);
            if (norm > 1.0f) {
                final int displayRotDeg = renderer != null ? renderer.getDisplayRotationDegrees() : 90;
                final float signedAy = displayRotDeg == 270 ? -ay : ay;
                final float pitchRad = (float) Math.asin(clamp(-az / norm, -1.0f, 1.0f));
                final float rollRad = (float) Math.atan2(signedAy, Math.abs(ax) + 0.001f);
                liveImuPitchDeg = (float) Math.toDegrees(pitchRad);
                liveImuRollDeg = (float) Math.toDegrees(rollRad);
            }
        }
    }

    @Override
    public void onAccuracyChanged(final Sensor sensor, final int accuracy) {}

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
    public void onWindowFocusChanged(final boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            configureSystemBars();
        }
    }

    private void configureSystemBars() {
        final Window window = getWindow();
        if (window != null) {
            WindowCompat.setDecorFitsSystemWindows(window, false);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                final WindowManager.LayoutParams lp = window.getAttributes();
                lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                window.setAttributes(lp);
            }
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.BLACK);
            window.setNavigationBarColor(Color.BLACK);
            final WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
            if (controller != null) {
                controller.setAppearanceLightStatusBars(false);
                controller.setAppearanceLightNavigationBars(false);
                controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
                controller.hide(WindowInsetsCompat.Type.systemBars());
            }
        }
    }

    private void configureArSession(final Session targetSession) {
        final Config config = new Config(targetSession);
        config.setFocusMode(Config.FocusMode.AUTO);
        // BLOCKING 30 Hz camera-synced rendering (eliminates redundant 60 fps thermal spin)
        config.setUpdateMode(Config.UpdateMode.BLOCKING);
        config.setPlaneFindingMode(Config.PlaneFindingMode.HORIZONTAL);

        // Per Red-Team verdict: DepthMode.DISABLED on non-ToF/LiDAR hardware (XCover 7)
        if (hasHardwareDepthSensor && targetSession.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) {
            config.setDepthMode(Config.DepthMode.AUTOMATIC);
            configuredDepthMode = "HARDWARE_TOF_DEPTH";
        } else {
            config.setDepthMode(Config.DepthMode.DISABLED);
            configuredDepthMode = "VIO_MVS_OFFLINE";
        }
        targetSession.configure(config);
    }

    /**
     * Golden-Ratio Landscape Split (Phi = 61.8% 4:3 camera viewport left + 38.2% #000000 rail right).
     * Zero prose, Atkinson Hyperlegible Mono, Material Symbols Outlined VectorDrawables, 0dp corners.
     */
    private void buildLandscapeGoldenHudLayout() {
        final LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.HORIZONTAL);
        root.setBackgroundColor(COLOR_BG);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            final Insets cutout = windowInsets.getInsets(WindowInsetsCompat.Type.displayCutout());
            v.setPadding(cutout.left, cutout.top, cutout.right, cutout.bottom);
            return windowInsets;
        });
        this.rootView = root;

        // Left 61.8% (Golden Ratio major): 4:3 uncropped camera viewport + Dark Cockpit exception overlays
        this.cameraContainer = new FrameLayout(this);
        this.cameraContainer.setBackgroundColor(COLOR_BG);

        this.glSurfaceView = new GLSurfaceView(this);
        this.cameraContainer.addView(
            this.glSurfaceView,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );

        this.imuHorizonView = new ImuHorizonView(this);
        this.cameraContainer.addView(
            this.imuHorizonView,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );

        this.calCrosshairView = new CrosshairOverlayView(this);
        final FrameLayout.LayoutParams crossParams = new FrameLayout.LayoutParams(dp(72), dp(72));
        crossParams.gravity = Gravity.CENTER;
        this.calCrosshairView.setVisibility(MODE_CALIBRATE.equals(mode) ? View.VISIBLE : View.GONE);
        this.cameraContainer.addView(this.calCrosshairView, crossParams);

        // Crown Guard (top 3px copper line + upward arrow icon, invisible in nominal)
        this.crownBorderLine = new View(this);
        this.crownBorderLine.setBackgroundColor(COLOR_COPPER);
        this.crownBorderLine.setVisibility(View.GONE);
        final FrameLayout.LayoutParams crownLineParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(3)
        );
        crownLineParams.gravity = Gravity.TOP;
        this.cameraContainer.addView(this.crownBorderLine, crownLineParams);

        this.crownGuardIcon = createIconView(R.drawable.ic_ms_arrow_upward, COLOR_COPPER, dp(4));
        this.crownGuardIcon.setVisibility(View.GONE);
        final FrameLayout.LayoutParams crownIconParams = new FrameLayout.LayoutParams(dp(36), dp(36));
        crownIconParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        crownIconParams.topMargin = dp(8);
        this.cameraContainer.addView(this.crownGuardIcon, crownIconParams);

        // Toe Guard (bottom 3px copper line + downward arrow icon, invisible in nominal)
        this.toeBorderLine = new View(this);
        this.toeBorderLine.setBackgroundColor(COLOR_COPPER);
        this.toeBorderLine.setVisibility(View.GONE);
        final FrameLayout.LayoutParams toeLineParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(3)
        );
        toeLineParams.gravity = Gravity.BOTTOM;
        this.cameraContainer.addView(this.toeBorderLine, toeLineParams);

        this.toeGuardIcon = createIconView(R.drawable.ic_ms_arrow_downward, COLOR_COPPER, dp(4));
        this.toeGuardIcon.setVisibility(View.GONE);
        final FrameLayout.LayoutParams toeIconParams = new FrameLayout.LayoutParams(dp(36), dp(36));
        toeIconParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        toeIconParams.bottomMargin = dp(8);
        this.cameraContainer.addView(this.toeGuardIcon, toeIconParams);

        // Cyan 2dp hairline flash border around 4:3 viewport on each keyframe commit (120 ms)
        this.captureFlashBorderView = new View(this);
        final GradientDrawable flashStroke = new GradientDrawable();
        flashStroke.setShape(GradientDrawable.RECTANGLE);
        flashStroke.setCornerRadius(0.0f);
        flashStroke.setColor(Color.TRANSPARENT);
        flashStroke.setStroke(dp(2), COLOR_CYAN);
        this.captureFlashBorderView.setBackground(flashStroke);
        this.captureFlashBorderView.setClickable(false);
        this.captureFlashBorderView.setFocusable(false);
        this.captureFlashBorderView.setVisibility(View.GONE);
        this.cameraContainer.addView(
            this.captureFlashBorderView,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );

        root.addView(
            this.cameraContainer,
            new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 61.8f)
        );

        // 1px hairline border separating camera and right rail
        final View divider = new View(this);
        divider.setBackgroundColor(COLOR_BORDER);
        root.addView(divider, new LinearLayout.LayoutParams(dp(1), ViewGroup.LayoutParams.MATCH_PARENT));

        // Right 38.2% (Golden Ratio minor): #000000 zero-prose control rail (compact XCover 7 budget)
        final LinearLayout rightRail = new LinearLayout(this);
        rightRail.setOrientation(LinearLayout.VERTICAL);
        rightRail.setBackgroundColor(COLOR_BG);
        rightRail.setPadding(dp(13), dp(8), dp(13), dp(8));

        // 1. Top strip (48dp): close (48x48dp) + exception-only status indicators
        final LinearLayout topStrip = new LinearLayout(this);
        topStrip.setOrientation(LinearLayout.HORIZONTAL);
        topStrip.setGravity(Gravity.CENTER_VERTICAL);

        this.closeButton = new ImageButton(this);
        this.closeButton.setImageResource(R.drawable.ic_ms_close);
        this.closeButton.setColorFilter(COLOR_PRIMARY);
        this.closeButton.setBackgroundColor(Color.TRANSPARENT);
        this.closeButton.setScaleType(ImageView.ScaleType.FIT_CENTER);
        this.closeButton.setPadding(dp(12), dp(12), dp(12), dp(12));
        this.closeButton.setContentDescription("CLOSE");
        this.closeButton.setOnClickListener(v -> cancelAndExit());
        topStrip.addView(this.closeButton, new LinearLayout.LayoutParams(dp(48), dp(48)));

        final View spacer = new View(this);
        topStrip.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1.0f));

        this.trackingCodeText = new TextView(this);
        this.trackingCodeText.setTypeface(fontMonoBold);
        this.trackingCodeText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        this.trackingCodeText.setTextColor(COLOR_COPPER);
        this.trackingCodeText.setMaxLines(1);
        this.trackingCodeText.setSingleLine(true);
        this.trackingCodeText.setEllipsize(TextUtils.TruncateAt.END);
        this.trackingCodeText.setPadding(dp(4), 0, dp(4), 0);
        this.trackingCodeText.setVisibility(View.GONE);
        topStrip.addView(
            this.trackingCodeText,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );

        this.anchorDetectedIcon = createIconView(R.drawable.ic_ms_qr_code_scanner, COLOR_CYAN, dp(6));
        this.anchorDetectedIcon.setVisibility(View.GONE);
        topStrip.addView(this.anchorDetectedIcon, new LinearLayout.LayoutParams(dp(34), dp(34)));

        this.speedAlertIcon = createIconView(R.drawable.ic_ms_speed, COLOR_COPPER, dp(6));
        this.speedAlertIcon.setVisibility(View.GONE);
        topStrip.addView(this.speedAlertIcon, new LinearLayout.LayoutParams(dp(34), dp(34)));

        this.trackingIcon = createIconView(R.drawable.ic_ms_view_in_ar, COLOR_COPPER, dp(6));
        topStrip.addView(this.trackingIcon, new LinearLayout.LayoutParams(dp(36), dp(36)));

        rightRail.addView(
            topStrip,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48))
        );

        // 2. Center telemetry block (adaptive 96-124dp 16-segment ring + compact maxLines=1 metrics <= 180dp)
        final DisplayMetrics dm = getResources().getDisplayMetrics();
        final float screenShortDp = Math.min(dm.widthPixels, dm.heightPixels) / Math.max(1.0f, dm.density);
        final float fontScale = Math.max(1.0f, getResources().getConfiguration().fontScale);
        final int estTextDp = Math.round(70.0f * fontScale);
        final int maxCenterBudgetDp = Math.min(186, Math.round(screenShortDp - 48.0f - 64.0f - 20.0f));
        final int ringDp = Math.max(88, Math.min(120, maxCenterBudgetDp - estTextDp));

        final LinearLayout centerBlock = new LinearLayout(this);
        centerBlock.setOrientation(LinearLayout.VERTICAL);
        centerBlock.setGravity(Gravity.CENTER);

        this.perimeterRingView = new PerimeterRing360View(this, fontMonoBold);
        this.perimeterRingView.setVisibility(MODE_CALIBRATE.equals(mode) ? View.GONE : View.VISIBLE);
        centerBlock.addView(this.perimeterRingView, new LinearLayout.LayoutParams(dp(ringDp), dp(ringDp)));

        this.liveVolumeText = new TextView(this);
        this.liveVolumeText.setTypeface(fontMonoBold);
        this.liveVolumeText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        this.liveVolumeText.setTextColor(COLOR_DISABLED);
        this.liveVolumeText.setGravity(Gravity.CENTER);
        this.liveVolumeText.setMaxLines(1);
        this.liveVolumeText.setSingleLine(true);
        this.liveVolumeText.setEllipsize(TextUtils.TruncateAt.END);
        this.liveVolumeText.setPadding(0, dp(4), 0, dp(1));
        this.liveVolumeText.setText("--.- m³");
        centerBlock.addView(
            this.liveVolumeText,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );

        this.liveDimsText = new TextView(this);
        this.liveDimsText.setTypeface(fontMonoRegular);
        this.liveDimsText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        this.liveDimsText.setTextColor(COLOR_SECONDARY);
        this.liveDimsText.setGravity(Gravity.CENTER);
        this.liveDimsText.setMaxLines(1);
        this.liveDimsText.setSingleLine(true);
        this.liveDimsText.setEllipsize(TextUtils.TruncateAt.END);
        this.liveDimsText.setText("Ø --.- m · H --.- m");
        centerBlock.addView(
            this.liveDimsText,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );

        this.liveKfCountText = new TextView(this);
        this.liveKfCountText.setTypeface(fontMonoRegular);
        this.liveKfCountText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        this.liveKfCountText.setTextColor(COLOR_DISABLED);
        this.liveKfCountText.setGravity(Gravity.CENTER);
        this.liveKfCountText.setMaxLines(1);
        this.liveKfCountText.setSingleLine(true);
        this.liveKfCountText.setEllipsize(TextUtils.TruncateAt.END);
        this.liveKfCountText.setPadding(0, dp(2), 0, 0);
        this.liveKfCountText.setText("0 KF");
        centerBlock.addView(
            this.liveKfCountText,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );

        this.hudBuildHeartbeatText = new TextView(this);
        this.hudBuildHeartbeatText.setTypeface(fontMonoRegular);
        this.hudBuildHeartbeatText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 9);
        this.hudBuildHeartbeatText.setTextColor(COLOR_DISABLED);
        this.hudBuildHeartbeatText.setGravity(Gravity.CENTER);
        this.hudBuildHeartbeatText.setMaxLines(1);
        this.hudBuildHeartbeatText.setSingleLine(true);
        this.hudBuildHeartbeatText.setEllipsize(TextUtils.TruncateAt.END);
        this.hudBuildHeartbeatText.setPadding(0, dp(1), 0, 0);
        this.hudBuildHeartbeatText.setText("2.0.3 · 0 PTS");
        centerBlock.addView(
            this.hudBuildHeartbeatText,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );

        this.finalizingBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        this.finalizingBar.setIndeterminate(true);
        this.finalizingBar.setVisibility(View.GONE);
        final LinearLayout.LayoutParams barParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(4)
        );
        barParams.topMargin = dp(8);
        centerBlock.addView(this.finalizingBar, barParams);

        rightRail.addView(
            centerBlock,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.0f)
        );

        // 3. Bottom single primary button (64dp height, rounded-none, 36dp crisp icon via FIT_CENTER + 14dp pad)
        this.primaryActionButton = new ImageButton(this);
        this.primaryActionButton.setScaleType(ImageView.ScaleType.FIT_CENTER);
        this.primaryActionButton.setPadding(dp(14), dp(14), dp(14), dp(14));
        this.primaryActionButton.setStateListAnimator(null);
        this.primaryActionButton.setElevation(0.0f);
        this.primaryActionButton.setMinimumHeight(dp(64));
        this.primaryActionButton.setContentDescription("PRIMARY_ACTION");
        this.primaryActionButton.setOnClickListener(v -> onPrimaryActionClick());
        applyPrimaryButtonStyle(COLOR_BTN_WAITING_BG, COLOR_DISABLED, 1, R.drawable.ic_ms_play_arrow, COLOR_SECONDARY);

        rightRail.addView(
            this.primaryActionButton,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64))
        );

        root.addView(
            rightRail,
            new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 38.2f)
        );

        setContentView(root);
        updateHudFromState(true);
    }

    private void applyPrimaryButtonStyle(
        final int fillColor,
        final int borderColor,
        final int borderWidthDp,
        final int iconRes,
        final int iconTint
    ) {
        final GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.RECTANGLE);
        bg.setCornerRadius(0.0f);
        bg.setColor(fillColor);
        if (borderWidthDp > 0) {
            bg.setStroke(dp(borderWidthDp), borderColor);
        }
        primaryActionButton.setBackground(bg);
        primaryActionButton.setImageResource(iconRes);
        primaryActionButton.setColorFilter(iconTint);
    }

    private ImageView createIconView(final int resId, final int tintColor, final int padPx) {
        final ImageView iv = new ImageView(this);
        iv.setImageResource(resId);
        iv.setColorFilter(tintColor);
        iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
        iv.setPadding(padPx, padPx, padPx, padPx);
        return iv;
    }

    private void onPrimaryActionClick() {
        boolean shouldFinishScan = false;
        boolean shouldFinishCalibration = false;
        boolean hapticSuccess = false;
        boolean hapticDouble = false;
        boolean hapticReject = false;

        float measuredDist = 0.0f;
        float computedScale = 1.0f;

        synchronized (stateLock) {
            if (finishing) {
                return;
            }
            final long nowMs = SystemClock.elapsedRealtime();

            if (currentStep == FlowStep.READY_TRACKING) {
                if (lastTrackingState == TrackingState.TRACKING) {
                    pendingStartCapture = false;
                    currentStep = FlowStep.CAPTURING_WALK;
                    resetWalkCaptureStateLocked(nowMs);
                    hapticSuccess = true;
                } else {
                    // Arm capture so it starts the exact millisecond ARCore locks TRACKING (zero lost taps)
                    pendingStartCapture = true;
                    hapticSuccess = true;
                }
            } else if (currentStep == FlowStep.CAPTURING_WALK) {
                final boolean canFinish =
                    (savedKeyframes.size() >= 6 && sectorsCovered >= 4) ||
                    (savedKeyframes.size() >= 4 && sectorsCovered >= 3);
                if (canFinish) {
                    finishing = true;
                    currentStep = FlowStep.FINALIZING;
                    shouldFinishScan = true;
                    hapticDouble = true;
                } else {
                    lastMinKfHintAtMs = nowMs;
                    hapticReject = true;
                }
            } else if (currentStep == FlowStep.CAL_FLOOR) {
                hapticReject = true;
            } else if (currentStep == FlowStep.CAL_FLOOR_ERROR) {
                calFloorSamples.clear();
                calFloorStartedAtMs = nowMs;
                lastCalSampleAtMs = 0L;
                currentStep = FlowStep.CAL_FLOOR;
                hapticSuccess = true;
            } else if (currentStep == FlowStep.CAL_START) {
                if (lastTrackingState == TrackingState.TRACKING && latestCalHit != null) {
                    calPointA = Arrays.copyOf(latestCalHit, 3);
                    latestCalHit = null;
                    liveCalDistanceM = -1.0f;
                    currentStep = FlowStep.CAL_END;
                    hapticSuccess = true;
                } else {
                    hapticReject = true;
                }
            } else if (currentStep == FlowStep.CAL_END) {
                if (lastTrackingState == TrackingState.TRACKING && latestCalHit != null && calPointA != null) {
                    measuredDist = dist3D(calPointA, latestCalHit);
                    if (measuredDist <= MIN_CAL_DISTANCE_M) {
                        currentStep = FlowStep.CAL_RANGE_ERROR;
                        hapticReject = true;
                    } else {
                        computedScale = CAL_REFERENCE_DISTANCE_M / measuredDist;
                        if (computedScale < MIN_SCALE_FACTOR || computedScale > MAX_SCALE_FACTOR) {
                            currentStep = FlowStep.CAL_RANGE_ERROR;
                            hapticReject = true;
                        } else {
                            finishing = true;
                            shouldFinishCalibration = true;
                            hapticDouble = true;
                        }
                    }
                } else {
                    hapticReject = true;
                }
            } else if (currentStep == FlowStep.CAL_RANGE_ERROR) {
                calPointA = null;
                latestCalHit = null;
                liveCalDistanceM = -1.0f;
                currentStep = FlowStep.CAL_START;
                hapticSuccess = true;
            }
        }

        if (hapticSuccess) {
            triggerShortHaptic();
        }
        if (hapticDouble) {
            triggerDoubleHaptic();
        }
        if (hapticReject) {
            triggerRejectHaptic();
        }
        if (shouldFinishScan) {
            updateHudFromState(true);
            finalizeAndReturnScanAsync();
        } else if (shouldFinishCalibration) {
            finalizeAndReturnCalibration(measuredDist, computedScale);
        } else {
            updateHudFromState(true);
        }
    }

    private void resetWalkCaptureStateLocked(final long nowMs) {
        offlineEngine.reset();
        walkRingPoses.clear();
        savedKeyframes.clear();
        groundSampleGrid.clear();
        extraVioCloud.clear();
        Arrays.fill(sectorStates, 0);
        Arrays.fill(sectorKfCounts, 0);
        sectorsCovered = 0;
        lastSectorCenterXZ = null;
        liveEstDiameterM = 0.0f;
        liveEstHeightM = 0.0f;
        liveEstVolumeM3 = 0.0f;
        readyHapticFired = false;
        rejectedBlurCount = 0;
        lastWalkPosePos = null;
        lastKfPos = null;
        lastKfFwdXZ = null;
        walkDistanceM = 0.0f;
        lastRenderErrorCode = null;
        lastRenderErrorAtMs = 0L;
        lastMinKfHintAtMs = 0L;
        lastVioPointCloudAtMs = 0L;
        lastGroundSampleAtMs = 0L;
        lastLiveOverlaySolveAtMs = 0L;
        livePointAccumulator.clear();
        burstState.resetAll(nowMs);
        if (renderer != null) {
            renderer.clearLiveOverlay();
            renderer.clearGlFallbackRequest();
        }
    }

    private void cancelAndExit() {
        synchronized (stateLock) {
            pendingStartCapture = false;
            finishing = true;
        }
        setResult(RESULT_CANCELED);
        finish();
    }

    private void finishWithError(final String errorCode, final String errorMessage) {
        synchronized (stateLock) {
            pendingStartCapture = false;
            finishing = true;
        }
        final Intent errorIntent = new Intent();
        errorIntent.putExtra(EXTRA_ERROR_CODE, errorCode);
        errorIntent.putExtra(EXTRA_ERROR_MESSAGE, errorMessage);
        setResult(RESULT_CANCELED, errorIntent);
        finish();
    }

    @Override
    public void onArRenderError(final String errorCode) {
        final String safeTag = (errorCode != null && !errorCode.isEmpty())
            ? errorCode.substring(0, Math.min(8, errorCode.length())).toUpperCase(Locale.US)
            : "ERR";
        lastRenderErrorCode = "AR · " + safeTag;
        lastRenderErrorAtMs = SystemClock.elapsedRealtime();
        updateHudThrottled(true);
    }

    @Override
    public void onArFrame(final Session activeSession, final Frame frame) {
        arFrameCounter++;
        final Camera camera = frame.getCamera();
        final TrackingState trackingState = camera.getTrackingState();
        final TrackingFailureReason failureReason = trackingState == TrackingState.TRACKING
            ? TrackingFailureReason.NONE
            : camera.getTrackingFailureReason();

        boolean fireShortPulse = false;
        boolean fireDoubleReadyPulse = false;
        boolean fireCaptureFlash = false;
        boolean forceHud = false;

        synchronized (stateLock) {
            final long nowMs = SystemClock.elapsedRealtime();
            lastTrackingState = trackingState;
            lastTrackingFailureReason = failureReason;
            if (finishing) {
                return;
            }

            if (trackingState != TrackingState.TRACKING) {
                latestCalHit = null;
                liveCalDistanceM = -1.0f;
                if (lastTrackingSeenAtMs == 0L || (nowMs - lastTrackingSeenAtMs) > 2000L) {
                    livePointAccumulator.clear();
                    if (renderer != null) {
                        renderer.clearLiveTrackingVisuals();
                    }
                }
                updateHudThrottled(false);
                return;
            }
            lastTrackingSeenAtMs = nowMs;

            // Auto-transition immediately if operator pre-armed capture before ARCore locked TRACKING
            if (currentStep == FlowStep.READY_TRACKING && pendingStartCapture) {
                pendingStartCapture = false;
                currentStep = FlowStep.CAPTURING_WALK;
                resetWalkCaptureStateLocked(nowMs);
                fireShortPulse = true;
                forceHud = true;
            }

            // Immediate 3D visual feedback from Frame 1 (both READY_TRACKING & CAPTURING_WALK, even at 0 KF)
            if (currentStep == FlowStep.READY_TRACKING || currentStep == FlowStep.CAPTURING_WALK) {
                updateLivePointCloudAndVioLocked(frame, nowMs, currentStep == FlowStep.CAPTURING_WALK);
                updateLivePlaneOutlines(activeSession);
            }

            if (currentStep == FlowStep.CAL_FLOOR) {
                if (calFloorStartedAtMs == 0L) calFloorStartedAtMs = nowMs;
                if (nowMs - lastCalSampleAtMs >= 120L) {
                    collectCalibrationFloorSamples(activeSession, frame, camera);
                    lastCalSampleAtMs = nowMs;
                }
                if (nowMs - calFloorStartedAtMs >= CAL_FLOOR_DURATION_MS) {
                    if (evaluateCalibrationFloorNoise()) {
                        currentStep = FlowStep.CAL_START;
                        fireShortPulse = true;
                    } else {
                        currentStep = FlowStep.CAL_FLOOR_ERROR;
                    }
                    forceHud = true;
                }
            } else if (currentStep == FlowStep.CAL_START || currentStep == FlowStep.CAL_END) {
                latestCalHit = resolveCalibrationFloorHit(frame, camera);
                if (currentStep == FlowStep.CAL_END && calPointA != null && latestCalHit != null) {
                    liveCalDistanceM = dist3D(calPointA, latestCalHit);
                } else {
                    liveCalDistanceM = -1.0f;
                }
            } else if (currentStep == FlowStep.CAPTURING_WALK) {
                final Pose camPose = camera.getPose();
                final float[] camPos = camPose.getTranslation();
                final float[] zAxis = camPose.getZAxis();
                final float fwdX = -zAxis[0];
                final float fwdY = -zAxis[1];
                final float fwdZ = -zAxis[2];

                // 1. Record walk-ring trajectory every >= 0.25 m
                if (lastWalkPosePos == null || dist3D(camPos, lastWalkPosePos) >= MIN_WALK_POSE_STEP_M) {
                    if (lastWalkPosePos != null) {
                        walkDistanceM += dist3D(camPos, lastWalkPosePos);
                    }
                    walkRingPoses.add(new WalkRingToeSolver.WalkPose(
                        camPos[0], camPos[1], camPos[2], fwdX, fwdY, fwdZ, frame.getTimestamp()
                    ));
                    lastWalkPosePos = Arrays.copyOf(camPos, 3);
                }

                // 2. Collect horizontal ground planes below local camera height (y <= y_cam - 0.55f)
                if (nowMs - lastGroundSampleAtMs >= 300L) {
                    lastGroundSampleAtMs = nowMs;
                    collectFilteredGroundPlanes(activeSession, camPos[1] - LOCAL_GROUND_CLEARANCE_M);
                }

                // 3. Update live heading & recompute sector coverage whenever Auto-ROI center converges
                final float[] autoCenter = WalkRingToeSolver.estimateAutoCenterXZ(walkRingPoses, extraVioCloud);
                if (
                    !savedKeyframes.isEmpty() &&
                    (lastSectorCenterXZ == null ||
                        Math.hypot(
                            autoCenter[0] - lastSectorCenterXZ[0],
                            autoCenter[1] - lastSectorCenterXZ[1]
                        ) >= 0.35)
                ) {
                    recomputeSectorsFromKeyframesLocked(autoCenter);
                    lastSectorCenterXZ = new float[] { autoCenter[0], autoCenter[1] };
                } else if (lastSectorCenterXZ == null) {
                    lastSectorCenterXZ = new float[] { autoCenter[0], autoCenter[1] };
                }

                liveHeadingDeg = (float) computeSectorAngleDeg(camPos, autoCenter);
                final int curSector = Math.min(
                    SECTOR_COUNT - 1,
                    Math.max(0, (int) Math.floor(liveHeadingDeg / (360.0f / SECTOR_COUNT)))
                );

                // 4. Adaptive keyframe trigger: Δd = clamp(0.14 * R_est, 0.40, 1.30) OR Δyaw >= 12° (cap 32)
                final float rEst = Math.max(1.5f, (float) Math.hypot(camPos[0] - autoCenter[0], camPos[2] - autoCenter[2]));
                final float stepThreshM = clamp(0.14f * rEst, MIN_KF_STEP_M, MAX_KF_STEP_M);
                final boolean kfTriggered = shouldTriggerKeyframe(camPos, fwdX, fwdZ, stepThreshM);

                if (savedKeyframes.size() < MAX_KEYFRAME_PHOTOS && (kfTriggered || burstState.isActive())) {
                    burstState.beginBurstIfNeeded(nowMs);
                    evaluateBurstCandidateLocked(frame, camera, camPose, nowMs);

                    if (burstState.shouldRequestGlFallback() && renderer != null) {
                        burstState.markGlFallbackRequested(nowMs);
                        renderer.requestGlFallbackFrame();
                    }

                    if (burstState.isBurstFinished(nowMs, liveGyroNormRadS, SPEED_ALERT_GYRO_RAD_S)) {
                        final boolean committed = commitBestBurstKeyframeLocked(curSector, liveHeadingDeg, nowMs);
                        if (committed) {
                            fireShortPulse = true;
                            fireCaptureFlash = true;
                            forceHud = true;
                            maybeScheduleLiveOverlayRefreshLocked(nowMs);
                        }
                    }
                }

                // 5. Periodic 3D DEM overlay refresh every 650 ms even before next KF commits
                if (extraVioCloud.size() >= 20) {
                    maybeScheduleLiveOverlayRefreshLocked(nowMs);
                }

                if (liveGyroNormRadS > SPEED_ALERT_GYRO_RAD_S) {
                    lastSpeedAlertAtMs = nowMs;
                }

                final double covPct = (sectorsCovered / (double) SECTOR_COUNT) * 100.0;
                if (covPct >= 75.0 && savedKeyframes.size() >= 12 && !readyHapticFired) {
                    readyHapticFired = true;
                    fireDoubleReadyPulse = true;
                }
            }
        }

        if (fireCaptureFlash) {
            mainHandler.post(this::triggerCaptureFlash);
        }
        if (fireShortPulse) {
            mainHandler.post(this::triggerShortHaptic);
        }
        if (fireDoubleReadyPulse) {
            mainHandler.post(this::triggerDoubleHaptic);
        }
        if (forceHud) {
            mainHandler.post(() -> updateHudFromState(true));
        } else {
            updateHudThrottled(false);
        }
    }

    private void updateLivePointCloudAndVioLocked(
        final Frame frame,
        final long nowMs,
        final boolean collectMetrologicalVio
    ) {
        try (PointCloud pc = frame.acquirePointCloud()) {
            final FloatBuffer pts = pc.getPoints();
            if (pts == null) {
                return;
            }
            // Immediate persistent 3D visual feedback (conf >= 0.1f, ring buffer 2048 pts, never wipes on empty frame)
            if (renderer != null) {
                livePointAccumulator.appendFromPointCloud(
                    pts,
                    LIVE_VISUAL_POINT_MIN_CONF,
                    LIVE_VISUAL_POINTS_PER_FRAME
                );
                final float[] visualVerts = livePointAccumulator.snapshot();
                if (visualVerts != null && visualVerts.length >= 3) {
                    renderer.updateLivePointCloud(visualVerts);
                }
            }

            // High-confidence VIO points (conf >= 0.5f) reserved strictly for metrology
            if (
                collectMetrologicalVio &&
                extraVioCloud.size() < MAX_EXTRA_VIO_POINTS &&
                (nowMs - lastVioPointCloudAtMs) >= 250L
            ) {
                final int limit = pts.limit();
                for (int i = 0; i + 3 < limit && extraVioCloud.size() < MAX_EXTRA_VIO_POINTS; i += 4) {
                    final float conf = pts.get(i + 3);
                    if (conf >= 0.5f) {
                        final float px = pts.get(i);
                        final float py = pts.get(i + 1);
                        final float pz = pts.get(i + 2);
                        if (Float.isFinite(px) && Float.isFinite(py) && Float.isFinite(pz)) {
                            extraVioCloud.add(new float[] { px, py, pz, conf });
                        }
                    }
                }
                lastVioPointCloudAtMs = nowMs;
            }
        } catch (Throwable t) {
            Log.w(TAG, "Failed to sample ARCore VIO point cloud", t);
        }
    }

    private void updateLivePlaneOutlines(final Session activeSession) {
        if (renderer == null) {
            return;
        }
        try {
            final List<Float> segs = new ArrayList<>(128);
            final float[] localPt = new float[3];
            final float[] worldPt = new float[3];
            final float[] prevPt = new float[3];
            final float[] firstPt = new float[3];

            for (Plane plane : activeSession.getAllTrackables(Plane.class)) {
                if (
                    plane.getTrackingState() != TrackingState.TRACKING ||
                    plane.getSubsumedBy() != null ||
                    plane.getType() != Plane.Type.HORIZONTAL_UPWARD_FACING
                ) {
                    continue;
                }
                final FloatBuffer poly = plane.getPolygon();
                final int limit = poly != null ? poly.limit() : 0;
                if (limit < 6) {
                    continue;
                }
                final Pose centerPose = plane.getCenterPose();
                boolean hasPrev = false;
                for (int i = 0; i + 1 < limit; i += 2) {
                    localPt[0] = poly.get(i);
                    localPt[1] = 0.0f;
                    localPt[2] = poly.get(i + 1);
                    centerPose.transformPoint(localPt, 0, worldPt, 0);
                    if (!hasPrev) {
                        firstPt[0] = worldPt[0];
                        firstPt[1] = worldPt[1];
                        firstPt[2] = worldPt[2];
                        prevPt[0] = worldPt[0];
                        prevPt[1] = worldPt[1];
                        prevPt[2] = worldPt[2];
                        hasPrev = true;
                    } else {
                        segs.add(prevPt[0]);
                        segs.add(prevPt[1]);
                        segs.add(prevPt[2]);
                        segs.add(worldPt[0]);
                        segs.add(worldPt[1]);
                        segs.add(worldPt[2]);
                        prevPt[0] = worldPt[0];
                        prevPt[1] = worldPt[1];
                        prevPt[2] = worldPt[2];
                    }
                }
                if (hasPrev) {
                    segs.add(prevPt[0]);
                    segs.add(prevPt[1]);
                    segs.add(prevPt[2]);
                    segs.add(firstPt[0]);
                    segs.add(firstPt[1]);
                    segs.add(firstPt[2]);
                }
            }
            if (segs.isEmpty()) {
                renderer.updateLivePlaneOutlines(null);
            } else {
                final float[] out = new float[segs.size()];
                for (int i = 0; i < segs.size(); i++) {
                    out[i] = segs.get(i);
                }
                renderer.updateLivePlaneOutlines(out);
            }
        } catch (Throwable t) {
            Log.w(TAG, "Failed to update live plane outline overlay", t);
        }
    }

    private void recomputeSectorsFromKeyframesLocked(final float[] centerXZ) {
        Arrays.fill(sectorKfCounts, 0);
        Arrays.fill(sectorStates, 0);
        sectorsCovered = 0;
        for (KeyframeRecord kf : savedKeyframes) {
            final double deg = computeSectorAngleDeg(kf.tWc, centerXZ);
            final int s = Math.min(
                SECTOR_COUNT - 1,
                Math.max(0, (int) Math.floor(deg / (360.0 / SECTOR_COUNT)))
            );
            if (sectorKfCounts[s] == 0) {
                sectorsCovered++;
            }
            sectorKfCounts[s]++;
            sectorStates[s] = sectorKfCounts[s] >= 2 ? 2 : 1;
        }
    }

    private boolean shouldTriggerKeyframe(
        final float[] camPos,
        final float fwdX,
        final float fwdZ,
        final float stepThreshM
    ) {
        if (lastKfPos == null || lastKfFwdXZ == null) {
            return true;
        }
        final float distMoved = dist3D(camPos, lastKfPos);
        if (distMoved >= stepThreshM) {
            return true;
        }
        final float len = (float) Math.hypot(fwdX, fwdZ);
        if (len > 0.1f) {
            final float nx = fwdX / len;
            final float nz = fwdZ / len;
            final float dot = clamp(nx * lastKfFwdXZ[0] + nz * lastKfFwdXZ[1], -1.0f, 1.0f);
            final double yawDeltaDeg = Math.toDegrees(Math.acos(dot));
            if (yawDeltaDeg >= MIN_KF_YAW_DEG && distMoved >= 0.18f) {
                return true;
            }
        }
        return false;
    }

    private void evaluateBurstCandidateLocked(
        final Frame frame,
        final Camera camera,
        final Pose camPose,
        final long nowMs
    ) {
        final ArCoreCameraRenderer.GlFallbackFrame glFallback =
            renderer != null ? renderer.consumeGlFallbackFrame() : null;

        if (
            liveGyroNormRadS > MAX_CAPTURE_GYRO_RAD_S &&
            !burstState.isTimedOutWithNoCandidate(nowMs, 450L)
        ) {
            lastSpeedAlertAtMs = nowMs;
            burstState.recordNonAcquireDiag(CapturePipelineHelper.DIAG_GYR);
            return;
        }

        boolean acquiredPrimary = false;
        try (Image camImg = frame.acquireCameraImage()) {
            if (camImg.getFormat() != ImageFormat.YUV_420_888) {
                burstState.recordAcquireFailure(CapturePipelineHelper.DIAG_FMT, nowMs);
            } else {
                final int w = camImg.getWidth();
                final int h = camImg.getHeight();
                final Image.Plane[] planes = camImg.getPlanes();
                final byte[] nv21 = CapturePipelineHelper.extractNv21FromPlanes(
                    planes[0].getBuffer(),
                    planes[0].getRowStride(),
                    planes[0].getPixelStride(),
                    planes[1].getBuffer(),
                    planes[1].getRowStride(),
                    planes[1].getPixelStride(),
                    planes[2].getBuffer(),
                    planes[2].getRowStride(),
                    planes[2].getPixelStride(),
                    w,
                    h
                );
                if (nv21 == null || nv21.length == 0) {
                    burstState.recordAcquireFailure(CapturePipelineHelper.DIAG_ERR, nowMs);
                } else {
                    final double blurScore = CapturePipelineHelper.computeLaplacianVarianceFromY(nv21, w, h);
                    if (!Double.isFinite(blurScore) || blurScore < 0.0) {
                        burstState.recordAcquireFailure(CapturePipelineHelper.DIAG_ERR, nowMs);
                    } else {
                        acquiredPrimary = true;
                        if (blurScore < CapturePipelineHelper.BLUR_VARIANCE_THRESHOLD) {
                            rejectedBlurCount++;
                            if (blurScore < CapturePipelineHelper.BLUR_LOW_THRESHOLD) {
                                lastSpeedAlertAtMs = nowMs;
                            }
                        }
                        if (burstState.shouldEvaluateScore(blurScore)) {
                            burstState.tryAcceptCandidate(blurScore, nowMs, () -> {
                                final byte[] lumaSmall = CapturePipelineHelper.downscaleLumaFromNv21(
                                    nv21,
                                    w,
                                    h,
                                    MVS_LUMA_W,
                                    MVS_LUMA_H
                                );
                                final float[] rWc = poseToRowMajorRotation3x3(camPose);
                                final float[] tWc = camPose.getTranslation();
                                final float[] intr = resolveCameraIntrinsicsLocked(camera, w, h, false);
                                return new CapturePipelineHelper.BurstCandidate(
                                    blurScore,
                                    nv21,
                                    lumaSmall,
                                    w,
                                    h,
                                    rWc,
                                    tWc,
                                    intr,
                                    frame.getTimestamp(),
                                    liveImuPitchDeg,
                                    liveImuRollDeg,
                                    false
                                );
                            });
                        } else if (burstState.getBestCandidate() != null) {
                            burstState.recordAcquireSuccess();
                        }
                    }
                }
            }
        } catch (NotYetAvailableException ignored) {
            burstState.recordAcquireFailure(CapturePipelineHelper.DIAG_NYA, nowMs);
        } catch (Throwable t) {
            Log.w(TAG, "Failed to evaluate keyframe burst candidate", t);
            burstState.recordAcquireFailure(CapturePipelineHelper.DIAG_ERR, nowMs);
        }

        // Anti-HAL MediaTek GL Readback fallback: guarantees commit even if acquireCameraImage() fails 100%
        if (
            !acquiredPrimary &&
            glFallback != null &&
            glFallback.rgbaBytes != null &&
            glFallback.width > 0 &&
            glFallback.height > 0
        ) {
            try {
                final int w = glFallback.width;
                final int h = glFallback.height;
                final byte[] nv21 = CapturePipelineHelper.rgbToNv21(glFallback.rgbaBytes, w, h);
                if (nv21 == null || nv21.length == 0) {
                    burstState.recordNonAcquireDiag(CapturePipelineHelper.DIAG_ERR);
                    return;
                }
                final double blurScore = CapturePipelineHelper.computeLaplacianVarianceFromY(nv21, w, h);
                if (!Double.isFinite(blurScore) || blurScore < 0.0) {
                    burstState.recordNonAcquireDiag(CapturePipelineHelper.DIAG_ERR);
                    return;
                }
                if (burstState.shouldEvaluateScore(blurScore)) {
                    burstState.tryAcceptCandidate(blurScore, nowMs, () -> {
                        final byte[] lumaSmall = CapturePipelineHelper.downscaleLumaFromNv21(
                            nv21,
                            w,
                            h,
                            MVS_LUMA_W,
                            MVS_LUMA_H
                        );
                        final float[] rWc = poseToRowMajorRotation3x3(camPose);
                        final float[] tWc = camPose.getTranslation();
                        final float[] intr = resolveCameraIntrinsicsLocked(camera, w, h, true);
                        return new CapturePipelineHelper.BurstCandidate(
                            blurScore,
                            nv21,
                            lumaSmall,
                            w,
                            h,
                            rWc,
                            tWc,
                            intr,
                            frame.getTimestamp(),
                            liveImuPitchDeg,
                            liveImuRollDeg,
                            true
                        );
                    });
                }
            } catch (Throwable t) {
                Log.w(TAG, "Failed to process GL fallback keyframe candidate", t);
                burstState.recordNonAcquireDiag(CapturePipelineHelper.DIAG_ERR);
            }
        }
    }

    private float[] resolveCameraIntrinsicsLocked(
        final Camera camera,
        final int targetW,
        final int targetH,
        final boolean preferTexture
    ) {
        float[] imgFocal = null;
        float[] imgPrincipal = null;
        int[] imgDims = null;
        float[] texFocal = null;
        float[] texPrincipal = null;
        int[] texDims = null;

        try {
            final CameraIntrinsics imgIntr = camera.getImageIntrinsics();
            if (imgIntr != null) {
                imgFocal = imgIntr.getFocalLength();
                imgPrincipal = imgIntr.getPrincipalPoint();
                imgDims = imgIntr.getImageDimensions();
            }
        } catch (Throwable ignored) {
        }
        try {
            final CameraIntrinsics texIntr = camera.getTextureIntrinsics();
            if (texIntr != null) {
                texFocal = texIntr.getFocalLength();
                texPrincipal = texIntr.getPrincipalPoint();
                texDims = texIntr.getImageDimensions();
            }
        } catch (Throwable ignored) {
        }

        final int[] primaryDims = preferTexture ? texDims : imgDims;
        if (primaryDims == null || primaryDims.length < 2 || primaryDims[0] <= 0 || primaryDims[1] <= 0) {
            burstState.recordNonAcquireDiag(CapturePipelineHelper.DIAG_INT);
        }

        return preferTexture
            ? CapturePipelineHelper.resolveSafeIntrinsics(
                texFocal, texPrincipal, texDims,
                imgFocal, imgPrincipal, imgDims,
                targetW, targetH
            )
            : CapturePipelineHelper.resolveSafeIntrinsics(
                imgFocal, imgPrincipal, imgDims,
                texFocal, texPrincipal, texDims,
                targetW, targetH
            );
    }

    private boolean commitBestBurstKeyframeLocked(final int sector, final double angleDeg, final long nowMs) {
        final CapturePipelineHelper.BurstCandidate winner = burstState.consumeCommittedCandidate();
        if (winner == null || !winner.isComplete()) {
            return false;
        }

        final int kfIndex = savedKeyframes.size();
        final File photoFile = new File(
            getCacheDir(),
            String.format(Locale.US, "minreport_%s_kf_%02d.webp", scanId, kfIndex)
        );

        // Compute scaled intrinsics matching the saved unrotated WebP dimensions
        final float outScale = Math.min(1.0f, MAX_PHOTO_DIMENSION_PX / (float) Math.max(winner.width, winner.height));
        final int outW = Math.max(1, Math.round(winner.width * outScale));
        final int outH = Math.max(1, Math.round(winner.height * outScale));
        final float fxOut = winner.intr[0] * (outW / (float) winner.width);
        final float fyOut = winner.intr[1] * (outH / (float) winner.height);
        final float cxOut = winner.intr[2] * (outW / (float) winner.width);
        final float cyOut = winner.intr[3] * (outH / (float) winner.height);

        final int displayRotDeg = winner.fromGlFallback
            ? 0
            : (rearSensorOrientation - (renderer != null ? renderer.getDisplayRotationDegrees() : 90) + 360) % 360;

        final KeyframeRecord rec = new KeyframeRecord(
            kfIndex,
            round1(angleDeg),
            round1(winner.blurScore),
            photoFile.getAbsolutePath(),
            displayRotDeg,
            winner.timestampNs,
            round1f(winner.pitchDeg),
            round1f(winner.rollDeg),
            winner.rWc,
            winner.tWc,
            fxOut, fyOut, cxOut, cyOut,
            outW, outH,
            winner.nv21.length
        );
        savedKeyframes.add(rec);

        lastKfPos = Arrays.copyOf(winner.tWc, 3);
        final float fxDir = -winner.rWc[2];
        final float fzDir = -winner.rWc[8];
        final float fLen = (float) Math.hypot(fxDir, fzDir);
        lastKfFwdXZ = fLen > 1e-4f ? new float[] { fxDir / fLen, fzDir / fLen } : new float[] { 0.0f, -1.0f };

        if (sectorKfCounts[sector] == 0) {
            sectorsCovered++;
        }
        sectorKfCounts[sector]++;
        sectorStates[sector] = sectorKfCounts[sector] >= 2 ? 2 : 1;

        // 1. Save UNROTATED WebP off-thread + compute CAS sha256 & savingsPct
        final byte[] nv21Copy = winner.nv21;
        final int srcW = winner.width;
        final int srcH = winner.height;
        if (ioExecutor != null && !ioExecutor.isShutdown()) {
            ioExecutor.execute(() -> saveUnrotatedWebpWithCasStats(nv21Copy, srcW, srcH, outW, outH, photoFile, rec));
        }

        // 2. Feed 4:3 luma into incremental FAST+rBRIEF VIO triangulation off-thread (< 5 ms)
        final float mvsScaleX = MVS_LUMA_W / (float) winner.width;
        final float mvsScaleY = MVS_LUMA_H / (float) winner.height;
        final OfflineVioMvsEngine.KeyframeFrame mvsKf = new OfflineVioMvsEngine.KeyframeFrame(
            kfIndex,
            MVS_LUMA_W,
            MVS_LUMA_H,
            winner.lumaSmall,
            winner.intr[0] * mvsScaleX,
            winner.intr[1] * mvsScaleY,
            winner.intr[2] * mvsScaleX,
            winner.intr[3] * mvsScaleY,
            winner.rWc,
            winner.tWc,
            winner.timestampNs
        );
        if (visionExecutor != null && !visionExecutor.isShutdown()) {
            visionExecutor.execute(() -> {
                try {
                    offlineEngine.ingestKeyframeIncremental(mvsKf);
                } catch (Throwable t) {
                    Log.e(TAG, "Incremental VIO keyframe ingest failed for kf=" + kfIndex, t);
                }
            });
        }
        return true;
    }

    private void maybeScheduleLiveOverlayRefreshLocked(final long nowMs) {
        if (nowMs - lastLiveOverlaySolveAtMs < 650L || !liveOverlayBusy.compareAndSet(false, true)) {
            return;
        }
        lastLiveOverlaySolveAtMs = nowMs;
        final List<WalkRingToeSolver.WalkPose> walkSnap = new ArrayList<>(walkRingPoses);
        final List<float[]> groundSnap = new ArrayList<>(groundSampleGrid.values());
        final List<float[]> extraSnap = new ArrayList<>(extraVioCloud);

        if (visionExecutor != null && !visionExecutor.isShutdown()) {
            visionExecutor.execute(() -> {
                try {
                    final List<float[]> pts = offlineEngine.getIncrementalPointsSnapshot();
                    pts.addAll(extraSnap);
                    if (pts.size() >= 20) {
                        final WalkRingToeSolver.MetrologyResult liveRes = WalkRingToeSolver.solve(
                            pts, walkSnap, groundSnap, hasScaleAnchor, -1.0
                        );
                        if (liveRes.liveOverlay != null && renderer != null) {
                            renderer.updateLiveOverlay(liveRes.liveOverlay);
                        }
                        synchronized (stateLock) {
                            liveEstDiameterM = (float) Math.max(liveRes.dimA, liveRes.dimB);
                            liveEstHeightM = (float) liveRes.dimH;
                            liveEstVolumeM3 = (float) liveRes.volumeM3;
                        }
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "Live 3D overlay solve failed", t);
                } finally {
                    liveOverlayBusy.set(false);
                }
            });
        } else {
            liveOverlayBusy.set(false);
        }
    }

    private void collectFilteredGroundPlanes(final Session activeSession, final float maxAllowedY) {
        if (activeSession == null || groundSampleGrid.size() >= MAX_GROUND_SAMPLES) {
            return;
        }
        try {
            final float[] localPt = new float[3];
            final float[] worldPt = new float[3];
            for (Plane plane : activeSession.getAllTrackables(Plane.class)) {
                if (
                    plane.getTrackingState() != TrackingState.TRACKING ||
                    plane.getSubsumedBy() != null ||
                    plane.getType() != Plane.Type.HORIZONTAL_UPWARD_FACING
                ) {
                    continue;
                }
                final Pose centerPose = plane.getCenterPose();
                if (centerPose == null) {
                    continue;
                }
                addFilteredGroundSample(centerPose.getTranslation(), maxAllowedY);

                final FloatBuffer poly = plane.getPolygon();
                final int limit = poly != null ? poly.limit() : 0;
                for (int i = 0; i + 1 < limit && groundSampleGrid.size() < MAX_GROUND_SAMPLES; i += 2) {
                    localPt[0] = poly.get(i);
                    localPt[1] = 0.0f;
                    localPt[2] = poly.get(i + 1);
                    centerPose.transformPoint(localPt, 0, worldPt, 0);
                    addFilteredGroundSample(worldPt, maxAllowedY);
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "Ground plane sample failed", t);
        }
    }

    /**
     * Enforces y <= y_cam - 0.80f AND always retains the minimum Y per 0.25m 2D cell
     * (never freezes an elevated plateau plane above the true pad).
     */
    private void addFilteredGroundSample(final float[] pt, final float maxAllowedY) {
        if (pt[1] > maxAllowedY) {
            return;
        }
        final float cell = 0.25f;
        final int gx = (int) Math.floor(pt[0] / cell);
        final int gz = (int) Math.floor(pt[2] / cell);
        final long key = (((long) (gx & 0xFFFFFFFFL)) << 32) | ((long) (gz & 0xFFFFFFFFL));
        final float[] existing = groundSampleGrid.get(key);
        if (existing == null) {
            if (groundSampleGrid.size() < MAX_GROUND_SAMPLES) {
                groundSampleGrid.put(key, new float[] { pt[0], pt[1], pt[2] });
            }
        } else if (pt[1] < existing[1]) {
            existing[0] = pt[0];
            existing[1] = pt[1];
            existing[2] = pt[2];
        }
    }

    private void finalizeAndReturnScanAsync() {
        final ExecutorService bg = Executors.newSingleThreadExecutor();
        bg.execute(() -> {
            try {
                // Wait for pending keyframe WebP writes and Stage 0 triangulations off Main Thread
                if (ioExecutor != null && !ioExecutor.isShutdown()) {
                    ioExecutor.shutdown();
                    ioExecutor.awaitTermination(6, TimeUnit.SECONDS);
                }
                if (visionExecutor != null && !visionExecutor.isShutdown()) {
                    visionExecutor.shutdown();
                    visionExecutor.awaitTermination(4, TimeUnit.SECONDS);
                }

                final List<WalkRingToeSolver.WalkPose> walkSnap;
                final List<float[]> groundSnap;
                final List<float[]> extraSnap;
                final List<KeyframeRecord> kfSnap;
                final int coveredSnap;
                final int blurSnap;
                final boolean anchorSnap;
                synchronized (stateLock) {
                    walkSnap = new ArrayList<>(walkRingPoses);
                    groundSnap = new ArrayList<>(groundSampleGrid.values());
                    extraSnap = new ArrayList<>(extraVioCloud);
                    kfSnap = new ArrayList<>(savedKeyframes);
                    coveredSnap = sectorsCovered;
                    blurSnap = rejectedBlurCount;
                    anchorSnap = hasScaleAnchor;
                }

                final boolean thermalDegraded = isThermallyThrottled();
                final OfflineVioMvsEngine.EngineOutput engineOut = offlineEngine.solveFullOffline(
                    walkSnap,
                    groundSnap,
                    extraSnap,
                    anchorSnap,
                    thermalDegraded
                );

                final JSONObject payload = buildScanResultJsonV2(
                    engineOut,
                    walkSnap,
                    kfSnap,
                    coveredSnap,
                    blurSnap
                );

                final File resultFile = new File(getCacheDir(), scanId + "_result.json");
                try (FileOutputStream fos = new FileOutputStream(resultFile)) {
                    fos.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                    fos.flush();
                }

                mainHandler.post(() -> {
                    final Intent resultIntent = new Intent();
                    resultIntent.putExtra(EXTRA_RESULT_FILE_PATH, resultFile.getAbsolutePath());
                    setResult(RESULT_OK, resultIntent);
                    finish();
                });
            } catch (Throwable t) {
                Log.e(TAG, "Failed to finalize spatial scan", t);
                final String msg = t.getMessage() != null ? t.getMessage() : "Spatial scan finalization failed";
                mainHandler.post(() -> finishWithError("SCAN_FINALIZE_FAILED", msg));
            } finally {
                bg.shutdown();
            }
        });
    }

    private boolean isThermallyThrottled() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                final PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    return pm.getCurrentThermalStatus() >= PowerManager.THERMAL_STATUS_MODERATE;
                }
            } catch (Exception ignored) {
            }
        }
        return false;
    }

    private JSONObject buildScanResultJsonV2(
        final OfflineVioMvsEngine.EngineOutput engineOut,
        final List<WalkRingToeSolver.WalkPose> walkSnap,
        final List<KeyframeRecord> kfSnap,
        final int covered,
        final int blurRejected
    ) throws Exception {
        final WalkRingToeSolver.MetrologyResult m = engineOut.metrology;
        final JSONObject root = new JSONObject();

        final String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER : "";
        final String model = Build.MODEL != null ? Build.MODEL : "";
        final String deviceModel = (manufacturer + " " + model).trim();
        final double coveragePct = round1((covered / (double) SECTOR_COUNT) * 100.0);

        // Legacy fields preserved 100% for backwards compatibility
        root.put("cancelled", false);
        root.put("scanId", scanId);
        root.put("deviceModel", deviceModel);
        root.put("depthMode", configuredDepthMode);
        root.put("roiRadiusM", round3(m.roiRadiusM));
        root.put("sectorsTotal", SECTOR_COUNT);
        root.put("sectorsCovered", covered);
        root.put("coveragePct", coveragePct);
        root.put("keyframeCount", Math.max(1, kfSnap.size()));
        root.put("loopClosed", m.loopClosed);
        root.put("rejectedBlurCount", blurRejected);

        // V2 engine metadata
        root.put("scannerEngineVersion", SCANNER_ENGINE_VERSION);
        root.put("orientationMode", "sensorLandscape");
        root.put("hasHardwareDepthSensor", hasHardwareDepthSensor);
        root.put("captureImuPitchDeg", round1(computeMedianKeyframePitchDeg(kfSnap, liveImuPitchDeg)));

        // Optional stored calibration metadata (without pre-scaling coordinates)
        final SharedPreferences calPrefs = getSharedPreferences(PREFS_CALIBRATION_NAME, Context.MODE_PRIVATE);
        final boolean hasCal = calPrefs.getBoolean("calibrated", false);
        final float calScale = calPrefs.getFloat("scaleFactor", 1.0f);
        if (hasCal && calScale >= MIN_SCALE_FACTOR && calScale <= MAX_SCALE_FACTOR) {
            root.put("calibrationScaleFactor", round4(calScale));
            root.put("calibrationPlaneNoiseRmsM", round4(calPrefs.getFloat("planeNoiseRmsM", 0.0f)));
            root.put("deviceCalibratedAt", calPrefs.getLong("calibratedAt", 0L));
        }

        final JSONObject anchorJson = new JSONObject();
        anchorJson.put("x", round3(m.anchorX));
        anchorJson.put("y", round3(m.anchorY));
        anchorJson.put("z", round3(m.anchorZ));
        root.put("anchorCenter", anchorJson);

        final JSONArray pointsArr = new JSONArray();
        for (float[] p : m.stratifiedPointsM) {
            final JSONArray pt = new JSONArray();
            pt.put(round3(p[0]));
            pt.put(round3(p[1]));
            pt.put(round3(p[2]));
            pointsArr.put(pt);
        }
        root.put("pointsM", pointsArr);

        final JSONArray groundArr = new JSONArray();
        for (float[] g : m.filteredGroundM) {
            final JSONArray pt = new JSONArray();
            pt.put(round3(g[0]));
            pt.put(round3(g[1]));
            pt.put(round3(g[2]));
            groundArr.put(pt);
        }
        root.put("groundSamplesM", groundArr);

        // Walk-ring trajectory poses
        final JSONArray walkArr = new JSONArray();
        for (WalkRingToeSolver.WalkPose wp : walkSnap) {
            final JSONObject wj = new JSONObject();
            wj.put("x", round3(wp.x));
            wj.put("y", round3(wp.y));
            wj.put("z", round3(wp.z));
            wj.put("fx", round4(wp.fwdX));
            wj.put("fy", round4(wp.fwdY));
            wj.put("fz", round4(wp.fwdZ));
            wj.put("ts", wp.timestampNs);
            walkArr.put(wj);
        }
        root.put("walkRingPoses", walkArr);

        // Legacy keyframes + full V2 unrotated WebP keyframes with SE(3) + intrinsics + CAS stats
        final JSONArray kfLegacyArr = new JSONArray();
        final JSONArray kfV2Arr = new JSONArray();
        for (KeyframeRecord rec : kfSnap) {
            final File photoFile = new File(rec.photoPath);
            if (!photoFile.exists() || photoFile.length() <= 0L) {
                continue;
            }
            final JSONObject legacyObj = new JSONObject();
            legacyObj.put("index", rec.index);
            legacyObj.put("angleDeg", rec.angleDeg);
            legacyObj.put("blurScore", rec.blurScore);
            legacyObj.put("photoPath", rec.photoPath);
            kfLegacyArr.put(legacyObj);

            final JSONObject v2Obj = new JSONObject();
            v2Obj.put("index", rec.index);
            v2Obj.put("angleDeg", rec.angleDeg);
            v2Obj.put("blurScore", rec.blurScore);
            v2Obj.put("photoPath", rec.photoPath);
            v2Obj.put("mimeType", "image/webp");
            v2Obj.put("displayRotationDeg", rec.displayRotationDeg);
            v2Obj.put("timestampNs", rec.timestampNs);
            v2Obj.put("imuPitchDeg", rec.imuPitchDeg);
            v2Obj.put("imuRollDeg", rec.imuRollDeg);
            v2Obj.put("originalBytes", rec.originalBytes);
            v2Obj.put("optimizedBytes", rec.optimizedBytes > 0 ? rec.optimizedBytes : (int) photoFile.length());
            v2Obj.put("savingsPct", round1(rec.savingsPct));
            if (rec.sha256 != null) {
                v2Obj.put("sha256", rec.sha256);
            }

            final JSONObject poseObj = new JSONObject();
            final JSONArray rArr = new JSONArray();
            for (float rv : rec.rWc) rArr.put(round5(rv));
            final JSONArray tArr = new JSONArray();
            for (float tv : rec.tWc) tArr.put(round4(tv));
            poseObj.put("r", rArr);
            poseObj.put("t", tArr);
            v2Obj.put("poseSE3", poseObj);

            final JSONObject intrObj = new JSONObject();
            intrObj.put("fx", round2(rec.fx));
            intrObj.put("fy", round2(rec.fy));
            intrObj.put("cx", round2(rec.cx));
            intrObj.put("cy", round2(rec.cy));
            intrObj.put("width", rec.imgWidth);
            intrObj.put("height", rec.imgHeight);
            v2Obj.put("intrinsics", intrObj);

            kfV2Arr.put(v2Obj);
        }
        root.put("keyframes", kfLegacyArr);
        root.put("keyframesV2", kfV2Arr);

        // V2 In-Situ Offline Metrology block (aligned with Frontend + Backend CaptureSessionPackageV2)
        final JSONObject metObj = new JSONObject();
        metObj.put("volumeM3", round3(m.volumeM3));
        metObj.put("footprintAreaM2", round3(m.footprintAreaM2));
        metObj.put("baseLengthM", round2(m.dimA));
        metObj.put("baseWidthM", round2(m.dimB));
        metObj.put("heightMaxM", round2(m.dimH));
        final JSONObject dimsObj = new JSONObject();
        dimsObj.put("a", round2(m.dimA));
        dimsObj.put("b", round2(m.dimB));
        dimsObj.put("h", round2(m.dimH));
        metObj.put("dimensionsM", dimsObj);
        metObj.put("groundSlopeDeg", round2(m.groundSlopeDeg));
        final JSONObject metGroundPlane = new JSONObject();
        metGroundPlane.put("a", round5(m.planeA));
        metGroundPlane.put("b", round5(m.planeB));
        metGroundPlane.put("d", round4(m.planeD));
        metGroundPlane.put("slopeDeg", round2(m.groundSlopeDeg));
        metGroundPlane.put("toeScore", round1(m.toeScore));
        metObj.put("groundPlane", metGroundPlane);
        metObj.put("slopeAngleAvgDeg", round2(m.slopeAngleAvgDeg));
        metObj.put("toeScore", round1(m.toeScore));
        metObj.put("coveragePct", coveragePct);
        metObj.put("sectorsCovered", covered);
        metObj.put("loopClosed", m.loopClosed);
        metObj.put("computedAt", System.currentTimeMillis());
        metObj.put("occludedVolumePct", round1(m.occludedVolumePct));
        metObj.put("zeroCellsInside", m.zeroCellsInside);
        metObj.put("loopDriftPct", round2(m.loopDriftPct));
        metObj.put("planeMismatchDeg", round2(m.planeMismatchDeg));
        metObj.put("uncertaintyPct", round1(m.uncertaintyPct));
        metObj.put("metrologyGrade", m.metrologyGrade);
        metObj.put("wallConfinement", m.wallConfinement);
        metObj.put("observedCells", m.observedCells);
        metObj.put("totalFootprintCells", m.totalFootprintCells);
        metObj.put("densePointsCount", m.densePointsCount);
        metObj.put("sparseTriangulatedCount", engineOut.sparseTriangulatedCount);
        metObj.put("denseMvsCount", engineOut.denseMvsCount);
        metObj.put("computeMs", engineOut.computeMs);
        metObj.put("thermalDegraded", engineOut.thermalDegraded);
        root.put("inSituMetrology", metObj);

        // V2 Compact Local Preview Mesh (< 60 KB dem_grid_v1)
        if (m.previewMesh != null) {
            final WalkRingToeSolver.LocalPreviewMesh pm = m.previewMesh;
            final JSONObject meshObj = new JSONObject();
            meshObj.put("format", pm.format);
            meshObj.put("originX", round3(pm.originX));
            meshObj.put("originZ", round3(pm.originZ));
            meshObj.put("cellSizeM", round3(pm.cellSizeM));
            meshObj.put("cols", pm.cols);
            meshObj.put("rows", pm.rows);
            meshObj.put("nx", pm.cols);
            meshObj.put("nz", pm.rows);
            final JSONObject meshGroundPlane = new JSONObject();
            meshGroundPlane.put("a", round5(pm.planeA));
            meshGroundPlane.put("b", round5(pm.planeB));
            meshGroundPlane.put("d", round4(pm.planeD));
            meshObj.put("groundPlane", meshGroundPlane);
            meshObj.put("groundSlopeDeg", round2(pm.groundSlopeDeg));
            meshObj.put("volumeM3", round3(pm.volumeM3));
            meshObj.put("maxHeightM", round3(pm.maxHeightM));

            final JSONArray hArr = new JSONArray();
            for (float hv : pm.heightsM) hArr.put(round3(hv));
            meshObj.put("heightsM", hArr);

            final JSONArray obsArr = new JSONArray();
            for (byte ov : pm.observedMask) obsArr.put(ov != 0 ? 1 : 0);
            meshObj.put("observedMask", obsArr);

            final JSONArray confArr = new JSONArray();
            for (byte cv : pm.confidenceMask) confArr.put(cv & 0xFF);
            meshObj.put("confidenceMask", confArr);

            root.put("localPreviewMesh", meshObj);
        }

        return root;
    }

    private void updateHudThrottled(final boolean force) {
        final long now = SystemClock.elapsedRealtime();
        if (!force && (now - lastUiUpdateAtMs) < 180L) {
            return;
        }
        lastUiUpdateAtMs = now;
        runOnUiThread(() -> updateHudFromState(false));
    }

    private void triggerCaptureFlash() {
        if (captureFlashBorderView == null) {
            return;
        }
        mainHandler.removeCallbacks(hideCaptureFlashRunnable);
        captureFlashBorderView.setVisibility(View.VISIBLE);
        mainHandler.postDelayed(hideCaptureFlashRunnable, CAPTURE_FLASH_DURATION_MS);
    }

    private static String mapTrackingFailureCode(final TrackingFailureReason reason) {
        if (reason == null) {
            return "AR · VIO";
        }
        switch (reason) {
            case INSUFFICIENT_LIGHT:
                return "AR · LUX";
            case EXCESSIVE_MOTION:
                return "AR · IMU";
            case INSUFFICIENT_FEATURES:
            case CAMERA_UNAVAILABLE:
            case BAD_STATE:
            case NONE:
            default:
                return "AR · VIO";
        }
    }

    private void updateHudFromState(final boolean ignoreFinishing) {
        final FlowStep step;
        final boolean isTracking;
        final TrackingFailureReason failureReason;
        final boolean isArmedStart;
        final int[] statesSnap = new int[SECTOR_COUNT];
        final int covered;
        final int kfCount;
        final float heading;
        final float diam;
        final float height;
        final float vol;
        final boolean showSpeed;
        final boolean showAnchor;
        final float calDist;
        final boolean hasCalHit;
        final String captureDiagCode;
        final String renderErrCode;
        final boolean showMinKfHint;
        final float distM;
        final int livePtsCount;
        final long frameCount;
        final long nowMs = SystemClock.elapsedRealtime();

        synchronized (stateLock) {
            if (!ignoreFinishing && finishing && currentStep != FlowStep.FINALIZING) {
                return;
            }
            step = currentStep;
            isTracking = lastTrackingState == TrackingState.TRACKING;
            failureReason = lastTrackingFailureReason;
            isArmedStart = pendingStartCapture;
            System.arraycopy(sectorStates, 0, statesSnap, 0, SECTOR_COUNT);
            covered = sectorsCovered;
            kfCount = savedKeyframes.size();
            heading = liveHeadingDeg;
            diam = liveEstDiameterM;
            height = liveEstHeightM;
            vol = liveEstVolumeM3;
            showSpeed = (nowMs - lastSpeedAlertAtMs) < 1400L;
            showAnchor = hasScaleAnchor;
            calDist = liveCalDistanceM;
            hasCalHit = latestCalHit != null;
            captureDiagCode = (step == FlowStep.CAPTURING_WALK && burstState.shouldShowDiagCode(nowMs))
                ? burstState.getLastDiagCode()
                : null;
            renderErrCode = (lastRenderErrorCode != null && (nowMs - lastRenderErrorAtMs) < 4000L)
                ? lastRenderErrorCode
                : null;
            showMinKfHint = step == FlowStep.CAPTURING_WALK &&
                lastMinKfHintAtMs > 0L &&
                (nowMs - lastMinKfHintAtMs) < 1600L;
            distM = walkDistanceM;
            livePtsCount = livePointAccumulator.size();
            frameCount = arFrameCounter;
        }

        imuHorizonView.updateImu(liveImuPitchDeg, liveImuRollDeg);
        trackingIcon.setColorFilter(isTracking ? COLOR_CYAN : COLOR_COPPER);
        if (!isTracking) {
            trackingCodeText.setText(mapTrackingFailureCode(failureReason));
            trackingCodeText.setTextColor(COLOR_COPPER);
            trackingCodeText.setVisibility(View.VISIBLE);
        } else if (renderErrCode != null) {
            trackingCodeText.setText(renderErrCode);
            trackingCodeText.setTextColor(COLOR_COPPER);
            trackingCodeText.setVisibility(View.VISIBLE);
        } else if (showMinKfHint) {
            trackingCodeText.setText("MIN 4 KF");
            trackingCodeText.setTextColor(COLOR_COPPER);
            trackingCodeText.setVisibility(View.VISIBLE);
        } else if (captureDiagCode != null) {
            trackingCodeText.setText(captureDiagCode);
            trackingCodeText.setTextColor(COLOR_COPPER);
            trackingCodeText.setVisibility(View.VISIBLE);
        } else {
            trackingCodeText.setVisibility(View.GONE);
        }
        speedAlertIcon.setVisibility(showSpeed ? View.VISIBLE : View.GONE);
        anchorDetectedIcon.setVisibility(showAnchor ? View.VISIBLE : View.GONE);

        final Live3DOverlayRenderer.FramingStatus framing = renderer != null
            ? renderer.getLastFramingStatus()
            : new Live3DOverlayRenderer.FramingStatus(false, false);
        final boolean showCrownGuard = step == FlowStep.CAPTURING_WALK && framing.crownClipped;
        final boolean showToeGuard = step == FlowStep.CAPTURING_WALK && framing.toeClipped;
        crownBorderLine.setVisibility(showCrownGuard ? View.VISIBLE : View.GONE);
        crownGuardIcon.setVisibility(showCrownGuard ? View.VISIBLE : View.GONE);
        toeBorderLine.setVisibility(showToeGuard ? View.VISIBLE : View.GONE);
        toeGuardIcon.setVisibility(showToeGuard ? View.VISIBLE : View.GONE);

        if (step == FlowStep.READY_TRACKING) {
            finalizingBar.setVisibility(View.GONE);
            perimeterRingView.setVisibility(View.VISIBLE);
            perimeterRingView.updateState(statesSnap, heading, false, 0, false, "--");
            liveVolumeText.setText("--.- m³");
            liveVolumeText.setTextColor(COLOR_DISABLED);
            liveDimsText.setText("Ø --.- m · H --.- m");
            liveKfCountText.setText("0 KF");
            liveKfCountText.setTextColor(COLOR_DISABLED);
            hudBuildHeartbeatText.setText(String.format(Locale.US, "2.0.3 · %d PTS", livePtsCount));
            hudBuildHeartbeatText.setVisibility(View.VISIBLE);

            // Always clickable in READY_TRACKING so operator can arm pendingStartCapture before TRACKING locks
            primaryActionButton.setEnabled(true);
            if (isTracking) {
                applyPrimaryButtonStyle(COLOR_COPPER, 0, 0, R.drawable.ic_ms_play_arrow, Color.BLACK);
            } else if (isArmedStart) {
                applyPrimaryButtonStyle(COLOR_BTN_WAITING_BG, COLOR_COPPER, 2, R.drawable.ic_ms_play_arrow, COLOR_COPPER);
            } else {
                applyPrimaryButtonStyle(COLOR_BTN_WAITING_BG, COLOR_DISABLED, 1, R.drawable.ic_ms_play_arrow, COLOR_SECONDARY);
            }
        } else if (step == FlowStep.CAPTURING_WALK) {
            finalizingBar.setVisibility(View.GONE);
            final int pctInt = (int) Math.round((covered / (double) SECTOR_COUNT) * 100.0);
            final boolean optimalReady = pctInt >= 75 && kfCount >= 12;
            final boolean minReady = (kfCount >= 6 && covered >= 4) || (kfCount >= 4 && covered >= 3);

            perimeterRingView.setVisibility(View.VISIBLE);
            perimeterRingView.updateState(statesSnap, heading, true, pctInt, optimalReady, null);

            // Anti-false-volume rule: show ~XX.X m³ in neutral #F3F4F6 ONLY at >= 75% coverage
            if (pctInt >= 75 && vol > 0.05f) {
                liveVolumeText.setText(String.format(Locale.US, "~%.1f m³", vol));
                liveVolumeText.setTextColor(COLOR_PRIMARY);
            } else {
                liveVolumeText.setText("--.- m³");
                liveVolumeText.setTextColor(COLOR_DISABLED);
            }

            if (covered >= 3 && diam > 0.1f) {
                liveDimsText.setText(String.format(Locale.US, "Ø %.1f m · H %.1f m", diam, height));
            } else {
                liveDimsText.setText("Ø --.- m · H --.- m");
            }
            liveKfCountText.setText(String.format(Locale.US, "%d KF · %.1f m", kfCount, distM));
            liveKfCountText.setTextColor(kfCount > 0 ? COLOR_PRIMARY : COLOR_COPPER);
            hudBuildHeartbeatText.setText(String.format(Locale.US, "2.0.3 · %d PTS · F%d", livePtsCount, frameCount));
            hudBuildHeartbeatText.setVisibility(View.VISIBLE);

            primaryActionButton.setEnabled(true);
            if (minReady) {
                applyPrimaryButtonStyle(COLOR_CYAN, 0, 0, R.drawable.ic_ms_check, Color.BLACK);
            } else {
                applyPrimaryButtonStyle(COLOR_BTN_RECORDING_BG, COLOR_COPPER, 2, R.drawable.ic_ms_stop, COLOR_COPPER);
            }
        } else if (step == FlowStep.FINALIZING) {
            finalizingBar.setVisibility(View.VISIBLE);
            primaryActionButton.setEnabled(false);
            applyPrimaryButtonStyle(COLOR_BTN_WAITING_BG, COLOR_DISABLED, 1, R.drawable.ic_ms_check, COLOR_SECONDARY);
        } else {
            // Optional diagnostic calibration mode (2.00 m)
            perimeterRingView.setVisibility(View.GONE);
            calCrosshairView.setVisibility(View.VISIBLE);
            calCrosshairView.setAccentColor(hasCalHit ? COLOR_CYAN : COLOR_COPPER);
            finalizingBar.setVisibility(step == FlowStep.CAL_FLOOR ? View.VISIBLE : View.GONE);

            if (step == FlowStep.CAL_END && calDist > 0.0f) {
                liveVolumeText.setText(String.format(Locale.US, "%.2f m", calDist));
                liveVolumeText.setTextColor(COLOR_CYAN);
            } else if (step == FlowStep.CAL_FLOOR_ERROR || step == FlowStep.CAL_RANGE_ERROR) {
                liveVolumeText.setText("ERR");
                liveVolumeText.setTextColor(COLOR_COPPER);
            } else {
                liveVolumeText.setText("2.00 m");
                liveVolumeText.setTextColor(COLOR_PRIMARY);
            }
            liveDimsText.setText(step.name());
            liveKfCountText.setText("");

            final boolean calBtnEnabled = step != FlowStep.CAL_FLOOR;
            primaryActionButton.setEnabled(calBtnEnabled);
            final int calIcon = step == FlowStep.CAL_END ? R.drawable.ic_ms_check : R.drawable.ic_ms_play_arrow;
            if (calBtnEnabled) {
                applyPrimaryButtonStyle(COLOR_COPPER, 0, 0, calIcon, Color.BLACK);
            } else {
                applyPrimaryButtonStyle(COLOR_BTN_WAITING_BG, COLOR_DISABLED, 1, calIcon, COLOR_SECONDARY);
            }
        }
    }

    // --- Calibration Helpers ---

    private float[] resolveCalibrationFloorHit(final Frame frame, final Camera camera) {
        final int vw = renderer != null ? renderer.getViewportWidth() : 0;
        final int vh = renderer != null ? renderer.getViewportHeight() : 0;
        if (vw > 0 && vh > 0) {
            try {
                final List<HitResult> hits = frame.hitTest(vw * 0.5f, vh * 0.5f);
                for (HitResult hit : hits) {
                    final Trackable t = hit.getTrackable();
                    if (
                        t instanceof Plane &&
                        ((Plane) t).getType() == Plane.Type.HORIZONTAL_UPWARD_FACING &&
                        ((Plane) t).isPoseInPolygon(hit.getHitPose())
                    ) {
                        final float dist = hit.getDistance();
                        if (dist >= MIN_DEPTH_M && dist <= MAX_DEPTH_M) {
                            return hit.getHitPose().getTranslation();
                        }
                    }
                }
                for (HitResult hit : hits) {
                    final Trackable t = hit.getTrackable();
                    if (t instanceof DepthPoint || t instanceof Point) {
                        final float dist = hit.getDistance();
                        if (dist >= MIN_DEPTH_M && dist <= MAX_DEPTH_M) {
                            return hit.getHitPose().getTranslation();
                        }
                    }
                }
            } catch (Exception ignored) {
            }
        }
        return null;
    }

    private void collectCalibrationFloorSamples(final Session activeSession, final Frame frame, final Camera camera) {
        if (calFloorSamples.size() >= 300) return;
        for (Plane plane : activeSession.getAllTrackables(Plane.class)) {
            if (
                plane.getTrackingState() == TrackingState.TRACKING &&
                plane.getSubsumedBy() == null &&
                plane.getType() == Plane.Type.HORIZONTAL_UPWARD_FACING
            ) {
                final Pose cp = plane.getCenterPose();
                calFloorSamples.add(cp.getTranslation());
                final FloatBuffer poly = plane.getPolygon();
                final float[] lp = new float[3];
                final float[] wp = new float[3];
                for (int i = 0; i + 1 < poly.limit() && calFloorSamples.size() < 300; i += 2) {
                    lp[0] = poly.get(i);
                    lp[1] = 0.0f;
                    lp[2] = poly.get(i + 1);
                    cp.transformPoint(lp, 0, wp, 0);
                    calFloorSamples.add(new float[] { wp[0], wp[1], wp[2] });
                }
            }
        }
        if (calFloorSamples.size() < 12) {
            try (PointCloud pc = frame.acquirePointCloud()) {
                final FloatBuffer pts = pc.getPoints();
                for (int i = 0; i + 3 < pts.limit() && calFloorSamples.size() < 300; i += 4) {
                    if (pts.get(i + 3) >= 0.5f) {
                        calFloorSamples.add(new float[] { pts.get(i), pts.get(i + 1), pts.get(i + 2) });
                    }
                }
            } catch (Exception ignored) {
            }
        }
    }

    private boolean evaluateCalibrationFloorNoise() {
        final int n = calFloorSamples.size();
        if (n < 12) {
            calPlaneNoiseRmsM = 0.099f;
            return false;
        }
        final double[] coeffs = WalkRingToeSolver.fitPlaneOLS(calFloorSamples);
        final double a = coeffs != null ? coeffs[0] : 0.0;
        final double b = coeffs != null ? coeffs[1] : 0.0;
        double sumY = 0.0;
        for (float[] p : calFloorSamples) sumY += p[1];
        final double d = coeffs != null ? coeffs[2] : (sumY / n);

        double sumSq = 0.0;
        final double normScale = 1.0 / Math.sqrt(1.0 + a * a + b * b);
        for (float[] p : calFloorSamples) {
            final double err = (p[1] - (a * p[0] + b * p[2] + d)) * normScale;
            sumSq += err * err;
        }
        calPlaneNoiseRmsM = (float) Math.sqrt(sumSq / n);
        calImuPitchOffsetDeg = (float) Math.toDegrees(Math.atan(b));
        calImuRollOffsetDeg = (float) Math.toDegrees(Math.atan(a));
        return calPlaneNoiseRmsM <= MAX_CAL_FLOOR_NOISE_RMS_M;
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
            Log.e(TAG, "Failed to finalize calibration", e);
            finishWithError(
                "CALIBRATION_FINALIZE_FAILED",
                e.getMessage() != null ? e.getMessage() : "Calibration finalization failed"
            );
        }
    }

    // --- Image & Geometry Utilities ---

    /**
     * Saves UNROTATED WebP (1:1 match with camera.getImageIntrinsics() and camera.getPose(),
     * preventing ROTATION_270 180-degree pose inversion) with CAS SHA-256 and weight traceability.
     */
    @SuppressWarnings("deprecation")
    private static void saveUnrotatedWebpWithCasStats(
        final byte[] nv21,
        final int srcW,
        final int srcH,
        final int targetW,
        final int targetH,
        final File outFile,
        final KeyframeRecord rec
    ) {
        Bitmap decoded = null;
        Bitmap scaled = null;
        try {
            final YuvImage yuvImage = new YuvImage(nv21, ImageFormat.NV21, srcW, srcH, null);
            final ByteArrayOutputStream rawOut = new ByteArrayOutputStream();
            yuvImage.compressToJpeg(new Rect(0, 0, srcW, srcH), 92, rawOut);
            final byte[] tmpJpeg = rawOut.toByteArray();

            decoded = BitmapFactory.decodeByteArray(tmpJpeg, 0, tmpJpeg.length);
            if (decoded == null) return;

            Bitmap current = decoded;
            if (decoded.getWidth() != targetW || decoded.getHeight() != targetH) {
                scaled = Bitmap.createScaledBitmap(decoded, targetW, targetH, true);
                current = scaled;
            }

            final ByteArrayOutputStream webpOut = new ByteArrayOutputStream(65536);
            final Bitmap.CompressFormat fmt = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? Bitmap.CompressFormat.WEBP_LOSSY
                : Bitmap.CompressFormat.WEBP;
            current.compress(fmt, WEBP_QUALITY, webpOut);
            final byte[] webpBytes = webpOut.toByteArray();

            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                fos.write(webpBytes);
                fos.flush();
            }

            rec.optimizedBytes = webpBytes.length;
            rec.savingsPct = rec.originalBytes > 0
                ? Math.max(0.0, (1.0 - (webpBytes.length / (double) rec.originalBytes)) * 100.0)
                : 0.0;
            rec.sha256 = sha256Hex(webpBytes);
        } catch (Throwable t) {
            Log.w(TAG, "Failed to encode/save keyframe WebP", t);
        } finally {
            if (scaled != null && scaled != decoded) scaled.recycle();
            if (decoded != null) decoded.recycle();
        }
    }

    private static String sha256Hex(final byte[] data) {
        try {
            final MessageDigest md = MessageDigest.getInstance("SHA-256");
            final byte[] digest = md.digest(data);
            final StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format(Locale.US, "%02x", b & 0xFF));
            }
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private static float[] poseToRowMajorRotation3x3(final Pose pose) {
        final float[] m = new float[16];
        pose.toMatrix(m, 0); // column-major OpenGL 4x4
        return new float[] {
            m[0], m[4], m[8],
            m[1], m[5], m[9],
            m[2], m[6], m[10]
        };
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

    private void triggerRejectHaptic() {
        if (rootView != null) {
            final int feedback = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? HapticFeedbackConstants.REJECT
                : HapticFeedbackConstants.LONG_PRESS;
            rootView.performHapticFeedback(
                feedback,
                HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING
            );
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
                        if (sensorOrientation != null) return sensorOrientation;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return 90;
    }

    private static float computeMedianKeyframePitchDeg(
        final List<KeyframeRecord> kfSnap,
        final float fallbackPitchDeg
    ) {
        if (kfSnap == null || kfSnap.isEmpty()) {
            return fallbackPitchDeg;
        }
        final float[] pitches = new float[kfSnap.size()];
        for (int i = 0; i < kfSnap.size(); i++) {
            pitches[i] = kfSnap.get(i).imuPitchDeg;
        }
        Arrays.sort(pitches);
        return pitches[pitches.length / 2];
    }

    private static float clamp(final float v, final float min, final float max) {
        return Math.max(min, Math.min(max, v));
    }

    private static float dist3D(final float[] a, final float[] b) {
        final float dx = b[0] - a[0];
        final float dy = b[1] - a[1];
        final float dz = b[2] - a[2];
        return (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    private static double computeSectorAngleDeg(final float[] camPos, final float[] centerXZ) {
        final double dx = camPos[0] - centerXZ[0];
        final double dz = camPos[2] - centerXZ[1];
        double deg = Math.toDegrees(Math.atan2(dz, dx));
        if (deg < 0.0) deg += 360.0;
        return deg;
    }

    private static float round1f(final float val) {
        return Math.round(val * 10.0f) / 10.0f;
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

    private static double round5(final double val) {
        return Math.round(val * 100000.0) / 100000.0;
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
