import { Capacitor } from '@capacitor/core';
import { isNativeDebugApp, isAndroidEmulatorRuntime } from '../core/runtime/appFlavor';

/**
 * MINREPORT - Utilidad Centralizada de Red Adaptativa (Web 3.0 / Capa 1 & 2)
 *
 * Resuelve la URL de la API de forma dinámica y resiliente según el entorno:
 * - Producción Cloud: Usa la URL configurada en VITE_API_URL o window.location.origin
 * - Desarrollo Web: http://localhost:8080
 * - Emulador Android: http://10.0.2.2:8080
 * - Dispositivos Físicos Locales: Configurable opcionalmente por VITE_DEV_HOST_IP
 */

const DEFAULT_CLOUD_ORIGIN = 'https://minreport-access.web.app';
const LOCAL_DEV_ORIGIN_REGEX =
    /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?(\/|$)/i;

function isLocalDevOrigin(url: string): boolean {
    return LOCAL_DEV_ORIGIN_REGEX.test(url.trim());
}

export const getBaseUrl = (): string => {
    // 1. Detección de plataforma y entorno (sin depender exclusivamente de NODE_ENV)
    const isEmulator = isAndroidEmulatorRuntime();
    const isLocalHost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const isNative = Capacitor.isNativePlatform();
    const isNativeDebug = isNativeDebugApp();
    const isNativeReleaseHttps =
        isNative &&
        !isNativeDebug &&
        typeof window !== 'undefined' &&
        window.location.protocol === 'https:' &&
        !window.location.port;
    const forceLocalApi = import.meta.env.VITE_FORCE_LOCAL_API === 'true';

    // 1b. APK/iOS Release autónomo bajo Capacitor HTTPS: priorizar gateway Cloud en southamerica-west1
    if (isNativeReleaseHttps && !forceLocalApi) {
        const rawEnvUrl = import.meta.env.VITE_API_URL?.trim();
        if (rawEnvUrl && !isLocalDevOrigin(rawEnvUrl)) {
            return rawEnvUrl.replace(/\/+$/, '');
        }
        return (import.meta.env.VITE_CLOUD_API_URL || DEFAULT_CLOUD_ORIGIN).trim().replace(/\/+$/, '');
    }

    // 2. Prioridad estricta a Variable de Entorno explícita
    let baseUrl = import.meta.env.VITE_API_URL;

    if (baseUrl) {
        // Si estamos en navegador localhost, asegurar localhost
        if (isLocalHost && baseUrl.includes('192.168.')) {
            baseUrl = 'http://localhost:8080';
        }
    } else {
        // 3. Fallbacks automáticos según entorno
        if (isLocalHost) {
            baseUrl = 'http://localhost:8080';
        } else if (typeof window !== 'undefined' && window.location.origin && window.location.origin.startsWith('http')) {
            // Entorno Web desplegado en Cloud (Firebase Hosting / Cloudflare)
            baseUrl = window.location.origin;
        } else {
            baseUrl = 'http://localhost:8080';
        }
    }

    // Evitar fugas de URLs localhost/LAN en builds web desplegados bajo HTTPS
    if (
        !isNative &&
        !isLocalHost &&
        typeof window !== 'undefined' &&
        window.location.protocol === 'https:' &&
        !import.meta.env.DEV &&
        isLocalDevOrigin(baseUrl)
    ) {
        return window.location.origin;
    }

    // 4. Adaptación exclusiva para Plataformas Nativas (Android/iOS) en desarrollo / debug
    if (isNative) {
        const platform = Capacitor.getPlatform();

        if (platform === 'android') {
            // Emulador Android de Android Studio accede al host Mac mediante 10.0.2.2
            if (isEmulator && (!baseUrl || isLocalDevOrigin(baseUrl))) {
                return baseUrl
                    ? baseUrl.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})/i, '$110.0.2.2')
                    : 'http://10.0.2.2:8080';
            }

            // Dispositivo físico con WiFi en desarrollo local opcional o puente USB adb reverse
            const devHostIp = import.meta.env.VITE_DEV_HOST_IP?.trim();
            if (!isEmulator && devHostIp && (!baseUrl || isLocalDevOrigin(baseUrl))) {
                return baseUrl
                    ? baseUrl.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1|10\.0\.2\.2)/i, `$1${devHostIp}`)
                    : `http://${devHostIp}:8080`;
            }

            if (!isEmulator && (!baseUrl || isLocalDevOrigin(baseUrl))) {
                return baseUrl
                    ? baseUrl.replace(/^(https?:\/\/)(10\.0\.2\.2|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})/i, '$1localhost')
                    : 'http://localhost:8080';
            }
        }
    }

    return baseUrl;
};

/**
 * Helper para construir URLs de endpoints de forma segura
 */
export const getApiUrl = (endpoint: string): string => {
    const base = getBaseUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    return `${base.replace(/\/+$/, '')}/${cleanEndpoint}`;
};
