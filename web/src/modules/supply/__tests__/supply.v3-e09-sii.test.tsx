import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n';
import type { MinReportSession } from '../../../context/MinReportSessionContext';
import type { SiiDocumentRecord, SiiExpenseReport } from '../types';

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

vi.mock('../../../core/offline/SyncQueueEngine', () => ({
    syncQueueEngine: {
        isOnlineNow: () => true,
        enqueueSupplyApiMutation: vi.fn(),
    },
}));

import { SiiRendicionesView } from '../components/SiiRendicionesView';
import { supplyApi } from '../services/supplyApi';

const MOCK_DOCS: SiiDocumentRecord[] = [
    {
        docId: 'doc-rcv-48h',
        tenantId: 'tenant-sii-e09',
        dedupeKey: '76111222-3_33_7001',
        supplierTaxId: '76.111.222-3',
        supplierName: 'Combustibles Atacama SpA',
        documentType: 33,
        folio: '7001',
        issueDate: '2026-11-17',
        netAmountClp: 500000,
        vatAmountClp: 95000,
        totalAmountClp: 595000,
        paymentMethod: 'TRANSFERENCIA',
        rcvDaysRemaining: 1,
        rcvStatus: 'PENDING_ACCEPTANCE',
        isDuplicate: false,
        createdAt: '2026-11-17T10:00:00Z',
    },
    {
        docId: 'doc-rcv-3d',
        tenantId: 'tenant-sii-e09',
        dedupeKey: '76111222-3_33_7002',
        supplierTaxId: '76.111.222-3',
        supplierName: 'Ferretería Norte Ltda',
        documentType: 33,
        folio: '7002',
        issueDate: '2026-11-18',
        netAmountClp: 200000,
        vatAmountClp: 38000,
        totalAmountClp: 238000,
        paymentMethod: 'TRANSFERENCIA',
        rcvDaysRemaining: 3,
        rcvStatus: 'PENDING_REVIEW',
        isDuplicate: false,
        createdAt: '2026-11-18T10:00:00Z',
    },
    {
        docId: 'doc-rcv-safe',
        tenantId: 'tenant-sii-e09',
        dedupeKey: '76111222-3_33_7003',
        supplierTaxId: '76.111.222-3',
        supplierName: 'Servicios Plazos Largos SpA',
        documentType: 33,
        folio: '7003',
        issueDate: '2026-11-22',
        netAmountClp: 100000,
        vatAmountClp: 19000,
        totalAmountClp: 119000,
        paymentMethod: 'TRANSFERENCIA',
        rcvDaysRemaining: 7,
        rcvStatus: 'PENDING_REVIEW',
        isDuplicate: false,
        createdAt: '2026-11-22T10:00:00Z',
    },
];

const MOCK_REPORTS: SiiExpenseReport[] = [
    {
        reportId: 'rep-other-01',
        tenantId: 'tenant-sii-e09',
        siteId: 'site-01',
        code: 'REND-2026-01',
        title: 'Caja Chica Campamento Nov',
        costCenter: 'CC-CAMPAMENTO',
        holderName: 'Juan Custodio',
        holderUid: 'uid-custodio-01',
        periodLabel: '2026-11',
        paymentMethod: 'FONDO_POR_RENDIR',
        fundAdvanceClp: 300000,
        renderedTotalClp: 250000,
        balanceClp: 50000,
        documentCount: 2,
        documentIds: ['doc-rcv-48h', 'doc-rcv-3d'],
        status: 'SUBMITTED',
        createdAt: '2026-11-20T09:00:00Z',
    },
    {
        reportId: 'rep-self-02',
        tenantId: 'tenant-sii-e09',
        siteId: 'site-01',
        code: 'REND-2026-02',
        title: 'Fondo Propio Aprobador',
        costCenter: 'CC-FLOTA',
        holderName: 'Owner Approver',
        holderUid: 'uid-approver-99',
        periodLabel: '2026-11',
        paymentMethod: 'REEMBOLSO_GERENCIA',
        fundAdvanceClp: 200000,
        renderedTotalClp: 180000,
        balanceClp: 20000,
        documentCount: 1,
        documentIds: ['doc-rcv-safe'],
        status: 'SUBMITTED',
        createdAt: '2026-11-21T09:00:00Z',
    },
    {
        reportId: 'rep-approved-03',
        tenantId: 'tenant-sii-e09',
        siteId: 'site-01',
        code: 'REND-2026-03',
        title: 'Sobre Listo Liquidación',
        costCenter: 'CC-OPERACIONES',
        holderName: 'María Logística',
        holderUid: 'uid-custodio-02',
        periodLabel: '2026-11',
        paymentMethod: 'TRANSFERENCIA',
        fundAdvanceClp: 400000,
        renderedTotalClp: 400000,
        balanceClp: 0,
        documentCount: 1,
        documentIds: [],
        status: 'APPROVED',
        createdAt: '2026-11-19T09:00:00Z',
    },
];

