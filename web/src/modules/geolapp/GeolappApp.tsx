import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './i18n/config';
import { MainLayout, type ViewState } from './layouts/MainLayout';
import type {
    GeolappDomainMode,
    GeolappGeometryType,
    StockpileAsset,
    StockpileMeasurement,
} from './core/types/GeolappTypes';
import { dataService } from './core/services/DataService';
import { usePlatform } from './core/hooks/usePlatform';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { M3LinearProgress } from '../../components/common/M3LinearProgress';

export interface GeolappDomainWorkspaceProps {
    embedded?: boolean;
    hostScope?: 'CLIENT' | 'DEV_GATEWAY' | 'TEST_PILOT';
    tenantId: string;
    userId: string;
}

const GeomensuraWorkspace = lazy(() =>
    import('./components/GeomensuraWorkspace').then((m) => ({
        default: m.GeomensuraWorkspace,
    }))
) as React.LazyExoticComponent<React.ComponentType<GeolappDomainWorkspaceProps>>;

const ExploracionWorkspace = lazy(() =>
    import('./components/ExploracionWorkspace').then((m) => ({
        default: m.ExploracionWorkspace,
    }))
) as React.LazyExoticComponent<React.ComponentType<GeolappDomainWorkspaceProps>>;

const EstructuralHidroWorkspace = lazy(() =>
    import('./components/EstructuralHidroWorkspace').then((m) => ({
        default: m.EstructuralHidroWorkspace,
    }))
) as React.LazyExoticComponent<React.ComponentType<GeolappDomainWorkspaceProps>>;

const GEOLAPP_DOMAIN_TABS: Array<{
    mode: GeolappDomainMode;
    labelKey: string;
    defaultLabel: string;
}> = [
    {
        mode: 'STOCKPILE',
        labelKey: 'core_shell.modules.stockpile.nav_stockpile',
        defaultLabel: 'STOCKPILES Cu',
    },
    {
        mode: 'GEOMENSURA_GEO',
        labelKey: 'core_shell.modules.stockpile.nav_geomensura',
        defaultLabel: 'GEOMENSURA UTM',
    },
    {
        mode: 'EXPLORACION_SONDAJES',
        labelKey: 'core_shell.modules.stockpile.nav_exploracion',
        defaultLabel: 'EXPLORACIÓN SONDAJES',
    },
    {
        mode: 'ESTRUCTURAL_HIDRO',
        labelKey: 'core_shell.modules.stockpile.nav_estructural',
        defaultLabel: 'ESTRUCTURAL / HIDRO',
    },
];

const MobileHome = lazy(() =>
    import('./components/MobileHome').then((m) => ({ default: m.MobileHome }))
);
const StockList = lazy(() =>
    import('./components/StockList').then((m) => ({ default: m.StockList }))
);
const CaptureSelection = lazy(() =>
    import('./components/CaptureSelection').then((m) => ({ default: m.CaptureSelection }))
);
const GeometrySelection = lazy(() =>
    import('./components/GeometrySelection').then((m) => ({ default: m.GeometrySelection }))
);
const ManualCapture = lazy(() =>
    import('./components/ManualCapture').then((m) => ({ default: m.ManualCapture }))
);
const MobileScanner = lazy(() =>
    import('./components/MobileScanner').then((m) => ({ default: m.MobileScanner }))
);
const DesktopAnalytics = lazy(() =>
    import('./components/DesktopAnalytics').then((m) => ({ default: m.DesktopAnalytics }))
);
const StockpileRegistration = lazy(() =>
    import('./components/StockpileRegistration').then((m) => ({
        default: m.StockpileRegistration,
    }))
);
const StockpileDashboard = lazy(() =>
    import('./components/StockpileDashboard').then((m) => ({ default: m.StockpileDashboard }))
);
const MeasurementDetail = lazy(() =>
    import('./components/MeasurementDetail').then((m) => ({ default: m.MeasurementDetail }))
);
const StockpileSummary = lazy(() =>
    import('./components/StockpileSummary').then((m) => ({ default: m.StockpileSummary }))
);

export interface GeolappAppProps {
    domainMode?: GeolappDomainMode;
    hostScope?: 'CLIENT' | 'DEV_GATEWAY' | 'TEST_PILOT';
    embedded?: boolean;
}

