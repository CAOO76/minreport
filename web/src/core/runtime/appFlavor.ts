/**
 * Detección síncrona (0 ms) de variante nativa Android (`production` vs `fieldtest`).
 * En compilaciones nativas `fieldtestDebug` / `fieldtestRelease`, `MainActivity.java`
 * anexa `" MinReportAppId/com.minreport.app.fieldtest(.debug)"` al `User-Agent` del WebView.
 */
export type MinReportAppFlavor = 'production' | 'fieldtest';

const FIELDTEST_APP_ID_MARKER = 'MinReportAppId/com.minreport.app.fieldtest';

export function isFieldTestApp(): boolean {
    if (typeof navigator === 'undefined') {
        return false;
    }

    const ua = navigator.userAgent || '';
    if (ua.includes(FIELDTEST_APP_ID_MARKER)) {
        return true;
    }

    // Solo en desarrollo local (`vite dev`) permite previsualización web de la app de pruebas
    if (import.meta.env.DEV && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (params.get('flavor') === 'fieldtest') {
            try {
                window.sessionStorage.setItem('minreport_app_flavor_preview', 'fieldtest');
            } catch {
                // Ignorar en entornos sin sessionStorage
            }
            return true;
        }
        try {
            return window.sessionStorage.getItem('minreport_app_flavor_preview') === 'fieldtest';
        } catch {
            return false;
        }
    }

    return false;
}

export function getMinReportAppFlavor(): MinReportAppFlavor {
    return isFieldTestApp() ? 'fieldtest' : 'production';
}

export function isNativeDebugApp(): boolean {
    if (typeof navigator === 'undefined') {
        return false;
    }
    const ua = navigator.userAgent || '';
    return /\bMinReportAppId\/[^\s]+\.debug\b/.test(ua);
}

export function isAndroidEmulatorRuntime(): boolean {
    if (typeof navigator === 'undefined') {
        return false;
    }
    const ua = navigator.userAgent || '';
    if (/\bMinReportRuntime\/emulator\b/i.test(ua)) {
        return true;
    }
    if (/\bMinReportRuntime\/device\b/i.test(ua)) {
        return false;
    }
    return /sdk_gphone|emulator|generic_x86|google_sdk|\bsdk\b/i.test(ua);
}
