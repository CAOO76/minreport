/**
 * firebase.config.ts — STUB para desarrollo standalone del plugin
 *
 * Este plugin NO usa Firebase directamente.
 * En producción, los datos se almacenan a través del SDK de MINREPORT (SecureContext).
 * En desarrollo, se usa MockSecureContext (localStorage) sin ninguna dependencia de red.
 *
 * Este archivo existe solo para compatibilidad con imports existentes.
 */

export const FIREBASE_REGION = 'southamerica-west1';
export const enableOfflinePersistence = async (): Promise<boolean> => true;
export const getFirebaseConfig = () => ({
    projectId: 'minreport-8f2a8',
    region: FIREBASE_REGION,
    storageBucket: 'minreport-8f2a8.firebasestorage.app',
    offlineEnabled: true,
    appEngineProhibited: true,
});
export const getFirebaseApp = () => null;
export const getDb = () => null;
export const getStorageInstance = () => null;
export default { app: null, db: null, storage: null, region: FIREBASE_REGION, enableOfflinePersistence };
