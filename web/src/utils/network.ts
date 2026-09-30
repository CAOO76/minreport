import { Capacitor } from '@capacitor/core';

/**
 * MINREPORT - Utilidad Centralizada de Red Adaptativa (Web 3.0 / Capa 1 & 2)
 *
 * Resuelve la URL de la API de forma dinámica y resiliente según el entorno:
 * - Producción Cloud: Usa la URL configurada en VITE_API_URL o window.location.origin
 * - Desarrollo Web: http://localhost:8080
 * - Emulador Android: http://10.0.2.2:8080
 * - Dispositivos Físicos Locales: Configurable opcionalmente por VITE_DEV_HOST_IP
 */

export const getBaseUrl = (): string => {
    // 1. Detección de plataforma y entorno
    const isEmulator = typeof navigator !== 'undefined' && /sdk|emulator|google/i.test(navigator.userAgent);
    const isLocalHost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const isNative = Capacitor.isNativePlatform();

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

    // 4. Adaptación exclusiva para Plataformas Nativas (Android/iOS)
    if (isNative) {
        const platform = Capacitor.getPlatform();

        if (platform === 'android') {
            // Emulador Android de Android Studio accede al host mediante 10.0.2.2
            if (isEmulator && (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1'))) {
                return baseUrl.replace('localhost', '10.0.2.2').replace('127.0.0.1', '10.0.2.2');
            }

            // Dispositivo físico con WiFi en desarrollo local opcional
            const devHostIp = import.meta.env.VITE_DEV_HOST_IP;
            if (!isEmulator && devHostIp && (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1'))) {
                return baseUrl.replace('localhost', devHostIp).replace('127.0.0.1', devHostIp);
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
