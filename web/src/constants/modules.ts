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
        name: 'FLOTA',
        path: '/opermaq',
        icon: 'lists',
        description: 'Control de Flota',
        scope: 'Registro de unidades por número de serie, fotografías privadas y consulta de 5 pilares.',
        version: '1.0.0',
    },
    {
        id: 'stockpile',
        name: 'STOCKPILE',
        path: '/stockpile',
        icon: 'layers',
        description: 'Cubicaciones y Volumetría',
        scope: 'Cálculo volumétrico y cubicación topográfica de acopios.',
        version: '1.0.0',
    },
];

export const getSystemModuleById = (id: string): SystemModuleInfo | undefined => {
    return SYSTEM_MODULES.find((m) => m.id === id);
};
