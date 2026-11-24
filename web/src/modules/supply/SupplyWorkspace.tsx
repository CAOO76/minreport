import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './locales/registerSupplyLocales';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { syncQueueEngine } from '../../core/offline/SyncQueueEngine';
import M3LinearProgress from '../../components/common/M3LinearProgress';
import { cn } from '../../utils/cn';
import { supplyApi } from './services/supplyApi';
import { ConsolidatedShoppingListsView } from './components/ConsolidatedShoppingListsView';
import { RequisitionBacklogView } from './components/RequisitionBacklogView';
import { InventoryAndAssetsView } from './components/InventoryAndAssetsView';
import { SiiRendicionesView } from './components/SiiRendicionesView';
import { ReceiptScannerModal } from './components/ReceiptScannerModal';
import { ReconciliationHitlDrawer } from './components/ReconciliationHitlDrawer';
import { SupplyProfilesChannelsView } from './components/SupplyProfilesChannelsView';
import { SupplyConversationsAuditView } from './components/SupplyConversationsAuditView';
import { SupplyControlDashboardView } from './components/SupplyControlDashboardView';
import type { StockLedgerEntry } from '../../contracts/supply.contracts';
import {
    computeRcvDaysRemaining,
    type ConsolidatedShoppingBucketGroup,
    type DemandForecastSummary,
    type ProcurementBucket,
    type SiiDocumentRecord,
    type SiiExpenseReport,
    type SupplyAssetRecord,
    type SupplyBusinessUnitKpis,
    type SupplyConversationThread,
    type SupplyDomainMode,
    type SupplyInventoryItem,
    type SupplyProfileViewRecord,
    type SupplyPurchaseDraft,
    type SupplyPurchaseRecord,
    type SupplyRequisition,
    type SupplySite,
    type SupplyTankTelemetry,
    type SupplyWarehouse,
    type SupplyWarehouseBalance,
} from './types';

export interface SupplyWorkspaceProps {
    embedded?: boolean;
    domainMode?: SupplyDomainMode | string;
    hostScope?: 'CLIENT' | 'DEV_GATEWAY' | 'TEST_PILOT';
    tenantId?: string;
    userId?: string;
    resetKey?: number;
}

export type SupplyPrimaryTab =
    | 'CONTROL'
    | 'DEMAND'
    | 'PROCUREMENT'
    | 'WAREHOUSE'
    | 'CONVERSATIONS'
    | 'FINANCE_SII'
    | 'PROFILES_WS';

type TopSectionId = 'CONTROL' | 'ORDERS' | 'WAREHOUSE' | 'WHATSAPP' | 'FINANCE_SII';

function parseTabQueryParam(raw?: string | null): SupplyPrimaryTab | null {
    switch (String(raw || '').trim().toUpperCase()) {
        case 'CONTROL':
            return 'CONTROL';
        case 'DEMAND':
            return 'DEMAND';
        case 'PROCUREMENT':
        case 'ORDERS':
            return 'PROCUREMENT';
        case 'WAREHOUSE':
            return 'WAREHOUSE';
        case 'CONVERSATIONS':
        case 'WHATSAPP':
            return 'CONVERSATIONS';
        case 'FINANCE_SII':
        case 'SII_EXPENSES':
            return 'FINANCE_SII';
        case 'PROFILES_WS':
            return 'PROFILES_WS';
        default:
            return null;
    }
}

function resolveTabFromDomainMode(mode?: string): SupplyPrimaryTab {
    switch (String(mode || '').toUpperCase()) {
        case 'DEMAND':
            return 'DEMAND';
        case 'PROCUREMENT':
            return 'PROCUREMENT';
        case 'WAREHOUSE':
        case 'FORECAST':
            return 'WAREHOUSE';
        case 'CONVERSATIONS':
        case 'WHATSAPP_CHANNELS':
            return 'CONVERSATIONS';
        case 'SII_EXPENSES':
        case 'FINANCE_RECON':
            return 'FINANCE_SII';
        case 'PROFILES_WS':
            return 'PROFILES_WS';
        case 'CONTROL':
        default:
            return 'CONTROL';
    }
}

function resolveInitialSupplyTab(embedded: boolean, domainMode?: string): SupplyPrimaryTab {
    if (!embedded && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = parseTabQueryParam(params.get('tab'));
        if (fromUrl) return fromUrl;
    }
    return resolveTabFromDomainMode(domainMode);
}

function resolveTopSection(tab: SupplyPrimaryTab): TopSectionId {
    if (tab === 'PROCUREMENT' || tab === 'DEMAND') return 'ORDERS';
    if (tab === 'CONVERSATIONS' || tab === 'PROFILES_WS') return 'WHATSAPP';
    if (tab === 'WAREHOUSE') return 'WAREHOUSE';
    if (tab === 'FINANCE_SII') return 'FINANCE_SII';
    return 'CONTROL';
}

const SUPPLY_SYNC_EVENTS = [
    'supply:purchase-committed',
    'supply:purchase-synced',
    'supply:requisition-created',
    'supply:requisition-synced',
    'supply:reception-confirmed',
    'supply:reception-synced',
    'supply:sii-updated',
    'supply:sii-expense-report-synced',
    'supply:sii-expense-report-status-synced',
    'supply:opermaq-link-synced',
] as const;

