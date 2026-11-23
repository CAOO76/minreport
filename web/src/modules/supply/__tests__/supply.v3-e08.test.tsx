import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n';
import type { MinReportSession } from '../../../context/MinReportSessionContext';
import type { StockLedgerEntry } from '../../../contracts/supply.contracts';
import type {
    ConsolidatedShoppingBucketGroup,
    SupplyBusinessUnitKpis,
    SupplyPurchaseRecord,
    SupplySite,
    SupplyTankTelemetry,
    SupplyWarehouse,
    SupplyWarehouseBalance,
} from '../types';

const sessionMockState = vi.hoisted(() => ({
    session: null as MinReportSession | null,
}));

vi.mock('../../../context/MinReportSessionContext', () => ({
    useMinReportSession: () => ({
        session: sessionMockState.session,
        isLoaded: true,
        hasModuleAccess: () => true,
    }),
}));

vi.mock('../../../hooks/useNetworkStatus', () => ({
    useNetworkStatus: () => ({ isOnline: true }),
}));

vi.mock('../../../core/offline/SyncQueueEngine', () => ({
    syncQueueEngine: {
        getState: () => ({
            isOnline: true,
            isSyncing: false,
            pendingCount: 0,
            lastSyncTimestamp: null,
            lastError: null,
        }),
        subscribe: () => () => {},
        getDeadLetterTasks: vi.fn(async () => []),
        isOnlineNow: () => true,
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
import { ConsolidatedShoppingListsView } from '../components/ConsolidatedShoppingListsView';
import { supplyApi } from '../services/supplyApi';

const SITES: SupplySite[] = [
    {
        siteId: 'site-atacama-01',
        tenantId: 'tenant-v3-e08',
        name: 'Faena Atacama Norte',
        currentHeadcount: 42,
        waterStorageCapacityL: 40000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 7,
    },
];

const WAREHOUSES: SupplyWarehouse[] = [
    {
        warehouseId: 'wh-potable-01',
        tenantId: 'tenant-v3-e08',
        siteId: 'site-atacama-01',
        code: 'TK-AGUA-01',
        name: 'Estanque Agua Potable Campamento',
        warehouseClass: 'POTABLE_WATER_TANK',
        allowedChannelIds: ['CH_CAMP_POTABLE_WATER'],
        defaultCostCenter: 'CC-CAMP-AGUA',
        capacityUnitSi: 'L',
        maxCapacitySi: 50000,
        status: 'ACTIVE',
    },
    {
        warehouseId: 'wh-diesel-flota',
        tenantId: 'tenant-v3-e08',
        siteId: 'site-atacama-01',
        code: 'TK-FLOTA-01',
        name: 'Estanque Diésel Flota',
        warehouseClass: 'FUEL_TANK_FLEET',
        allowedChannelIds: ['CH_OPS_FLEET_FUEL'],
        defaultCostCenter: 'CC-FLOTA-COMBUSTIBLE',
        capacityUnitSi: 'L',
        maxCapacitySi: 30000,
        secTc4Code: 'SEC-TC4-882',
        status: 'ACTIVE',
    },
];

const BALANCES: SupplyWarehouseBalance[] = [
    {
        balanceId: 'bal-1',
        tenantId: 'tenant-v3-e08',
        siteId: 'site-atacama-01',
        warehouseId: 'wh-potable-01',
        warehouseClass: 'POTABLE_WATER_TANK',
        canonicalSkuId: 'SKU-CAMP-AGUA-POTABLE',
        itemName: 'Agua Potable Bebestible',
        categoryCode: 'AGUA_POTABLE_BEBESTIBLE',
        procurementBucket: 'AGUA_POTABLE',
        unitSi: 'L',
        qtyOnHand: 36000,
        qtyInTransit: 0,
        pmpNetClp: 12,
        totalValueNetClp: 432000,
        lotNumber: 'LOT-2026-11',
        expiryDateIso: '2027-01-15T00:00:00Z',
        updatedAt: '2026-11-23T10:00:00Z',
    },
    {
        balanceId: 'bal-2',
        tenantId: 'tenant-v3-e08',
        siteId: 'site-atacama-01',
        warehouseId: 'wh-diesel-flota',
        warehouseClass: 'FUEL_TANK_FLEET',
        canonicalSkuId: 'SKU-FLOTA-DIESEL',
        itemName: 'Diésel Flota B2',
        categoryCode: 'COMBUSTIBLE_FLOTA_PROD',
        procurementBucket: 'COMBUSTIBLE_GRANEL',
        unitSi: 'L',
        qtyOnHand: 18500,
        qtyInTransit: 0,
        pmpNetClp: 980,
        totalValueNetClp: 18130000,
        updatedAt: '2026-11-23T10:00:00Z',
    },
];

const KARDEX_ENTRIES: StockLedgerEntry[] = [
    {
        ledgerId: 'kdx-001',
        tenantId: 'tenant-v3-e08',
        siteId: 'site-atacama-01',
        warehouseId: 'wh-diesel-flota',
        canonicalSkuId: 'SKU-FLOTA-DIESEL',
        itemName: 'Diésel Flota B2',
        categoryCode: 'COMBUSTIBLE_FLOTA_PROD',
        unitSi: 'L',
        movementType: 'ISSUE_CONSUMPTION',
        deltaInTransit: 0,
        deltaInWarehouse: -320,
        balanceInTransitAfter: 0,
        balanceInWarehouseAfter: 18500,
        unitCostNetClp: 980,
        costCenter: 'CC-FLOTA-COMBUSTIBLE',
        linkedAssetId: 'CAT-777G-04',
        horometer: 14250,
        actorUid: 'uid-owner',
        createdAt: '2026-11-23T09:30:00Z',
    },
];

const TANK_TELEMETRY: SupplyTankTelemetry[] = [
    {
        telemetryId: 'tk-tel-1',
        tenantId: 'tenant-v3-e08',
        siteId: 'site-atacama-01',
        warehouseId: 'wh-diesel-flota',
        warehouseClass: 'FUEL_TANK_FLEET',
        canonicalSkuId: 'SKU-FLOTA-DIESEL',
        measuredAtIso: '2026-11-23T08:00:00Z',
        measuredLevelSi: 17900,
        capacitySi: 30000,
        occupancyPct: 59.7,
        bookBalanceSi: 18500,
        varianceSi: -600,
        variancePct: 3.24,
        anomalyFlag: true,
        measuredByUid: 'uid-owner',
    },
];

const MOCK_KPIS: SupplyBusinessUnitKpis = {
    tenantId: 'tenant-v3-e08',
    siteId: 'site-atacama-01',
    generatedAtIso: '2026-11-23T12:00:00Z',
    periodDays: 30,
    camp: {
        headcountBasis: 42,
        foodOpex30dClp: 6300000,
        foodOpexPerPaxDayClp: 5000,
        potableWaterWarehouseL: 36000,
        potableWaterLPerPaxDay: 120,
        ds594CompliancePct: 100,
        glpKgPerPaxDay: 0.45,
        campDieselLPerDay: 85,
    },
    fleetAndWorkshop: {
        fleetFuelDispensed30dL: 12400,
        fleetAvgLitersPerHour: 24.5,
        activeMachineryCount: 6,
        tankCycleCountVariancePctMax: 3.24,
        tankAnomalyCount: 1,
        cylinderFullCount: 14,
        cylinderEmptyCount: 4,
        cylinderStayDaysAvg: 6.2,
    },
    mineAndPlant: {
        industrialWaterStockM3: 180,
        industrialWaterM3PerTon: 0.42,
        operationalSupplyCostPerTonClp: 1850,
        activeSkusCount: 28,
        stockoutCount: 0,
        avgInventoryTurnover: 4.2,
        otifPct: 94.5,
    },
    financeSii: {
        totalNetPurchasesClp: 45000000,
        totalVatRecoverableClp: 8550000,
        vatRecoveryRatePct: 98.4,
        rcvUrgentUnder48hCount: 1,
        openDiscrepanciesCount: 0,
        capexInOpexCount: 0,
        capexLeakagePct: 0,
    },
    ropSummary: {
        totalEvaluatedSkus: 28,
        criticalReorderCount: 0,
        byDriver: {
            PER_PAX: 10,
            PER_ASSET_HOUR: 12,
            DAILY_SITE_OR_MINMAX: 6,
        },
    },
};

const IN_TRANSIT_PURCHASE: SupplyPurchaseRecord = {
    purchaseId: 'pur-in-transit-01',
    tenantId: 'tenant-v3-e08',
    siteId: 'site-atacama-01',
    buyerUid: 'uid-owner',
    buyerRole: 'OWNER_EXEC',
    purchaseMode: 'REQUISITION_FULFILLMENT',
    supplierTaxId: '76.123.456-0',
    supplierName: 'Distribuidora Cordillera SpA',
    documentType: 33,
    folio: '8821',
    issueDate: '2026-11-22',
    netAmountClp: 500000,
    vatAmountClp: 95000,
    totalAmountClp: 595000,
    paymentMethod: 'TRANSFERENCIA',
    receptionStatus: 'IN_TRANSIT',
    lines: [
        {
            lineId: 'pl-1',
            purchaseLineId: 'pl-1',
            canonicalSkuId: 'SKU-VIV-ARROZ',
            rawDescription: 'Arroz Grado 2 Saco 25kg',
            categoryCode: 'VIVERES_ALIMENTACION',
            procurementBucket: 'SUPERMERCADO',
            qty: 20,
            qtyPurchased: 20,
            qtyReceived: 0,
            unitSi: 'kg',
            unitPriceClp: 1500,
            subtotalClp: 30000,
            destination: 'STOCK_IN_TRANSIT',
        },
    ],
    createdAt: '2026-11-22T12:00:00Z',
};

function makeOwnerSession(): MinReportSession {
    return {
        uid: 'uid-owner',
        email: 'owner@minreport-test.cl',
        displayName: 'Owner Test',
        tenantId: 'tenant-v3-e08',
        tenantName: 'Minera V3 SpA',
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
            opermaq: { canInspect: true, canManageFleet: true, canViewVaults: true, canCurateAI: false },
            stockpile: { canScan: true, canCalculate: true, canExportReport: true, canTrainVisionAI: false },
            supply: {
                canView: true,
                canMutate: true,
                canRecordDirectPurchase: true,
                canApproveExpenseReports: true,
                canManageCapex: true,
            },
            pilot: { canCommentAndRequestChanges: false, canSimulateProjects: false, canTrainInternalAI: false },
        },
    };
}

function stubV3E08Reads() {
    vi.spyOn(supplyApi, 'listSites').mockResolvedValue(SITES);
    vi.spyOn(supplyApi, 'listRequisitions').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listPurchases').mockResolvedValue([IN_TRANSIT_PURCHASE]);
    vi.spyOn(supplyApi, 'listSiiDocuments').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listAssets').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'getForecast').mockResolvedValue(null);
    vi.spyOn(supplyApi, 'listInventory').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listSupplyWarehouses').mockResolvedValue({
        warehouses: WAREHOUSES,
        balances: BALANCES,
    });
    vi.spyOn(supplyApi, 'getSupplyBusinessUnitKpis').mockResolvedValue(MOCK_KPIS);
    vi.spyOn(supplyApi, 'listSupplyKardex').mockResolvedValue({
        entries: KARDEX_ENTRIES,
        balances: BALANCES,
        tankTelemetry: TANK_TELEMETRY,
    });
}

describe('V3-E08 — Control Dashboard, Physical Warehouses/Tanks, Kardex, 4-Way Reception & Separated Buckets', () => {
    beforeEach(async () => {
        vi.restoreAllMocks();
        sessionMockState.session = makeOwnerSession();
        await act(async () => {
            await i18n.changeLanguage('es');
        });
    });

    it('1. SupplyControlDashboardView muestra Φ 61.8/38.2, 5 estanques/recursos separados, KPIs reales por unidad y excepciones ISA-101', async () => {
        stubV3E08Reads();

        render(
            <I18nextProvider i18n={i18n}>
                <SupplyWorkspace embedded={true} tenantId="tenant-v3-e08" />
            </I18nextProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('control-resource-POTABLE_WATER')).toBeInTheDocument();
        });

        const summary = screen.getByTestId('supply-control-summary');
        expect(summary.className).toContain('61.8fr');
        expect(summary.className).toContain('38.2fr');

        expect(screen.getByTestId('control-resource-IND_WATER')).toBeInTheDocument();
        expect(screen.getByTestId('control-resource-CAMP_FUEL')).toBeInTheDocument();
        expect(screen.getByTestId('control-resource-FLEET_FUEL')).toBeInTheDocument();
        expect(screen.getByTestId('control-resource-GAS_CYLINDERS')).toBeInTheDocument();

        expect(screen.getByTestId('control-bu-kpis')).toHaveTextContent('24.5 L/hr');
        expect(screen.getByTestId('control-bu-kpis')).toHaveTextContent('94.5%');
        expect(screen.getByTestId('control-exc-EXC_TANK_VAR')).toBeInTheDocument();
        expect(screen.getByTestId('control-exc-EXC_RCV_48H')).toBeInTheDocument();
    });

    it('2. WAREHOUSE soporta balances PMP/FEFO, Kardex con horómetro/aforo HITL ACTUALIZAR y recepción parcial 4-Way con discrepancias RCV 8d', async () => {
        stubV3E08Reads();
        const kardexSpy = vi
            .spyOn(supplyApi, 'recordSupplyKardexMovement')
            .mockResolvedValue({ success: true });
        const receptionSpy = vi
            .spyOn(supplyApi, 'confirmWarehouseReceptionV3')
            .mockResolvedValue({
                receptionOutcome: 'PARTIAL_OR_DISCREPANCY',
                receivedItemCount: 1,
                affectedRequisitionIds: [],
                discrepancies: [],
                urgentRcvAlert: true,
                suggestCreditNote61: true,
            });

        render(
            <I18nextProvider i18n={i18n}>
                <SupplyWorkspace embedded={true} domainMode="WAREHOUSE" tenantId="tenant-v3-e08" />
            </I18nextProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('warehouse-balance-bal-1')).toBeInTheDocument();
        });
        expect(screen.getByTestId('warehouse-balance-bal-1')).toHaveTextContent('FEFO LOT-2026-11');

        // Abrir modal de recepción 4-Way parcial sobre pur-in-transit-01
        fireEvent.click(screen.getByRole('button', { name: /Confirmar recepción física en faena/i }));
        await waitFor(() => {
            expect(screen.getByTestId('warehouse-reception-modal')).toBeInTheDocument();
        });
        fireEvent.change(screen.getByTestId('reception-qty-pl-1'), { target: { value: '15' } });
        fireEvent.change(screen.getByTestId('reception-shrinkage-pl-1'), { target: { value: '2' } });
        expect(screen.getByTestId('reception-discrepancy-preview')).toBeInTheDocument();

        fireEvent.change(screen.getByTestId('reception-hitl-keyword'), {
            target: { value: 'ACTUALIZAR' },
        });
        fireEvent.click(screen.getByTestId('reception-submit-btn'));

        await waitFor(() => {
            expect(receptionSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    purchaseId: 'pur-in-transit-01',
                    confirmationKeyword: 'ACTUALIZAR',
                    receivedLines: [
                        expect.objectContaining({
                            purchaseLineId: 'pl-1',
                            qtyReceivedNow: 15,
                            shrinkageQty: 2,
                        }),
                    ],
                }),
                'tenant-v3-e08'
            );
        });

        // Cambiar a KARDEX y verificar entrada OPERMAQ + aforo varilla HITL ACTUALIZAR
        fireEvent.click(screen.getByTestId('warehouse-subtab-KARDEX'));
        await waitFor(() => {
            expect(screen.getByTestId('kardex-row-kdx-001')).toHaveTextContent('CAT-777G-04 (14250 hr)');
        });

        fireEvent.click(screen.getByTestId('kardex-cycle-count-btn'));
        fireEvent.click(screen.getByTestId('kardex-submit-btn'));
        fireEvent.change(screen.getByPlaceholderText('ACTUALIZAR'), {
            target: { value: 'ACTUALIZAR' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^CONFIRMAR$/i }));

        await waitFor(() => {
            expect(kardexSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    confirmationKeyword: 'ACTUALIZAR',
                }),
                'tenant-v3-e08'
            );
        });
    });

    it('3. ConsolidatedShoppingListsView separa los 15 buckets v3.0 (agua potable vs industrial, GLP vs gases ind., DGMN vs ferretería) con paridad es/en/pt', async () => {
        const groups: ConsolidatedShoppingBucketGroup[] = [
            {
                procurementBucket: 'AGUA_POTABLE',
                totalLines: 1,
                atypicalCount: 0,
                estimatedClp: 50000,
                items: [
                    {
                        canonicalSkuId: 'SKU-CAMP-AGUA-POTABLE',
                        name: 'Agua Potable',
                        categoryCode: 'AGUA_POTABLE_BEBESTIBLE',
                        procurementBucket: 'AGUA_POTABLE',
                        unitSi: 'L',
                        totalQtyPending: 1000,
                        priority: 'CRITICAL',
                        atypicalCount: 0,
                        atypicalFlags: [],
                        sourceReqRefs: [],
                    },
                ],
            },
            {
                procurementBucket: 'AGUA_INDUSTRIAL_ALJIBE',
                totalLines: 1,
                atypicalCount: 0,
                estimatedClp: 120000,
                items: [
                    {
                        canonicalSkuId: 'SKU-OPS-AGUA-IND',
                        name: 'Agua Industrial Aljibe',
                        categoryCode: 'AGUA_INDUSTRIAL',
                        procurementBucket: 'AGUA_INDUSTRIAL_ALJIBE',
                        unitSi: 'm3',
                        totalQtyPending: 20,
                        priority: 'STANDARD',
                        atypicalCount: 0,
                        atypicalFlags: [],
                        sourceReqRefs: [],
                    },
                ],
            },
            {
                procurementBucket: 'CONTROLADOS_DGMN',
                totalLines: 1,
                atypicalCount: 0,
                estimatedClp: 900000,
                items: [
                    {
                        canonicalSkuId: 'SKU-EXP-DETONADOR',
                        name: 'Detonador Regulado DGMN',
                        categoryCode: 'EXPLOSIVOS_REGULADO',
                        procurementBucket: 'CONTROLADOS_DGMN',
                        unitSi: 'un',
                        totalQtyPending: 50,
                        priority: 'CRITICAL',
                        atypicalCount: 0,
                        atypicalFlags: [],
                        sourceReqRefs: [],
                    },
                ],
            },
        ];

        const { container } = render(
            <I18nextProvider i18n={i18n}>
                <ConsolidatedShoppingListsView
                    groups={groups}
                    loading={false}
                    canScanReceipt={true}
                    onOpenScannerForBucket={vi.fn()}
                />
            </I18nextProvider>
        );

        expect(container.textContent || '').toContain('Agua potable');
        expect(container.textContent || '').toContain('Agua industrial / Aljibe');
        expect(container.textContent || '').toContain('Controlados DGMN');
        expect(container.textContent || '').toContain('CONTROLADO DGMN');

        for (const lang of ['es', 'en', 'pt'] as const) {
            await act(async () => {
                await i18n.changeLanguage(lang);
            });
            expect(container.textContent || '').not.toMatch(/\bsupply\.[a-z_]+\.[a-z_]+/);
        }
    });
});
