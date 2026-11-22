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
import {
    computeRcvDaysRemaining,
    type ConsolidatedShoppingBucketGroup,
    type DemandForecastSummary,
    type ProcurementBucket,
    type SiiDocumentRecord,
    type SiiExpenseReport,
    type SupplyAssetRecord,
    type SupplyDomainMode,
    type SupplyInventoryItem,
    type SupplyPurchaseDraft,
    type SupplyPurchaseRecord,
    type SupplyRequisition,
    type SupplySite,
} from './types';

export interface SupplyWorkspaceProps {
    embedded?: boolean;
    domainMode?: SupplyDomainMode | string;
    hostScope?: 'CLIENT' | 'DEV_GATEWAY' | 'TEST_PILOT';
    tenantId?: string;
    userId?: string;
    resetKey?: number;
}

type SupplyPrimaryTab = 'PROCUREMENT' | 'DEMAND' | 'WAREHOUSE' | 'SII_EXPENSES';

function parseTabQueryParam(raw?: string | null): SupplyPrimaryTab | null {
    switch (String(raw || '').trim().toUpperCase()) {
        case 'PROCUREMENT':
            return 'PROCUREMENT';
        case 'DEMAND':
            return 'DEMAND';
        case 'WAREHOUSE':
            return 'WAREHOUSE';
        case 'SII_EXPENSES':
            return 'SII_EXPENSES';
        default:
            return null;
    }
}

