import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export type CoreModuleId = 'opermaq' | 'stockpile';

export type OpermaqDomainMode = 'CATALOG' | 'FLEET' | 'SYMBOLOGY' | 'MANUFACTURERS' | 'SUPPLIERS';

export type GeolappDomainMode =
    | 'STOCKPILE'
    | 'GEOMENSURA_GEO'
    | 'EXPLORACION_SONDAJES'
    | 'ESTRUCTURAL_HIDRO';

export const OpermaqLazyComponent = lazy(() =>
    import('../../modules/opermaq/OpermaqModule').then((m) => ({ default: m.OpermaqModule }))
);

export const StockpileLazyComponent = lazy(() =>
    import('../../modules/geolapp/GeolappModule').then((m) => ({ default: m.GeolappModule }))
);

export interface CoreModuleNavItem {
    to: string;
    title: string;
    titleKey: string;
    icon: string;
    end?: boolean;
    domainMode?: OpermaqDomainMode | GeolappDomainMode;
    resetEvent?: string;
}

export interface CoreModuleDescriptor {
    id: CoreModuleId;
    name: string;
    nameKey: string;
    description: string;
    descriptionKey: string;
    scope: string;
    scopeKey: string;
    path: string;
    icon: string;
    version: string;
    component: LazyExoticComponent<ComponentType<any>>;
    supportsDomainMode: boolean;
    clientNavItems: CoreModuleNavItem[];
}

export const CORE_MODULES: CoreModuleDescriptor[] = [
    {
        id: 'opermaq',
        name: 'FLOTA',
        nameKey: 'core_shell.modules.opermaq.name',
        description: 'Control de Flota',
        descriptionKey: 'core_shell.modules.opermaq.description',
        scope: 'Registro de unidades por número de serie, fotografías privadas y consulta de 5 pilares.',
        scopeKey: 'core_shell.modules.opermaq.scope',
        path: '/opermaq',
        icon: 'lists',
        version: '1.0.0',
        component: OpermaqLazyComponent,
        supportsDomainMode: true,
        clientNavItems: [
            {
                to: '/opermaq',
                title: 'FLOTA',
                titleKey: 'core_shell.modules.opermaq.nav_fleet',
                icon: 'lists',
                end: true,
                domainMode: 'FLEET',
                resetEvent: 'opermaq:navigate-home',
            },
            {
                to: '/opermaq/simbologia',
                title: 'SIMBOLOGÍA',
                titleKey: 'core_shell.modules.opermaq.nav_symbology',
                icon: 'shapes',
                domainMode: 'SYMBOLOGY',
                resetEvent: 'opermaq:navigate-home',
            },
            {
                to: '/opermaq/fabricantes',
                title: 'FABRICANTES',
                titleKey: 'core_shell.modules.opermaq.nav_manufacturers',
                icon: 'factory',
                domainMode: 'MANUFACTURERS',
                resetEvent: 'opermaq:navigate-home',
            },
            {
                to: '/opermaq/proveedores',
                title: 'PROVEEDORES',
                titleKey: 'core_shell.modules.opermaq.nav_suppliers',
                icon: 'storefront',
                domainMode: 'SUPPLIERS',
                resetEvent: 'opermaq:navigate-home',
            },
        ],
    },
    {
        id: 'stockpile',
        name: 'GEOLAPP®',
        nameKey: 'core_shell.modules.stockpile.name',
        description: 'GEOLAPP® · Geociencias y Control Minero Cu',
        descriptionKey: 'core_shell.modules.stockpile.description',
        scope: 'GEOLAPP®: control geológico-volumétrico de stockpiles Cu, geomensura UTM/RTK, sondajes DDH/RC y mapeo estructural/hidrogeológico.',
        scopeKey: 'core_shell.modules.stockpile.scope',
        path: '/geolapp/stockpiles',
        icon: 'layers',
        version: '2.0.0',
        component: StockpileLazyComponent,
        supportsDomainMode: true,
        clientNavItems: [
            {
                to: '/geolapp/stockpiles',
                title: 'GEOLAPP® · STOCKPILES',
                titleKey: 'core_shell.modules.stockpile.nav_stockpile',
                icon: 'layers',
                domainMode: 'STOCKPILE',
            },
            {
                to: '/geolapp/geomensura',
                title: 'GEOLAPP® · GEOMENSURA',
                titleKey: 'core_shell.modules.stockpile.nav_geomensura',
                icon: 'straighten',
                domainMode: 'GEOMENSURA_GEO',
            },
            {
                to: '/geolapp/exploracion',
                title: 'GEOLAPP® · EXPLORACIÓN',
                titleKey: 'core_shell.modules.stockpile.nav_exploracion',
                icon: 'explore',
                domainMode: 'EXPLORACION_SONDAJES',
            },
            {
                to: '/geolapp/estructural',
                title: 'GEOLAPP® · ESTRUCTURAL',
                titleKey: 'core_shell.modules.stockpile.nav_estructural',
                icon: 'architecture',
                domainMode: 'ESTRUCTURAL_HIDRO',
            },
        ],
    },
];

export const CORE_MODULE_MAP: Record<CoreModuleId, CoreModuleDescriptor> = {
    opermaq: CORE_MODULES[0],
    stockpile: CORE_MODULES[1],
};

export const isCoreModuleId = (value: unknown): value is CoreModuleId =>
    value === 'opermaq' || value === 'stockpile';
