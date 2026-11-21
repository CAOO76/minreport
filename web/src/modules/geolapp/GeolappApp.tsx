import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './i18n/config';
import { MainLayout, type ViewState } from './layouts/MainLayout';
import type {
    GeolappDomainMode,
    MiningSiteProfile,
    StockpileAsset,
    StockpileMeasurement,
} from './core/types/GeolappTypes';
import { dataService } from './core/services/DataService';
import { UNASSIGNED_FAENA_ID } from './core/services/stockpile-faena-metrics';
import { usePlatform } from './core/hooks/usePlatform';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { M3LinearProgress } from '../../components/common/M3LinearProgress';

const MobileAcopiosHub = lazy(() =>
    import('./components/MobileAcopiosHub').then((m) => ({ default: m.MobileAcopiosHub }))
);
const MobileCalibrationView = lazy(() =>
    import('./components/MobileCalibrationView').then((m) => ({
        default: m.MobileCalibrationView,
    }))
);
const MobileFaenaList = lazy(() =>
    import('./components/MobileFaenaList').then((m) => ({ default: m.MobileFaenaList }))
);
const MobileHome = lazy(() =>
    import('./components/MobileHome').then((m) => ({ default: m.MobileHome }))
);
const MobileFaenaMonitoring = lazy(() =>
    import('./components/MobileFaenaMonitoring').then((m) => ({
        default: m.MobileFaenaMonitoring,
    }))
);
const QuickStockpileCapture = lazy(() =>
    import('./components/QuickStockpileCapture').then((m) => ({ default: m.QuickStockpileCapture }))
);
const StockpileDossierView = lazy(() =>
    import('./components/StockpileDossierView').then((m) => ({ default: m.StockpileDossierView }))
);
const MobileScanner = lazy(() =>
    import('./components/MobileScanner').then((m) => ({ default: m.MobileScanner }))
);
const DesktopAnalytics = lazy(() =>
    import('./components/DesktopAnalytics').then((m) => ({ default: m.DesktopAnalytics }))
);
const MeasurementDetail = lazy(() =>
    import('./components/MeasurementDetail').then((m) => ({ default: m.MeasurementDetail }))
);

export interface GeolappAppProps {
    domainMode?: GeolappDomainMode;
    hostScope?: 'CLIENT' | 'DEV_GATEWAY' | 'TEST_PILOT';
    embedded?: boolean;
    onExitModule?: () => void;
    mobileConnectivitySlot?: React.ReactNode;
}

