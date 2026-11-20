import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export type CoreModuleId = 'opermaq' | 'stockpile';

export type OpermaqDomainMode = 'CATALOG' | 'FLEET' | 'SYMBOLOGY' | 'MANUFACTURERS' | 'SUPPLIERS';

export type GeolappDomainMode = 'STOCKPILE';

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
        name: 'ACOPIOS',
        nameKey: 'core_shell.modules.stockpile.name',
        description: 'Control de Acopios Cu',
        descriptionKey: 'core_shell.modules.stockpile.description',
        scope: 'Control volumétrico, fotográfico, granulométrico y geo-metalúrgico de acopios minerales Cu.',
        scopeKey: 'core_shell.modules.stockpile.scope',
        path: '/acopios',
        icon: 'landscape',
        version: '2.0.0',
        component: StockpileLazyComponent,
        supportsDomainMode: true,
        clientNavItems: [
            {
                to: '/acopios',
                title: 'ACOPIOS',
                titleKey: 'core_shell.modules.stockpile.nav_stockpile',
                icon: 'landscape',
                domainMode: 'STOCKPILE',
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
