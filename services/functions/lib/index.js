import { initializeApp, getApps } from 'firebase-admin/app';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Obtener __dirname para módulos ES6
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Cargar variables de entorno desde .env.local para desarrollo
try {
    // Intentar múltiples rutas posibles para .env.local
    const possiblePaths = [
        path.resolve(__dirname, '../.env.local'),
        path.resolve(__dirname, '../../.env.local'),
        path.resolve(process.cwd(), '.env.local'),
        path.resolve(process.cwd(), 'services/functions/.env.local')
    ];
    let envLoaded = false;
    for (const envPath of possiblePaths) {
        try {
            const envFile = readFileSync(envPath, 'utf8');
            envFile.split('\n').forEach(line => {
                const [key, value] = line.split('=');
                if (key && value && key.trim() && value.trim()) {
                    process.env[key.trim()] = value.trim();
                }
            });
            console.log('🔧 Variables de entorno cargadas desde:', envPath);
            envLoaded = true;
            break;
        }
        catch (e) {
            // Continuar con la siguiente ruta
        }
    }
    if (!envLoaded) {
        console.log('⚠️ No se encontró .env.local en ninguna ubicación esperada');
    }
    console.log('🔧 RESEND_API_KEY presente:', !!process.env.RESEND_API_KEY);
    if (process.env.RESEND_API_KEY) {
        console.log('🔧 RESEND_API_KEY:', process.env.RESEND_API_KEY.substring(0, 10) + '...');
    }
}
catch (error) {
    console.log('⚠️ Error cargando variables de entorno:', error);
}
if (!getApps().length) {
    initializeApp();
}
export * from "./tokens.js";
// Removed export for deleted pluginApi.js
export * from "./dummy.js";
// Removed exports for deleted pluginApi.js and clientPluginManagement.js
export * from "./requestManagement.js"; // DEFINITIVO - ARCHIVO TS CREADO
export * from "./decisionManagement.js";
export * from "./emailWebhooks.js";
export * from "./webhookSetup.js";
export * from "./emailCleanup.js";
export * from "./manualCleanup.js";
//# sourceMappingURL=index.js.map