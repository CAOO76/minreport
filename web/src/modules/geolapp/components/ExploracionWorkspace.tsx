import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
    CopperDomain,
    DrillholeRqdQuality,
    ExploracionIntervalItem,
    ExploracionSondajePayload,
    GeolappDomainRecord,
    GeolappDomainRecordStatus,
    HitlFieldDiff,
} from '../core/types/GeolappTypes';
import {
    dataService,
    type GeolappDomainRecordHitlPatch,
} from '../core/services/DataService';
import {
    storageService,
    useResolvedStockpileImage,
} from '../core/services/StorageService';
import {
    computeDrillholeComposites,
    computeIntervalRqdAndRecovery,
    evaluateQaQcRpd,
} from '../core/utils/geoscienceCalculations';
import {
    generateGeolappDomainDossierPdf,
    type GeolappDomainPdfResult,
} from '../core/utils/vectorPdfGenerator';
import { auth } from '../../../config/firebase';
import { getApiUrl } from '../../../utils/network';
import {
    HitlConfirmModal,
    type HitlComparisonDiffItem,
} from '../../../components/common/HitlConfirmModal';
import {
    ReportBlockEditable,
    UNDECLARED_TECH_VALUE,
} from '../../../components/common/ReportBlockEditable';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import { CopyButton } from '../../../components/common/CopyButton';
import { SecureImage } from '../../../components/common/SecureImage';
import type { GeolappDomainWorkspaceProps } from './GeomensuraWorkspace';

const COPPER_DOMAINS: CopperDomain[] = [
    'OXIDO_CU',
    'MIXTO_CU',
    'SULFURO_SECUNDARIO_CU',
    'SULFURO_PRIMARIO_CU',
    'CONCENTRADO_CU',
    'BAJA_LEY_CU',
    'ESTERIL_RIPIOS',
];

type QaQcSampleType = 'NONE' | 'STANDARD' | 'BLANK' | 'DUPLICATE';

interface ExploracionDraftState {
    code: string;
    title: string;
    status: GeolappDomainRecordStatus;
    notes: string;
    holeId: string;
    method: 'DDH' | 'RC';
    collarEasting: string;
    collarNorthing: string;
    collarElevationM: string;
    utmZone: string;
    hemisphere: 'N' | 'S';
    azimuthDeg: string;
    dipDeg: string;
    totalDepthM: string;
    intervals: ExploracionIntervalItem[];
    qaqcSampleType: QaQcSampleType;
    qaqcOriginalPct: string;
    qaqcCheckPct: string;
}

interface NewIntervalDraft {
    fromM: string;
    toM: string;
    recoveredM: string;
    sumPiecesGe10cmM: string;
    lithology: string;
    alteration: string;
    copperDomain: CopperDomain;
    cuTotalPct: string;
    cuSolublePct: string;
}

interface AiIntervalSuggestionItem {
    fieldKey: 'lithology' | 'alteration' | 'copperDomain' | 'cuTotalPct' | 'cuSolublePct' | 'notes';
    label: string;
    currentValue: string;
    suggestedValue: string;
    rawValue: string | number;
    accepted: boolean;
}

function createEmptyDraft(): ExploracionDraftState {
    return {
        code: '',
        title: '',
        status: 'ACTIVE',
        notes: '',
        holeId: '',
        method: 'DDH',
        collarEasting: '',
        collarNorthing: '',
        collarElevationM: '',
        utmZone: '19',
        hemisphere: 'S',
        azimuthDeg: '0',
        dipDeg: '-60',
        totalDepthM: '',
        intervals: [],
        qaqcSampleType: 'NONE',
        qaqcOriginalPct: '',
        qaqcCheckPct: '',
    };
}

function createEmptyIntervalDraft(startFromM = 0): NewIntervalDraft {
    return {
        fromM: String(startFromM),
        toM: String(startFromM + 2),
        recoveredM: '',
        sumPiecesGe10cmM: '',
        lithology: '',
        alteration: '',
        copperDomain: 'SULFURO_PRIMARIO_CU',
        cuTotalPct: '',
        cuSolublePct: '',
    };
}

function recordToDraft(record: GeolappDomainRecord): ExploracionDraftState {
    const p = record.payload as ExploracionSondajePayload;
    return {
        code: record.code || '',
        title: record.title || '',
        status: record.status || 'ACTIVE',
        notes: record.notes || '',
        holeId: p.holeId || '',
        method: p.method === 'RC' ? 'RC' : 'DDH',
        collarEasting: Number.isFinite(p.collarEasting) ? String(p.collarEasting) : '',
        collarNorthing: Number.isFinite(p.collarNorthing) ? String(p.collarNorthing) : '',
        collarElevationM: Number.isFinite(p.collarElevationM) ? String(p.collarElevationM) : '',
        utmZone: Number.isFinite(p.utmZone) ? String(p.utmZone) : '19',
        hemisphere: p.hemisphere === 'N' ? 'N' : 'S',
        azimuthDeg: Number.isFinite(p.azimuthDeg) ? String(p.azimuthDeg) : '0',
        dipDeg: Number.isFinite(p.dipDeg) ? String(p.dipDeg) : '-60',
        totalDepthM: Number.isFinite(p.totalDepthM) ? String(p.totalDepthM) : '',
        intervals: Array.isArray(p.intervals) ? p.intervals.map((iv) => ({ ...iv })) : [],
        qaqcSampleType: p.qaqcSampleType || 'NONE',
        qaqcOriginalPct:
            p.qaqcOriginalPct !== undefined && p.qaqcOriginalPct !== null ? String(p.qaqcOriginalPct) : '',
        qaqcCheckPct:
            p.qaqcCheckPct !== undefined && p.qaqcCheckPct !== null ? String(p.qaqcCheckPct) : '',
    };
}

function parseFinite(val: string): number | null {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
}

function formatNum(val: number | null | undefined, digits = 2): string {
    if (val === null || val === undefined || !Number.isFinite(val)) {
        return UNDECLARED_TECH_VALUE;
    }
    return val.toFixed(digits);
}

function rqdQualityColorClass(quality: DrillholeRqdQuality): string {
    switch (quality) {
        case 'EXCELENTE':
        case 'BUENA':
            return 'text-[#00AEEF] border-[#00AEEF]';
        case 'REGULAR':
            return 'text-[#C68346] border-[#C68346]';
        default:
            return 'text-red-600 dark:text-red-400 border-red-600/60';
    }
}

function triggerBlobDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function fileToBase64NoPrefix(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const raw = String(reader.result || '');
            const idx = raw.indexOf(',');
            resolve(idx >= 0 ? raw.slice(idx + 1) : raw);
        };
        reader.onerror = () => reject(new Error('No se pudo leer el archivo multimedia en memoria.'));
        reader.readAsDataURL(blob);
    });
}

function CoreBoxSecurePreview({ url, alt }: { url: string | null | undefined; alt: string }) {
    const resolved = useResolvedStockpileImage(url || undefined);
    if (!resolved) {
        return (
            <div className="h-[110px] border border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#030406] flex items-center justify-center text-[13px] font-mono text-slate-400 dark:text-[#5A6072]">
                {UNDECLARED_TECH_VALUE}
            </div>
        );
    }
    return (
        <SecureImage
            src={resolved}
            alt={alt}
            className="w-full h-[140px] object-cover border border-slate-200 dark:border-[#12151C] rounded-none"
        />
    );
}

