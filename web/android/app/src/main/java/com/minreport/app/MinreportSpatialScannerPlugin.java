package com.minreport.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
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

/**
 * Capacitor plugin launching the native ARCore VIO + Depth spatial scanner activity.
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
        launchScannerActivity(call);
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
        launchScannerActivity(call);
    }

    private void launchScannerActivity(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            call.reject("Activity unavailable to launch spatial scanner", "ACTIVITY_UNAVAILABLE");
            return;
        }

        final Intent intent = new Intent(activity, MinreportSpatialScannerActivity.class);
        startActivityForResult(call, intent, "handleScanResult");
    }

    @ActivityCallback
    private void handleScanResult(final PluginCall call, final ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            final JSObject cancelledPayload = new JSObject();
            cancelledPayload.put("cancelled", true);
            call.resolve(cancelledPayload);
            return;
        }

        final String resultFilePath =
            result.getData().getStringExtra(MinreportSpatialScannerActivity.EXTRA_RESULT_FILE_PATH);
        if (resultFilePath == null || resultFilePath.isEmpty()) {
            call.reject("Spatial scan finished without result file", "SCAN_RESULT_MISSING");
            return;
        }

        final File resultFile = new File(resultFilePath);
        try {
            final String jsonText = readUtf8File(resultFile);
            final JSObject payload = new JSObject(jsonText);
            call.resolve(payload);
        } catch (Exception e) {
            call.reject(
                e.getMessage() != null ? e.getMessage() : "Failed to parse spatial scan payload",
                "SCAN_RESULT_PARSE_ERROR",
                e
            );
        } finally {
            if (resultFile.exists()) {
                // Clean temporary JSON file once read into JSObject.
                // Keyframe JPEG paths remain in cacheDir for JS to ingest via Capacitor.convertFileSrc().
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
}
