import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import SecureImage from '../../../components/common/SecureImage';
import CopyButton from '../../../components/common/CopyButton';
import HitlConfirmModal, { type HitlComparisonDiffItem } from '../../../components/common/HitlConfirmModal';
import { cn } from '../../../utils/cn';
import { formatRut, validateRut } from '../../../utils/rut';
import { supplyApi } from '../services/supplyApi';
import {
    PAYMENT_METHODS,
    SII_DTE_TYPES,
    SUPPLY_CATEGORIES,
    SUPPLY_UNITS_SI,
    formatCasTelemetry,
    formatClp,
    parseLocalTedOrDteXml,
    type CasEvidenceRef,
    type FulfillmentAllocationDraft,
    type PaymentMethod,
    type ProcurementBucket,
    type PurchaseLineDestination,
    type PurchaseMode,
    type SiiDteType,
    type SupplyCategoryCode,
    type SupplyPurchaseDraft,
    type SupplyPurchaseLineDraft,
    type SupplySite,
    type SupplyUnitSi,
} from '../types';

export interface ReceiptScannerModalProps {
    open: boolean;
    tenantId?: string;
    sites: SupplySite[];
    defaultSiteId?: string;
    defaultBucket?: ProcurementBucket | null;
    isExecOwner?: boolean;
    isOnline: boolean;
    onClose: () => void;
    onSendToReconciler: (draft: SupplyPurchaseDraft) => void;
    onCommitted: (queuedOffline: boolean) => void;
}

interface BarcodeDetectorLike {
    detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
}

function dataUrlToBlob(dataUrl: string): Blob {
    const [header, body] = dataUrl.split(',');
    const mimeMatch = header?.match(/data:([^;]+);base64/i);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binStr = atob(body || '');
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
        bytes[i] = binStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
}

function createEmptyLine(
    defaultDestination: PurchaseLineDestination,
    defaultCategory: SupplyCategoryCode = 'OTROS_OPERACIONAL'
): SupplyPurchaseLineDraft {
    return {
        lineId: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        rawDescription: '',
        categoryCode: defaultCategory,
        qty: 1,
        unitSi: 'un',
        unitPriceClp: 0,
        subtotalClp: 0,
        destination: defaultDestination,
    };
}

function mapBucketToCategory(bucket?: ProcurementBucket | null): SupplyCategoryCode {
    switch (bucket) {
        case 'VERDULERIA':
        case 'SUPERMERCADO':
            return 'VIVERES_ALIMENTACION';
        case 'FERRETERIA':
            return 'FERRETERIA_CONSTRUCCION';
        case 'REPUESTOS_OPERMAQ':
            return 'REPUESTOS_MAQUINARIA';
        case 'EPP_SEGURIDAD':
            return 'EPP_SEGURIDAD';
        case 'GAS_AGUA_COMBUSTIBLE':
            return 'GAS_ENERGIA_CAMP';
        case 'MANTENCION_EQUIPAMIENTO':
            return 'MANTENCION_CAMP';
        default:
            return 'OTROS_OPERACIONAL';
    }
}

