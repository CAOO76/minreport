import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.minreport.app',
    appName: 'MinReport',
    webDir: 'dist',
    server: {
        // 🔥 LIVE RELOAD via Local IP (WiFi)
        // Permite la conexión directa desde el celular físico conectado a la misma red WiFi
        url: 'http://192.168.1.86:5173',
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
