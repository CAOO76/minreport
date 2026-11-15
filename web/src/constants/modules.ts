import {
    CORE_MODULES,
    type CoreModuleDescriptor,
} from '../core/modules/module-registry';

export type SystemModuleInfo = Pick<
    CoreModuleDescriptor,
    'id' | 'name' | 'path' | 'icon' | 'description' | 'scope' | 'version'
>;

export const SYSTEM_MODULES: SystemModuleInfo[] = CORE_MODULES.map((mod) => ({
    id: mod.id,
    name: mod.name,
    path: mod.path,
    icon: mod.icon,
    description: mod.description,
    scope: mod.scope,
    version: mod.version,
}));

export const getSystemModuleById = (id: string): SystemModuleInfo | undefined => {
    return SYSTEM_MODULES.find((m) => m.id === id);
};
