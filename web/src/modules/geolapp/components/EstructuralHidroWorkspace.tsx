import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
    EstructuralHidroPayload,
    EstructuralPlaneItem,
    GeolappDomainRecord,
    GeolappDomainRecordStatus,
    GeolappDomainUtmFix,
    HitlFieldDiff,
    HydrogeologyReading,
} from '../core/types/GeolappTypes';
import type { GnssRtkFixRecord } from '../core/adapters/ISurfaceSourceAdapter';
import {
    dataService,
    type GeolappDomainRecordHitlPatch,
} from '../core/services/DataService';
import {
    buildEqualAreaGreatCircleSvgPath,
    computeStrikeRightHandRule,
    imuToStructuralAttitude,
    projectEqualAreaPole,
} from '../core/utils/geoscienceCalculations';
import {
    generateGeolappDomainDossierPdf,
    type GeolappDomainPdfResult,
} from '../core/utils/vectorPdfGenerator';
import { useImuClinometer } from '../core/hooks/useImuClinometer';
import {
    useXCoverHardwareKey,
    XCOVER_HARDWARE_KEY_CODES,
} from '../core/hooks/useXCoverHardwareKey';
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
import { ExternalSensorsPanel } from './ExternalSensorsPanel';
import type { GeolappDomainWorkspaceProps } from './GeomensuraWorkspace';

const STRUCTURE_TYPES: Array<{ value: EstructuralPlaneItem['structureType']; labelKey: string; fallback: string }> = [
    { value: 'FALLA', labelKey: 'estructural.type_falla', fallback: 'FALLA' },
    { value: 'DIACLASA', labelKey: 'estructural.type_diaclasa', fallback: 'DIACLASA' },
    { value: 'ESTRATIFICACION', labelKey: 'estructural.type_estratificacion', fallback: 'ESTRATIFICACIÓN' },
    { value: 'VETILLA_CU', labelKey: 'estructural.type_vetilla_cu', fallback: 'VETILLA Cu' },
    { value: 'CONTACTO', labelKey: 'estructural.type_contacto', fallback: 'CONTACTO LITOLÓGICO' },
];

const FLOW_RATE_TOKEN_RE = /\[HIDRO_CAUDAL_LS:\s*([-+]?\d+(?:\.\d+)?)\]/i;

interface EstructuralDraftState {
    code: string;
    title: string;
    status: GeolappDomainRecordStatus;
    notes: string;
    utmFix: GeolappDomainUtmFix | null;
    stationCode: string;
    easting: string;
    northing: string;
    elevationM: string;
    utmZone: string;
    hemisphere: 'N' | 'S';
    planes: EstructuralPlaneItem[];
    piezometerId: string;
    staticWaterLevelM: string;
    wellDepthM: string;
    ph: string;
    conductivityUsCm: string;
    temperatureC: string;
    flowRateLs: string;
}

interface NewPlaneDraft {
    structureType: EstructuralPlaneItem['structureType'];
    dipDeg: string;
    dipDirectionDeg: string;
    jrcBarton: string;
    apertureMm: string;
    infill: string;
}

