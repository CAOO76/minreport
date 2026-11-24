import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n';
import type { MinReportSession } from '../../../context/MinReportSessionContext';
import type { SiiDocumentRecord, SupplyPurchaseDraft, SupplySite } from '../types';

const sessionMockState = vi.hoisted(() => ({
    session: null as MinReportSession | null,
    isOnline: true,
    pendingCount: 0,
    deadLetterTasks: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../context/MinReportSessionContext', () => ({
    useMinReportSession: () => ({
        session: sessionMockState.session,
        isLoaded: true,
        hasModuleAccess: () => true,
    }),
}));

vi.mock('../../../hooks/useNetworkStatus', () => ({
    useNetworkStatus: () => ({
        isOnline: sessionMockState.isOnline,
    }),
}));

vi.mock('../../../core/offline/SyncQueueEngine', () => ({
    syncQueueEngine: {
        getState: () => ({
            isOnline: sessionMockState.isOnline,
            isSyncing: false,
            pendingCount: sessionMockState.pendingCount,
            lastSyncTimestamp: null,
            lastError: null,
        }),
        subscribe: (cb: (state: any) => void) => {
            cb({
                isOnline: sessionMockState.isOnline,
                isSyncing: false,
                pendingCount: sessionMockState.pendingCount,
                lastSyncTimestamp: null,
                lastError: null,
            });
            return () => {};
        },
        getDeadLetterTasks: vi.fn(async () => sessionMockState.deadLetterTasks),
        isOnlineNow: () => sessionMockState.isOnline,
    },
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false },
}));

vi.mock('@capacitor/camera', () => ({
    Camera: { getPhoto: vi.fn() },
    CameraResultType: { DataUrl: 'dataUrl' },
    CameraSource: { Camera: 'CAMERA' },
}));

import { SupplyWorkspace } from '../SupplyWorkspace';
import { SiiRendicionesView } from '../components/SiiRendicionesView';
import { ReconciliationHitlDrawer } from '../components/ReconciliationHitlDrawer';
import { supplyApi } from '../services/supplyApi';

const MOCK_SITES: SupplySite[] = [
    {
        siteId: 'site-atacama-01',
        tenantId: 'tenant-ui-e14',
        name: 'Faena Atacama Sur',
        currentHeadcount: 45,
        waterStorageCapacityL: 45000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 7,
    },
    {
        siteId: 'site-antofa-02',
        tenantId: 'tenant-ui-e14',
        name: 'Faena Antofagasta Norte',
        currentHeadcount: 30,
        waterStorageCapacityL: 30000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 7,
    },
];

function makeSession(overrides: Partial<MinReportSession> = {}): MinReportSession {
    return {
        uid: 'uid-ui-e14',
        email: 'owner@minreport-test.cl',
        displayName: 'Owner Test',
        tenantId: 'tenant-ui-e14',
        tenantName: 'Minera E14 SpA',
        countryCode: 'CL',
        role: 'OWNER',
        classification: 'b2b',
        accountTier: 4,
        isDevRoot: false,
        isSuperAdmin: false,
        isTestPilot: false,
        isEduSandbox: false,
        activeModules: { opermaq: true, stockpile: true, supply: true },
        permissions: {
            opermaq: {
                canInspect: true,
                canManageFleet: true,
                canViewVaults: true,
                canCurateAI: false,
            },
            stockpile: {
                canScan: true,
                canCalculate: true,
                canExportReport: true,
                canTrainVisionAI: false,
            },
            supply: {
                canView: true,
                canMutate: true,
                canRecordDirectPurchase: true,
                canApproveExpenseReports: true,
                canManageCapex: true,
            },
            pilot: {
                canCommentAndRequestChanges: false,
                canSimulateProjects: false,
                canTrainInternalAI: false,
            },
        },
        ...overrides,
    };
}

