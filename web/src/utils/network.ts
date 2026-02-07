
import { Capacitor } from '@capacitor/core';

/**
 * Utilidad Centralizada de Red para MINREPORT
 * 
 * Resuelve la URL de la API de forma adaptativa según el entorno.
 * Maneja:
 * - Desarrollo Web (localhost)
 * - Emulador Android (10.0.2.2)
 * - Dispositivos Físicos (IP local)
 */

export const getBaseUrl = (): string => {
    const MI_IP_IMAC = "192.168.1.86"; // IP estática del host de desarrollo

    // 1. Detección de entorno
    const isEmulator = /sdk|emulator|google/i.test(navigator.userAgent);
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isNative = Capacitor.isNativePlatform();

    // 2. Prioridad a Variable de Entorno
    let baseUrl = import.meta.env.VITE_API_URL;

    // 3. Normalización Web a Localhost
    if (isLocalHost && baseUrl && baseUrl.includes(MI_IP_IMAC)) {
        baseUrl = baseUrl.replace(MI_IP_IMAC, 'localhost');
    }

    // 4. Fallback Base
    if (!baseUrl) {
        baseUrl = isLocalHost ? 'http://localhost:8080' : `http://${MI_IP_IMAC}:8080`;
    }

    // 5. Adaptación para Plataformas Nativas (Android/iOS)
    if (isNative) {
        const platform = Capacitor.getPlatform();

        if (platform === 'android') {
            // Caso A: Emulador Android
            if (isEmulator && (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1'))) {
                return baseUrl.replace('localhost', '10.0.2.2').replace('127.0.0.1', '10.0.2.2');
            }

            // Caso B: Dispositivo Físico Real
            // Si apunta a localhost, debemos forzar la IP del iMac/Servidor
            if (!isEmulator && (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1'))) {
                return baseUrl.replace('localhost', MI_IP_IMAC).replace('127.0.0.1', MI_IP_IMAC);
            }
        }
    }

    return baseUrl;
};

/**
 * Helper para construir URLs de endpoints específicos
 */
export const getApiUrl = (endpoint: string): string => {
    const base = getBaseUrl();
    // Limpiar slash inicial si existe
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    return `${base}/${cleanEndpoint}`;
};