export const GeolappApp: React.FC<GeolappAppProps> = ({
    domainMode = 'STOCKPILE',
    hostScope = 'CLIENT',
    embedded = false,
}) => {
    const { t } = useTranslation();
    const { isNative } = usePlatform();
    const { session } = useMinReportSession();

    const [activeDomain, setActiveDomain] = useState<GeolappDomainMode>(domainMode);

    useEffect(() => {
        setActiveDomain(domainMode);
    }, [domainMode]);

    const resolvedTenantId = useMemo(
        () =>
            session?.tenantId ||
            (typeof window !== 'undefined'
                ? window.localStorage.getItem('minreport_active_account_id') || ''
                : '') ||
            (hostScope === 'TEST_PILOT' ? 'pilot-sandbox' : '') ||
            dataService.getTenantId(),
        [session?.tenantId, hostScope]
    );
    const resolvedUserId = session?.uid || '';

    const [isDesktopLayout, setIsDesktopLayout] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return !isNative && window.innerWidth >= 1024;
    });

    const [view, setView] = useState<ViewState>(() => {
        if (typeof window !== 'undefined' && !isNative && window.innerWidth >= 1024) {
            return 'analytics';
        }
        return 'home';
    });

    const [assets, setAssets] = useState<StockpileAsset[]>([]);
    const [allMeasurements, setAllMeasurements] = useState<StockpileMeasurement[]>([]);
    const [selectedAsset, setSelectedAsset] = useState<StockpileAsset | null>(null);
    const [assetMeasurements, setAssetMeasurements] = useState<StockpileMeasurement[]>([]);
    const [selectedMeasurement, setSelectedMeasurement] = useState<StockpileMeasurement | null>(
        null
    );
    const [selectedGeometry, setSelectedGeometry] =
        useState<GeolappGeometryType>('CONO_ELIPTICO');
    const [isLoadingAssets, setIsLoadingAssets] = useState<boolean>(true);

    // Sync responsive breakpoint
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onResize = () => {
            const desktop = !isNative && window.innerWidth >= 1024;
            setIsDesktopLayout(desktop);
        };
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [isNative]);

    // Propagate active multi-tenant session context into DataService
    useEffect(() => {
        if (resolvedTenantId || resolvedUserId) {
            dataService.setTenantContext({
                tenantId: resolvedTenantId || undefined,
                userId: resolvedUserId || undefined,
            });
        }
    }, [resolvedTenantId, resolvedUserId]);

    // Subscribe to tenant stockpiles & global measurements
    useEffect(() => {
        setIsLoadingAssets(true);
        const unsubAssets = dataService.subscribeToAllAssets((loaded) => {
            setAssets(loaded);
            setIsLoadingAssets(false);
            setSelectedAsset((prev) => {
                if (!prev) return null;
                return loaded.find((a) => a.id === prev.id) ?? prev;
            });
        });

        const unsubMeasAll = dataService.subscribeToMeasurementsAll((loadedMeas) => {
            setAllMeasurements(loadedMeas);
        });

        return () => {
            unsubAssets();
            unsubMeasAll();
        };
    }, [session?.tenantId]);

    // Subscribe to measurements for the active selected asset
    useEffect(() => {
        if (!selectedAsset?.id) {
            setAssetMeasurements([]);
            return;
        }
        const unsub = dataService.subscribeToMeasurements(selectedAsset.id, (list) => {
            setAssetMeasurements(list);
            setSelectedMeasurement((prev) => {
                if (!prev) return null;
                return list.find((m) => m.id === prev.id) ?? prev;
            });
        });
        return () => unsub();
    }, [selectedAsset?.id]);

    const handleSelectAsset = useCallback((asset: StockpileAsset) => {
        setSelectedAsset(asset);
        setView('summary');
    }, []);

    const handleStartNewCapture = useCallback(() => {
        if (selectedAsset) {
            setView('capture-select');
        } else {
            setView('register');
        }
    }, [selectedAsset]);

    const handleNavigate = useCallback(
        (target: ViewState) => {
            if (target === 'capture-select' && !selectedAsset) {
                setView('register');
                return;
            }
            setView(target);
        },
        [selectedAsset]
    );

    const handleRegistrationSuccess = useCallback(async (assetId: string) => {
        const created = await dataService.getAsset(assetId);
        if (created) {
            setSelectedAsset(created);
            setView('summary');
        } else {
            setView('list');
        }
    }, []);

    const handleMeasurementCreated = useCallback(
        async (measurementId: string) => {
            const createdMeas = await dataService.getMeasurement(measurementId);
            if (createdMeas) {
                const refreshedAsset = await dataService.getAsset(createdMeas.assetId);
                if (refreshedAsset) setSelectedAsset(refreshedAsset);
                setSelectedMeasurement(createdMeas);
                setView('detail');
                return;
            }
            setView(selectedAsset ? 'summary' : 'list');
        },
        [selectedAsset]
    );

    const handleToggleIgnoreSelectedMeasurement = useCallback(async () => {
        if (!selectedMeasurement) return;
        await dataService.toggleIgnoreMeasurement(
            selectedMeasurement.id,
            selectedMeasurement.assetId,
            Boolean(selectedMeasurement.ignored)
        );
        const updated = await dataService.getMeasurement(selectedMeasurement.id);
        if (updated) {
            setSelectedMeasurement(updated);
        }
    }, [selectedMeasurement]);

    const suspenseFallback = (
        <div className="h-full w-full flex-1 flex flex-col justify-start bg-[#FFFFFF] dark:bg-[#000000]">
            <M3LinearProgress
                indeterminate
                ariaLabel={t('common.loading', 'CARGANDO...')}
            />
        </div>
    );

    const renderView = () => {
        switch (view) {
            case 'analytics':
                return (
                    <DesktopAnalytics
                        assets={assets}
                        measurements={allMeasurements}
                        onSelectAsset={(asset) => setSelectedAsset(asset)}
                        onBack={() => setView('home')}
                        embedded={embedded}
                    />
                );

            case 'list':
                return (
                    <StockList
                        assets={assets}
                        isLoading={isLoadingAssets}
                        onSelectAsset={handleSelectAsset}
                        onBack={() => setView(isDesktopLayout ? 'analytics' : 'home')}
                        onAddNew={() => setView('register')}
                    />
                );

            case 'register':
                return (
                    <StockpileRegistration
                        onSuccess={handleRegistrationSuccess}
                        onCancel={() => setView(isDesktopLayout ? 'analytics' : 'home')}
                    />
                );

            case 'summary':
                return selectedAsset ? (
                    <StockpileSummary
                        asset={selectedAsset}
                        measurements={assetMeasurements}
                        onSelectMeasurement={(m) => {
                            setSelectedMeasurement(m);
                            setView('detail');
                        }}
                        onBack={() => setView('list')}
                        onNewMeasurement={() => setView('capture-select')}
                    />
                ) : (
                    <StockList
                        assets={assets}
                        isLoading={isLoadingAssets}
                        onSelectAsset={handleSelectAsset}
                        onBack={() => setView(isDesktopLayout ? 'analytics' : 'home')}
                        onAddNew={() => setView('register')}
                    />
                );

            case 'dashboard':
                return selectedAsset ? (
                    <StockpileDashboard
                        asset={selectedAsset}
                        measurements={assetMeasurements}
                        onBack={() => setView('list')}
                        onNewMeasurement={() => setView('capture-select')}
                        onSelectMeasurement={(m) => {
                            setSelectedMeasurement(m);
                            setView('detail');
                        }}
                    />
                ) : (
                    <StockList
                        assets={assets}
                        isLoading={isLoadingAssets}
                        onSelectAsset={handleSelectAsset}
                        onBack={() => setView(isDesktopLayout ? 'analytics' : 'home')}
                        onAddNew={() => setView('register')}
                    />
                );

            case 'detail':
                return selectedMeasurement ? (
                    <MeasurementDetail
                        measurement={selectedMeasurement}
                        asset={selectedAsset}
                        onBack={() => setView(selectedAsset ? 'summary' : 'list')}
                        onToggleIgnore={handleToggleIgnoreSelectedMeasurement}
                    />
                ) : (
                    <StockList
                        assets={assets}
                        isLoading={isLoadingAssets}
                        onSelectAsset={handleSelectAsset}
                        onBack={() => setView(isDesktopLayout ? 'analytics' : 'home')}
                        onAddNew={() => setView('register')}
                    />
                );

            case 'capture-select':
                return (
                    <CaptureSelection
                        onSelection={(method) => {
                            if (method === 'digital') {
                                setView('scanner');
                            } else {
                                setView('geometry-select');
                            }
                        }}
                        onBack={() => setView(selectedAsset ? 'summary' : 'home')}
                    />
                );

            case 'geometry-select':
                return (
                    <GeometrySelection
                        onSelection={(geo) => {
                            setSelectedGeometry(geo);
                            setView('capture');
                        }}
                        onBack={() => setView('capture-select')}
                    />
                );

            case 'capture':
                return selectedAsset ? (
                    <ManualCapture
                        assetId={selectedAsset.id}
                        initialGeometry={selectedGeometry}
                        onSuccess={handleMeasurementCreated}
                        onBack={() => setView('geometry-select')}
                    />
                ) : (
                    <StockpileRegistration
                        onSuccess={handleRegistrationSuccess}
                        onCancel={() => setView('home')}
                    />
                );

            case 'scanner':
                return selectedAsset ? (
                    <MobileScanner
                        assetId={selectedAsset.id}
                        onSuccess={handleMeasurementCreated}
                        onBack={() => setView('capture-select')}
                    />
                ) : (
                    <StockpileRegistration
                        onSuccess={handleRegistrationSuccess}
                        onCancel={() => setView('home')}
                    />
                );

            case 'home':
            default:
                return (
                    <MobileHome
                        onStartNewScan={handleStartNewCapture}
                        onViewRecords={() => setView('list')}
                    />
                );
        }
    };

    const renderDomainContent = () => {
        if (activeDomain === 'GEOMENSURA_GEO') {
            return (
                <div className="flex-1 min-h-0 overflow-y-auto bg-[#FFFFFF] dark:bg-[#000000]">
                    <Suspense fallback={suspenseFallback}>
                        <GeomensuraWorkspace
                            embedded={embedded}
                            hostScope={hostScope}
                            tenantId={resolvedTenantId}
                            userId={resolvedUserId}
                        />
                    </Suspense>
                </div>
            );
        }
        if (activeDomain === 'EXPLORACION_SONDAJES') {
            return (
                <div className="flex-1 min-h-0 overflow-y-auto bg-[#FFFFFF] dark:bg-[#000000]">
                    <Suspense fallback={suspenseFallback}>
                        <ExploracionWorkspace
                            embedded={embedded}
                            hostScope={hostScope}
                            tenantId={resolvedTenantId}
                            userId={resolvedUserId}
                        />
                    </Suspense>
                </div>
            );
        }
        if (activeDomain === 'ESTRUCTURAL_HIDRO') {
            return (
                <div className="flex-1 min-h-0 overflow-y-auto bg-[#FFFFFF] dark:bg-[#000000]">
                    <Suspense fallback={suspenseFallback}>
                        <EstructuralHidroWorkspace
                            embedded={embedded}
                            hostScope={hostScope}
                            tenantId={resolvedTenantId}
                            userId={resolvedUserId}
                        />
                    </Suspense>
                </div>
            );
        }

        return (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <MainLayout
                    currentView={view}
                    onNavigate={handleNavigate}
                    isDesktopLayout={isDesktopLayout}
                    embedded={embedded}
                    domainMode="STOCKPILE"
                >
                    <Suspense fallback={suspenseFallback}>{renderView()}</Suspense>
                </MainLayout>
            </div>
        );
    };

    return (
        <div className="geolapp-scope h-full w-full min-h-0 flex-1 flex flex-col overflow-hidden bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-none">
            <nav
                role="tablist"
                aria-label={t('core_shell.modules.stockpile.domain_selector_aria', 'Dominios operativos GEOLAPP®')}
                className="shrink-0 w-full bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] px-fib-13 flex items-center gap-fib-8 overflow-x-auto no-print"
            >
                {GEOLAPP_DOMAIN_TABS.map((item) => {
                    const isActive = activeDomain === item.mode;
                    return (
                        <button
                            key={item.mode}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => setActiveDomain(item.mode)}
                            className={`min-h-[44px] px-fib-13 py-fib-8 font-mono text-microcopy font-bold uppercase tracking-wider whitespace-nowrap border-x-0 border-t-0 border-b-2 rounded-none shadow-none cursor-pointer transition-colors ${
                                isActive
                                    ? 'border-b-[#C68346] text-[#C68346] bg-[#FFFFFF] dark:bg-[#000000]'
                                    : 'border-b-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] bg-transparent'
                            }`}
                        >
                            {t(item.labelKey, item.defaultLabel)}
                        </button>
                    );
                })}
            </nav>
            {renderDomainContent()}
        </div>
    );
};

export default GeolappApp;
