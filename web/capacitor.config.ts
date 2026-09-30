import { CapacitorConfig } from '@capacitor/cli';

/**
 * MINREPORT - Configuración Universal Capacitor 6 (Producción Standalone + Offline First)
 * Carga directamente los bundles estáticos locales empaquetados en `dist/` (androidScheme: 'https').
 * Se elimina la IP fija de desarrollo para permitir ejecución 100% autónoma en terreno minero sin red.
 */
const config: CapacitorConfig = {
    appId: 'com.minreport.app',
    appName: 'MINREPORT',
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
