import { ReactNode } from 'react';

/**
 * MinReport SDK - Core Type Definitions
 * ADN del Sistema: Interfaces y Tipos base para Plugins
 */

/**
 * Define la metadata básica del plugin para su registro y gestión.
 */
export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    author: string;
}

/**
 * API de Almacenamiento Seguro (Scoped Storage)
 * Cada plugin recibe una instancia que SOLO puede escribir en su propio path.
 */
export interface StorageAPI {
    /**
     * Guarda el resultado de un procesamiento realizado por el plugin.
     * @param entityId ID de la entidad relacionada (ej. ID de stockpile)
     * @param data Objeto con resultados. Debe ser serializable.
     */
    saveProcessingResult(entityId: string, data: Record<string, any>): Promise<void>;

    /**
     * Obtiene la configuración guardada del plugin para una entidad específica.
     */
    getConfig(entityId: string): Promise<Record<string, any> | null>;
}

/**
 * Contexto Seguro proporcionado al Plugin (SDK 2.0)
 * Reemplaza al antiguo contexto global.
 */
export interface SecureContext {
    // Datos de identificación básicos (Read-Only)
    projectId: string;
    userId: string;

    // Capacidades inyectadas (solo existen si se solicitaron en el manifiesto)
    storage: StorageAPI;

    // Estado del entorno
    isOffline: boolean;
    theme: 'light' | 'dark';
}

/**
 * Contrato de ciclo de vida que todo plugin debe implementar.
 */
export interface PluginLifeCycle {
    /** 
     * Se ejecuta al inicializar el plugin con el Contexto Seguro.
     * AHORA ES OBLIGATORIO usar 'context.storage' en lugar de globales.
     */
    onInit(context: SecureContext): void | Promise<void>;

    /** 
     * Retorna el componente visual o widget para ser renderizado en el dashboard.
     */
    renderWidget(): ReactNode;

    /** 
     * Opcional: Reacción a actualizaciones globales.
     */
    onEntityUpdate?(entityId: string, data: any): void | Promise<void>;
}