export const SupplyWorkspace: React.FC<SupplyWorkspaceProps> = ({
    embedded = false,
    domainMode,
    hostScope = 'CLIENT',
    tenantId: propTenantId,
    resetKey,
}) => {
    const { t } = useTranslation();
    const { session } = useMinReportSession();
    const { isOnline } = useNetworkStatus();

    const resolvedTenantId = useMemo(() => {
        if (propTenantId && propTenantId.trim()) return propTenantId.trim();
        if (hostScope === 'DEV_GATEWAY') {
            return session?.isDevRoot && session.tenantId ? session.tenantId : 'dev-master-sandbox';
        }
        return session?.tenantId || undefined;
    }, [propTenantId, hostScope, session]);

    const supplyPermissions = session?.permissions?.supply;
    const sessionRoleUpper = String(session?.role || '').toUpperCase();
    const isReadOnlyRole = sessionRoleUpper === 'VIEWER' || sessionRoleUpper === 'BILLING_ONLY';

    const canMutateSupply = useMemo(() => {
        if (isReadOnlyRole) return false;
        if (supplyPermissions) return Boolean(supplyPermissions.canMutate);
        return Boolean(
            session?.isDevRoot ||
                session?.isSuperAdmin ||
                session?.isTestPilot ||
                sessionRoleUpper === 'OWNER' ||
                sessionRoleUpper === 'ADMIN' ||
                sessionRoleUpper === 'OPERATOR' ||
                sessionRoleUpper === 'BUYER'
        );
    }, [isReadOnlyRole, session, sessionRoleUpper, supplyPermissions]);

    const canRecordDirectPurchase = useMemo(() => {
        if (!canMutateSupply) return false;
        if (supplyPermissions) return Boolean(supplyPermissions.canRecordDirectPurchase);
        return Boolean(
            session?.isDevRoot ||
                session?.isSuperAdmin ||
                sessionRoleUpper === 'OWNER' ||
                sessionRoleUpper === 'ADMIN'
        );
    }, [canMutateSupply, session, sessionRoleUpper, supplyPermissions]);

    const canApproveExpenseReports = useMemo(() => {
        if (!canMutateSupply) return false;
        if (supplyPermissions) return Boolean(supplyPermissions.canApproveExpenseReports);
        return Boolean(
            session?.isDevRoot ||
                session?.isSuperAdmin ||
                sessionRoleUpper === 'OWNER' ||
                sessionRoleUpper === 'ADMIN'
        );
    }, [canMutateSupply, session, sessionRoleUpper, supplyPermissions]);

    const canManageCapex = useMemo(() => {
        if (!canMutateSupply) return false;
        if (supplyPermissions) return Boolean(supplyPermissions.canManageCapex);
        return Boolean(
            session?.isDevRoot ||
                session?.isSuperAdmin ||
                sessionRoleUpper === 'OWNER' ||
                sessionRoleUpper === 'ADMIN'
        );
    }, [canMutateSupply, session, sessionRoleUpper, supplyPermissions]);

    const canAdministerProfiles = useMemo(() => {
        if (!canMutateSupply) return false;
        return Boolean(
            session?.isDevRoot ||
                session?.isSuperAdmin ||
                sessionRoleUpper === 'OWNER' ||
                sessionRoleUpper === 'ADMIN' ||
                sessionRoleUpper === 'OWNER_EXEC' ||
                sessionRoleUpper === 'SITE_ADMIN'
        );
    }, [canMutateSupply, session, sessionRoleUpper]);

    const isMarketplaceBlocked = useMemo(
        () => Boolean(session?.isEduSandbox || session?.isTestPilot || hostScope === 'TEST_PILOT'),
        [hostScope, session]
    );

    const canScanAndBuy = canMutateSupply;
    const canAccessSimulator = useMemo(
        () =>
            Boolean(
                canMutateSupply &&
                    (session?.isDevRoot ||
                        session?.isTestPilot ||
                        hostScope === 'DEV_GATEWAY' ||
                        hostScope === 'TEST_PILOT')
            ),
        [canMutateSupply, session, hostScope]
    );

    const [activeTab, setActiveTab] = useState<SupplyPrimaryTab>(() =>
        resolveInitialSupplyTab(embedded, domainMode)
    );
    const [selectedSiteId, setSelectedSiteId] = useState<string>('');
    const [scannerOpen, setScannerOpen] = useState(false);
    const [scannerBucket, setScannerBucket] = useState<ProcurementBucket | null>(null);
    const [reconcilerOpen, setReconcilerOpen] = useState(
        String(domainMode || '').toUpperCase() === 'FINANCE_RECON'
    );
    const [simulatorOpen, setSimulatorOpen] = useState(
        String(domainMode || '').toUpperCase() === 'WHATSAPP_CHANNELS'
    );
    const [pendingDraft, setPendingDraft] = useState<SupplyPurchaseDraft | null>(null);
    const [offlinePendingCount, setOfflinePendingCount] = useState<number>(
        syncQueueEngine.getState().pendingCount
    );
    const [deadLetterCount, setDeadLetterCount] = useState<number>(0);

    const [loading, setLoading] = useState(false);
    const [sites, setSites] = useState<SupplySite[]>([]);
    const [consolidatedLists, setConsolidatedLists] = useState<ConsolidatedShoppingBucketGroup[]>([]);
    const [requisitions, setRequisitions] = useState<SupplyRequisition[]>([]);
    const [purchases, setPurchases] = useState<SupplyPurchaseRecord[]>([]);
    const [inventory, setInventory] = useState<SupplyInventoryItem[]>([]);
    const [assets, setAssets] = useState<SupplyAssetRecord[]>([]);
    const [forecast, setForecast] = useState<DemandForecastSummary | null>(null);
    const [siiDocuments, setSiiDocuments] = useState<SiiDocumentRecord[]>([]);
    const [expenseReports, setExpenseReports] = useState<SiiExpenseReport[]>([]);
    const [wsProfiles, setWsProfiles] = useState<SupplyProfileViewRecord[]>([]);
    const [conversationThreads, setConversationThreads] = useState<SupplyConversationThread[]>([]);
    const [warehouses, setWarehouses] = useState<SupplyWarehouse[]>([]);
    const [warehouseBalances, setWarehouseBalances] = useState<SupplyWarehouseBalance[]>([]);
    const [kardexEntries, setKardexEntries] = useState<StockLedgerEntry[]>([]);
    const [tankTelemetry, setTankTelemetry] = useState<SupplyTankTelemetry[]>([]);
    const [businessUnitKpis, setBusinessUnitKpis] = useState<SupplyBusinessUnitKpis | null>(null);

    useEffect(() => {
        if (domainMode) setActiveTab(resolveTabFromDomainMode(domainMode));
        else if (resetKey !== undefined) setActiveTab(resolveInitialSupplyTab(embedded, domainMode));
        if (String(domainMode || '').toUpperCase() === 'FINANCE_RECON') setReconcilerOpen(true);
        if (String(domainMode || '').toUpperCase() === 'WHATSAPP_CHANNELS' && canAccessSimulator) {
            setSimulatorOpen(true);
        }
    }, [domainMode, resetKey, canAccessSimulator, embedded]);

    useEffect(() => {
        if (embedded || typeof window === 'undefined') return;
        try {
            const url = new URL(window.location.href);
            if (url.searchParams.get('tab') !== activeTab) {
                url.searchParams.set('tab', activeTab);
                window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
            }
        } catch {
            // Entorno sin history/URL editable
        }
    }, [activeTab, embedded]);

    useEffect(() => {
        if (embedded || typeof window === 'undefined') return;
        const handlePopState = () => {
            const fromUrl = parseTabQueryParam(new URLSearchParams(window.location.search).get('tab'));
            if (fromUrl) setActiveTab(fromUrl);
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [embedded]);

    useEffect(() => {
        const handleNavigateHome = () => {
            setScannerOpen(false);
            setReconcilerOpen(false);
            setSimulatorOpen(false);
            setActiveTab(resolveTabFromDomainMode(domainMode));
        };
        window.addEventListener('supply:navigate-home', handleNavigateHome);
        return () => window.removeEventListener('supply:navigate-home', handleNavigateHome);
    }, [domainMode]);

    const refreshDeadLetterCount = useCallback(async () => {
        try {
            const dlq = await syncQueueEngine.getDeadLetterTasks(resolvedTenantId);
            setDeadLetterCount(dlq.length);
        } catch {
            // Mantener contador previo si IndexedDB no está disponible
        }
    }, [resolvedTenantId]);

    useEffect(() => {
        void refreshDeadLetterCount();
        return syncQueueEngine.subscribe((state) => setOfflinePendingCount(state.pendingCount));
    }, [refreshDeadLetterCount]);

    const loadTabData = useCallback(
        async (targetTab: SupplyPrimaryTab) => {
            setLoading(true);
            const siteFilter = selectedSiteId || undefined;
            const safeSites = supplyApi.listSites(resolvedTenantId).then((res) => {
                setSites(res);
                return res;
            });

            if (targetTab === 'CONTROL') {
                const [, reqRes, purRes, docRes, assetRes, fcRes, whRes, kpiRes] =
                    await Promise.allSettled([
                        safeSites,
                        supplyApi.listRequisitions({ siteId: siteFilter }, resolvedTenantId),
                        supplyApi.listPurchases({ siteId: siteFilter }, resolvedTenantId),
                        supplyApi.listSiiDocuments({ siteId: siteFilter }, resolvedTenantId),
                        supplyApi.listAssets({ siteId: siteFilter }, resolvedTenantId),
                        supplyApi.getForecast({ siteId: siteFilter }, resolvedTenantId),
                        supplyApi.listSupplyWarehouses({ siteId: siteFilter }, resolvedTenantId),
                        supplyApi.getSupplyBusinessUnitKpis({ siteId: siteFilter }, resolvedTenantId),
                    ]);
                if (reqRes.status === 'fulfilled') setRequisitions(reqRes.value);
                if (purRes.status === 'fulfilled') setPurchases(purRes.value);
                if (docRes.status === 'fulfilled') setSiiDocuments(docRes.value);
                if (assetRes.status === 'fulfilled') setAssets(assetRes.value);
                if (fcRes.status === 'fulfilled') setForecast(fcRes.value);
                if (whRes.status === 'fulfilled') {
                    setWarehouses(whRes.value.warehouses);
                    setWarehouseBalances(whRes.value.balances);
                }
                if (kpiRes.status === 'fulfilled') setBusinessUnitKpis(kpiRes.value);
            } else if (targetTab === 'DEMAND' || targetTab === 'PROCUREMENT') {
                const [, listRes, reqRes] = await Promise.allSettled([
                    safeSites,
                    supplyApi.getConsolidatedShoppingLists({ siteId: siteFilter }, resolvedTenantId),
                    supplyApi.listRequisitions({ siteId: siteFilter }, resolvedTenantId),
                ]);
                if (listRes.status === 'fulfilled') setConsolidatedLists(listRes.value);
                if (reqRes.status === 'fulfilled') setRequisitions(reqRes.value);
            } else if (targetTab === 'WAREHOUSE') {
                const [, invRes, assetRes, purRes, fcRes, whRes, kardexRes] =
                    await Promise.allSettled([
                        safeSites,
                        supplyApi.listInventory({ siteId: siteFilter }, resolvedTenantId),
                        supplyApi.listAssets({ siteId: siteFilter }, resolvedTenantId),
                        supplyApi.listPurchases({ siteId: siteFilter }, resolvedTenantId),
                        supplyApi.getForecast({ siteId: siteFilter }, resolvedTenantId),
                        supplyApi.listSupplyWarehouses({ siteId: siteFilter }, resolvedTenantId),
                        supplyApi.listSupplyKardex({ siteId: siteFilter }, resolvedTenantId),
                    ]);
                if (invRes.status === 'fulfilled') setInventory(invRes.value);
                if (assetRes.status === 'fulfilled') setAssets(assetRes.value);
                if (purRes.status === 'fulfilled') setPurchases(purRes.value);
                if (fcRes.status === 'fulfilled') setForecast(fcRes.value);
                if (whRes.status === 'fulfilled') {
                    setWarehouses(whRes.value.warehouses);
                    setWarehouseBalances(whRes.value.balances);
                }
                if (kardexRes.status === 'fulfilled') {
                    setKardexEntries(kardexRes.value.entries);
                    setTankTelemetry(kardexRes.value.tankTelemetry);
                }
            } else if (targetTab === 'FINANCE_SII') {
                const [, docRes, repRes] = await Promise.allSettled([
                    safeSites,
                    supplyApi.listSiiDocuments({ siteId: siteFilter }, resolvedTenantId),
                    supplyApi.listSiiExpenseReports({ siteId: siteFilter }, resolvedTenantId),
                ]);
                if (docRes.status === 'fulfilled') setSiiDocuments(docRes.value);
                if (repRes.status === 'fulfilled') setExpenseReports(repRes.value);
            } else if (targetTab === 'CONVERSATIONS') {
                const [, threadsRes] = await Promise.allSettled([
                    safeSites,
                    supplyApi.listSupplyConversationThreads({}, resolvedTenantId),
                ]);
                if (threadsRes.status === 'fulfilled') setConversationThreads(threadsRes.value);
            } else if (targetTab === 'PROFILES_WS') {
                const [, profRes, whRes] = await Promise.allSettled([
                    safeSites,
                    supplyApi.listSupplyProfiles({}, resolvedTenantId),
                    supplyApi.listSupplyWarehouses({ siteId: siteFilter }, resolvedTenantId),
                ]);
                if (profRes.status === 'fulfilled') setWsProfiles(profRes.value);
                if (whRes.status === 'fulfilled') {
                    setWarehouses(whRes.value.warehouses);
                    setWarehouseBalances(whRes.value.balances);
                }
            } else {
                await Promise.allSettled([safeSites]);
            }
            setLoading(false);
        },
        [resolvedTenantId, selectedSiteId]
    );

    useEffect(() => {
        void loadTabData(activeTab);
    }, [activeTab, loadTabData]);

    useEffect(() => {
        if (activeTab === 'CONVERSATIONS' && simulatorOpen && wsProfiles.length === 0) {
            void supplyApi
                .listSupplyProfiles({}, resolvedTenantId)
                .then(setWsProfiles)
                .catch(() => {});
        }
    }, [activeTab, simulatorOpen, wsProfiles.length, resolvedTenantId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onSynced = () => {
            void loadTabData(activeTab);
            void refreshDeadLetterCount();
        };
        const onDeadLetter = () => {
            setDeadLetterCount((prev) => prev + 1);
            void refreshDeadLetterCount();
        };
        for (const evName of SUPPLY_SYNC_EVENTS) window.addEventListener(evName, onSynced);
        window.addEventListener('minreport:sync-dead-letter', onDeadLetter);
        return () => {
            for (const evName of SUPPLY_SYNC_EVENTS) window.removeEventListener(evName, onSynced);
            window.removeEventListener('minreport:sync-dead-letter', onDeadLetter);
        };
    }, [activeTab, loadTabData, refreshDeadLetterCount]);

    const activeSite = useMemo(
        () => sites.find((s) => s.siteId === selectedSiteId) || sites[0] || null,
        [sites, selectedSiteId]
    );
    const openRequisitions = useMemo(
        () => requisitions.filter((r) => r.status === 'OPEN' || r.status === 'PARTIAL'),
        [requisitions]
    );
    const inTransitPurchases = useMemo(
        () =>
            purchases.filter(
                (p) =>
                    p.receptionStatus === 'IN_TRANSIT' ||
                    p.receptionStatus === 'PARTIAL' ||
                    p.receptionStatus === 'PARTIALLY_RECEIVED' ||
                    (!p.receptionStatus &&
                        (p.lines || []).some((l) => l.destination === 'STOCK_IN_TRANSIT'))
            ),
        [purchases]
    );

    const telemetry = useMemo(() => {
        const pendingLines = openRequisitions.reduce(
            (sum, r) => sum + (r.lines || []).filter((l) => l.qtyPending > 0).length,
            0
        );
        const stockoutRisk = inventory.filter(
            (it) => it.qtyInWarehouse <= it.minSafetyQty || (it.doiDays !== null && it.doiDays <= 3)
        ).length;
        const atypicalCount = openRequisitions.reduce(
            (sum, r) =>
                sum + (r.lines || []).reduce((ls, l) => ls + (l.atypicalFlags?.length ? 1 : 0), 0),
            0
        );
        const rcvUrgent = siiDocuments.filter((d) => {
            if (d.documentType !== 33 && d.documentType !== 34) return false;
            if (
                d.rcvStatus === 'ACCEPTED' ||
                d.rcvStatus === 'AUTO_ACCEPTED_8D' ||
                d.rcvStatus === 'NOT_APPLICABLE'
            ) {
                return false;
            }
            const days = d.rcvDaysRemaining ?? computeRcvDaysRemaining(d.issueDate);
            return days !== null && days <= 2;
        }).length;
        const assetsWithoutInvoice = assets.filter(
            (a) => a.missingInvoiceAlert || (a.invoiceDteType !== 33 && a.invoiceDteType !== 34)
        ).length;
        const sec160Alerts = inventory.filter(
            (it) =>
                (it.categoryCode === 'COMBUSTIBLE_CAMPAMENTO' ||
                    it.categoryCode === 'COMBUSTIBLE_FLOTA_PROD') &&
                it.qtyInWarehouse <= it.minSafetyQty
        ).length;
        const wsAlerts =
            atypicalCount +
            wsProfiles.filter((p) => p.optInStatus === 'PENDING_DOUBLE_OPT_IN').length;
        const ds594Gap = forecast && !forecast.waterCompliantDs594 ? 1 : 0;
        const totalAlerts =
            stockoutRisk +
            sec160Alerts +
            rcvUrgent +
            ds594Gap +
            (businessUnitKpis && businessUnitKpis.fleetAndWorkshop.tankCycleCountVariancePctMax > 2.5
                ? 1
                : 0);

        return {
            pendingLines,
            stockoutRisk,
            atypicalCount,
            inTransitCount: inTransitPurchases.length,
            rcvUrgent,
            assetsWithoutInvoice,
            sec160Alerts,
            wsAlerts,
            totalAlerts,
        };
    }, [
        openRequisitions,
        inventory,
        siiDocuments,
        assets,
        inTransitPurchases,
        wsProfiles,
        forecast,
        businessUnitKpis,
    ]);

    const topSection = resolveTopSection(activeTab);

    const TOP_SECTIONS: Array<{
        id: TopSectionId;
        targetTab: SupplyPrimaryTab;
        testId: string;
        icon: string;
        label: string;
    }> = [
        {
            id: 'CONTROL',
            targetTab: 'CONTROL',
            testId: 'supply-tab-CONTROL',
            icon: 'monitoring',
            label: t('supply.nav.control'),
        },
        {
            id: 'ORDERS',
            targetTab: 'PROCUREMENT',
            testId: 'supply-tab-ORDERS',
            icon: 'shopping_cart',
            label: t('supply.nav.orders'),
        },
        {
            id: 'WAREHOUSE',
            targetTab: 'WAREHOUSE',
            testId: 'supply-tab-WAREHOUSE',
            icon: 'warehouse',
            label: t('supply.nav.warehouse'),
        },
        {
            id: 'WHATSAPP',
            targetTab: 'CONVERSATIONS',
            testId: 'supply-tab-WHATSAPP',
            icon: 'forum',
            label: t('supply.nav.whatsapp'),
        },
        {
            id: 'FINANCE_SII',
            targetTab: 'FINANCE_SII',
            testId: 'supply-tab-FINANCE_SII',
            icon: 'receipt_long',
            label: t('supply.nav.sii'),
        },
    ];

    const containerClass = embedded
        ? 'w-full h-full min-h-0 flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans rounded-none shadow-none overflow-hidden select-none'
        : 'w-full min-h-[100dvh] flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans rounded-none shadow-none overflow-hidden select-none';

    return (
        <div
            className={containerClass}
            data-marketplace-opt-in={isMarketplaceBlocked ? 'blocked' : 'allowed'}
        >
            {/* Cabecera Limpia Zero-Layer (5 Secciones Claras + Alerta por Excepción) */}
            <header className="min-h-[60px] shrink-0 px-fib-21 bg-[#FFFFFF] dark:bg-[#000000] border-b border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap items-center justify-between gap-fib-13">
                <nav
                    aria-label={t('supply.module_title')}
                    className="flex items-center gap-fib-13 sm:gap-fib-21 min-w-0 overflow-x-auto"
                >
                    {TOP_SECTIONS.map((sec) => {
                        const isActive = topSection === sec.id;
                        return (
                            <button
                                key={sec.id}
                                type="button"
                                onClick={() => setActiveTab(sec.targetTab)}
                                aria-current={isActive ? 'page' : undefined}
                                data-testid={sec.testId}
                                className={cn(
                                    'bg-transparent border-0 border-b-2 outline-none px-fib-8 py-fib-8 min-h-[52px] inline-flex items-center gap-fib-8 text-[15px] font-medium transition-colors cursor-pointer rounded-none shadow-none shrink-0',
                                    isActive
                                        ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-semibold'
                                        : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                )}
                            >
                                <span
                                    className={cn(
                                        'material-symbols-outlined text-[22px]',
                                        isActive ? 'text-[#C68346]' : ''
                                    )}
                                >
                                    {sec.icon}
                                </span>
                                <span>{sec.label}</span>
                            </button>
                        );
                    })}
                </nav>

                {/* Derecha limpia: Alertas solo si existen (Dark Cockpit), Faena, Acción principal */}
                <div className="flex flex-wrap items-center gap-fib-13 shrink-0">
                    {telemetry.totalAlerts > 0 && (
                        <button
                            type="button"
                            onClick={() => setActiveTab('CONTROL')}
                            data-testid="supply-alerts-badge"
                            className="bg-transparent border-0 border-l-[3px] border-l-[#C68346] pl-fib-13 min-h-[48px] inline-flex items-center gap-fib-8 text-[14px] font-semibold text-[#7C3F0E] dark:text-[#C68346] cursor-pointer rounded-none shadow-none tabular-nums"
                        >
                            <span className="material-symbols-outlined text-[18px]">warning</span>
                            <span>
                                {telemetry.totalAlerts} {t('supply.common.alerts_pending')}
                            </span>
                        </button>
                    )}

                    {(!isOnline || offlinePendingCount > 0 || deadLetterCount > 0) && (
                        <div
                            data-testid="supply-offline-status"
                            className="flex items-center gap-fib-8 px-fib-8 border-l-[3px] border-l-[#C68346] text-[14px] tabular-nums font-semibold text-[#7C3F0E] dark:text-[#C68346]"
                        >
                            <span className="material-symbols-outlined text-[18px]">
                                {deadLetterCount > 0 ? 'warning' : 'cloud_off'}
                            </span>
                            <span>
                                {t('supply.telemetry.offline_queue')}: {offlinePendingCount}
                            </span>
                            {deadLetterCount > 0 && (
                                <span data-testid="supply-dlq-count">
                                    · {t('supply.telemetry.dead_letter')}: {deadLetterCount}
                                </span>
                            )}
                        </div>
                    )}

                    {!canMutateSupply && (
                        <span
                            data-testid="supply-readonly-indicator"
                            className="text-[14px] font-medium text-[#475569] dark:text-[#8A93A6] border-l border-[#E2E8F0] dark:border-[#12151C] pl-fib-13"
                        >
                            {t('supply.common.read_only_mode')}
                        </span>
                    )}

                    {isMarketplaceBlocked && (
                        <span
                            data-testid="supply-sandbox-marketplace-guard"
                            title={t('supply.common.sandbox_marketplace_blocked')}
                            className="hidden md:inline-flex items-center gap-fib-8 text-[14px] text-[#475569] dark:text-[#8A93A6]"
                        >
                            <span className="material-symbols-outlined text-[18px]">lock</span>
                        </span>
                    )}

                    {sites.length > 0 && (
                        <select
                            id="supply-active-site-select"
                            value={selectedSiteId}
                            onChange={(e) => setSelectedSiteId(e.target.value)}
                            aria-label={t('supply.common.site_selector')}
                            className="min-h-[48px] max-w-[190px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none shrink-0"
                        >
                            <option value="">{t('supply.common.all_sites')}</option>
                            {sites.map((s) => (
                                <option key={s.siteId} value={s.siteId}>
                                    {s.name}
                                </option>
                            ))}
                        </select>
                    )}

                    {canScanAndBuy && (
                        <button
                            type="button"
                            onClick={() => {
                                setScannerBucket(null);
                                setScannerOpen(true);
                            }}
                            data-testid="supply-open-scanner-btn"
                            className="min-h-[48px] px-fib-13 bg-[#C68346] border border-[#C68346] text-[#000000] text-[15px] font-semibold inline-flex items-center gap-fib-8 hover:opacity-90 transition-opacity cursor-pointer rounded-none shadow-none"
                        >
                            <span className="material-symbols-outlined text-[20px]">add_a_photo</span>
                            <span>{t('supply.nav.scanner')}</span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => setReconcilerOpen((prev) => !prev)}
                        aria-label={t('supply.nav.reconciler')}
                        title={t('supply.nav.reconciler')}
                        className={cn(
                            'bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center transition-colors cursor-pointer rounded-none shadow-none',
                            reconcilerOpen
                                ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                : pendingDraft
                                  ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                  : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        )}
                    >
                        <span className="material-symbols-outlined text-[22px]">compare_arrows</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => void loadTabData(activeTab)}
                        disabled={loading}
                        aria-label={t('supply.common.refresh')}
                        title={t('supply.common.refresh')}
                        className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none disabled:opacity-40"
                    >
                        <span className="material-symbols-outlined text-[22px]">refresh</span>
                    </button>
                </div>
            </header>

            {/* Subbarra contextual limpia solo para Pedidos o WhatsApp */}
            {topSection === 'ORDERS' && (
                <div className="px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center gap-fib-21">
                    <button
                        type="button"
                        onClick={() => setActiveTab('PROCUREMENT')}
                        data-testid="supply-subtab-PROCUREMENT"
                        className={cn(
                            'bg-transparent border-0 border-b-2 min-h-[48px] px-fib-8 text-[15px] font-medium cursor-pointer rounded-none shadow-none',
                            activeTab === 'PROCUREMENT'
                                ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-semibold'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        )}
                    >
                        {t('supply.nav.procurement')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('DEMAND')}
                        data-testid="supply-subtab-DEMAND"
                        className={cn(
                            'bg-transparent border-0 border-b-2 min-h-[48px] px-fib-8 text-[15px] font-medium cursor-pointer rounded-none shadow-none',
                            activeTab === 'DEMAND'
                                ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-semibold'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        )}
                    >
                        {t('supply.nav.demand')}
                    </button>
                </div>
            )}

            {topSection === 'WHATSAPP' && (
                <div className="px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-13">
                    <div className="flex items-center gap-fib-21">
                        <button
                            type="button"
                            onClick={() => setActiveTab('CONVERSATIONS')}
                            data-testid="supply-subtab-CONVERSATIONS"
                            className={cn(
                                'bg-transparent border-0 border-b-2 min-h-[48px] px-fib-8 text-[15px] font-medium cursor-pointer rounded-none shadow-none',
                                activeTab === 'CONVERSATIONS'
                                    ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-semibold'
                                    : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            )}
                        >
                            {t('supply.nav.conversations')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('PROFILES_WS')}
                            data-testid="supply-subtab-PROFILES_WS"
                            className={cn(
                                'bg-transparent border-0 border-b-2 min-h-[48px] px-fib-8 text-[15px] font-medium cursor-pointer rounded-none shadow-none',
                                activeTab === 'PROFILES_WS'
                                    ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-semibold'
                                    : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            )}
                        >
                            {t('supply.nav.profiles_ws')}
                        </button>
                    </div>

                    {canAccessSimulator && activeTab === 'CONVERSATIONS' && (
                        <button
                            type="button"
                            onClick={() => setSimulatorOpen((prev) => !prev)}
                            data-testid="toggle-ws-simulator-btn"
                            className={cn(
                                'bg-transparent border-0 min-h-[48px] px-fib-13 inline-flex items-center gap-fib-8 text-[15px] font-medium cursor-pointer rounded-none shadow-none',
                                simulatorOpen
                                    ? 'text-[#0369A1] dark:text-[#00AEEF] font-semibold'
                                    : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            )}
                        >
                            <span className="material-symbols-outlined text-[20px]">chat</span>
                            <span>{t('supply.nav.wa_simulator')}</span>
                        </button>
                    )}
                </div>
            )}

            {loading && <M3LinearProgress indeterminate ariaLabel={t('supply.common.loading')} />}

            {/* Escenario Principal 61.8% / 38.2% */}
            <div
                className={cn(
                    'flex-1 min-h-0 w-full overflow-hidden',
                    reconcilerOpen
                        ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,61.8fr)_minmax(0,38.2fr)]'
                        : 'flex flex-col'
                )}
            >
                <main className="min-h-0 flex-1 overflow-y-auto bg-[#FFFFFF] dark:bg-[#000000]">
                    {activeTab === 'CONTROL' && (
                        <SupplyControlDashboardView
                            kpis={businessUnitKpis}
                            warehouses={warehouses}
                            balances={warehouseBalances}
                            forecast={forecast}
                            activeSite={activeSite}
                            loading={loading}
                            openRequisitionsCount={openRequisitions.length}
                            inTransitCount={telemetry.inTransitCount}
                            rcvUrgentCount={telemetry.rcvUrgent}
                            assets={assets}
                            sitesCount={sites.length}
                            onNavigateTab={setActiveTab}
                        />
                    )}

                    {activeTab === 'PROCUREMENT' && (
                        <ConsolidatedShoppingListsView
                            groups={consolidatedLists}
                            loading={loading}
                            canScanReceipt={canScanAndBuy}
                            onOpenScannerForBucket={(bucket) => {
                                setScannerBucket(bucket);
                                setScannerOpen(true);
                            }}
                        />
                    )}

                    {activeTab === 'DEMAND' && (
                        <RequisitionBacklogView
                            requisitions={requisitions}
                            sites={sites}
                            defaultSiteId={selectedSiteId || sites[0]?.siteId}
                            tenantId={resolvedTenantId}
                            loading={loading}
                            canMutate={canMutateSupply}
                            canAccessSimulator={canAccessSimulator}
                            onOpenConversationsTab={() => {
                                setActiveTab('CONVERSATIONS');
                                setSimulatorOpen(true);
                            }}
                            onRequisitionCreated={() => void loadTabData('DEMAND')}
                        />
                    )}

                    {activeTab === 'WAREHOUSE' && (
                        <InventoryAndAssetsView
                            inventory={inventory}
                            assets={assets}
                            inTransitPurchases={inTransitPurchases}
                            forecast={forecast}
                            warehouses={warehouses}
                            warehouseBalances={warehouseBalances}
                            kardexEntries={kardexEntries}
                            tankTelemetry={tankTelemetry}
                            sites={sites}
                            activeSite={activeSite}
                            tenantId={resolvedTenantId}
                            loading={loading}
                            canMutate={canMutateSupply}
                            canManageCapex={canManageCapex}
                            onMutated={() => void loadTabData('WAREHOUSE')}
                        />
                    )}

                    {activeTab === 'CONVERSATIONS' && (
                        <SupplyConversationsAuditView
                            threads={conversationThreads}
                            profiles={wsProfiles}
                            sites={sites}
                            defaultSiteId={selectedSiteId || sites[0]?.siteId}
                            tenantId={resolvedTenantId}
                            loading={loading}
                            canAccessSimulator={canAccessSimulator}
                            simulatorOpen={simulatorOpen}
                            onToggleSimulator={setSimulatorOpen}
                            onRefreshThreads={() => void loadTabData('CONVERSATIONS')}
                            onRequisitionCreated={() => void loadTabData('CONVERSATIONS')}
                            onNavigateLinked={(target) => {
                                if (typeof window !== 'undefined') {
                                    window.dispatchEvent(
                                        new CustomEvent('supply:navigate-entity', {
                                            detail: target,
                                        })
                                    );
                                }
                                if (target.type === 'REQ') setActiveTab('DEMAND');
                                else if (target.type === 'PUR') setActiveTab('WAREHOUSE');
                                else if (target.type === 'DTE') setActiveTab('FINANCE_SII');
                            }}
                        />
                    )}

                    {activeTab === 'FINANCE_SII' && (
                        <SiiRendicionesView
                            documents={siiDocuments}
                            expenseReports={expenseReports}
                            activeSiteId={selectedSiteId || undefined}
                            tenantId={resolvedTenantId}
                            loading={loading}
                            canMutate={canMutateSupply}
                            canApproveExpenseReports={canApproveExpenseReports}
                            onMutated={() => void loadTabData('FINANCE_SII')}
                        />
                    )}

                    {activeTab === 'PROFILES_WS' && (
                        <SupplyProfilesChannelsView
                            profiles={wsProfiles}
                            sites={sites}
                            warehouses={warehouses}
                            tenantId={resolvedTenantId}
                            loading={loading}
                            canAdminister={canAdministerProfiles}
                            onMutated={() => void loadTabData('PROFILES_WS')}
                        />
                    )}
                </main>

                {reconcilerOpen && (
                    <div className="min-h-0 h-full overflow-hidden border-t lg:border-t-0 border-[#E2E8F0] dark:border-[#12151C]">
                        <ReconciliationHitlDrawer
                            open={reconcilerOpen}
                            draft={pendingDraft}
                            openRequisitions={openRequisitions}
                            tenantId={resolvedTenantId}
                            canMutate={canMutateSupply}
                            onClose={() => setReconcilerOpen(false)}
                            onClearDraft={() => setPendingDraft(null)}
                            onCommitted={() => {
                                setPendingDraft(null);
                                void loadTabData(activeTab);
                            }}
                        />
                    </div>
                )}
            </div>

            {canScanAndBuy && (
                <ReceiptScannerModal
                    open={scannerOpen}
                    tenantId={resolvedTenantId}
                    sites={sites}
                    defaultSiteId={selectedSiteId || sites[0]?.siteId}
                    defaultBucket={scannerBucket}
                    isExecOwner={canRecordDirectPurchase}
                    isOnline={isOnline}
                    onClose={() => setScannerOpen(false)}
                    onSendToReconciler={(draft) => {
                        setPendingDraft(draft);
                        setReconcilerOpen(true);
                    }}
                    onCommitted={() => {
                        void loadTabData(activeTab);
                    }}
                />
            )}
        </div>
    );
};

export default SupplyWorkspace;