function resolveTabFromDomainMode(mode?: string): SupplyPrimaryTab {
    switch (String(mode || '').toUpperCase()) {
        case 'DEMAND':
        case 'WHATSAPP_CHANNELS':
            return 'DEMAND';
        case 'WAREHOUSE':
        case 'FORECAST':
            return 'WAREHOUSE';
        case 'SII_EXPENSES':
        case 'FINANCE_RECON':
            return 'SII_EXPENSES';
        case 'PROCUREMENT':
        default:
            return 'PROCUREMENT';
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
            return session?.isDevRoot && session.tenantId
                ? session.tenantId
                : 'dev-master-sandbox';
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

    // Guard estricto: cuentas 5º EDU y 3º TEST-PILOT jamás pueden activar marketplaceOptIn
    const isMarketplaceBlocked = useMemo(
        () =>
            Boolean(
                session?.isEduSandbox ||
                    session?.isTestPilot ||
                    hostScope === 'TEST_PILOT'
            ),
        [hostScope, session]
    );

    const canScanAndBuy = canMutateSupply;

    // WhatsApp Campamento interactive simulator strictly gated to DEV & TEST-PILOT
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

    // Data state
    const [loading, setLoading] = useState(false);
    const [sites, setSites] = useState<SupplySite[]>([]);
    const [consolidatedLists, setConsolidatedLists] = useState<ConsolidatedShoppingBucketGroup[]>(
        []
    );
    const [requisitions, setRequisitions] = useState<SupplyRequisition[]>([]);
    const [purchases, setPurchases] = useState<SupplyPurchaseRecord[]>([]);
    const [inventory, setInventory] = useState<SupplyInventoryItem[]>([]);
    const [assets, setAssets] = useState<SupplyAssetRecord[]>([]);
    const [forecast, setForecast] = useState<DemandForecastSummary | null>(null);
    const [siiDocuments, setSiiDocuments] = useState<SiiDocumentRecord[]>([]);
    const [expenseReports, setExpenseReports] = useState<SiiExpenseReport[]>([]);

    useEffect(() => {
        if (domainMode) {
            setActiveTab(resolveTabFromDomainMode(domainMode));
        } else if (resetKey !== undefined) {
            setActiveTab(resolveInitialSupplyTab(embedded, domainMode));
        }
        if (String(domainMode || '').toUpperCase() === 'FINANCE_RECON') {
            setReconcilerOpen(true);
        }
        if (
            String(domainMode || '').toUpperCase() === 'WHATSAPP_CHANNELS' &&
            canAccessSimulator
        ) {
            setSimulatorOpen(true);
        }
    }, [domainMode, resetKey, canAccessSimulator, embedded]);

    // Sincronizar activeTab <-> query param ?tab= cuando !embedded
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
            const fromUrl = parseTabQueryParam(
                new URLSearchParams(window.location.search).get('tab')
            );
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
        return syncQueueEngine.subscribe((state) => {
            setOfflinePendingCount(state.pendingCount);
        });
    }, [refreshDeadLetterCount]);

    const loadAllData = useCallback(async () => {
        setLoading(true);
        const siteFilter = selectedSiteId || undefined;
        const [
            sitesRes,
            listsRes,
            reqsRes,
            purchasesRes,
            invRes,
            assetsRes,
            forecastRes,
            siiDocsRes,
            siiRepsRes,
        ] = await Promise.allSettled([
            supplyApi.listSites(resolvedTenantId),
            supplyApi.getConsolidatedShoppingLists({ siteId: siteFilter }, resolvedTenantId),
            supplyApi.listRequisitions({ siteId: siteFilter }, resolvedTenantId),
            supplyApi.listPurchases({ siteId: siteFilter }, resolvedTenantId),
            supplyApi.listInventory({ siteId: siteFilter }, resolvedTenantId),
            supplyApi.listAssets({ siteId: siteFilter }, resolvedTenantId),
            supplyApi.getForecast({ siteId: siteFilter }, resolvedTenantId),
            supplyApi.listSiiDocuments({ siteId: siteFilter }, resolvedTenantId),
            supplyApi.listSiiExpenseReports({ siteId: siteFilter }, resolvedTenantId),
        ]);

        if (sitesRes.status === 'fulfilled') setSites(sitesRes.value);
        if (listsRes.status === 'fulfilled') setConsolidatedLists(listsRes.value);
        if (reqsRes.status === 'fulfilled') setRequisitions(reqsRes.value);
        if (purchasesRes.status === 'fulfilled') setPurchases(purchasesRes.value);
        if (invRes.status === 'fulfilled') setInventory(invRes.value);
        if (assetsRes.status === 'fulfilled') setAssets(assetsRes.value);
        if (forecastRes.status === 'fulfilled') setForecast(forecastRes.value);
        if (siiDocsRes.status === 'fulfilled') setSiiDocuments(siiDocsRes.value);
        if (siiRepsRes.status === 'fulfilled') setExpenseReports(siiRepsRes.value);
        setLoading(false);
    }, [resolvedTenantId, selectedSiteId]);

    useEffect(() => {
        void loadAllData();
    }, [loadAllData]);

    // Suscripción reactiva a eventos de SyncQueueEngine (reconexión offline + dead-letter)
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onSynced = () => {
            void loadAllData();
            void refreshDeadLetterCount();
        };
        const onDeadLetter = () => {
            setDeadLetterCount((prev) => prev + 1);
            void refreshDeadLetterCount();
        };
        for (const evName of SUPPLY_SYNC_EVENTS) {
            window.addEventListener(evName, onSynced);
        }
        window.addEventListener('minreport:sync-dead-letter', onDeadLetter);
        return () => {
            for (const evName of SUPPLY_SYNC_EVENTS) {
                window.removeEventListener(evName, onSynced);
            }
            window.removeEventListener('minreport:sync-dead-letter', onDeadLetter);
        };
    }, [loadAllData, refreshDeadLetterCount]);

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

    // NASA OpenMCT Monochrome Telemetry Strip Counters (ISA-101 Color by Exception)
    const telemetry = useMemo(() => {
        const pendingLines = openRequisitions.reduce(
            (sum, r) => sum + (r.lines || []).filter((l) => l.qtyPending > 0).length,
            0
        );
        const atypicalCount = openRequisitions.reduce(
            (sum, r) =>
                sum +
                (r.lines || []).reduce((ls, l) => ls + (l.atypicalFlags?.length ? 1 : 0), 0),
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

        return {
            pendingLines,
            atypicalCount,
            inTransitCount: inTransitPurchases.length,
            rcvUrgent,
            assetsWithoutInvoice,
        };
    }, [openRequisitions, inTransitPurchases, siiDocuments, assets]);

    const containerClass = embedded
        ? 'w-full h-full min-h-0 flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans rounded-none shadow-none overflow-hidden select-none'
        : 'w-full min-h-[100dvh] flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans rounded-none shadow-none overflow-hidden select-none';

    return (
        <div
            className={containerClass}
            data-marketplace-opt-in={isMarketplaceBlocked ? 'blocked' : 'allowed'}
        >
            {/* Single 56px Contextual Header (MBUX Zero-Layer — Zero Stacked Headers) */}
            <header className="min-h-[56px] shrink-0 px-fib-13 sm:px-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap items-center justify-between gap-fib-8">
                {/* Left: Icon-First Mode Tabs + Always-Visible Site Selector (<1280px included) */}
                <nav
                    aria-label={t('supply.module_title')}
                    className="flex items-center gap-fib-8 min-w-0"
                >
                    {(
                        [
                            {
                                id: 'PROCUREMENT' as const,
                                icon: 'checklist',
                                label: t('supply.nav.procurement'),
                            },
                            {
                                id: 'DEMAND' as const,
                                icon: 'assignment',
                                label: t('supply.nav.demand'),
                            },
                            {
                                id: 'WAREHOUSE' as const,
                                icon: 'warehouse',
                                label: t('supply.nav.warehouse'),
                            },
                            {
                                id: 'SII_EXPENSES' as const,
                                icon: 'receipt_long',
                                label: t('supply.nav.sii'),
                            },
                        ] as const
                    ).map((item) => {
                        const isActive = activeTab === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setActiveTab(item.id)}
                                aria-label={item.label}
                                title={item.label}
                                aria-current={isActive ? 'page' : undefined}
                                className={cn(
                                    'bg-transparent border-0 border-b-2 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center transition-colors cursor-pointer rounded-none shadow-none',
                                    isActive
                                        ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346]'
                                        : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                )}
                            >
                                <span className="material-symbols-outlined text-[22px]">
                                    {item.icon}
                                </span>
                            </button>
                        );
                    })}

                    {sites.length > 0 && (
                        <select
                            id="supply-active-site-select"
                            value={selectedSiteId}
                            onChange={(e) => setSelectedSiteId(e.target.value)}
                            aria-label={t('supply.common.site_selector')}
                            className="ml-fib-8 min-h-[48px] max-w-[160px] sm:max-w-[200px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-microcopy text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                        >
                            <option value="">{t('supply.common.all_sites')}</option>
                            {sites.map((s) => (
                                <option key={s.siteId} value={s.siteId}>
                                    {s.name}
                                </option>
                            ))}
                        </select>
                    )}
                </nav>

                {/* Center: NASA OpenMCT Monochrome Telemetry Strip (ISA-101 Color by Exception) */}
                <div className="hidden xl:flex items-center gap-fib-21 font-mono text-microcopy tabular-nums">
                    <div className="flex items-center gap-fib-8">
                        <span className="text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.telemetry.open_lines')}
                        </span>
                        <span className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                            {telemetry.pendingLines}
                        </span>
                    </div>
                    <div className="flex items-center gap-fib-8">
                        <span className="text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.telemetry.atypical_flags')}
                        </span>
                        <span
                            className={cn(
                                'text-data-dense font-bold',
                                telemetry.atypicalCount > 0
                                    ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                    : 'text-[#0F172A] dark:text-[#F3F4F6]'
                            )}
                        >
                            {telemetry.atypicalCount}
                        </span>
                    </div>
                    <div className="flex items-center gap-fib-8">
                        <span className="text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.telemetry.in_transit')}
                        </span>
                        <span
                            className={cn(
                                'text-data-dense font-bold',
                                telemetry.inTransitCount > 0
                                    ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                    : 'text-[#0F172A] dark:text-[#F3F4F6]'
                            )}
                        >
                            {telemetry.inTransitCount}
                        </span>
                    </div>
                    <div className="flex items-center gap-fib-8">
                        <span className="text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.telemetry.rcv_urgent')}
                        </span>
                        <span
                            className={cn(
                                'text-data-dense font-bold',
                                telemetry.rcvUrgent > 0
                                    ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                    : 'text-[#0F172A] dark:text-[#F3F4F6]'
                            )}
                        >
                            {telemetry.rcvUrgent}
                        </span>
                    </div>
                    <div className="flex items-center gap-fib-8">
                        <span className="text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.telemetry.assets_no_dte')}
                        </span>
                        <span
                            className={cn(
                                'text-data-dense font-bold',
                                telemetry.assetsWithoutInvoice > 0
                                    ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                    : 'text-[#0F172A] dark:text-[#F3F4F6]'
                            )}
                        >
                            {telemetry.assetsWithoutInvoice}
                        </span>
                    </div>
                </div>

                {/* Right: Always-Visible Offline/DLQ Indicator + Role Guard + Icon-First Contextual Actions */}
                <div className="flex items-center gap-fib-8 shrink-0">
                    {(!isOnline || offlinePendingCount > 0 || deadLetterCount > 0) && (
                        <div
                            data-testid="supply-offline-status"
                            className="flex items-center gap-fib-8 px-fib-8 border-l-[3px] border-l-[#C68346] font-mono text-microcopy tabular-nums font-bold text-[#7C3F0E] dark:text-[#C68346]"
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
                            className="font-mono text-microcopy uppercase font-bold text-[#475569] dark:text-[#8A93A6] border-l border-[#E2E8F0] dark:border-[#12151C] pl-fib-8"
                        >
                            {t('supply.common.read_only_mode')}
                        </span>
                    )}

                    {isMarketplaceBlocked && (
                        <span
                            data-testid="supply-sandbox-marketplace-guard"
                            title={t('supply.common.sandbox_marketplace_blocked')}
                            className="hidden md:inline-flex items-center gap-fib-8 font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] border-l border-[#E2E8F0] dark:border-[#12151C] pl-fib-8"
                        >
                            <span className="material-symbols-outlined text-[16px]">lock</span>
                        </span>
                    )}

                    {canScanAndBuy && (
                        <button
                            type="button"
                            onClick={() => {
                                setScannerBucket(null);
                                setScannerOpen(true);
                            }}
                            aria-label={t('supply.nav.scanner')}
                            title={t('supply.nav.scanner')}
                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#7C3F0E] dark:text-[#C68346] hover:opacity-80 transition-colors cursor-pointer rounded-none shadow-none"
                        >
                            <span className="material-symbols-outlined text-[24px]">
                                add_a_photo
                            </span>
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
                        <span className="material-symbols-outlined text-[22px]">
                            compare_arrows
                        </span>
                    </button>

                    {canAccessSimulator && (
                        <button
                            type="button"
                            onClick={() => {
                                setActiveTab('DEMAND');
                                setSimulatorOpen((prev) => !prev);
                            }}
                            aria-label={t('supply.nav.wa_simulator')}
                            title={t('supply.nav.wa_simulator')}
                            className={cn(
                                'bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center transition-colors cursor-pointer rounded-none shadow-none',
                                simulatorOpen
                                    ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                    : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            )}
                        >
                            <span className="material-symbols-outlined text-[22px]">chat</span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => void loadAllData()}
                        disabled={loading}
                        aria-label={t('supply.common.refresh')}
                        title={t('supply.common.refresh')}
                        className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none disabled:opacity-40"
                    >
                        <span className="material-symbols-outlined text-[22px]">refresh</span>
                    </button>
                </div>
            </header>

            {loading && <M3LinearProgress indeterminate ariaLabel={t('supply.common.loading')} />}

            {/* Golden Ratio 61.8% / 38.2% Main Stage */}
            <div
                className={cn(
                    'flex-1 min-h-0 w-full overflow-hidden',
                    reconcilerOpen
                        ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,61.8fr)_minmax(0,38.2fr)]'
                        : 'flex flex-col'
                )}
            >
                <main className="min-h-0 flex-1 overflow-y-auto bg-[#FFFFFF] dark:bg-[#000000]">
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
                            simulatorOpen={simulatorOpen}
                            onToggleSimulator={setSimulatorOpen}
                            onRequisitionCreated={() => void loadAllData()}
                        />
                    )}

                    {activeTab === 'WAREHOUSE' && (
                        <InventoryAndAssetsView
                            inventory={inventory}
                            assets={assets}
                            inTransitPurchases={inTransitPurchases}
                            forecast={forecast}
                            activeSite={activeSite}
                            tenantId={resolvedTenantId}
                            loading={loading}
                            canMutate={canMutateSupply}
                            canManageCapex={canManageCapex}
                            onMutated={() => void loadAllData()}
                        />
                    )}

                    {activeTab === 'SII_EXPENSES' && (
                        <SiiRendicionesView
                            documents={siiDocuments}
                            expenseReports={expenseReports}
                            activeSiteId={selectedSiteId || undefined}
                            tenantId={resolvedTenantId}
                            loading={loading}
                            canMutate={canMutateSupply}
                            canApproveExpenseReports={canApproveExpenseReports}
                            onMutated={() => void loadAllData()}
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
                                void loadAllData();
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
                        void loadAllData();
                    }}
                />
            )}
        </div>
    );
};

export default SupplyWorkspace;
