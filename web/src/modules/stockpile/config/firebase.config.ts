/**
 * firebase.config.ts — Conexión real a la instancia única de Firebase de MINREPORT
 * Región Soberana Obligatoria: southamerica-west1 (Santiago, Chile)
 */

import { app, auth, db, storage } from '../../../config/firebase';

export const FIREBASE_REGION = 'southamerica-west1';
export const enableOfflinePersistence = async (): Promise<boolean> => true;
export const getFirebaseConfig = () => ({
    projectId: app?.options?.projectId || 'minreport-8f2a8',
    region: FIREBASE_REGION,
    storageBucket: app?.options?.storageBucket || 'minreport-8f2a8.firebasestorage.app',
    offlineEnabled: true,
    appEngineProhibited: true,
});
export const getFirebaseApp = () => app;
export const getDb = () => db;
export const getStorageInstance = () => storage;

export { app, auth, db, storage };
export default { app, auth, db, storage, region: FIREBASE_REGION, enableOfflinePersistence };

