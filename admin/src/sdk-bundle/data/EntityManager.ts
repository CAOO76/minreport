import {
    getFirestore,
    doc,
    updateDoc,
    onSnapshot,
    DocumentSnapshot,
    Unsubscribe,
    Firestore
} from 'firebase/firestore';

/**
 * EntityManager - Capa de manipulación de datos segura (Shared Entity Pattern)
 * Garantiza que los plugins colaboren sin destruir datos del Core u otros plugins.
 */
export class EntityManager {
    private db: Firestore;

    constructor() {
        /** 
         * Usamos getFirestore() asumiendo que el Core ya inicializó Firebase.
         */
        this.db = getFirestore();
    }

    /**
     * Extiende una entidad con datos específicos de un plugin.
     * Garantiza que solo se modifique la rama 'extensions.pluginId'.
     * 
     * @param collectionName Nombre de la colección (ej. 'acopios')
     * @param entityId ID del documento
     * @param pluginId ID del plugin (ej. 'topo')
     * @param data Datos a guardar dentro de la extensión del plugin
     */
    public async extendEntity(
        collectionName: string,
        entityId: string,
        pluginId: string,
        data: any
    ): Promise<void> {
        try {
            const docRef = doc(this.db, collectionName, entityId);

            /**
             * Usamos la notación de punto para actualizar campos anidados.
             * Firebase interpretará 'extensions.id' como un objeto 'extensions' que contiene 'id'.
             * Esto evita sobrescribir todo el campo 'extensions' si otros plugins lo usan.
             */
            const updatePath = `extensions.${pluginId}`;

            await updateDoc(docRef, {
                [updatePath]: data,
                updatedAt: new Date().toISOString()
            });

            console.log(`[SDK Data] Entidad ${entityId} extendida exitosamente por plugin: ${pluginId}`);
        } catch (error) {
            console.error(`[SDK Data] Error en extendEntity para el plugin "${pluginId}":`, error);
            throw error;
        }
    }

    /**
     * Se suscribe a los cambios de una entidad completa.
     * Útil para que los plugins reaccionen a cambios en el Core o en otras extensiones.
     * 
     * @param collectionName Nombre de la colección
     * @param entityId ID del documento
     * @param callback Función que recibe los datos actualizados
     * @returns Función de desuscripción (unsubscribe)
     */
    public subscribeToEntity(
        collectionName: string,
        entityId: string,
        callback: (data: any) => void
    ): Unsubscribe {
        const docRef = doc(this.db, collectionName, entityId);

        return onSnapshot(docRef, (snapshot: DocumentSnapshot) => {
            if (snapshot.exists()) {
                callback({ id: snapshot.id, ...snapshot.data() });
            } else {
                console.warn(`[SDK Data] El documento ${entityId} no existe en ${collectionName}`);
            }
        }, (error: any) => {
            console.error(`[SDK Data] Error en subscribeToEntity (${entityId}):`, error);
        });
    }
}

// Exportamos una instancia única para facilidad de uso
export const entityManager = new EntityManager();
