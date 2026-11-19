/**
 * Registro Canónico Backend de Módulos Nativos Integrados (Micro-Kernel MINREPORT Core).
 * Fuente única de verdad en servidor para validación de módulos, prefijos API y modos de dominio.
 */

export const CORE_MODULE_IDS = ['opermaq', 'stockpile'] as const;

export type CoreModuleId = (typeof CORE_MODULE_IDS)[number];

export interface BackendModuleDescriptor {
    id: CoreModuleId;
    name: string;
    basePath: string;
    version: string;
    domainModes: readonly string[];
    defaultEnabled: boolean;
}

export const CORE_MODULE_REGISTRY: Record<CoreModuleId, BackendModuleDescriptor> = {
    opermaq: {
        id: 'opermaq',
        name: 'OPERMAQ',
        basePath: '/api/opermaq',
        version: '3.0.0',
        domainModes: ['CATALOG', 'FLEET', 'SYMBOLOGY', 'MANUFACTURERS', 'SUPPLIERS'] as const,
        defaultEnabled: true,
    },
    stockpile: {
        id: 'stockpile',
        name: 'STOCKPILE CONTROL',
        basePath: '/api/stockpile',
        version: '2.0.0',
        domainModes: ['STOCKPILE'] as const,
        defaultEnabled: true,
    },
};

export function isCoreModuleId(value: unknown): value is CoreModuleId {
    return typeof value === 'string' && (CORE_MODULE_IDS as readonly string[]).includes(value);
}
