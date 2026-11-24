import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import SecureImage from '../../../components/common/SecureImage';
import CopyButton from '../../../components/common/CopyButton';
import { cn } from '../../../utils/cn';
import { supplyApi } from '../services/supplyApi';
import { formatCasTelemetry, type CasEvidenceRef } from '../types';

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

async function readBlobAsTextSafe(blob: Blob): Promise<string> {
    if (typeof blob.text === 'function') {
        return blob.text();
    }
    if (typeof Response !== 'undefined') {
        return new Response(blob).text();
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('XML_READ_ERROR'));
        reader.readAsText(blob);
    });
}

export interface ReceiptMediaCaptureBarProps {
    open: boolean;
    tenantId?: string;
    isExecOwner: boolean;
    isDirectAutonomous: boolean;
    digesting: boolean;
    analyzing: boolean;
    showTedInput: boolean;
    tedRawXml: string;
    evidenceCasRef?: CasEvidenceRef;
    statusNotice: { tone: 'copper' | 'cyan'; text: string } | null;
    onDigestingChange: (digesting: boolean) => void;
    onToggleTedInput: () => void;
    onTedRawXmlChange: (xml: string) => void;
    onXmlDteIngested: (xmlText: string) => void;
    onEvidenceDigested: (casRef: CasEvidenceRef) => void;
    onStatusNotice: (notice: { tone: 'copper' | 'cyan'; text: string } | null) => void;
    onAnalyze: () => void;
    onClose: () => void;
}