export const ReceiptScannerModal: React.FC<ReceiptScannerModalProps> = ({
    open,
    tenantId,
    sites,
    defaultSiteId,
    defaultBucket,
    isExecOwner = false,
    isOnline,
    onClose,
    onSendToReconciler,
    onCommitted,
}) => {
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const cameraInputRef = useRef<HTMLInputElement | null>(null);

    const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
    const [siteId, setSiteId] = useState<string>(defaultSiteId || sites[0]?.siteId || 'site-main');
    const [purchaseMode, setPurchaseMode] = useState<PurchaseMode>(
        isExecOwner ? 'DIRECT_AUTONOMOUS' : 'REQUISITION_FULFILLMENT'
    );
    const [defaultDestination, setDefaultDestination] = useState<PurchaseLineDestination>(
        isExecOwner ? 'STOCK_IN_WAREHOUSE' : 'STOCK_IN_TRANSIT'
    );
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
        isExecOwner ? 'REEMBOLSO_GERENCIA' : 'FONDO_POR_RENDIR'
    );

    const [supplierTaxId, setSupplierTaxId] = useState('');
    const [supplierName, setSupplierName] = useState('');
    const [documentType, setDocumentType] = useState<SiiDteType>(39);
    const [folio, setFolio] = useState('');
    const [issueDate, setIssueDate] = useState(todayIso);
    const [netAmountClp, setNetAmountClp] = useState<number>(0);
    const [vatAmountClp, setVatAmountClp] = useState<number>(0);
    const [totalAmountClp, setTotalAmountClp] = useState<number>(0);
    const [tedRawXml, setTedRawXml] = useState('');
    const [xmlDteRaw, setXmlDteRaw] = useState('');

    const [evidenceCasRef, setEvidenceCasRef] = useState<CasEvidenceRef | undefined>(undefined);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [lines, setLines] = useState<SupplyPurchaseLineDraft[]>([
        createEmptyLine(
            isExecOwner ? 'STOCK_IN_WAREHOUSE' : 'STOCK_IN_TRANSIT',
            mapBucketToCategory(defaultBucket)
        ),
    ]);

    const [digesting, setDigesting] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [showTedInput, setShowTedInput] = useState(false);
    const [hitlOpen, setHitlOpen] = useState(false);
    const [statusNotice, setStatusNotice] = useState<{ tone: 'copper' | 'cyan'; text: string } | null>(null);

    useEffect(() => {
        if (!open) return;
        setSiteId(defaultSiteId || sites[0]?.siteId || 'site-main');
        setPurchaseMode(isExecOwner ? 'DIRECT_AUTONOMOUS' : 'REQUISITION_FULFILLMENT');
        setDefaultDestination(isExecOwner ? 'STOCK_IN_WAREHOUSE' : 'STOCK_IN_TRANSIT');
        setPaymentMethod(isExecOwner ? 'REEMBOLSO_GERENCIA' : 'FONDO_POR_RENDIR');
        setStatusNotice(null);
        setLines([
            createEmptyLine(
                isExecOwner ? 'STOCK_IN_WAREHOUSE' : 'STOCK_IN_TRANSIT',
                mapBucketToCategory(defaultBucket)
            ),
        ]);
    }, [open, defaultSiteId, sites, isExecOwner, defaultBucket]);

    useEffect(() => {
        return () => {
            if (previewUrl && previewUrl.startsWith('blob:')) {
                URL.revokeObjectURL(previewUrl);
            }
        };
    }, [previewUrl]);

    const linesSumClp = useMemo(
        () => lines.reduce((acc, l) => acc + (Number.isFinite(l.subtotalClp) ? l.subtotalClp : 0), 0),
        [lines]
    );

    const arithmeticDelta = useMemo(() => {
        if (totalAmountClp <= 0 && linesSumClp <= 0) return 0;
        return Math.round(linesSumClp - totalAmountClp);
    }, [linesSumClp, totalAmountClp]);

    const hasArithmeticMismatch = useMemo(
        () => (totalAmountClp > 0 || linesSumClp > 0) && Math.abs(arithmeticDelta) > 2,
        [arithmeticDelta, totalAmountClp, linesSumClp]
    );

    const hasAssetWithoutInvoice = useMemo(
        () =>
            lines.some((l) => l.destination === 'CAPEX_ASSET') &&
            documentType !== 33 &&
            documentType !== 34,
        [lines, documentType]
    );

    const rutValidationState = useMemo(() => {
        const trimmed = supplierTaxId.trim();
        if (!trimmed) return 'EMPTY';
        return validateRut(trimmed) ? 'VALID' : 'INVALID';
    }, [supplierTaxId]);

    const applyParsedTedHeader = useCallback((rawXml: string) => {
        const parsed = parseLocalTedOrDteXml(rawXml);
        if (!parsed) return;
        if (parsed.supplierTaxId) setSupplierTaxId(formatRut(parsed.supplierTaxId));
        if (parsed.supplierName) setSupplierName(parsed.supplierName);
        if (parsed.documentType !== undefined) setDocumentType(parsed.documentType);
        if (parsed.folio) setFolio(parsed.folio);
        if (parsed.issueDate) setIssueDate(parsed.issueDate.slice(0, 10));
        if (typeof parsed.totalAmountClp === 'number') {
            setTotalAmountClp(parsed.totalAmountClp);
            const isTaxed = parsed.documentType === 33 || parsed.documentType === 39;
            if (isTaxed) {
                const net = Math.round(parsed.totalAmountClp / 1.19);
                setNetAmountClp(net);
                setVatAmountClp(parsed.totalAmountClp - net);
            } else {
                setNetAmountClp(parsed.totalAmountClp);
                setVatAmountClp(0);
            }
        }
        if (parsed.firstItem) {
            setLines((prev) => {
                if (prev.length === 1 && !prev[0].rawDescription.trim()) {
                    return [
                        {
                            ...prev[0],
                            rawDescription: parsed.firstItem || '',
                            unitPriceClp: parsed.totalAmountClp || prev[0].unitPriceClp,
                            subtotalClp: parsed.totalAmountClp || prev[0].subtotalClp,
                        },
                    ];
                }
                return prev;
            });
        }
    }, []);

    const tryDetectPdf417FromBlob = useCallback(
        async (blob: Blob) => {
            if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return;
            try {
                const DetectorCtor = (window as unknown as {
                    BarcodeDetector: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
                }).BarcodeDetector;
                const detector = new DetectorCtor({ formats: ['pdf417'] });
                const bitmap = await createImageBitmap(blob);
                try {
                    const codes = await detector.detect(bitmap);
                    const raw = codes.find((c) => c.rawValue && c.rawValue.includes('<TED'))?.rawValue || codes[0]?.rawValue;
                    if (raw) {
                        setTedRawXml(raw);
                        setShowTedInput(true);
                        applyParsedTedHeader(raw);
                    }
                } finally {
                    bitmap.close();
                }
            } catch {
                // Silent fallback if browser does not support PDF417 decoding
            }
        },
        [applyParsedTedHeader]
    );

    const handleFileIngest = useCallback(
        async (file: File | Blob, filename?: string) => {
            const name = filename || (file instanceof File ? file.name : 'receipt.jpg');
            const lowerName = name.toLowerCase();
            const isXml = lowerName.endsWith('.xml') || file.type.includes('xml');

            setStatusNotice(null);

            if (isXml) {
                const xmlText = await file.text();
                setXmlDteRaw(xmlText);
                setTedRawXml(xmlText);
                setShowTedInput(true);
                applyParsedTedHeader(xmlText);
                return;
            }

            setDigesting(true);
            try {
                const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(lowerName);
                if (isImage) {
                    void tryDetectPdf417FromBlob(file);
                    const nextLocalPreview = URL.createObjectURL(file);
                    setPreviewUrl((prev) => {
                        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
                        return nextLocalPreview;
                    });
                }

                const casRef = await supplyApi.digestReceiptMedia(file, {
                    tenantId,
                    filename: name,
                });
                setEvidenceCasRef(casRef);
            } catch (err) {
                setStatusNotice({
                    tone: 'copper',
                    text: err instanceof Error ? err.message : 'CAS_DIGEST_ERROR',
                });
            } finally {
                setDigesting(false);
            }
        },
        [applyParsedTedHeader, tenantId, tryDetectPdf417FromBlob]
    );

    const handleNativeCameraCapture = async () => {
        if (Capacitor.isNativePlatform()) {
            try {
                const photo = await Camera.getPhoto({
                    quality: 85,
                    allowEditing: false,
                    resultType: CameraResultType.DataUrl,
                    source: CameraSource.Camera,
                });
                if (photo.dataUrl) {
                    const blob = dataUrlToBlob(photo.dataUrl);
                    await handleFileIngest(blob, `dte_${Date.now()}.jpg`);
                }
            } catch {
                // User cancelled capture
            }
            return;
        }
        cameraInputRef.current?.click();
    };

    const handleTriggerPdf417Input = () => {
        setShowTedInput((prev) => !prev);
        if (typeof window !== 'undefined' && !('BarcodeDetector' in window)) {
            setStatusNotice({
                tone: 'copper',
                text: t('supply.scanner.barcode_unsupported'),
            });
        }
    };

    const handleAnalyzeDocument = async () => {
        if (!isOnline) {
            setStatusNotice({
                tone: 'copper',
                text: t('supply.scanner.offline_queued_notice'),
            });
            return;
        }

        setAnalyzing(true);
        setStatusNotice(null);
        try {
            const draft = await supplyApi.analyzeReceipt(
                {
                    siteId,
                    purchaseMode,
                    evidenceCasRef,
                    clientOriginalBytes: evidenceCasRef?.originalBytes,
                    tedRawXml: tedRawXml.trim() || undefined,
                    xmlDteRaw: xmlDteRaw.trim() || undefined,
                },
                tenantId
            );

            if (draft.supplierTaxId) setSupplierTaxId(formatRut(draft.supplierTaxId));
            if (draft.supplierName) setSupplierName(draft.supplierName);
            if (draft.documentType !== undefined) setDocumentType(draft.documentType);
            if (draft.folio) setFolio(draft.folio);
            if (draft.issueDate) setIssueDate(draft.issueDate.slice(0, 10));
            if (typeof draft.netAmountClp === 'number') setNetAmountClp(draft.netAmountClp);
            if (typeof draft.vatAmountClp === 'number') setVatAmountClp(draft.vatAmountClp);
            if (typeof draft.totalAmountClp === 'number') setTotalAmountClp(draft.totalAmountClp);
            if (draft.evidenceCasRef) setEvidenceCasRef(draft.evidenceCasRef);
            if (Array.isArray(draft.lines) && draft.lines.length > 0) {
                setLines(
                    draft.lines.map((l) => ({
                        ...l,
                        lineId: l.lineId || `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        destination: l.destination || defaultDestination,
                    }))
                );
            }
            setStatusNotice({
                tone: draft.arithmeticMismatch ? 'copper' : 'cyan',
                text: draft.arithmeticMismatch
                    ? t('supply.scanner.arithmetic_mismatch')
                    : t('supply.scanner.arithmetic_ok'),
            });
        } catch (err) {
            setStatusNotice({
                tone: 'copper',
                text: err instanceof Error ? err.message : 'ANALYZE_ERROR',
            });
        } finally {
            setAnalyzing(false);
        }
    };

    const buildCurrentDraft = (): SupplyPurchaseDraft => ({
        siteId,
        purchaseMode,
        supplierTaxId: supplierTaxId.trim(),
        supplierName: supplierName.trim() || t('supply.common.not_declared'),
        documentType,
        folio: folio.trim(),
        issueDate,
        netAmountClp,
        vatAmountClp,
        totalAmountClp: totalAmountClp || linesSumClp,
        paymentMethod,
        evidenceCasRef,
        tedRawXml: tedRawXml.trim() || undefined,
        arithmeticMismatch: hasArithmeticMismatch,
        arithmeticDeltaClp: arithmeticDelta,
        lines: lines.filter((l) => l.rawDescription.trim().length > 0 || l.subtotalClp > 0),
    });

    const handleDirectHitlCommit = async () => {
        const draft = buildCurrentDraft();
        const allocations: FulfillmentAllocationDraft[] = draft.lines.map((l) => ({
            purchaseLineId: l.lineId,
            requisitionId: l.matchedReqId || null,
            requisitionLineId: l.matchedReqLineId || null,
            allocationType: l.matchedReqLineId ? 'REQUISITION_MATCH' : 'UNSOLICITED_PURCHASE',
            allocatedQty: l.qty,
            destination: l.destination,
            resultingStatus: l.destination === 'CAPEX_ASSET' ? 'CAPEX_ASSET' : 'STOCK',
        }));

        setCommitting(true);
        try {
            const res = await supplyApi.commitPurchase(
                {
                    draft,
                    allocations,
                    confirmationKeyword: 'ACTUALIZAR',
                },
                tenantId
            );
            setHitlOpen(false);
            onCommitted(Boolean(res.queuedOffline));
            onClose();
        } catch (err) {
            setHitlOpen(false);
            setStatusNotice({
                tone: 'copper',
                text: err instanceof Error ? err.message : 'COMMIT_ERROR',
            });
        } finally {
            setCommitting(false);
        }
    };

    const updateLine = (lineId: string, patch: Partial<SupplyPurchaseLineDraft>) => {
        setLines((prev) =>
            prev.map((l) => {
                if (l.lineId !== lineId) return l;
                const next = { ...l, ...patch };
                if ('qty' in patch || 'unitPriceClp' in patch) {
                    next.subtotalClp = Math.round((Number(next.qty) || 0) * (Number(next.unitPriceClp) || 0));
                }
                return next;
            })
        );
    };

    const casTelemetryLine = useMemo(() => formatCasTelemetry(evidenceCasRef), [evidenceCasRef]);

    const hitlDiff = useMemo<HitlComparisonDiffItem[]>(() => {
        const draft = buildCurrentDraft();
        const items: HitlComparisonDiffItem[] = [
            {
                field: t('supply.scanner.mode_label'),
                current: 'DRAFT',
                suggested: `${t(`supply.purchase_modes.${draft.purchaseMode}`)} · DTE ${draft.documentType} #${draft.folio || '—'}`,
            },
            {
                field: t('supply.scanner.total_clp'),
                current: formatClp(0),
                suggested: `${formatClp(draft.totalAmountClp)} (${draft.lines.length} SKU)`,
            },
        ];
        if (casTelemetryLine) {
            items.push({
                field: t('supply.scanner.cas_telemetry'),
                current: 'RAW',
                suggested: casTelemetryLine,
            });
        }
        return items;
    }, [
        casTelemetryLine,
        documentType,
        folio,
        lines,
        linesSumClp,
        paymentMethod,
        purchaseMode,
        siteId,
        supplierName,
        supplierTaxId,
        t,
        totalAmountClp,
    ]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-0 sm:p-fib-21 select-none overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-label={t('supply.scanner.title')}
        >
            <div className="w-full max-w-5xl max-h-[100dvh] sm:max-h-[92vh] flex flex-col bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none overflow-hidden">
                {/* Single 56px MBUX Zero-Layer Header */}
                <header className="h-[56px] shrink-0 px-fib-21 flex items-center justify-between gap-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C]">
                    <div className="flex items-center gap-fib-13 min-w-0">
                        <span className="material-symbols-outlined text-[22px] text-[#C68346]">
                            document_scanner
                        </span>
                        <h2 className="text-h2-section font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate uppercase">
                            {t('supply.scanner.title')}
                        </h2>
                        {isExecOwner && purchaseMode === 'DIRECT_AUTONOMOUS' && (
                            <span className="hidden sm:inline-block font-mono text-microcopy uppercase text-[#C68346] border-l border-[#E2E8F0] dark:border-[#12151C] pl-fib-13">
                                {t('supply.scanner.exec_direct_tag')}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-fib-8 shrink-0">
                        <button
                            type="button"
                            onClick={handleNativeCameraCapture}
                            aria-label={t('supply.scanner.capture_camera')}
                            title={t('supply.scanner.capture_camera')}
                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#C68346] hover:opacity-80 transition-colors cursor-pointer rounded-none shadow-none"
                        >
                            <span className="material-symbols-outlined text-[22px]">add_a_photo</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            aria-label={t('supply.scanner.upload_file')}
                            title={t('supply.scanner.upload_file')}
                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none"
                        >
                            <span className="material-symbols-outlined text-[22px]">upload_file</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleTriggerPdf417Input}
                            aria-label={t('supply.scanner.scan_pdf417')}
                            title={t('supply.scanner.scan_pdf417')}
                            className={cn(
                                'bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center transition-colors cursor-pointer rounded-none shadow-none',
                                showTedInput
                                    ? 'text-[#00AEEF]'
                                    : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            )}
                        >
                            <span className="material-symbols-outlined text-[22px]">barcode_scanner</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleAnalyzeDocument}
                            disabled={analyzing || digesting}
                            aria-label={t('supply.scanner.analyze_action')}
                            title={t('supply.scanner.analyze_action')}
                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#00AEEF] hover:opacity-80 transition-colors cursor-pointer rounded-none shadow-none disabled:opacity-40"
                        >
                            <span className="material-symbols-outlined text-[22px]">smart_toy</span>
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={t('supply.common.close')}
                            title={t('supply.common.close')}
                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none"
                        >
                            <span className="material-symbols-outlined text-[22px]">close</span>
                        </button>
                    </div>
                </header>

                {(digesting || analyzing) && (
                    <M3LinearProgress
                        indeterminate
                        ariaLabel={t('supply.scanner.analyzing')}
                    />
                )}

                <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    autoComplete="off"
                    spellCheck={false}
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleFileIngest(file);
                        e.target.value = '';
                    }}
                />
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf,.xml,text/xml"
                    autoComplete="off"
                    spellCheck={false}
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleFileIngest(file);
                        e.target.value = '';
                    }}
                />

                {/* Body */}
                <form
                    autoComplete="off"
                    spellCheck={false}
                    onSubmit={(e) => {
                        e.preventDefault();
                        setHitlOpen(true);
                    }}
                    className="flex-1 overflow-y-auto p-fib-21 space-y-fib-21"
                >
                    {/* CAS Telemetry & Shielded Media Preview */}
                    {(casTelemetryLine || previewUrl || statusNotice) && (
                        <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13 space-y-fib-13">
                            {statusNotice && (
                                <div
                                    className={cn(
                                        'border-l-[3px] pl-fib-13 py-fib-8 font-mono text-data-dense tabular-nums',
                                        statusNotice.tone === 'copper'
                                            ? 'border-[#C68346] text-[#C68346]'
                                            : 'border-[#00AEEF] text-[#00AEEF]'
                                    )}
                                >
                                    {statusNotice.text}
                                </div>
                            )}
                            {casTelemetryLine && (
                                <div className="flex flex-wrap items-center justify-between gap-fib-8 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] px-fib-13 py-fib-8 rounded-none shadow-none">
                                    <div className="flex items-center gap-fib-8 min-w-0 font-mono text-data-dense tabular-nums text-[#00AEEF]">
                                        <span className="material-symbols-outlined text-[18px]">verified</span>
                                        <span className="select-text truncate">{casTelemetryLine}</span>
                                    </div>
                                    {evidenceCasRef?.sha256 && (
                                        <div className="flex items-center gap-fib-8 font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                            <span className="select-text">
                                                SHA-256 {evidenceCasRef.sha256.slice(0, 12)}
                                            </span>
                                            <CopyButton value={evidenceCasRef.sha256} />
                                        </div>
                                    )}
                                </div>
                            )}
                            {previewUrl && (
                                <div className="max-h-44 overflow-hidden border border-[#E2E8F0] dark:border-[#12151C] bg-[#000000] flex items-center justify-center rounded-none shadow-none">
                                    <SecureImage
                                        src={previewUrl}
                                        alt={t('supply.scanner.title')}
                                        className="max-h-44 w-auto object-contain"
                                        loading="lazy"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Optional TED PDF417 / XML DTE input */}
                    {showTedInput && (
                        <div className="space-y-fib-8 border-l-[3px] border-[#00AEEF] pl-fib-13">
                            <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.scanner.scan_pdf417')}
                            </label>
                            <textarea
                                rows={3}
                                value={tedRawXml}
                                onChange={(e) => {
                                    setTedRawXml(e.target.value);
                                    applyParsedTedHeader(e.target.value);
                                }}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={t('supply.scanner.ted_placeholder')}
                                className="w-full p-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                            />
                        </div>
                    )}

                    {/* Operational Mode, Site, Destination & Payment */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-fib-13">
                        <div className="space-y-fib-8">
                            <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.scanner.mode_label')}
                            </label>
                            <select
                                value={purchaseMode}
                                onChange={(e) => setPurchaseMode(e.target.value as PurchaseMode)}
                                className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                            >
                                <option value="REQUISITION_FULFILLMENT">
                                    {t('supply.purchase_modes.REQUISITION_FULFILLMENT')}
                                </option>
                                <option value="DIRECT_AUTONOMOUS">
                                    {t('supply.purchase_modes.DIRECT_AUTONOMOUS')}
                                </option>
                                <option value="MIXED_FULFILLMENT_AND_DIRECT">
                                    {t('supply.purchase_modes.MIXED_FULFILLMENT_AND_DIRECT')}
                                </option>
                            </select>
                        </div>

                        <div className="space-y-fib-8">
                            <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.scanner.destination_label')}
                            </label>
                            <select
                                value={defaultDestination}
                                onChange={(e) => {
                                    const nextDest = e.target.value as PurchaseLineDestination;
                                    setDefaultDestination(nextDest);
                                    setLines((prev) =>
                                        prev.map((l) => ({ ...l, destination: nextDest }))
                                    );
                                }}
                                className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                            >
                                <option value="STOCK_IN_TRANSIT">
                                    {t('supply.destinations.STOCK_IN_TRANSIT')}
                                </option>
                                <option value="STOCK_IN_WAREHOUSE">
                                    {t('supply.destinations.STOCK_IN_WAREHOUSE')}
                                </option>
                                <option value="CAPEX_ASSET">
                                    {t('supply.destinations.CAPEX_ASSET')}
                                </option>
                                <option value="DIRECT_EXPENSE">
                                    {t('supply.destinations.DIRECT_EXPENSE')}
                                </option>
                            </select>
                        </div>

                        <div className="space-y-fib-8">
                            <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.scanner.payment_label')}
                            </label>
                            <select
                                value={paymentMethod}
                                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                                className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                            >
                                {PAYMENT_METHODS.map((pm) => (
                                    <option key={pm} value={pm}>
                                        {t(`supply.payments.${pm}`)}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-fib-8">
                            <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.common.site_selector')}
                            </label>
                            <select
                                value={siteId}
                                onChange={(e) => setSiteId(e.target.value)}
                                className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                            >
                                {sites.length > 0 ? (
                                    sites.map((s) => (
                                        <option key={s.siteId} value={s.siteId}>
                                            {s.name}
                                        </option>
                                    ))
                                ) : (
                                    <option value="site-main">FAENA-01</option>
                                )}
                            </select>
                        </div>
                    </div>

                    {/* SII Fiscal Header */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-13">
                        <div className="space-y-fib-8">
                            <div className="flex items-center justify-between">
                                <label className="font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('supply.scanner.supplier_rut')}
                                </label>
                                {rutValidationState === 'VALID' && (
                                    <span className="font-mono text-microcopy text-[#00AEEF]">
                                        {t('supply.scanner.rut_valid')}
                                    </span>
                                )}
                                {rutValidationState === 'INVALID' && (
                                    <span className="font-mono text-microcopy text-[#C68346]">
                                        {t('supply.scanner.rut_invalid')}
                                    </span>
                                )}
                            </div>
                            <input
                                type="text"
                                value={supplierTaxId}
                                onChange={(e) => setSupplierTaxId(e.target.value)}
                                onBlur={() => {
                                    if (supplierTaxId.trim()) setSupplierTaxId(formatRut(supplierTaxId));
                                }}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="76.000.000-0"
                                className={cn(
                                    'w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text',
                                    rutValidationState === 'INVALID'
                                        ? 'border-[#C68346]'
                                        : 'border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346]'
                                )}
                            />
                        </div>

                        <div className="space-y-fib-8">
                            <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.scanner.supplier_name')}
                            </label>
                            <input
                                type="text"
                                value={supplierName}
                                onChange={(e) => setSupplierName(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                            />
                        </div>

                        <div className="space-y-fib-8">
                            <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.scanner.dte_type')}
                            </label>
                            <select
                                value={documentType}
                                onChange={(e) => setDocumentType(Number(e.target.value) as SiiDteType)}
                                className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                            >
                                {SII_DTE_TYPES.map((dte) => (
                                    <option key={dte} value={dte}>
                                        {t(`supply.dte.${dte}`)}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-fib-8">
                            <div className="space-y-fib-8">
                                <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('supply.scanner.folio')}
                                </label>
                                <input
                                    type="text"
                                    value={folio}
                                    onChange={(e) => setFolio(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                />
                            </div>
                            <div className="space-y-fib-8">
                                <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('supply.scanner.issue_date')}
                                </label>
                                <input
                                    type="date"
                                    value={issueDate}
                                    onChange={(e) => setIssueDate(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full min-h-[48px] px-fib-8 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Totals & Guardrails */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-fib-13">
                        <div className="space-y-fib-8">
                            <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.scanner.net_clp')}
                            </label>
                            <input
                                type="number"
                                min={0}
                                value={netAmountClp}
                                onChange={(e) => setNetAmountClp(Number(e.target.value) || 0)}
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                            />
                        </div>
                        <div className="space-y-fib-8">
                            <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.scanner.vat_clp')}
                            </label>
                            <input
                                type="number"
                                min={0}
                                value={vatAmountClp}
                                onChange={(e) => setVatAmountClp(Number(e.target.value) || 0)}
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                            />
                        </div>
                        <div className="space-y-fib-8">
                            <label className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.scanner.total_clp')}
                            </label>
                            <input
                                type="number"
                                min={0}
                                value={totalAmountClp}
                                onChange={(e) => {
                                    const total = Number(e.target.value) || 0;
                                    setTotalAmountClp(total);
                                    if (documentType === 33 || documentType === 39) {
                                        const net = Math.round(total / 1.19);
                                        setNetAmountClp(net);
                                        setVatAmountClp(total - net);
                                    } else {
                                        setNetAmountClp(total);
                                        setVatAmountClp(0);
                                    }
                                }}
                                autoComplete="off"
                                spellCheck={false}
                                className={cn(
                                    'w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#07090D] border outline-none font-mono text-data-dense tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text',
                                    hasArithmeticMismatch
                                        ? 'border-[#C68346] text-[#C68346]'
                                        : 'border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346]'
                                )}
                            />
                        </div>
                    </div>

                    {/* ISA-101 Exception Alerts */}
                    {hasArithmeticMismatch && (
                        <div className="border-l-[3px] border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] px-fib-13 py-fib-8 flex items-center justify-between gap-fib-13 font-mono text-data-dense tabular-nums text-[#C68346]">
                            <div className="flex items-center gap-fib-8">
                                <span className="material-symbols-outlined text-[18px]">warning</span>
                                <span>{t('supply.scanner.arithmetic_mismatch')}</span>
                            </div>
                            <span>
                                {formatClp(linesSumClp)} ≠ {formatClp(totalAmountClp)} (Δ {formatClp(arithmeticDelta)})
                            </span>
                        </div>
                    )}

                    {hasAssetWithoutInvoice && (
                        <div className="border-l-[3px] border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] px-fib-13 py-fib-8 flex items-center gap-fib-8 font-mono text-data-dense tabular-nums text-[#C68346]">
                            <span className="material-symbols-outlined text-[18px]">warning</span>
                            <span>{t('supply.scanner.asset_no_invoice_warn')}</span>
                        </div>
                    )}

                    {/* Line Items Table */}
                    <div className="space-y-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-13">
                        <div className="flex items-center justify-between">
                            <span className="font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.scanner.lines_title')} ({lines.length})
                            </span>
                            <button
                                type="button"
                                onClick={() =>
                                    setLines((prev) => [
                                        ...prev,
                                        createEmptyLine(defaultDestination, mapBucketToCategory(defaultBucket)),
                                    ])
                                }
                                aria-label={t('supply.scanner.add_item')}
                                title={t('supply.scanner.add_item')}
                                className="bg-transparent border-0 outline-none p-1 min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                            >
                                <span className="material-symbols-outlined text-[20px]">add</span>
                            </button>
                        </div>

                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border-t border-b border-[#E2E8F0] dark:border-[#12151C]">
                            {lines.map((line) => (
                                <div
                                    key={line.lineId}
                                    className={cn(
                                        'py-fib-13 grid grid-cols-1 md:grid-cols-12 gap-fib-8 items-center border-l-[3px] pl-fib-8',
                                        line.destination === 'CAPEX_ASSET' && documentType !== 33 && documentType !== 34
                                            ? 'border-[#C68346]'
                                            : 'border-transparent'
                                    )}
                                >
                                    <input
                                        type="text"
                                        value={line.rawDescription}
                                        onChange={(e) =>
                                            updateLine(line.lineId, { rawDescription: e.target.value })
                                        }
                                        autoComplete="off"
                                        spellCheck={false}
                                        placeholder={t('supply.backlog.sku_name')}
                                        className="md:col-span-3 min-h-[44px] px-fib-8 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                    />
                                    <select
                                        value={line.categoryCode}
                                        onChange={(e) =>
                                            updateLine(line.lineId, {
                                                categoryCode: e.target.value as SupplyCategoryCode,
                                            })
                                        }
                                        className="md:col-span-2 min-h-[44px] px-fib-8 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                                    >
                                        {SUPPLY_CATEGORIES.map((cat) => (
                                            <option key={cat} value={cat}>
                                                {t(`supply.categories.${cat}`)}
                                            </option>
                                        ))}
                                    </select>
                                    <input
                                        type="number"
                                        step="any"
                                        min={0}
                                        value={line.qty}
                                        onChange={(e) =>
                                            updateLine(line.lineId, { qty: Number(e.target.value) || 0 })
                                        }
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="md:col-span-1 min-h-[44px] px-fib-8 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                    />
                                    <select
                                        value={line.unitSi}
                                        onChange={(e) =>
                                            updateLine(line.lineId, { unitSi: e.target.value as SupplyUnitSi })
                                        }
                                        className="md:col-span-1 min-h-[44px] px-fib-8 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] outline-none font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                                    >
                                        {SUPPLY_UNITS_SI.map((u) => (
                                            <option key={u} value={u}>
                                                {u}
                                            </option>
                                        ))}
                                    </select>
                                    <input
                                        type="number"
                                        min={0}
                                        value={line.unitPriceClp}
                                        onChange={(e) =>
                                            updateLine(line.lineId, {
                                                unitPriceClp: Number(e.target.value) || 0,
                                            })
                                        }
                                        autoComplete="off"
                                        spellCheck={false}
                                        placeholder="CLP"
                                        className="md:col-span-2 min-h-[44px] px-fib-8 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                    />
                                    <select
                                        value={line.destination}
                                        onChange={(e) =>
                                            updateLine(line.lineId, {
                                                destination: e.target.value as PurchaseLineDestination,
                                            })
                                        }
                                        className="md:col-span-2 min-h-[44px] px-fib-8 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                                    >
                                        <option value="STOCK_IN_TRANSIT">
                                            {t('supply.destinations.STOCK_IN_TRANSIT')}
                                        </option>
                                        <option value="STOCK_IN_WAREHOUSE">
                                            {t('supply.destinations.STOCK_IN_WAREHOUSE')}
                                        </option>
                                        <option value="CAPEX_ASSET">
                                            {t('supply.destinations.CAPEX_ASSET')}
                                        </option>
                                        <option value="DIRECT_EXPENSE">
                                            {t('supply.destinations.DIRECT_EXPENSE')}
                                        </option>
                                    </select>
                                    <div className="md:col-span-1 flex items-center justify-end gap-fib-8">
                                        <span className="font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                            {formatClp(line.subtotalClp)}
                                        </span>
                                        {lines.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setLines((prev) =>
                                                        prev.filter((item) => item.lineId !== line.lineId)
                                                    )
                                                }
                                                aria-label={t('supply.common.remove')}
                                                title={t('supply.common.remove')}
                                                className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer rounded-none shadow-none"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">
                                                    delete
                                                </span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-fib-13 pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C]">
                        <div className="font-mono text-data-dense tabular-nums text-[#475569] dark:text-[#8A93A6]">
                            Σ {formatClp(linesSumClp)}
                        </div>
                        <div className="flex flex-wrap items-center gap-fib-13">
                            <button
                                type="button"
                                onClick={() => {
                                    onSendToReconciler(buildCurrentDraft());
                                    onClose();
                                }}
                                className="min-h-[48px] px-fib-21 bg-transparent border border-[#00AEEF] text-[#00AEEF] hover:opacity-80 font-mono text-data-dense font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                            >
                                {t('supply.scanner.send_to_reconciler')}
                            </button>
                            <button
                                type="submit"
                                disabled={digesting || analyzing || committing}
                                className="min-h-[48px] px-fib-21 bg-[#C68346] border border-[#C68346] text-[#FFFFFF] hover:opacity-90 font-mono text-data-dense font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer disabled:opacity-40"
                            >
                                {t('supply.scanner.commit_direct')}
                            </button>
                        </div>
                    </div>
                </form>
            </div>

            <HitlConfirmModal
                open={hitlOpen}
                title={t('supply.scanner.commit_direct')}
                description={`${t(`supply.purchase_modes.${purchaseMode}`)} · DTE ${documentType} #${folio || '—'} · ${formatClp(totalAmountClp || linesSumClp)}`}
                keyword="ACTUALIZAR"
                comparisonDiff={hitlDiff}
                loading={committing}
                onConfirm={() => void handleDirectHitlCommit()}
                onCancel={() => setHitlOpen(false)}
            />
        </div>
    );
};

export default ReceiptScannerModal;
