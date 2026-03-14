/**
 * register-sdk-v2.js
 * Automatiza el registro de la versión actual del SDK en Firestore.
 * Esto asegura que el Dashboard refleje la versión correcta inmediatamente después del reinicio.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SDK_METADATA_PATH = path.join(ROOT, 'sdk', 'metadata.ts');

// Configuración de entorno para emuladores
if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log(`📡 [SDK Reg] Usando Firestore Emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);
}

async function registerSDK() {
    try {
        // Inicializar Firebase Admin (usando credenciales de emulador si están activas)
        if (admin.apps.length === 0) {
            admin.initializeApp({
                projectId: 'minreport-access' // ID del proyecto configurado
            });
        }

        const db = admin.firestore();

        // Extraer metadata del archivo TS (Regex para evitar dependencias de compilación pesadas)
        const metadataContent = fs.readFileSync(SDK_METADATA_PATH, 'utf-8');
        const versionMatch = metadataContent.match(/version:\s*['"]([^'"]+)['"]/);
        const statusMatch = metadataContent.match(/status:\s*['"]([^'"]+)['"]/);
        const authorMatch = metadataContent.match(/author:\s*['"]([^'"]+)['"]/);
        
        if (!versionMatch) {
            console.error('❌ [SDK Reg] No se pudo encontrar la versión en metadata.ts');
            return;
        }

        const version = versionMatch[1];
        const status = statusMatch ? statusMatch[1] : 'BETA';
        const author = authorMatch ? authorMatch[1] : 'Unknown';
        const docId = `v${version.replace(/\./g, '_')}`;

        console.log(`🔍 [SDK Reg] Verificando registro de SDK v${version}...`);

        const versionRef = db.collection('admin_sdk_versions').doc(docId);
        const docSnap = await versionRef.get();

        if (!docSnap.exists) {
            console.log(`🚀 [SDK Reg] Nueva versión detectada. Registrando en Firestore...`);
            await versionRef.set({
                versionNumber: version,
                status: status,
                author: author,
                releaseDate: admin.firestore.FieldValue.serverTimestamp(),
                createdBy: 'System (Startup-Sync)',
                changelog: 'Registro automático durante el arranque del servidor.'
            });
            console.log(`✅ [SDK Reg] SDK v${version} registrado exitosamente.`);
        } else {
            console.log(`🛡️ [SDK Reg] SDK v${version} ya está registrado en la base de datos.`);
        }

    } catch (error) {
        console.error('⚠️ [SDK Reg] Error durante el registro automático:', error.message);
    }
}

registerSDK();