export const GeolappApp: React.FC<GeolappAppProps> = ({
    hostScope = 'CLIENT',
    embedded = false,
    onExitModule,
    mobileConnectivitySlot,
}) => {
    const { t } = useTranslation();
    const { isNative } = usePlatform();
    const { session } = useMinReportSession();

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
    const canRegisterDevFaena = Boolean(
        isDesktopLayout && (hostScope === 'DEV_GATEWAY' || session?.isDevRoot)
    );

    const [view, setView] = useState<ViewState>(() => {
        if (typeof window !== 'undefined' && !isNative && window.innerWidth >= 1024) {
            return 'analytics';
        }
        return 'hub';
    });

    const [assets, setAssets] = useState<StockpileAsset[]>([]);
    const [allMeasurements, setAllMeasurements] = useState<StockpileMeasurement[]>([]);
    const [miningSites, setMiningSites] = useState<MiningSiteProfile[]>([]);
    const [activeFaenaId, setActiveFaenaId] = useState<string | 'ALL'>('ALL');
    const [selectedAsset, setSelectedAsset] = useState<StockpileAsset | null>(null);
    const [captureTargetAsset, setCaptureTargetAsset] = useState<StockpileAsset | null>(null);
    const [justCreatedAssetId, setJustCreatedAssetId] = useState<string | null>(null);
    const [assetMeasurements, setAssetMeasurements] = useState<StockpileMeasurement[]>([]);
    const [selectedMeasurement, setSelectedMeasurement] = useState<StockpileMeasurement | null>(
        null
    );
    const [isLoadingAssets, setIsLoadingAssets] = useState<boolean>(true);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onResize = () => setIsDesktopLayout(!isNative && window.innerWidth >= 1024);
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [isNative]);

    useEffect(() => {
        if (resolvedTenantId || resolvedUserId) {
            dataService.setTenantContext({
                tenantId: resolvedTenantId || undefined,
                userId: resolvedUserId || undefined,
            });
        }
    }, [resolvedTenantId, resolvedUserId]);

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
        const unsubMeasAll = dataService.subscribeToMeasurementsAll(setAllMeasurements);
        const unsubSites = dataService.subscribeToMiningSites(setMiningSites);
        return () => {
            unsubAssets();
            unsubMeasAll();
            unsubSites();
        };
    }, [session?.tenantId]);

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

    const activeFaenaMeta = useMemo(() => {
        if (activeFaenaId === 'ALL') return null;
        if (activeFaenaId === UNASSIGNED_FAENA_ID) {
            return {
                id: UNASSIGNED_FAENA_ID,
                name: t('faenas.unassigned', 'SIN FAENA ASIGNADA'),
                isUnassigned: true,
            };
        }
        const site = miningSites.find((s) => s.id === activeFaenaId);
        const fallbackAsset = assets.find((a) => (a.project_id || '') === activeFaenaId);
        return {
            id: activeFaenaId,
            name: site?.name || fallbackAsset?.project_name || activeFaenaId,
            isUnassigned: false,
        };
    }, [activeFaenaId, assets, miningSites, t]);

    const handleRegisterDevFaena = useCallback(async (name: string) => {
        return dataService.registerDevMiningSite({ name });
    }, []);

    const handleSelectFaenaFromList = useCallback((faenaId: string) => {
        setActiveFaenaId(faenaId);
        setSelectedAsset(null);
        setSelectedMeasurement(null);
        setJustCreatedAssetId(null);
        setView('home');
    }, []);

    const handleBackToFaenas = useCallback(() => {
        setSelectedAsset(null);
        setSelectedMeasurement(null);
        setJustCreatedAssetId(null);
        setActiveFaenaId('ALL');
        setView('faenas');
    }, []);

    const handleSelectAsset = useCallback((asset: StockpileAsset) => {
        setJustCreatedAssetId(null);
        setSelectedAsset(asset);
        setView('summary');
    }, []);

    const handleStartNewStockpileInFaena = useCallback(() => {
        if (isDesktopLayout) return;
        if (activeFaenaId === 'ALL' || activeFaenaId === UNASSIGNED_FAENA_ID) return;
        setCaptureTargetAsset(null);
        setView('quick-capture');
    }, [activeFaenaId, isDesktopLayout]);

    const handleTriggerNewMeasurement = useCallback(() => {
        if (!selectedAsset || selectedAsset.status === 'CLOSED') return;
        setCaptureTargetAsset(selectedAsset);
        setView('quick-capture');
    }, [selectedAsset]);

    const handleNavigate = useCallback(
        (target: ViewState) => {
            if (!isDesktopLayout && target === 'analytics') {
                setSelectedAsset(null);
                setSelectedMeasurement(null);
                setView(activeFaenaMeta ? 'home' : 'faenas');
                return;
            }
            if (target === 'hub') {
                if (isDesktopLayout) {
                    setView('analytics');
                    return;
                }
                setSelectedAsset(null);
                setSelectedMeasurement(null);
                setView('hub');
                return;
            }
            if (target === 'calibration') {
                if (isDesktopLayout) {
                    setView('analytics');
                    return;
                }
                setSelectedAsset(null);
                setSelectedMeasurement(null);
                setView('calibration');
                return;
            }
            if (target === 'faenas') {
                if (isDesktopLayout) {
                    setView('analytics');
                    return;
                }
                handleBackToFaenas();
                return;
            }
            if (target === 'home') {
                if (isDesktopLayout) {
                    setSelectedAsset(null);
                    setSelectedMeasurement(null);
                    setView('analytics');
                    return;
                }
                if (view === 'summary' || view === 'detail' || view === 'monitoring') {
                    setSelectedAsset(null);
                    setSelectedMeasurement(null);
                    setView(activeFaenaMeta ? 'home' : 'faenas');
                    return;
                }
                handleBackToFaenas();
                return;
            }
            if (target === 'monitoring') {
                setSelectedAsset(null);
                setSelectedMeasurement(null);
                setView('monitoring');
                return;
            }
            if (target === 'quick-capture') {
                if (isDesktopLayout) {
                    setView('analytics');
                    return;
                }
                if (selectedAsset && selectedAsset.status !== 'CLOSED') {
                    setCaptureTargetAsset(selectedAsset);
                    setView('quick-capture');
                    return;
                }
                if (activeFaenaMeta && !activeFaenaMeta.isUnassigned) {
                    setCaptureTargetAsset(null);
                    setView('quick-capture');
                    return;
                }
                setView('faenas');
                return;
            }
            setView(target);
        },
        [activeFaenaMeta, handleBackToFaenas, isDesktopLayout, selectedAsset, view]
    );

    const handleQuickCaptureComplete = useCallback(
        async (result: { assetId: string; measurementId: string; isNewAsset: boolean }) => {
            const loadedAsset = await dataService.getAsset(result.assetId);
            if (loadedAsset) {
                setSelectedAsset(loadedAsset);
            }
            setJustCreatedAssetId(result.isNewAsset ? result.assetId : null);
            setView('summary');
        },
        []
    );

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
            setView(selectedAsset ? 'summary' : 'home');
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
        if (updated) setSelectedMeasurement(updated);
    }, [selectedMeasurement]);

    const suspenseFallback = (
        <div className="h-full w-full flex-1 flex flex-col justify-start bg-[#FFFFFF] dark:bg-[#000000]">
            <M3LinearProgress indeterminate ariaLabel={t('common.loading', 'CARGANDO...')} />
        </div>
    );

    const handleToggleClosureFromLayout = useCallback(() => {
        if (!selectedAsset) return;
        if (view === 'detail') {
            setView('summary');
            if (typeof window !== 'undefined') {
                window.setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('minreport:toggle-closure'));
                }, 60);
            }
            return;
        }
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('minreport:toggle-closure'));
        }
    }, [selectedAsset, view]);

    const mobileHubElement = (
        <MobileAcopiosHub
            onSelectMeasure={() => setView('faenas')}
            onSelectCalibrate={() => setView('calibration')}
            onBackToHome={onExitModule}
            connectivitySlot={mobileConnectivitySlot}
            sitesCount={miningSites.length}
            assetsCount={assets.length}
        />
    );

    const mobileFaenaListElement = (
        <MobileFaenaList
            sites={miningSites}
            assets={assets}
            measurements={allMeasurements}
            isLoading={isLoadingAssets}
            onSelectFaena={handleSelectFaenaFromList}
            onBackToHome={() => setView('hub')}
            connectivitySlot={mobileConnectivitySlot}
        />
    );

    const mobileHomeElement = activeFaenaMeta ? (
        <MobileHome
            faenaId={activeFaenaMeta.id}
            faenaName={activeFaenaMeta.name}
            isUnassignedBucket={activeFaenaMeta.isUnassigned}
            assets={assets}
            isLoading={isLoadingAssets}
            onBackToFaenas={handleBackToFaenas}
            onStartNewStockpile={handleStartNewStockpileInFaena}
            onSelectAsset={handleSelectAsset}
            connectivitySlot={mobileConnectivitySlot}
        />
    ) : (
        mobileFaenaListElement
    );

    const activeSiteIdForCapture =
        activeFaenaMeta && !activeFaenaMeta.isUnassigned ? activeFaenaMeta.id : null;

    const desktopAnalyticsElement = (
        <DesktopAnalytics
            assets={assets}
            measurements={allMeasurements}
            sites={miningSites}
            activeFaenaId={activeFaenaId}
            onSelectFaena={setActiveFaenaId}
            canRegisterDevFaena={canRegisterDevFaena}
            onRegisterDevFaena={handleRegisterDevFaena}
            onSelectAsset={(asset: StockpileAsset) => setSelectedAsset(asset)}
            onBack={() => setView('faenas')}
            embedded={embedded}
        />
    );

    const renderView = () => {
        if (isDesktopLayout) {
            return desktopAnalyticsElement;
        }

        switch (view) {
            case 'hub':
                return mobileHubElement;

            case 'calibration':
                return (
                    <MobileCalibrationView
                        tenantId={resolvedTenantId}
                        onBack={() => setView('hub')}
                        connectivitySlot={mobileConnectivitySlot}
                    />
                );

            case 'faenas':
            case 'analytics':
                return mobileFaenaListElement;

            case 'monitoring':
                return (
                    <MobileFaenaMonitoring
                        assets={assets}
                        measurements={allMeasurements}
                        sites={miningSites}
                        activeFaenaId={activeFaenaId}
                        onSelectFaena={setActiveFaenaId}
                        onSelectAsset={handleSelectAsset}
                    />
                );

            case 'quick-capture':
                return (
                    <QuickStockpileCapture
                        existingAsset={captureTargetAsset}
                        sites={miningSites}
                        selectedFaenaId={activeSiteIdForCapture}
                        onComplete={(res) => void handleQuickCaptureComplete(res)}
                        onCancel={() =>
                            setView(
                                captureTargetAsset
                                    ? 'summary'
                                    : activeFaenaMeta
                                        ? 'home'
                                        : 'faenas'
                            )
                        }
                    />
                );

            case 'summary':
                return selectedAsset ? (
                    <StockpileDossierView
                        asset={selectedAsset}
                        measurements={assetMeasurements}
                        justCreated={justCreatedAssetId === selectedAsset.id}
                        isMobileField={true}
                        onSelectMeasurement={(m) => {
                            setSelectedMeasurement(m);
                            setView('detail');
                        }}
                        onBack={() => {
                            setSelectedAsset(null);
                            setSelectedMeasurement(null);
                            setView(activeFaenaMeta ? 'home' : 'faenas');
                        }}
                        onNewMeasurement={() => {
                            setCaptureTargetAsset(selectedAsset);
                            setView('quick-capture');
                        }}
                    />
                ) : (
                    mobileHomeElement
                );

            case 'detail':
                return selectedMeasurement ? (
                    <MeasurementDetail
                        measurement={selectedMeasurement}
                        asset={selectedAsset}
                        isMobileField={true}
                        onBack={() =>
                            setView(selectedAsset ? 'summary' : activeFaenaMeta ? 'home' : 'faenas')
                        }
                        onToggleIgnore={handleToggleIgnoreSelectedMeasurement}
                    />
                ) : (
                    mobileHomeElement
                );

            case 'scanner':
                return selectedAsset ? (
                    <MobileScanner
                        assetId={selectedAsset.id}
                        onSuccess={handleMeasurementCreated}
                        onBack={() => setView('summary')}
                    />
                ) : (
                    <QuickStockpileCapture
                        sites={miningSites}
                        selectedFaenaId={activeSiteIdForCapture}
                        onComplete={(res) => void handleQuickCaptureComplete(res)}
                        onCancel={() => setView(activeFaenaMeta ? 'home' : 'faenas')}
                    />
                );

            case 'home':
                return mobileHomeElement;

            default:
                return mobileHubElement;
        }
    };

    return (
        <div className="geolapp-scope h-full w-full min-h-0 flex-1 flex flex-col overflow-hidden bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-none">
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <MainLayout
                    currentView={view}
                    onNavigate={handleNavigate}
                    isDesktopLayout={isDesktopLayout}
                    embedded={embedded}
                    domainMode="STOCKPILE"
                    hasSelectedAsset={Boolean(selectedAsset)}
                    isSelectedAssetClosed={selectedAsset?.status === 'CLOSED'}
                    onTriggerNewMeasurement={handleTriggerNewMeasurement}
                    onToggleClosure={handleToggleClosureFromLayout}
                    onExitModule={onExitModule}
                    mobileConnectivitySlot={mobileConnectivitySlot}
                >
                    <Suspense fallback={suspenseFallback}>{renderView()}</Suspense>
                </MainLayout>
            </div>
        </div>
    );
};

export default GeolappApp;
