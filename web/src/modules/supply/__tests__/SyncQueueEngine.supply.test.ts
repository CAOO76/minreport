import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OfflineCasBlobRecord } from '../../../core/offline/OfflineStorage';
import type { SyncTask } from '../../../core/offline/SyncQueueEngine';

// Hoisted in-memory stores & spies for deterministic Offline-First Cordillera tests
const mockState = vi.hoisted(() => ({
    tasks: new Map<string, SyncTask>(),
    casBlobs: new Map<string, OfflineCasBlobRecord>(),
    metadata: new Map<string, unknown>(),
    coreAuthFetch: vi.fn(),
    storageRef: vi.fn((_storage: unknown, path: string) => ({ fullPath: path })),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    digestAndUploadCas: vi.fn(),
}));

vi.mock('../../../core/offline/OfflineStorage', () => ({
    offlineStorage: {
        putSyncTask: vi.fn(async (task: SyncTask) => {
            mockState.tasks.set(task.id, { ...task });
        }),
        getAllSyncTasks: vi.fn(async () => Array.from(mockState.tasks.values()).map((t) => ({ ...t }))),
        deleteSyncTask: vi.fn(async (id: string) => {
            mockState.tasks.delete(id);
        }),
        putOfflineMetadata: vi.fn(async (key: string, value: unknown) => {
            mockState.metadata.set(key, value);
        }),
        getOfflineMetadata: vi.fn(async (key: string) =>
            mockState.metadata.has(key) ? mockState.metadata.get(key) : null
        ),
        putCasBlob: vi.fn(async (rec: OfflineCasBlobRecord) => {
            mockState.casBlobs.set(rec.sha256, rec);
        }),
        getCasBlob: vi.fn(async (sha: string) => mockState.casBlobs.get(sha) || null),
    },
}));

vi.mock('../../../core/network/coreAuthFetch', () => ({
    coreAuthFetch: mockState.coreAuthFetch,
}));

vi.mock('../../../core/media/MediaDigestorClient', () => ({
    mediaDigestorClient: {
        digestAndUploadCas: mockState.digestAndUploadCas,
        computeSha256Hex: vi.fn(async () => 'c'.repeat(64)),
    },
}));

vi.mock('../../../config/firebase', () => ({
    auth: { currentUser: null },
    db: {},
    storage: { __mockStorage: true },
}));

vi.mock('firebase/storage', () => ({
    ref: mockState.storageRef,
    uploadBytes: mockState.uploadBytes,
    getDownloadURL: mockState.getDownloadURL,
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false },
}));

vi.mock('@capacitor/network', () => ({
    Network: {
        getStatus: vi.fn(async () => ({ connected: true })),
        addListener: vi.fn(async () => ({ remove: vi.fn() })),
    },
}));

import { syncQueueEngine } from '../../../core/offline/SyncQueueEngine';
import { supplyApi } from '../services/supplyApi';
import i18n from '../../../i18n';
import esSupply from '../locales/es.json';
import enSupply from '../locales/en.json';
import ptSupply from '../locales/pt.json';
import { formatClp, formatMoney } from '../types';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
    return Object.entries(obj)
        .flatMap(([k, v]) => {
            const next = prefix ? `${prefix}.${k}` : k;
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                return flattenKeys(v as Record<string, unknown>, next);
            }
            return [next];
        })
        .sort();
}

