package com.minreport.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * Capacitor plugin launching the native ARCore VIO + Depth spatial scanner
 * and 2.00 m field calibration flows, and reading stored calibration state.
 */
@CapacitorPlugin(
    name = "MinreportSpatialScanner",
    permissions = {
        @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera")
    }
)
public class MinreportSpatialScannerPlugin extends Plugin {

    @PluginMethod
    public void startSpatialScan(final PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionCallback");
            return;
        }
        launchScannerActivity(call, MinreportSpatialScannerActivity.MODE_SCAN);
    }

    @PluginMethod
    public void startCalibration(final PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionCallback");
            return;
        }
        launchScannerActivity(call, MinreportSpatialScannerActivity.MODE_CALIBRATE);
    }

    @PluginMethod
    public void getCalibrationStatus(final PluginCall call) {
        final Context context = getContext();
        if (context == null) {
            call.reject("Android context unavailable", "CONTEXT_UNAVAILABLE");
            return;
        }

        final SharedPreferences prefs = context.getSharedPreferences(
            MinreportSpatialScannerActivity.PREFS_CALIBRATION_NAME,
            Context.MODE_PRIVATE
        );
        final boolean calibrated = prefs.getBoolean("calibrated", false);
        final float scaleFactor = prefs.getFloat("scaleFactor", 1.0f);
        final boolean valid = calibrated && scaleFactor >= 0.85f && scaleFactor <= 1.15f;

        final JSObject result = new JSObject();
        result.put("calibrated", valid);
        result.put("scaleFactor", valid ? round4(scaleFactor) : 1.0);
        result.put("referenceDistanceM", 2.0);
        if (valid) {
            result.put("measuredDistanceM", round4(prefs.getFloat("measuredDistanceM", 2.0f)));
            result.put("planeNoiseRmsM", round4(prefs.getFloat("planeNoiseRmsM", 0.0f)));
            result.put("imuPitchOffsetDeg", round2(prefs.getFloat("imuPitchOffsetDeg", 0.0f)));
            result.put("imuRollOffsetDeg", round2(prefs.getFloat("imuRollOffsetDeg", 0.0f)));
            result.put("calibratedAt", prefs.getLong("calibratedAt", 0L));
        } else {
            result.put("measuredDistanceM", JSONObject.NULL);
            result.put("planeNoiseRmsM", JSONObject.NULL);
            result.put("imuPitchOffsetDeg", JSONObject.NULL);
            result.put("imuRollOffsetDeg", JSONObject.NULL);
            result.put("calibratedAt", JSONObject.NULL);
        }
        call.resolve(result);
    }

    @PermissionCallback
    private void cameraPermissionCallback(final PluginCall call) {
        if (call == null) {
            return;
        }
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            call.reject("Camera permission is required for spatial scanning", "CAMERA_PERMISSION_DENIED");
            return;
        }
        final String mode = "startCalibration".equals(call.getMethodName())
            ? MinreportSpatialScannerActivity.MODE_CALIBRATE
            : MinreportSpatialScannerActivity.MODE_SCAN;
        launchScannerActivity(call, mode);
    }

    private void launchScannerActivity(final PluginCall call, final String mode) {
        final Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            call.reject("Activity unavailable to launch spatial scanner", "ACTIVITY_UNAVAILABLE");
            return;
        }

        final Intent intent = new Intent(activity, MinreportSpatialScannerActivity.class);
        intent.putExtra(MinreportSpatialScannerActivity.EXTRA_SCAN_MODE, mode);
        startActivityForResult(call, intent, "handleActivityResult");
    }

    @ActivityCallback
    private void handleActivityResult(final PluginCall call, final ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            final Intent data = result != null ? result.getData() : null;
            final String errorCode = data != null
                ? data.getStringExtra(MinreportSpatialScannerActivity.EXTRA_ERROR_CODE)
                : null;
            final String errorMessage = data != null
                ? data.getStringExtra(MinreportSpatialScannerActivity.EXTRA_ERROR_MESSAGE)
                : null;
            if ((errorCode != null && !errorCode.isEmpty()) || (errorMessage != null && !errorMessage.isEmpty())) {
                call.reject(
                    (errorMessage != null && !errorMessage.isEmpty())
                        ? errorMessage
                        : "Native spatial scanner failed",
                    (errorCode != null && !errorCode.isEmpty())
                        ? errorCode
                        : "SPATIAL_SCANNER_ERROR"
                );
                return;
            }
            final JSObject cancelledPayload = new JSObject();
            cancelledPayload.put("cancelled", true);
            call.resolve(cancelledPayload);
            return;
        }

        final String resultFilePath =
            result.getData().getStringExtra(MinreportSpatialScannerActivity.EXTRA_RESULT_FILE_PATH);
        if (resultFilePath == null || resultFilePath.isEmpty()) {
            call.reject("Spatial activity finished without result file", "SCAN_RESULT_MISSING");
            return;
        }

        final File resultFile = new File(resultFilePath);
        try {
            final String jsonText = readUtf8File(resultFile);
            final JSObject payload = new JSObject(jsonText);
            call.resolve(payload);
        } catch (Exception e) {
            call.reject(
                e.getMessage() != null ? e.getMessage() : "Failed to parse spatial activity payload",
                "SCAN_RESULT_PARSE_ERROR",
                e
            );
        } finally {
            if (resultFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                resultFile.delete();
            }
        }
    }

    private static String readUtf8File(final File file) throws Exception {
        try (
            FileInputStream fis = new FileInputStream(file);
            ByteArrayOutputStream out = new ByteArrayOutputStream()
        ) {
            final byte[] buffer = new byte[8192];
            int read;
            while ((read = fis.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static double round2(final double val) {
        return Math.round(val * 100.0) / 100.0;
    }

    private static double round4(final double val) {
        return Math.round(val * 10000.0) / 10000.0;
    }
}
