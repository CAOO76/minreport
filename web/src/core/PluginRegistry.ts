import { MinReport, PluginManifest } from '@minreport/sdk';
import { DISCOVERED_PLUGINS } from './DiscoveredPlugins';

/**
 * Registro Central de Plugins (Web Core) - DINÁMICO
 */

// 1. Registro Automático
DISCOVERED_PLUGINS.forEach(p => {
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
    return DISCOVERED_PLUGINS.map(p => p.manifest);
};
