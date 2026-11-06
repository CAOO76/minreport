import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { API_BASE_URL } from './firebase/config';
import {
    OpermaqContextProvider,
    resolveEffectiveOpermaqDomain,
    useBuildOpermaqContext,
    type OpermaqHostScope,
} from './hooks/useOpermaqContext';
import { authFetch } from './utils/authFetch';
import { AssetList, type OpermaqDomainMode } from './components/AssetList';

// Carga diferida (Capa 2 MINREPORT — INP < 100ms, cero bloqueo en render path)
const AssetRegistration = lazy(() =>
    import('./components/AssetRegistration').then((m) => ({ default: m.AssetRegistration }))
);
const FleetUnitRegistrationModal = lazy(() =>
    import('./components/FleetUnitRegistrationModal').then((m) => ({
        default: m.FleetUnitRegistrationModal,
    }))
);
const FleetUnitWorkspace = lazy(() =>
    import('./components/FleetUnitWorkspace').then((m) => ({ default: m.FleetUnitWorkspace }))
);
const KnowledgeVaultDashboard = lazy(() =>
    import('./components/KnowledgeVaultDashboard').then((m) => ({
        default: m.KnowledgeVaultDashboard,
    }))
);
const CatalogContributionsReviewPanel = lazy(() =>
    import('./components/CatalogContributionsReviewPanel').then((m) => ({
        default: m.CatalogContributionsReviewPanel,
    }))
);
const GlobalSymbologyDashboard = lazy(() =>
    import('./components/GlobalSymbologyDashboard').then((m) => ({
        default: m.GlobalSymbologyDashboard,
    }))
);

type OpermaqView = 'list' | 'registration' | 'vault' | 'fleet_unit' | 'contributions';

export interface OpermaqAppProps {
    embedded?: boolean;
    domainMode?: OpermaqDomainMode;
    hostScope?: OpermaqHostScope;
    role?: string;
    userId?: string;
    tenantId?: string;
    onTelemetryEvent?: (event: unknown) => void;
}

const ViewFallback = () => (
    <div className="h-full w-full flex items-center justify-center p-[21px] font-mono text-xs text-[#475569] dark:text-[#8A93A6]">
        [Cargando...]
    </div>
);

