package com.minreport.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Config;
import com.google.ar.core.Session;
import com.google.ar.core.exceptions.UnavailableDeviceNotCompatibleException;
import com.google.ar.core.exceptions.UnavailableUserDeclinedInstallationException;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Capacitor native bridge plugin for probing Android ARCore VIO, Depth API,
 * IMU sensors, and Camera2 hardware levels without blocking the UI thread.
 */
@CapacitorPlugin(name = "MinreportDeviceCapability")
public class MinreportDeviceCapabilityPlugin extends Plugin {

    private static final int MAX_AVAILABILITY_RETRIES = 3;
    private static final long AVAILABILITY_RETRY_DELAY_MS = 150L;
    private static final String PREFS_CAPABILITY_CACHE = "minreport_device_capability_cache";
    private static final String ARCORE_PACKAGE_NAME = "com.google.ar.core";
    private static final String KEY_ARCORE_VERSION = "arCoreApkVersion";
    private static final String KEY_DEPTH_API_SUPPORTED = "depthApiSupported";
    private static final String KEY_RAW_DEPTH_SUPPORTED = "rawDepthSupported";

    /**
     * Probes device hardware capabilities (ARCore, Depth API, IMU sensors, Camera2).
     */
    @PluginMethod
    public void getCapabilities(PluginCall call) {
        final Context rawContext = getContext();
        final Context appContext = rawContext != null
            ? (rawContext.getApplicationContext() != null ? rawContext.getApplicationContext() : rawContext)
            : null;

        if (appContext == null) {
            call.reject("Android context unavailable", "CONTEXT_UNAVAILABLE");
            return;
        }

        final Looper workerLooper = Looper.myLooper();
        final Handler handler = new Handler(workerLooper != null ? workerLooper : Looper.getMainLooper());
        probeAvailabilityWithRetry(appContext, handler, 0, call);
    }

