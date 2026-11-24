import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n';
import type { ReconciliationProposal } from '../../../contracts/supply.contracts';
import type { SupplyPurchaseDraft, SupplyRequisition } from '../types';

vi.mock('../../../core/offline/SyncQueueEngine', () => ({
    syncQueueEngine: {
        isOnlineNow: () => true,
        enqueueSupplyApiMutation: vi.fn(),
    },
}));

import { ReconciliationHitlDrawer } from '../components/ReconciliationHitlDrawer';
import { supplyApi } from '../services/supplyApi';

const MOCK_DRAFT: SupplyPurchaseDraft = {
    siteId: 'site-atacama-01',
    purchaseMode: 'MIXED_FULFILLMENT_AND_DIRECT',
    supplierTaxId: '76.123.456-0',
    supplierName: 'Distribuidora Minera SpA',
    documentType: 33,
    folio: '9912',
    issueDate: '2026-11-23',
    netAmountClp: 150000,
    vatAmountClp: 28500,
    totalAmountClp: 178500,
    paymentMethod: 'TRANSFERENCIA',
    lines: [
        {
            lineId: 'pl-1',
            rawDescription: 'Aceite Hidráulico ISO 68 Balde 19L',
            categoryCode: 'LUBRICANTES_FILTROS',
            qty: 2,
            unitSi: 'un',
            unitPriceClp: 60000,
            subtotalClp: 120000,
            destination: 'STOCK_IN_WAREHOUSE',
        },
        {
            lineId: 'pl-2',
            rawDescription: 'Flete Transporte Faena',
            categoryCode: 'OTROS_OPERACIONAL',
            qty: 1,
            unitSi: 'un',
            unitPriceClp: 30000,
            subtotalClp: 30000,
            destination: 'DIRECT_EXPENSE',
        },
    ],
};

function makeOpenRequisitions(count: number): SupplyRequisition[] {
    return Array.from({ length: count }, (_, idx) => ({
        reqId: `REQ-2026-${String(idx + 1).padStart(3, '0')}`,
        tenantId: 'tenant-v3-e09c',
        siteId: 'site-atacama-01',
        costCenter: `CC-OPS-${idx + 1}`,
        requesterUid: 'uid-req',
        requesterName: 'Operador Terreno',
        requesterRole: 'OPS_FOREMAN',
        demandOrigin: 'WA_OPS',
        demandNature: 'REACTIVE_FIELD',
        status: 'OPEN',
        createdAt: `2026-11-${String(10 + idx).padStart(2, '0')}T10:00:00Z`,
        lines: [
            {
                lineId: `rl-${idx + 1}`,
                canonicalSkuId: `SKU-OPS-ITEM-${idx + 1}`,
                name: `Insumo Backlog #${idx + 1}`,
                categoryCode: 'FERRETERIA_CONSTRUCCION',
                procurementBucket: 'FERRETERIA_INSUMOS',
                unitSi: 'un',
                qtyRequested: 5,
                qtyPurchased: 0,
                qtyReceived: 0,
                qtyPending: 5,
                fulfillmentChannel: 'MANUAL_LOCAL_PURCHASE',
                lineStatus: 'OPEN',
                atypicalFlags: [],
                urgency: 'STANDARD',
            },
        ],
    }));
}