describe('E13a — Offline-First Cordillera SyncQueueEngine + Supply Offline + Global i18n + Intl Money', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        mockState.tasks.clear();
        mockState.casBlobs.clear();
        mockState.metadata.clear();
        mockState.coreAuthFetch.mockReset();
        mockState.storageRef.mockClear();
        mockState.uploadBytes.mockReset();
        mockState.getDownloadURL.mockReset();
        mockState.digestAndUploadCas.mockReset();

        // Fast health probe mock
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
        Object.defineProperty(window.navigator, 'onLine', {
            configurable: true,
            value: true,
        });
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('1. HTTP 409 y 400 en SUPPLY_PURCHASE_RECEIPT / SUPPLY_API_MUTATION mueven a DEAD_LETTER sin loop infinito y emiten minreport:sync-dead-letter', async () => {
        const deadLetterEvents: CustomEvent[] = [];
        const listener = (ev: Event) => deadLetterEvents.push(ev as CustomEvent);
        window.addEventListener('minreport:sync-dead-letter', listener);

        try {
            mockState.tasks.set('task-409', {
                id: 'task-409',
                type: 'SUPPLY_PURCHASE_RECEIPT',
                payload: {
                    endpoint: '/api/supply/purchases',
                    method: 'POST',
                    tenantId: 'tenant-cordillera',
                    body: { folio: '5511', tenantId: 'tenant-cordillera' },
                    eventName: 'supply:purchase-synced',
                },
                timestamp: '2026-11-22T01:00:00.000Z',
                attempts: 0,
                status: 'PENDING',
            });

            mockState.tasks.set('task-400', {
                id: 'task-400',
                type: 'SUPPLY_API_MUTATION',
                payload: {
                    endpoint: '/api/supply/sii/expense-reports',
                    method: 'POST',
                    tenantId: 'tenant-cordillera',
                    body: { title: '', tenantId: 'tenant-cordillera' },
                    eventName: 'supply:sii-expense-report-synced',
                },
                timestamp: '2026-11-22T01:00:01.000Z',
                attempts: 0,
                status: 'PENDING',
            });

            mockState.coreAuthFetch
                .mockResolvedValueOnce({
                    ok: false,
                    status: 409,
                    json: async () => ({ error: 'SII_DUPLICATE_DOCUMENT' }),
                })
                .mockResolvedValueOnce({
                    ok: false,
                    status: 400,
                    json: async () => ({ error: 'INVALID_EXPENSE_PAYLOAD' }),
                });

            await syncQueueEngine.flushQueue();

            expect(mockState.coreAuthFetch).toHaveBeenCalledTimes(2);
            const t409 = mockState.tasks.get('task-409');
            const t400 = mockState.tasks.get('task-400');

            expect(t409?.status).toBe('DEAD_LETTER');
            expect(t409?.httpStatus).toBe(409);
            expect(t409?.lastError).toContain('409');
            expect(t409?.attempts).toBe(1);

            expect(t400?.status).toBe('DEAD_LETTER');
            expect(t400?.httpStatus).toBe(400);
            expect(t400?.lastError).toContain('400');
            expect(t400?.attempts).toBe(1);

            expect(deadLetterEvents).toHaveLength(2);
            expect(deadLetterEvents[0].detail).toMatchObject({
                taskId: 'task-409',
                type: 'SUPPLY_PURCHASE_RECEIPT',
                status: 409,
                eventName: 'supply:purchase-synced',
            });
            expect(deadLetterEvents[1].detail).toMatchObject({
                taskId: 'task-400',
                type: 'SUPPLY_API_MUTATION',
                status: 400,
                eventName: 'supply:sii-expense-report-synced',
            });

            // Segundo flushQueue NO reintenta tareas en DEAD_LETTER (cero loop infinito)
            await syncQueueEngine.flushQueue();
            expect(mockState.coreAuthFetch).toHaveBeenCalledTimes(2);
            expect(await syncQueueEngine.refreshPendingCount('tenant-cordillera')).toBe(0);
            expect(await syncQueueEngine.getDeadLetterTasks('tenant-cordillera')).toHaveLength(2);
        } finally {
            window.removeEventListener('minreport:sync-dead-letter', listener);
        }
    });

    it('2. HTTP 200 usa coreAuthFetch con header tenant y despacha CustomEvent(payload.eventName); supplyApi encola offline SII/OPERMAQ', async () => {
        const syncedEvents: CustomEvent[] = [];
        const onPurchaseSynced = (ev: Event) => syncedEvents.push(ev as CustomEvent);
        window.addEventListener('supply:purchase-synced', onPurchaseSynced);

        try {
            mockState.tasks.set('task-ok-purchase', {
                id: 'task-ok-purchase',
                type: 'SUPPLY_PURCHASE_RECEIPT',
                payload: {
                    endpoint: '/api/supply/purchases',
                    method: 'POST',
                    tenantId: 'tenant-atacama',
                    body: { folio: '9001', totalAmountClp: 119000 },
                    eventName: 'supply:purchase-synced',
                },
                timestamp: '2026-11-22T01:01:00.000Z',
                attempts: 0,
                status: 'PENDING',
            });

            mockState.coreAuthFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ purchase: { purchaseId: 'pur-9001' } }),
            });

            await syncQueueEngine.flushQueue();

            expect(mockState.coreAuthFetch).toHaveBeenCalledTimes(1);
            expect(mockState.coreAuthFetch).toHaveBeenCalledWith(
                '/api/supply/purchases',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'X-Active-Account-Id': 'tenant-atacama',
                    }),
                })
            );
            expect(mockState.tasks.has('task-ok-purchase')).toBe(false);
            expect(syncedEvents).toHaveLength(1);
            expect(syncedEvents[0].detail).toMatchObject({
                taskId: 'task-ok-purchase',
                type: 'SUPPLY_PURCHASE_RECEIPT',
                result: { purchase: { purchaseId: 'pur-9001' } },
            });

            // Verificar encolado offline de mutaciones clave SII / OPERMAQ cuando !navigator.onLine
            Object.defineProperty(window.navigator, 'onLine', {
                configurable: true,
                value: false,
            });
            window.dispatchEvent(new Event('offline'));

            const repRes = await supplyApi.createExpenseReport(
                {
                    siteId: 'site-1',
                    title: 'Rendición Noviembre',
                    costCenter: 'CC-CAMP',
                    holderName: 'Jefe Campamento',
                    periodLabel: '2026-11',
                    paymentMethod: 'FONDO_POR_RENDIR',
                    fundAdvanceClp: 500000,
                    confirmationKeyword: 'ACTUALIZAR',
                },
                'tenant-atacama'
            );
            expect(repRes.queuedOffline).toBe(true);

            const statusRes = await supplyApi.updateExpenseReportStatus(
                'rep-01',
                'SUBMITTED',
                'ACTUALIZAR',
                'tenant-atacama'
            );
            expect(statusRes.queuedOffline).toBe(true);

            const linkRes = await supplyApi.linkAssetToOpermaq(
                'asset-01',
                'ACTUALIZAR',
                'tenant-atacama'
            );
            expect(linkRes.queuedOffline).toBe(true);

            const recRes = await supplyApi.confirmPurchaseReception(
                'pur-01',
                [{ purchaseLineId: 'l1', qtyReceivedNow: 2 }],
                'ACTUALIZAR',
                'tenant-atacama'
            );
            expect(recRes.queuedOffline).toBe(true);

            const reqRes = await supplyApi.createRequisition(
                {
                    siteId: 'site-1',
                    costCenter: 'CC-CAMP',
                    lines: [
                        {
                            rawDescription: 'Agua 20L',
                            categoryCode: 'AGUA_POTABLE',
                            unitSi: 'L',
                            qtyRequested: 20,
                        },
                    ],
                },
                'tenant-atacama'
            );
            expect(reqRes.queuedOffline).toBe(true);

            const queuedEventNames = Array.from(mockState.tasks.values()).map(
                (t) => t.payload?.eventName
            );
            expect(queuedEventNames).toEqual(
                expect.arrayContaining([
                    'supply:sii-expense-report-synced',
                    'supply:sii-expense-report-status-synced',
                    'supply:opermaq-link-synced',
                    'supply:reception-synced',
                    'supply:requisition-synced',
                ])
            );
        } finally {
            window.removeEventListener('supply:purchase-synced', onPurchaseSynced);
            mockState.tasks.clear();
            Object.defineProperty(window.navigator, 'onLine', {
                configurable: true,
                value: true,
            });
            await syncQueueEngine.triggerReconnectSync();
        }
    });

    it('3. Subida de media supply CAS usa ruta tenants/{tenantId}/supply/cas/ (jamás stockpiles/cas/)', async () => {
        const sha = 'a'.repeat(64);
        mockState.casBlobs.set(sha, {
            sha256: sha,
            blob: new Blob(['<DTE><Documento/></DTE>'], { type: 'application/xml' }),
            mimeType: 'application/xml',
            profile: 'XML_DTE_DOCUMENT',
            scope: 'TENANT_PRIVATE',
            tenantId: 'tenant-norte',
            filename: 'dte-33-900.xml',
            originalBytes: 24,
            optimizedBytes: 24,
            updatedAt: Date.now(),
        });

        mockState.tasks.set('task-cas-supply', {
            id: 'task-cas-supply',
            type: 'CAS_MEDIA_UPLOAD',
            payload: {
                sha256: sha,
                module: 'supply',
                scope: 'TENANT_PRIVATE',
                profile: 'XML_DTE_DOCUMENT',
                tenantId: 'tenant-norte',
                filename: 'dte-33-900.xml',
            },
            timestamp: '2026-11-22T01:02:00.000Z',
            attempts: 0,
            status: 'PENDING',
        });

        // Simular caída temporal del endpoint /api/media/digest-upload para ejercitar el fallback Storage
        mockState.coreAuthFetch.mockRejectedValueOnce(new Error('EDGE_UPLOAD_UNAVAILABLE'));
        mockState.uploadBytes.mockResolvedValueOnce({ metadata: {} });
        mockState.getDownloadURL.mockResolvedValueOnce(
            `https://storage.googleapis.com/minreport/tenants/tenant-norte/supply/cas/${sha}.xml`
        );

        await syncQueueEngine.flushQueue();

        expect(mockState.storageRef).toHaveBeenCalledTimes(1);
        const uploadedPath = mockState.storageRef.mock.calls[0][1] as string;
        expect(uploadedPath).toBe(`tenants/tenant-norte/supply/cas/${sha}.xml`);
        expect(uploadedPath).not.toContain('stockpiles/cas/');
        expect(mockState.tasks.has('task-cas-supply')).toBe(false);
    });

    it('4. i18n carga supply.* en es/en/pt al arranque, paridad 1:1, cero PILHAS y formatMoney formatea CLP/USD/PEN/BRL', async () => {
        // Llaves supply disponibles de inmediato en los 3 idiomas
        expect(i18n.getFixedT('es')('supply.module_title')).toBe('MINREPORT · ABASTECIMIENTO');
        expect(i18n.getFixedT('en')('supply.module_title')).toBe('MINREPORT · SUPPLY');
        expect(i18n.getFixedT('pt')('supply.module_title')).toBe('MINREPORT · SUPRIMENTOS');

        expect(i18n.getFixedT('en')('supply.origins.MODULE_STOCKPILE')).toBe('ACOPIOS Module');
        expect(i18n.getFixedT('pt')('supply.origins.MODULE_STOCKPILE')).toBe('Módulo ACOPIOS');

        // Presets del simulador traducidos en en y pt (sin fuga en español)
        expect(i18n.getFixedT('en')('supply.backlog.sim_preset_slots_msg')).toContain('Butter');
        expect(i18n.getFixedT('pt')('supply.backlog.sim_preset_slots_msg')).toContain('Manteiga');

        // Paridad estricta 1:1 de llaves entre es, en y pt
        const esKeys = flattenKeys(esSupply as Record<string, unknown>);
        const enKeys = flattenKeys(enSupply as Record<string, unknown>);
        const ptKeys = flattenKeys(ptSupply as Record<string, unknown>);
        expect(enKeys).toEqual(esKeys);
        expect(ptKeys).toEqual(esKeys);

        // Cero menciones a la marca legada PILHAS
        expect(JSON.stringify(esSupply)).not.toMatch(/PILHAS/i);
        expect(JSON.stringify(enSupply)).not.toMatch(/PILHAS/i);
        expect(JSON.stringify(ptSupply)).not.toMatch(/PILHAS/i);

        // Formateador dinámico ISO 4217 + retrocompatibilidad formatClp
        const clp = formatMoney(119000, 'CLP', 'es-CL');
        const usd = formatMoney(1250.5, 'USD', 'en-US');
        const pen = formatMoney(480.75, 'PEN', 'es-PE');
        const brl = formatMoney(3200.5, 'BRL', 'pt-BR');

        expect(clp).toContain('119.000');
        expect(formatClp(119000)).toBe(clp);
        expect(usd).toContain('1,250.50');
        expect(usd).toContain('$');
        expect(pen).toMatch(/S\/.*480\.75/);
        expect(brl).toMatch(/R\$.*3\.200,50/);
        expect(formatMoney(null, 'USD')).toBe('—');
    });
});
