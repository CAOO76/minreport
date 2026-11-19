import { CapacitorConfig } from '@capacitor/cli';

const liveServerUrl = process.env.CAP_SERVER_URL?.trim();

/**
 * MINREPORT · GEOLAPP - Configuracion Capacitor 6 (Android Nativo + PWA Offline-First)
 * Con CAP_SERVER_URL definido habilita live reload contra Vite HMR (ej. http://localhost:5173 via adb reverse).
 * Sin CAP_SERVER_URL carga el bundle local empaquetado en dist/ bajo Secure Context HTTPS.
 */
const config: CapacitorConfig = {
    appId: 'com.minreport.app',
    appName: 'MINREPORT',
    webDir: 'dist',
    server: liveServerUrl
        ? {
              url: liveServerUrl,
              androidScheme: 'https',
              cleartext:
                  liveServerUrl.startsWith('http://localhost') ||
                  liveServerUrl.startsWith('http://127.0.0.1')
          }
        : {
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