export const ReceiptMediaCaptureBar: React.FC<ReceiptMediaCaptureBarProps> = ({
    open,
    tenantId,
    isExecOwner,
    isDirectAutonomous,
    digesting,
    analyzing,
    showTedInput,
    tedRawXml,
    evidenceCasRef,
    statusNotice,
    onDigestingChange,
    onToggleTedInput,
    onTedRawXmlChange,
    onXmlDteIngested,
    onEvidenceDigested,
    onStatusNotice,
    onAnalyze,
    onClose,
}) => {
    const { t } = useTranslation();
    const uid = useId();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const cameraInputRef = useRef<HTMLInputElement | null>(null);
    const previewUrlRef = useRef<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const revokePreviewBlobUrl = useCallback((url: string | null) => {
        if (
            url &&
            url.startsWith('blob:') &&
            typeof URL !== 'undefined' &&
            typeof URL.revokeObjectURL === 'function'
        ) {
            URL.revokeObjectURL(url);
        }
    }, []);

    useEffect(() => {
        revokePreviewBlobUrl(previewUrlRef.current);
        previewUrlRef.current = null;
        setPreviewUrl(null);
    }, [open, revokePreviewBlobUrl]);

    useEffect(() => {
        previewUrlRef.current = previewUrl;
        return () => {
            revokePreviewBlobUrl(previewUrl);
        };
    }, [previewUrl, revokePreviewBlobUrl]);

    const tryDetectPdf417FromBlob = useCallback(
        async (blob: Blob) => {
            if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return;
            try {
                const DetectorCtor = (
                    window as unknown as {
                        BarcodeDetector: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
                    }
                ).BarcodeDetector;
                const detector = new DetectorCtor({ formats: ['pdf417'] });
                const bitmap = await createImageBitmap(blob);
                try {
                    const codes = await detector.detect(bitmap);
                    const raw =
                        codes.find((c) => c.rawValue && c.rawValue.includes('<TED'))?.rawValue ||
                        codes[0]?.rawValue;
                    if (raw) {
                        onTedRawXmlChange(raw);
                    }
                } finally {
                    bitmap.close();
                }
            } catch {
                // Silent fallback if browser does not support PDF417 decoding
            }
        },
        [onTedRawXmlChange]
    );

    const handleFileIngest = useCallback(
        async (file: File | Blob, filename?: string) => {
            const name = filename || (file instanceof File ? file.name : 'receipt.jpg');
            const lowerName = name.toLowerCase();
            const isXml = lowerName.endsWith('.xml') || file.type.toLowerCase().includes('xml');

            onStatusNotice(null);
            onDigestingChange(true);
            try {
                if (isXml) {
                    const xmlText = await readBlobAsTextSafe(file);
                    onXmlDteIngested(xmlText);
                    const casRef = await supplyApi.digestEvidence(file, {
                        profile: 'XML_DTE_DOCUMENT',
                        tenantId,
                        filename: name,
                    });
                    onEvidenceDigested(casRef);
                    return;
                }

                const isImage =
                    file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(lowerName);
                if (isImage) {
                    void tryDetectPdf417FromBlob(file);
                    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
                        const nextLocalPreview = URL.createObjectURL(file);
                        setPreviewUrl((prev) => {
                            revokePreviewBlobUrl(prev);
                            return nextLocalPreview;
                        });
                    }
                }

                const casRef = await supplyApi.digestEvidence(file, { tenantId, filename: name });
                onEvidenceDigested(casRef);
            } catch (err) {
                onStatusNotice({
                    tone: 'copper',
                    text: err instanceof Error ? err.message : 'CAS_DIGEST_ERROR',
                });
            } finally {
                onDigestingChange(false);
            }
        },
        [
            onDigestingChange,
            onEvidenceDigested,
            onStatusNotice,
            onXmlDteIngested,
            revokePreviewBlobUrl,
            tenantId,
            tryDetectPdf417FromBlob,
        ]
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
        onToggleTedInput();
        if (typeof window !== 'undefined' && !('BarcodeDetector' in window)) {
            onStatusNotice({
                tone: 'copper',
                text: t('supply.scanner.barcode_unsupported'),
            });
        }
    };

    const casTelemetryLine = formatCasTelemetry(evidenceCasRef);

    return (
        <>
            {/* Single 56px MBUX Zero-Layer Header */}
            <header className="h-[56px] shrink-0 px-fib-21 flex items-center justify-between gap-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div className="flex items-center gap-fib-13 min-w-0">
                    <span className="material-symbols-outlined text-[22px] text-[#C68346]">
                        document_scanner
                    </span>
                    <h2 className="text-[17px] font-bold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                        {t('supply.scanner.title')}
                    </h2>
                    {isExecOwner && isDirectAutonomous && (
                        <span className="hidden sm:inline-block text-[14px] font-semibold text-[#7C3F0E] dark:text-[#C68346] border-l border-[#E2E8F0] dark:border-[#12151C] pl-fib-13">
                            {t('supply.scanner.exec_direct_tag')}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-fib-8 shrink-0">
                    <button
                        type="button"
                        onClick={() => void handleNativeCameraCapture()}
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
                        onClick={onAnalyze}
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
                <M3LinearProgress indeterminate ariaLabel={t('supply.scanner.analyzing')} />
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
                accept="image/*,application/pdf,.xml,text/xml,application/xml"
                data-testid="receipt-file-input"
                autoComplete="off"
                spellCheck={false}
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFileIngest(file);
                    e.target.value = '';
                }}
            />

            {(casTelemetryLine || previewUrl || statusNotice || showTedInput) && (
                <div className="px-fib-21 pt-fib-13 space-y-fib-13 shrink-0">
                    {(casTelemetryLine || previewUrl || statusNotice) && (
                        <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13 space-y-fib-13">
                            {statusNotice && (
                                <div
                                    className={cn(
                                        'border-l-[3px] pl-fib-13 py-fib-8 text-[15px] tabular-nums',
                                        statusNotice.tone === 'copper'
                                            ? 'border-[#C68346] text-[#9A5B21] dark:text-[#C68346]'
                                            : 'border-[#00AEEF] text-[#0369A1] dark:text-[#00AEEF]'
                                    )}
                                >
                                    {statusNotice.text}
                                </div>
                            )}
                            {casTelemetryLine && (
                                <div
                                    data-testid="cas-telemetry-bar"
                                    className="flex flex-wrap items-center justify-between gap-fib-8 border-l-[3px] border-[#00AEEF] pl-fib-13 py-fib-8 rounded-none shadow-none"
                                >
                                    <div className="flex items-center gap-fib-8 min-w-0 font-mono text-[14px] tabular-nums text-[#0369A1] dark:text-[#00AEEF]">
                                        <span className="material-symbols-outlined text-[20px]">
                                            verified
                                        </span>
                                        <span className="select-text truncate">{casTelemetryLine}</span>
                                    </div>
                                    {evidenceCasRef?.sha256 && (
                                        <div className="flex items-center gap-fib-8 font-mono text-[14px] tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                            <span className="select-text">
                                                SHA-256 {evidenceCasRef.sha256.slice(0, 12)}
                                            </span>
                                            <CopyButton value={evidenceCasRef.sha256} />
                                        </div>
                                    )}
                                </div>
                            )}
                            {previewUrl && (
                                <div
                                    data-testid="receipt-preview-stage"
                                    className="max-h-44 overflow-hidden flex items-center justify-center rounded-none shadow-none"
                                >
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

                    {showTedInput && (
                        <div className="space-y-fib-8 border-l-[3px] border-[#00AEEF] pl-fib-13">
                            <label
                                htmlFor={`${uid}-ted`}
                                className="block text-[14px] text-[#475569] dark:text-[#8A93A6]"
                            >
                                {t('supply.scanner.scan_pdf417')}
                            </label>
                            <textarea
                                id={`${uid}-ted`}
                                rows={3}
                                value={tedRawXml}
                                onChange={(e) => onTedRawXmlChange(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={t('supply.scanner.ted_placeholder')}
                                className="w-full p-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] outline-none font-mono text-[15px] tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                            />
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

export default ReceiptMediaCaptureBar;
