import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.minreport.app',
    appName: 'MinReport',
    webDir: 'dist',
    server: {
        // 🔥 LIVE RELOAD: Apunta a tu servidor Vite local (DESARROLLO)
        // ⚠️ Este archivo es para desarrollo con Android Studio
        // ⚠️ Para APK de producción, usa: npm run build:apk
        url: 'http://192.168.1.86:5175',
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