const MOCK_PROPOSAL: ReconciliationProposal = {
    proposalId: 'prop-4way-01',
    tenantId: 'tenant-v3-e09c',
    siteId: 'site-atacama-01',
    supplierTaxIdNormalized: '76123456-0',
    documentType: 33,
    folio: '9912',
    issueDate: '2026-11-23',
    dteReferences: [],
    siiTaxes: {
        iepOrIecClp: 0,
        globalAdjustmentNetClp: 15000,
        linePricingBasis: 'NET',
    },
    ruralDuplicateAlert: null,
    proposedLines: [
        {
            purchaseLineId: 'pl-1',
            rawDescription: 'Aceite Hidráulico ISO 68 Balde 19L',
            classification: 'SUBSTITUTE_CANDIDATE',
            matchedCanonicalSkuId: 'SKU-FLOTA-ACEITE-HID68',
            matchedSkuName: 'Aceite Hidráulico ISO 68',
            confidence: 0.91,
            matchTier: 'LEVEL_2_VECTOR_768D',
            candidateRequisitionIds: ['REQ-2026-001'],
            unitCostNetClp: 60000,
            landedUnitCostNetClp: 67500,
            allocatedFreightOrDiscountClp: 15000,
            requiresHitlConfirmation: true,
            reasoning: 'Equivalente formato 19L vs 20L',
        },
        {
            purchaseLineId: 'pl-2',
            rawDescription: 'Flete Transporte Faena',
            classification: 'ACCESSORY_CHARGE',
            matchedCanonicalSkuId: 'SKU-LOG-FLETE',
            matchedSkuName: 'Flete y Despacho',
            confidence: 0.99,
            matchTier: 'LEVEL_1_DETERMINISTIC',
            candidateRequisitionIds: [],
            unitCostNetClp: 30000,
            landedUnitCostNetClp: 30000,
            allocatedFreightOrDiscountClp: 0,
            requiresHitlConfirmation: false,
        },
    ],
    anomalies: [
        {
            alertId: 'anom-shrink-1',
            alertType: 'ANOMALY_SHRINKFLATION',
            severity: 'WARNING',
            canonicalSkuId: 'SKU-FLOTA-ACEITE-HID68',
            messageSpanish: 'Envase 19L (-5%) a igual precio que formato 20L.',
            observedValue: 67500,
            baselineValue: 59000,
            variancePct: 14.4,
            detectedAtIso: '2026-11-23T14:00:00Z',
        },
        {
            alertId: 'anom-lph-2',
            alertType: 'ANOMALY_FUEL_EXCESS_LPH',
            severity: 'CRITICAL',
            opermaqAssetId: 'CAT-777G-04',
            messageSpanish: 'Consumo L/hr excede baseline OPERMAQ.',
            variancePct: 38.2,
            detectedAtIso: '2026-11-23T14:00:00Z',
        },
    ],
    createdAtIso: '2026-11-23T14:00:00Z',
};

