import type { SecureContext } from '@minreport/sdk';
import { idbStorage } from '../utils/indexedDB';
import { setSyncStatus } from '../utils/syncStatus';

// En entorno integrado MINREPORT, la sincronización a servidor mock independiente solo opera si se configura explícitamente
const getSyncUrl = () => {
    return (import.meta as any).env?.VITE_STOCKPILE_SYNC_URL || null;
};

const VITE_SYNC_URL = getSyncUrl();

/**
 * Push data to Mock Sync Server
 */
const pushToDevServer = async (key: string, value: any) => {
    if (!VITE_SYNC_URL) return;
    try {
        const res = await fetch(`${VITE_SYNC_URL}/__mock_sync_push`, {
            method: 'POST',
            body: JSON.stringify({ [`mock_sdk_${key}`]: value }),
            headers: { 'Content-Type': 'application/json' }
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
            setSyncStatus('success');
            setTimeout(() => setSyncStatus('idle'), 3000);
        } else {
            setSyncStatus('idle');
        }
    } catch {
        setSyncStatus('idle');
    }
};

export const fetchFullKey = async (key: string) => {
    if (!VITE_SYNC_URL) return null;
    try {
        const res = await fetch(`${VITE_SYNC_URL}/__mock_sync_get?key=mock_sdk_${key}`);
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
            setSyncStatus('success');
            setTimeout(() => setSyncStatus('idle'), 2000);
            return await res.json();
        }
    } catch {
        setSyncStatus('idle');
    }
    return null;
};

export const pullFromDevServer = async () => {
    if (!VITE_SYNC_URL) return;
    try {
        const res = await fetch(`${VITE_SYNC_URL}/__mock_sync_pull`);
        const contentType = res.headers.get('content-type') || '';
        
        // Si no es JSON (ej. preview sirviendo index.html), silenciar gracefully
        if (!res.ok || !contentType.includes('application/json')) {
            setSyncStatus('idle');
            return;
        }

        const data = await res.json();
        const keys = Object.keys(data);
        console.log(`[Mock Sync] Received ${keys.length} keys from dev server`);
        for (const k of keys) {
            if (k.startsWith('mock_sdk_')) {
                const realKey = k.replace('mock_sdk_', '');
                await idbStorage.set(realKey, data[k]);
                localStorage.removeItem(k);
            }
        }
        setSyncStatus('idle');
        window.dispatchEvent(new Event('mock-sync-updated'));
    } catch {
        setSyncStatus('idle');
    }
};
// Auto pull en inicio (se ejecuta en DEV Mac y en WebView Capacitor Offline)
pullFromDevServer();

// Hot Module Replacement HMR listening (solo disponible entorno Vite originario)
if (import.meta.env && import.meta.env.DEV && import.meta.hot) {
        import.meta.hot.on('mock:sync-updated', async (data) => {
            console.log('[Mock Sync HMR] Server payload updated');
            for (const k of Object.keys(data)) {
                if (k.startsWith('mock_sdk_')) {
                    const realKey = k.replace('mock_sdk_', '');
                    await idbStorage.set(realKey, data[k]);
                }
            }
            window.dispatchEvent(new Event('mock-sync-updated'));
        });
    }

/**
 * Mock del SecureContext para desarrollo local y standalone
 * Simula el almacenamiento blindado usando localStorage
 */
export const MockSecureContext: SecureContext = {
    storage: {
        read: async <T>(key: string): Promise<T | null> => {
            let item: any = await idbStorage.get<T>(key);
            
            if (item) {
                // Transparent Lazy Load
                if (item.__is_lazy) {
                    console.log(`[Mock Sync] Lazy loading full record for key: ${key}`);
                    const fullItem = await fetchFullKey(key);
                    if (fullItem) {
                        await idbStorage.set(key, fullItem);
                        return fullItem as T;
                    }
                }
                return item;
            }

            // Priority 2: localStorage (Legacy fallback for migration)
            const legacyItem = localStorage.getItem(`mock_sdk_${key}`);
            if (legacyItem) {
                try {
                    const parsed = JSON.parse(legacyItem);
                    // Migrar a IndexedDB automáticamente
                    await idbStorage.set(key, parsed);
                    // localStorage.removeItem(`mock_sdk_${key}`); // Opcional: limpiar después
                    return parsed;
                } catch (e) {
                    return null;
                }
            }

            return null;
        },
        write: async <T>(key: string, value: T): Promise<void> => {
            console.log(`[SDK Mock] Escribiendo en IndexedDB: ${key}`);
            await idbStorage.set(key, value);
            await pushToDevServer(key, value);
        }
    }
};

/**
 * Utilidad para detectar si estamos en un entorno hosteado o standalone
 */
export const isStandalone = (): boolean => {
    // Si window.MinReport no existe, asumimos standalone
    return typeof (window as any).MinReport === 'undefined';
};

/**
 * Mock del MinReport Core para desarrollo
 */
export const MinReport = {
    version: '2.1.0',
    EntityManager: {
        queryEntities: async (options: { extension: string; filters?: any; limit?: number }) => {
            console.log(`[SDK v2.1.0 Mock] Querying ${options.extension}`, options);
            return [];
        },
        subscribeToEntity: (extension: string, id: string, _callback: (data: any) => void) => {
            console.log(`[SDK v2.1.0 Mock] Subscribed to ${extension}:${id}`);
            return () => console.log(`[SDK v2.1.0 Mock] Unsubscribed`);
        }
    },
    Core: {
        getPluginRegistry: () => ({
            getPlugin: (_name: string) => null
        })
    }
};

/**
 * Hard Reset: Clears everything (IndexedDB locally + Mock Sync Server)
 */
export async function hardSyncReset() {
    console.warn('[Mock Sync] PERFORMING HARD RESET...');
    
    // 1. Clear IndexedDB
    const { idbStorage } = await import('../utils/indexedDB');
    await idbStorage.clear();
    
    // 2. Clear Server
    try {
        await fetch(`${VITE_SYNC_URL}/__mock_sync_reset`, { method: 'POST' });
    } catch (e) {
        console.error('[Mock Sync] Server reset failed', e);
    }
    
    // 3. Reload
    window.location.reload();
}