function stubSupplyApiReads(holdLoading = false) {
    if (holdLoading) {
        const neverResolve = new Promise<any>(() => {});
        vi.spyOn(supplyApi, 'listSites').mockReturnValue(neverResolve);
        vi.spyOn(supplyApi, 'getConsolidatedShoppingLists').mockReturnValue(neverResolve);
        vi.spyOn(supplyApi, 'listRequisitions').mockReturnValue(neverResolve);
        vi.spyOn(supplyApi, 'listPurchases').mockReturnValue(neverResolve);
        vi.spyOn(supplyApi, 'listInventory').mockReturnValue(neverResolve);
        vi.spyOn(supplyApi, 'listAssets').mockReturnValue(neverResolve);
        vi.spyOn(supplyApi, 'getForecast').mockReturnValue(neverResolve);
        vi.spyOn(supplyApi, 'listSiiDocuments').mockReturnValue(neverResolve);
        vi.spyOn(supplyApi, 'listSiiExpenseReports').mockReturnValue(neverResolve);
        return;
    }

    vi.spyOn(supplyApi, 'listSites').mockResolvedValue(MOCK_SITES);
    vi.spyOn(supplyApi, 'getConsolidatedShoppingLists').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listRequisitions').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listPurchases').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listInventory').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listAssets').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'getForecast').mockResolvedValue(null);
    vi.spyOn(supplyApi, 'listSiiDocuments').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listSiiExpenseReports').mockResolvedValue([]);
}

