package com.minreport.app;

import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int KEYCODE_XCOVER_KEY = 1015;
    private static final int KEYCODE_XCOVER_TOP_KEY = 1079;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (this.bridge != null && this.bridge.getWebView() != null) {
            final WebSettings settings = this.bridge.getWebView().getSettings();
            final String currentUa = settings.getUserAgentString();
            final String appIdMarker = "MinReportAppId/" + getPackageName();
            if (currentUa != null && !currentUa.contains(appIdMarker)) {
                settings.setUserAgentString(currentUa + " " + appIdMarker);
            }
        }
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
