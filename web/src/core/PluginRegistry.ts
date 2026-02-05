import { MinReport, PluginManifest } from '@minreport/sdk';
import StockpileControlPlugin from '../plugins/stockpile-control';

/**
 * Registro Central de Plugins (Web Core)
 * Este archivo actúa como el panel de conexiones donde se enchufan 
 * todos los plugins disponibles en la plataforma MINREPORT.
 */

// 1. Catálogo de Plugins Disponibles
const PLUGIN_CATALOG = [
    {
        manifest: {
            id: 'stockpile-control',
            name: 'Control de Acopios',
            version: '1.0.0',
            author: 'MinReport'
        },
        instance: StockpileControlPlugin
    }
];

// 2. Registro Automático
// Al importar este archivo, los plugins se registran en el SDK Core 
// para habilitar su ciclo de vida y gestión de datos.
PLUGIN_CATALOG.forEach(p => {
    if (!MinReport.Core.getPluginById(p.manifest.id)) {
        MinReport.Core.register(p.manifest, p.instance as any);
    }
});

/**
 * getPluginById
 * Busca un plugin por su ID en el registro del sistema.
 */
export const getPluginById = (id: string) => {
    return MinReport.Core.getPluginById(id);
};

/**
 * getAllPlugins
 * Retorna la lista de todos los plugins disponibles (manifests).
 * Ideal para listar iconos en el menú móvil de herramientas o dashboards.
 */
export const getAllPlugins = (): PluginManifest[] => {
    return PLUGIN_CATALOG.map(p => p.manifest);
};