function App({
    domainMode = 'FLEET',
    hostScope = 'CLIENT',
    userId: propUserId,
    tenantId: propTenantId,
    onTelemetryEvent,
}: OpermaqAppProps = {}) {
    const ctx = useBuildOpermaqContext({
        tenantId: propTenantId,
        userId: propUserId,
        hostScope,
    });

    // Separación Soberana: Clientes B2B / EDU operan exclusivamente en `FLOTA`
    const effectiveDomain: OpermaqDomainMode = resolveEffectiveOpermaqDomain(
        domainMode,
        ctx.capabilities
    );

    const [currentView, setCurrentView] = useState<OpermaqView>('list');
    const [selectedCatalogAssetId, setSelectedCatalogAssetId] = useState<string | null>(null);
    const [selectedFleetUnit, setSelectedFleetUnit] = useState<{
        id: string;
        globalAssetId: string;
    } | null>(null);
    const [showFleetRegistrationModal, setShowFleetRegistrationModal] = useState<boolean>(false);
    const [fleetRefreshSeq, setFleetRefreshSeq] = useState<number>(0);
    const [pendingContributionsCount, setPendingContributionsCount] = useState<number>(0);

    // Al cambiar entre CATÁLOGO y FLOTA, restablecer vista limpia de ese dominio
    useEffect(() => {
        setCurrentView('list');
        setSelectedCatalogAssetId(null);
        setSelectedFleetUnit(null);
        setShowFleetRegistrationModal(false);
    }, [effectiveDomain]);

    useEffect(() => {
        if (selectedCatalogAssetId) localStorage.setItem('opermaq_asset_id', selectedCatalogAssetId);
        else localStorage.removeItem('opermaq_asset_id');
    }, [selectedCatalogAssetId]);

    const refreshPendingContributions = useCallback(async () => {
        if (!ctx.capabilities.canCurateAI || effectiveDomain !== 'CATALOG') {
            setPendingContributionsCount(0);
            return;
        }
        try {
            const res = await authFetch(
                `${API_BASE_URL}/vault/contributions?status=PENDING_HUMAN_REVIEW`
            );
            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                setPendingContributionsCount(Array.isArray(data?.items) ? data.items.length : 0);
            }
        } catch {
            // Silencioso en barra curador
        }
    }, [ctx.capabilities.canCurateAI, effectiveDomain]);

    useEffect(() => {
        void refreshPendingContributions();
    }, [refreshPendingContributions]);

    const handleSelectCatalogAsset = (globalAssetId: string) => {
        setSelectedCatalogAssetId(globalAssetId);
        setCurrentView('vault');
        onTelemetryEvent?.({
            type: 'CATALOG_ASSET_SELECTED',
            assetId: globalAssetId,
            tenantId: ctx.tenantId,
            userId: ctx.actorId,
        });
    };

    const handleSelectFleetUnit = (unit: { id: string; globalAssetId: string }) => {
        setSelectedFleetUnit(unit);
        setCurrentView('fleet_unit');
        onTelemetryEvent?.({
            type: 'FLEET_UNIT_SELECTED',
            tenantAssetId: unit.id,
            assetId: unit.globalAssetId,
            tenantId: ctx.tenantId,
            userId: ctx.actorId,
        });
    };

    const handleCatalogNav = (target: 'list' | 'contributions') => {
        if (target === 'list') {
            setSelectedCatalogAssetId(null);
        }
        setCurrentView(target);
    };

    if (!ctx.isLoaded) {
        return (
            <div className="h-full min-h-[calc(100vh-64px)] w-full flex items-center justify-center bg-[#FFFFFF] dark:bg-[#000000]">
                <div className="w-8 h-8 border-2 border-[#C68346] border-t-transparent rounded-none animate-spin" />
            </div>
        );
    }

    return (
        <OpermaqContextProvider value={ctx}>
            <div className="w-full h-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans overflow-hidden select-none">
                <main className="flex-1 overflow-hidden relative bg-[#FFFFFF] dark:bg-[#000000]">
                    <div className="h-full w-full overflow-auto relative">
                        {/* DOMINIO 1: CATÁLOGO ÚNICO Y GENÉRICO (`1º DEV` / `3º TEST-PILOT`) */}
                        {effectiveDomain === 'CATALOG' &&
                            (currentView === 'list' || currentView === 'registration') && (
                                <AssetList
                                    domainMode="CATALOG"
                                    onSelectCatalogAsset={handleSelectCatalogAsset}
                                    onNew={() => setCurrentView('registration')}
                                    pendingContributionsCount={pendingContributionsCount}
                                    onOpenContributions={() => {
                                        setSelectedCatalogAssetId(null);
                                        handleCatalogNav('contributions');
                                    }}
                                />
                            )}

                        {/* DOMINIO 2: CONTROL DE FLOTA DEL USUARIO / CLIENTE (`tenant_assets`) */}
                        {effectiveDomain === 'FLEET' && currentView === 'list' && (
                            <AssetList
                                key={`fleet-list-${fleetRefreshSeq}`}
                                domainMode="FLEET"
                                onSelectFleetUnit={handleSelectFleetUnit}
                                onNew={() => setShowFleetRegistrationModal(true)}
                            />
                        )}

                        <Suspense fallback={<ViewFallback />}>
                            {/* DOMINIO 3 TRANSVERSAL: SIMBOLOGÍA ISO 7000 */}
                            {effectiveDomain === 'SYMBOLOGY' && <GlobalSymbologyDashboard />}

                            {effectiveDomain === 'CATALOG' && currentView === 'registration' && (
                                <AssetRegistration
                                    isGlobalOnly={true}
                                    onSuccess={(id) => {
                                        onTelemetryEvent?.({
                                            type: 'EQUIPMENT_REGISTERED',
                                            assetId: id,
                                            tenantId: ctx.tenantId,
                                            userId: ctx.actorId,
                                        });
                                        setCurrentView('list');
                                    }}
                                    onCancel={() => setCurrentView('list')}
                                />
                            )}

                            {effectiveDomain === 'CATALOG' &&
                                currentView === 'vault' &&
                                selectedCatalogAssetId && (
                                    <KnowledgeVaultDashboard
                                        assetId={selectedCatalogAssetId}
                                        onBack={() => {
                                            setSelectedCatalogAssetId(null);
                                            setCurrentView('list');
                                        }}
                                        onOpenContributions={(aid) => {
                                            setSelectedCatalogAssetId(aid);
                                            setCurrentView('contributions');
                                        }}
                                    />
                                )}

                            {effectiveDomain === 'CATALOG' &&
                                currentView === 'contributions' &&
                                ctx.capabilities.canCurateAI && (
                                    <CatalogContributionsReviewPanel
                                        filterGlobalAssetId={selectedCatalogAssetId}
                                        onBack={() =>
                                            selectedCatalogAssetId
                                                ? setCurrentView('vault')
                                                : handleCatalogNav('list')
                                        }
                                        onReviewed={() => void refreshPendingContributions()}
                                    />
                                )}

                            {effectiveDomain === 'FLEET' && showFleetRegistrationModal && (
                                <FleetUnitRegistrationModal
                                    onSuccess={(res) => {
                                        setShowFleetRegistrationModal(false);
                                        setFleetRefreshSeq((s) => s + 1);
                                        onTelemetryEvent?.({
                                            type: 'EQUIPMENT_REGISTERED',
                                            tenantAssetId: res.tenantAssetId,
                                            assetId: res.globalAssetId,
                                            tenantId: ctx.tenantId,
                                            userId: ctx.actorId,
                                        });
                                        handleSelectFleetUnit({
                                            id: res.tenantAssetId,
                                            globalAssetId: res.globalAssetId,
                                        });
                                    }}
                                    onCancel={() => setShowFleetRegistrationModal(false)}
                                />
                            )}

                            {effectiveDomain === 'FLEET' &&
                                currentView === 'fleet_unit' &&
                                selectedFleetUnit && (
                                    <FleetUnitWorkspace
                                        tenantAssetId={selectedFleetUnit.id}
                                        globalAssetId={selectedFleetUnit.globalAssetId}
                                        onBack={() => {
                                            setSelectedFleetUnit(null);
                                            setCurrentView('list');
                                            setFleetRefreshSeq((s) => s + 1);
                                        }}
                                    />
                                )}
                        </Suspense>
                    </div>
                </main>

                <ToastContainer
                    position="bottom-right"
                    theme={ctx.isDark ? 'dark' : 'light'}
                    toastStyle={{ borderRadius: '0', boxShadow: 'none' }}
                />
            </div>
        </OpermaqContextProvider>
    );
}

export default App;
