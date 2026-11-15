import { CapacitorConfig } from '@capacitor/cli';

/**
 * MINREPORT · GEOLAPP - Configuracion Capacitor 6 de Produccion (Android APK Standalone)
 * Enforce obligatorio de Secure Context HTTPS (androidScheme: 'https', cleartext: false)
 * requerido para crypto.subtle SHA-256 CAS, Passkeys FIDO2 y sensores en terreno.
 */
const config: CapacitorConfig = {
    appId: 'com.minreport.app',
    appName: 'MINREPORT · GEOLAPP',
    webDir: 'dist',
    server: {
        androidScheme: 'https',
        cleartext: false
    },
    plugins: {
        Camera: {
            permissions: ['camera', 'photos']
        },
        Geolocation: {
            permissions: ['location']
        }
    }
};

export default config;