describe('E14 UI Certification — SupplyWorkspace, SiiRendicionesView & ReconciliationHitlDrawer', () => {
    beforeEach(async () => {
        vi.restoreAllMocks();
        sessionMockState.session = makeSession();
        sessionMockState.isOnline = true;
        sessionMockState.pendingCount = 0;
        sessionMockState.deadLetterTasks = [];
        await i18n.changeLanguage('es');
    });

    it('1. Renderiza SupplyWorkspace en es/en/pt sin llaves crudas, con selector de faena, indicador offline/DLQ y exactamente 1 M3LinearProgress de carga', async () => {
        // 1a. Verificar exactamente 1 M3LinearProgress durante estado loading
        stubSupplyApiReads(true);
        const { unmount } = render(
            <I18nextProvider i18n={i18n}>
                <SupplyWorkspace embedded={true} tenantId="tenant-ui-e14" />
            </I18nextProvider>
        );
        const loadingBars = screen.getAllByRole('progressbar');
        expect(loadingBars).toHaveLength(1);
        unmount();

        // 1b. Render en es, en, pt con cola offline + dead-letter
        sessionMockState.isOnline = false;
        sessionMockState.pendingCount = 2;
        sessionMockState.deadLetterTasks = [{ id: 'dlq-1', status: 'DEAD_LETTER' }];

        for (const lang of ['es', 'en', 'pt'] as const) {
            vi.restoreAllMocks();
            stubSupplyApiReads(false);
            await act(async () => {
                await i18n.changeLanguage(lang);
            });

            const { container, unmount: unmountLang } = render(
                <I18nextProvider i18n={i18n}>
                    <SupplyWorkspace embedded={true} tenantId="tenant-ui-e14" />
                </I18nextProvider>
            );

            await waitFor(() => {
                expect(container.querySelector('#supply-active-site-select')).toBeInTheDocument();
            });

            expect(screen.getByTestId('supply-offline-status')).toBeInTheDocument();
            expect(screen.getByTestId('supply-dlq-count')).toBeInTheDocument();

            // Cero llaves crudas `supply.*` y cero texto decorativo "(38.2%)"
            expect(container.textContent || '').not.toMatch(/\bsupply\.[a-z_]+\.[a-z_]+/);
            expect(container.textContent || '').not.toContain('(38.2%)');

            unmountLang();
        }
    });

    it('2. VIEWER/BILLING_ONLY bloquea mutaciones; EDU y TEST-PILOT marcan data-marketplace-opt-in="blocked"', async () => {
        // VIEWER read-only
        sessionMockState.session = makeSession({
            role: 'VIEWER',
            permissions: {
                ...makeSession().permissions,
                supply: {
                    canView: true,
                    canMutate: false,
                    canRecordDirectPurchase: false,
                    canApproveExpenseReports: false,
                    canManageCapex: false,
                },
            },
        });
        stubSupplyApiReads(false);

        const { container: viewerContainer, unmount: unmountViewer } = render(
            <I18nextProvider i18n={i18n}>
                <SupplyWorkspace embedded={true} tenantId="tenant-ui-e14" />
            </I18nextProvider>
        );
        await waitFor(() => {
            expect(screen.getByTestId('supply-readonly-indicator')).toBeInTheDocument();
        });
        expect(screen.queryByRole('button', { name: /Escanear boleta/i })).not.toBeInTheDocument();
        expect(viewerContainer.querySelector('[data-marketplace-opt-in="allowed"]')).toBeInTheDocument();
        unmountViewer();

        // EDU sandbox -> marketplaceOptIn bloqueado
        vi.restoreAllMocks();
        sessionMockState.session = makeSession({
            classification: 'edu',
            accountTier: 5,
            isEduSandbox: true,
            role: 'PROFESSOR',
        });
        stubSupplyApiReads(false);
        const { container: eduContainer, unmount: unmountEdu } = render(
            <I18nextProvider i18n={i18n}>
                <SupplyWorkspace embedded={true} tenantId="tenant-edu-01" />
            </I18nextProvider>
        );
        await waitFor(() => {
            expect(eduContainer.querySelector('[data-marketplace-opt-in="blocked"]')).toBeInTheDocument();
        });
        unmountEdu();

        // TEST-PILOT sandbox -> marketplaceOptIn bloqueado
        vi.restoreAllMocks();
        sessionMockState.session = makeSession({
            classification: 'test-pilot',
            accountTier: 3,
            isTestPilot: true,
            role: 'TEST_PILOT',
        });
        stubSupplyApiReads(false);
        const { container: pilotContainer } = render(
            <I18nextProvider i18n={i18n}>
                <SupplyWorkspace embedded={true} hostScope="TEST_PILOT" tenantId="pilot-u1" />
            </I18nextProvider>
        );
        await waitFor(() => {
            expect(pilotContainer.querySelector('[data-marketplace-opt-in="blocked"]')).toBeInTheDocument();
        });
    });

    it('3. SiiRendicionesView cumple ISA-101 Dark Cockpit (nominal transparente, aceptado cian, duplicado/urgente cobre) y expone CopyButton', () => {
        const docs: SiiDocumentRecord[] = [
            {
                docId: 'doc-nominal',
                tenantId: 'tenant-ui-e14',
                dedupeKey: '76123456-0_33_1001',
                supplierTaxId: '76.123.456-0',
                supplierName: 'Proveedor Nominal SpA',
                documentType: 33,
                folio: '1001',
                issueDate: '2026-11-22',
                netAmountClp: 100000,
                vatAmountClp: 19000,
                totalAmountClp: 119000,
                paymentMethod: 'TRANSFERENCIA',
                rcvDaysRemaining: 6,
                rcvStatus: 'PENDING_REVIEW',
                isDuplicate: false,
                createdAt: '2026-11-22T00:00:00Z',
            },
            {
                docId: 'doc-accepted',
                tenantId: 'tenant-ui-e14',
                dedupeKey: '76123456-0_33_1002',
                supplierTaxId: '76.123.456-0',
                supplierName: 'Proveedor Aceptado SpA',
                documentType: 33,
                folio: '1002',
                issueDate: '2026-11-20',
                netAmountClp: 50000,
                vatAmountClp: 9500,
                totalAmountClp: 59500,
                paymentMethod: 'TRANSFERENCIA',
                rcvDaysRemaining: 4,
                rcvStatus: 'ACCEPTED',
                isDuplicate: false,
                createdAt: '2026-11-20T00:00:00Z',
            },
            {
                docId: 'doc-dup-urgent',
                tenantId: 'tenant-ui-e14',
                dedupeKey: '76123456-0_33_1003',
                supplierTaxId: '76.123.456-0',
                supplierName: 'Proveedor Duplicado SpA',
                documentType: 33,
                folio: '1003',
                issueDate: '2026-11-15',
                netAmountClp: 200000,
                vatAmountClp: 38000,
                totalAmountClp: 238000,
                paymentMethod: 'TRANSFERENCIA',
                rcvDaysRemaining: 1,
                rcvStatus: 'PENDING_REVIEW',
                isDuplicate: true,
                createdAt: '2026-11-15T00:00:00Z',
            },
        ];

        const { container } = render(
            <I18nextProvider i18n={i18n}>
                <SiiRendicionesView
                    documents={docs}
                    expenseReports={[]}
                    tenantId="tenant-ui-e14"
                    loading={false}
                    canMutate={true}
                    onMutated={vi.fn()}
                />
            </I18nextProvider>
        );

        // Cambiar a tab FACTURAS (DTE 33)
        fireEvent.click(screen.getByRole('button', { name: /Facturas y plazo SII/i }));

        const articles = Array.from(container.querySelectorAll('article'));
        expect(articles).toHaveLength(3);

        // Nominal pendiente -> border-l-transparent (NO cian por tautología!)
        expect(articles[0].className).toContain('border-l-transparent');
        expect(articles[0].className).not.toContain('border-l-[#00AEEF]');

        // Aceptado -> border-l-[#00AEEF]
        expect(articles[1].className).toContain('border-l-[#00AEEF]');

        // Duplicado / RCV urgente -> border-l-[#C68346]
        expect(articles[2].className).toContain('border-l-[#C68346]');

        // CopyButtons presentes junto a códigos operativos
        const copyButtons = container.querySelectorAll('button[aria-label*="Copiar"], button[title*="Copiar"]');
        expect(copyButtons.length).toBeGreaterThanOrEqual(6);
    });

    it('4. Contraste WCAG 2.2 AAA en ReconciliationHitlDrawer: text-[#000000] sobre bg-[#C68346], 0 text-white y 0 texto "(38.2%)"', () => {
        const draft: SupplyPurchaseDraft = {
            siteId: 'site-atacama-01',
            purchaseMode: 'DIRECT_AUTONOMOUS',
            supplierTaxId: '76.123.456-0',
            supplierName: 'Ferretería Cordillera SpA',
            documentType: 33,
            folio: '4490',
            issueDate: '2026-11-22',
            netAmountClp: 100000,
            vatAmountClp: 19000,
            totalAmountClp: 119000,
            paymentMethod: 'TRANSFERENCIA',
            lines: [
                {
                    lineId: 'pl-1',
                    rawDescription: 'Casco Seguridad MSA',
                    categoryCode: 'EPP_SEGURIDAD',
                    qty: 5,
                    unitSi: 'un',
                    unitPriceClp: 23800,
                    subtotalClp: 119000,
                    destination: 'STOCK_IN_WAREHOUSE',
                },
            ],
        };

        const { container } = render(
            <I18nextProvider i18n={i18n}>
                <ReconciliationHitlDrawer
                    open={true}
                    draft={draft}
                    openRequisitions={[]}
                    tenantId="tenant-ui-e14"
                    canMutate={true}
                    onClose={vi.fn()}
                    onClearDraft={vi.fn()}
                    onCommitted={vi.fn()}
                />
            </I18nextProvider>
        );

        expect(container.textContent || '').not.toContain('(38.2%)');

        const keywordInput = screen.getByPlaceholderText('ACTUALIZAR');
        fireEvent.change(keywordInput, { target: { value: 'ACTUALIZAR' } });

        const commitBtn = screen.getByRole('button', { name: /Confirmar y guardar compra/i });
        expect(commitBtn).not.toBeDisabled();
        expect(commitBtn.className).toContain('bg-[#C68346]');
        expect(commitBtn.className).toContain('text-[#000000]');
        expect(commitBtn.className).not.toContain('text-white');
        expect(commitBtn.className).not.toContain('text-[#FFFFFF]');
    });
});
