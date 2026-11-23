import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n';
import type { MinReportSession } from '../../../context/MinReportSessionContext';
import type {
    SupplyConversationThread,
    SupplyConversationTurn,
    SupplySite,
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
import { supplyApi } from '../services/supplyApi';

const SITES: SupplySite[] = [
    {
        siteId: 'site-atacama-01',
        tenantId: 'tenant-v3-e07',
        name: 'Faena Atacama Norte',
        currentHeadcount: 42,
        waterStorageCapacityL: 40000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 7,
    },
];

const MOCK_THREADS: SupplyConversationThread[] = [
    {
        threadId: 'cthread_tenant-v3-e07_prof-camp-01',
        tenantId: 'tenant-v3-e07',
        profileId: 'prof-camp-01',
        displayName: 'Carlos Campamento',
        role: 'CAMP_MANAGER',
        phoneMasked: '+569****4302',
        phoneHashSha256: 'a'.repeat(64),
        headSeq: 2,
        headHashSha256: 'b'.repeat(64),
        turnCount: 2,
        activeEffectiveChannels: ['CH_CAMP_FOOD', 'CH_OPS_FLEET_FUEL'],
        linkedRequisitionIds: ['REQ-2026-001'],
        linkedPurchaseIds: ['PUR-2026-009'],
        linkedDteIds: ['DTE-33-901'],
        retentionPolicy: 'TAX_HOLD_6Y',
        legalHoldTaxYears: 6,
        retentionExpiresAtIso: '2032-11-23T00:00:00Z',
        lastTurnAtIso: '2026-11-23T12:00:00Z',
        createdAtIso: '2026-11-23T10:00:00Z',
        updatedAtIso: '2026-11-23T12:00:00Z',
    },
    {
        threadId: 'cthread_tenant-v3-e07_prof-mech-02',
        tenantId: 'tenant-v3-e07',
        profileId: 'prof-mech-02',
        displayName: 'Luis Mecánico',
        role: 'MECHANIC_TECH',
        phoneMasked: '+569****8811',
        phoneHashSha256: 'c'.repeat(64),
        headSeq: 1,
        headHashSha256: 'd'.repeat(64),
        turnCount: 1,
        activeEffectiveChannels: ['CH_OPS_PARTS_LUBES'],
        linkedRequisitionIds: [],
        linkedPurchaseIds: [],
        linkedDteIds: [],
        retentionPolicy: 'LEGAL_HOLD_PSEUDONYMIZED',
        legalHoldTaxYears: 6,
        retentionExpiresAtIso: '2032-11-20T00:00:00Z',
        pseudonymizedAtIso: '2026-11-22T09:00:00Z',
        lastTurnAtIso: '2026-11-22T08:00:00Z',
        createdAtIso: '2026-11-20T08:00:00Z',
        updatedAtIso: '2026-11-22T09:00:00Z',
    },
];

const MOCK_TURNS: SupplyConversationTurn[] = [
    {
        turnId: 'turn-001',
        threadId: 'cthread_tenant-v3-e07_prof-camp-01',
        tenantId: 'tenant-v3-e07',
        profileId: 'prof-camp-01',
        siteId: 'site-atacama-01',
        seq: 1,
        prevHash: '0'.repeat(64),
        turnHash: 'e1'.repeat(32),
        direction: 'INBOUND',
        channelSource: 'WHATSAPP_CLOUD',
        contentScrubbed: 'Solicito 500 L diésel flota y 2 detonadores. RUT [REDACTED_RUT]',
        redactedCategories: ['RUT_CL'],
        scopeSnapshot: {
            evaluatedAtIso: '2026-11-23T11:58:00Z',
            scopeFingerprint: 'f1'.repeat(32),
            permanentChannels: ['CH_CAMP_FOOD'],
            temporaryChannels: ['CH_OPS_FLEET_FUEL'],
            effectiveChannels: ['CH_CAMP_FOOD', 'CH_OPS_FLEET_FUEL'],
            activeGrantItemIds: ['tg-weekend-1'],
            hasValidDgmnLicense: false,
        },
        casMedia: [
            {
                sha256: 'ab'.repeat(32),
                downloadUrl: '/api/media/blob/ab01',
                mimeType: 'image/webp',
                extension: 'webp',
                originalFilename: 'guia_despacho.jpg',
                originalBytes: 245760,
                optimizedBytes: 49152,
                savingsPct: 80,
            },
            {
                sha256: 'cd'.repeat(32),
                downloadUrl: '/api/media/blob/cd02',
                mimeType: 'audio/ogg',
                extension: 'ogg',
                originalFilename: 'nota_terreno.ogg',
                originalBytes: 32768,
                optimizedBytes: 16384,
                savingsPct: 50,
            },
        ],
        policyAuditRefs: ['DGMN_EXPLOSIVES_BLOCK', 'CHANNEL_SCOPE_DENIED'],
        aiModelUsed: null,
        linkedRequisitionIds: ['REQ-2026-001'],
        linkedPurchaseIds: [],
        linkedDteIds: [],
        legalHoldTaxYears: 6,
        retentionExpiresAtIso: '2032-11-23T00:00:00Z',
        createdAtIso: '2026-11-23T11:58:00Z',
    },
    {
        turnId: 'turn-002',
        threadId: 'cthread_tenant-v3-e07_prof-camp-01',
        tenantId: 'tenant-v3-e07',
        profileId: 'prof-camp-01',
        siteId: 'site-atacama-01',
        seq: 2,
        prevHash: 'e1'.repeat(32),
        turnHash: 'f2'.repeat(32),
        direction: 'OUTBOUND',
        channelSource: 'WHATSAPP_CLOUD',
        contentScrubbed: 'Registrado REQ-2026-001 por 500 L diésel flota; explosivos rechazados sin licencia DGMN.',
        redactedCategories: [],
        scopeSnapshot: {
            evaluatedAtIso: '2026-11-23T12:00:00Z',
            scopeFingerprint: 'f1'.repeat(32),
            permanentChannels: ['CH_CAMP_FOOD'],
            temporaryChannels: ['CH_OPS_FLEET_FUEL'],
            effectiveChannels: ['CH_CAMP_FOOD', 'CH_OPS_FLEET_FUEL'],
            activeGrantItemIds: ['tg-weekend-1'],
            hasValidDgmnLicense: false,
        },
        casMedia: [],
        policyAuditRefs: [],
        aiModelUsed: 'gemini-2.5-flash',
        linkedRequisitionIds: ['REQ-2026-001'],
        linkedPurchaseIds: ['PUR-2026-009'],
        linkedDteIds: ['DTE-33-901'],
        legalHoldTaxYears: 6,
        retentionExpiresAtIso: '2032-11-23T00:00:00Z',
        createdAtIso: '2026-11-23T12:00:00Z',
    },
];

function makeDevSession(): MinReportSession {
    return {
        uid: 'uid-dev-e07',
        email: 'dev@minreport.com',
        displayName: 'Dev Root',
        tenantId: 'tenant-v3-e07',
        tenantName: 'Minera V3 SpA',
        countryCode: 'CL',
        role: 'OWNER',
        classification: 'b2b',
        accountTier: 1,
        isDevRoot: true,
        isSuperAdmin: false,
        isTestPilot: false,
        isEduSandbox: false,
        activeModules: { opermaq: true, stockpile: true, supply: true },
        permissions: {
            opermaq: { canInspect: true, canManageFleet: true, canViewVaults: true, canCurateAI: true },
            stockpile: { canScan: true, canCalculate: true, canExportReport: true, canTrainVisionAI: true },
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

function stubBaseWorkspaceReads() {
    vi.spyOn(supplyApi, 'listSites').mockResolvedValue(SITES);
    vi.spyOn(supplyApi, 'listRequisitions').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listPurchases').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listSiiDocuments').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listAssets').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'getForecast').mockResolvedValue(null);
    vi.spyOn(supplyApi, 'getConsolidatedShoppingLists').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listInventory').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listSiiExpenseReports').mockResolvedValue([]);
    vi.spyOn(supplyApi, 'listSupplyProfiles').mockResolvedValue([]);
}

describe('V3-E07 — SupplyConversationsAuditView (Φ 38.2/61.8, SHA-256, CAS & Decoupled WS Simulator)', () => {
    beforeEach(async () => {
        vi.restoreAllMocks();
        sessionMockState.session = makeDevSession();
        await act(async () => {
            await i18n.changeLanguage('es');
        });
    });

    it('1. Fetch diferido al tab CONVERSATIONS y desacoplamiento total del simulador desde RequisitionBacklogView', async () => {
        stubBaseWorkspaceReads();
        const threadsSpy = vi
            .spyOn(supplyApi, 'listSupplyConversationThreads')
            .mockResolvedValue(MOCK_THREADS);
        const turnsSpy = vi
            .spyOn(supplyApi, 'listSupplyConversationTurns')
            .mockResolvedValue({
                thread: MOCK_THREADS[0],
                turns: MOCK_TURNS,
                chainVerification: { valid: true, turnCount: 2 },
            });

        render(
            <I18nextProvider i18n={i18n}>
                <SupplyWorkspace embedded={true} hostScope="DEV_GATEWAY" tenantId="tenant-v3-e07" />
            </I18nextProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('supply-control-summary')).toBeInTheDocument();
        });
        expect(threadsSpy).not.toHaveBeenCalled();

        // Ir a DEMAND: no existe simulador inline en Backlog, pero sí enlace limpio a CONVERSATIONS
        fireEvent.click(screen.getByTestId('supply-tab-DEMAND'));
        await waitFor(() => {
            expect(screen.getByTestId('backlog-open-conversations-btn')).toBeInTheDocument();
        });
        expect(screen.queryByTestId('ws-dev-simulator-panel')).not.toBeInTheDocument();

        // Click en enlace -> abre CONVERSATIONS con simulador DEV desacoplado sin teléfonos hardcoded
        fireEvent.click(screen.getByTestId('backlog-open-conversations-btn'));

        await waitFor(() => {
            expect(threadsSpy).toHaveBeenCalledTimes(1);
            expect(turnsSpy).toHaveBeenCalledWith(
                'cthread_tenant-v3-e07_prof-camp-01',
                {},
                'tenant-v3-e07'
            );
            expect(screen.getByTestId('supply-conversations-audit-view')).toBeInTheDocument();
            expect(screen.getByTestId('ws-dev-simulator-panel')).toBeInTheDocument();
        });

        const view = screen.getByTestId('supply-conversations-audit-view');
        expect(view.className).toContain('38.2fr');
        expect(view.className).toContain('61.8fr');

        const phoneInput = screen.getByLabelText(/Teléfono E\.164/i) as HTMLInputElement;
        expect(phoneInput.value).toBe('');
        expect(phoneInput).toHaveAttribute('autocomplete', 'off');
        expect(phoneInput).toHaveAttribute('spellcheck', 'false');
    });

    it('2. Renderiza timeline SHA-256, scopeSnapshot por turno, CAS media (ORIG -> CAS), policyAuditRefs y links bidireccionales REQ/DTE', async () => {
        stubBaseWorkspaceReads();
        vi.spyOn(supplyApi, 'listSupplyConversationThreads').mockResolvedValue(MOCK_THREADS);
        vi.spyOn(supplyApi, 'listSupplyConversationTurns').mockResolvedValue({
            thread: MOCK_THREADS[0],
            turns: MOCK_TURNS,
            chainVerification: { valid: true, turnCount: 2 },
        });

        render(
            <I18nextProvider i18n={i18n}>
                <SupplyWorkspace embedded={true} domainMode="CONVERSATIONS" tenantId="tenant-v3-e07" />
            </I18nextProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('conv-turn-1')).toBeInTheDocument();
            expect(screen.getByTestId('conv-turn-2')).toBeInTheDocument();
        });

        expect(screen.getByTestId('conv-chain-status')).toHaveTextContent('CADENA SHA-256 ÍNTEGRA');
        expect(screen.getByTestId('conv-retention-badge')).toHaveTextContent(
            'RETENCIÓN TRIBUTARIA 6 AÑOS'
        );

        // Scope snapshot exacto (permanente vs temporal)
        const scope1 = screen.getByTestId('turn-scope-1');
        expect(scope1).toHaveTextContent('CH_CAMP_FOOD');
        expect(scope1).toHaveTextContent('CH_OPS_FLEET_FUEL');
        expect(scope1).toHaveTextContent('TEMPORAL');

        // CAS media: SecureImage + Audio + ORIG -> CAS (-80%)
        const img = screen.getByAltText('guia_despacho.jpg');
        expect(img).toHaveAttribute('draggable', 'false');
        expect(screen.getByLabelText('Nota de voz CAS')).toBeInTheDocument();
        expect(document.body.textContent || '').toContain('-80%');

        // Eventos de política DS132/DGMN/Scope
        expect(screen.getByTestId('turn-policy-audit-1')).toHaveTextContent('DGMN_EXPLOSIVES_BLOCK');

        // Filtro por casilla CH_OPS_PARTS_LUBES deja visible hilo mecánico con LEGAL_HOLD_PSEUDONYMIZED
        fireEvent.change(screen.getByTestId('conv-channel-filter'), {
            target: { value: 'CH_OPS_PARTS_LUBES' },
        });
        expect(screen.getByTestId('conv-thread-row-cthread_tenant-v3-e07_prof-mech-02')).toBeInTheDocument();
        expect(
            screen.queryByTestId('conv-thread-row-cthread_tenant-v3-e07_prof-camp-01')
        ).not.toBeInTheDocument();

        // Restaurar filtro y probar navegación bidireccional a FINANCE_SII desde link DTE
        fireEvent.change(screen.getByTestId('conv-channel-filter'), {
            target: { value: 'ALL' },
        });
        fireEvent.click(screen.getByTestId('conv-thread-row-cthread_tenant-v3-e07_prof-camp-01'));
        await waitFor(() => {
            expect(screen.getByTestId('thread-link-dte-DTE-33-901')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByTestId('thread-link-dte-DTE-33-901'));
        await waitFor(() => {
            expect(screen.getByTestId('supply-tab-FINANCE_SII')).toHaveAttribute(
                'aria-current',
                'page'
            );
        });
    });

    it('3. Exportación JSON/CSV auditada con SHA-256, contraste WCAG AAA y paridad es/en/pt sin llaves crudas', async () => {
        stubBaseWorkspaceReads();
        vi.spyOn(supplyApi, 'listSupplyConversationThreads').mockResolvedValue(MOCK_THREADS);
        vi.spyOn(supplyApi, 'listSupplyConversationTurns').mockResolvedValue({
            thread: MOCK_THREADS[0],
            turns: MOCK_TURNS,
            chainVerification: { valid: true, turnCount: 2 },
        });
        const exportSpy = vi
            .spyOn(supplyApi, 'exportSupplyConversation')
            .mockImplementation(async (threadId, format) => ({
                format,
                filename: `${threadId}.${format.toLowerCase()}`,
                sha256: '9f'.repeat(32),
                bodyText: format === 'CSV' ? 'SEQ;TURN_HASH\n1;e1\n' : '{"ok":true}',
            }));

        const { container } = render(
            <I18nextProvider i18n={i18n}>
                <SupplyWorkspace embedded={true} domainMode="CONVERSATIONS" tenantId="tenant-v3-e07" />
            </I18nextProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('export-conv-csv-btn')).toBeInTheDocument();
        });

        const csvBtn = screen.getByTestId('export-conv-csv-btn');
        expect(csvBtn.className).toContain('bg-[#C68346]');
        expect(csvBtn.className).toContain('text-[#000000]');
        expect(csvBtn.className).not.toContain('text-white');

        fireEvent.click(csvBtn);
        await waitFor(() => {
            expect(exportSpy).toHaveBeenCalledWith(
                'cthread_tenant-v3-e07_prof-camp-01',
                'CSV',
                'tenant-v3-e07'
            );
            expect(screen.getByTestId('conv-export-receipt')).toHaveTextContent('9f'.repeat(32));
        });

        fireEvent.click(screen.getByTestId('export-conv-json-btn'));
        await waitFor(() => {
            expect(exportSpy).toHaveBeenCalledWith(
                'cthread_tenant-v3-e07_prof-camp-01',
                'JSON',
                'tenant-v3-e07'
            );
        });

        for (const lang of ['es', 'en', 'pt'] as const) {
            await act(async () => {
                await i18n.changeLanguage(lang);
            });
            expect(container.textContent || '').not.toMatch(/\bsupply\.[a-z_]+\.[a-z_]+/);
        }
    });
});