describe('V3-E09c — ReconciliationHitlDrawer 4-Way AI Diff, Proration, Anomalies & Full Backlog', () => {
    beforeEach(async () => {
        vi.restoreAllMocks();
        await act(async () => {
            await i18n.changeLanguage('es');
        });
    });

    it('1. Elimina truncación .slice(0, 6) mostrando backlog completo desplazable y filtro de búsqueda', () => {
        const reqs = makeOpenRequisitions(10);

        render(
            <I18nextProvider i18n={i18n}>
                <ReconciliationHitlDrawer
                    open={true}
                    draft={MOCK_DRAFT}
                    openRequisitions={reqs}
                    tenantId="tenant-v3-e09c"
                    canMutate={true}
                    onClose={vi.fn()}
                    onClearDraft={vi.fn()}
                    onCommitted={vi.fn()}
                />
            </I18nextProvider>
        );

        const fullList = screen.getByTestId('reconciler-backlog-full-list');
        expect(fullList).toHaveTextContent('Insumo Backlog #1');
        expect(fullList).toHaveTextContent('Insumo Backlog #10');

        fireEvent.change(screen.getByTestId('reconciler-backlog-search'), {
            target: { value: 'Backlog #9' },
        });
        expect(fullList).toHaveTextContent('Insumo Backlog #9');
        expect(fullList).not.toHaveTextContent('Insumo Backlog #10');
    });

    it('2. Ejecuta propose/commit-4way con prorrateo WEIGHT_KG, diff 1-a-1 IA, costo landed, anomalías y HITL ACTUALIZAR', async () => {
        const reqs = makeOpenRequisitions(3);
        const proposeSpy = vi
            .spyOn(supplyApi, 'proposeReconciliation4Way')
            .mockResolvedValue(MOCK_PROPOSAL);
        const commitSpy = vi
            .spyOn(supplyApi, 'commitReconciliation4Way')
            .mockResolvedValue({
                success: true,
                anomaliesCount: 2,
                learnedMappingsCount: 2,
                cashEntriesCount: 2,
            });
        const onCommitted = vi.fn();

        const { container } = render(
            <I18nextProvider i18n={i18n}>
                <ReconciliationHitlDrawer
                    open={true}
                    draft={MOCK_DRAFT}
                    openRequisitions={reqs}
                    tenantId="tenant-v3-e09c"
                    canMutate={true}
                    onClose={vi.fn()}
                    onClearDraft={vi.fn()}
                    onCommitted={onCommitted}
                />
            </I18nextProvider>
        );

        fireEvent.change(screen.getByTestId('reconciler-proration-select'), {
            target: { value: 'WEIGHT_KG' },
        });
        fireEvent.change(screen.getByTestId('reconciler-freight-input'), {
            target: { value: '15000' },
        });
        fireEvent.click(screen.getByTestId('reconciler-propose-4way-btn'));

        await waitFor(() => {
            expect(proposeSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    prorationMode: 'WEIGHT_KG',
                    globalDiscountOrChargeClp: 15000,
                }),
                'tenant-v3-e09c'
            );
            expect(screen.getByTestId('reconciler-anomaly-anom-shrink-1')).toBeInTheDocument();
            expect(screen.getByTestId('reconciler-anomaly-anom-lph-2')).toBeInTheDocument();
        });

        // Verificar badges semánticos y costo unitario landed
        expect(screen.getByTestId('reconciler-class-pl-1')).toHaveTextContent('Producto sustituto (revisar)');
        expect(screen.getByTestId('reconciler-class-pl-2')).toHaveTextContent('Flete o cargo adicional');
        expect(screen.getByTestId('reconciler-landed-pl-1')).toHaveTextContent('67.500');

        // Aceptar 1-a-1 línea pl-1 (SUBSTITUTE_CANDIDATE)
        fireEvent.click(screen.getByTestId('reconciler-line-accept-pl-1'));

        // Compuerta HITL "ACTUALIZAR"
        const kwInput = screen.getByPlaceholderText('ACTUALIZAR');
        expect(kwInput).toHaveAttribute('autocomplete', 'off');
        expect(kwInput).toHaveAttribute('spellcheck', 'false');
        fireEvent.change(kwInput, { target: { value: 'ACTUALIZAR' } });

        const commitBtn = screen.getByRole('button', { name: /Confirmar y guardar compra/i });
        expect(commitBtn.className).toContain('bg-[#C68346]');
        expect(commitBtn.className).toContain('text-[#000000]');
        fireEvent.click(commitBtn);

        await waitFor(() => {
            expect(commitSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    proposalId: 'prop-4way-01',
                    prorationMode: 'WEIGHT_KG',
                    globalDiscountOrChargeClp: 15000,
                    confirmationKeyword: 'ACTUALIZAR',
                    lines: expect.arrayContaining([
                        expect.objectContaining({
                            purchaseLineId: 'pl-1',
                            canonicalSkuId: 'SKU-FLOTA-ACEITE-HID68',
                            classification: 'SUBSTITUTE_CANDIDATE',
                            accepted: true,
                        }),
                    ]),
                }),
                'tenant-v3-e09c'
            );
            expect(onCommitted).toHaveBeenCalledWith(false);
        });

        for (const lang of ['es', 'en', 'pt'] as const) {
            await act(async () => {
                await i18n.changeLanguage(lang);
            });
            expect(container.textContent || '').not.toMatch(/\bsupply\.[a-z_]+\.[a-z_]+/);
        }
    });
});
