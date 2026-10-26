// Definiciones TypeScript para el SDK de MINREPORT v2.1.0
// Objetivo: Establecer el contrato técnico blindado y las definiciones del SDK 2.1.0.

declare module '@minreport/sdk' {
    /**
     * Contexto seguro proporcionado al plugin durante la inicialización.
     * Todas las operaciones de almacenamiento están bajo el ámbito de extensions.stockpile-control.
     * Permite lectura de históricos para proyecciones de densidad en tiempo real.
     */
    export interface SecureContext {
        storage: {
            /**
             * Lee un valor del almacenamiento persistente.
             * Utilizado para obtener históricos y realizar inferencias.
             * @param key Clave del dato a leer.
             * @returns El valor almacenado o null si no existe.
             */
            read<T>(key: string): Promise<T | null>;

            /**
             * Escribe un valor en el almacenamiento persistente.
             * @param key Clave del dato a escribir.
             * @param value Valor a almacenar.
             */
            write<T>(key: string, value: T): Promise<void>;
        };
    }

    export type Granulometry = 'COLPAS' | 'GRANSA' | 'FINOS' | 'MIXTO';
    export type GeometryType = 'CONO_ELIPTICO' | 'CONO_ELIPTICO_TRUNCADO' | 'CONO_PERIMETRO' | 'FOTOGRAMETRIA';

    /**
     * Definición de un activo (Asset) de acopio para Stockpile Control.
     * Basado en el contrato técnico blindado de MINREPORT.
     */
    export interface StockpileAsset {
        geometria: GeometryType;
        medidas_crudas: Record<string, number>;
        volumen: number;
        tipo_granulometria: Granulometry;
        factor_densidad_usado: number;
        peso_final_toneladas: number;
        metadata: {
            timestamp: number;
            geo: 'southamerica-west1';
            precision: number;
            operatorId: string;
            metodo: 'manual' | 'foto';
            factor_utilizado: number;
        };
    }

    /**
     * Contexto del plugin proporcionado por MINREPORT
     */
    export interface PluginContext {
        region: string;
        pluginName: string;
        version: string;
        environment: 'development' | 'staging' | 'production';
    }

    /**
     * Configuración del plugin
     */
    export interface PluginConfig {
        name: string;
        version: string;
        description?: string;
        author?: string;
        marketplace?: {
            category: string;
            tags: string[];
            featured: boolean;
        };
        thirdPartySupport?: boolean;
    }

    /**
     * Core API
     */
    export interface CoreAPI {
        getPluginRegistry(): {
            getPlugin(name: string): any;
        };
    }

    /**
     * Componentes de UI del SDK (Elite Industrial Minimalism Refresh)
     */
    export type SDKSwitch = any;
    export type SDKBadge = any;
    export type SDKMetric = any;
    export type SDKIcon = any;

    /**
     * Utilidades del SDK
     */
    export const SDK: {
        version: string;
        getContext(): PluginContext;
        registerPlugin(config: PluginConfig, lifecycle: PluginLifeCycle): void;
    };

    /**
     * MinReport Global Object
     */
    export const MinReport: {
        EntityManager: any;
        Core: CoreAPI;
    };

    /**
     * Ciclo de vida del Plugin
     */
    export interface PluginLifeCycle {
        onActivate?(): Promise<void>;
        onDeactivate?(): Promise<void>;
        onInit?(context: SecureContext): Promise<void>;
        onData?(data: any): Promise<void>;
    }
}
