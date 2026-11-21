package com.minreport.app;

import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private static final int KEYCODE_XCOVER_KEY = 1015;
    private static final int KEYCODE_XCOVER_TOP_KEY = 1079;

    private static boolean isAndroidEmulator() {
        final String fingerprint = Build.FINGERPRINT != null ? Build.FINGERPRINT : "";
        final String model = Build.MODEL != null ? Build.MODEL : "";
        final String hardware = Build.HARDWARE != null ? Build.HARDWARE : "";
        final String product = Build.PRODUCT != null ? Build.PRODUCT : "";
        return hardware.contains("ranchu")
            || hardware.contains("goldfish")
            || fingerprint.startsWith("generic")
            || fingerprint.startsWith("unknown")
            || model.contains("sdk_gphone")
            || model.contains("Emulator")
            || model.contains("Android SDK built for")
            || product.contains("sdk_gphone")
            || product.contains("emulator");
    }

    private boolean isSystemNightMode(Configuration config) {
        final Configuration effective = config != null ? config : getResources().getConfiguration();
        if (effective == null) {
            return false;
        }
        return (effective.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private void syncSystemBarsWithNightMode(Configuration config) {
        final boolean isNight = isSystemNightMode(config);
        final Window window = getWindow();
        if (window == null) {
            return;
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        final int barColor = isNight ? Color.BLACK : Color.WHITE;
        window.setStatusBarColor(barColor);
        window.setNavigationBarColor(barColor);

        final WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(!isNight);
            controller.setAppearanceLightNavigationBars(!isNight);
        }
    }

    private void pushOsConfigToWebView(Configuration config) {
        if (this.bridge == null || this.bridge.getWebView() == null) {
            return;
        }
        final boolean isNight = isSystemNightMode(config);
        final String rawTag = Locale.getDefault().toLanguageTag();
        final String safeTag = (rawTag != null ? rawTag : "es").replace("'", "").replaceAll("[^a-zA-Z0-9-]", "");
        final WebView webView = this.bridge.getWebView();
        final String script =
            "window.__MINREPORT_NATIVE_LOCALE__='" + safeTag + "';"
            + "window.__MINREPORT_NATIVE_DARK__=" + (isNight ? "true" : "false") + ";"
            + "window.dispatchEvent(new CustomEvent('minreport:os-config-change', { detail: { locale: '" + safeTag + "', isDark: " + (isNight ? "true" : "false") + " } }));";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(MinreportDeviceCapabilityPlugin.class);
        registerPlugin(MinreportSpatialScannerPlugin.class);
        super.onCreate(savedInstanceState);
        syncSystemBarsWithNightMode(getResources().getConfiguration());

        if (this.bridge != null && this.bridge.getWebView() != null) {
            final WebSettings settings = this.bridge.getWebView().getSettings();
            final String currentUa = settings.getUserAgentString();
            final String appIdMarker = "MinReportAppId/" + getPackageName();
            final String runtimeMarker = "MinReportRuntime/" + (isAndroidEmulator() ? "emulator" : "device");
            final String rawTag = Locale.getDefault().toLanguageTag();
            final String safeTag = (rawTag != null ? rawTag : "es").replaceAll("[^a-zA-Z0-9-]", "");
            final String localeMarker = "MinReportLocale/" + safeTag;

            if (currentUa != null) {
                String updatedUa = currentUa;
                if (!updatedUa.contains(appIdMarker)) {
                    updatedUa = updatedUa + " " + appIdMarker;
                }
                if (!updatedUa.contains("MinReportRuntime/")) {
                    updatedUa = updatedUa + " " + runtimeMarker;
                }
                updatedUa = updatedUa.replaceAll("\\s*MinReportLocale/[^\\s]+", "") + " " + localeMarker;
                if (!updatedUa.equals(currentUa)) {
                    settings.setUserAgentString(updatedUa);
                }
            }

            final boolean isDebuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            if (isDebuggable) {
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        final Configuration config = getResources().getConfiguration();
        syncSystemBarsWithNightMode(config);
        pushOsConfigToWebView(config);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        syncSystemBarsWithNightMode(newConfig);
        pushOsConfigToWebView(newConfig);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event == null) {
            return super.dispatchKeyEvent(event);
        }

        final int keyCode = event.getKeyCode();
        final boolean isXCoverProgrammableKey =
            keyCode == KEYCODE_XCOVER_KEY ||
            keyCode == KEYCODE_XCOVER_TOP_KEY ||
            keyCode == KeyEvent.KEYCODE_F1 ||
            keyCode == KeyEvent.KEYCODE_CAMERA;

        if (!isXCoverProgrammableKey) {
            return super.dispatchKeyEvent(event);
        }

        final int action = event.getAction();
        if (action != KeyEvent.ACTION_DOWN && action != KeyEvent.ACTION_UP) {
            return super.dispatchKeyEvent(event);
        }

        if (event.getRepeatCount() == 0 && getBridge() != null) {
            final WebView webView = getBridge().getWebView();
            if (webView != null) {
                final String actionLabel = action == KeyEvent.ACTION_DOWN ? "DOWN" : "UP";
                final String script = "window.dispatchEvent(new CustomEvent('geolapp:xcover-key', { detail: { keyCode: "
                    + keyCode
                    + ", action: '"
                    + actionLabel
                    + "', timestamp: Date.now() } }));";
                getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(script, null));
            }
        }

        return true;
    }
}