    /**
     * Requests installation or update of Google Play Services for AR on the UI thread.
     */
    @PluginMethod
    public void requestArCoreInstall(PluginCall call) {
        final AppCompatActivity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            call.reject("Activity unavailable for ARCore installation prompt", "ACTIVITY_UNAVAILABLE");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                final ArCoreApk.InstallStatus installStatus = ArCoreApk.getInstance().requestInstall(activity, true);
                final JSObject result = new JSObject();
                result.put("status", installStatus != null ? installStatus.name() : "UNKNOWN");
                call.resolve(result);
            } catch (UnavailableUserDeclinedInstallationException e) {
                call.reject(
                    e.getMessage() != null ? e.getMessage() : "User declined ARCore installation",
                    "USER_DECLINED_INSTALLATION",
                    e
                );
            } catch (UnavailableDeviceNotCompatibleException e) {
                call.reject(
                    e.getMessage() != null ? e.getMessage() : "Device is not compatible with ARCore",
                    "DEVICE_NOT_COMPATIBLE",
                    e
                );
            } catch (Exception e) {
                call.reject(
                    e.getMessage() != null ? e.getMessage() : "Failed to request ARCore installation",
                    "ARCORE_INSTALL_ERROR",
                    e
                );
            }
        });
    }

    private void probeAvailabilityWithRetry(
        final Context appContext,
        final Handler handler,
        final int attempt,
        final PluginCall call
    ) {
        ArCoreApk.Availability availability;
        try {
            availability = ArCoreApk.getInstance().checkAvailability(appContext);
        } catch (Exception | LinkageError e) {
            availability = ArCoreApk.Availability.UNKNOWN_ERROR;
        }

        if (availability != null && availability.isTransient() && attempt < MAX_AVAILABILITY_RETRIES) {
            handler.postDelayed(
                () -> probeAvailabilityWithRetry(appContext, handler, attempt + 1, call),
                AVAILABILITY_RETRY_DELAY_MS
            );
            return;
        }

        final ArCoreApk.Availability finalAvailability =
            availability != null ? availability : ArCoreApk.Availability.UNKNOWN_ERROR;
        final Bridge currentBridge = getBridge();
        if (currentBridge != null) {
            currentBridge.execute(() -> buildAndResolveCapabilities(appContext, finalAvailability, call));
        } else {
            buildAndResolveCapabilities(appContext, finalAvailability, call);
        }
    }

    private void buildAndResolveCapabilities(
        final Context appContext,
        final ArCoreApk.Availability availability,
        final PluginCall call
    ) {
        try {
            final PackageManager pm = appContext.getPackageManager();
            final boolean hasGyroscope = pm != null && pm.hasSystemFeature(PackageManager.FEATURE_SENSOR_GYROSCOPE);
            final boolean hasAccelerometer =
                pm != null && pm.hasSystemFeature(PackageManager.FEATURE_SENSOR_ACCELEROMETER);
            final String camera2Level = detectRearCamera2Level(appContext);
            final boolean hasHardwareDepthSensor = detectRearHardwareDepthSensor(appContext);

            final boolean arCoreSupported = availability.isSupported();
            final Set<String> reasons = new LinkedHashSet<>();

            boolean depthApiSupported = false;
            boolean rawDepthSupported = false;
            boolean sessionProbeFailed = false;
            final boolean hasCameraPermission =
                ContextCompat.checkSelfPermission(appContext, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED;

            if (availability == ArCoreApk.Availability.SUPPORTED_INSTALLED) {
                if (hasCameraPermission) {
                    final String arCoreApkVersion = resolveArCoreApkVersion(pm);
                    final SharedPreferences cachePrefs =
                        appContext.getSharedPreferences(PREFS_CAPABILITY_CACHE, Context.MODE_PRIVATE);
                    final String cachedVersion = cachePrefs.getString(KEY_ARCORE_VERSION, null);
                    final boolean cacheHit =
                        arCoreApkVersion != null &&
                        arCoreApkVersion.equals(cachedVersion) &&
                        cachePrefs.contains(KEY_DEPTH_API_SUPPORTED);

                    if (cacheHit) {
                        depthApiSupported = cachePrefs.getBoolean(KEY_DEPTH_API_SUPPORTED, false);
                        rawDepthSupported = cachePrefs.getBoolean(KEY_RAW_DEPTH_SUPPORTED, false);
                    } else {
                        Session session = null;
                        try {
                            session = new Session(appContext);
                            depthApiSupported = session.isDepthModeSupported(Config.DepthMode.AUTOMATIC);
                            rawDepthSupported = session.isDepthModeSupported(Config.DepthMode.RAW_DEPTH_ONLY);
                            if (arCoreApkVersion != null) {
                                cachePrefs
                                    .edit()
                                    .putString(KEY_ARCORE_VERSION, arCoreApkVersion)
                                    .putBoolean(KEY_DEPTH_API_SUPPORTED, depthApiSupported)
                                    .putBoolean(KEY_RAW_DEPTH_SUPPORTED, rawDepthSupported)
                                    .apply();
                            }
                        } catch (Exception | UnsatisfiedLinkError e) {
                            sessionProbeFailed = true;
                            reasons.add("ARCORE_SESSION_PROBE_FAILED");
                        } finally {
                            if (session != null) {
                                try {
                                    session.close();
                                } catch (Exception ignored) {
                                    // Ignore cleanup failures during capability probe.
                                }
                            }
                        }
                    }
                } else {
                    reasons.add("CAMERA_PERMISSION_PENDING");
                }
            }

            final String tier;
            if (availability == ArCoreApk.Availability.UNSUPPORTED_DEVICE_NOT_CAPABLE || !hasGyroscope) {
                tier = "INCOMPATIBLE";
                if (availability == ArCoreApk.Availability.UNSUPPORTED_DEVICE_NOT_CAPABLE) {
                    reasons.add("ARCORE_UNSUPPORTED");
                } else if (
                    availability != ArCoreApk.Availability.SUPPORTED_INSTALLED &&
                    availability != ArCoreApk.Availability.SUPPORTED_APK_TOO_OLD &&
                    availability != ArCoreApk.Availability.SUPPORTED_NOT_INSTALLED
                ) {
                    reasons.add(availability.name());
                }
                if (!hasGyroscope) {
                    reasons.add("NO_GYROSCOPE");
                }
            } else if (
                availability == ArCoreApk.Availability.SUPPORTED_APK_TOO_OLD ||
                availability == ArCoreApk.Availability.SUPPORTED_NOT_INSTALLED
            ) {
                tier = "NEEDS_UPDATE";
                reasons.add("ARCORE_SERVICE_UPDATE_REQUIRED");
            } else if (availability == ArCoreApk.Availability.SUPPORTED_INSTALLED) {
                if (depthApiSupported) {
                    tier = "OPTIMAL_SPATIAL";
                } else {
                    tier = "COMPATIBLE_VIO";
                    if (hasCameraPermission && !sessionProbeFailed) {
                        reasons.add("NO_DEPTH_API");
                    }
                }
            } else {
                tier = "INCOMPATIBLE";
                reasons.add(availability.name());
            }

            final JSArray reasonsArray = new JSArray();
            for (String reason : reasons) {
                reasonsArray.put(reason);
            }

            final JSObject payload = new JSObject();
            payload.put("platform", "android");
            payload.put("manufacturer", Build.MANUFACTURER != null ? Build.MANUFACTURER : "");
            payload.put("model", Build.MODEL != null ? Build.MODEL : "");
            payload.put("device", Build.DEVICE != null ? Build.DEVICE : "");
            payload.put("sdkInt", Build.VERSION.SDK_INT);
            payload.put("arCoreAvailability", availability.name());
            payload.put("arCoreSupported", arCoreSupported);
            payload.put("depthApiSupported", depthApiSupported);
            payload.put("rawDepthSupported", rawDepthSupported);
            payload.put("hasHardwareDepthSensor", hasHardwareDepthSensor);
            payload.put("hasGyroscope", hasGyroscope);
            payload.put("hasAccelerometer", hasAccelerometer);
            payload.put("camera2Level", camera2Level);
            payload.put("tier", tier);
            payload.put("reasons", reasonsArray);

            call.resolve(payload);
        } catch (Exception e) {
            call.reject(
                e.getMessage() != null ? e.getMessage() : "Unexpected error probing device spatial capabilities",
                "CAPABILITY_PROBE_ERROR",
                e
            );
        }
    }

    @SuppressWarnings("deprecation")
    private static String resolveArCoreApkVersion(final PackageManager pm) {
        if (pm == null) {
            return null;
        }
        try {
            final PackageInfo info = pm.getPackageInfo(ARCORE_PACKAGE_NAME, 0);
            if (info == null) {
                return null;
            }
            final long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;
            final String versionName = info.versionName != null ? info.versionName : "";
            return versionName + ":" + versionCode;
        } catch (Exception ignored) {
            return null;
        }
    }

    private String detectRearCamera2Level(final Context context) {
        try {
            final CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
            if (cameraManager == null) {
                return "UNKNOWN";
            }
            final String[] cameraIds = cameraManager.getCameraIdList();
            if (cameraIds == null || cameraIds.length == 0) {
                return "NONE";
            }

            String bestLevel = null;
            int bestRank = -1;
            for (String cameraId : cameraIds) {
                final CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(cameraId);
                final Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
                if (facing == null || facing != CameraCharacteristics.LENS_FACING_BACK) {
                    continue;
                }
                final Integer level = characteristics.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL);
                final int rank = rankCamera2Level(level);
                if (rank > bestRank) {
                    bestRank = rank;
                    bestLevel = mapCamera2Level(level);
                }
            }
            return bestLevel != null ? bestLevel : "UNKNOWN";
        } catch (Exception e) {
            return "UNKNOWN";
        }
    }

    /**
     * Checks Camera2 hardware capabilities on rear-facing cameras for dedicated ToF / LiDAR depth output.
     */
    public static boolean detectRearHardwareDepthSensor(final Context context) {
        if (context == null) {
            return false;
        }
        try {
            final CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
            if (cameraManager == null) {
                return false;
            }
            final String[] cameraIds = cameraManager.getCameraIdList();
            if (cameraIds == null) {
                return false;
            }
            for (String cameraId : cameraIds) {
                final CameraCharacteristics chars = cameraManager.getCameraCharacteristics(cameraId);
                final Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
                if (facing == null || facing != CameraCharacteristics.LENS_FACING_BACK) {
                    continue;
                }
                final int[] capabilities = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES);
                if (capabilities == null) {
                    continue;
                }
                for (int cap : capabilities) {
                    if (cap == CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT) {
                        return true;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private int rankCamera2Level(final Integer level) {
        if (level == null) {
            return 0;
        }
        if (level == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3) {
            return 5;
        }
        if (level == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL) {
            return 4;
        }
        if (level == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED) {
            return 3;
        }
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            level == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_EXTERNAL
        ) {
            return 2;
        }
        if (level == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY) {
            return 1;
        }
        return 0;
    }

    private String mapCamera2Level(final Integer level) {
        if (level == null) {
            return "UNKNOWN";
        }
        if (level == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY) {
            return "LEGACY";
        }
        if (level == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED) {
            return "LIMITED";
        }
        if (level == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL) {
            return "FULL";
        }
        if (level == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3) {
            return "LEVEL_3";
        }
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            level == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_EXTERNAL
        ) {
            return "EXTERNAL";
        }
        return "UNKNOWN";
    }
}
