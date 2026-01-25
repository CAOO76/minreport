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
 * Define el impacto del plugin en el motor de Flujo de Caja.
 */
export type PluginCategory =
    | 'COST_OPERATIONAL'
    | 'COST_CAPEX'
    | 'REVENUE'
    | 'DATA_ONLY';

/**
 * Contrato de ciclo de vida que todo plugin debe implementar.
 */
export interface PluginLifeCycle {
    /** Se ejecuta al inicializar el plugin con el contexto del sistema */
    onInit: (context: MinReportContext) => Promise<void> | void;

    /** Se ejecuta cuando una entidad compartida es actualizada */
    onEntityUpdate: (entityId: string, data: any) => Promise<void> | void;

    /** Retorna el componente visual o widget para ser renderizado en el dashboard */
    renderWidget: () => any;
}

/**
 * Datos contextuales proporcionados por el Core al Plugin.
 */
export interface MinReportContext {
    projectId: string;
    userId: string;
    isOffline: boolean;
}