export function ExploracionWorkspace({
    embedded = false,
    hostScope = 'CLIENT',
    tenantId,
    userId,
}: GeolappDomainWorkspaceProps) {
    const { t, i18n } = useTranslation();

    const [records, setRecords] = useState<GeolappDomainRecord[]>([]);
    const [loadingRecords, setLoadingRecords] = useState<boolean>(true);
    const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
    const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
    const [editingBlock, setEditingBlock] = useState<'COLLAR' | 'INTERVALS' | 'QAQC' | 'NOTES' | null>(null);

    const [draft, setDraft] = useState<ExploracionDraftState>(() => createEmptyDraft());
    const [newInterval, setNewInterval] = useState<NewIntervalDraft>(() => createEmptyIntervalDraft(0));
    const [activeIntervalId, setActiveIntervalId] = useState<string | null>(null);

    // Core box photo upload + transient in-memory AI media cache (never stored in Firestore)
    const [uploadingIntervalId, setUploadingIntervalId] = useState<string | null>(null);
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const [transientBase64ByInterval, setTransientBase64ByInterval] = useState<
        Record<string, { mimeType: string; dataBase64: string }>
    >({});

    // AI analysis state
    const [aiLoading, setAiLoading] = useState<boolean>(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [aiTargetIntervalId, setAiTargetIntervalId] = useState<string | null>(null);
    const [aiSuggestions, setAiSuggestions] = useState<AiIntervalSuggestionItem[]>([]);

    // Status, saving & PDF state
    const [saving, setSaving] = useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
    const [pdfExporting, setPdfExporting] = useState<boolean>(false);
    const [lastPdfCas, setLastPdfCas] = useState<GeolappDomainPdfResult['casDescriptor']>(null);

    // HITL Confirmation Modal state
    const [hitlOpen, setHitlOpen] = useState<boolean>(false);
    const [hitlDiffs, setHitlDiffs] = useState<HitlComparisonDiffItem[]>([]);
    const [pendingPatch, setPendingPatch] = useState<{
        patch: GeolappDomainRecordHitlPatch;
        auditDiff: HitlFieldDiff[];
    } | null>(null);

    const selectedRecord = useMemo(
        () => records.find((r) => r.id === selectedRecordId) ?? null,
        [records, selectedRecordId]
    );

    useEffect(() => {
        let active = true;
        dataService.setTenantContext({ tenantId, userId });
        setLoadingRecords(true);

        const unsubscribe = dataService.subscribeToDomainRecords('EXPLORACION_SONDAJES', (items) => {
            if (!active) return;
            setRecords(items);
            setLoadingRecords(false);
            setSelectedRecordId((prev) => {
                if (prev && items.some((r) => r.id === prev)) return prev;
                return items.length > 0 ? items[0].id : null;
            });
        });

        dataService
            .listDomainRecords('EXPLORACION_SONDAJES')
            .then((items) => {
                if (!active) return;
                setRecords(items);
                setLoadingRecords(false);
                setSelectedRecordId((prev) => {
                    if (prev && items.some((r) => r.id === prev)) return prev;
                    return items.length > 0 ? items[0].id : null;
                });
            })
            .catch(() => {
                if (active) setLoadingRecords(false);
            });

        return () => {
            active = false;
            unsubscribe();
        };
    }, [tenantId, userId]);

    useEffect(() => {
        if (!isCreatingNew && selectedRecord && editingBlock === null && aiSuggestions.length === 0) {
            const mapped = recordToDraft(selectedRecord);
            setDraft(mapped);
            setActiveIntervalId((prev) =>
                prev && mapped.intervals.some((iv) => iv.id === prev)
                    ? prev
                    : mapped.intervals[0]?.id ?? null
            );
            setLastPdfCas(null);
        } else if (!isCreatingNew && !selectedRecord && editingBlock === null) {
            setDraft(createEmptyDraft());
            setActiveIntervalId(null);
        }
    }, [selectedRecord, isCreatingNew, editingBlock, aiSuggestions.length]);

    const activeValues = useMemo(() => {
        if (!isCreatingNew && editingBlock === null && aiSuggestions.length === 0 && selectedRecord) {
            return recordToDraft(selectedRecord);
        }
        return draft;
    }, [isCreatingNew, editingBlock, aiSuggestions.length, selectedRecord, draft]);

    const activeInterval = useMemo(
        () =>
            activeValues.intervals.find((iv) => iv.id === activeIntervalId) ??
            activeValues.intervals[0] ??
            null,
        [activeValues.intervals, activeIntervalId]
    );
    const activeCoreBoxResolvedUrl = useResolvedStockpileImage(activeInterval?.coreBoxPhotoUrl || undefined);

    // Live deterministic RQD preview for new interval inputs
    const newIntervalRqdPreview = useMemo(() => {
        const f = parseFinite(newInterval.fromM);
        const to = parseFinite(newInterval.toM);
        const rec = parseFinite(newInterval.recoveredM);
        const ge10 = parseFinite(newInterval.sumPiecesGe10cmM);
        if (f === null || to === null || rec === null || ge10 === null) return null;
        return computeIntervalRqdAndRecovery(f, to, rec, ge10);
    }, [newInterval]);

    // Live weighted composites
    const compositesCalc = useMemo(() => {
        return computeDrillholeComposites(
            activeValues.intervals.map((iv) => ({
                fromM: iv.fromM,
                toM: iv.toM,
                cuTotalPct: iv.cuTotalPct,
                cuSolublePct: iv.cuSolublePct,
                rqdPct: iv.rqdPct,
                recoveryPct: iv.recoveryPct,
            }))
        );
    }, [activeValues.intervals]);

    // Live QA/QC RPD evaluation
    const qaqcCalc = useMemo(() => {
        if (activeValues.qaqcSampleType === 'NONE') return null;
        const orig = parseFinite(activeValues.qaqcOriginalPct);
        const chk = parseFinite(activeValues.qaqcCheckPct);
        if (orig === null || chk === null) return null;
        return evaluateQaQcRpd(orig, chk, 10);
    }, [activeValues.qaqcSampleType, activeValues.qaqcOriginalPct, activeValues.qaqcCheckPct]);

    const buildPayloadFromDraft = useCallback(
        (source: ExploracionDraftState): { payload: ExploracionSondajePayload | null; error: string | null } => {
            const cE = parseFinite(source.collarEasting);
            const cN = parseFinite(source.collarNorthing);
            const cZ = parseFinite(source.collarElevationM);
            const zone = parseFinite(source.utmZone);
            const az = parseFinite(source.azimuthDeg);
            const dip = parseFinite(source.dipDeg);
            const depth = parseFinite(source.totalDepthM);

            if (
                !source.holeId.trim() ||
                cE === null ||
                cN === null ||
                cZ === null ||
                zone === null ||
                az === null ||
                dip === null ||
                depth === null ||
                depth < 0
            ) {
                return {
                    payload: null,
                    error: t(
                        'exploracion.missing_collar_fields',
                        'Complete ID sondaje, coordenadas UTM del collar, acimut, inclinación y profundidad total.'
                    ),
                };
            }

            const comp = computeDrillholeComposites(
                source.intervals.map((iv) => ({
                    fromM: iv.fromM,
                    toM: iv.toM,
                    cuTotalPct: iv.cuTotalPct,
                    cuSolublePct: iv.cuSolublePct,
                    rqdPct: iv.rqdPct,
                    recoveryPct: iv.recoveryPct,
                }))
            );

            const orig = parseFinite(source.qaqcOriginalPct);
            const chk = parseFinite(source.qaqcCheckPct);
            const qaqc =
                source.qaqcSampleType !== 'NONE' && orig !== null && chk !== null
                    ? evaluateQaQcRpd(orig, chk, 10)
                    : null;

            const payload: ExploracionSondajePayload = {
                holeId: source.holeId.trim(),
                method: source.method,
                collarEasting: cE,
                collarNorthing: cN,
                collarElevationM: cZ,
                utmZone: Math.min(60, Math.max(1, Math.round(zone))),
                hemisphere: source.hemisphere,
                azimuthDeg: az,
                dipDeg: dip,
                totalDepthM: depth,
                intervals: source.intervals,
                weightedCuTotalPct: comp.weightedCuTotalPct,
                weightedCuSolublePct: comp.weightedCuSolublePct,
                meanRqdPct: comp.meanRqdPct,
                meanRecoveryPct: comp.meanRecoveryPct,
                qaqcSampleType: source.qaqcSampleType,
                qaqcOriginalPct: orig,
                qaqcCheckPct: chk,
                qaqcRpdPct: qaqc?.rpdPct ?? null,
                qaqcPassed: qaqc?.passed ?? null,
            };

            return { payload, error: null };
        },
        [t]
    );

    const handleAddIntervalToDraft = () => {
        const f = parseFinite(newInterval.fromM);
        const to = parseFinite(newInterval.toM);
        const rec = parseFinite(newInterval.recoveredM);
        const ge10 = parseFinite(newInterval.sumPiecesGe10cmM);

        if (f === null || to === null || to <= f || rec === null || ge10 === null || rec < 0 || ge10 < 0) {
            setStatusMessage({
                kind: 'error',
                text: t(
                    'exploracion.invalid_interval',
                    'Ingrese tramo válido (Hasta > Desde) con longitud recuperada y colas >= 10 cm no negativas.'
                ),
            });
            return;
        }

        const rqdRes = computeIntervalRqdAndRecovery(f, to, rec, ge10);
        if (!rqdRes) {
            setStatusMessage({
                kind: 'error',
                text: t('exploracion.invalid_interval', 'Error al calcular RQD/TCR del tramo.'),
            });
            return;
        }

        const cuT = parseFinite(newInterval.cuTotalPct);
        const cuS = parseFinite(newInterval.cuSolublePct);
        const id = `IV_${Date.now()}_${draft.intervals.length + 1}`;
        const item: ExploracionIntervalItem = {
            id,
            fromM: f,
            toM: to,
            recoveredM: rec,
            sumPiecesGe10cmM: ge10,
            recoveryPct: rqdRes.recoveryPct,
            rqdPct: rqdRes.rqdPct,
            rqdQuality: rqdRes.rqdQuality,
            lithology: newInterval.lithology.trim() || UNDECLARED_TECH_VALUE,
            alteration: newInterval.alteration.trim() || UNDECLARED_TECH_VALUE,
            copperDomain: newInterval.copperDomain,
            cuTotalPct: cuT,
            cuSolublePct: cuS,
            coreBoxPhotoUrl: null,
            coreBoxSha256: null,
            coreBoxOriginalBytes: null,
            coreBoxOptimizedBytes: null,
            coreBoxSavingsPct: null,
        };

        setDraft((prev) => ({
            ...prev,
            intervals: [...prev.intervals, item].sort((a, b) => a.fromM - b.fromM),
        }));
        setActiveIntervalId(id);
        setNewInterval(createEmptyIntervalDraft(to));
        setStatusMessage(null);
    };

    const handleRemoveIntervalFromDraft = (intervalId: string) => {
        setDraft((prev) => ({
            ...prev,
            intervals: prev.intervals.filter((iv) => iv.id !== intervalId),
        }));
    };

    const handleCoreBoxFileUpload = async (intervalId: string, file: File) => {
        if (!file.type.startsWith('image/')) {
            setStatusMessage({
                kind: 'error',
                text: t('registration.photo_error', 'Seleccione un archivo de imagen válido para la bandeja Core-Box.'),
            });
            return;
        }

        // Ensure draft stays active in case user uploads on an existing interval outside edit mode
        if (!isCreatingNew && editingBlock === null && selectedRecord) {
            setDraft(recordToDraft(selectedRecord));
            setEditingBlock('INTERVALS');
        }

        setUploadingIntervalId(intervalId);
        setUploadProgress(5);
        setStatusMessage(null);

        try {
            const base64Only = await fileToBase64NoPrefix(file);
            setTransientBase64ByInterval((prev) => ({
                ...prev,
                [intervalId]: { mimeType: file.type, dataBase64: base64Only },
            }));

            const refKey = `${draft.holeId.trim() || selectedRecord?.code || 'SONDAJE'}_${intervalId}`;
            const uploaded = await storageService.uploadStockpileImage(
                file,
                refKey,
                {
                    tenantId,
                    filename: `corebox_${intervalId}_${file.name}`,
                },
                (pct) => setUploadProgress(pct)
            );

            const origBytes = uploaded.originalBytes ?? file.size;
            const optBytes = uploaded.optimizedBytes ?? uploaded.size;
            const savPct = uploaded.savingsPct ?? 0;

            setDraft((prev) => ({
                ...prev,
                intervals: prev.intervals.map((iv) =>
                    iv.id === intervalId
                        ? {
                              ...iv,
                              coreBoxPhotoUrl: uploaded.url,
                              coreBoxSha256: uploaded.sha256,
                              coreBoxOriginalBytes: origBytes,
                              coreBoxOptimizedBytes: optBytes,
                              coreBoxSavingsPct: savPct,
                          }
                        : iv
                ),
            }));

            setStatusMessage({
                kind: 'info',
                text: `CORE-BOX CAS: ORIG ${(origBytes / 1024).toFixed(1)} KB -> ${(optBytes / 1024).toFixed(
                    1
                )} KB (-${savPct.toFixed(1)}%)`,
            });
        } catch (err) {
            setStatusMessage({
                kind: 'error',
                text: err instanceof Error ? err.message : t('manual_capture.photo_process_error', 'Error al procesar imagen CAS.'),
            });
        } finally {
            setUploadingIntervalId(null);
            setUploadProgress(0);
        }
    };

    const handleRunAiCoreAnalysis = async (interval: ExploracionIntervalItem) => {
        setAiError(null);
        setAiSuggestions([]);
        setAiTargetIntervalId(interval.id);

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setAiError(t('scanner.ai_offline', 'IA OFFLINE: Se requiere conexión activa para /api/ai/inference.'));
            return;
        }

        setAiLoading(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) {
                setAiError('Autenticación Firebase Auth requerida para invocar /api/ai/inference.');
                setAiLoading(false);
                return;
            }

            // Prepare transient base64 image ONLY in memory if Core-Box photo exists
            let mediaPayload: Array<{ mimeType: string; dataBase64: string }> | undefined;
            const cachedMem = transientBase64ByInterval[interval.id];
            if (cachedMem) {
                mediaPayload = [cachedMem];
            } else if (interval.coreBoxPhotoUrl && activeCoreBoxResolvedUrl && !activeCoreBoxResolvedUrl.startsWith('data:')) {
                const imgResp = await fetch(activeCoreBoxResolvedUrl);
                if (imgResp.ok) {
                    const blob = await imgResp.blob();
                    const b64 = await fileToBase64NoPrefix(blob);
                    mediaPayload = [{ mimeType: blob.type || 'image/webp', dataBase64: b64 }];
                }
            }

            if (!mediaPayload && (!interval.lithology || interval.lithology === UNDECLARED_TECH_VALUE)) {
                setAiError(
                    'Adjunte fotografía Core-Box CAS o registre contexto litológico previo antes de solicitar análisis IA.'
                );
                setAiLoading(false);
                return;
            }

            const prompt = [
                'Analiza este tramo de sondaje minero (y la fotografía de bandeja de testigo adjunta si existe).',
                `Sondaje: ${activeValues.holeId || 'NO_DECLARADO'} (${activeValues.method}) | Tramo: ${interval.fromM}m - ${interval.toM}m.`,
                `RQD medido: ${interval.rqdPct}% (${interval.rqdQuality}) | Recuperación TCR: ${interval.recoveryPct}%.`,
                `Litología actual: ${interval.lithology} | Alteración actual: ${interval.alteration} | Dominio Cu actual: ${interval.copperDomain}.`,
                `Responde ÚNICAMENTE con un objeto JSON válido sin markdown con las claves exactas:`,
                `{"lithology": string|null, "alteration": string|null, "copperDomain": "OXIDO_CU"|"MIXTO_CU"|"SULFURO_SECUNDARIO_CU"|"SULFURO_PRIMARIO_CU"|"CONCENTRADO_CU"|"BAJA_LEY_CU"|"ESTERIL_RIPIOS"|null, "cuTotalPct": number|null, "cuSolublePct": number|null, "notes": string|null}.`,
                `Si un parámetro no es verificable desde la evidencia entregada, devuelve null (no inventes leyes químicas sin evidencia).`,
            ].join(' ');

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            };
            if (tenantId && /^[A-Za-z0-9_-]{1,128}$/.test(tenantId)) {
                headers['X-Active-Account-Id'] = tenantId;
            }

            const response = await fetch(getApiUrl('/api/ai/inference'), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    prompt,
                    systemInstruction:
                        'Eres un geólogo senior especialista en logueo DDH/RC de cobre. Responde exclusivamente JSON técnico estricto y sin alucinaciones.',
                    module: 'geolapp',
                    thinkingLevel: 'medium',
                    requireHITL: true,
                    ...(mediaPayload ? { media: mediaPayload } : {}),
                }),
            });

            if (!response.ok) {
                const errJson = await response.json().catch(() => ({}));
                throw new Error(
                    (errJson as { error?: string }).error || `Error HTTP ${response.status} en /api/ai/inference`
                );
            }

            const data = (await response.json()) as { success?: boolean; text?: string; error?: string };
            if (!data.success || !data.text) {
                throw new Error(data.error || 'Respuesta IA vacía en /api/ai/inference.');
            }

            const cleanedText = data.text
                .replace(/^```json\s*/i, '')
                .replace(/^```\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();

            const firstBrace = cleanedText.indexOf('{');
            const lastBrace = cleanedText.lastIndexOf('}');
            if (firstBrace < 0 || lastBrace <= firstBrace) {
                throw new Error('La inferencia IA no retornó estructura JSON interpretable.');
            }

            const parsed = JSON.parse(cleanedText.slice(firstBrace, lastBrace + 1)) as {
                lithology?: string | null;
                alteration?: string | null;
                copperDomain?: CopperDomain | null;
                cuTotalPct?: number | null;
                cuSolublePct?: number | null;
                notes?: string | null;
            };

            const suggestions: AiIntervalSuggestionItem[] = [];
            const pushSuggestion = (
                fieldKey: AiIntervalSuggestionItem['fieldKey'],
                label: string,
                currentVal: string | number | null | undefined,
                suggestedVal: string | number | null | undefined
            ) => {
                if (suggestedVal === null || suggestedVal === undefined || String(suggestedVal).trim() === '') return;
                const currStr =
                    currentVal === null || currentVal === undefined || String(currentVal).trim() === ''
                        ? UNDECLARED_TECH_VALUE
                        : String(currentVal);
                const suggStr = String(suggestedVal).trim();
                if (currStr !== suggStr) {
                    suggestions.push({
                        fieldKey,
                        label,
                        currentValue: currStr,
                        suggestedValue: suggStr,
                        rawValue: typeof suggestedVal === 'number' ? suggestedVal : suggStr,
                        accepted: true,
                    });
                }
            };

            pushSuggestion('lithology', t('exploracion.lithology', 'LITOLOGÍA'), interval.lithology, parsed.lithology);
            pushSuggestion('alteration', t('exploracion.alteration', 'ALTERACIÓN'), interval.alteration, parsed.alteration);
            if (parsed.copperDomain && COPPER_DOMAINS.includes(parsed.copperDomain)) {
                pushSuggestion(
                    'copperDomain',
                    t('exploracion.copper_domain', 'DOMINIO Cu'),
                    interval.copperDomain,
                    parsed.copperDomain
                );
            }
            if (typeof parsed.cuTotalPct === 'number' && parsed.cuTotalPct >= 0 && parsed.cuTotalPct <= 100) {
                pushSuggestion('cuTotalPct', t('exploracion.cu_total_pct', 'Cu TOTAL (%)'), interval.cuTotalPct, parsed.cuTotalPct);
            }
            if (typeof parsed.cuSolublePct === 'number' && parsed.cuSolublePct >= 0 && parsed.cuSolublePct <= 100) {
                pushSuggestion('cuSolublePct', t('exploracion.cu_soluble_pct', 'Cu SOLUBLE (%)'), interval.cuSolublePct, parsed.cuSolublePct);
            }
            pushSuggestion('notes', t('domains.notes_label', 'OBSERVACIÓN TÉCNICA'), activeValues.notes, parsed.notes);

            if (suggestions.length === 0) {
                setAiError(t('hitl.no_changes', 'La evaluación IA coincide con los valores registrados.'));
            } else {
                setAiSuggestions(suggestions);
            }
        } catch (err) {
            setAiError(err instanceof Error ? err.message : 'Fallo técnico en inferencia IA.');
        } finally {
            setAiLoading(false);
        }
    };

    const handleToggleAiField = (fieldKey: AiIntervalSuggestionItem['fieldKey']) => {
        setAiSuggestions((prev) =>
            prev.map((item) => (item.fieldKey === fieldKey ? { ...item, accepted: !item.accepted } : item))
        );
    };

    const handleApplyAiSuggestionsWithHitl = () => {
        const acceptedItems = aiSuggestions.filter((item) => item.accepted);
        if (acceptedItems.length === 0 || !aiTargetIntervalId) {
            setAiError('Seleccione al menos una sugerencia campo a campo para consolidar.');
            return;
        }

        const baseDraft = !isCreatingNew && selectedRecord ? recordToDraft(selectedRecord) : draft;
        const updatedDraft: ExploracionDraftState = {
            ...baseDraft,
            intervals: baseDraft.intervals.map((iv) => {
                if (iv.id !== aiTargetIntervalId) return iv;
                const copy = { ...iv };
                for (const item of acceptedItems) {
                    if (item.fieldKey === 'lithology') copy.lithology = String(item.rawValue);
                    if (item.fieldKey === 'alteration') copy.alteration = String(item.rawValue);
                    if (item.fieldKey === 'copperDomain') copy.copperDomain = item.rawValue as CopperDomain;
                    if (item.fieldKey === 'cuTotalPct') copy.cuTotalPct = Number(item.rawValue);
                    if (item.fieldKey === 'cuSolublePct') copy.cuSolublePct = Number(item.rawValue);
                }
                return copy;
            }),
        };

        const noteSugg = acceptedItems.find((i) => i.fieldKey === 'notes');
        if (noteSugg) {
            updatedDraft.notes = updatedDraft.notes
                ? `${updatedDraft.notes}\n[IA HITL] ${String(noteSugg.rawValue)}`
                : `[IA HITL] ${String(noteSugg.rawValue)}`;
        }

        if (isCreatingNew || !selectedRecord) {
            setDraft(updatedDraft);
            setAiSuggestions([]);
            setStatusMessage({
                kind: 'info',
                text: t('scanner.ai_accepted_notice', 'Sugerencias IA aprobadas e integradas al borrador.'),
            });
            return;
        }

        const { payload, error } = buildPayloadFromDraft(updatedDraft);
        if (!payload || error) {
            setAiError(error || 'No es posible consolidar sugerencias sobre el registro actual.');
            return;
        }

        setHitlDiffs(
            acceptedItems.map((it) => ({
                field: `${it.label} (${aiTargetIntervalId})`,
                current: it.currentValue,
                suggested: it.suggestedValue,
            }))
        );
        setPendingPatch({
            patch: {
                notes: updatedDraft.notes.trim() || undefined,
                payload,
            },
            auditDiff: acceptedItems.map((it) => ({
                field: `intervals[${aiTargetIntervalId}].${it.fieldKey}`,
                current: it.currentValue,
                suggested: it.suggestedValue,
            })),
        });
        setHitlOpen(true);
    };

    const handleSaveNewRecord = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!draft.code.trim() || !draft.title.trim()) {
            setStatusMessage({
                kind: 'error',
                text: 'Código de registro y título técnico son obligatorios.',
            });
            return;
        }
        const { payload, error } = buildPayloadFromDraft(draft);
        if (!payload || error) {
            setStatusMessage({ kind: 'error', text: error || 'Validación incompleta.' });
            return;
        }

        setSaving(true);
        setStatusMessage(null);
        try {
            const saved = await dataService.saveDomainRecord({
                tenantId,
                domainMode: 'EXPLORACION_SONDAJES',
                code: draft.code.trim(),
                title: draft.title.trim(),
                status: draft.status,
                notes: draft.notes.trim() || undefined,
                payload,
            });
            setIsCreatingNew(false);
            setSelectedRecordId(saved.id);
            setStatusMessage({
                kind: 'info',
                text:
                    saved.synced === false
                        ? t('hitl.save_offline_queued', 'Offline: registro encolado en SyncQueueEngine.')
                        : t('hitl.save_success', 'Sondaje consolidado en base única.'),
            });
        } catch (err) {
            setStatusMessage({
                kind: 'error',
                text: err instanceof Error ? err.message : t('hitl.save_error', 'Error al guardar sondaje.'),
            });
        } finally {
            setSaving(false);
        }
    };

    const handleToggleBlockEdit = (block: 'COLLAR' | 'INTERVALS' | 'QAQC' | 'NOTES') => {
        if (!selectedRecord) return;
        if (editingBlock === block) {
            setEditingBlock(null);
            setDraft(recordToDraft(selectedRecord));
            setStatusMessage(null);
            return;
        }
        setIsCreatingNew(false);
        setDraft(recordToDraft(selectedRecord));
        setEditingBlock(block);
        setStatusMessage(null);
    };

    const handleRequestHitlReview = () => {
        if (!selectedRecord) return;
        const { payload, error } = buildPayloadFromDraft(draft);
        if (!payload || error) {
            setStatusMessage({ kind: 'error', text: error || 'Validación técnica incompleta.' });
            return;
        }

        const prev = selectedRecord.payload as ExploracionSondajePayload;
        const comparisons: HitlComparisonDiffItem[] = [];
        const auditDiffs: HitlFieldDiff[] = [];

        const pushDiff = (label: string, field: string, beforeVal: unknown, afterVal: unknown) => {
            const bStr =
                beforeVal === null || beforeVal === undefined || beforeVal === ''
                    ? UNDECLARED_TECH_VALUE
                    : String(beforeVal);
            const aStr =
                afterVal === null || afterVal === undefined || afterVal === ''
                    ? UNDECLARED_TECH_VALUE
                    : String(afterVal);
            if (bStr !== aStr) {
                comparisons.push({ field: label, current: bStr, suggested: aStr });
                auditDiffs.push({
                    field,
                    current: bStr,
                    suggested: aStr,
                });
            }
        };

        pushDiff(t('domains.record_title', 'TÍTULO TÉCNICO'), 'title', selectedRecord.title, draft.title.trim());
        pushDiff(t('domains.status_label', 'ESTADO'), 'status', selectedRecord.status, draft.status);
        pushDiff(t('exploracion.hole_id', 'SONDAJE'), 'payload.holeId', prev.holeId, payload.holeId);
        pushDiff(t('exploracion.method', 'MÉTODO'), 'payload.method', prev.method, payload.method);
        pushDiff(t('exploracion.total_depth_m', 'PROFUNDIDAD TOTAL (m)'), 'payload.totalDepthM', prev.totalDepthM, payload.totalDepthM);
        pushDiff('TRAMOS LOGUEADOS', 'payload.intervals.length', prev.intervals.length, payload.intervals.length);
        pushDiff(t('exploracion.weighted_cu_total', 'Cu TOTAL POND. (%)'), 'payload.weightedCuTotalPct', prev.weightedCuTotalPct, payload.weightedCuTotalPct);
        pushDiff(t('exploracion.mean_rqd', 'RQD MEDIO (%)'), 'payload.meanRqdPct', prev.meanRqdPct, payload.meanRqdPct);
        pushDiff(t('exploracion.qaqc_rpd_pct', 'QA/QC RPD (%)'), 'payload.qaqcRpdPct', prev.qaqcRpdPct ?? null, payload.qaqcRpdPct ?? null);
        pushDiff(t('domains.notes_label', 'NOTAS'), 'notes', selectedRecord.notes ?? null, draft.notes.trim() || null);

        if (comparisons.length === 0) {
            setStatusMessage({
                kind: 'info',
                text: t('hitl.no_changes', 'Sin modificaciones respecto al registro actual.'),
            });
            return;
        }

        setHitlDiffs(comparisons);
        setPendingPatch({
            patch: {
                title: draft.title.trim(),
                status: draft.status,
                notes: draft.notes.trim() || undefined,
                payload,
            },
            auditDiff: auditDiffs,
        });
        setHitlOpen(true);
    };

    const handleConfirmHitl = async () => {
        if (!selectedRecord || !pendingPatch) return;
        setSaving(true);
        try {
            const updated = await dataService.updateDomainRecordWithHitl(
                selectedRecord.id,
                pendingPatch.patch,
                'ACTUALIZAR',
                pendingPatch.auditDiff
            );
            setHitlOpen(false);
            setEditingBlock(null);
            setPendingPatch(null);
            setAiSuggestions([]);
            setDraft(recordToDraft(updated));
            setStatusMessage({
                kind: 'info',
                text:
                    updated.synced === false
                        ? t('hitl.save_offline_queued', 'Offline: mutación HITL encolada en SyncQueueEngine.')
                        : t('hitl.save_success', 'Sondaje actualizado y firmado en AuditLedger.'),
            });
        } catch (err) {
            setStatusMessage({
                kind: 'error',
                text: err instanceof Error ? err.message : t('hitl.save_error', 'Error al registrar actualización HITL.'),
            });
        } finally {
            setSaving(false);
        }
    };

    const handleExportPdf = async (uploadToCas: boolean) => {
        if (!selectedRecord) return;
        setPdfExporting(true);
        setStatusMessage(null);
        try {
            const res = await generateGeolappDomainDossierPdf(selectedRecord, {
                locale: i18n.language,
                authorEmail: userId,
                tenantId,
                uploadToCas,
            });
            triggerBlobDownload(res.blob, res.filename);
            if (res.casDescriptor) {
                setLastPdfCas(res.casDescriptor);
            }
            setStatusMessage({
                kind: 'info',
                text: t('pdf.download_ready', 'Dossier PDF vectorial descargado.'),
            });
        } catch (err) {
            setStatusMessage({
                kind: 'error',
                text: err instanceof Error ? err.message : t('pdf.error', 'Error al generar PDF vectorial.'),
            });
        } finally {
            setPdfExporting(false);
        }
    };

    const inputClass =
        'w-full bg-white dark:bg-[#030406] border border-slate-200 dark:border-[#12151C] px-[8px] py-[6px] text-[13px] font-mono tabular-nums text-slate-900 dark:text-[#F3F4F6] rounded-none shadow-none focus:outline-none focus:border-[#C68346]';
    const labelClass =
        'block text-[13px] font-bold uppercase tracking-[0.05em] text-slate-600 dark:text-[#8A93A6] mb-[4px]';

    return (
        <section
            aria-label={t('exploracion.title', 'EXPLORACIÓN Y LOGUEO GEOTÉCNICO / GEOQUÍMICO')}
            className={`w-full bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] select-none ${
                embedded ? 'p-[13px] space-y-[13px]' : 'p-[21px] space-y-[21px]'
            }`}
        >
            {/* Header & Drillhole Selector */}
            <header className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[13px] rounded-none shadow-none space-y-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-[13px]">
                    <div className="min-w-0">
                        <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#C68346]">
                            {t('domains.exploracion_sondajes', 'EXPLORACIÓN Y LOGUEO DE SONDAJES')} · {hostScope}
                        </p>
                        <h2 className="text-[17px] font-semibold text-slate-900 dark:text-[#F3F4F6] mt-[2px]">
                            {t('exploracion.title', 'EXPLORACIÓN Y LOGUEO GEOTÉCNICO / GEOQUÍMICO')}
                        </h2>
                    </div>

                    {!isCreatingNew ? (
                        <button
                            type="button"
                            onClick={() => {
                                setEditingBlock(null);
                                setIsCreatingNew(true);
                                setDraft(createEmptyDraft());
                                setNewInterval(createEmptyIntervalDraft(0));
                                setAiSuggestions([]);
                                setAiError(null);
                                setStatusMessage(null);
                            }}
                            className="px-[13px] py-[8px] bg-[#C68346] text-white text-[13px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none hover:opacity-90 cursor-pointer"
                        >
                            {t('domains.new_record', 'NUEVO SONDAJE')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => {
                                setIsCreatingNew(false);
                                setStatusMessage(null);
                            }}
                            className="px-[13px] py-[8px] border border-slate-300 dark:border-[#12151C] bg-white dark:bg-[#030406] text-slate-700 dark:text-[#8A93A6] text-[13px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none cursor-pointer"
                        >
                            {t('common.cancel_button', 'CANCELAR')}
                        </button>
                    )}
                </div>

                {loadingRecords ? (
                    <M3LinearProgress indeterminate />
                ) : records.length === 0 ? (
                    <p className="text-[13px] text-slate-500 dark:text-[#5A6072]">
                        {t('domains.empty_records', 'No existen sondajes registrados.')} ·{' '}
                        {t('domains.pending', '[Pendiente de registro]')}
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-[8px]">
                        {records.map((rec) => {
                            const active = !isCreatingNew && rec.id === selectedRecordId;
                            return (
                                <button
                                    key={rec.id}
                                    type="button"
                                    onClick={() => {
                                        setIsCreatingNew(false);
                                        setEditingBlock(null);
                                        setAiSuggestions([]);
                                        setAiError(null);
                                        setSelectedRecordId(rec.id);
                                        setStatusMessage(null);
                                    }}
                                    className={`px-[13px] py-[8px] border text-left rounded-none shadow-none transition-colors cursor-pointer ${
                                        active
                                            ? 'border-[#C68346] bg-white dark:bg-[#000000]'
                                            : 'border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#030406] text-slate-600 dark:text-[#8A93A6] hover:border-[#00AEEF]'
                                    }`}
                                >
                                    <div className="flex items-center gap-[8px]">
                                        <span className="font-mono tabular-nums text-[13px] font-bold">
                                            {rec.code}
                                        </span>
                                        <span
                                            className={`text-[13px] font-mono uppercase ${
                                                rec.synced === false
                                                    ? 'text-[#C68346]'
                                                    : 'text-[#00AEEF]'
                                            }`}
                                        >
                                            {rec.synced === false
                                                ? t('domains.pending_sync_badge', 'COLA OFFLINE')
                                                : t('domains.synced_badge', 'SINCRONIZADO')}
                                        </span>
                                    </div>
                                    <div className="text-[13px] truncate max-w-[180px]">{rec.title}</div>
                                </button>
                            );
                        })}
                    </div>
                )}

                {statusMessage && (
                    <div
                        role="status"
                        className={`p-[13px] border text-[13px] font-mono rounded-none shadow-none ${
                            statusMessage.kind === 'error'
                                ? 'border-red-600/50 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400'
                                : 'border-[#00AEEF]/40 bg-slate-100 dark:bg-[#030406] text-slate-800 dark:text-[#F3F4F6]'
                        }`}
                    >
                        {statusMessage.text}
                    </div>
                )}
            </header>

            {/* Golden Ratio Macro-Layout (61.8% / 38.2%) */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,61.8fr)_minmax(0,38.2fr)] gap-[21px] items-start">
                {/* MAJOR PANE (61.8%): Graphic Strip Log + Collar & Interval Logging */}
                <div className="space-y-[21px] min-w-0">
                    {/* Deterministic Strip Log Graphic Bar */}
                    <div className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[13px] rounded-none shadow-none space-y-[13px]">
                        <div className="flex flex-wrap items-center justify-between gap-[8px]">
                            <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-slate-600 dark:text-[#8A93A6]">
                                {t('exploracion.intervals_header', 'PERFIL GRÁFICO DE TRAMOS (DEERE RQD / Cu)')}
                            </p>
                            <span className="font-mono tabular-nums text-[13px] text-slate-500 dark:text-[#8A93A6]">
                                {activeValues.intervals.length} TRAMOS · {compositesCalc.totalLoggedLengthM.toFixed(2)} m
                            </span>
                        </div>

                        {activeValues.intervals.length === 0 ? (
                            <p className="text-[13px] font-mono text-slate-400 dark:text-[#5A6072]">
                                {UNDECLARED_TECH_VALUE}
                            </p>
                        ) : (
                            <div className="flex w-full h-[28px] border border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#030406] overflow-hidden">
                                {activeValues.intervals.map((iv) => {
                                    const len = Math.max(0.1, iv.toM - iv.fromM);
                                    const widthPct =
                                        compositesCalc.totalLoggedLengthM > 0
                                            ? (len / compositesCalc.totalLoggedLengthM) * 100
                                            : 100 / activeValues.intervals.length;
                                    const selected = activeInterval?.id === iv.id;
                                    const barColor =
                                        iv.rqdQuality === 'EXCELENTE' || iv.rqdQuality === 'BUENA'
                                            ? 'bg-[#00AEEF]/30'
                                            : iv.rqdQuality === 'REGULAR'
                                              ? 'bg-[#C68346]/35'
                                              : 'bg-red-500/35';
                                    return (
                                        <button
                                            key={iv.id}
                                            type="button"
                                            onClick={() => setActiveIntervalId(iv.id)}
                                            style={{ width: `${widthPct}%` }}
                                            title={`${iv.fromM}-${iv.toM}m | RQD ${iv.rqdPct}% | ${iv.lithology}`}
                                            className={`h-full border-r border-slate-300 dark:border-[#12151C] text-[13px] font-mono tabular-nums truncate px-[4px] cursor-pointer ${barColor} ${
                                                selected ? 'outline outline-1 outline-[#C68346]' : ''
                                            }`}
                                        >
                                            {iv.fromM}-{iv.toM}m
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {isCreatingNew ? (
                        <form
                            onSubmit={handleSaveNewRecord}
                            autoComplete="off"
                            spellCheck={false}
                            className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[21px] rounded-none shadow-none space-y-[21px]"
                        >
                            <h3 className="text-[14px] font-semibold uppercase tracking-[0.03em] border-b border-slate-200 dark:border-[#12151C] pb-[13px]">
                                {t('domains.save_record', 'NUEVO REGISTRO DE SONDAJE')}
                            </h3>

                            {/* Meta + Collar */}
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-[13px]">
                                <div>
                                    <label className={labelClass}>{t('domains.record_code', 'CÓDIGO REGISTRO')}</label>
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draft.code}
                                        onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                                        placeholder="DDH-26-01"
                                        className={inputClass}
                                        required
                                    />
                                </div>
                                <div className="sm:col-span-2">
                                    <label className={labelClass}>{t('domains.record_title', 'TÍTULO TÉCNICO')}</label>
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draft.title}
                                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                                        placeholder="Campaña Fase IV Sector Sur"
                                        className={inputClass}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>{t('exploracion.hole_id', 'ID SONDAJE')}</label>
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draft.holeId}
                                        onChange={(e) => setDraft({ ...draft, holeId: e.target.value })}
                                        placeholder="DDH-01"
                                        className={inputClass}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-[13px]">
                                <div>
                                    <label className={labelClass}>{t('exploracion.method', 'MÉTODO')}</label>
                                    <select
                                        value={draft.method}
                                        onChange={(e) => setDraft({ ...draft, method: e.target.value as 'DDH' | 'RC' })}
                                        className={inputClass}
                                    >
                                        <option value="DDH">{t('exploracion.method_ddh', 'DDH (DIAMANTINA)')}</option>
                                        <option value="RC">{t('exploracion.method_rc', 'RC (AIRE REVERSO)')}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className={labelClass}>{t('exploracion.azimuth_deg', 'ACIMUT (deg)')}</label>
                                    <input
                                        type="number"
                                        step="any"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draft.azimuthDeg}
                                        onChange={(e) => setDraft({ ...draft, azimuthDeg: e.target.value })}
                                        className={inputClass}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>{t('exploracion.dip_deg', 'INCLINACIÓN (deg)')}</label>
                                    <input
                                        type="number"
                                        step="any"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draft.dipDeg}
                                        onChange={(e) => setDraft({ ...draft, dipDeg: e.target.value })}
                                        className={inputClass}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>{t('exploracion.total_depth_m', 'PROF. TOTAL (m)')}</label>
                                    <input
                                        type="number"
                                        step="any"
                                        min={0}
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draft.totalDepthM}
                                        onChange={(e) => setDraft({ ...draft, totalDepthM: e.target.value })}
                                        className={inputClass}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>{t('geomensura.easting', 'COLLAR ESTE (m)')}</label>
                                    <input
                                        type="number"
                                        step="any"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draft.collarEasting}
                                        onChange={(e) => setDraft({ ...draft, collarEasting: e.target.value })}
                                        className={inputClass}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>{t('geomensura.northing', 'COLLAR NORTE (m)')}</label>
                                    <input
                                        type="number"
                                        step="any"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draft.collarNorthing}
                                        onChange={(e) => setDraft({ ...draft, collarNorthing: e.target.value })}
                                        className={inputClass}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>{t('geomensura.elevation', 'COTA COLLAR (m)')}</label>
                                    <input
                                        type="number"
                                        step="any"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draft.collarElevationM}
                                        onChange={(e) => setDraft({ ...draft, collarElevationM: e.target.value })}
                                        className={inputClass}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>{t('geomensura.utm_zone', 'ZONA UTM')}</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={60}
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draft.utmZone}
                                        onChange={(e) => setDraft({ ...draft, utmZone: e.target.value })}
                                        className={inputClass}
                                        required
                                    />
                                </div>
                            </div>

                            {/* Add Interval Sub-panel */}
                            <div className="border-t border-slate-200 dark:border-[#12151C] pt-[13px] space-y-[13px]">
                                <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                                    {t('exploracion.add_interval', 'AGREGAR TRAMO DDH / RC')}
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-[8px]">
                                    <div>
                                        <label className={labelClass}>{t('exploracion.from_m', 'DESDE (m)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={newInterval.fromM}
                                            onChange={(e) => setNewInterval({ ...newInterval, fromM: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('exploracion.to_m', 'HASTA (m)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={newInterval.toM}
                                            onChange={(e) => setNewInterval({ ...newInterval, toM: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('exploracion.recovered_m', 'RECUPERADO (m)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={newInterval.recoveredM}
                                            onChange={(e) => setNewInterval({ ...newInterval, recoveredM: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('exploracion.pieces_ge10cm_m', 'TROZOS >=10cm (m)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={newInterval.sumPiecesGe10cmM}
                                            onChange={(e) =>
                                                setNewInterval({ ...newInterval, sumPiecesGe10cmM: e.target.value })
                                            }
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('exploracion.lithology', 'LITOLOGÍA')}</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={newInterval.lithology}
                                            onChange={(e) => setNewInterval({ ...newInterval, lithology: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('exploracion.alteration', 'ALTERACIÓN')}</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={newInterval.alteration}
                                            onChange={(e) =>
                                                setNewInterval({ ...newInterval, alteration: e.target.value })
                                            }
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('exploracion.cu_total_pct', 'Cu TOTAL (%)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={newInterval.cuTotalPct}
                                            onChange={(e) =>
                                                setNewInterval({ ...newInterval, cuTotalPct: e.target.value })
                                            }
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('exploracion.cu_soluble_pct', 'Cu SOLUBLE (%)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={newInterval.cuSolublePct}
                                            onChange={(e) =>
                                                setNewInterval({ ...newInterval, cuSolublePct: e.target.value })
                                            }
                                            className={inputClass}
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-[13px]">
                                    <div className="text-[13px] font-mono tabular-nums text-slate-600 dark:text-[#8A93A6]">
                                        {newIntervalRqdPreview ? (
                                            <span>
                                                TCR: {newIntervalRqdPreview.recoveryPct}% · RQD: {newIntervalRqdPreview.rqdPct}% (
                                                {newIntervalRqdPreview.rqdQuality})
                                            </span>
                                        ) : (
                                            <span>{UNDECLARED_TECH_VALUE}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-[8px]">
                                        <select
                                            value={newInterval.copperDomain}
                                            onChange={(e) =>
                                                setNewInterval({
                                                    ...newInterval,
                                                    copperDomain: e.target.value as CopperDomain,
                                                })
                                            }
                                            className="bg-white dark:bg-[#030406] border border-slate-200 dark:border-[#12151C] px-[8px] py-[6px] text-[13px] font-mono rounded-none shadow-none"
                                        >
                                            {COPPER_DOMAINS.map((dom) => (
                                                <option key={dom} value={dom}>
                                                    {t(`copper_domains.${dom}`, dom)}
                                                </option>
                                            ))}
                                        </select>
                                        <button
                                            type="button"
                                            onClick={handleAddIntervalToDraft}
                                            className="px-[13px] py-[7px] border border-[#00AEEF] bg-white dark:bg-[#030406] text-[#00AEEF] text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                        >
                                            {t('exploracion.add_interval', 'AGREGAR TRAMO')}
                                        </button>
                                    </div>
                                </div>

                                {/* Added Intervals List */}
                                {draft.intervals.length > 0 && (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[13px] font-mono tabular-nums border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-200 dark:border-[#12151C] text-left text-[13px] text-slate-500 dark:text-[#8A93A6]">
                                                    <th className="py-[6px]">TRAMO (m)</th>
                                                    <th className="py-[6px]">TCR %</th>
                                                    <th className="py-[6px]">RQD %</th>
                                                    <th className="py-[6px]">LITOLOGÍA</th>
                                                    <th className="py-[6px]">CuT %</th>
                                                    <th className="py-[6px]" />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {draft.intervals.map((iv) => (
                                                    <tr key={iv.id} className="border-b border-slate-100 dark:border-[#12151C]">
                                                        <td className="py-[6px]">
                                                            {iv.fromM.toFixed(1)} - {iv.toM.toFixed(1)}
                                                        </td>
                                                        <td className="py-[6px]">{iv.recoveryPct.toFixed(1)}</td>
                                                        <td className="py-[6px]">{iv.rqdPct.toFixed(1)}</td>
                                                        <td className="py-[6px] font-sans">{iv.lithology}</td>
                                                        <td className="py-[6px]">{formatNum(iv.cuTotalPct, 2)}</td>
                                                        <td className="py-[6px] text-right">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRemoveIntervalFromDraft(iv.id)}
                                                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 cursor-pointer"
                                                            >
                                                                <span className="material-symbols-outlined text-[16px]">delete</span>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className={labelClass}>{t('domains.notes_label', 'NOTAS TÉCNICAS')}</label>
                                <textarea
                                    rows={2}
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={draft.notes}
                                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                                    className={inputClass}
                                />
                            </div>

                            {saving && <M3LinearProgress indeterminate />}

                            <div className="flex justify-end gap-[13px]">
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="px-[21px] py-[8px] bg-[#C68346] text-white text-[13px] font-bold uppercase rounded-none shadow-none disabled:opacity-50 cursor-pointer"
                                >
                                    {saving ? t('domains.saving', 'GUARDANDO...') : t('domains.save_record', 'GUARDAR SONDAJE')}
                                </button>
                            </div>
                        </form>
                    ) : !selectedRecord ? (
                        <div className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[34px] rounded-none shadow-none text-center space-y-[13px]">
                            <p className="text-[13px] font-mono text-slate-500 dark:text-[#5A6072]">
                                {t('common.undeclared_tech_data', '[Información técnica no declarada en ficha]')}
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsCreatingNew(true);
                                    setDraft(createEmptyDraft());
                                }}
                                className="px-[13px] py-[8px] bg-[#C68346] text-white text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                            >
                                {t('domains.save_record', 'REGISTRAR PRIMER SONDAJE')}
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-[21px]">
                            {/* Block 1: Collar Parameters (Read-Only Default) */}
                            <ReportBlockEditable
                                title={t('exploracion.collar_header', '01. PARÁMETROS DE COLLAR UTM')}
                                code={selectedRecord.code}
                                isEditing={editingBlock === 'COLLAR'}
                                canEdit={true}
                                onToggleEdit={() => handleToggleBlockEdit('COLLAR')}
                                editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                            >
                                {editingBlock === 'COLLAR' ? (
                                    <div className="space-y-[13px]">
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-[13px]">
                                            <div>
                                                <label className={labelClass}>{t('domains.record_title', 'TÍTULO TÉCNICO')}</label>
                                                <input
                                                    type="text"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.title}
                                                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('exploracion.hole_id', 'ID SONDAJE')}</label>
                                                <input
                                                    type="text"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.holeId}
                                                    onChange={(e) => setDraft({ ...draft, holeId: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('exploracion.total_depth_m', 'PROF. TOTAL (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.totalDepthM}
                                                    onChange={(e) => setDraft({ ...draft, totalDepthM: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-[13px]">
                                            <div>
                                                <label className={labelClass}>{t('geomensura.easting', 'ESTE (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.collarEasting}
                                                    onChange={(e) => setDraft({ ...draft, collarEasting: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('geomensura.northing', 'NORTE (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.collarNorthing}
                                                    onChange={(e) => setDraft({ ...draft, collarNorthing: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('exploracion.azimuth_deg', 'ACIMUT (deg)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.azimuthDeg}
                                                    onChange={(e) => setDraft({ ...draft, azimuthDeg: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('exploracion.dip_deg', 'INCLINACIÓN (deg)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.dipDeg}
                                                    onChange={(e) => setDraft({ ...draft, dipDeg: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                        </div>
                                        <div className="flex justify-end gap-[8px]">
                                            <button
                                                type="button"
                                                onClick={() => handleToggleBlockEdit('COLLAR')}
                                                className="px-[13px] py-[8px] border border-slate-300 dark:border-[#12151C] text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                            >
                                                {t('common.cancel_button', 'CANCELAR')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleRequestHitlReview}
                                                className="px-[13px] py-[8px] bg-[#C68346] text-white text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                            >
                                                {t('domains.hitl_submit', 'APLICAR ACTUALIZACIÓN HITL')}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-[13px] text-[13px]">
                                        <div>
                                            <dt className={labelClass}>{t('exploracion.hole_id', 'ID SONDAJE')}</dt>
                                            <dd className="font-mono font-semibold select-text inline-flex items-center gap-[4px]">
                                                {activeValues.holeId || UNDECLARED_TECH_VALUE}
                                                {activeValues.holeId && <CopyButton value={activeValues.holeId} />}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('exploracion.method', 'MÉTODO')}</dt>
                                            <dd className="font-mono">{activeValues.method}</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('exploracion.total_depth_m', 'PROF. TOTAL (m)')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(parseFinite(activeValues.totalDepthM), 2)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('exploracion.azimuth_deg', 'ACIMUT / INCL.')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {activeValues.azimuthDeg}° / {activeValues.dipDeg}°
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('geomensura.easting', 'ESTE COLLAR')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(parseFinite(activeValues.collarEasting), 2)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('geomensura.northing', 'NORTE COLLAR')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(parseFinite(activeValues.collarNorthing), 2)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('geomensura.elevation', 'COTA (m)')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(parseFinite(activeValues.collarElevationM), 2)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('geomensura.utm_zone', 'ZONA UTM')}</dt>
                                            <dd className="font-mono">
                                                {activeValues.utmZone}
                                                {activeValues.hemisphere}
                                            </dd>
                                        </div>
                                    </dl>
                                )}
                            </ReportBlockEditable>

                            {/* Block 2: Core Logging Intervals Table */}
                            <ReportBlockEditable
                                title={t('exploracion.intervals_header', '02. LOGUEO DE TESTIGOS, TCR / RQD Y LEYES')}
                                isEditing={editingBlock === 'INTERVALS'}
                                canEdit={true}
                                onToggleEdit={() => handleToggleBlockEdit('INTERVALS')}
                                editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                            >
                                {editingBlock === 'INTERVALS' && (
                                    <div className="mb-[13px] pb-[13px] border-b border-slate-200 dark:border-[#12151C] space-y-[13px]">
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-[8px]">
                                            <div>
                                                <label className={labelClass}>{t('exploracion.from_m', 'DESDE (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={newInterval.fromM}
                                                    onChange={(e) => setNewInterval({ ...newInterval, fromM: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('exploracion.to_m', 'HASTA (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={newInterval.toM}
                                                    onChange={(e) => setNewInterval({ ...newInterval, toM: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('exploracion.recovered_m', 'RECUPERADO (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={newInterval.recoveredM}
                                                    onChange={(e) =>
                                                        setNewInterval({ ...newInterval, recoveredM: e.target.value })
                                                    }
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('exploracion.pieces_ge10cm_m', 'TROZOS >=10cm (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={newInterval.sumPiecesGe10cmM}
                                                    onChange={(e) =>
                                                        setNewInterval({ ...newInterval, sumPiecesGe10cmM: e.target.value })
                                                    }
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('exploracion.lithology', 'LITOLOGÍA')}</label>
                                                <input
                                                    type="text"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={newInterval.lithology}
                                                    onChange={(e) =>
                                                        setNewInterval({ ...newInterval, lithology: e.target.value })
                                                    }
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('exploracion.alteration', 'ALTERACIÓN')}</label>
                                                <input
                                                    type="text"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={newInterval.alteration}
                                                    onChange={(e) =>
                                                        setNewInterval({ ...newInterval, alteration: e.target.value })
                                                    }
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('exploracion.cu_total_pct', 'CuT (%)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={newInterval.cuTotalPct}
                                                    onChange={(e) =>
                                                        setNewInterval({ ...newInterval, cuTotalPct: e.target.value })
                                                    }
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('exploracion.cu_soluble_pct', 'CuS (%)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={newInterval.cuSolublePct}
                                                    onChange={(e) =>
                                                        setNewInterval({ ...newInterval, cuSolublePct: e.target.value })
                                                    }
                                                    className={inputClass}
                                                />
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-between gap-[8px]">
                                            <select
                                                value={newInterval.copperDomain}
                                                onChange={(e) =>
                                                    setNewInterval({
                                                        ...newInterval,
                                                        copperDomain: e.target.value as CopperDomain,
                                                    })
                                                }
                                                className="bg-white dark:bg-[#030406] border border-slate-200 dark:border-[#12151C] px-[8px] py-[6px] text-[13px] font-mono rounded-none shadow-none"
                                            >
                                                {COPPER_DOMAINS.map((dom) => (
                                                    <option key={dom} value={dom}>
                                                        {t(`copper_domains.${dom}`, dom)}
                                                    </option>
                                                ))}
                                            </select>
                                            <div className="flex items-center gap-[8px]">
                                                <button
                                                    type="button"
                                                    onClick={handleAddIntervalToDraft}
                                                    className="px-[13px] py-[7px] border border-[#00AEEF] text-[#00AEEF] text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                                >
                                                    {t('exploracion.add_interval', 'AGREGAR TRAMO')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleRequestHitlReview}
                                                    className="px-[13px] py-[7px] bg-[#C68346] text-white text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                                >
                                                    {t('domains.hitl_submit', 'ACTUALIZAR HITL')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeValues.intervals.length === 0 ? (
                                    <p className="text-[13px] font-mono text-slate-500 dark:text-[#5A6072]">
                                        {UNDECLARED_TECH_VALUE}
                                    </p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[13px] font-mono tabular-nums border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-200 dark:border-[#12151C] text-left text-[13px] text-slate-500 dark:text-[#8A93A6]">
                                                    <th className="py-[6px] pr-[8px]">DESDE-HASTA</th>
                                                    <th className="py-[6px] pr-[8px]">{t('exploracion.tcr_pct', 'TCR %')}</th>
                                                    <th className="py-[6px] pr-[8px]">{t('exploracion.rqd_pct', 'RQD %')}</th>
                                                    <th className="py-[6px] pr-[8px]">{t('exploracion.rqd_quality', 'DEERE')}</th>
                                                    <th className="py-[6px] pr-[8px]">{t('exploracion.lithology', 'LITOLOGÍA')}</th>
                                                    <th className="py-[6px] pr-[8px]">{t('exploracion.cu_total_pct', 'CuT %')}</th>
                                                    <th className="py-[6px] pr-[8px]">{t('exploracion.cu_soluble_pct', 'CuS %')}</th>
                                                    {editingBlock === 'INTERVALS' && <th className="py-[6px]" />}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {activeValues.intervals.map((iv) => {
                                                    const isSelected = activeInterval?.id === iv.id;
                                                    return (
                                                        <tr
                                                            key={iv.id}
                                                            onClick={() => setActiveIntervalId(iv.id)}
                                                            className={`border-b border-slate-100 dark:border-[#12151C] cursor-pointer ${
                                                                isSelected ? 'bg-slate-100 dark:bg-[#030406]' : ''
                                                            }`}
                                                        >
                                                            <td className="py-[6px] pr-[8px]">
                                                                {iv.fromM.toFixed(1)} - {iv.toM.toFixed(1)} m
                                                            </td>
                                                            <td className="py-[6px] pr-[8px]">{iv.recoveryPct.toFixed(1)}</td>
                                                            <td className="py-[6px] pr-[8px]">{iv.rqdPct.toFixed(1)}</td>
                                                            <td className="py-[6px] pr-[8px]">
                                                                <span className={`text-[13px] border px-[4px] py-[1px] ${rqdQualityColorClass(iv.rqdQuality)}`}>
                                                                    {iv.rqdQuality}
                                                                </span>
                                                            </td>
                                                            <td className="py-[6px] pr-[8px] font-sans">{iv.lithology}</td>
                                                            <td className="py-[6px] pr-[8px]">{formatNum(iv.cuTotalPct, 2)}</td>
                                                            <td className="py-[6px] pr-[8px]">{formatNum(iv.cuSolublePct, 2)}</td>
                                                            {editingBlock === 'INTERVALS' && (
                                                                <td className="py-[6px] text-right">
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleRemoveIntervalFromDraft(iv.id);
                                                                        }}
                                                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 cursor-pointer"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[16px]">delete</span>
                                                                    </button>
                                                                </td>
                                                            )}
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </ReportBlockEditable>

                            {/* Block 3: Notes & Audit */}
                            <ReportBlockEditable
                                title={t('domains.notes_label', '03. NOTAS TÉCNICAS Y AUDITORÍA')}
                                isEditing={editingBlock === 'NOTES'}
                                canEdit={true}
                                onToggleEdit={() => handleToggleBlockEdit('NOTES')}
                                editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                            >
                                {editingBlock === 'NOTES' ? (
                                    <div className="space-y-[13px]">
                                        <textarea
                                            rows={3}
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.notes}
                                            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                                            className={inputClass}
                                        />
                                        <div className="flex justify-end gap-[8px]">
                                            <button
                                                type="button"
                                                onClick={() => handleToggleBlockEdit('NOTES')}
                                                className="px-[13px] py-[8px] border border-slate-300 dark:border-[#12151C] text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                            >
                                                {t('common.cancel_button', 'CANCELAR')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleRequestHitlReview}
                                                className="px-[13px] py-[8px] bg-[#C68346] text-white text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                            >
                                                {t('domains.hitl_submit', 'APLICAR ACTUALIZACIÓN HITL')}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-[6px] text-[13px]">
                                        <p className="text-slate-700 dark:text-[#8A93A6] whitespace-pre-wrap">
                                            {selectedRecord.notes || UNDECLARED_TECH_VALUE}
                                        </p>
                                        <p className="text-[13px] font-mono tabular-nums text-slate-500 dark:text-[#5A6072]">
                                            UPDATED: {new Date(selectedRecord.updatedAt).toISOString()} · BY:{' '}
                                            {selectedRecord.updatedBy || selectedRecord.createdBy}
                                        </p>
                                    </div>
                                )}
                            </ReportBlockEditable>
                        </div>
                    )}
                </div>

                {/* MINOR PANE (38.2%): Composites, QA/QC RPD, Core-Box CAS + AI HITL, PDF */}
                <aside className="space-y-[21px] min-w-0">
                    {/* Weighted Composites KPI Panel */}
                    <div className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[13px] rounded-none shadow-none space-y-[13px]">
                        <h3 className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#C68346]">
                            {t('exploracion.composites_header', 'COMPÓSITOS PONDERADOS POR LONGITUD')}
                        </h3>
                        <dl className="grid grid-cols-2 gap-[13px] text-[13px]">
                            <div>
                                <dt className={labelClass}>{t('exploracion.weighted_cu_total', 'Cu TOTAL POND. (%)')}</dt>
                                <dd className="font-mono tabular-nums font-semibold text-[#C68346]">
                                    {formatNum(compositesCalc.weightedCuTotalPct, 3)}
                                </dd>
                            </div>
                            <div>
                                <dt className={labelClass}>{t('exploracion.weighted_cu_soluble', 'Cu SOLUBLE POND. (%)')}</dt>
                                <dd className="font-mono tabular-nums font-semibold">
                                    {formatNum(compositesCalc.weightedCuSolublePct, 3)}
                                </dd>
                            </div>
                            <div>
                                <dt className={labelClass}>{t('exploracion.mean_rqd', 'RQD MEDIO (%)')}</dt>
                                <dd className="font-mono tabular-nums font-semibold text-[#00AEEF]">
                                    {formatNum(compositesCalc.meanRqdPct, 1)}
                                </dd>
                            </div>
                            <div>
                                <dt className={labelClass}>{t('exploracion.mean_recovery', 'RECUPERACIÓN TCR (%)')}</dt>
                                <dd className="font-mono tabular-nums font-semibold">
                                    {formatNum(compositesCalc.meanRecoveryPct, 1)}
                                </dd>
                            </div>
                        </dl>
                    </div>

                    {/* QA/QC Analytical RPD Control */}
                    <ReportBlockEditable
                        title={t('exploracion.qaqc_header', 'CONTROL ANALÍTICO QA/QC (RPD %)')}
                        isEditing={isCreatingNew || editingBlock === 'QAQC'}
                        canEdit={Boolean(selectedRecord && !isCreatingNew)}
                        onToggleEdit={() => handleToggleBlockEdit('QAQC')}
                        editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                    >
                        {isCreatingNew || editingBlock === 'QAQC' ? (
                            <div className="space-y-[13px]">
                                <div>
                                    <label className={labelClass}>{t('exploracion.qaqc_type', 'TIPO MUESTRA QA/QC')}</label>
                                    <select
                                        value={draft.qaqcSampleType}
                                        onChange={(e) =>
                                            setDraft({ ...draft, qaqcSampleType: e.target.value as QaQcSampleType })
                                        }
                                        className={inputClass}
                                    >
                                        <option value="NONE">{t('exploracion.qaqc_none', 'NINGUNO')}</option>
                                        <option value="STANDARD">{t('exploracion.qaqc_standard', 'ESTÁNDAR (CRM)')}</option>
                                        <option value="BLANK">{t('exploracion.qaqc_blank', 'BLANCO')}</option>
                                        <option value="DUPLICATE">{t('exploracion.qaqc_duplicate', 'DUPLICADO DE CAMPO')}</option>
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-[8px]">
                                    <div>
                                        <label className={labelClass}>{t('exploracion.qaqc_original_pct', 'LEY ORIGINAL (%)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.qaqcOriginalPct}
                                            onChange={(e) => setDraft({ ...draft, qaqcOriginalPct: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('exploracion.qaqc_check_pct', 'LEY CHECK / CRM (%)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.qaqcCheckPct}
                                            onChange={(e) => setDraft({ ...draft, qaqcCheckPct: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
                                {editingBlock === 'QAQC' && (
                                    <div className="flex justify-end gap-[8px]">
                                        <button
                                            type="button"
                                            onClick={() => handleToggleBlockEdit('QAQC')}
                                            className="px-[13px] py-[6px] border border-slate-300 dark:border-[#12151C] text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                        >
                                            {t('common.cancel_button', 'CANCELAR')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleRequestHitlReview}
                                            className="px-[13px] py-[6px] bg-[#C68346] text-white text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                        >
                                            {t('domains.hitl_submit', 'ACTUALIZAR HITL')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <dl className="grid grid-cols-2 gap-[13px] text-[13px]">
                                <div>
                                    <dt className={labelClass}>{t('exploracion.qaqc_type', 'MUESTRA QA/QC')}</dt>
                                    <dd className="font-mono">{activeValues.qaqcSampleType}</dd>
                                </div>
                                <div>
                                    <dt className={labelClass}>{t('exploracion.qaqc_rpd_pct', 'RPD (%)')}</dt>
                                    <dd className="font-mono tabular-nums font-semibold">
                                        {qaqcCalc ? `${qaqcCalc.rpdPct.toFixed(2)}%` : UNDECLARED_TECH_VALUE}
                                    </dd>
                                </div>
                                <div className="col-span-2">
                                    <dt className={labelClass}>VEREDICTO</dt>
                                    <dd
                                        className={`font-mono text-[13px] font-bold ${
                                            qaqcCalc
                                                ? qaqcCalc.passed
                                                    ? 'text-[#00AEEF]'
                                                    : 'text-red-600 dark:text-red-400'
                                                : 'text-slate-400 dark:text-[#5A6072]'
                                        }`}
                                    >
                                        {qaqcCalc
                                            ? qaqcCalc.passed
                                                ? t('exploracion.qaqc_pass', 'APROBADO (<=10% RPD)')
                                                : t('exploracion.qaqc_fail', 'FUERA DE TOLERANCIA')
                                            : UNDECLARED_TECH_VALUE}
                                    </dd>
                                </div>
                            </dl>
                        )}
                    </ReportBlockEditable>

                    {/* Core Box Photo CAS + Gemini AI Inference Panel */}
                    <div className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[13px] rounded-none shadow-none space-y-[13px]">
                        <div className="flex items-center justify-between gap-[8px]">
                            <h3 className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                                {t('exploracion.core_box_cas', 'BANDEJA CORE-BOX CAS + IA')}
                            </h3>
                            {activeInterval && (
                                <span className="font-mono tabular-nums text-[13px] text-slate-500 dark:text-[#8A93A6]">
                                    {activeInterval.fromM.toFixed(1)}-{activeInterval.toM.toFixed(1)}m
                                </span>
                            )}
                        </div>

                        {!activeInterval ? (
                            <p className="text-[13px] font-mono text-slate-400 dark:text-[#5A6072]">
                                {UNDECLARED_TECH_VALUE}
                            </p>
                        ) : (
                            <div className="space-y-[13px]">
                                <CoreBoxSecurePreview
                                    url={activeInterval.coreBoxPhotoUrl}
                                    alt={`Core Box ${activeInterval.fromM}-${activeInterval.toM}m`}
                                />

                                {/* Real CAS Byte Traceability */}
                                {activeInterval.coreBoxOriginalBytes && activeInterval.coreBoxOptimizedBytes && (
                                    <div className="border border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#030406] p-[8px] text-[13px] font-mono tabular-nums space-y-[4px]">
                                        <p className="text-[#00AEEF]">
                                            ORIG {(activeInterval.coreBoxOriginalBytes / 1024).toFixed(1)} KB ➔ CAS{' '}
                                            {(activeInterval.coreBoxOptimizedBytes / 1024).toFixed(1)} KB (-
                                            {(activeInterval.coreBoxSavingsPct ?? 0).toFixed(1)}%)
                                        </p>
                                        {activeInterval.coreBoxSha256 && (
                                            <div className="flex items-center justify-between gap-[4px] text-slate-500 dark:text-[#8A93A6]">
                                                <span className="truncate select-text">
                                                    SHA-256: {activeInterval.coreBoxSha256}
                                                </span>
                                                <CopyButton value={activeInterval.coreBoxSha256} />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {uploadingIntervalId === activeInterval.id && (
                                    <M3LinearProgress value={uploadProgress} />
                                )}

                                <div className="grid grid-cols-1 gap-[8px]">
                                    <label className="w-full px-[13px] py-[8px] border border-slate-300 dark:border-[#12151C] bg-white dark:bg-[#030406] text-center text-[13px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none hover:border-[#C68346] cursor-pointer">
                                        {t('exploracion.upload_core_box', 'DIGERIR FOTO CORE-BOX (CAS)')}
                                        <input
                                            type="file"
                                            accept="image/*"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="hidden"
                                            onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                if (f) {
                                                    void handleCoreBoxFileUpload(activeInterval.id, f);
                                                }
                                                e.target.value = '';
                                            }}
                                        />
                                    </label>

                                    <button
                                        type="button"
                                        disabled={aiLoading}
                                        onClick={() => handleRunAiCoreAnalysis(activeInterval)}
                                        className="w-full px-[13px] py-[8px] border border-[#00AEEF] bg-white dark:bg-[#030406] text-[#00AEEF] text-[13px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none disabled:opacity-50 cursor-pointer"
                                    >
                                        {aiLoading ? 'EVALUANDO EVIDENCIA...' : 'SUGERENCIA GEOLÓGICA IA (HITL)'}
                                    </button>
                                </div>

                                {aiLoading && <M3LinearProgress indeterminate />}

                                {aiError && (
                                    <div className="p-[8px] border border-red-600/50 bg-red-50 dark:bg-red-950/20 text-[13px] font-mono text-red-700 dark:text-red-400">
                                        {aiError}
                                    </div>
                                )}

                                {/* Granular 1-to-1 AI Field Diff Review */}
                                {aiSuggestions.length > 0 && (
                                    <div className="border border-[#C68346] bg-white dark:bg-[#030406] p-[13px] space-y-[13px] rounded-none shadow-none">
                                        <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#C68346]">
                                            {t('scanner.ai_review_title', 'APROBACIÓN GRANULAR IA 1 A 1 (HITL)')}
                                        </p>
                                        <div className="space-y-[8px]">
                                            {aiSuggestions.map((item) => (
                                                <label
                                                    key={item.fieldKey}
                                                    className="flex items-start gap-[8px] border border-slate-200 dark:border-[#12151C] p-[8px] text-[13px] cursor-pointer"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        autoComplete="off"
                                                        spellCheck={false}
                                                        checked={item.accepted}
                                                        onChange={() => handleToggleAiField(item.fieldKey)}
                                                        className="mt-[2px] accent-[#C68346]"
                                                    />
                                                    <div className="min-w-0 flex-1 space-y-[2px]">
                                                        <div className="font-bold uppercase text-slate-600 dark:text-[#8A93A6]">
                                                            {item.label}
                                                        </div>
                                                        <div className="font-mono text-slate-500 dark:text-[#5A6072] break-words">
                                                            [{item.currentValue}] ➔{' '}
                                                            <span className="text-[#00AEEF] font-semibold">
                                                                [{item.suggestedValue}]
                                                            </span>
                                                        </div>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                        <div className="flex justify-end gap-[8px]">
                                            <button
                                                type="button"
                                                onClick={() => setAiSuggestions([])}
                                                className="px-[8px] py-[6px] border border-slate-300 dark:border-[#12151C] text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                            >
                                                {t('scanner.ai_reject', 'DESCARTAR')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleApplyAiSuggestionsWithHitl}
                                                className="px-[13px] py-[6px] bg-[#C68346] text-white text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                            >
                                                {t('scanner.ai_accept', 'APROBAR SELECCIONADOS')}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* PDF Dossier & CAS Export Panel */}
                    {selectedRecord && !isCreatingNew && (
                        <div className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[13px] rounded-none shadow-none space-y-[13px]">
                            <h3 className="text-[13px] font-bold uppercase tracking-[0.05em] text-slate-600 dark:text-[#8A93A6]">
                                {t('pdf.vector_certificate', 'DOSSIER PDF VECTORIAL')}
                            </h3>
                            {pdfExporting && <M3LinearProgress indeterminate />}
                            <div className="grid grid-cols-1 gap-[8px]">
                                <button
                                    type="button"
                                    disabled={pdfExporting}
                                    onClick={() => handleExportPdf(false)}
                                    className="w-full px-[13px] py-[8px] border border-slate-300 dark:border-[#12151C] bg-white dark:bg-[#030406] text-[13px] font-bold uppercase rounded-none shadow-none hover:border-[#C68346] disabled:opacity-50 cursor-pointer"
                                >
                                    {t('domains.export_pdf', 'EXPORTAR DOSSIER PDF')}
                                </button>
                                <button
                                    type="button"
                                    disabled={pdfExporting}
                                    onClick={() => handleExportPdf(true)}
                                    className="w-full px-[13px] py-[8px] border border-[#00AEEF] bg-white dark:bg-[#030406] text-[#00AEEF] text-[13px] font-bold uppercase rounded-none shadow-none disabled:opacity-50 cursor-pointer"
                                >
                                    {t('domains.export_pdf_cas', 'GUARDAR DOSSIER EN CAS')}
                                </button>
                            </div>
                            {lastPdfCas && (
                                <div className="border border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#030406] p-[8px] text-[13px] font-mono tabular-nums space-y-[4px]">
                                    <p className="text-[#00AEEF]">
                                        ORIG {(lastPdfCas.originalBytes / 1024).toFixed(1)} KB ➔ CAS{' '}
                                        {(lastPdfCas.optimizedBytes / 1024).toFixed(1)} KB (-
                                        {lastPdfCas.savingsPct.toFixed(1)}%)
                                    </p>
                                    <div className="flex items-center justify-between gap-[4px] text-slate-500 dark:text-[#8A93A6]">
                                        <span className="truncate select-text">SHA-256: {lastPdfCas.sha256}</span>
                                        <CopyButton value={lastPdfCas.sha256} />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </aside>
            </div>

            <HitlConfirmModal
                open={hitlOpen}
                title={t('hitl.modal_title', 'CONFIRMACIÓN DE AUDITORÍA HITL')}
                description={t(
                    'hitl.modal_description',
                    'Revise la comparativa [Actual] -> [Sugerido] e ingrese ACTUALIZAR para consolidar.'
                )}
                keyword="ACTUALIZAR"
                comparisonDiff={hitlDiffs}
                confirmLabel={t('hitl.save_audit', 'GUARDAR AUDITORÍA')}
                cancelLabel={t('common.cancel_button', 'CANCELAR')}
                loading={saving}
                onConfirm={() => {
                    void handleConfirmHitl();
                }}
                onCancel={() => setHitlOpen(false)}
            />
        </section>
    );
}

export default ExploracionWorkspace;
