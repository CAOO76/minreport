import { MinReport } from '../sdk-bundle';
import { DISCOVERED_PLUGINS } from './DiscoveredPlugins';

/**
 * Registro Central de Plugins (Admin Core) - DINÁMICO
 */

// 1. Registro Automático
DISCOVERED_PLUGINS.forEach(p => {
    if (!MinReport.Core.getPluginById(p.manifest.id)) {
        MinReport.Core.register(p.manifest, p.instance as any);
    }
});

export const getPluginById = (id: string) => {
    return MinReport.Core.getPluginById(id);
};

export const getAllPlugins = () => {
    return PLUGIN_CATALOG.map(p => p.manifest);
};
