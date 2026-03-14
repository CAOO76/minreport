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
    description?: string;
    website?: string;
    category?: 'production' | 'safety' | 'geology' | 'fleet' | 'hr' | 'other';
    permissions?: string[];
}

/**
 * API de Almacenamiento Seguro para entorno Edge (Offline-First)
 * Abstrae IndexedDB y Capacitor Preferences para el plugin.
 */
export interface StorageAPI {
    /** Guarda el resultado de un procesamiento (Mina Offline) */
    saveProcessingResult(entityId: string, data: Record<string, any>): Promise<void>;

    /** Obtiene la configuración o datos locales guardados */
    getConfig(entityId: string): Promise<Record<string, any> | null>;

    /** Guarda datos genéricos en IndexedDB para sincronización posterior */
    saveOfflineData(key: string, data: any): Promise<void>;
}

/**
 * API de Red para resiliencia en mina
 */
export interface NetworkAPI {
    /** Escucha los cambios de estado de red (Capacitor Network) */
    onNetworkStatusChange(callback: (status: { connected: boolean; connectionType: string }) => void): void;
    
    /** Fuerza el vaciado de la cola IndexedDB al recuperar conexión */
    syncOfflineQueue(): Promise<void>;
}

/**
 * Contexto Seguro proporcionado al Plugin (SDK 2.0)
 * Reemplaza al antiguo contexto global.
 */
export interface SecureContext {
    // Datos de identificación básicos (Read-Only)
    projectId: string;
    userId: string;

    // Capacidades inyectadas
    storage: StorageAPI;
    network: NetworkAPI; // [EDGE-OPTIMIZER] Network management

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
