import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.minreport.app',
    appName: 'MinReport',
    webDir: 'dist',
    server: {
        // 🔥 LIVE RELOAD via ADB Reverse (USB)
        // ADB Reverse mapea localhost:5173 del dispositivo → Mac:5173 (Vite web)
        // Comando: adb reverse tcp:5173 tcp:5173
        // ✅ No depende de IP WiFi — siempre funciona con cable USB
        url: 'http://localhost:5173',
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