function extractFlowRateFromNotes(notes: string | undefined): { cleanNotes: string; flowRateLs: string } {
    if (!notes) return { cleanNotes: '', flowRateLs: '' };
    const match = notes.match(FLOW_RATE_TOKEN_RE);
    const flowRateLs = match ? match[1] : '';
    const cleanNotes = notes
        .replace(FLOW_RATE_TOKEN_RE, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return { cleanNotes, flowRateLs };
}

function mergeFlowRateIntoNotes(cleanNotes: string, flowRateLs: string): string {
    const base = cleanNotes.replace(FLOW_RATE_TOKEN_RE, '').trim();
    const flowNum = parseFinite(flowRateLs);
    if (flowNum === null) return base;
    const tag = `[HIDRO_CAUDAL_LS: ${flowNum}]`;
    return base ? `${base}\n${tag}` : tag;
}

function createEmptyDraft(): EstructuralDraftState {
    return {
        code: '',
        title: '',
        status: 'ACTIVE',
        notes: '',
        utmFix: null,
        stationCode: '',
        easting: '',
        northing: '',
        elevationM: '',
        utmZone: '19',
        hemisphere: 'S',
        planes: [],
        piezometerId: '',
        staticWaterLevelM: '',
        wellDepthM: '',
        ph: '',
        conductivityUsCm: '',
        temperatureC: '',
        flowRateLs: '',
    };
}

function createEmptyPlaneDraft(): NewPlaneDraft {
    return {
        structureType: 'DIACLASA',
        dipDeg: '60',
        dipDirectionDeg: '120',
        jrcBarton: '',
        apertureMm: '',
        infill: '',
    };
}

function recordToDraft(record: GeolappDomainRecord): EstructuralDraftState {
    const p = record.payload as EstructuralHidroPayload;
    const h = p.hydrogeology;
    const { cleanNotes, flowRateLs } = extractFlowRateFromNotes(record.notes);
    return {
        code: record.code || '',
        title: record.title || '',
        status: record.status || 'ACTIVE',
        notes: cleanNotes,
        utmFix: record.utmFix ?? null,
        stationCode: p.stationCode || '',
        easting: p.easting !== undefined && p.easting !== null ? String(p.easting) : '',
        northing: p.northing !== undefined && p.northing !== null ? String(p.northing) : '',
        elevationM: p.elevationM !== undefined && p.elevationM !== null ? String(p.elevationM) : '',
        utmZone: p.utmZone !== undefined && p.utmZone !== null ? String(p.utmZone) : '19',
        hemisphere: p.hemisphere === 'N' ? 'N' : 'S',
        planes: Array.isArray(p.planes) ? p.planes.map((pl) => ({ ...pl })) : [],
        piezometerId: h?.piezometerId || '',
        staticWaterLevelM:
            h?.staticWaterLevelM !== undefined && h?.staticWaterLevelM !== null ? String(h.staticWaterLevelM) : '',
        wellDepthM: h?.wellDepthM !== undefined && h?.wellDepthM !== null ? String(h.wellDepthM) : '',
        ph: h?.ph !== undefined && h?.ph !== null ? String(h.ph) : '',
        conductivityUsCm:
            h?.conductivityUsCm !== undefined && h?.conductivityUsCm !== null ? String(h.conductivityUsCm) : '',
        temperatureC:
            h?.temperatureC !== undefined && h?.temperatureC !== null ? String(h.temperatureC) : '',
        flowRateLs,
    };
}

function parseFinite(val: string): number | null {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}

function formatNum(val: number | null | undefined, digits = 2): string {
    if (val === null || val === undefined || !Number.isFinite(val)) {
        return UNDECLARED_TECH_VALUE;
    }
    return val.toFixed(digits);
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

const STEREONET_SIZE = 360;
const STEREONET_CENTER = 180;
const STEREONET_RADIUS = 144;

export function EstructuralHidroWorkspace({
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
    const [editingBlock, setEditingBlock] = useState<'STATION' | 'PLANES' | 'HYDRO' | 'NOTES' | null>(null);

    const [draft, setDraft] = useState<EstructuralDraftState>(() => createEmptyDraft());
    const [planeDraft, setPlaneDraft] = useState<NewPlaneDraft>(() => createEmptyPlaneDraft());
    const [selectedPlaneId, setSelectedPlaneId] = useState<string | null>(null);
    const [compassAzimuthDeg, setCompassAzimuthDeg] = useState<string>('120');

    // IMU Clinometer + XCover physical key 1015
    const imu = useImuClinometer();

    // Status, saving & PDF state
    const [saving, setSaving] = useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
    const [pdfExporting, setPdfExporting] = useState<boolean>(false);
    const [lastPdfCas, setLastPdfCas] = useState<GeolappDomainPdfResult['casDescriptor']>(null);

    // HITL Modal state
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

        const unsubscribe = dataService.subscribeToDomainRecords('ESTRUCTURAL_HIDRO', (items) => {
            if (!active) return;
            setRecords(items);
            setLoadingRecords(false);
            setSelectedRecordId((prev) => {
                if (prev && items.some((r) => r.id === prev)) return prev;
                return items.length > 0 ? items[0].id : null;
            });
        });

        dataService
            .listDomainRecords('ESTRUCTURAL_HIDRO')
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
        if (!isCreatingNew && selectedRecord && editingBlock === null) {
            const mapped = recordToDraft(selectedRecord);
            setDraft(mapped);
            setSelectedPlaneId((prev) =>
                prev && mapped.planes.some((pl) => pl.id === prev) ? prev : mapped.planes[0]?.id ?? null
            );
            setLastPdfCas(null);
        } else if (!isCreatingNew && !selectedRecord && editingBlock === null) {
            setDraft(createEmptyDraft());
            setSelectedPlaneId(null);
        }
    }, [selectedRecord, isCreatingNew, editingBlock]);

    const activeValues = useMemo(() => {
        if (!isCreatingNew && editingBlock === null && selectedRecord) {
            return recordToDraft(selectedRecord);
        }
        return draft;
    }, [isCreatingNew, editingBlock, selectedRecord, draft]);

    const selectedPlane = useMemo(
        () => activeValues.planes.find((pl) => pl.id === selectedPlaneId) ?? activeValues.planes[0] ?? null,
        [activeValues.planes, selectedPlaneId]
    );

    // Live IMU attitude conversion
    const liveImuAttitude = useMemo(() => {
        const az = parseFinite(compassAzimuthDeg) ?? 0;
        const pitch = imu.frozenPitchDeg ?? imu.pitchDeg ?? 0;
        const roll = imu.rollDeg ?? 0;
        return imuToStructuralAttitude(pitch, roll, az);
    }, [imu.frozenPitchDeg, imu.pitchDeg, imu.rollDeg, compassAzimuthDeg]);

    // Live Strike RHR preview for manual plane draft
    const planeDraftStrikeRhr = useMemo(() => {
        const dd = parseFinite(planeDraft.dipDirectionDeg);
        if (dd === null) return null;
        return computeStrikeRightHandRule(dd);
    }, [planeDraft.dipDirectionDeg]);

    // Capture current IMU reading into planeDraft (triggered by button OR Samsung XCover key 1015)
    const captureImuAttitudeIntoDraft = useCallback(() => {
        imu.freezeReading();
        const az = parseFinite(compassAzimuthDeg) ?? 0;
        const attitude = imuToStructuralAttitude(imu.pitchDeg ?? 0, imu.rollDeg ?? 0, az);
        setPlaneDraft((prev) => ({
            ...prev,
            dipDeg: attitude.dipDeg.toFixed(1),
            dipDirectionDeg: attitude.dipDirectionDeg.toFixed(1),
        }));
        setStatusMessage({
            kind: 'info',
            text: `IMU CAPTURADO: DIP ${attitude.dipDeg.toFixed(1)}° / DD ${attitude.dipDirectionDeg.toFixed(
                1
            )}° (RUMBO RHR ${attitude.strikeDeg.toFixed(1)}°)`,
        });
    }, [imu, compassAzimuthDeg]);

    useXCoverHardwareKey(
        () => {
            if (!imu.isListening) return;
            captureImuAttitudeIntoDraft();
        },
        {
            enabled: imu.isListening && (isCreatingNew || editingBlock === 'PLANES'),
            action: 'DOWN',
            keyCodes: [XCOVER_HARDWARE_KEY_CODES.XCOVER_SIDE_KEY],
        }
    );

    const handleAddPlaneToDraft = () => {
        const dip = parseFinite(planeDraft.dipDeg);
        const dipDir = parseFinite(planeDraft.dipDirectionDeg);
        if (dip === null || dip < 0 || dip > 90 || dipDir === null || dipDir < 0 || dipDir > 360) {
            setStatusMessage({
                kind: 'error',
                text: 'Manteo debe estar en [0..90]° y Dirección de Manteo en [0..360]°.',
            });
            return;
        }
        const jrc = parseFinite(planeDraft.jrcBarton);
        if (jrc !== null && (jrc < 0 || jrc > 20)) {
            setStatusMessage({
                kind: 'error',
                text: 'JRC Barton debe estar en el rango [0..20].',
            });
            return;
        }
        const aperture = parseFinite(planeDraft.apertureMm);
        if (aperture !== null && aperture < 0) {
            setStatusMessage({
                kind: 'error',
                text: 'La abertura (mm) debe ser mayor o igual a 0.',
            });
            return;
        }

        const strikeDeg = computeStrikeRightHandRule(dipDir);
        const newId = `PL_${Date.now()}_${draft.planes.length + 1}`;
        const plane: EstructuralPlaneItem = {
            id: newId,
            structureType: planeDraft.structureType,
            dipDeg: Number(dip.toFixed(2)),
            dipDirectionDeg: Number(dipDir.toFixed(2)),
            strikeDeg: Number(strikeDeg.toFixed(2)),
            jrcBarton: jrc,
            apertureMm: aperture,
            ...(planeDraft.infill.trim() ? { infill: planeDraft.infill.trim() } : {}),
        };

        setDraft((prev) => ({
            ...prev,
            planes: [...prev.planes, plane],
        }));
        setSelectedPlaneId(newId);
        setStatusMessage(null);
    };

    const handleRemovePlaneFromDraft = (planeId: string) => {
        setDraft((prev) => ({
            ...prev,
            planes: prev.planes.filter((pl) => pl.id !== planeId),
        }));
    };

    const buildPayloadFromDraft = useCallback(
        (source: EstructuralDraftState): { payload: EstructuralHidroPayload | null; error: string | null } => {
            if (!source.stationCode.trim()) {
                return {
                    payload: null,
                    error: t('estructural.missing_station', 'El código de estación geotécnica es obligatorio.'),
                };
            }

            const phVal = parseFinite(source.ph);
            if (phVal !== null && (phVal < 0 || phVal > 14)) {
                return { payload: null, error: 'El pH del piezómetro debe ubicarse entre 0 y 14.' };
            }
            const condVal = parseFinite(source.conductivityUsCm);
            if (condVal !== null && condVal < 0) {
                return { payload: null, error: 'La conductividad (uS/cm) debe ser >= 0.' };
            }
            const depthVal = parseFinite(source.wellDepthM);
            if (depthVal !== null && depthVal < 0) {
                return { payload: null, error: 'La profundidad del pozo debe ser >= 0.' };
            }

            const hasHydroAny =
                source.piezometerId.trim() !== '' ||
                source.staticWaterLevelM.trim() !== '' ||
                source.wellDepthM.trim() !== '' ||
                source.ph.trim() !== '' ||
                source.conductivityUsCm.trim() !== '' ||
                source.temperatureC.trim() !== '';

            if (hasHydroAny && !source.piezometerId.trim()) {
                return {
                    payload: null,
                    error: 'Ingrese el ID del piezómetro para registrar parámetros hidrogeológicos.',
                };
            }

            const hydrogeology: HydrogeologyReading | null = hasHydroAny
                ? {
                      piezometerId: source.piezometerId.trim(),
                      staticWaterLevelM: parseFinite(source.staticWaterLevelM),
                      wellDepthM: depthVal,
                      ph: phVal,
                      conductivityUsCm: condVal,
                      temperatureC: parseFinite(source.temperatureC),
                  }
                : null;

            const zoneVal = parseFinite(source.utmZone);
            const payload: EstructuralHidroPayload = {
                stationCode: source.stationCode.trim(),
                easting: parseFinite(source.easting),
                northing: parseFinite(source.northing),
                elevationM: parseFinite(source.elevationM),
                utmZone: zoneVal !== null ? Math.min(60, Math.max(1, Math.round(zoneVal))) : null,
                hemisphere: source.hemisphere,
                planes: source.planes,
                hydrogeology,
            };

            return { payload, error: null };
        },
        [t]
    );

    const handleRtkFixCaptured = (fix: GnssRtkFixRecord) => {
        if (!isCreatingNew && editingBlock === null) {
            if (selectedRecord) {
                setDraft(recordToDraft(selectedRecord));
                setEditingBlock('STATION');
            } else {
                setIsCreatingNew(true);
            }
        }
        const hemisphere: 'N' | 'S' = fix.latitude >= 0 ? 'N' : 'S';
        setDraft((prev) => ({
            ...prev,
            stationCode: prev.stationCode.trim() || `EST-${fix.fixQuality}`,
            easting: fix.easting.toFixed(3),
            northing: fix.northing.toFixed(3),
            elevationM:
                fix.orthometricAltitudeM !== null
                    ? fix.orthometricAltitudeM.toFixed(2)
                    : prev.elevationM,
            utmZone: String(fix.utmZone),
            hemisphere,
            utmFix: {
                zone: fix.utmZone,
                band: fix.utmBand,
                hemisphere,
                easting: fix.easting,
                northing: fix.northing,
                altitudeM: fix.orthometricAltitudeM,
                accuracyM: fix.hdop,
                fixQuality: fix.fixQuality,
            },
        }));
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
            setStatusMessage({ kind: 'error', text: error || 'Validación técnica incompleta.' });
            return;
        }

        setSaving(true);
        setStatusMessage(null);
        const persistedNotes = mergeFlowRateIntoNotes(draft.notes, draft.flowRateLs);
        try {
            const saved = await dataService.saveDomainRecord({
                tenantId,
                domainMode: 'ESTRUCTURAL_HIDRO',
                code: draft.code.trim(),
                title: draft.title.trim(),
                status: draft.status,
                utmFix: draft.utmFix ?? undefined,
                notes: persistedNotes || undefined,
                payload,
            });
            setIsCreatingNew(false);
            setSelectedRecordId(saved.id);
            setStatusMessage({
                kind: 'info',
                text:
                    saved.synced === false
                        ? t('hitl.save_offline_queued', 'Offline: registro encolado en SyncQueueEngine.')
                        : t('hitl.save_success', 'Estación estructural consolidada en base única.'),
            });
        } catch (err) {
            setStatusMessage({
                kind: 'error',
                text: err instanceof Error ? err.message : t('hitl.save_error', 'Error al guardar estación.'),
            });
        } finally {
            setSaving(false);
        }
    };

    const handleToggleBlockEdit = (block: 'STATION' | 'PLANES' | 'HYDRO' | 'NOTES') => {
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

        const prev = selectedRecord.payload as EstructuralHidroPayload;
        const prevFlow = extractFlowRateFromNotes(selectedRecord.notes).flowRateLs;
        const persistedNotes = mergeFlowRateIntoNotes(draft.notes, draft.flowRateLs);

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
        pushDiff(t('estructural.station_code', 'ESTACIÓN GEOTÉCNICA'), 'payload.stationCode', prev.stationCode, payload.stationCode);
        pushDiff(t('estructural.planes_count', 'PLANOS ESTRUCTURALES'), 'payload.planes.length', prev.planes.length, payload.planes.length);
        pushDiff(
            t('estructural.piezometer_id', 'PIEZÓMETRO'),
            'payload.hydrogeology.piezometerId',
            prev.hydrogeology?.piezometerId ?? null,
            payload.hydrogeology?.piezometerId ?? null
        );
        pushDiff(
            t('estructural.static_water_level_m', 'NIVEL FREÁTICO (m)'),
            'payload.hydrogeology.staticWaterLevelM',
            prev.hydrogeology?.staticWaterLevelM ?? null,
            payload.hydrogeology?.staticWaterLevelM ?? null
        );
        pushDiff(
            t('estructural.ph', 'pH'),
            'payload.hydrogeology.ph',
            prev.hydrogeology?.ph ?? null,
            payload.hydrogeology?.ph ?? null
        );
        pushDiff(
            t('estructural.conductivity_us_cm', 'CONDUCTIVIDAD (uS/cm)'),
            'payload.hydrogeology.conductivityUsCm',
            prev.hydrogeology?.conductivityUsCm ?? null,
            payload.hydrogeology?.conductivityUsCm ?? null
        );
        pushDiff('CAUDAL PIEZÓMETRO (L/s)', 'notes.flowRateLs', prevFlow || null, draft.flowRateLs.trim() || null);
        pushDiff(
            t('domains.notes_label', 'NOTAS'),
            'notes',
            selectedRecord.notes ?? null,
            persistedNotes || null
        );

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
                utmFix: draft.utmFix ?? undefined,
                notes: persistedNotes || undefined,
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
            setDraft(recordToDraft(updated));
            setStatusMessage({
                kind: 'info',
                text:
                    updated.synced === false
                        ? t('hitl.save_offline_queued', 'Offline: mutación HITL encolada en SyncQueueEngine.')
                        : t('hitl.save_success', 'Estación actualizada y firmada en AuditLedger.'),
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

    // Schmidt equal-area concentric reference ring radii (for 30° and 60° pole dip angles)
    const ring30R = useMemo(() => projectEqualAreaPole(30, 0, STEREONET_RADIUS).r, []);
    const ring60R = useMemo(() => projectEqualAreaPole(60, 0, STEREONET_RADIUS).r, []);

    const previewDip = parseFinite(planeDraft.dipDeg);
    const previewDipDir = parseFinite(planeDraft.dipDirectionDeg);
    const showPreviewInNet =
        (isCreatingNew || editingBlock === 'PLANES') &&
        previewDip !== null &&
        previewDip >= 0 &&
        previewDip <= 90 &&
        previewDipDir !== null &&
        previewDipDir >= 0 &&
        previewDipDir <= 360;

    const inputClass =
        'w-full bg-white dark:bg-[#030406] border border-slate-200 dark:border-[#12151C] px-[8px] py-[6px] text-[13px] font-mono tabular-nums text-slate-900 dark:text-[#F3F4F6] rounded-none shadow-none focus:outline-none focus:border-[#C68346]';
    const labelClass =
        'block text-[13px] font-bold uppercase tracking-[0.05em] text-slate-600 dark:text-[#8A93A6] mb-[4px]';

    return (
        <section
            aria-label={t('estructural.title', 'MAPEO ESTRUCTURAL E HIDROGEOLOGÍA EN FAENA')}
            className={`w-full bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] select-none ${
                embedded ? 'p-[13px] space-y-[13px]' : 'p-[21px] space-y-[21px]'
            }`}
        >
            {/* Header & Station Record Selector */}
            <header className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[13px] rounded-none shadow-none space-y-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-[13px]">
                    <div className="min-w-0">
                        <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#C68346]">
                            {t('domains.estructural_hidro', 'ESTRUCTURAL E HIDROGEOLOGÍA')} · {hostScope}
                        </p>
                        <h2 className="text-[17px] font-semibold text-slate-900 dark:text-[#F3F4F6] mt-[2px]">
                            {t('estructural.title', 'MAPEO ESTRUCTURAL E HIDROGEOLOGÍA EN FAENA')}
                        </h2>
                    </div>

                    {!isCreatingNew ? (
                        <button
                            type="button"
                            onClick={() => {
                                setEditingBlock(null);
                                setIsCreatingNew(true);
                                setDraft(createEmptyDraft());
                                setPlaneDraft(createEmptyPlaneDraft());
                                setStatusMessage(null);
                            }}
                            className="px-[13px] py-[8px] bg-[#C68346] text-white text-[13px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none hover:opacity-90 cursor-pointer"
                        >
                            {t('domains.new_record', 'NUEVA ESTACIÓN')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => {
                                setIsCreatingNew(false);
                                setStatusMessage(null);
                            }}
                            className="px-[13px] py-[8px] border border-slate-300 dark:border-[#12151C] bg-white dark:bg-[#030406] text-slate-700 dark:text-[#8A93A6] text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                        >
                            {t('common.cancel_button', 'CANCELAR')}
                        </button>
                    )}
                </div>

                {loadingRecords ? (
                    <M3LinearProgress indeterminate />
                ) : records.length === 0 ? (
                    <p className="text-[13px] text-slate-500 dark:text-[#5A6072]">
                        {t('domains.empty_records', 'No existen estaciones estructurales registradas.')} ·{' '}
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
                {/* MAJOR PANE (61.8%): Pure Interactive SVG Schmidt Stereonet + Planes Table + Hydrogeology */}
                <div className="space-y-[21px] min-w-0">
                    {/* Interactive Schmidt / Lambert Equal-Area Stereonet */}
                    <div className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[21px] rounded-none shadow-none space-y-[13px]">
                        <div className="flex flex-wrap items-center justify-between gap-[8px]">
                            <div>
                                <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                                    {t('estructural.stereonet_title', 'RED EQUIAREAL DE SCHMIDT (HEMISFERIO INFERIOR)')}
                                </p>
                                <p className="font-mono tabular-nums text-[13px] text-slate-600 dark:text-[#8A93A6]">
                                    {t('estructural.planes_count', 'PLANOS REGISTRADOS')}: {activeValues.planes.length}
                                </p>
                            </div>
                            {selectedPlane && (
                                <div className="font-mono tabular-nums text-[13px] text-[#C68346]">
                                    {selectedPlane.structureType} · {selectedPlane.dipDeg.toFixed(1)}° /{' '}
                                    {selectedPlane.dipDirectionDeg.toFixed(1)}° (RHR {selectedPlane.strikeDeg.toFixed(1)}°)
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)] gap-[21px] items-center">
                            <svg
                                viewBox={`0 0 ${STEREONET_SIZE} ${STEREONET_SIZE}`}
                                className="w-full max-w-[360px] h-auto mx-auto bg-white dark:bg-[#030406] border border-slate-200 dark:border-[#12151C] text-slate-800 dark:text-[#F3F4F6]"
                                role="img"
                                aria-label={t('estructural.stereonet_title', 'Red de Schmidt Equiareal Hemisferio Inferior')}
                            >
                                {/* Primitive Circle & Equal-Area Reference Rings */}
                                <circle
                                    cx={STEREONET_CENTER}
                                    cy={STEREONET_CENTER}
                                    r={STEREONET_RADIUS}
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={1.5}
                                    strokeOpacity={0.75}
                                />
                                <circle
                                    cx={STEREONET_CENTER}
                                    cy={STEREONET_CENTER}
                                    r={ring30R}
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={0.75}
                                    strokeDasharray="2 3"
                                    strokeOpacity={0.35}
                                />
                                <circle
                                    cx={STEREONET_CENTER}
                                    cy={STEREONET_CENTER}
                                    r={ring60R}
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={0.75}
                                    strokeDasharray="2 3"
                                    strokeOpacity={0.35}
                                />

                                {/* N-S / E-W Axes */}
                                <line
                                    x1={STEREONET_CENTER}
                                    y1={STEREONET_CENTER - STEREONET_RADIUS}
                                    x2={STEREONET_CENTER}
                                    y2={STEREONET_CENTER + STEREONET_RADIUS}
                                    stroke="currentColor"
                                    strokeWidth={0.75}
                                    strokeOpacity={0.25}
                                />
                                <line
                                    x1={STEREONET_CENTER - STEREONET_RADIUS}
                                    y1={STEREONET_CENTER}
                                    x2={STEREONET_CENTER + STEREONET_RADIUS}
                                    y2={STEREONET_CENTER}
                                    stroke="currentColor"
                                    strokeWidth={0.75}
                                    strokeOpacity={0.25}
                                />

                                {/* Cardinal Labels */}
                                <text
                                    x={STEREONET_CENTER}
                                    y={STEREONET_CENTER - STEREONET_RADIUS - 10}
                                    textAnchor="middle"
                                    fill="currentColor"
                                    fontSize="11"
                                    fontFamily="monospace"
                                >
                                    N 000°
                                </text>
                                <text
                                    x={STEREONET_CENTER + STEREONET_RADIUS + 8}
                                    y={STEREONET_CENTER + 4}
                                    textAnchor="start"
                                    fill="currentColor"
                                    fontSize="11"
                                    fontFamily="monospace"
                                >
                                    E 090°
                                </text>
                                <text
                                    x={STEREONET_CENTER}
                                    y={STEREONET_CENTER + STEREONET_RADIUS + 18}
                                    textAnchor="middle"
                                    fill="currentColor"
                                    fontSize="11"
                                    fontFamily="monospace"
                                >
                                    S 180°
                                </text>
                                <text
                                    x={STEREONET_CENTER - STEREONET_RADIUS - 8}
                                    y={STEREONET_CENTER + 4}
                                    textAnchor="end"
                                    fill="currentColor"
                                    fontSize="11"
                                    fontFamily="monospace"
                                >
                                    W 270°
                                </text>

                                {/* Recorded Structural Planes (Great Circles + Poles) */}
                                {activeValues.planes.map((pl) => {
                                    const greatCircleD = buildEqualAreaGreatCircleSvgPath(
                                        pl.dipDeg,
                                        pl.dipDirectionDeg,
                                        STEREONET_CENTER,
                                        STEREONET_CENTER,
                                        STEREONET_RADIUS,
                                        48
                                    );
                                    const pole = projectEqualAreaPole(
                                        pl.dipDeg,
                                        pl.dipDirectionDeg,
                                        STEREONET_RADIUS
                                    );
                                    const isSelected = selectedPlane?.id === pl.id;
                                    const color = isSelected ? '#C68346' : '#00AEEF';
                                    return (
                                        <g
                                            key={pl.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setSelectedPlaneId(pl.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    setSelectedPlaneId(pl.id);
                                                }
                                            }}
                                            className="cursor-pointer focus:outline-none"
                                        >
                                            <path
                                                d={greatCircleD}
                                                fill="none"
                                                stroke={color}
                                                strokeWidth={isSelected ? 2 : 1.1}
                                                strokeOpacity={isSelected ? 0.95 : 0.6}
                                            />
                                            <circle
                                                cx={STEREONET_CENTER + pole.x}
                                                cy={STEREONET_CENTER + pole.y}
                                                r={isSelected ? 5 : 3.5}
                                                fill={color}
                                                stroke="#000000"
                                                strokeWidth={0.8}
                                            />
                                        </g>
                                    );
                                })}

                                {/* Live Draft Preview */}
                                {showPreviewInNet && previewDip !== null && previewDipDir !== null && (
                                    <g pointerEvents="none">
                                        <path
                                            d={buildEqualAreaGreatCircleSvgPath(
                                                previewDip,
                                                previewDipDir,
                                                STEREONET_CENTER,
                                                STEREONET_CENTER,
                                                STEREONET_RADIUS,
                                                48
                                            )}
                                            fill="none"
                                            stroke="#C68346"
                                            strokeWidth={1.5}
                                            strokeDasharray="4 4"
                                        />
                                        {(() => {
                                            const pPole = projectEqualAreaPole(
                                                previewDip,
                                                previewDipDir,
                                                STEREONET_RADIUS
                                            );
                                            return (
                                                <circle
                                                    cx={STEREONET_CENTER + pPole.x}
                                                    cy={STEREONET_CENTER + pPole.y}
                                                    r={4.5}
                                                    fill="none"
                                                    stroke="#C68346"
                                                    strokeWidth={1.8}
                                                />
                                            );
                                        })()}
                                    </g>
                                )}
                            </svg>

                            {/* Selected Pole Inspection Summary */}
                            <div className="space-y-[13px]">
                                <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-slate-600 dark:text-[#8A93A6]">
                                    INSPECCIÓN DE POLO / PLANO SELECCIONADO
                                </p>
                                {!selectedPlane ? (
                                    <p className="text-[13px] font-mono text-slate-400 dark:text-[#5A6072]">
                                        {UNDECLARED_TECH_VALUE}
                                    </p>
                                ) : (
                                    <dl className="grid grid-cols-2 gap-[13px] text-[13px] border border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#030406] p-[13px]">
                                        <div>
                                            <dt className={labelClass}>{t('estructural.structure_type', 'ESTRUCTURA')}</dt>
                                            <dd className="font-mono font-semibold">{selectedPlane.structureType}</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('estructural.dip_deg', 'MANTEO (deg)')}</dt>
                                            <dd className="font-mono tabular-nums text-[#C68346] font-bold">
                                                {selectedPlane.dipDeg.toFixed(1)}°
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('estructural.dip_dir_deg', 'DIR. MANTEO')}</dt>
                                            <dd className="font-mono tabular-nums text-[#00AEEF] font-bold">
                                                {selectedPlane.dipDirectionDeg.toFixed(1)}°
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('estructural.strike_rhr_deg', 'RUMBO RHR')}</dt>
                                            <dd className="font-mono tabular-nums">{selectedPlane.strikeDeg.toFixed(1)}°</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('estructural.jrc_barton', 'JRC BARTON')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(selectedPlane.jrcBarton, 1)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('estructural.aperture_mm', 'ABERTURA (mm)')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(selectedPlane.apertureMm, 2)}
                                            </dd>
                                        </div>
                                        <div className="col-span-2">
                                            <dt className={labelClass}>{t('estructural.infill', 'RELLENO MINERAL')}</dt>
                                            <dd className="font-mono text-[13px]">
                                                {selectedPlane.infill || UNDECLARED_TECH_VALUE}
                                            </dd>
                                        </div>
                                    </dl>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Creation Form OR Read-Only Technical Report Blocks */}
                    {isCreatingNew ? (
                        <form
                            onSubmit={handleSaveNewRecord}
                            autoComplete="off"
                            spellCheck={false}
                            className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[21px] rounded-none shadow-none space-y-[21px]"
                        >
                            <h3 className="text-[14px] font-semibold uppercase tracking-[0.03em] border-b border-slate-200 dark:border-[#12151C] pb-[13px]">
                                {t('domains.save_record', 'NUEVA ESTACIÓN ESTRUCTURAL E HIDROGEOLÓGICA')}
                            </h3>

                            {/* Identification */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-[13px]">
                                <div>
                                    <label className={labelClass}>{t('domains.record_code', 'CÓDIGO REGISTRO')}</label>
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draft.code}
                                        onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                                        placeholder="EST-STR-01"
                                        className={inputClass}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>{t('domains.record_title', 'TÍTULO TÉCNICO')}</label>
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draft.title}
                                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                                        placeholder="Celda Estructural Banco 2390"
                                        className={inputClass}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>{t('estructural.station_code', 'ESTACIÓN / BANCO')}</label>
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={draft.stationCode}
                                        onChange={(e) => setDraft({ ...draft, stationCode: e.target.value })}
                                        placeholder="CELDA-N4"
                                        className={inputClass}
                                        required
                                    />
                                </div>
                            </div>

                            {/* Structural Planes List & Inline Creator */}
                            <div className="border-t border-slate-200 dark:border-[#12151C] pt-[13px] space-y-[13px]">
                                <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                                    {t('estructural.planes_count', 'PLANOS ESTRUCTURALES EN LA ESTACIÓN')}: {draft.planes.length}
                                </p>
                                {draft.planes.length > 0 && (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[13px] font-mono tabular-nums border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-200 dark:border-[#12151C] text-left text-[13px] text-slate-500 dark:text-[#8A93A6]">
                                                    <th className="py-[6px]">ESTRUCTURA</th>
                                                    <th className="py-[6px]">DIP</th>
                                                    <th className="py-[6px]">DIP DIR</th>
                                                    <th className="py-[6px]">STRIKE RHR</th>
                                                    <th className="py-[6px]">JRC</th>
                                                    <th className="py-[6px]" />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {draft.planes.map((pl) => (
                                                    <tr key={pl.id} className="border-b border-slate-100 dark:border-[#12151C]">
                                                        <td className="py-[6px]">{pl.structureType}</td>
                                                        <td className="py-[6px]">{pl.dipDeg.toFixed(1)}°</td>
                                                        <td className="py-[6px]">{pl.dipDirectionDeg.toFixed(1)}°</td>
                                                        <td className="py-[6px]">{pl.strikeDeg.toFixed(1)}°</td>
                                                        <td className="py-[6px]">{formatNum(pl.jrcBarton, 1)}</td>
                                                        <td className="py-[6px] text-right">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRemovePlaneFromDraft(pl.id)}
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

                            {/* Hydrogeology Piezometer Inputs */}
                            <div className="border-t border-slate-200 dark:border-[#12151C] pt-[13px] space-y-[13px]">
                                <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#C68346]">
                                    {t('estructural.hydro_header', 'HIDROGEOLOGÍA Y PIEZOMETRÍA')}
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-[13px]">
                                    <div>
                                        <label className={labelClass}>{t('estructural.piezometer_id', 'ID PIEZÓMETRO')}</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.piezometerId}
                                            onChange={(e) => setDraft({ ...draft, piezometerId: e.target.value })}
                                            placeholder="PZ-104"
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>
                                            {t('estructural.static_water_level_m', 'COTA NIVEL FREÁTICO (m)')}
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.staticWaterLevelM}
                                            onChange={(e) => setDraft({ ...draft, staticWaterLevelM: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('estructural.well_depth_m', 'PROFUNDIDAD POZO (m)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.wellDepthM}
                                            onChange={(e) => setDraft({ ...draft, wellDepthM: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('estructural.ph', 'pH')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            min={0}
                                            max={14}
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.ph}
                                            onChange={(e) => setDraft({ ...draft, ph: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>
                                            {t('estructural.conductivity_us_cm', 'CONDUCTIVIDAD (uS/cm)')}
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            min={0}
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.conductivityUsCm}
                                            onChange={(e) => setDraft({ ...draft, conductivityUsCm: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>CAUDAL (L/s)</label>
                                        <input
                                            type="number"
                                            step="any"
                                            min={0}
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.flowRateLs}
                                            onChange={(e) => setDraft({ ...draft, flowRateLs: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('estructural.temperature_c', 'TEMPERATURA (°C)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.temperatureC}
                                            onChange={(e) => setDraft({ ...draft, temperatureC: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
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
                                    {saving ? t('domains.saving', 'GUARDANDO...') : t('domains.save_record', 'GUARDAR ESTACIÓN')}
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
                                {t('domains.save_record', 'REGISTRAR PRIMERA ESTACIÓN')}
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-[21px]">
                            {/* Block 1: Station & Planes Table */}
                            <ReportBlockEditable
                                title={t('estructural.station_code', '01. ESTACIÓN GEOTÉCNICA Y PLANOS ESTRUCTURALES')}
                                code={selectedRecord.code}
                                isEditing={editingBlock === 'PLANES' || editingBlock === 'STATION'}
                                canEdit={true}
                                onToggleEdit={() => handleToggleBlockEdit('PLANES')}
                                editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                            >
                                {(editingBlock === 'PLANES' || editingBlock === 'STATION') && (
                                    <div className="mb-[13px] pb-[13px] border-b border-slate-200 dark:border-[#12151C] grid grid-cols-1 sm:grid-cols-3 gap-[13px]">
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
                                            <label className={labelClass}>{t('estructural.station_code', 'ESTACIÓN')}</label>
                                            <input
                                                type="text"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={draft.stationCode}
                                                onChange={(e) => setDraft({ ...draft, stationCode: e.target.value })}
                                                className={inputClass}
                                            />
                                        </div>
                                        <div className="flex items-end justify-end gap-[8px]">
                                            <button
                                                type="button"
                                                onClick={() => handleToggleBlockEdit('PLANES')}
                                                className="px-[13px] py-[7px] border border-slate-300 dark:border-[#12151C] text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                            >
                                                {t('common.cancel_button', 'CANCELAR')}
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
                                )}

                                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-[13px] text-[13px] mb-[13px]">
                                    <div>
                                        <dt className={labelClass}>{t('estructural.station_code', 'ESTACIÓN')}</dt>
                                        <dd className="font-mono font-semibold select-text inline-flex items-center gap-[4px]">
                                            {activeValues.stationCode || UNDECLARED_TECH_VALUE}
                                            {activeValues.stationCode && <CopyButton value={activeValues.stationCode} />}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className={labelClass}>{t('geomensura.easting', 'ESTE (m)')}</dt>
                                        <dd className="font-mono tabular-nums">{formatNum(parseFinite(activeValues.easting), 2)}</dd>
                                    </div>
                                    <div>
                                        <dt className={labelClass}>{t('geomensura.northing', 'NORTE (m)')}</dt>
                                        <dd className="font-mono tabular-nums">{formatNum(parseFinite(activeValues.northing), 2)}</dd>
                                    </div>
                                    <div>
                                        <dt className={labelClass}>{t('geomensura.elevation', 'COTA (m)')}</dt>
                                        <dd className="font-mono tabular-nums">{formatNum(parseFinite(activeValues.elevationM), 2)}</dd>
                                    </div>
                                </dl>

                                {activeValues.planes.length === 0 ? (
                                    <p className="text-[13px] font-mono text-slate-500 dark:text-[#5A6072]">
                                        {UNDECLARED_TECH_VALUE}
                                    </p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[13px] font-mono tabular-nums border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-200 dark:border-[#12151C] text-left text-[13px] text-slate-500 dark:text-[#8A93A6]">
                                                    <th className="py-[6px] pr-[8px]">TIPO</th>
                                                    <th className="py-[6px] pr-[8px]">MANTEO</th>
                                                    <th className="py-[6px] pr-[8px]">DIR. MANTEO</th>
                                                    <th className="py-[6px] pr-[8px]">RUMBO RHR</th>
                                                    <th className="py-[6px] pr-[8px]">JRC</th>
                                                    <th className="py-[6px] pr-[8px]">ABERTURA</th>
                                                    <th className="py-[6px] pr-[8px]">RELLENO</th>
                                                    {editingBlock === 'PLANES' && <th className="py-[6px]" />}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {activeValues.planes.map((pl) => (
                                                    <tr
                                                        key={pl.id}
                                                        onClick={() => setSelectedPlaneId(pl.id)}
                                                        className={`border-b border-slate-100 dark:border-[#12151C] cursor-pointer ${
                                                            selectedPlane?.id === pl.id ? 'bg-slate-100 dark:bg-[#030406]' : ''
                                                        }`}
                                                    >
                                                        <td className="py-[6px] pr-[8px]">{pl.structureType}</td>
                                                        <td className="py-[6px] pr-[8px]">{pl.dipDeg.toFixed(1)}°</td>
                                                        <td className="py-[6px] pr-[8px]">{pl.dipDirectionDeg.toFixed(1)}°</td>
                                                        <td className="py-[6px] pr-[8px]">{pl.strikeDeg.toFixed(1)}°</td>
                                                        <td className="py-[6px] pr-[8px]">{formatNum(pl.jrcBarton, 1)}</td>
                                                        <td className="py-[6px] pr-[8px]">{formatNum(pl.apertureMm, 2)}</td>
                                                        <td className="py-[6px] pr-[8px] font-sans">
                                                            {pl.infill || UNDECLARED_TECH_VALUE}
                                                        </td>
                                                        {editingBlock === 'PLANES' && (
                                                            <td className="py-[6px] text-right">
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleRemovePlaneFromDraft(pl.id);
                                                                    }}
                                                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 cursor-pointer"
                                                                >
                                                                    <span className="material-symbols-outlined text-[16px]">delete</span>
                                                                </button>
                                                            </td>
                                                        )}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </ReportBlockEditable>

                            {/* Block 2: Hydrogeology & Piezometry */}
                            <ReportBlockEditable
                                title={t('estructural.hydro_header', '02. TELEMETRÍA HIDROGEOLÓGICA Y PIEZOMETRÍA')}
                                isEditing={editingBlock === 'HYDRO'}
                                canEdit={true}
                                onToggleEdit={() => handleToggleBlockEdit('HYDRO')}
                                editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                            >
                                {editingBlock === 'HYDRO' ? (
                                    <div className="space-y-[13px]">
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-[13px]">
                                            <div>
                                                <label className={labelClass}>{t('estructural.piezometer_id', 'ID PIEZÓMETRO')}</label>
                                                <input
                                                    type="text"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.piezometerId}
                                                    onChange={(e) => setDraft({ ...draft, piezometerId: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>
                                                    {t('estructural.static_water_level_m', 'COTA NIVEL FREÁTICO (m)')}
                                                </label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.staticWaterLevelM}
                                                    onChange={(e) => setDraft({ ...draft, staticWaterLevelM: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('estructural.well_depth_m', 'PROF. POZO (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.wellDepthM}
                                                    onChange={(e) => setDraft({ ...draft, wellDepthM: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('estructural.ph', 'pH')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    min={0}
                                                    max={14}
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.ph}
                                                    onChange={(e) => setDraft({ ...draft, ph: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>
                                                    {t('estructural.conductivity_us_cm', 'CONDUCTIVIDAD (uS/cm)')}
                                                </label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    min={0}
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.conductivityUsCm}
                                                    onChange={(e) => setDraft({ ...draft, conductivityUsCm: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>CAUDAL (L/s)</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    min={0}
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.flowRateLs}
                                                    onChange={(e) => setDraft({ ...draft, flowRateLs: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('estructural.temperature_c', 'TEMPERATURA (°C)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.temperatureC}
                                                    onChange={(e) => setDraft({ ...draft, temperatureC: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                        </div>
                                        <div className="flex justify-end gap-[8px]">
                                            <button
                                                type="button"
                                                onClick={() => handleToggleBlockEdit('HYDRO')}
                                                className="px-[13px] py-[8px] border border-slate-300 dark:border-[#12151C] text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                            >
                                                {t('common.cancel_button', 'CANCELAR')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleRequestHitlReview}
                                                className="px-[13px] py-[8px] bg-[#C68346] text-white text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                            >
                                                {t('domains.hitl_submit', 'ACTUALIZAR HITL')}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-[13px] text-[13px]">
                                        <div>
                                            <dt className={labelClass}>{t('estructural.piezometer_id', 'ID PIEZÓMETRO')}</dt>
                                            <dd className="font-mono font-semibold">
                                                {activeValues.piezometerId || UNDECLARED_TECH_VALUE}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>
                                                {t('estructural.static_water_level_m', 'COTA NIVEL FREÁTICO (m)')}
                                            </dt>
                                            <dd className="font-mono tabular-nums text-[#00AEEF]">
                                                {formatNum(parseFinite(activeValues.staticWaterLevelM), 2)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('estructural.well_depth_m', 'PROF. POZO (m)')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(parseFinite(activeValues.wellDepthM), 2)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('estructural.ph', 'pH')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(parseFinite(activeValues.ph), 2)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>
                                                {t('estructural.conductivity_us_cm', 'CONDUCTIVIDAD (uS/cm)')}
                                            </dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(parseFinite(activeValues.conductivityUsCm), 1)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>CAUDAL (L/s)</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(parseFinite(activeValues.flowRateLs), 3)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('estructural.temperature_c', 'TEMPERATURA (°C)')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(parseFinite(activeValues.temperatureC), 1)}
                                            </dd>
                                        </div>
                                    </dl>
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
                                                {t('domains.hitl_submit', 'ACTUALIZAR HITL')}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-[6px] text-[13px]">
                                        <p className="text-slate-700 dark:text-[#8A93A6] whitespace-pre-wrap">
                                            {activeValues.notes || UNDECLARED_TECH_VALUE}
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

                {/* MINOR PANE (38.2%): IMU Clinometer + XCover 1015 Capture + Plane Entry + GNSS RTK + PDF */}
                <aside className="space-y-[21px] min-w-0">
                    {/* IMU Clinometer + Plane Capture Card */}
                    <div className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[13px] rounded-none shadow-none space-y-[13px]">
                        <div className="flex items-center justify-between gap-[8px]">
                            <h3 className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#C68346]">
                                {t('adapters.imu_title', 'BRÚJULA DIGITAL E INCLINÓMETRO IMU')}
                            </h3>
                            <span className="text-[13px] font-mono text-slate-500 dark:text-[#8A93A6]">
                                XCOVER KEY 1015
                            </span>
                        </div>

                        {!imu.isSupported && (
                            <p className="text-[13px] font-mono text-slate-500 dark:text-[#5A6072]">
                                {t('adapters.imu_unavailable', 'Sensores IMU no disponibles; habilitada entrada manual validada.')}
                            </p>
                        )}
                        {imu.error && (
                            <p className="text-[13px] font-mono text-red-600 dark:text-red-400">{imu.error}</p>
                        )}

                        <div className="grid grid-cols-2 gap-[8px]">
                            <div>
                                <label className={labelClass}>AZIMUT BRÚJULA (deg)</label>
                                <input
                                    type="number"
                                    min={0}
                                    max={360}
                                    step="any"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={compassAzimuthDeg}
                                    onChange={(e) => setCompassAzimuthDeg(e.target.value)}
                                    className={inputClass}
                                />
                            </div>
                            <div className="border border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#030406] p-[8px]">
                                <span className={labelClass}>LECTURA IMU EN VIVO</span>
                                <p className="font-mono tabular-nums text-[13px]">
                                    DIP {liveImuAttitude.dipDeg.toFixed(1)}° / DD {liveImuAttitude.dipDirectionDeg.toFixed(1)}°
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-[8px]">
                            {!imu.isListening ? (
                                <button
                                    type="button"
                                    disabled={!imu.isSupported}
                                    onClick={() => {
                                        void imu.startListening();
                                    }}
                                    className="flex-1 px-[13px] py-[8px] border border-[#00AEEF] bg-white dark:bg-[#030406] text-[#00AEEF] text-[13px] font-bold uppercase rounded-none shadow-none disabled:opacity-40 cursor-pointer"
                                >
                                    {t('adapters.imu_capture', 'ACTIVAR CLINÓMETRO IMU')}
                                </button>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={captureImuAttitudeIntoDraft}
                                        className="flex-1 px-[13px] py-[8px] bg-[#C68346] text-white text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                    >
                                        FIJAR ACTITUD IMU
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => imu.stopListening()}
                                        className="px-[13px] py-[8px] border border-slate-300 dark:border-[#12151C] text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                    >
                                        DETENER
                                    </button>
                                </>
                            )}
                        </div>

                        {/* Manual / Captured Plane Form */}
                        <div className="border-t border-slate-200 dark:border-[#12151C] pt-[13px] space-y-[13px]">
                            <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-slate-600 dark:text-[#8A93A6]">
                                {t('adapters.manual_entry', 'REGISTRO DE PLANO ESTRUCTURAL')}
                            </p>
                            <div className="grid grid-cols-2 gap-[8px]">
                                <div className="col-span-2">
                                    <label className={labelClass}>{t('estructural.structure_type', 'TIPO ESTRUCTURA')}</label>
                                    <select
                                        value={planeDraft.structureType}
                                        onChange={(e) =>
                                            setPlaneDraft({
                                                ...planeDraft,
                                                structureType: e.target.value as EstructuralPlaneItem['structureType'],
                                            })
                                        }
                                        className={inputClass}
                                    >
                                        {STRUCTURE_TYPES.map((st) => (
                                            <option key={st.value} value={st.value}>
                                                {t(st.labelKey, st.fallback)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className={labelClass}>{t('estructural.dip_deg', 'MANTEO (0..90°)')}</label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={90}
                                        step="any"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={planeDraft.dipDeg}
                                        onChange={(e) => setPlaneDraft({ ...planeDraft, dipDeg: e.target.value })}
                                        className={inputClass}
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>
                                        {t('estructural.dip_dir_deg', 'DIR. MANTEO (0..360°)')}
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={360}
                                        step="any"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={planeDraft.dipDirectionDeg}
                                        onChange={(e) =>
                                            setPlaneDraft({ ...planeDraft, dipDirectionDeg: e.target.value })
                                        }
                                        className={inputClass}
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>{t('estructural.jrc_barton', 'JRC BARTON (0..20)')}</label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={20}
                                        step="any"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={planeDraft.jrcBarton}
                                        onChange={(e) => setPlaneDraft({ ...planeDraft, jrcBarton: e.target.value })}
                                        className={inputClass}
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>{t('estructural.aperture_mm', 'ABERTURA (mm)')}</label>
                                    <input
                                        type="number"
                                        min={0}
                                        step="any"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={planeDraft.apertureMm}
                                        onChange={(e) => setPlaneDraft({ ...planeDraft, apertureMm: e.target.value })}
                                        className={inputClass}
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className={labelClass}>{t('estructural.infill', 'RELLENO MINERAL')}</label>
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={planeDraft.infill}
                                        onChange={(e) => setPlaneDraft({ ...planeDraft, infill: e.target.value })}
                                        placeholder="Calcita / Crisocola / Arcilla"
                                        className={inputClass}
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-[8px] text-[13px] font-mono tabular-nums text-slate-600 dark:text-[#8A93A6]">
                                <span>
                                    {t('estructural.strike_rhr_deg', 'RUMBO RHR')}:{' '}
                                    {planeDraftStrikeRhr !== null ? `${planeDraftStrikeRhr.toFixed(1)}°` : UNDECLARED_TECH_VALUE}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!isCreatingNew && editingBlock !== 'PLANES' && selectedRecord) {
                                            setDraft(recordToDraft(selectedRecord));
                                            setEditingBlock('PLANES');
                                        }
                                        handleAddPlaneToDraft();
                                    }}
                                    className="px-[13px] py-[7px] bg-[#00AEEF] text-white text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                >
                                    {t('estructural.add_plane', 'AGREGAR PLANO')}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* External Sensors GNSS RTK Panel */}
                    <div className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[13px] rounded-none shadow-none">
                        <ExternalSensorsPanel
                            tenantId={tenantId}
                            uploadCas={true}
                            compact={true}
                            onRtkFixCaptured={handleRtkFixCaptured}
                        />
                    </div>

                    {/* PDF Dossier & CAS Export Panel */}
                    {selectedRecord && !isCreatingNew && (
                        <div className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[13px] rounded-none shadow-none space-y-[13px]">
                            <h3 className="text-[13px] font-bold uppercase tracking-[0.05em] text-slate-600 dark:text-[#8A93A6]">
                                {t('pdf.vector_certificate', 'DOSSIER PDF VECTORIAL (CON RED SCHMIDT)')}
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

export default EstructuralHidroWorkspace;
