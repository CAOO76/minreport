import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
    GeolappDomainRecord,
    GeolappDomainRecordStatus,
    GeolappDomainUtmFix,
    GeomensuraPolygonVertex,
    GeomensuraSurveyPayload,
    HitlFieldDiff,
} from '../core/types/GeolappTypes';
import type {
    GnssRtkFixRecord,
    SurfacePointCloudSummary,
} from '../core/adapters/ISurfaceSourceAdapter';
import {
    dataService,
    type GeolappDomainRecordHitlPatch,
} from '../core/services/DataService';
import {
    computeUtmPolygonMensura,
    computeUtmStakeout,
} from '../core/utils/geoscienceCalculations';
import {
    generateGeolappDomainDossierPdf,
    type GeolappDomainPdfResult,
} from '../core/utils/vectorPdfGenerator';
import {
    buildCanonicalGeoFix,
    resolveUtmLatitudeBand,
    utmToWgs84,
    wgs84ToUtm,
} from '../../../core/geo/wgs84UtmProjection';
import { geoCaptureService } from '../../../core/geo/GeoCaptureService';
import { SovereignGeoMapLazy } from '../../../components/geo/SovereignGeoMapLazy';
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

export interface GeolappDomainWorkspaceProps {
    embedded?: boolean;
    hostScope?: 'CLIENT' | 'DEV_GATEWAY' | 'TEST_PILOT';
    tenantId: string;
    userId: string;
}

interface GeomensuraDraftState {
    code: string;
    title: string;
    status: GeolappDomainRecordStatus;
    notes: string;
    utmFix: GeolappDomainUtmFix | null;
    stationCode: string;
    stationEasting: string;
    stationNorthing: string;
    stationElevationM: string;
    utmZone: string;
    hemisphere: 'N' | 'S';
    targetCode: string;
    targetEasting: string;
    targetNorthing: string;
    targetElevationM: string;
    polygonVertices: GeomensuraPolygonVertex[];
    rtkFixQuality: string | null;
    hdop: string;
}

function createEmptyDraft(): GeomensuraDraftState {
    return {
        code: '',
        title: '',
        status: 'ACTIVE',
        notes: '',
        utmFix: null,
        stationCode: '',
        stationEasting: '',
        stationNorthing: '',
        stationElevationM: '',
        utmZone: '19',
        hemisphere: 'S',
        targetCode: '',
        targetEasting: '',
        targetNorthing: '',
        targetElevationM: '',
        polygonVertices: [],
        rtkFixQuality: null,
        hdop: '',
    };
}

function recordToDraft(record: GeolappDomainRecord): GeomensuraDraftState {
    const p = record.payload as GeomensuraSurveyPayload;
    return {
        code: record.code || '',
        title: record.title || '',
        status: record.status || 'ACTIVE',
        notes: record.notes || '',
        utmFix: record.utmFix ?? null,
        stationCode: p.stationCode || '',
        stationEasting: Number.isFinite(p.stationEasting) ? String(p.stationEasting) : '',
        stationNorthing: Number.isFinite(p.stationNorthing) ? String(p.stationNorthing) : '',
        stationElevationM: Number.isFinite(p.stationElevationM) ? String(p.stationElevationM) : '',
        utmZone: Number.isFinite(p.utmZone) ? String(p.utmZone) : '19',
        hemisphere: p.hemisphere === 'N' ? 'N' : 'S',
        targetCode: p.targetCode || '',
        targetEasting: p.targetEasting !== undefined && p.targetEasting !== null ? String(p.targetEasting) : '',
        targetNorthing: p.targetNorthing !== undefined && p.targetNorthing !== null ? String(p.targetNorthing) : '',
        targetElevationM: p.targetElevationM !== undefined && p.targetElevationM !== null ? String(p.targetElevationM) : '',
        polygonVertices: Array.isArray(p.polygonVertices)
            ? p.polygonVertices.map((v) => ({ ...v }))
            : [],
        rtkFixQuality: p.rtkFixQuality ?? null,
        hdop: p.hdop !== undefined && p.hdop !== null ? String(p.hdop) : '',
    };
}

function parseFinite(val: string): number | null {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}

