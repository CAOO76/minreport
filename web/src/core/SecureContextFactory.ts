import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    Firestore
} from 'firebase/firestore';
import {
    SecureContext,
    StorageAPI
} from '@minreport/sdk';

/**
 * SecureContextFactory
 * Genera contextos de ejecución aislados y seguros para cada plugin.
 * Garantiza que un plugin solo pueda escribir en su propio espacio reservado.
 */
export class SecureContextFactory {
    private db: Firestore;

    constructor() {
        this.db = getFirestore();
    }

    /**
     * Crea un contexto seguro para un plugin específico.
     * @param pluginId ID único del plugin (ej. 'mi-plugin')
     * @param projectId ID del proyecto actual
     * @param userId ID del usuario actual
     */
    public create(pluginId: string, projectId: string, userId: string): SecureContext {
        return {
            projectId,
            userId,
            isOffline: !navigator.onLine,
            theme: 'light', // TODO: Conectar con hook de tema real
            storage: this.createStorageAPI(pluginId),
            network: this.createNetworkAPI()
        };
    }

    private createStorageAPI(pluginId: string): StorageAPI {
        const db = this.db;

        /**
         * Ruta de almacenamiento aislada por plugin:
         * plugin_data/{pluginId}/records/{entityId}
         *
         * Esta estrategia garantiza:
         * - Aislamiento total: ningún plugin puede leer/escribir datos de otro.
         * - Agnosticismo: el Core no asume ninguna colección de negocio específica.
         * - Las Firestore Security Rules pueden restringir por ruta de plugin.
         */
        const scopedPath = (entityId: string) =>
            doc(db, 'plugin_data', pluginId, 'records', entityId);

        return {
            async saveProcessingResult(entityId: string, data: Record<string, any>): Promise<void> {
                if (!entityId || typeof entityId !== 'string') {
                    throw new Error('[SecureStorage] EntityId inválido');
                }
                try {
                    await setDoc(scopedPath(entityId), {
                        ...data,
                        _updatedAt: new Date().toISOString(),
                        _byPlugin: pluginId
                    }, { merge: true });

                    console.log(`[SecureStorage] Guardado exitoso: plugin_data/${pluginId}/records/${entityId}`);
                } catch (error) {
                    console.error(`[SecureStorage] Error guardando datos de plugin ${pluginId}`, error);
                    throw new Error('No se pudo guardar la información del plugin. Permiso denegado o error de red.');
                }
            },

            async getConfig(entityId: string): Promise<Record<string, any> | null> {
                try {
                    const snapshot = await getDoc(scopedPath(entityId));
                    return snapshot.exists() ? snapshot.data() : null;
                } catch (error) {
                    console.error(`[SecureStorage] Error leyendo config de plugin ${pluginId}`, error);
                    return null;
                }
            },

            async saveOfflineData(key: string, data: any): Promise<void> {
                // Fallback: en web persiste en localStorage bajo namespace del plugin
                try {
                    const nsKey = `minreport.plugin.${pluginId}.${key}`;
                    localStorage.setItem(nsKey, JSON.stringify({ data, _savedAt: new Date().toISOString() }));
                } catch (error) {
                    console.warn(`[SecureStorage] saveOfflineData fallback failed for ${pluginId}`, error);
                }
            }
        };
    }

    private createNetworkAPI() {
        return {
            onNetworkStatusChange(callback: (status: { connected: boolean; connectionType: string }) => void): void {
                const handler = () => callback({ connected: navigator.onLine, connectionType: 'unknown' });
                window.addEventListener('online', handler);
                window.addEventListener('offline', handler);
            },
            async syncOfflineQueue(): Promise<void> {
                // El Core web no gestiona cola offline directo — delegado al Service Worker
                console.log('[NetworkAPI] syncOfflineQueue: delegado al Service Worker');
            }
        };
    }
}

// Singleton para uso interno del Core
export const secureContextFactory = new SecureContextFactory();
