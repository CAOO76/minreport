import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import esSupply from '../locales/es.json';
import { ReceiptScannerModal } from '../components/ReceiptScannerModal';
import { supplyApi } from '../services/supplyApi';
import type { SupplyPurchaseDraft, SupplySite } from '../types';

// Traducción determinista sobre el diccionario real `es.json`
function lookupKey(obj: Record<string, any>, dotted: string): string {
    const parts = dotted.split('.');
    let cur: any = obj;
    for (const p of parts) {
        if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
        else return dotted;
    }
    return typeof cur === 'string' ? cur : dotted;
}

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => {
            const resolved = lookupKey(esSupply as Record<string, any>, key);
            return resolved !== key ? resolved : fallback || key;
        },
        i18n: { language: 'es' },
    }),
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false },
}));

vi.mock('@capacitor/camera', () => ({
    Camera: { getPhoto: vi.fn() },
    CameraResultType: { DataUrl: 'dataUrl' },
    CameraSource: { Camera: 'CAMERA' },
}));

const SITES: SupplySite[] = [
    {
        siteId: 'site-norte-01',
        tenantId: 'tenant-e12',
        name: 'Faena Norte 01',
        currentHeadcount: 30,
        waterStorageCapacityL: 30000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 7,
    },
];

describe('ReceiptScannerModal — E12 HITL 1-a-1 IA, Reset Estado, Bloqueo Inválido & CAS XML', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('1. Panel diff 1-a-1 [Actual] ➔ [Sugerido]: OCR IA NO sobrescribe TED/XML ni aplica valores hasta aprobación 1-a-1', async () => {
        const analyzeSpy = vi.spyOn(supplyApi, 'analyzeReceipt').mockResolvedValue({
            siteId: 'site-norte-01',
            purchaseMode: 'REQUISITION_FULFILLMENT',
            supplierTaxId: '11.111.111-1', // Intenta sobrescribir el RUT determinístico del TED!
            supplierName: 'Comercial OCR Sugerida SpA',
            documentType: 33,
            folio: '9999', // Intenta sobrescribir folio determinístico del TED!
            issueDate: '2026-11-20',
            netAmountClp: 100000,
            vatAmountClp: 19000,
            totalAmountClp: 119000,
            paymentMethod: 'FONDO_POR_RENDIR',
            source: 'OCR_GEMINI',
            lines: [
                {
                    lineId: 'ai_l1',
                    rawDescription: 'Arroz Grano Largo 25kg',
                    categoryCode: 'VIVERES_ALIMENTACION',
                    qty: 2,
                    unitSi: 'kg',
                    unitPriceClp: 59500,
                    subtotalClp: 119000,
                    destination: 'STOCK_IN_TRANSIT',
                },
            ],
        });

        render(
            <ReceiptScannerModal
                open={true}
                tenantId="tenant-e12"
                sites={SITES}
                defaultSiteId="site-norte-01"
                isOnline={true}
                onClose={vi.fn()}
                onSendToReconciler={vi.fn()}
                onCommitted={vi.fn()}
            />
        );

        // Inyectar timbre determinístico TED antes de analizar con IA (bloquea RUT y Folio)
        fireEvent.click(screen.getByRole('button', { name: /Leer timbre SII de la factura/i }));
        const tedTextarea = screen.getByRole('textbox', { name: /Leer timbre SII de la factura/i });
        fireEvent.change(tedTextarea, {
            target: {
                value: '<TED><DD><RE>76123456-0</RE><TD>33</TD><F>4501</F><FE>2026-11-18</FE><MNT>119000</MNT></DD></TED>',
            },
        });

        const rutInput = screen.getByLabelText(/RUT del proveedor/i) as HTMLInputElement;
        const folioInput = screen.getByLabelText(/Número de folio/i) as HTMLInputElement;
        const supplierInput = screen.getByLabelText(/Nombre del proveedor/i) as HTMLInputElement;

        expect(rutInput.value).toBe('76.123.456-0');
        expect(folioInput.value).toBe('4501');
        expect(supplierInput.value).toBe('');

        // Disparar análisis IA OCR
        fireEvent.click(screen.getByRole('button', { name: /Leer documento con ayuda IA/i }));
        await waitFor(() => expect(analyzeSpy).toHaveBeenCalledTimes(1));

        // Verificar que OCR IA NO sobrescribió ningún campo automáticamente
        expect(rutInput.value).toBe('76.123.456-0');
        expect(folioInput.value).toBe('4501');
        expect(supplierInput.value).toBe('');

        // Panel diff 1-a-1 visible; RUT y Folio protegidos por TED (sin botón aceptar)
        expect(screen.getByTestId('ai-hitl-proposals-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('ai-accept-header-supplierTaxId')).not.toBeInTheDocument();
        expect(screen.queryByTestId('ai-accept-header-folio')).not.toBeInTheDocument();
        expect(screen.getByTestId('ai-proposal-header-supplierTaxId')).toHaveTextContent(
            'Dato oficial del SII'
        );

        // Mientras haya propuestas PENDING, el submit permanece bloqueado
        const commitBtn = screen.getByRole('button', { name: /Guardar compra/i });
        expect(commitBtn).toBeDisabled();

        // Aceptar Razón Social (1-a-1) y Descartar Fecha si difiere; aceptar línea SKU #1
        fireEvent.click(screen.getByTestId('ai-accept-header-supplierName'));
        expect(supplierInput.value).toBe('Comercial OCR Sugerida SpA');

        const rejectDateBtn = screen.queryByTestId('ai-reject-header-issueDate');
        if (rejectDateBtn) fireEvent.click(rejectDateBtn);

        fireEvent.click(screen.getByTestId('ai-accept-line-0'));

        // Verificar que fecha NO se aplicó al ser descartada y RUT/Folio TED permanecen intactos
        expect(rutInput.value).toBe('76.123.456-0');
        expect(folioInput.value).toBe('4501');
        expect((screen.getByLabelText(/Fecha de emisión/i) as HTMLInputElement).value).toBe('2026-11-18');
        expect(commitBtn).not.toBeDisabled();
    });

    it('2. Reset total de estado entre 2 escaneos consecutivos (0 fugas al cerrar y reabrir)', () => {
        const { rerender } = render(
            <ReceiptScannerModal
                open={true}
                tenantId="tenant-e12"
                sites={SITES}
                defaultSiteId="site-norte-01"
                isOnline={true}
                onClose={vi.fn()}
                onSendToReconciler={vi.fn()}
                onCommitted={vi.fn()}
            />
        );

        const rutInput = screen.getByLabelText(/RUT del proveedor/i) as HTMLInputElement;
        const supplierInput = screen.getByLabelText(/Nombre del proveedor/i) as HTMLInputElement;
        const folioInput = screen.getByLabelText(/Número de folio/i) as HTMLInputElement;

        fireEvent.change(rutInput, { target: { value: '76.123.456-0' } });
        fireEvent.change(supplierInput, { target: { value: 'Proveedor Escaneo 1' } });
        fireEvent.change(folioInput, { target: { value: '8877' } });

        expect(supplierInput.value).toBe('Proveedor Escaneo 1');
        expect(folioInput.value).toBe('8877');

        // Cerrar y reabrir modal -> 100% limpio
        rerender(
            <ReceiptScannerModal
                open={false}
                tenantId="tenant-e12"
                sites={SITES}
                defaultSiteId="site-norte-01"
                isOnline={true}
                onClose={vi.fn()}
                onSendToReconciler={vi.fn()}
                onCommitted={vi.fn()}
            />
        );
        rerender(
            <ReceiptScannerModal
                open={true}
                tenantId="tenant-e12"
                sites={SITES}
                defaultSiteId="site-norte-01"
                isOnline={true}
                onClose={vi.fn()}
                onSendToReconciler={vi.fn()}
                onCommitted={vi.fn()}
            />
        );

        expect((screen.getByLabelText(/RUT del proveedor/i) as HTMLInputElement).value).toBe('');
        expect((screen.getByLabelText(/Nombre del proveedor/i) as HTMLInputElement).value).toBe('');
        expect((screen.getByLabelText(/Número de folio/i) as HTMLInputElement).value).toBe('');
        expect((screen.getByLabelText(/^Total pagado$/i) as HTMLInputElement).value).toBe('0');
    });

    it('3. Bloquea submit con RUT inválido, razón social vacía/not_declared, folio=0, descuadre o 0 líneas y nunca persiste not_declared', () => {
        const onSendToReconciler = vi.fn<(draft: SupplyPurchaseDraft) => void>();

        render(
            <ReceiptScannerModal
                open={true}
                tenantId="tenant-e12"
                sites={SITES}
                defaultSiteId="site-norte-01"
                isOnline={true}
                onClose={vi.fn()}
                onSendToReconciler={onSendToReconciler}
                onCommitted={vi.fn()}
            />
        );

        const commitBtn = screen.getByRole('button', { name: /Guardar compra/i });
        const reconcileBtn = screen.getByRole('button', { name: /Cuadrar con pedidos pendientes/i });
        const rutInput = screen.getByLabelText(/RUT del proveedor/i);
        const supplierInput = screen.getByLabelText(/Nombre del proveedor/i);
        const dteSelect = screen.getByLabelText(/Tipo de documento/i);
        const folioInput = screen.getByLabelText(/Número de folio/i);
        const totalInput = screen.getByLabelText(/^Total pagado$/i);
        const lineDescInput = screen.getByLabelText(/Qué se necesita #1/i);
        const linePriceInput = screen.getByLabelText(/Total pagado #1/i);

        // Estado inicial vacío -> ambos botones bloqueados
        expect(commitBtn).toBeDisabled();
        expect(reconcileBtn).toBeDisabled();

        // RUT inválido -> bloqueado
        fireEvent.change(rutInput, { target: { value: '76.123.456-9' } });
        fireEvent.change(supplierInput, { target: { value: 'Distribuidora Atacama SpA' } });
        fireEvent.change(dteSelect, { target: { value: '33' } });
        fireEvent.change(folioInput, { target: { value: '100' } });
        fireEvent.change(lineDescInput, { target: { value: 'Agua 20L' } });
        fireEvent.change(linePriceInput, { target: { value: '10000' } });
        fireEvent.change(totalInput, { target: { value: '10000' } });
        expect(commitBtn).toBeDisabled();

        // Corregir RUT válido pero colocar folio = '0' en DTE 33 -> bloqueado
        fireEvent.change(rutInput, { target: { value: '76.123.456-0' } });
        fireEvent.change(folioInput, { target: { value: '0' } });
        expect(commitBtn).toBeDisabled();

        // Corregir folio = '105' pero crear descuadre aritmético -> bloqueado
        fireEvent.change(folioInput, { target: { value: '105' } });
        fireEvent.change(totalInput, { target: { value: '15000' } });
        expect(commitBtn).toBeDisabled();

        // Corregir total = '10000' pero dejar supplierName igual a not_declared -> bloqueado
        fireEvent.change(totalInput, { target: { value: '10000' } });
        fireEvent.change(supplierInput, {
            target: { value: '[Información técnica no declarada en ficha]' },
        });
        expect(commitBtn).toBeDisabled();
        expect(reconcileBtn).toBeDisabled();

        // Corregir razón social válida -> desbloqueado y envía draft sin not_declared
        fireEvent.change(supplierInput, { target: { value: 'Distribuidora Atacama SpA' } });
        expect(commitBtn).not.toBeDisabled();
        expect(reconcileBtn).not.toBeDisabled();

        fireEvent.click(reconcileBtn);
        expect(onSendToReconciler).toHaveBeenCalledTimes(1);
        const sentDraft = onSendToReconciler.mock.calls[0][0];
        expect(sentDraft.supplierName).toBe('Distribuidora Atacama SpA');
        expect(sentDraft.supplierName).not.toContain('no declarada');
        expect(sentDraft.folio).toBe('105');
        expect(sentDraft.lines).toHaveLength(1);
    });

    it('4. Carga de archivo .xml ejecuta ingesta CAS con perfil XML_DTE_DOCUMENT y muestra telemetría ORIG ➔ CAS', async () => {
        const digestSpy = vi.spyOn(supplyApi, 'digestEvidence').mockResolvedValue({
            sha256: 'b'.repeat(64),
            downloadUrl: `/api/media/blob/${'b'.repeat(64)}`,
            storagePath: `cas_blobs/tenants/tenant-e12/${'b'.repeat(64)}.xml`,
            mimeType: 'application/xml',
            extension: 'xml',
            originalFilename: 'dte-33-4501.xml',
            originalBytes: 4096,
            optimizedBytes: 1024,
            savingsRatio: 0.75,
            savingsPct: 75.0,
            deduplicatedHit: false,
        });

        render(
            <ReceiptScannerModal
                open={true}
                tenantId="tenant-e12"
                sites={SITES}
                defaultSiteId="site-norte-01"
                isOnline={true}
                onClose={vi.fn()}
                onSendToReconciler={vi.fn()}
                onCommitted={vi.fn()}
            />
        );

        const xmlPayload =
            '<?xml version="1.0" encoding="UTF-8"?><DTE><Documento><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>7744</Folio><FchEmis>2026-11-19</FchEmis></IdDoc><Emisor><RUTEmisor>76123456-0</RUTEmisor><RznSoc>Proveedor XML SpA</RznSoc></Emisor><Totales><MntTotal>119000</MntTotal></Totales></Encabezado></Documento></DTE>';
        const xmlFile = new File([xmlPayload], 'dte-33-4501.xml', { type: 'application/xml' });

        const fileInput = screen.getByTestId('receipt-file-input');
        fireEvent.change(fileInput, { target: { files: [xmlFile] } });

        await waitFor(() =>
            expect(digestSpy).toHaveBeenCalledWith(
                xmlFile,
                expect.objectContaining({
                    profile: 'XML_DTE_DOCUMENT',
                    tenantId: 'tenant-e12',
                    filename: 'dte-33-4501.xml',
                })
            )
        );

        const telemetryBar = await screen.findByTestId('cas-telemetry-bar');
        expect(telemetryBar).toHaveTextContent('ORIG: 4.0 KB ➔ CAS: 1.0 KB (-75.0%)');
        expect(telemetryBar).toHaveTextContent(`SHA-256 ${'b'.repeat(12)}`);
        expect((screen.getByLabelText(/Nombre del proveedor/i) as HTMLInputElement).value).toBe(
            'Proveedor XML SpA'
        );
        expect((screen.getByLabelText(/Número de folio/i) as HTMLInputElement).value).toBe('7744');
    });
});
