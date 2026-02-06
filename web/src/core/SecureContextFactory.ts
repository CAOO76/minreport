import {
    getFirestore,
    doc,
    updateDoc,
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
     * @param pluginId ID único del plugin (ej. 'stockpile-control')
     * @param projectId ID del proyecto actual
     * @param userId ID del usuario actual
     */
    public create(pluginId: string, projectId: string, userId: string): SecureContext {
        return {
            projectId,
            userId,
            isOffline: !navigator.onLine,
            theme: 'light', // TODO: Conectar con hook de tema real

            // Inyección de Storage Scoped
            storage: this.createStorageAPI(pluginId)
        };
    }

    private createStorageAPI(pluginId: string): StorageAPI {
        const db = this.db;

        return {
            async saveProcessingResult(entityId: string, data: Record<string, any>): Promise<void> {
                try {
                    // Validamos que entityId sea seguro
                    if (!entityId || typeof entityId !== 'string') {
                        throw new Error('EntityId inválido');
                    }

                    // Referencia estricta a la colección donde viven las entidades principales
                    // Asumimos 'acopios' por ahora, pero esto podría ser dinámico según el tipo de plugin
                    // TODO: El plugin debería declarar qué tipo de entidad maneja.
                    // Por seguridad en V1, asumimos que los plugins enrichment trabajan sobre 'procesos' o 'acopios'
                    // Para este ejemplo usaremos una colección genérica o detectada.

                    // IMPROVEMENT: En un sistema real, el entityId ya traería su colección o el plugin declara "target: acopios"
                    // Por ahora, asumimos que 'entityId' es un documento en una colección conocida o el plugin 
                    // está extendiendo un documento específico.

                    // PATRÓN: extensions.{pluginId}
                    // Escribimos en la colección 'entities' (meta-colección) o directamente en la colección del negocio.
                    // Para ser agnóstico, vamos a requerir que el Core sepa la colección, pero aquí 
                    // simplificaremos asumiendo que el plugin guarda preferencias de usuario o datos asociados a un ID global.

                    // ESTRATEGIA: Guardar en una subcolección de plugins del sistema o en el documento mismo.
                    // Usaremos 'projects/{projectId}/plugins_data/{entityId}' para máximo aislamiento y no tocar la data core?
                    // NO, el requerimiento es "extendEntity". Volvemos al patrón extensions.

                    // Para simplificar la implementación del factory sin saber la colección:
                    // Vamos a asumir que los plugins de 'stockpile' operan en 'stockpiles'.
                    const collectionName = 'stockpiles';

                    const docRef = doc(db, collectionName, entityId);
                    const updatePath = `extensions.${pluginId}`;

                    await updateDoc(docRef, {
                        [updatePath]: {
                            ...data,
                            _updatedAt: new Date().toISOString(),
                            _byPlugin: pluginId
                        }
                    });

                    console.log(`[SecureStorage] Guardado exitoso para ${pluginId} en ${entityId}`);

                } catch (error) {
                    console.error(`[SecureStorage] Error guardando datos de plugin ${pluginId}`, error);
                    throw new Error('No se pudo guardar la información del plugin. Permiso denegado o error de red.');
                }
            },

            async getConfig(entityId: string): Promise<Record<string, any> | null> {
                try {
                    const collectionName = 'stockpiles'; // Mismo hardcode temporal
                    const docRef = doc(db, collectionName, entityId);
                    const snapshot = await getDoc(docRef);

                    if (snapshot.exists()) {
                        const data = snapshot.data();
                        return data?.extensions?.[pluginId] || null;
                    }
                    return null;
                } catch (error) {
                    console.error(`[SecureStorage] Error leyendo config de plugin ${pluginId}`, error);
                    return null;
                }
            }
        };
    }
}

// Singleton para uso interno del Core
export const secureContextFactory = new SecureContextFactory();
