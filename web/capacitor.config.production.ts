import { CapacitorConfig } from '@capacitor/cli';

// Configuración para APK de PRUEBAS en dispositivos reales
// Este APK se conectará a los emuladores de Firebase en tu iMac
// Requisito: Tu móvil debe estar en la misma red WiFi que tu iMac

const config: CapacitorConfig = {
    appId: 'com.minreport.app',
    appName: 'MinReport',
    webDir: 'dist',
    server: {
        // Sin URL = carga archivos locales del APK
        // La app se conectará a emuladores vía firebase.ts (192.168.1.87:9190 y :8085)
        cleartext: true,
        androidScheme: 'http'
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