function formatNum(val: number | null | undefined, digits = 3): string {
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

export function GeomensuraWorkspace({
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

    // Surgical block editing state (Report Mode Read-Only by default)
    const [editingBlock, setEditingBlock] = useState<'SURVEY' | 'POLYGON' | 'NOTES' | null>(null);
    const [draft, setDraft] = useState<GeomensuraDraftState>(() => createEmptyDraft());

    // Add-vertex micro-form inside polygon editor
    const [vertexCode, setVertexCode] = useState<string>('');
    const [vertexEasting, setVertexEasting] = useState<string>('');
    const [vertexNorthing, setVertexNorthing] = useState<string>('');
    const [vertexElevation, setVertexElevation] = useState<string>('');

    // Sensor routing mode: RTK fix updates either BASE station or TARGET point
    const [rtkAssignMode, setRtkAssignMode] = useState<'STATION' | 'TARGET'>('STATION');
    const [lastSurfaceSummary, setLastSurfaceSummary] = useState<SurfacePointCloudSummary | null>(null);

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

    // Bind tenant context and subscribe to real domain records
    useEffect(() => {
        let active = true;
        dataService.setTenantContext({ tenantId, userId });
        setLoadingRecords(true);

        const unsubscribe = dataService.subscribeToDomainRecords('GEOMENSURA_GEO', (items) => {
            if (!active) return;
            setRecords(items);
            setLoadingRecords(false);
            setSelectedRecordId((prev) => {
                if (prev && items.some((r) => r.id === prev)) return prev;
                return items.length > 0 ? items[0].id : null;
            });
        });

        dataService
            .listDomainRecords('GEOMENSURA_GEO')
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

    // Sync draft whenever selectedRecord changes while not editing
    useEffect(() => {
        if (!isCreatingNew && selectedRecord && editingBlock === null) {
            setDraft(recordToDraft(selectedRecord));
            setLastPdfCas(null);
        } else if (!isCreatingNew && !selectedRecord && editingBlock === null) {
            setDraft(createEmptyDraft());
        }
    }, [selectedRecord, isCreatingNew, editingBlock]);

    // Active view source: read-only displays selectedRecord payload; creation/edit uses live draft
    const activeValues = useMemo(() => {
        if (!isCreatingNew && editingBlock === null && selectedRecord) {
            return recordToDraft(selectedRecord);
        }
        return draft;
    }, [isCreatingNew, editingBlock, selectedRecord, draft]);

    const stakeoutCalc = useMemo(() => {
        const sE = parseFinite(activeValues.stationEasting);
        const sN = parseFinite(activeValues.stationNorthing);
        const sZ = parseFinite(activeValues.stationElevationM);
        const tE = parseFinite(activeValues.targetEasting);
        const tN = parseFinite(activeValues.targetNorthing);
        const tZ = parseFinite(activeValues.targetElevationM);
        if (sE === null || sN === null || sZ === null || tE === null || tN === null || tZ === null) {
            return null;
        }
        return computeUtmStakeout(
            { easting: sE, northing: sN, elevationM: sZ },
            { easting: tE, northing: tN, elevationM: tZ }
        );
    }, [activeValues]);

    const polygonCalc = useMemo(() => {
        if (!activeValues.polygonVertices || activeValues.polygonVertices.length < 3) {
            return null;
        }
        return computeUtmPolygonMensura(
            activeValues.polygonVertices.map((v) => ({
                easting: v.easting,
                northing: v.northing,
            }))
        );
    }, [activeValues.polygonVertices]);

    // Convert UTM point (prioritize target if valid, else station) to WGS84 for SovereignGeoMapLazy
    const mapGeoFix: ReturnType<typeof buildCanonicalGeoFix> | null = useMemo(() => {
        const zone = parseFinite(activeValues.utmZone);
        if (zone === null || zone < 1 || zone > 60) return null;

        const tE = parseFinite(activeValues.targetEasting);
        const tN = parseFinite(activeValues.targetNorthing);
        const tZ = parseFinite(activeValues.targetElevationM);
        const sE = parseFinite(activeValues.stationEasting);
        const sN = parseFinite(activeValues.stationNorthing);
        const sZ = parseFinite(activeValues.stationElevationM);

        const eastingM = tE !== null && tN !== null ? tE : sE;
        const northingM = tE !== null && tN !== null ? tN : sN;
        const altitudeM = tE !== null && tN !== null ? tZ : sZ;

        if (eastingM === null || northingM === null) return null;
        try {
            const { lat, lng } = utmToWgs84({
                zone: Math.round(zone),
                hemisphere: activeValues.hemisphere,
                eastingM,
                northingM,
            });
            return buildCanonicalGeoFix({
                lat,
                lng,
                altitudeM,
                accuracyM: parseFinite(activeValues.hdop) ?? activeValues.utmFix?.accuracyM ?? null,
                source: 'MANUAL_INPUT',
                forcedZone: Math.round(zone),
            });
        } catch {
            return null;
        }
    }, [activeValues]);

    const buildPayloadFromDraft = useCallback(
        (sourceDraft: GeomensuraDraftState): { payload: GeomensuraSurveyPayload | null; error: string | null } => {
            const sE = parseFinite(sourceDraft.stationEasting);
            const sN = parseFinite(sourceDraft.stationNorthing);
            const sZ = parseFinite(sourceDraft.stationElevationM);
            const zone = parseFinite(sourceDraft.utmZone);

            if (!sourceDraft.stationCode.trim() || sE === null || sN === null || sZ === null || zone === null) {
                return {
                    payload: null,
                    error: t(
                        'geomensura.missing_station_fields',
                        'Complete estación base, Este, Norte, Cota y Zona UTM válidos.'
                    ),
                };
            }

            const tE = parseFinite(sourceDraft.targetEasting);
            const tN = parseFinite(sourceDraft.targetNorthing);
            const tZ = parseFinite(sourceDraft.targetElevationM);

            const hasPartialTarget =
                (tE !== null || tN !== null || tZ !== null) && (tE === null || tN === null || tZ === null);
            if (hasPartialTarget) {
                return {
                    payload: null,
                    error: t(
                        'geomensura.incomplete_target_fields',
                        'Si declara punto objetivo, complete Este, Norte y Cota.'
                    ),
                };
            }

            const stakeout =
                tE !== null && tN !== null && tZ !== null
                    ? computeUtmStakeout(
                          { easting: sE, northing: sN, elevationM: sZ },
                          { easting: tE, northing: tN, elevationM: tZ }
                      )
                    : null;

            const poly =
                sourceDraft.polygonVertices.length >= 3
                    ? computeUtmPolygonMensura(
                          sourceDraft.polygonVertices.map((v) => ({
                              easting: v.easting,
                              northing: v.northing,
                          }))
                      )
                    : null;

            if (sourceDraft.polygonVertices.length > 0 && sourceDraft.polygonVertices.length < 3) {
                return {
                    payload: null,
                    error: t(
                        'geomensura.invalid_polygon',
                        'Se requieren al menos 3 vértices no colineales con área positiva.'
                    ),
                };
            }
            if (sourceDraft.polygonVertices.length >= 3 && !poly) {
                return {
                    payload: null,
                    error: t(
                        'geomensura.invalid_polygon',
                        'Se requieren al menos 3 vértices no colineales con área positiva.'
                    ),
                };
            }

            const payload: GeomensuraSurveyPayload = {
                stationCode: sourceDraft.stationCode.trim(),
                stationEasting: sE,
                stationNorthing: sN,
                stationElevationM: sZ,
                utmZone: Math.min(60, Math.max(1, Math.round(zone))),
                hemisphere: sourceDraft.hemisphere,
                ...(tE !== null && tN !== null && tZ !== null
                    ? {
                          targetCode: sourceDraft.targetCode.trim() || 'OBJ-01',
                          targetEasting: tE,
                          targetNorthing: tN,
                          targetElevationM: tZ,
                          deltaE: stakeout?.deltaE,
                          deltaN: stakeout?.deltaN,
                          deltaZ: stakeout?.deltaZ,
                          horizontalDistanceM: stakeout?.horizontalDistanceM,
                          slopeDistanceM: stakeout?.slopeDistanceM,
                          azimuthDeg: stakeout?.azimuthDeg,
                          slopePct: stakeout?.slopePct,
                      }
                    : {}),
                ...(sourceDraft.polygonVertices.length >= 3
                    ? {
                          polygonVertices: sourceDraft.polygonVertices,
                          polygonAreaM2: poly?.areaM2 ?? null,
                          polygonPerimeterM: poly?.perimeterM ?? null,
                      }
                    : {}),
                rtkFixQuality: sourceDraft.rtkFixQuality,
                hdop: parseFinite(sourceDraft.hdop),
            };

            return { payload, error: null };
        },
        [t]
    );

    const buildUtmFixFromStation = (sourceDraft: GeomensuraDraftState): GeolappDomainUtmFix | null => {
        if (sourceDraft.utmFix) return sourceDraft.utmFix;
        const sE = parseFinite(sourceDraft.stationEasting);
        const sN = parseFinite(sourceDraft.stationNorthing);
        const sZ = parseFinite(sourceDraft.stationElevationM);
        const zone = parseFinite(sourceDraft.utmZone);
        if (sE === null || sN === null || zone === null) return null;
        try {
            const { lat } = utmToWgs84({
                zone: Math.round(zone),
                hemisphere: sourceDraft.hemisphere,
                eastingM: sE,
                northingM: sN,
            });
            return {
                zone: Math.round(zone),
                band: resolveUtmLatitudeBand(lat),
                hemisphere: sourceDraft.hemisphere,
                easting: sE,
                northing: sN,
                altitudeM: sZ,
                accuracyM: parseFinite(sourceDraft.hdop),
                fixQuality: sourceDraft.rtkFixQuality,
            };
        } catch {
            return null;
        }
    };

    const handleStartCreate = () => {
        setEditingBlock(null);
        setIsCreatingNew(true);
        setDraft(createEmptyDraft());
        setStatusMessage(null);
        setLastPdfCas(null);
    };

    const handleCancelCreate = () => {
        setIsCreatingNew(false);
        setStatusMessage(null);
        if (selectedRecord) {
            setDraft(recordToDraft(selectedRecord));
        } else {
            setDraft(createEmptyDraft());
        }
    };

    const handleSaveNewRecord = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!draft.code.trim() || !draft.title.trim()) {
            setStatusMessage({
                kind: 'error',
                text: t('geomensura.missing_record_meta', 'Código de registro y título técnico son obligatorios.'),
            });
            return;
        }
        const { payload, error } = buildPayloadFromDraft(draft);
        if (!payload || error) {
            setStatusMessage({ kind: 'error', text: error || t('domains.save_error', 'Error al guardar registro.') });
            return;
        }

        setSaving(true);
        setStatusMessage(null);
        try {
            const saved = await dataService.saveDomainRecord({
                tenantId,
                domainMode: 'GEOMENSURA_GEO',
                code: draft.code.trim(),
                title: draft.title.trim(),
                status: draft.status,
                utmFix: buildUtmFixFromStation(draft) ?? undefined,
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
                        : t('hitl.save_success', 'Registro consolidado en base única.'),
            });
        } catch (err) {
            setStatusMessage({
                kind: 'error',
                text: err instanceof Error ? err.message : t('hitl.save_error', 'Error al guardar registro.'),
            });
        } finally {
            setSaving(false);
        }
    };

    const handleToggleBlockEdit = (block: 'SURVEY' | 'POLYGON' | 'NOTES') => {
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
            setStatusMessage({ kind: 'error', text: error || t('hitl.save_error', 'Validación técnica incompleta.') });
            return;
        }
        if (!draft.title.trim()) {
            setStatusMessage({
                kind: 'error',
                text: t('geomensura.missing_record_meta', 'El título técnico no puede quedar vacío.'),
            });
            return;
        }

        const prev = selectedRecord.payload as GeomensuraSurveyPayload;
        const comparisons: HitlComparisonDiffItem[] = [];
        const auditDiffs: HitlFieldDiff[] = [];

        const pushDiff = (label: string, field: string, beforeVal: unknown, afterVal: unknown) => {
            const bStr = beforeVal === null || beforeVal === undefined || beforeVal === '' ? UNDECLARED_TECH_VALUE : String(beforeVal);
            const aStr = afterVal === null || afterVal === undefined || afterVal === '' ? UNDECLARED_TECH_VALUE : String(afterVal);
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
        pushDiff(t('geomensura.station_code', 'CÓDIGO ESTACIÓN'), 'payload.stationCode', prev.stationCode, payload.stationCode);
        pushDiff(t('geomensura.easting', 'ESTE ESTACIÓN (m)'), 'payload.stationEasting', prev.stationEasting, payload.stationEasting);
        pushDiff(t('geomensura.northing', 'NORTE ESTACIÓN (m)'), 'payload.stationNorthing', prev.stationNorthing, payload.stationNorthing);
        pushDiff(t('geomensura.elevation', 'COTA ESTACIÓN (m)'), 'payload.stationElevationM', prev.stationElevationM, payload.stationElevationM);
        pushDiff(t('geomensura.target_code', 'OBJETIVO'), 'payload.targetCode', prev.targetCode ?? null, payload.targetCode ?? null);
        pushDiff(t('geomensura.horizontal_distance', 'DIST. HORIZONTAL (m)'), 'payload.horizontalDistanceM', prev.horizontalDistanceM ?? null, payload.horizontalDistanceM ?? null);
        pushDiff(t('geomensura.area_m2', 'ÁREA POLIGONAL (m2)'), 'payload.polygonAreaM2', prev.polygonAreaM2 ?? null, payload.polygonAreaM2 ?? null);
        pushDiff(t('geomensura.perimeter_m', 'PERÍMETRO (m)'), 'payload.polygonPerimeterM', prev.polygonPerimeterM ?? null, payload.polygonPerimeterM ?? null);
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
                utmFix: buildUtmFixFromStation(draft) ?? undefined,
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
                        : t('hitl.save_success', 'Registro actualizado y firmado en AuditLedger.'),
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

    const handleMapSelectCoordinates = ({
        lat,
        lng,
        fix,
    }: {
        lat: number;
        lng: number;
        fix: ReturnType<typeof buildCanonicalGeoFix>;
    }) => {
        if (!isCreatingNew && editingBlock === null) return;
        const zone = parseFinite(draft.utmZone) ?? fix.utm.zone;
        const proj = wgs84ToUtm(lat, lng, Math.round(zone));
        setDraft((prev) => ({
            ...prev,
            utmZone: String(proj.zone),
            hemisphere: proj.hemisphere,
            targetCode: prev.targetCode.trim() || 'PT-MAP',
            targetEasting: proj.eastingM.toFixed(3),
            targetNorthing: proj.northingM.toFixed(3),
            targetElevationM:
                prev.targetElevationM.trim() ||
                prev.stationElevationM.trim() ||
                (fix.altitudeM !== null ? String(fix.altitudeM) : '0'),
        }));
    };

    const handleCaptureDeviceGeo = async () => {
        if (!isCreatingNew && editingBlock === null) return;
        try {
            const fix = await geoCaptureService.captureCurrentPosition();
            setDraft((prev) => ({
                ...prev,
                utmZone: String(fix.utm.zone),
                hemisphere: fix.utm.hemisphere,
                stationCode: prev.stationCode.trim() || 'EST-GNSS',
                stationEasting: fix.utm.eastingM.toFixed(3),
                stationNorthing: fix.utm.northingM.toFixed(3),
                stationElevationM:
                    fix.altitudeM !== null ? fix.altitudeM.toFixed(2) : prev.stationElevationM || '0',
                hdop: fix.accuracyM !== null ? fix.accuracyM.toFixed(2) : prev.hdop,
                rtkFixQuality: prev.rtkFixQuality || 'DEVICE_GNSS',
                utmFix: {
                    zone: fix.utm.zone,
                    band: fix.utm.band,
                    hemisphere: fix.utm.hemisphere,
                    easting: fix.utm.eastingM,
                    northing: fix.utm.northingM,
                    altitudeM: fix.altitudeM,
                    accuracyM: fix.accuracyM,
                    fixQuality: prev.rtkFixQuality || 'DEVICE_GNSS',
                },
            }));
        } catch (err) {
            setStatusMessage({
                kind: 'error',
                text: err instanceof Error ? err.message : t('adapters.gnss_error', 'No fue posible capturar GNSS del dispositivo.'),
            });
        }
    };

    const handleRtkFixCaptured = (fix: GnssRtkFixRecord) => {
        // If viewing Read-Only, automatically start creation if no record selected, or enter SURGICAL SURVEY edit
        if (!isCreatingNew && editingBlock === null) {
            if (selectedRecord) {
                setDraft(recordToDraft(selectedRecord));
                setEditingBlock('SURVEY');
            } else {
                setIsCreatingNew(true);
            }
        }

        const hemisphere: 'N' | 'S' = fix.latitude >= 0 ? 'N' : 'S';
        const utmFix: GeolappDomainUtmFix = {
            zone: fix.utmZone,
            band: fix.utmBand,
            hemisphere,
            easting: fix.easting,
            northing: fix.northing,
            altitudeM: fix.orthometricAltitudeM,
            accuracyM: fix.hdop,
            fixQuality: fix.fixQuality,
        };

        setDraft((prev) => {
            if (rtkAssignMode === 'TARGET') {
                return {
                    ...prev,
                    utmZone: String(fix.utmZone),
                    hemisphere,
                    targetCode: prev.targetCode.trim() || `RTK-${fix.fixQuality}`,
                    targetEasting: fix.easting.toFixed(3),
                    targetNorthing: fix.northing.toFixed(3),
                    targetElevationM:
                        fix.orthometricAltitudeM !== null
                            ? fix.orthometricAltitudeM.toFixed(3)
                            : prev.targetElevationM,
                    rtkFixQuality: fix.fixQuality,
                    hdop: fix.hdop !== null ? String(fix.hdop) : prev.hdop,
                };
            }
            return {
                ...prev,
                utmZone: String(fix.utmZone),
                hemisphere,
                stationCode: prev.stationCode.trim() || `EST-${fix.fixQuality}`,
                stationEasting: fix.easting.toFixed(3),
                stationNorthing: fix.northing.toFixed(3),
                stationElevationM:
                    fix.orthometricAltitudeM !== null
                        ? fix.orthometricAltitudeM.toFixed(3)
                        : prev.stationElevationM,
                rtkFixQuality: fix.fixQuality,
                hdop: fix.hdop !== null ? String(fix.hdop) : prev.hdop,
                utmFix,
            };
        });
    };

    const handleSurfaceImported = (summary: SurfacePointCloudSummary) => {
        setLastSurfaceSummary(summary);
    };

    const handleAddVertex = () => {
        const eVal = parseFinite(vertexEasting);
        const nVal = parseFinite(vertexNorthing);
        const zVal = parseFinite(vertexElevation);
        if (eVal === null || nVal === null) return;
        const nextCode = vertexCode.trim() || `V-${draft.polygonVertices.length + 1}`;
        setDraft((prev) => ({
            ...prev,
            polygonVertices: [
                ...prev.polygonVertices,
                {
                    code: nextCode,
                    easting: eVal,
                    northing: nVal,
                    ...(zVal !== null ? { elevationM: zVal } : {}),
                },
            ],
        }));
        setVertexCode('');
        setVertexEasting('');
        setVertexNorthing('');
        setVertexElevation('');
    };

    const handleRemoveVertex = (idx: number) => {
        setDraft((prev) => ({
            ...prev,
            polygonVertices: prev.polygonVertices.filter((_, i) => i !== idx),
        }));
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

    const canEditSelected = Boolean(selectedRecord && !isCreatingNew);
    const inputClass =
        'w-full bg-white dark:bg-[#030406] border border-slate-200 dark:border-[#12151C] px-[8px] py-[6px] text-[13px] font-mono tabular-nums text-slate-900 dark:text-[#F3F4F6] rounded-none shadow-none focus:outline-none focus:border-[#C68346]';
    const labelClass =
        'block text-[13px] font-bold uppercase tracking-[0.05em] text-slate-600 dark:text-[#8A93A6] mb-[4px]';

    return (
        <section
            aria-label={t('geomensura.title', 'GEOMENSURA TOPOGRÁFICA Y REPLANTEO UTM')}
            className={`w-full bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] select-none ${
                embedded ? 'p-[13px] space-y-[13px]' : 'p-[21px] space-y-[21px]'
            }`}
        >
            {/* Workspace Header + Record Selector Bar */}
            <header className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[13px] rounded-none shadow-none flex flex-col gap-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-[13px]">
                    <div className="min-w-0">
                        <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#C68346]">
                            {t('domains.geomensura_geo', 'GEOMENSURA Y REPLANTEO UTM')} · {hostScope}
                        </p>
                        <h2 className="text-[17px] font-semibold text-slate-900 dark:text-[#F3F4F6] mt-[2px]">
                            {t('geomensura.title', 'GEOMENSURA TOPOGRÁFICA Y REPLANTEO UTM')}
                        </h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-[8px]">
                        {!isCreatingNew ? (
                            <button
                                type="button"
                                onClick={handleStartCreate}
                                className="px-[13px] py-[8px] bg-[#C68346] text-white text-[13px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none hover:opacity-90 transition-opacity cursor-pointer"
                            >
                                {t('domains.new_record', 'NUEVO REGISTRO')}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleCancelCreate}
                                className="px-[13px] py-[8px] border border-slate-300 dark:border-[#12151C] bg-white dark:bg-[#030406] text-slate-700 dark:text-[#8A93A6] text-[13px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none cursor-pointer"
                            >
                                {t('common.cancel_button', 'CANCELAR')}
                            </button>
                        )}
                    </div>
                </div>

                {/* Record Pills Strip */}
                {loadingRecords ? (
                    <M3LinearProgress indeterminate ariaLabel={t('common.loading', 'CARGANDO...')} />
                ) : records.length === 0 ? (
                    <p className="text-[13px] text-slate-500 dark:text-[#5A6072]">
                        {t('domains.empty_records', 'No existen registros almacenados en el dominio seleccionado.')} ·{' '}
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
                                            ? 'border-[#C68346] bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6]'
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
                {/* MAJOR PANE (61.8%): Sovereign Geo Map + Report/Form Technical Blocks */}
                <div className="space-y-[21px] min-w-0">
                    {/* Map Block */}
                    <div className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[13px] rounded-none shadow-none space-y-[13px]">
                        <div className="flex flex-wrap items-center justify-between gap-[8px]">
                            <div>
                                <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-slate-500 dark:text-[#8A93A6]">
                                    {t('adapters.utm_datum', 'SIRGAS-CHILE / WGS84 UTM')}
                                </p>
                                <p className="font-mono tabular-nums text-[13px] text-slate-900 dark:text-[#F3F4F6]">
                                    {mapGeoFix
                                        ? `${mapGeoFix.utm.zone}${mapGeoFix.utm.band} · E ${mapGeoFix.utm.eastingM.toFixed(
                                              3
                                          )} m · N ${mapGeoFix.utm.northingM.toFixed(3)} m`
                                        : UNDECLARED_TECH_VALUE}
                                </p>
                            </div>
                            {selectedRecord && !isCreatingNew && (
                                <span className="text-[13px] font-mono uppercase text-slate-500 dark:text-[#8A93A6]">
                                    {t('hitl.report_mode', 'MODO INFORME TÉCNICO (SOLO LECTURA)')}
                                </span>
                            )}
                        </div>

                        <SovereignGeoMapLazy
                            fix={mapGeoFix}
                            interactive={isCreatingNew || editingBlock !== null}
                            label={
                                activeValues.targetCode.trim() ||
                                activeValues.stationCode.trim() ||
                                activeValues.code ||
                                t('geomensura.title', 'GEOMENSURA UTM')
                            }
                            onSelectCoordinates={handleMapSelectCoordinates}
                            onCaptureCurrent={handleCaptureDeviceGeo}
                            heightPx={300}
                        />
                    </div>

                    {/* Creation Form Mode OR Report Read-Only / Surgical Edit Mode */}
                    {isCreatingNew ? (
                        <form
                            onSubmit={handleSaveNewRecord}
                            autoComplete="off"
                            spellCheck={false}
                            className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[21px] rounded-none shadow-none space-y-[21px]"
                        >
                            <div className="border-b border-slate-200 dark:border-[#12151C] pb-[13px]">
                                <h3 className="text-[14px] font-semibold uppercase tracking-[0.03em] text-slate-900 dark:text-[#F3F4F6]">
                                    {t('domains.save_record', 'NUEVO REGISTRO DE GEOMENSURA UTM')}
                                </h3>
                            </div>

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
                                        placeholder="GEO-001"
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
                                        placeholder="Replanteo Banco 2420"
                                        className={inputClass}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>{t('domains.status_label', 'ESTADO')}</label>
                                    <select
                                        value={draft.status}
                                        onChange={(e) =>
                                            setDraft({ ...draft, status: e.target.value as GeolappDomainRecordStatus })
                                        }
                                        className={inputClass}
                                    >
                                        <option value="ACTIVE">{t('domains.status_active', 'ACTIVO')}</option>
                                        <option value="VERIFIED">{t('domains.status_verified', 'VERIFICADO')}</option>
                                        <option value="ARCHIVED">{t('domains.status_archived', 'ARCHIVADO')}</option>
                                    </select>
                                </div>
                            </div>

                            {/* Station Fields */}
                            <div className="space-y-[13px]">
                                <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#C68346]">
                                    {t('geomensura.station_header', 'ESTACIÓN BASE / BENCHMARK')}
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-[13px]">
                                    <div>
                                        <label className={labelClass}>{t('geomensura.station_code', 'CÓDIGO ESTACIÓN')}</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.stationCode}
                                            onChange={(e) => setDraft({ ...draft, stationCode: e.target.value })}
                                            placeholder="PR-01"
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
                                    <div>
                                        <label className={labelClass}>{t('geomensura.hemisphere', 'HEMISFERIO')}</label>
                                        <select
                                            value={draft.hemisphere}
                                            onChange={(e) =>
                                                setDraft({ ...draft, hemisphere: e.target.value as 'N' | 'S' })
                                            }
                                            className={inputClass}
                                        >
                                            <option value="S">S</option>
                                            <option value="N">N</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('geomensura.easting', 'ESTE (m)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.stationEasting}
                                            onChange={(e) => setDraft({ ...draft, stationEasting: e.target.value })}
                                            className={inputClass}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('geomensura.northing', 'NORTE (m)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.stationNorthing}
                                            onChange={(e) => setDraft({ ...draft, stationNorthing: e.target.value })}
                                            className={inputClass}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('geomensura.elevation', 'COTA (m s.n.m.)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.stationElevationM}
                                            onChange={(e) => setDraft({ ...draft, stationElevationM: e.target.value })}
                                            className={inputClass}
                                            required
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Target Point Optional */}
                            <div className="space-y-[13px]">
                                <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                                    {t('geomensura.target_header', 'PUNTO OBJETIVO / RADIACIÓN')}
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-[13px]">
                                    <div>
                                        <label className={labelClass}>{t('geomensura.target_code', 'CÓDIGO OBJETIVO')}</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.targetCode}
                                            onChange={(e) => setDraft({ ...draft, targetCode: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('geomensura.easting', 'ESTE (m)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.targetEasting}
                                            onChange={(e) => setDraft({ ...draft, targetEasting: e.target.value })}
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
                                            value={draft.targetNorthing}
                                            onChange={(e) => setDraft({ ...draft, targetNorthing: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('geomensura.elevation', 'COTA (m s.n.m.)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={draft.targetElevationM}
                                            onChange={(e) => setDraft({ ...draft, targetElevationM: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Polygon Vertices Builder */}
                            <div className="space-y-[13px] border-t border-slate-200 dark:border-[#12151C] pt-[13px]">
                                <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-slate-700 dark:text-[#8A93A6]">
                                    {t('geomensura.polygon_header', 'POLIGONAL DE MENSURA (GAUSS / SHOELACE)')}
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-[8px] items-end">
                                    <div>
                                        <label className={labelClass}>{t('geomensura.vertex_code', 'VÉRTICE')}</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={vertexCode}
                                            onChange={(e) => setVertexCode(e.target.value)}
                                            placeholder={`V-${draft.polygonVertices.length + 1}`}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('geomensura.easting', 'ESTE (m)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={vertexEasting}
                                            onChange={(e) => setVertexEasting(e.target.value)}
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
                                            value={vertexNorthing}
                                            onChange={(e) => setVertexNorthing(e.target.value)}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('geomensura.elevation', 'COTA (m)')}</label>
                                        <input
                                            type="number"
                                            step="any"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={vertexElevation}
                                            onChange={(e) => setVertexElevation(e.target.value)}
                                            className={inputClass}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleAddVertex}
                                        className="px-[13px] py-[7px] border border-[#00AEEF] bg-white dark:bg-[#030406] text-[#00AEEF] text-[13px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none cursor-pointer"
                                    >
                                        {t('geomensura.add_vertex', 'AGREGAR VÉRTICE')}
                                    </button>
                                </div>
                                {draft.polygonVertices.length > 0 && (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[13px] font-mono tabular-nums border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-200 dark:border-[#12151C] text-left text-[13px] text-slate-500 dark:text-[#8A93A6]">
                                                    <th className="py-[6px] pr-[8px]">{t('geomensura.vertex_code', 'VÉRTICE')}</th>
                                                    <th className="py-[6px] pr-[8px]">{t('geomensura.easting', 'ESTE (m)')}</th>
                                                    <th className="py-[6px] pr-[8px]">{t('geomensura.northing', 'NORTE (m)')}</th>
                                                    <th className="py-[6px] pr-[8px]">{t('geomensura.elevation', 'COTA (m)')}</th>
                                                    <th className="py-[6px]" />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {draft.polygonVertices.map((v, idx) => (
                                                    <tr
                                                        key={`${v.code}-${idx}`}
                                                        className="border-b border-slate-100 dark:border-[#12151C]"
                                                    >
                                                        <td className="py-[6px] pr-[8px]">{v.code}</td>
                                                        <td className="py-[6px] pr-[8px]">{v.easting.toFixed(3)}</td>
                                                        <td className="py-[6px] pr-[8px]">{v.northing.toFixed(3)}</td>
                                                        <td className="py-[6px] pr-[8px]">
                                                            {v.elevationM !== undefined ? v.elevationM.toFixed(2) : UNDECLARED_TECH_VALUE}
                                                        </td>
                                                        <td className="py-[6px] text-right">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRemoveVertex(idx)}
                                                                aria-label={t('geomensura.remove_vertex', 'QUITAR')}
                                                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
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

                            {/* Notes */}
                            <div>
                                <label className={labelClass}>{t('domains.notes_label', 'NOTAS TÉCNICAS')}</label>
                                <textarea
                                    rows={3}
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
                                    type="button"
                                    onClick={handleCancelCreate}
                                    className="px-[13px] py-[8px] border border-slate-300 dark:border-[#12151C] bg-white dark:bg-[#030406] text-slate-700 dark:text-[#8A93A6] text-[13px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none cursor-pointer"
                                >
                                    {t('common.cancel_button', 'CANCELAR')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="px-[21px] py-[8px] bg-[#C68346] text-white text-[13px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none disabled:opacity-50 cursor-pointer"
                                >
                                    {saving
                                        ? t('domains.saving', 'GUARDANDO...')
                                        : t('domains.save_record', 'GUARDAR REGISTRO')}
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
                                onClick={handleStartCreate}
                                className="px-[13px] py-[8px] bg-[#C68346] text-white text-[13px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none cursor-pointer"
                            >
                                {t('domains.save_record', 'REGISTRAR LEVANTAMIENTO UTM')}
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-[21px]">
                            {/* Block 1: Station & Target Stakeout */}
                            <ReportBlockEditable
                                title={t('geomensura.station_header', '01. ESTACIÓN BASE Y REPLANTEO UTM')}
                                code={selectedRecord.code}
                                isEditing={editingBlock === 'SURVEY'}
                                canEdit={canEditSelected}
                                onToggleEdit={() => handleToggleBlockEdit('SURVEY')}
                                editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                            >
                                {editingBlock === 'SURVEY' ? (
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
                                                <label className={labelClass}>{t('domains.status_label', 'ESTADO')}</label>
                                                <select
                                                    value={draft.status}
                                                    onChange={(e) =>
                                                        setDraft({
                                                            ...draft,
                                                            status: e.target.value as GeolappDomainRecordStatus,
                                                        })
                                                    }
                                                    className={inputClass}
                                                >
                                                    <option value="ACTIVE">{t('domains.status_active', 'ACTIVO')}</option>
                                                    <option value="VERIFIED">{t('domains.status_verified', 'VERIFICADO')}</option>
                                                    <option value="ARCHIVED">{t('domains.status_archived', 'ARCHIVADO')}</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('geomensura.station_code', 'CÓDIGO ESTACIÓN')}</label>
                                                <input
                                                    type="text"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.stationCode}
                                                    onChange={(e) => setDraft({ ...draft, stationCode: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-[13px]">
                                            <div>
                                                <label className={labelClass}>{t('geomensura.easting', 'ESTE ESTACIÓN (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.stationEasting}
                                                    onChange={(e) => setDraft({ ...draft, stationEasting: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('geomensura.northing', 'NORTE ESTACIÓN (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.stationNorthing}
                                                    onChange={(e) => setDraft({ ...draft, stationNorthing: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('geomensura.elevation', 'COTA ESTACIÓN (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.stationElevationM}
                                                    onChange={(e) => setDraft({ ...draft, stationElevationM: e.target.value })}
                                                    className={inputClass}
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
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('geomensura.hemisphere', 'HEMISFERIO')}</label>
                                                <select
                                                    value={draft.hemisphere}
                                                    onChange={(e) =>
                                                        setDraft({ ...draft, hemisphere: e.target.value as 'N' | 'S' })
                                                    }
                                                    className={inputClass}
                                                >
                                                    <option value="S">S</option>
                                                    <option value="N">N</option>
                                                </select>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-[13px]">
                                            <div>
                                                <label className={labelClass}>{t('geomensura.target_code', 'CÓDIGO OBJETIVO')}</label>
                                                <input
                                                    type="text"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.targetCode}
                                                    onChange={(e) => setDraft({ ...draft, targetCode: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('geomensura.easting', 'ESTE OBJ. (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.targetEasting}
                                                    onChange={(e) => setDraft({ ...draft, targetEasting: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('geomensura.northing', 'NORTE OBJ. (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.targetNorthing}
                                                    onChange={(e) => setDraft({ ...draft, targetNorthing: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('geomensura.elevation', 'COTA OBJ. (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={draft.targetElevationM}
                                                    onChange={(e) => setDraft({ ...draft, targetElevationM: e.target.value })}
                                                    className={inputClass}
                                                />
                                            </div>
                                        </div>

                                        <div className="flex justify-end gap-[8px] pt-[8px]">
                                            <button
                                                type="button"
                                                onClick={() => handleToggleBlockEdit('SURVEY')}
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
                                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-[13px] text-[13px]">
                                        <div>
                                            <dt className={labelClass}>{t('domains.record_title', 'TÍTULO TÉCNICO')}</dt>
                                            <dd className="text-slate-900 dark:text-[#F3F4F6]">{selectedRecord.title}</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('domains.status_label', 'ESTADO')}</dt>
                                            <dd className="font-mono">{selectedRecord.status}</dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('geomensura.station_code', 'ESTACIÓN BASE')}</dt>
                                            <dd className="font-mono select-text inline-flex items-center gap-[4px]">
                                                {activeValues.stationCode || UNDECLARED_TECH_VALUE}
                                                {activeValues.stationCode && <CopyButton value={activeValues.stationCode} />}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('geomensura.easting', 'ESTE ESTACIÓN (m)')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(parseFinite(activeValues.stationEasting), 3)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('geomensura.northing', 'NORTE ESTACIÓN (m)')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(parseFinite(activeValues.stationNorthing), 3)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('geomensura.elevation', 'COTA ESTACIÓN (m)')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(parseFinite(activeValues.stationElevationM), 3)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('geomensura.target_code', 'OBJETIVO')}</dt>
                                            <dd className="font-mono">
                                                {activeValues.targetCode || UNDECLARED_TECH_VALUE}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('adapters.fix_quality', 'CALIDAD RTK')}</dt>
                                            <dd className="font-mono">
                                                {activeValues.rtkFixQuality || UNDECLARED_TECH_VALUE}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className={labelClass}>{t('adapters.hdop', 'HDOP')}</dt>
                                            <dd className="font-mono tabular-nums">
                                                {formatNum(parseFinite(activeValues.hdop), 2)}
                                            </dd>
                                        </div>
                                    </dl>
                                )}
                            </ReportBlockEditable>

                            {/* Block 2: Polygon Mensura */}
                            <ReportBlockEditable
                                title={t('geomensura.polygon_header', '02. POLIGONAL DE MENSURA (GAUSS / SHOELACE)')}
                                isEditing={editingBlock === 'POLYGON'}
                                canEdit={canEditSelected}
                                onToggleEdit={() => handleToggleBlockEdit('POLYGON')}
                                editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                            >
                                {editingBlock === 'POLYGON' ? (
                                    <div className="space-y-[13px]">
                                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-[8px] items-end">
                                            <div>
                                                <label className={labelClass}>{t('geomensura.vertex_code', 'VÉRTICE')}</label>
                                                <input
                                                    type="text"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={vertexCode}
                                                    onChange={(e) => setVertexCode(e.target.value)}
                                                    placeholder={`V-${draft.polygonVertices.length + 1}`}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('geomensura.easting', 'ESTE (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={vertexEasting}
                                                    onChange={(e) => setVertexEasting(e.target.value)}
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
                                                    value={vertexNorthing}
                                                    onChange={(e) => setVertexNorthing(e.target.value)}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('geomensura.elevation', 'COTA (m)')}</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    value={vertexElevation}
                                                    onChange={(e) => setVertexElevation(e.target.value)}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleAddVertex}
                                                className="px-[13px] py-[7px] border border-[#00AEEF] text-[#00AEEF] text-[13px] font-bold uppercase rounded-none shadow-none cursor-pointer"
                                            >
                                                {t('geomensura.add_vertex', 'AGREGAR VÉRTICE')}
                                            </button>
                                        </div>

                                        {draft.polygonVertices.length > 0 ? (
                                            <table className="w-full text-[13px] font-mono tabular-nums border-collapse">
                                                <thead>
                                                    <tr className="border-b border-slate-200 dark:border-[#12151C] text-left text-[13px] text-slate-500 dark:text-[#8A93A6]">
                                                        <th className="py-[6px]">{t('geomensura.vertex_code', 'VÉRTICE')}</th>
                                                        <th className="py-[6px]">{t('geomensura.easting', 'ESTE (m)')}</th>
                                                        <th className="py-[6px]">{t('geomensura.northing', 'NORTE (m)')}</th>
                                                        <th className="py-[6px]">{t('geomensura.elevation', 'COTA (m)')}</th>
                                                        <th className="py-[6px]" />
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {draft.polygonVertices.map((v, idx) => (
                                                        <tr key={`${v.code}-${idx}`} className="border-b border-slate-100 dark:border-[#12151C]">
                                                            <td className="py-[6px]">{v.code}</td>
                                                            <td className="py-[6px]">{v.easting.toFixed(3)}</td>
                                                            <td className="py-[6px]">{v.northing.toFixed(3)}</td>
                                                            <td className="py-[6px]">
                                                                {v.elevationM !== undefined ? v.elevationM.toFixed(2) : UNDECLARED_TECH_VALUE}
                                                            </td>
                                                            <td className="py-[6px] text-right">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleRemoveVertex(idx)}
                                                                    aria-label={t('geomensura.remove_vertex', 'QUITAR')}
                                                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 cursor-pointer"
                                                                >
                                                                    <span className="material-symbols-outlined text-[16px]">delete</span>
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <p className="text-[13px] font-mono text-slate-500 dark:text-[#5A6072]">
                                                {UNDECLARED_TECH_VALUE}
                                            </p>
                                        )}

                                        <div className="flex justify-end gap-[8px]">
                                            <button
                                                type="button"
                                                onClick={() => handleToggleBlockEdit('POLYGON')}
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
                                ) : activeValues.polygonVertices.length === 0 ? (
                                    <p className="text-[13px] font-mono text-slate-500 dark:text-[#5A6072]">
                                        {UNDECLARED_TECH_VALUE}
                                    </p>
                                ) : (
                                    <div className="space-y-[13px]">
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-[13px] font-mono tabular-nums border-collapse">
                                                <thead>
                                                    <tr className="border-b border-slate-200 dark:border-[#12151C] text-left text-[13px] text-slate-500 dark:text-[#8A93A6]">
                                                        <th className="py-[6px]">{t('geomensura.vertex_code', 'VÉRTICE')}</th>
                                                        <th className="py-[6px]">{t('geomensura.easting', 'ESTE (m)')}</th>
                                                        <th className="py-[6px]">{t('geomensura.northing', 'NORTE (m)')}</th>
                                                        <th className="py-[6px]">{t('geomensura.elevation', 'COTA (m)')}</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {activeValues.polygonVertices.map((v, idx) => (
                                                        <tr key={`${v.code}-${idx}`} className="border-b border-slate-100 dark:border-[#12151C]">
                                                            <td className="py-[6px]">{v.code}</td>
                                                            <td className="py-[6px]">{v.easting.toFixed(3)}</td>
                                                            <td className="py-[6px]">{v.northing.toFixed(3)}</td>
                                                            <td className="py-[6px]">
                                                                {v.elevationM !== undefined ? v.elevationM.toFixed(2) : UNDECLARED_TECH_VALUE}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </ReportBlockEditable>

                            {/* Block 3: Notes & Audit */}
                            <ReportBlockEditable
                                title={t('domains.notes_label', '03. NOTAS TÉCNICAS Y AUDITORÍA')}
                                isEditing={editingBlock === 'NOTES'}
                                canEdit={canEditSelected}
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
                                    <div className="space-y-[8px] text-[13px]">
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

                {/* MINOR PANE (38.2%): Stakeout Vectors, Polygon Results, External Sensors, PDF Export */}
                <aside className="space-y-[21px] min-w-0">
                    {/* Live Deterministic Vector & Mensura KPI Panel */}
                    <div className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[13px] rounded-none shadow-none space-y-[13px]">
                        <h3 className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#C68346]">
                            {t('geomensura.stakeout_results', 'VECTORES DE REPLANTEO 3D')}
                        </h3>
                        <dl className="grid grid-cols-2 gap-[13px] text-[13px]">
                            <div>
                                <dt className={labelClass}>{t('geomensura.delta_e', 'DELTA ESTE (m)')}</dt>
                                <dd className="font-mono tabular-nums font-semibold">
                                    {formatNum(stakeoutCalc?.deltaE, 3)}
                                </dd>
                            </div>
                            <div>
                                <dt className={labelClass}>{t('geomensura.delta_n', 'DELTA NORTE (m)')}</dt>
                                <dd className="font-mono tabular-nums font-semibold">
                                    {formatNum(stakeoutCalc?.deltaN, 3)}
                                </dd>
                            </div>
                            <div>
                                <dt className={labelClass}>{t('geomensura.delta_z', 'DESNIVEL Z (m)')}</dt>
                                <dd className="font-mono tabular-nums font-semibold">
                                    {formatNum(stakeoutCalc?.deltaZ, 3)}
                                </dd>
                            </div>
                            <div>
                                <dt className={labelClass}>{t('geomensura.horizontal_distance', 'DIST. HORIZONTAL (m)')}</dt>
                                <dd className="font-mono tabular-nums font-semibold text-[#00AEEF]">
                                    {formatNum(stakeoutCalc?.horizontalDistanceM, 3)}
                                </dd>
                            </div>
                            <div>
                                <dt className={labelClass}>{t('geomensura.slope_distance', 'DIST. INCLINADA (m)')}</dt>
                                <dd className="font-mono tabular-nums font-semibold">
                                    {formatNum(stakeoutCalc?.slopeDistanceM, 3)}
                                </dd>
                            </div>
                            <div>
                                <dt className={labelClass}>{t('geomensura.azimuth_deg', 'ACIMUT (deg)')}</dt>
                                <dd className="font-mono tabular-nums font-semibold">
                                    {formatNum(stakeoutCalc?.azimuthDeg, 2)}
                                </dd>
                            </div>
                            <div>
                                <dt className={labelClass}>{t('geomensura.slope_pct', 'PENDIENTE (%)')}</dt>
                                <dd className="font-mono tabular-nums font-semibold">
                                    {formatNum(stakeoutCalc?.slopePct, 2)}
                                </dd>
                            </div>
                        </dl>

                        <div className="border-t border-slate-200 dark:border-[#12151C] pt-[13px] space-y-[8px]">
                            <p className="text-[13px] font-bold uppercase tracking-[0.05em] text-slate-600 dark:text-[#8A93A6]">
                                {t('geomensura.polygon_header', 'MENSURA POLIGONAL')}
                            </p>
                            <dl className="grid grid-cols-2 gap-[13px] text-[13px]">
                                <div>
                                    <dt className={labelClass}>{t('geomensura.area_m2', 'ÁREA (m2)')}</dt>
                                    <dd className="font-mono tabular-nums font-semibold text-[#C68346]">
                                        {formatNum(polygonCalc?.areaM2, 2)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className={labelClass}>{t('geomensura.area_ha', 'ÁREA (ha)')}</dt>
                                    <dd className="font-mono tabular-nums font-semibold">
                                        {formatNum(polygonCalc?.areaHa, 4)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className={labelClass}>{t('geomensura.perimeter_m', 'PERÍMETRO (m)')}</dt>
                                    <dd className="font-mono tabular-nums font-semibold">
                                        {formatNum(polygonCalc?.perimeterM, 2)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className={labelClass}>{t('geomensura.centroid', 'CENTROIDE UTM')}</dt>
                                    <dd className="font-mono tabular-nums text-[13px]">
                                        {polygonCalc
                                            ? `${polygonCalc.centroid.easting.toFixed(1)}, ${polygonCalc.centroid.northing.toFixed(1)}`
                                            : UNDECLARED_TECH_VALUE}
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    </div>

                    {/* External Sensors Panel (GNSS RTK + Surface Point Clouds) */}
                    <div className="border border-slate-200 dark:border-[#12151C] bg-slate-50 dark:bg-[#07090D] p-[13px] rounded-none shadow-none space-y-[13px]">
                        <div className="flex items-center justify-between gap-[8px]">
                            <span className="text-[13px] font-bold uppercase tracking-[0.05em] text-slate-600 dark:text-[#8A93A6]">
                                ASIGNAR FIX GNSS RTK A:
                            </span>
                            <div className="flex border border-slate-200 dark:border-[#12151C]">
                                <button
                                    type="button"
                                    onClick={() => setRtkAssignMode('STATION')}
                                    className={`px-[8px] py-[4px] text-[13px] font-mono uppercase rounded-none shadow-none cursor-pointer ${
                                        rtkAssignMode === 'STATION'
                                            ? 'bg-[#C68346] text-white'
                                            : 'bg-white dark:bg-[#030406] text-slate-500 dark:text-[#8A93A6]'
                                    }`}
                                >
                                    BASE
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setRtkAssignMode('TARGET')}
                                    className={`px-[8px] py-[4px] text-[13px] font-mono uppercase rounded-none shadow-none cursor-pointer ${
                                        rtkAssignMode === 'TARGET'
                                            ? 'bg-[#00AEEF] text-white'
                                            : 'bg-white dark:bg-[#030406] text-slate-500 dark:text-[#8A93A6]'
                                    }`}
                                >
                                    OBJETIVO
                                </button>
                            </div>
                        </div>

                        <ExternalSensorsPanel
                            tenantId={tenantId}
                            uploadCas={true}
                            compact={true}
                            onRtkFixCaptured={handleRtkFixCaptured}
                            onSurfaceImported={handleSurfaceImported}
                        />

                        {lastSurfaceSummary && (
                            <div className="border-t border-slate-200 dark:border-[#12151C] pt-[13px] space-y-[6px] text-[13px] font-mono tabular-nums">
                                <p className="font-bold text-[#00AEEF]">
                                    SUPERFICIE IMPORTADA: {lastSurfaceSummary.sourceKind} ({lastSurfaceSummary.format})
                                </p>
                                <p className="text-slate-600 dark:text-[#8A93A6]">
                                    PUNTOS: {lastSurfaceSummary.pointCount.toLocaleString()} · ÁREA TIN:{' '}
                                    {lastSurfaceSummary.surfaceAreaM2.toFixed(2)} m2 · VOL: {lastSurfaceSummary.tinVolumeM3.toFixed(2)} m3
                                </p>
                                {lastSurfaceSummary.originalBytes > 0 && (
                                    <p className="text-slate-500 dark:text-[#5A6072]">
                                        ORIG {(lastSurfaceSummary.originalBytes / 1024).toFixed(1)} KB ➔ CAS .GLB{' '}
                                        {(lastSurfaceSummary.optimizedGlbBytes / 1024).toFixed(1)} KB
                                        {typeof lastSurfaceSummary.casSavingsPct === 'number'
                                            ? ` (-${lastSurfaceSummary.casSavingsPct.toFixed(1)}%)`
                                            : ''}
                                    </p>
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
                                    className="w-full px-[13px] py-[8px] border border-slate-300 dark:border-[#12151C] bg-white dark:bg-[#030406] text-slate-900 dark:text-[#F3F4F6] text-[13px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none hover:border-[#C68346] disabled:opacity-50 cursor-pointer"
                                >
                                    {t('domains.export_pdf', 'EXPORTAR DOSSIER PDF')}
                                </button>
                                <button
                                    type="button"
                                    disabled={pdfExporting}
                                    onClick={() => handleExportPdf(true)}
                                    className="w-full px-[13px] py-[8px] border border-[#00AEEF] bg-white dark:bg-[#030406] text-[#00AEEF] text-[13px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none disabled:opacity-50 cursor-pointer"
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

export default GeomensuraWorkspace;
