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
 * Datos contextuales proporcionados por el Core al Plugin.
 */
export interface MinReportContext {
    projectId: string;
    userId: string;
    isOffline: boolean;
    theme: 'light' | 'dark';
}

/**
 * Contrato de ciclo de vida que todo plugin debe implementar.
 */
export interface PluginLifeCycle {
    /** 
     * Se ejecuta al inicializar el plugin con el contexto del sistema.
     * Ideal para configurar listeners o cargar datos iniciales.
     */
    onInit(context: MinReportContext): void | Promise<void>;

    /** 
     * Retorna el componente visual o widget para ser renderizado en el dashboard.
     * Uso de ReactNode para máxima compatibilidad con el Core.
     */
    renderWidget(): ReactNode;

    /** 
     * Se ejecuta cuando una entidad (item, cuenta, etc) es actualizada.
     * Opcional: solo si el plugin necesita reaccionar a cambios globales.
     */
    onEntityUpdate?(entityId: string, data: any): void | Promise<void>;
}
