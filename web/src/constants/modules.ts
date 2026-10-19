export interface SystemModuleInfo {
    id: string;
    name: string;
    path: string;
    icon: string;
    description: string;
    scope: string;
    version: string;
}

export const SYSTEM_MODULES: SystemModuleInfo[] = [
    {
        id: 'opermaq',
        name: 'OPERMAQ',
        path: '/opermaq',
        icon: 'local_shipping',
        description: 'Flota y Equipos',
        scope: 'Telemetría y registro operativo de maquinaria pesada.',
        version: '1.0.0'
    },
    {
        id: 'stockpile',
        name: 'STOCKPILE',
        path: '/stockpile',
        icon: 'layers',
        description: 'Cubicaciones y Volumetría',
        scope: 'Cálculo volumétrico y cubicación topográfica de acopios.',
        version: '1.0.0'
    },
    {
        id: 'mining-flow',
        name: 'MINING FLOW',
        path: '/mining-flow',
        icon: 'payments',
        description: 'Finanzas y Flujos',
        scope: 'Monitoreo de flujo y transporte de mineral.',
        version: '1.0.0'
    }
];

export const getSystemModuleById = (id: string): SystemModuleInfo | undefined => {
    return SYSTEM_MODULES.find(m => m.id === id);
};