function makeApproverSession(): MinReportSession {
    return {
        uid: 'uid-approver-99',
        email: 'owner@minreport-test.cl',
        displayName: 'Owner Approver',
        tenantId: 'tenant-sii-e09',
        tenantName: 'Minera SII SpA',
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

describe('V3-E09b-sii — SiiRendicionesView HITL Approvals, ISO 27001 SoD & RCV <= 3d / < 48h Alerts', () => {
    beforeEach(async () => {
        vi.restoreAllMocks();
        sessionMockState.session = makeApproverSession();
        await act(async () => {
            await i18n.changeLanguage('es');
        });
    });

    it('1. Aprueba, rechaza y liquida sobres SII con canApproveExpenseReports + HITL ACTUALIZAR y bloquea auto-aprobación ISO 27001', async () => {
        const updateSpy = vi
            .spyOn(supplyApi, 'updateExpenseReportStatus')
            .mockResolvedValue({ report: { ...MOCK_REPORTS[0], status: 'APPROVED' } });
        const onMutated = vi.fn();

        render(
            <I18nextProvider i18n={i18n}>
                <SiiRendicionesView
                    documents={MOCK_DOCS}
                    expenseReports={MOCK_REPORTS}
                    activeSiteId="site-01"
                    tenantId="tenant-sii-e09"
                    loading={false}
                    canMutate={true}
                    canApproveExpenseReports={true}
                    onMutated={onMutated}
                />
            </I18nextProvider>
        );

        fireEvent.click(screen.getByRole('button', { name: /Sobres de Rendición/i }));

        // Segregación de funciones ISO 27001: el sobre propio (uid-approver-99) NO permite auto-aprobar
        expect(screen.getByTestId('sii-envelope-sod-blocked-rep-self-02')).toBeInTheDocument();
        expect(screen.queryByTestId('sii-envelope-approve-rep-self-02')).not.toBeInTheDocument();
        expect(screen.queryByTestId('sii-envelope-reject-rep-self-02')).not.toBeInTheDocument();

        // Aprobar sobre de otro custodio (rep-other-01) vía HITL "ACTUALIZAR"
        fireEvent.click(screen.getByTestId('sii-envelope-approve-rep-other-01'));
        fireEvent.change(screen.getByPlaceholderText('ACTUALIZAR'), {
            target: { value: 'ACTUALIZAR' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^CONFIRMAR$/i }));

        await waitFor(() => {
            expect(updateSpy).toHaveBeenCalledWith(
                'rep-other-01',
                'APPROVED',
                'ACTUALIZAR',
                'tenant-sii-e09'
            );
            expect(onMutated).toHaveBeenCalledTimes(1);
        });

        // Rechazar sobre de otro custodio (rep-other-01) vía HITL "ACTUALIZAR"
        fireEvent.click(screen.getByTestId('sii-envelope-reject-rep-other-01'));
        fireEvent.change(screen.getByPlaceholderText('ACTUALIZAR'), {
            target: { value: 'ACTUALIZAR' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^CONFIRMAR$/i }));

        await waitFor(() => {
            expect(updateSpy).toHaveBeenCalledWith(
                'rep-other-01',
                'REJECTED',
                'ACTUALIZAR',
                'tenant-sii-e09'
            );
        });

        // Liquidar sobre aprobado (rep-approved-03) vía HITL "ACTUALIZAR"
        fireEvent.click(screen.getByTestId('sii-envelope-settle-rep-approved-03'));
        fireEvent.change(screen.getByPlaceholderText('ACTUALIZAR'), {
            target: { value: 'ACTUALIZAR' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^CONFIRMAR$/i }));

        await waitFor(() => {
            expect(updateSpy).toHaveBeenCalledWith(
                'rep-approved-03',
                'SETTLED',
                'ACTUALIZAR',
                'tenant-sii-e09'
            );
        });
    });

    it('2. Oculta acciones de aprobación cuando canApproveExpenseReports=false y destaca alertas RCV <= 3 días / < 48h con consulta DTE RCV', async () => {
        const listDocsSpy = vi
            .spyOn(supplyApi, 'listSiiDocuments')
            .mockResolvedValue(MOCK_DOCS);

        const { container } = render(
            <I18nextProvider i18n={i18n}>
                <SiiRendicionesView
                    documents={MOCK_DOCS}
                    expenseReports={MOCK_REPORTS}
                    activeSiteId="site-01"
                    tenantId="tenant-sii-e09"
                    loading={false}
                    canMutate={true}
                    canApproveExpenseReports={false}
                    onMutated={vi.fn()}
                />
            </I18nextProvider>
        );

        // En ENVELOPES sin canApproveExpenseReports no hay botones aprobar/rechazar/liquidar
        fireEvent.click(screen.getByRole('button', { name: /Sobres de Rendición/i }));
        expect(screen.queryByTestId('sii-envelope-approve-rep-other-01')).not.toBeInTheDocument();
        expect(screen.queryByTestId('sii-envelope-settle-rep-approved-03')).not.toBeInTheDocument();

        // Consultar DTE RCV desde botón Icon-First -> activa FACTURAS + filtro RCV <= 3d
        fireEvent.click(screen.getByTestId('sii-rcv-query-btn'));

        await waitFor(() => {
            expect(listDocsSpy).toHaveBeenCalledWith({ siteId: 'site-01' }, 'tenant-sii-e09');
        });

        const articles = Array.from(container.querySelectorAll('article'));
        expect(articles).toHaveLength(2); // doc-rcv-48h (1d) y doc-rcv-3d (3d), excluye 7d
        expect(articles[0].className).toContain('border-l-[#C68346]');
        expect(articles[1].className).toContain('border-l-[#C68346]');

        const badge48h = screen.getByTestId('sii-rcv-badge-48h-doc-rcv-48h');
        expect(badge48h.className).toContain('bg-[#C68346]');
        expect(badge48h.className).toContain('text-[#000000]');
        expect(badge48h).toHaveTextContent('RCV < 48H');
        expect(screen.getByTestId('sii-rcv-badge-3d-doc-rcv-3d')).toHaveTextContent('RCV ≤ 3D');

        // Paridad es/en/pt sin llaves crudas
        for (const lang of ['es', 'en', 'pt'] as const) {
            await act(async () => {
                await i18n.changeLanguage(lang);
            });
            expect(container.textContent || '').not.toMatch(/\bsupply\.[a-z_]+\.[a-z_]+/);
        }
    });
});
