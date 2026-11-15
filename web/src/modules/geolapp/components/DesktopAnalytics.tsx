import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
} from 'recharts';
import {
    CopperMineralDomain,
    GeolappGeometryType,
    StockpileAsset,
    StockpileMeasurement,
} from '../core/types/GeolappTypes';
import { calculationEngine } from '../core/services/calculation-engine';
import { dataService } from '../core/services/DataService';
import {
    storageService,
    useResolvedStockpileImage,
} from '../core/services/StorageService';
import { downloadGeolappVectorPdf } from '../core/utils/vectorPdfGenerator';
import { useOptionalTheme } from '../../../context/ThemeContext';
import { geoCaptureService } from '../../../core/geo/GeoCaptureService';
import { buildCanonicalGeoFix } from '../../../core/geo/wgs84UtmProjection';
import { SovereignGeoMapLazy } from '../../../components/geo/SovereignGeoMapLazy';
import {
    ReportBlockEditable,
    ReportFieldRow,
    UNDECLARED_TECH_VALUE,
} from '../../../components/common/ReportBlockEditable';
import {
    HitlConfirmModal,
    HitlComparisonDiffItem,
} from '../../../components/common/HitlConfirmModal';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import { M3CircularProgress } from '../../../components/common/M3CircularProgress';
import { SecureImage } from '../../../components/common/SecureImage';

interface DesktopAnalyticsProps {
    assets: StockpileAsset[];
    measurements: StockpileMeasurement[];
    onSelectAsset?: (asset: StockpileAsset) => void;
    onBack?: () => void;
    embedded?: boolean;
}

type EditingBlock = 'identity' | 'metallurgy' | null;

const COPPER_DOMAIN_LIST: CopperMineralDomain[] = [
    'OXIDO_CU',
    'MIXTO_CU',
    'SULFURO_SECUNDARIO_CU',
    'SULFURO_PRIMARIO_CU',
    'CONCENTRADO_CU',
    'BAJA_LEY_CU',
    'ESTERIL_RIPIOS',
];

const GEOMETRY_LIST: GeolappGeometryType[] = [
    'CONO_ELIPTICO',
    'CONO_ELIPTICO_TRUNCADO',
    'CONO_TRUNCADO_PERIMETRO',
    'PILA_LONGITUDINAL_WINDROW',
    'ACOPIO_CONTRA_MURO',
];

const formatKilobytes = (bytes?: number): string | null => {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
};

const parseNullableNumber = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const parsePositiveNum = (raw: string): number => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const DesktopAnalytics: React.FC<DesktopAnalyticsProps> = ({
    assets,
    measurements,
    onSelectAsset,
    onBack,
    embedded = false,
}) => {
    const { t } = useTranslation();
    const themeCtx = useOptionalTheme();
    const isDark = themeCtx?.theme === 'dark';

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(
        assets[0]?.id ?? null
    );
    const [editingBlock, setEditingBlock] = useState<EditingBlock>(null);
    const [isExportingPdf, setIsExportingPdf] = useState(false);
    const [isSavingHitl, setIsSavingHitl] = useState(false);
    const [statusBanner, setStatusBanner] = useState<{
        type: 'success' | 'error' | 'info';
        text: string;
    } | null>(null);

    // Sync default selected asset when list changes
    useEffect(() => {
        if (assets.length === 0) {
            setSelectedAssetId(null);
            return;
        }
        if (!selectedAssetId || !assets.some((a) => a.id === selectedAssetId)) {
            setSelectedAssetId(assets[0].id);
        }
    }, [assets, selectedAssetId]);

    const filteredAssets = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return assets;
        return assets.filter(
            (a) =>
                a.name.toLowerCase().includes(q) ||
                a.id.toLowerCase().includes(q) ||
                (a.location_ref || '').toLowerCase().includes(q) ||
                (a.copper_domain || '').toLowerCase().includes(q)
        );
    }, [assets, searchQuery]);

    const selectedAsset = useMemo(
        () => assets.find((a) => a.id === selectedAssetId) ?? null,
        [assets, selectedAssetId]
    );

    const assetMeasurements = useMemo(() => {
        if (!selectedAsset) return [];
        return measurements
            .filter((m) => m.assetId === selectedAsset.id)
            .sort((a, b) => b.timestamp - a.timestamp);
    }, [measurements, selectedAsset]);

    const activeAssetMeasurements = useMemo(
        () => assetMeasurements.filter((m) => !m.ignored),
        [assetMeasurements]
    );

    const resolvedHeroPhoto = useResolvedStockpileImage(
        selectedAsset?.last_photo_url ||
            selectedAsset?.initial_photo_url ||
            selectedAsset?.thumbnail_url
    );

    // Portfolio KPIs
    const portfolioStats = useMemo(() => {
        let totalVol = 0;
        let totalThm = 0;
        let totalFineCu = 0;
        let blockedCount = 0;
        for (const a of assets) {
            if (typeof a.last_volume_m3 === 'number') totalVol += a.last_volume_m3;
            const w = a.wet_weight_thm ?? a.last_weight_t ?? 0;
            if (typeof w === 'number') totalThm += w;
            if (typeof a.fine_cu_t === 'number') totalFineCu += a.fine_cu_t;
            const gov = calculationEngine.evaluateCopperGovernance({
                copperDomain: a.copper_domain,
                residenceDays: a.residence_days,
                moisturePct: a.moisture_pct,
                tmlLimitPct: a.tml_pct,
            });
            if (gov.hasCriticalBlock) blockedCount += 1;
        }
        return { totalVol, totalThm, totalFineCu, blockedCount };
    }, [assets]);

    // Identity & Metallurgy edit drafts
    const [draftName, setDraftName] = useState('');
    const [draftClase, setDraftClase] = useState<StockpileAsset['clase']>('mineral');
    const [draftLocationRef, setDraftLocationRef] = useState('');
    const [draftCopperDomain, setDraftCopperDomain] = useState<CopperMineralDomain | ''>('');

    const [draftMoisture, setDraftMoisture] = useState('');
    const [draftTml, setDraftTml] = useState('');
    const [draftCuT, setDraftCuT] = useState('');
    const [draftCuS, setDraftCuS] = useState('');
    const [draftDays, setDraftDays] = useState('');
    const [draftRomana, setDraftRomana] = useState('');

    useEffect(() => {
        setEditingBlock(null);
        if (!selectedAsset) return;
        setDraftName(selectedAsset.name);
        setDraftClase(selectedAsset.clase);
        setDraftLocationRef(selectedAsset.location_ref || '');
        setDraftCopperDomain(selectedAsset.copper_domain || '');
        setDraftMoisture(
            selectedAsset.moisture_pct != null ? String(selectedAsset.moisture_pct) : ''
        );
        setDraftTml(selectedAsset.tml_pct != null ? String(selectedAsset.tml_pct) : '');
        setDraftCuT(
            selectedAsset.cu_total_pct != null ? String(selectedAsset.cu_total_pct) : ''
        );
        setDraftCuS(
            selectedAsset.cu_soluble_pct != null ? String(selectedAsset.cu_soluble_pct) : ''
        );
        setDraftDays(
            selectedAsset.residence_days != null ? String(selectedAsset.residence_days) : ''
        );
        setDraftRomana(
            selectedAsset.peso_romana != null ? String(selectedAsset.peso_romana) : ''
        );
    }, [selectedAsset]);

    // HITL Update or Delete modal state
    const [pendingHitl, setPendingHitl] = useState<{
        mode: 'UPDATE' | 'DELETE';
        patch?: Partial<StockpileAsset>;
        diffs: HitlComparisonDiffItem[];
    } | null>(null);

    // Create Asset Modal State
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newAssetName, setNewAssetName] = useState('');
    const [newAssetLocation, setNewAssetLocation] = useState('');
    const [newAssetDomain, setNewAssetDomain] = useState<CopperMineralDomain>('OXIDO_CU');
    const [newAssetClase, setNewAssetClase] = useState<StockpileAsset['clase']>('mineral');
    const [newAssetGeo, setNewAssetGeo] = useState<{
        latitude: number;
        longitude: number;
        altitude: number | null;
        accuracy: number;
    } | null>(null);
    const [isCapturingCreateGeo, setIsCapturingCreateGeo] = useState(false);
    const [createPhotoFile, setCreatePhotoFile] = useState<File | null>(null);
    const [isCreatingAsset, setIsCreatingAsset] = useState(false);
    const createFileRef = useRef<HTMLInputElement>(null);

    // New Measurement Modal State (All 5 Geometries)
    const [showMeasModal, setShowMeasModal] = useState(false);
    const [measGeometry, setMeasGeometry] = useState<GeolappGeometryType>('CONO_ELIPTICO');
    const [measDims, setMeasDims] = useState({
        d1: '',
        d2: '',
        d1p: '',
        d2p: '',
        p: '',
        pp: '',
        h: '',
        baseLengthM: '',
        baseWidthM: '',
        crestLengthM: '',
        crestWidthM: '',
        lengthM: '',
        widthFromWallM: '',
        heightAtWallM: '',
        wallAngleDeg: '90',
    });
    const [measDensity, setMeasDensity] = useState('');
    const [measMoisture, setMeasMoisture] = useState('');
    const [measTml, setMeasTml] = useState('');
    const [measCuT, setMeasCuT] = useState('');
    const [measCuS, setMeasCuS] = useState('');
    const [measDays, setMeasDays] = useState('');
    const [measGeo, setMeasGeo] = useState<{
        lat: number;
        lng: number;
        accuracy: number;
    } | null>(null);
    const [isCapturingMeasGeo, setIsCapturingMeasGeo] = useState(false);
    const [measPhotoFile, setMeasPhotoFile] = useState<File | null>(null);
    const [isSavingMeas, setIsSavingMeas] = useState(false);
    const measFileRef = useRef<HTMLInputElement>(null);

    const openMeasurementModal = () => {
        if (!selectedAsset) return;
        setMeasGeometry(
            (selectedAsset.last_geometry_type as GeolappGeometryType) || 'CONO_ELIPTICO'
        );
        setMeasDims({
            d1: '',
            d2: '',
            d1p: '',
            d2p: '',
            p: '',
            pp: '',
            h: '',
            baseLengthM: '',
            baseWidthM: '',
            crestLengthM: '',
            crestWidthM: '',
            lengthM: '',
            widthFromWallM: '',
            heightAtWallM: '',
            wallAngleDeg: '90',
        });
        setMeasDensity(
            typeof selectedAsset.density_factor === 'number' && selectedAsset.density_factor > 0
                ? String(selectedAsset.density_factor)
                : ''
        );
        setMeasMoisture(
            selectedAsset.moisture_pct != null ? String(selectedAsset.moisture_pct) : ''
        );
        setMeasTml(selectedAsset.tml_pct != null ? String(selectedAsset.tml_pct) : '');
        setMeasCuT(
            selectedAsset.cu_total_pct != null ? String(selectedAsset.cu_total_pct) : ''
        );
        setMeasCuS(
            selectedAsset.cu_soluble_pct != null ? String(selectedAsset.cu_soluble_pct) : ''
        );
        setMeasDays(
            selectedAsset.residence_days != null ? String(selectedAsset.residence_days) : ''
        );
        setMeasGeo(null);
        setMeasPhotoFile(null);
        setShowMeasModal(true);
    };

    const computedMeasVolume = useMemo(() => {
        switch (measGeometry) {
            case 'CONO_ELIPTICO':
                return calculationEngine.calculateEllipticCone(
                    parsePositiveNum(measDims.d1),
                    parsePositiveNum(measDims.d2),
                    parsePositiveNum(measDims.h)
                );
            case 'CONO_ELIPTICO_TRUNCADO':
                return calculationEngine.calculateTruncatedEllipticCone(
                    parsePositiveNum(measDims.d1),
                    parsePositiveNum(measDims.d2),
                    parseNullableNumber(measDims.d1p) ?? 0,
                    parseNullableNumber(measDims.d2p) ?? 0,
                    parsePositiveNum(measDims.h)
                );
            case 'CONO_TRUNCADO_PERIMETRO':
                return calculationEngine.calculatePerimeterTruncatedCone(
                    parsePositiveNum(measDims.p),
                    parseNullableNumber(measDims.pp) ?? 0,
                    parsePositiveNum(measDims.h)
                );
            case 'PILA_LONGITUDINAL_WINDROW':
                return calculationEngine.calculateWindrowVolume(
                    parsePositiveNum(measDims.baseLengthM),
                    parsePositiveNum(measDims.baseWidthM),
                    parsePositiveNum(measDims.h),
                    measDims.crestLengthM.trim()
                        ? parseNullableNumber(measDims.crestLengthM) ?? 0
                        : undefined,
                    measDims.crestWidthM.trim()
                        ? parseNullableNumber(measDims.crestWidthM) ?? 0
                        : undefined
                );
            case 'ACOPIO_CONTRA_MURO':
                return calculationEngine.calculateToeWallStockpileVolume(
                    parsePositiveNum(measDims.lengthM),
                    parsePositiveNum(measDims.widthFromWallM),
                    parsePositiveNum(measDims.heightAtWallM),
                    parsePositiveNum(measDims.wallAngleDeg) || 90
                );
            default:
                return 0;
        }
    }, [measGeometry, measDims]);

    const computedMeasThm = useMemo(() => {
        const d = parsePositiveNum(measDensity);
        if (computedMeasVolume <= 0 || d <= 0) return 0;
        return calculationEngine.computeTotalMass(computedMeasVolume, d);
    }, [computedMeasVolume, measDensity]);

    const modalGovernance = useMemo(
        () =>
            calculationEngine.evaluateCopperGovernance({
                copperDomain: selectedAsset?.copper_domain,
                residenceDays: parseNullableNumber(measDays),
                moisturePct: parseNullableNumber(measMoisture),
                tmlLimitPct: parseNullableNumber(measTml),
            }),
        [selectedAsset?.copper_domain, measDays, measMoisture, measTml]
    );

    // Derived specs for selectedAsset
    const canonicalFix = useMemo(() => {
        if (!selectedAsset) return null;
        const lat = selectedAsset.geo_point?.latitude ?? selectedAsset.location?.lat;
        const lng = selectedAsset.geo_point?.longitude ?? selectedAsset.location?.lng;
        if (
            typeof lat !== 'number' ||
            typeof lng !== 'number' ||
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            (lat === 0 && lng === 0)
        ) {
            return null;
        }
        try {
            return buildCanonicalGeoFix({
                lat,
                lng,
                altitudeM: selectedAsset.geo_point?.altitude ?? null,
                accuracyM: selectedAsset.geo_point?.accuracy ?? null,
                source: 'CAPACITOR_GNSS',
            });
        } catch {
            return null;
        }
    }, [selectedAsset]);

    const selectedThm = selectedAsset
        ? selectedAsset.wet_weight_thm ?? selectedAsset.last_weight_t ?? null
        : null;

    const selectedTms = useMemo(() => {
        if (!selectedAsset) return null;
        if (typeof selectedAsset.dry_weight_tms === 'number') return selectedAsset.dry_weight_tms;
        if (typeof selectedThm === 'number' && typeof selectedAsset.moisture_pct === 'number') {
            return Number((selectedThm * (1 - selectedAsset.moisture_pct / 100)).toFixed(2));
        }
        return null;
    }, [selectedAsset, selectedThm]);

    const selectedRs = useMemo(() => {
        if (!selectedAsset) return null;
        if (
            typeof selectedAsset.cu_total_pct === 'number' &&
            selectedAsset.cu_total_pct > 0 &&
            typeof selectedAsset.cu_soluble_pct === 'number'
        ) {
            return Number(
                ((selectedAsset.cu_soluble_pct / selectedAsset.cu_total_pct) * 100).toFixed(1)
            );
        }
        return null;
    }, [selectedAsset]);

    const selectedFineCu = useMemo(() => {
        if (!selectedAsset) return null;
        if (typeof selectedAsset.fine_cu_t === 'number') return selectedAsset.fine_cu_t;
        if (typeof selectedTms === 'number' && typeof selectedAsset.cu_total_pct === 'number') {
            return Number((selectedTms * (selectedAsset.cu_total_pct / 100)).toFixed(2));
        }
        return null;
    }, [selectedAsset, selectedTms]);

    const selectedGovernance = useMemo(() => {
        if (!selectedAsset) return { alerts: [], hasCriticalBlock: false, isValidForDispatch: true };
        return calculationEngine.evaluateCopperGovernance({
            copperDomain: selectedAsset.copper_domain,
            residenceDays: selectedAsset.residence_days,
            moisturePct: selectedAsset.moisture_pct,
            tmlLimitPct: selectedAsset.tml_pct,
        });
    }, [selectedAsset]);

    const selectedRomanaCmp = useMemo(() => {
        if (
            selectedAsset &&
            typeof selectedAsset.peso_romana === 'number' &&
            selectedAsset.peso_romana > 0 &&
            typeof selectedThm === 'number' &&
            selectedThm > 0
        ) {
            return calculationEngine.compareTonnage(selectedThm, selectedAsset.peso_romana);
        }
        return null;
    }, [selectedAsset, selectedThm]);

    const selectedCasTrace = useMemo(() => {
        if (!selectedAsset) return null;
        const orig = formatKilobytes(selectedAsset.cas_original_bytes);
        const opt = formatKilobytes(selectedAsset.cas_optimized_bytes);
        if (!orig || !opt) return null;
        return `ORIG ${orig} -> CAS ${opt}${
            typeof selectedAsset.cas_savings_pct === 'number'
                ? ` (-${selectedAsset.cas_savings_pct.toFixed(0)}%)`
                : ''
        }`;
    }, [selectedAsset]);

    const selectedLatestMeasurement =
        activeAssetMeasurements.length > 0 ? activeAssetMeasurements[0] : null;
    const selectedP80Mm = selectedAsset
        ? selectedAsset.p80_mm ??
          selectedAsset.rosin_rammler?.p80_mm ??
          selectedLatestMeasurement?.p80_mm ??
          selectedLatestMeasurement?.rosin_rammler?.p80_mm ??
          null
        : null;
    const selectedMeshSha256 = selectedAsset
        ? selectedAsset.mesh_sha256 ?? selectedLatestMeasurement?.mesh_sha256 ?? null
        : null;
    const selectedMeshSource = selectedAsset
        ? selectedAsset.mesh_source ?? selectedLatestMeasurement?.mesh_source ?? null
        : null;
    const selectedMeshStatus = selectedMeshSha256
        ? `${selectedMeshSha256.slice(0, 12)}${selectedMeshSource ? ` · ${selectedMeshSource}` : ''}`
        : null;

    const chartData = useMemo(
        () =>
            [...activeAssetMeasurements]
                .sort((a, b) => a.timestamp - b.timestamp)
                .map((m) => ({
                    date: new Date(m.timestamp).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                    }),
                    volume: Number(m.volumen_m3.toFixed(2)),
                    weight: Number(m.peso_t.toFixed(2)),
                })),
        [activeAssetMeasurements]
    );

    const handlePrepareIdentitySave = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedAsset) return;
        const trimmedName = draftName.trim().toUpperCase();
        const trimmedLoc = draftLocationRef.trim();
        const nextDomain = draftCopperDomain || undefined;

        const diffs: HitlComparisonDiffItem[] = [];
        const patch: Partial<StockpileAsset> = {};

        if (trimmedName && trimmedName !== selectedAsset.name) {
            diffs.push({
                field: t('registration.name_label', 'ID / NOMBRE DEL ACOPIO'),
                current: selectedAsset.name,
                suggested: trimmedName,
            });
            patch.name = trimmedName;
        }
        if (draftClase !== selectedAsset.clase) {
            diffs.push({
                field: t('registration.material_label', 'MATERIAL / MINERAL'),
                current: selectedAsset.clase,
                suggested: draftClase,
            });
            patch.clase = draftClase;
        }
        if (trimmedLoc !== (selectedAsset.location_ref || '')) {
            diffs.push({
                field: t('registration.location_ref_label', 'REFERENCIA UBICACIÓN'),
                current: selectedAsset.location_ref || UNDECLARED_TECH_VALUE,
                suggested: trimmedLoc || UNDECLARED_TECH_VALUE,
            });
            patch.location_ref = trimmedLoc;
        }
        if (nextDomain !== selectedAsset.copper_domain) {
            diffs.push({
                field: t('registration.copper_domain_label', 'DOMINIO MINERAL COBRE (Cu)'),
                current: selectedAsset.copper_domain || UNDECLARED_TECH_VALUE,
                suggested: nextDomain || UNDECLARED_TECH_VALUE,
            });
            patch.copper_domain = nextDomain;
        }

        if (diffs.length === 0) {
            setStatusBanner({
                type: 'info',
                text: t('hitl.no_changes', 'No existen modificaciones respecto a la ficha actual.'),
            });
            return;
        }
        setPendingHitl({ mode: 'UPDATE', patch, diffs });
    };

    const handlePrepareMetallurgySave = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedAsset) return;

        const nextMoisture = parseNullableNumber(draftMoisture);
        const nextTml = parseNullableNumber(draftTml);
        const nextCuT = parseNullableNumber(draftCuT);
        const nextCuS = parseNullableNumber(draftCuS);
        const nextDays = parseNullableNumber(draftDays);
        const nextRomana = parseNullableNumber(draftRomana);

        const nextTms =
            typeof selectedThm === 'number' && nextMoisture !== null
                ? Number((selectedThm * (1 - nextMoisture / 100)).toFixed(2))
                : selectedAsset.dry_weight_tms ?? null;
        const nextFineCu =
            typeof nextTms === 'number' && nextCuT !== null
                ? Number((nextTms * (nextCuT / 100)).toFixed(2))
                : selectedAsset.fine_cu_t ?? null;

        const nextGov = calculationEngine.evaluateCopperGovernance({
            copperDomain: selectedAsset.copper_domain,
            residenceDays: nextDays,
            moisturePct: nextMoisture,
            tmlLimitPct: nextTml,
        });

        const diffs: HitlComparisonDiffItem[] = [];
        const cmp = (
            label: string,
            prevVal: number | null | undefined,
            nextVal: number | null,
            unit: string
        ) => {
            if ((prevVal ?? null) !== nextVal) {
                diffs.push({
                    field: label,
                    current: prevVal != null ? `${prevVal}${unit}` : UNDECLARED_TECH_VALUE,
                    suggested: nextVal != null ? `${nextVal}${unit}` : UNDECLARED_TECH_VALUE,
                });
            }
        };

        cmp(t('copper_governance.moisture', 'HUMEDAD w%'), selectedAsset.moisture_pct, nextMoisture, '%');
        cmp(t('copper_governance.tml', 'TML%'), selectedAsset.tml_pct, nextTml, '%');
        cmp(t('manual_capture.fields.cu_total_pct', 'LEY CuT (%)'), selectedAsset.cu_total_pct, nextCuT, '%');
        cmp(t('manual_capture.fields.cu_soluble_pct', 'LEY CuS (%)'), selectedAsset.cu_soluble_pct, nextCuS, '%');
        cmp(t('copper_governance.days', 'DÍAS DE RESIDENCIA'), selectedAsset.residence_days, nextDays, ' d');
        cmp(t('copper_governance.scale_weight', 'PESO ROMANA [t]'), selectedAsset.peso_romana, nextRomana, ' t');

        if (diffs.length === 0) {
            setStatusBanner({
                type: 'info',
                text: t('hitl.no_changes', 'No existen modificaciones respecto a la ficha actual.'),
            });
            return;
        }

        setPendingHitl({
            mode: 'UPDATE',
            patch: {
                moisture_pct: nextMoisture,
                tml_pct: nextTml,
                cu_total_pct: nextCuT,
                cu_soluble_pct: nextCuS,
                residence_days: nextDays,
                peso_romana: nextRomana,
                dry_weight_tms: nextTms,
                fine_cu_t: nextFineCu,
                copper_governance_alerts: nextGov.alerts,
                metadata: {
                    ...(selectedAsset.metadata || {}),
                    conciliado: Boolean(nextRomana && nextRomana > 0),
                    fecha_conciliacion:
                        nextRomana && nextRomana > 0
                            ? Date.now()
                            : selectedAsset.metadata?.fecha_conciliacion,
                },
            },
            diffs,
        });
    };

    const handleConfirmHitl = async () => {
        if (!pendingHitl || !selectedAsset) return;
        setIsSavingHitl(true);
        try {
            if (pendingHitl.mode === 'DELETE') {
                await dataService.deleteAsset(selectedAsset.id);
                setPendingHitl(null);
                setSelectedAssetId(null);
                setStatusBanner({
                    type: 'success',
                    text: t('common.delete_button', 'ELIMINAR'),
                });
            } else if (pendingHitl.patch) {
                await dataService.updateAssetWithHitl(
                    selectedAsset.id,
                    pendingHitl.patch,
                    'ACTUALIZAR',
                    pendingHitl.diffs
                );
                setPendingHitl(null);
                setEditingBlock(null);
                setStatusBanner({
                    type: 'success',
                    text: t('hitl.save_success', 'Registro actualizado y firmado en AuditLedger.'),
                });
            }
        } catch (err) {
            setStatusBanner({
                type: 'error',
                text:
                    err instanceof Error
                        ? err.message
                        : t('hitl.save_error', 'Error al registrar la actualización HITL.'),
            });
        } finally {
            setIsSavingHitl(false);
        }
    };

    const handleExportAssetPdf = async (subset?: StockpileMeasurement[]) => {
        if (!selectedAsset) return;
        setIsExportingPdf(true);
        setStatusBanner(null);
        try {
            await downloadGeolappVectorPdf(
                selectedAsset,
                subset ?? activeAssetMeasurements
            );
            setStatusBanner({
                type: 'success',
                text: t('pdf.download_ready', 'Certificado PDF vectorial descargado.'),
            });
        } catch (err) {
            setStatusBanner({
                type: 'error',
                text:
                    err instanceof Error
                        ? err.message
                        : t('pdf.error', 'Error al generar certificado PDF vectorial.'),
            });
        } finally {
            setIsExportingPdf(false);
        }
    };

    const handleCaptureCreateGeo = async () => {
        setIsCapturingCreateGeo(true);
        try {
            const fix = await geoCaptureService.captureCurrentPosition();
            setNewAssetGeo({
                latitude: fix.lat,
                longitude: fix.lng,
                altitude: fix.altitudeM,
                accuracy: fix.accuracyM ?? 0,
            });
        } catch (err) {
            setStatusBanner({
                type: 'error',
                text: err instanceof Error ? err.message : UNDECLARED_TECH_VALUE,
            });
        } finally {
            setIsCapturingCreateGeo(false);
        }
    };

    const handleCreateAsset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newAssetName.trim()) return;
        setIsCreatingAsset(true);
        setStatusBanner(null);
        try {
            const preId = `STK_${Date.now()}`;
            let photoUrl: string | undefined;
            let casOrig: number | undefined;
            let casOpt: number | undefined;
            let casSavings: number | undefined;

            if (createPhotoFile) {
                const up = await storageService.uploadStockpileImage(createPhotoFile, preId);
                photoUrl = up.url;
                casOrig = up.originalBytes;
                casOpt = up.optimizedBytes;
                casSavings = up.savingsPct;
            }

            const newId = await dataService.createAsset({
                name: newAssetName.trim().toUpperCase(),
                clase: newAssetClase,
                copper_domain: newAssetDomain,
                location_ref: newAssetLocation.trim() || undefined,
                geo_point: newAssetGeo || undefined,
                initial_photo_url: photoUrl,
                last_photo_url: photoUrl,
                cas_original_bytes: casOrig,
                cas_optimized_bytes: casOpt,
                cas_savings_pct: casSavings,
            });

            setSelectedAssetId(newId);
            setShowCreateModal(false);
            setNewAssetName('');
            setNewAssetLocation('');
            setNewAssetGeo(null);
            setCreatePhotoFile(null);
        } catch (err) {
            setStatusBanner({
                type: 'error',
                text:
                    err instanceof Error
                        ? err.message
                        : t('hitl.save_error', 'Error al registrar activo.'),
            });
        } finally {
            setIsCreatingAsset(false);
        }
    };

    const handleCaptureMeasGeo = async () => {
        setIsCapturingMeasGeo(true);
        try {
            const fix = await geoCaptureService.captureCurrentPosition();
            setMeasGeo({
                lat: fix.lat,
                lng: fix.lng,
                accuracy: fix.accuracyM ?? 0,
            });
        } catch (err) {
            setStatusBanner({
                type: 'error',
                text: err instanceof Error ? err.message : UNDECLARED_TECH_VALUE,
            });
        } finally {
            setIsCapturingMeasGeo(false);
        }
    };

    const handleSaveMeasurement = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedAsset) return;
        const densityVal = parsePositiveNum(measDensity);
        if (computedMeasVolume <= 0 || densityVal <= 0) {
            setStatusBanner({
                type: 'error',
                text: t('manual_capture.save_error', 'Error al guardar'),
            });
            return;
        }

        setIsSavingMeas(true);
        setStatusBanner(null);
        try {
            let photoUrl = '';
            let casOrig: number | undefined;
            let casOpt: number | undefined;
            let casSavings: number | undefined;

            if (measPhotoFile) {
                const up = await storageService.uploadStockpileImage(
                    measPhotoFile,
                    selectedAsset.id
                );
                photoUrl = up.url;
                casOrig = up.originalBytes;
                casOpt = up.optimizedBytes;
                casSavings = up.savingsPct;
            }

            const moisture = parseNullableNumber(measMoisture);
            const tml = parseNullableNumber(measTml);
            const cuT = parseNullableNumber(measCuT);
            const cuS = parseNullableNumber(measCuS);
            const days = parseNullableNumber(measDays);

            const tms =
                moisture !== null
                    ? Number((computedMeasThm * (1 - moisture / 100)).toFixed(2))
                    : null;
            const fineCu =
                tms !== null && cuT !== null
                    ? Number((tms * (cuT / 100)).toFixed(2))
                    : null;

            const gov = calculationEngine.evaluateCopperGovernance({
                copperDomain: selectedAsset.copper_domain,
                residenceDays: days,
                moisturePct: moisture,
                tmlLimitPct: tml,
            });

            const dimensions: Record<string, number> = {};
            if (measGeometry === 'CONO_ELIPTICO') {
                dimensions.d1 = parsePositiveNum(measDims.d1);
                dimensions.d2 = parsePositiveNum(measDims.d2);
                dimensions.h = parsePositiveNum(measDims.h);
            } else if (measGeometry === 'CONO_ELIPTICO_TRUNCADO') {
                dimensions.d1 = parsePositiveNum(measDims.d1);
                dimensions.d2 = parsePositiveNum(measDims.d2);
                dimensions.d1p = parseNullableNumber(measDims.d1p) ?? 0;
                dimensions.d2p = parseNullableNumber(measDims.d2p) ?? 0;
                dimensions.h = parsePositiveNum(measDims.h);
            } else if (measGeometry === 'CONO_TRUNCADO_PERIMETRO') {
                dimensions.p = parsePositiveNum(measDims.p);
                dimensions.pp = parseNullableNumber(measDims.pp) ?? 0;
                dimensions.h = parsePositiveNum(measDims.h);
            } else if (measGeometry === 'PILA_LONGITUDINAL_WINDROW') {
                dimensions.baseLengthM = parsePositiveNum(measDims.baseLengthM);
                dimensions.baseWidthM = parsePositiveNum(measDims.baseWidthM);
                dimensions.heightM = parsePositiveNum(measDims.h);
                if (measDims.crestLengthM.trim()) {
                    dimensions.crestLengthM = parseNullableNumber(measDims.crestLengthM) ?? 0;
                }
                if (measDims.crestWidthM.trim()) {
                    dimensions.crestWidthM = parseNullableNumber(measDims.crestWidthM) ?? 0;
                }
            } else if (measGeometry === 'ACOPIO_CONTRA_MURO') {
                dimensions.lengthM = parsePositiveNum(measDims.lengthM);
                dimensions.widthFromWallM = parsePositiveNum(measDims.widthFromWallM);
                dimensions.heightAtWallM = parsePositiveNum(measDims.heightAtWallM);
                dimensions.wallAngleDeg = parsePositiveNum(measDims.wallAngleDeg) || 90;
            }

            const crestLengthVal =
                measGeometry === 'PILA_LONGITUDINAL_WINDROW' && measDims.crestLengthM.trim()
                    ? parseNullableNumber(measDims.crestLengthM) ?? undefined
                    : undefined;
            const crestWidthVal =
                measGeometry === 'PILA_LONGITUDINAL_WINDROW' && measDims.crestWidthM.trim()
                    ? parseNullableNumber(measDims.crestWidthM) ?? undefined
                    : undefined;
            const wallAngleVal =
                measGeometry === 'ACOPIO_CONTRA_MURO'
                    ? parsePositiveNum(measDims.wallAngleDeg) || 90
                    : undefined;

            await dataService.addMeasurement({
                assetId: selectedAsset.id,
                timestamp: Date.now(),
                volumen_m3: Number(computedMeasVolume.toFixed(2)),
                peso_t: Number(computedMeasThm.toFixed(2)),
                density_factor: densityVal,
                photo_url: photoUrl,
                method: 'manual',
                geometry: {
                    type: measGeometry,
                    dimensions,
                },
                ...(crestLengthVal !== undefined ? { crest_length_m: crestLengthVal } : {}),
                ...(crestWidthVal !== undefined ? { crest_width_m: crestWidthVal } : {}),
                ...(wallAngleVal !== undefined ? { wall_angle_deg: wallAngleVal } : {}),
                ...(measGeo ? { location_metadata: measGeo } : {}),
                copper_domain: selectedAsset.copper_domain,
                moisture_pct: moisture,
                tml_pct: tml,
                wet_weight_thm: Number(computedMeasThm.toFixed(2)),
                dry_weight_tms: tms,
                cu_total_pct: cuT,
                cu_soluble_pct: cuS,
                fine_cu_t: fineCu,
                residence_days: days,
                ...(casOrig !== undefined ? { cas_original_bytes: casOrig } : {}),
                ...(casOpt !== undefined ? { cas_optimized_bytes: casOpt } : {}),
                ...(casSavings !== undefined ? { cas_savings_pct: casSavings } : {}),
                copper_governance_alerts: gov.alerts,
            });

            await dataService.saveStockpileData(
                {
                    density_factor: densityVal,
                    last_geometry_type: measGeometry,
                    moisture_pct: moisture,
                    tml_pct: tml,
                    wet_weight_thm: Number(computedMeasThm.toFixed(2)),
                    dry_weight_tms: tms,
                    cu_total_pct: cuT,
                    cu_soluble_pct: cuS,
                    fine_cu_t: fineCu,
                    residence_days: days,
                    ...(casOrig !== undefined ? { cas_original_bytes: casOrig } : {}),
                    ...(casOpt !== undefined ? { cas_optimized_bytes: casOpt } : {}),
                    ...(casSavings !== undefined ? { cas_savings_pct: casSavings } : {}),
                    copper_governance_alerts: gov.alerts,
                },
                selectedAsset.id
            );

            setShowMeasModal(false);
            setStatusBanner({
                type: 'success',
                text: t('manual_capture.success_message', 'CAPTURA OK'),
            });
        } catch (err) {
            setStatusBanner({
                type: 'error',
                text:
                    err instanceof Error
                        ? err.message
                        : t('manual_capture.save_error', 'Error al guardar'),
            });
        } finally {
            setIsSavingMeas(false);
        }
    };

    const containerClass = embedded
        ? 'h-full w-full min-h-0 flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none'
        : 'min-h-[100dvh] w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none';

    return (
        <main className={containerClass}>
            {/* Top Desktop Command Strip */}
            <header className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between gap-fib-13 no-print">
                <div className="flex items-center gap-fib-13 min-w-0">
                    {onBack && (
                        <button
                            type="button"
                            onClick={onBack}
                            title={t('common.back_button', 'VOLVER')}
                            aria-label={t('common.back_button', 'VOLVER')}
                            className="bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none"
                        >
                            <span className="material-symbols-outlined text-[24px] text-[#C68346]">
                                arrow_back
                            </span>
                        </button>
                    )}
                    <div className="min-w-0">
                        <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                            {t('common.module_title', 'GEOLAPP® · CONTROL DE STOCKPILES')}
                        </span>
                        <h1 className="text-h1-header font-bold uppercase tracking-tight truncate">
                            {t('analytics.stock_list_title', 'INVENTARIO DE ACOPIOS')}
                        </h1>
                    </div>
                </div>

                {/* Portfolio Real-Time Totals */}
                <div className="hidden md:flex items-center gap-fib-21 font-mono tabular-nums text-data-dense">
                    <div>
                        <span className="text-microcopy text-[#475569] dark:text-[#8A93A6] block">
                            THM TOTAL
                        </span>
                        <span className="font-bold text-[#C68346]">
                            {portfolioStats.totalThm.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                            })}{' '}
                            t
                        </span>
                    </div>
                    <div>
                        <span className="text-microcopy text-[#475569] dark:text-[#8A93A6] block">
                            Cu FINO TOTAL
                        </span>
                        <span className="font-bold text-[#00AEEF]">
                            {portfolioStats.totalFineCu.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                            })}{' '}
                            t
                        </span>
                    </div>
                    <div>
                        <span className="text-microcopy text-[#475569] dark:text-[#8A93A6] block">
                            IMSBC
                        </span>
                        <span
                            className={`font-bold ${
                                portfolioStats.blockedCount > 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-[#0F172A] dark:text-[#F3F4F6]'
                            }`}
                        >
                            {portfolioStats.blockedCount}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-fib-8 shrink-0">
                    <button
                        type="button"
                        onClick={() => setShowCreateModal(true)}
                        title={t('analytics.new_asset_button', 'NUEVO ACOPIO')}
                        aria-label={t('analytics.new_asset_button', 'NUEVO ACOPIO')}
                        className="bg-transparent border-0 outline-none p-2 text-[#C68346] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none"
                    >
                        <span className="material-symbols-outlined text-[24px]">add_circle</span>
                    </button>
                </div>
            </header>

            {isExportingPdf && (
                <div className="shrink-0 w-full">
                    <M3LinearProgress
                        indeterminate
                        ariaLabel={t('pdf.downloading', 'GENERANDO CERTIFICADO VECTORIAL...')}
                    />
                </div>
            )}

            {/* Golden Ratio Split Workspace (38.2% Rail / 61.8% Technical Stage) */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[38.2%_61.8%] overflow-hidden">
                {/* Left Column (38.2%): Search & Inventory Selector */}
                <aside className="min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] overflow-hidden">
                    <div className="shrink-0 p-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-8 bg-[#FFFFFF] dark:bg-[#000000]">
                        <span className="material-symbols-outlined text-[18px] text-[#94A3B8] dark:text-[#5A6072]">
                            search
                        </span>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={t(
                                'analytics.search_placeholder',
                                'FILTRAR POR ID O UBICACIÓN'
                            )}
                            aria-label={t(
                                'analytics.search_placeholder',
                                'FILTRAR POR ID O UBICACIÓN'
                            )}
                            className="w-full bg-transparent border-0 outline-none font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] rounded-none"
                        />
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-fib-13 flex flex-col gap-fib-8">
                        {filteredAssets.length === 0 ? (
                            <div className="p-fib-21 border border-[#E2E8F0] dark:border-[#12151C] text-center text-data-dense font-mono text-[#475569] dark:text-[#8A93A6] rounded-none">
                                {t('analytics.no_assets', 'Sin acopios registrados')}
                            </div>
                        ) : (
                            filteredAssets.map((a) => {
                                const isSelected = a.id === selectedAsset?.id;
                                const gov = calculationEngine.evaluateCopperGovernance({
                                    copperDomain: a.copper_domain,
                                    residenceDays: a.residence_days,
                                    moisturePct: a.moisture_pct,
                                    tmlLimitPct: a.tml_pct,
                                });
                                const thmVal = a.wet_weight_thm ?? a.last_weight_t;
                                return (
                                    <button
                                        key={a.id}
                                        type="button"
                                        onClick={() => {
                                            setSelectedAssetId(a.id);
                                            if (onSelectAsset) onSelectAsset(a);
                                        }}
                                        className={`w-full text-left p-fib-13 border transition-colors cursor-pointer rounded-none shadow-none flex flex-col gap-fib-8 ${
                                            isSelected
                                                ? 'border-[#C68346] bg-[#C68346]/10'
                                                : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] hover:border-[#C68346]/60'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-fib-8">
                                            <div className="min-w-0">
                                                <span className="block text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                                    {a.name}
                                                </span>
                                                <span className="block text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] truncate">
                                                    {a.location_ref || UNDECLARED_TECH_VALUE}
                                                </span>
                                            </div>
                                            {gov.alerts.length > 0 && (
                                                <span
                                                    className={`material-symbols-outlined text-[16px] shrink-0 ${
                                                        gov.hasCriticalBlock
                                                            ? 'text-red-600 dark:text-red-400'
                                                            : 'text-[#C68346]'
                                                    }`}
                                                >
                                                    {gov.hasCriticalBlock ? 'block' : 'warning'}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center justify-between text-microcopy font-mono tabular-nums pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                                            <span className="text-[#475569] dark:text-[#8A93A6]">
                                                {typeof a.last_volume_m3 === 'number'
                                                    ? `${a.last_volume_m3.toFixed(1)} m³`
                                                    : '—'}
                                            </span>
                                            <span className="font-bold text-[#C68346]">
                                                {typeof thmVal === 'number'
                                                    ? `${thmVal.toFixed(1)} t`
                                                    : '—'}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </aside>

                {/* Right Column (61.8%): Technical Report Dossier & Analytics */}
                <section className="min-h-0 overflow-y-auto custom-scrollbar p-fib-21 bg-[#FFFFFF] dark:bg-[#000000]">
                    {!selectedAsset ? (
                        <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-fib-13 text-center">
                            <span className="material-symbols-outlined text-[40px] text-[#94A3B8] dark:text-[#5A6072]">
                                inventory_2
                            </span>
                            <p className="text-body-main text-[#475569] dark:text-[#8A93A6]">
                                {t('analytics.no_assets', 'Sin acopios registrados')}
                            </p>
                        </div>
                    ) : (
                        <div className="max-w-5xl mx-auto flex flex-col gap-fib-21 pb-fib-55">
                            {statusBanner && (
                                <div
                                    role="status"
                                    className={`p-fib-13 border rounded-none flex items-center justify-between gap-fib-13 text-data-dense font-mono ${
                                        statusBanner.type === 'error'
                                            ? 'border-red-600/50 bg-red-600/10 text-red-700 dark:text-red-400'
                                            : statusBanner.type === 'success'
                                              ? 'border-[#00AEEF]/50 bg-[#00AEEF]/10 text-[#0F172A] dark:text-[#F3F4F6]'
                                              : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-[#475569] dark:text-[#8A93A6]'
                                    }`}
                                >
                                    <span>{statusBanner.text}</span>
                                    <button
                                        type="button"
                                        onClick={() => setStatusBanner(null)}
                                        aria-label={t('common.close_button', 'CERRAR')}
                                        className="bg-transparent border-0 outline-none p-1 cursor-pointer"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">
                                            close
                                        </span>
                                    </button>
                                </div>
                            )}

                            {/* Asset Toolbar */}
                            <div className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none flex flex-wrap items-center justify-between gap-fib-13">
                                <div className="min-w-0">
                                    <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {selectedAsset.id} ·{' '}
                                        {t('hitl.report_mode', 'MODO INFORME TÉCNICO (SOLO LECTURA)')}
                                    </span>
                                    <h2 className="text-h1-header font-bold uppercase truncate">
                                        {selectedAsset.name}
                                    </h2>
                                </div>

                                <div className="flex items-center gap-fib-8 no-print">
                                    <button
                                        type="button"
                                        onClick={openMeasurementModal}
                                        title={t('analytics.new_measurement_button', 'NUEVA MEDICIÓN')}
                                        aria-label={t(
                                            'analytics.new_measurement_button',
                                            'NUEVA MEDICIÓN'
                                        )}
                                        className="bg-transparent border-0 outline-none p-2 text-[#C68346] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none"
                                    >
                                        <span className="material-symbols-outlined text-[24px]">
                                            straighten
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleExportAssetPdf()}
                                        disabled={isExportingPdf}
                                        title={t('pdf.export_button', 'EXPORTAR PDF VECTORIAL')}
                                        aria-label={t(
                                            'pdf.export_button',
                                            'EXPORTAR PDF VECTORIAL'
                                        )}
                                        className="bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] disabled:opacity-40 cursor-pointer rounded-none"
                                    >
                                        <span className="material-symbols-outlined text-[24px]">
                                            picture_as_pdf
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setPendingHitl({
                                                mode: 'DELETE',
                                                diffs: [
                                                    {
                                                        field: t(
                                                            'registration.name_label',
                                                            'ID / NOMBRE DEL ACOPIO'
                                                        ),
                                                        current: `${selectedAsset.name} (${selectedAsset.id})`,
                                                        suggested: t(
                                                            'common.delete_button',
                                                            'ELIMINAR'
                                                        ),
                                                    },
                                                ],
                                            })
                                        }
                                        title={t('common.delete_button', 'ELIMINAR')}
                                        aria-label={t('common.delete_button', 'ELIMINAR')}
                                        className="bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-red-600 dark:hover:text-red-400 cursor-pointer rounded-none"
                                    >
                                        <span className="material-symbols-outlined text-[22px]">
                                            delete
                                        </span>
                                    </button>
                                </div>
                            </div>

                            {/* Copper Governance Banner */}
                            {selectedGovernance.alerts.length > 0 && (
                                <div
                                    role="alert"
                                    className={`p-fib-13 border rounded-none flex flex-col gap-fib-8 ${
                                        selectedGovernance.hasCriticalBlock
                                            ? 'border-red-600 bg-red-600/10 text-red-700 dark:text-red-300'
                                            : 'border-[#C68346] bg-[#C68346]/10 text-[#0F172A] dark:text-[#F3F4F6]'
                                    }`}
                                >
                                    <div className="flex items-center gap-fib-8 text-microcopy font-mono font-bold uppercase">
                                        <span className="material-symbols-outlined text-[18px] text-[#C68346]">
                                            {selectedGovernance.hasCriticalBlock
                                                ? 'block'
                                                : 'warning'}
                                        </span>
                                        <span>
                                            {selectedGovernance.hasCriticalBlock
                                                ? t(
                                                      'copper_governance.dispatch_blocked',
                                                      'DESPACHO BLOQUEADO (IMSBC)'
                                                  )
                                                : t(
                                                      'copper_governance.title',
                                                      'GOBERNANZA METALÚRGICA COBRE (Cu)'
                                                  )}
                                        </span>
                                    </div>
                                    {selectedGovernance.alerts.map((al) => (
                                        <p key={al.code} className="text-data-dense font-mono">
                                            [{al.code}] {al.message}
                                        </p>
                                    ))}
                                </div>
                            )}

                            {/* KPI Strip */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-fib-13">
                                <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                    <span className="block text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] uppercase">
                                        {t('manual_capture.estimated_volume', 'VOLUMEN')}
                                    </span>
                                    <span className="text-kpi-display font-mono font-bold tabular-nums">
                                        {typeof selectedAsset.last_volume_m3 === 'number'
                                            ? `${selectedAsset.last_volume_m3.toFixed(2)} m³`
                                            : '—'}
                                    </span>
                                </div>
                                <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                    <span className="block text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] uppercase">
                                        {t('copper_governance.thm', 'THM [t]')}
                                    </span>
                                    <span className="text-kpi-display font-mono font-bold tabular-nums text-[#C68346]">
                                        {typeof selectedThm === 'number'
                                            ? `${selectedThm.toFixed(2)} t`
                                            : '—'}
                                    </span>
                                </div>
                                <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                    <span className="block text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] uppercase">
                                        {t('copper_governance.tms', 'TMS [t]')}
                                    </span>
                                    <span className="text-kpi-display font-mono font-bold tabular-nums">
                                        {typeof selectedTms === 'number'
                                            ? `${selectedTms.toFixed(2)} t`
                                            : '—'}
                                    </span>
                                </div>
                                <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                    <span className="block text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] uppercase">
                                        {t('copper_governance.fine_cu', 'Cu FINO [t]')}
                                    </span>
                                    <span className="text-kpi-display font-mono font-bold tabular-nums text-[#00AEEF]">
                                        {typeof selectedFineCu === 'number'
                                            ? `${selectedFineCu.toFixed(2)} t`
                                            : '—'}
                                    </span>
                                </div>
                            </div>

                            {/* Granulometry P80 & 3D .glb Digital Twin Verification Strip */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none flex items-center justify-between gap-fib-13">
                                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('rosin_rammler.p80_label', 'P80 (mm)')}
                                    </span>
                                    <span
                                        className={`font-mono tabular-nums ${
                                            typeof selectedP80Mm === 'number' &&
                                            Number.isFinite(selectedP80Mm)
                                                ? 'text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]'
                                                : 'text-microcopy text-[#94A3B8] dark:text-[#5A6072]'
                                        }`}
                                    >
                                        {typeof selectedP80Mm === 'number' &&
                                        Number.isFinite(selectedP80Mm)
                                            ? `${selectedP80Mm.toFixed(1)} mm`
                                            : UNDECLARED_TECH_VALUE}
                                    </span>
                                </div>
                                <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none flex items-center justify-between gap-fib-13">
                                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('twin3d.title', 'GEMELO DIGITAL 3D (.glb)')}
                                    </span>
                                    <span
                                        className={`font-mono tabular-nums ${
                                            selectedMeshSha256
                                                ? 'text-data-dense font-bold text-[#00AEEF]'
                                                : 'text-microcopy text-[#94A3B8] dark:text-[#5A6072]'
                                        }`}
                                    >
                                        {selectedMeshStatus ??
                                            t('common.pending_record', '[Pendiente de registro]')}
                                    </span>
                                </div>
                            </div>

                            {/* Block 1: Identity & UTM Geolocation */}
                            <ReportBlockEditable
                                title={t(
                                    'analytics.geospatial_utm_title',
                                    'GEOLOCALIZACIÓN SOBERANA UTM'
                                )}
                                code={selectedAsset.id}
                                isEditing={editingBlock === 'identity'}
                                onToggleEdit={() =>
                                    setEditingBlock((b) =>
                                        b === 'identity' ? null : 'identity'
                                    )
                                }
                                editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                            >
                                {editingBlock === 'identity' ? (
                                    <form
                                        onSubmit={handlePrepareIdentitySave}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="flex flex-col gap-fib-13"
                                    >
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                            <label className="flex flex-col gap-fib-8">
                                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t(
                                                        'registration.name_label',
                                                        'ID / NOMBRE DEL ACOPIO'
                                                    )}
                                                </span>
                                                <input
                                                    type="text"
                                                    value={draftName}
                                                    onChange={(e) => setDraftName(e.target.value)}
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    required
                                                    className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-fib-8">
                                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t(
                                                        'registration.location_ref_label',
                                                        'REFERENCIA UBICACIÓN'
                                                    )}
                                                </span>
                                                <input
                                                    type="text"
                                                    value={draftLocationRef}
                                                    onChange={(e) =>
                                                        setDraftLocationRef(e.target.value)
                                                    }
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-fib-8">
                                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t(
                                                        'registration.copper_domain_label',
                                                        'DOMINIO MINERAL COBRE (Cu)'
                                                    )}
                                                </span>
                                                <select
                                                    value={draftCopperDomain}
                                                    onChange={(e) =>
                                                        setDraftCopperDomain(
                                                            e.target.value as
                                                                | CopperMineralDomain
                                                                | ''
                                                        )
                                                    }
                                                    className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                                                >
                                                    <option value="">{UNDECLARED_TECH_VALUE}</option>
                                                    {COPPER_DOMAIN_LIST.map((dom) => (
                                                        <option key={dom} value={dom}>
                                                            {t(`copper_domains.${dom}`, dom)}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="flex flex-col gap-fib-8">
                                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t(
                                                        'registration.material_label',
                                                        'MATERIAL / MINERAL'
                                                    )}
                                                </span>
                                                <select
                                                    value={draftClase}
                                                    onChange={(e) =>
                                                        setDraftClase(
                                                            e.target.value as StockpileAsset['clase']
                                                        )
                                                    }
                                                    className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                                                >
                                                    <option value="mineral">
                                                        {t('material_type.mineral', 'Mineral')}
                                                    </option>
                                                    <option value="baja_ley">
                                                        {t('material_type.baja_ley', 'Baja Ley')}
                                                    </option>
                                                    <option value="esteril">
                                                        {t('material_type.esteril', 'Estéril')}
                                                    </option>
                                                </select>
                                            </label>
                                        </div>
                                        <div className="flex justify-end gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                                            <button
                                                type="button"
                                                onClick={() => setEditingBlock(null)}
                                                className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6] cursor-pointer rounded-none"
                                            >
                                                {t('common.cancel_button', 'CANCELAR')}
                                            </button>
                                            <button
                                                type="submit"
                                                className="px-fib-21 py-fib-8 bg-[#C68346] text-[#FFFFFF] text-microcopy font-mono font-bold uppercase border border-[#C68346] cursor-pointer rounded-none"
                                            >
                                                {t('hitl.save_audit', 'GUARDAR AUDITORÍA')}
                                            </button>
                                        </div>
                                    </form>
                                ) : (
                                    <div className="flex flex-col gap-fib-13">
                                        <div>
                                            <ReportFieldRow
                                                label={t(
                                                    'registration.name_label',
                                                    'ID / NOMBRE DEL ACOPIO'
                                                )}
                                                value={selectedAsset.name}
                                                mono
                                                copyable
                                            />
                                            <ReportFieldRow
                                                label={t(
                                                    'registration.location_ref_label',
                                                    'REFERENCIA UBICACIÓN'
                                                )}
                                                value={selectedAsset.location_ref || null}
                                            />
                                            <ReportFieldRow
                                                label={t(
                                                    'registration.copper_domain_label',
                                                    'DOMINIO MINERAL COBRE (Cu)'
                                                )}
                                                value={
                                                    selectedAsset.copper_domain
                                                        ? t(
                                                              `copper_domains.${selectedAsset.copper_domain}`,
                                                              selectedAsset.copper_domain
                                                          )
                                                        : null
                                                }
                                                mono
                                            />
                                            <ReportFieldRow
                                                label={t('geometries.subtitle', 'MODELO VOLUMÉTRICO')}
                                                value={
                                                    selectedAsset.last_geometry_type
                                                        ? t(
                                                              `geometries.${selectedAsset.last_geometry_type}`,
                                                              String(selectedAsset.last_geometry_type)
                                                          )
                                                        : null
                                                }
                                                mono
                                            />
                                            <ReportFieldRow
                                                label="UTM (WGS84)"
                                                value={canonicalFix?.utm.formatted || null}
                                                mono
                                                copyable={Boolean(canonicalFix)}
                                            />
                                        </div>
                                        {canonicalFix && (
                                            <SovereignGeoMapLazy
                                                fix={canonicalFix}
                                                interactive={false}
                                                label={selectedAsset.name}
                                                heightPx={200}
                                            />
                                        )}
                                    </div>
                                )}
                            </ReportBlockEditable>

                            {/* Block 2: Copper Metallurgy & Romana */}
                            <ReportBlockEditable
                                title={t(
                                    'copper_governance.title',
                                    'GOBERNANZA METALÚRGICA COBRE (Cu)'
                                )}
                                isEditing={editingBlock === 'metallurgy'}
                                onToggleEdit={() =>
                                    setEditingBlock((b) =>
                                        b === 'metallurgy' ? null : 'metallurgy'
                                    )
                                }
                                editAriaLabel={t('hitl.edit_block', 'EDITAR BLOQUE')}
                            >
                                {editingBlock === 'metallurgy' ? (
                                    <form
                                        onSubmit={handlePrepareMetallurgySave}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="flex flex-col gap-fib-13"
                                    >
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-fib-13">
                                            <label className="flex flex-col gap-fib-8">
                                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t('copper_governance.moisture', 'HUMEDAD w%')}
                                                </span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    max="100"
                                                    value={draftMoisture}
                                                    onChange={(e) =>
                                                        setDraftMoisture(e.target.value)
                                                    }
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense rounded-none"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-fib-8">
                                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t('copper_governance.tml', 'TML%')}
                                                </span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    max="100"
                                                    value={draftTml}
                                                    onChange={(e) => setDraftTml(e.target.value)}
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense rounded-none"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-fib-8">
                                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t(
                                                        'copper_governance.days',
                                                        'DÍAS DE RESIDENCIA'
                                                    )}
                                                </span>
                                                <input
                                                    type="number"
                                                    step="1"
                                                    min="0"
                                                    value={draftDays}
                                                    onChange={(e) => setDraftDays(e.target.value)}
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense rounded-none"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-fib-8">
                                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t(
                                                        'manual_capture.fields.cu_total_pct',
                                                        'LEY CuT (%)'
                                                    )}
                                                </span>
                                                <input
                                                    type="number"
                                                    step="0.001"
                                                    min="0"
                                                    max="100"
                                                    value={draftCuT}
                                                    onChange={(e) => setDraftCuT(e.target.value)}
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense rounded-none"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-fib-8">
                                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t(
                                                        'manual_capture.fields.cu_soluble_pct',
                                                        'LEY CuS (%)'
                                                    )}
                                                </span>
                                                <input
                                                    type="number"
                                                    step="0.001"
                                                    min="0"
                                                    max="100"
                                                    value={draftCuS}
                                                    onChange={(e) => setDraftCuS(e.target.value)}
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense rounded-none"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-fib-8">
                                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t(
                                                        'copper_governance.scale_weight',
                                                        'PESO ROMANA [t]'
                                                    )}
                                                </span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={draftRomana}
                                                    onChange={(e) =>
                                                        setDraftRomana(e.target.value)
                                                    }
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    className="w-full px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-data-dense rounded-none"
                                                />
                                            </label>
                                        </div>
                                        <div className="flex justify-end gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                                            <button
                                                type="button"
                                                onClick={() => setEditingBlock(null)}
                                                className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6] cursor-pointer rounded-none"
                                            >
                                                {t('common.cancel_button', 'CANCELAR')}
                                            </button>
                                            <button
                                                type="submit"
                                                className="px-fib-21 py-fib-8 bg-[#C68346] text-[#FFFFFF] text-microcopy font-mono font-bold uppercase border border-[#C68346] cursor-pointer rounded-none"
                                            >
                                                {t('hitl.save_audit', 'GUARDAR AUDITORÍA')}
                                            </button>
                                        </div>
                                    </form>
                                ) : (
                                    <div className="flex flex-col">
                                        <ReportFieldRow
                                            label={t('copper_governance.moisture', 'HUMEDAD w%')}
                                            value={
                                                selectedAsset.moisture_pct != null
                                                    ? `${selectedAsset.moisture_pct}%`
                                                    : null
                                            }
                                            mono
                                        />
                                        <ReportFieldRow
                                            label={t('copper_governance.tml', 'TML%')}
                                            value={
                                                selectedAsset.tml_pct != null
                                                    ? `${selectedAsset.tml_pct}%`
                                                    : null
                                            }
                                            mono
                                        />
                                        <ReportFieldRow
                                            label={t(
                                                'manual_capture.fields.cu_total_pct',
                                                'LEY CuT (%)'
                                            )}
                                            value={
                                                selectedAsset.cu_total_pct != null
                                                    ? `${selectedAsset.cu_total_pct}%`
                                                    : null
                                            }
                                            mono
                                        />
                                        <ReportFieldRow
                                            label={t(
                                                'manual_capture.fields.cu_soluble_pct',
                                                'LEY CuS (%)'
                                            )}
                                            value={
                                                selectedAsset.cu_soluble_pct != null
                                                    ? `${selectedAsset.cu_soluble_pct}%`
                                                    : null
                                            }
                                            mono
                                        />
                                        <ReportFieldRow
                                            label={t(
                                                'copper_governance.rs_pct',
                                                'RAZÓN SOLUBILIDAD RS%'
                                            )}
                                            value={selectedRs !== null ? `${selectedRs}%` : null}
                                            mono
                                        />
                                        <ReportFieldRow
                                            label={t(
                                                'copper_governance.days',
                                                'DÍAS DE RESIDENCIA'
                                            )}
                                            value={
                                                selectedAsset.residence_days != null
                                                    ? `${selectedAsset.residence_days} d`
                                                    : null
                                            }
                                            mono
                                        />
                                        <ReportFieldRow
                                            label={t(
                                                'copper_governance.scale_weight',
                                                'PESO ROMANA [t]'
                                            )}
                                            value={
                                                selectedAsset.peso_romana != null &&
                                                selectedAsset.peso_romana > 0
                                                    ? `${selectedAsset.peso_romana.toFixed(2)} t${
                                                          selectedRomanaCmp
                                                              ? ` (Δ ${selectedRomanaCmp.differencePercent.toFixed(2)}%)`
                                                              : ''
                                                      }`
                                                    : null
                                            }
                                            mono
                                        />
                                    </div>
                                )}
                            </ReportBlockEditable>

                            {/* CAS Evidence & Traceability */}
                            <section className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none flex flex-col sm:flex-row gap-fib-21 items-start">
                                <div className="w-full sm:w-44 h-32 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-center overflow-hidden shrink-0 rounded-none">
                                    {resolvedHeroPhoto ? (
                                        <SecureImage
                                            src={resolvedHeroPhoto}
                                            alt={selectedAsset.name}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <span className="material-symbols-outlined text-[32px] text-[#94A3B8] dark:text-[#5A6072]">
                                            landscape
                                        </span>
                                    )}
                                </div>
                                <div className="flex-1 w-full min-w-0">
                                    <h3 className="text-microcopy font-mono font-bold uppercase tracking-wider mb-fib-8">
                                        {t(
                                            'analytics.cas_traceability_title',
                                            'TRAZABILIDAD MULTIMEDIA CAS'
                                        )}
                                    </h3>
                                    <ReportFieldRow
                                        label={t('capture.cas_trace_label', 'TRAZABILIDAD CAS')}
                                        value={selectedCasTrace}
                                        mono
                                        copyable={Boolean(selectedCasTrace)}
                                    />
                                    <ReportFieldRow
                                        label={t('rosin_rammler.p80_label', 'P80 (mm)')}
                                        value={
                                            typeof selectedP80Mm === 'number' &&
                                            Number.isFinite(selectedP80Mm)
                                                ? `${selectedP80Mm.toFixed(1)} mm`
                                                : null
                                        }
                                        mono
                                    />
                                    <ReportFieldRow
                                        label={t('twin3d.mesh_sha256_label', 'SHA-256 MALLA .glb')}
                                        value={
                                            selectedMeshStatus ??
                                            t('common.pending_record', '[Pendiente de registro]')
                                        }
                                        mono
                                        copyable={Boolean(selectedMeshSha256)}
                                    />
                                </div>
                            </section>

                            {/* Trend Chart */}
                            {chartData.length > 0 && (
                                <section className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                                    <h3 className="text-microcopy font-mono font-bold uppercase tracking-wider mb-fib-13">
                                        {t('analytics.history_title', 'HISTORIAL DE MEDICIONES')}
                                    </h3>
                                    <div className="w-full h-56">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={chartData}>
                                                <CartesianGrid
                                                    strokeDasharray="3 3"
                                                    stroke={isDark ? '#12151C' : '#E2E8F0'}
                                                />
                                                <XAxis
                                                    dataKey="date"
                                                    tick={{
                                                        fill: isDark ? '#8A93A6' : '#475569',
                                                        fontSize: 11,
                                                    }}
                                                    stroke={isDark ? '#12151C' : '#E2E8F0'}
                                                />
                                                <YAxis
                                                    tick={{
                                                        fill: isDark ? '#8A93A6' : '#475569',
                                                        fontSize: 11,
                                                    }}
                                                    stroke={isDark ? '#12151C' : '#E2E8F0'}
                                                />
                                                <Tooltip
                                                    contentStyle={{
                                                        backgroundColor: isDark
                                                            ? '#07090D'
                                                            : '#FFFFFF',
                                                        borderColor: isDark ? '#12151C' : '#E2E8F0',
                                                        borderRadius: 0,
                                                        color: isDark ? '#F3F4F6' : '#0F172A',
                                                        fontSize: '12px',
                                                    }}
                                                />
                                                <Area
                                                    type="monotone"
                                                    dataKey="weight"
                                                    name={t('copper_governance.thm', 'THM [t]')}
                                                    stroke="#C68346"
                                                    fill="#C68346"
                                                    fillOpacity={0.18}
                                                />
                                                <Area
                                                    type="monotone"
                                                    dataKey="volume"
                                                    name="m³"
                                                    stroke="#00AEEF"
                                                    fill="#00AEEF"
                                                    fillOpacity={0.12}
                                                />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </section>
                            )}

                            {/* Measurements Ledger Table */}
                            <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] rounded-none overflow-hidden">
                                <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] flex items-center justify-between">
                                    <h3 className="text-microcopy font-mono font-bold uppercase tracking-wider">
                                        {t('analytics.history_title', 'HISTORIAL DE MEDICIONES')} (
                                        {assetMeasurements.length})
                                    </h3>
                                </div>
                                {assetMeasurements.length === 0 ? (
                                    <div className="p-fib-21 text-data-dense font-mono text-[#475569] dark:text-[#8A93A6]">
                                        {UNDECLARED_TECH_VALUE}
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse font-mono tabular-nums text-data-dense">
                                            <thead>
                                                <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    <th className="py-fib-8 px-fib-13">FECHA</th>
                                                    <th className="py-fib-8 px-fib-13">MODELO</th>
                                                    <th className="py-fib-8 px-fib-13 text-right">
                                                        VOL [m³]
                                                    </th>
                                                    <th className="py-fib-8 px-fib-13 text-right">
                                                        THM [t]
                                                    </th>
                                                    <th className="py-fib-8 px-fib-13 text-right">
                                                        ACCIONES
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {assetMeasurements.map((m) => (
                                                    <tr
                                                        key={m.id}
                                                        className={`border-b border-[#E2E8F0] dark:border-[#12151C] ${
                                                            m.ignored ? 'opacity-50' : ''
                                                        }`}
                                                    >
                                                        <td className="py-fib-8 px-fib-13">
                                                            {new Date(m.timestamp).toLocaleString()}
                                                        </td>
                                                        <td className="py-fib-8 px-fib-13">
                                                            {m.geometry?.type
                                                                ? t(
                                                                      `geometries.${m.geometry.type}`,
                                                                      String(m.geometry.type)
                                                                  )
                                                                : m.method}
                                                        </td>
                                                        <td className="py-fib-8 px-fib-13 text-right">
                                                            {m.volumen_m3.toFixed(2)}
                                                        </td>
                                                        <td className="py-fib-8 px-fib-13 text-right font-bold text-[#C68346]">
                                                            {m.peso_t.toFixed(2)}
                                                        </td>
                                                        <td className="py-fib-8 px-fib-13 text-right">
                                                            <div className="inline-flex items-center gap-fib-8">
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        handleExportAssetPdf([m])
                                                                    }
                                                                    title={t(
                                                                        'pdf.export_button',
                                                                        'EXPORTAR PDF VECTORIAL'
                                                                    )}
                                                                    aria-label={t(
                                                                        'pdf.export_button',
                                                                        'EXPORTAR PDF VECTORIAL'
                                                                    )}
                                                                    className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] cursor-pointer"
                                                                >
                                                                    <span className="material-symbols-outlined text-[18px]">
                                                                        picture_as_pdf
                                                                    </span>
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        dataService.toggleIgnoreMeasurement(
                                                                            m.id,
                                                                            m.assetId,
                                                                            Boolean(m.ignored)
                                                                        )
                                                                    }
                                                                    title={t(
                                                                        'analytics.ignored_label',
                                                                        'IGNORADO'
                                                                    )}
                                                                    aria-label={t(
                                                                        'analytics.ignored_label',
                                                                        'IGNORADO'
                                                                    )}
                                                                    className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer"
                                                                >
                                                                    <span className="material-symbols-outlined text-[18px]">
                                                                        {m.ignored
                                                                            ? 'visibility_off'
                                                                            : 'visibility'}
                                                                    </span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </section>
                        </div>
                    )}
                </section>
            </div>

            {/* Modal 1: Create New Asset */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-fib-21">
                    <div className="w-full max-w-lg bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none p-fib-21 flex flex-col gap-fib-13">
                        <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                            <h2 className="text-h2-section font-bold uppercase">
                                {t('analytics.new_asset_button', 'NUEVO ACOPIO')}
                            </h2>
                            <button
                                type="button"
                                onClick={() => setShowCreateModal(false)}
                                aria-label={t('common.close_button', 'CERRAR')}
                                className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>

                        <form
                            onSubmit={handleCreateAsset}
                            autoComplete="off"
                            spellCheck={false}
                            className="flex flex-col gap-fib-13"
                        >
                            <label className="flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('registration.name_label', 'ID / NOMBRE DEL ACOPIO')}
                                </span>
                                <input
                                    type="text"
                                    value={newAssetName}
                                    onChange={(e) => setNewAssetName(e.target.value)}
                                    placeholder={t(
                                        'registration.name_placeholder',
                                        'EJ: ACOPIO_NORTE_01'
                                    )}
                                    autoComplete="off"
                                    spellCheck={false}
                                    required
                                    className="w-full px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                                />
                            </label>

                            <label className="flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('registration.location_ref_label', 'REFERENCIA UBICACIÓN')}
                                </span>
                                <input
                                    type="text"
                                    value={newAssetLocation}
                                    onChange={(e) => setNewAssetLocation(e.target.value)}
                                    placeholder={t(
                                        'registration.location_ref_placeholder',
                                        'EJ: NIVEL 2400'
                                    )}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                                />
                            </label>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                <label className="flex flex-col gap-fib-8">
                                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t(
                                            'registration.copper_domain_label',
                                            'DOMINIO MINERAL COBRE (Cu)'
                                        )}
                                    </span>
                                    <select
                                        value={newAssetDomain}
                                        onChange={(e) =>
                                            setNewAssetDomain(e.target.value as CopperMineralDomain)
                                        }
                                        className="w-full px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                                    >
                                        {COPPER_DOMAIN_LIST.map((dom) => (
                                            <option key={dom} value={dom}>
                                                {t(`copper_domains.${dom}`, dom)}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <label className="flex flex-col gap-fib-8">
                                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('registration.material_label', 'MATERIAL / MINERAL')}
                                    </span>
                                    <select
                                        value={newAssetClase}
                                        onChange={(e) =>
                                            setNewAssetClase(
                                                e.target.value as StockpileAsset['clase']
                                            )
                                        }
                                        className="w-full px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                                    >
                                        <option value="mineral">
                                            {t('material_type.mineral', 'Mineral')}
                                        </option>
                                        <option value="baja_ley">
                                            {t('material_type.baja_ley', 'Baja Ley')}
                                        </option>
                                        <option value="esteril">
                                            {t('material_type.esteril', 'Estéril')}
                                        </option>
                                    </select>
                                </label>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                                <div className="flex items-center gap-fib-8">
                                    <button
                                        type="button"
                                        onClick={handleCaptureCreateGeo}
                                        disabled={isCapturingCreateGeo}
                                        className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] text-microcopy font-mono uppercase flex items-center gap-fib-8 cursor-pointer rounded-none"
                                    >
                                        {isCapturingCreateGeo ? (
                                            <M3CircularProgress indeterminate size={14} />
                                        ) : (
                                            <span className="material-symbols-outlined text-[16px] text-[#00AEEF]">
                                                my_location
                                            </span>
                                        )}
                                        <span>
                                            {newAssetGeo
                                                ? `${newAssetGeo.latitude.toFixed(4)}, ${newAssetGeo.longitude.toFixed(4)}`
                                                : 'GNSS'}
                                        </span>
                                    </button>

                                    <input
                                        ref={createFileRef}
                                        type="file"
                                        accept="image/*"
                                        autoComplete="off"
                                        spellCheck={false}
                                        onChange={(e) =>
                                            setCreatePhotoFile(e.target.files?.[0] ?? null)
                                        }
                                        className="hidden"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => createFileRef.current?.click()}
                                        className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] text-microcopy font-mono uppercase flex items-center gap-fib-8 cursor-pointer rounded-none"
                                    >
                                        <span className="material-symbols-outlined text-[16px] text-[#C68346]">
                                            photo_camera
                                        </span>
                                        <span>
                                            {createPhotoFile ? createPhotoFile.name : 'CAS FOTO'}
                                        </span>
                                    </button>
                                </div>

                                <div className="flex items-center gap-fib-8">
                                    <button
                                        type="button"
                                        onClick={() => setShowCreateModal(false)}
                                        className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] text-microcopy font-mono uppercase cursor-pointer rounded-none"
                                    >
                                        {t('common.cancel_button', 'CANCELAR')}
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isCreatingAsset}
                                        className="px-fib-21 py-fib-8 bg-[#C68346] text-[#FFFFFF] text-microcopy font-mono font-bold uppercase border border-[#C68346] cursor-pointer rounded-none"
                                    >
                                        {isCreatingAsset
                                            ? t('common.loading', 'CARGANDO...')
                                            : t('common.save_button', 'GUARDAR')}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal 2: New Measurement (All 5 Geometries + Copper Assays) */}
            {showMeasModal && selectedAsset && (
                <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-fib-21">
                    <div className="w-full max-w-2xl max-h-[90vh] bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none p-fib-21 flex flex-col gap-fib-13 overflow-hidden">
                        <div className="shrink-0 flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                            <div>
                                <span className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {selectedAsset.name}
                                </span>
                                <h2 className="text-h2-section font-bold uppercase">
                                    {t('analytics.new_measurement_button', 'NUEVA MEDICIÓN')}
                                </h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowMeasModal(false)}
                                aria-label={t('common.close_button', 'CERRAR')}
                                className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>

                        <form
                            onSubmit={handleSaveMeasurement}
                            autoComplete="off"
                            spellCheck={false}
                            className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col gap-fib-13 pr-fib-8"
                        >
                            {/* 5 Geometry Selector */}
                            <label className="flex flex-col gap-fib-8">
                                <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('geometries.title', 'GEOMETRÍA DEL SÓLIDO')}
                                </span>
                                <select
                                    value={measGeometry}
                                    onChange={(e) =>
                                        setMeasGeometry(e.target.value as GeolappGeometryType)
                                    }
                                    className="w-full px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense rounded-none"
                                >
                                    {GEOMETRY_LIST.map((geo) => (
                                        <option key={geo} value={geo}>
                                            {t(`geometries.${geo}`, geo)}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            {/* Geometry-specific Inputs */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-fib-13">
                                {(measGeometry === 'CONO_ELIPTICO' ||
                                    measGeometry === 'CONO_ELIPTICO_TRUNCADO') && (
                                    <>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.major_axis_base',
                                                    'EJE MAYOR BASE (m)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                required
                                                value={measDims.d1}
                                                onChange={(e) =>
                                                    setMeasDims({ ...measDims, d1: e.target.value })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.minor_axis_base',
                                                    'EJE MENOR BASE (m)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                required
                                                value={measDims.d2}
                                                onChange={(e) =>
                                                    setMeasDims({ ...measDims, d2: e.target.value })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                    </>
                                )}

                                {measGeometry === 'CONO_ELIPTICO_TRUNCADO' && (
                                    <>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.major_axis_top',
                                                    'EJE MAYOR SUP (m)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={measDims.d1p}
                                                onChange={(e) =>
                                                    setMeasDims({
                                                        ...measDims,
                                                        d1p: e.target.value,
                                                    })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.minor_axis_top',
                                                    'EJE MENOR SUP (m)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={measDims.d2p}
                                                onChange={(e) =>
                                                    setMeasDims({
                                                        ...measDims,
                                                        d2p: e.target.value,
                                                    })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                    </>
                                )}

                                {measGeometry === 'CONO_TRUNCADO_PERIMETRO' && (
                                    <>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.perimeter_base',
                                                    'PERÍMETRO BASE (m)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                required
                                                value={measDims.p}
                                                onChange={(e) =>
                                                    setMeasDims({ ...measDims, p: e.target.value })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.perimeter_top',
                                                    'PERÍMETRO SUP (m)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={measDims.pp}
                                                onChange={(e) =>
                                                    setMeasDims({ ...measDims, pp: e.target.value })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                    </>
                                )}

                                {measGeometry === 'PILA_LONGITUDINAL_WINDROW' && (
                                    <>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.base_length',
                                                    'LONGITUD BASE (m)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                required
                                                value={measDims.baseLengthM}
                                                onChange={(e) =>
                                                    setMeasDims({
                                                        ...measDims,
                                                        baseLengthM: e.target.value,
                                                    })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.base_width',
                                                    'ANCHO BASE (m)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                required
                                                value={measDims.baseWidthM}
                                                onChange={(e) =>
                                                    setMeasDims({
                                                        ...measDims,
                                                        baseWidthM: e.target.value,
                                                    })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.crest_length',
                                                    'LONGITUD CRESTA (m)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={measDims.crestLengthM}
                                                onChange={(e) =>
                                                    setMeasDims({
                                                        ...measDims,
                                                        crestLengthM: e.target.value,
                                                    })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.crest_width',
                                                    'ANCHO CRESTA (m)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={measDims.crestWidthM}
                                                onChange={(e) =>
                                                    setMeasDims({
                                                        ...measDims,
                                                        crestWidthM: e.target.value,
                                                    })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                    </>
                                )}

                                {measGeometry === 'ACOPIO_CONTRA_MURO' && (
                                    <>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.wall_length',
                                                    'LONGITUD EN MURO (m)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                required
                                                value={measDims.lengthM}
                                                onChange={(e) =>
                                                    setMeasDims({
                                                        ...measDims,
                                                        lengthM: e.target.value,
                                                    })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.width_from_wall',
                                                    'ALCANCE DESDE MURO (m)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                required
                                                value={measDims.widthFromWallM}
                                                onChange={(e) =>
                                                    setMeasDims({
                                                        ...measDims,
                                                        widthFromWallM: e.target.value,
                                                    })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.height_at_wall',
                                                    'ALTURA EN MURO (m)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                required
                                                value={measDims.heightAtWallM}
                                                onChange={(e) =>
                                                    setMeasDims({
                                                        ...measDims,
                                                        heightAtWallM: e.target.value,
                                                    })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'manual_capture.fields.wall_angle_deg',
                                                    'ÁNGULO DE MURO (deg)'
                                                )}
                                            </span>
                                            <input
                                                type="number"
                                                step="0.5"
                                                min="1"
                                                max="90"
                                                value={measDims.wallAngleDeg}
                                                onChange={(e) =>
                                                    setMeasDims({
                                                        ...measDims,
                                                        wallAngleDeg: e.target.value,
                                                    })
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                            />
                                        </label>
                                    </>
                                )}

                                {measGeometry !== 'ACOPIO_CONTRA_MURO' && (
                                    <label className="flex flex-col gap-fib-8">
                                        <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t(
                                                'manual_capture.fields.total_height',
                                                'ALTURA TOTAL (m)'
                                            )}
                                        </span>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0.01"
                                            required
                                            value={measDims.h}
                                            onChange={(e) =>
                                                setMeasDims({ ...measDims, h: e.target.value })
                                            }
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                        />
                                    </label>
                                )}

                                <label className="flex flex-col gap-fib-8">
                                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t(
                                            'manual_capture.fields.density_factor',
                                            'FACTOR DENSIDAD (t/m3)'
                                        )}
                                    </span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        required
                                        value={measDensity}
                                        onChange={(e) => setMeasDensity(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                    />
                                </label>
                            </div>

                            {/* Copper Assays */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                                <label className="flex flex-col gap-fib-8">
                                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('manual_capture.fields.moisture_pct', 'HUMEDAD w (%)')}
                                    </span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="100"
                                        value={measMoisture}
                                        onChange={(e) => setMeasMoisture(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                    />
                                </label>
                                <label className="flex flex-col gap-fib-8">
                                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('manual_capture.fields.tml_pct', 'TML (%)')}
                                    </span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="100"
                                        value={measTml}
                                        onChange={(e) => setMeasTml(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                    />
                                </label>
                                <label className="flex flex-col gap-fib-8">
                                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t(
                                            'manual_capture.fields.residence_days',
                                            'DÍAS DE RESIDENCIA'
                                        )}
                                    </span>
                                    <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={measDays}
                                        onChange={(e) => setMeasDays(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                    />
                                </label>
                                <label className="flex flex-col gap-fib-8">
                                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('manual_capture.fields.cu_total_pct', 'LEY CuT (%)')}
                                    </span>
                                    <input
                                        type="number"
                                        step="0.001"
                                        min="0"
                                        max="100"
                                        value={measCuT}
                                        onChange={(e) => setMeasCuT(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                    />
                                </label>
                                <label className="flex flex-col gap-fib-8">
                                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('manual_capture.fields.cu_soluble_pct', 'LEY CuS (%)')}
                                    </span>
                                    <input
                                        type="number"
                                        step="0.001"
                                        min="0"
                                        max="100"
                                        value={measCuS}
                                        onChange={(e) => setMeasCuS(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                                    />
                                </label>
                            </div>

                            {/* Live Deterministic Preview */}
                            <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between font-mono tabular-nums text-data-dense rounded-none">
                                <span>
                                    {t('manual_capture.estimated_volume', 'VOLUMEN')}:{' '}
                                    <strong>{computedMeasVolume.toFixed(2)} m³</strong>
                                </span>
                                <span className="text-[#C68346]">
                                    THM: <strong>{computedMeasThm.toFixed(2)} t</strong>
                                </span>
                            </div>

                            {modalGovernance.alerts.length > 0 && (
                                <div className="p-fib-13 border border-[#C68346] bg-[#C68346]/10 text-microcopy font-mono rounded-none">
                                    {modalGovernance.alerts.map((al) => (
                                        <div key={al.code}>
                                            [{al.code}] {al.message}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Optional Real GNSS + CAS Photo + Save */}
                            <div className="flex flex-wrap items-center justify-between gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                                <div className="flex items-center gap-fib-8">
                                    <button
                                        type="button"
                                        onClick={handleCaptureMeasGeo}
                                        disabled={isCapturingMeasGeo}
                                        className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] text-microcopy font-mono uppercase flex items-center gap-fib-8 cursor-pointer rounded-none"
                                    >
                                        {isCapturingMeasGeo ? (
                                            <M3CircularProgress indeterminate size={14} />
                                        ) : (
                                            <span className="material-symbols-outlined text-[16px] text-[#00AEEF]">
                                                my_location
                                            </span>
                                        )}
                                        <span>
                                            {measGeo
                                                ? `${measGeo.lat.toFixed(4)}, ${measGeo.lng.toFixed(4)}`
                                                : 'GNSS'}
                                        </span>
                                    </button>

                                    <input
                                        ref={measFileRef}
                                        type="file"
                                        accept="image/*"
                                        autoComplete="off"
                                        spellCheck={false}
                                        onChange={(e) =>
                                            setMeasPhotoFile(e.target.files?.[0] ?? null)
                                        }
                                        className="hidden"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => measFileRef.current?.click()}
                                        className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] text-microcopy font-mono uppercase flex items-center gap-fib-8 cursor-pointer rounded-none"
                                    >
                                        <span className="material-symbols-outlined text-[16px] text-[#C68346]">
                                            photo_camera
                                        </span>
                                        <span>
                                            {measPhotoFile ? measPhotoFile.name : 'CAS FOTO'}
                                        </span>
                                    </button>
                                </div>

                                <div className="flex items-center gap-fib-8">
                                    <button
                                        type="button"
                                        onClick={() => setShowMeasModal(false)}
                                        className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] text-microcopy font-mono uppercase cursor-pointer rounded-none"
                                    >
                                        {t('common.cancel_button', 'CANCELAR')}
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSavingMeas}
                                        className="px-fib-21 py-fib-8 bg-[#C68346] text-[#FFFFFF] text-microcopy font-mono font-bold uppercase border border-[#C68346] cursor-pointer rounded-none"
                                    >
                                        {isSavingMeas
                                            ? t('common.loading', 'CARGANDO...')
                                            : t('manual_capture.save_measurement', 'GUARDAR MEDICIÓN')}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* HITL Modal for Update ("ACTUALIZAR") or Delete ("ELIMINAR") */}
            <HitlConfirmModal
                open={Boolean(pendingHitl)}
                title={t('hitl.modal_title', 'CONFIRMACIÓN HITL DE AUDITORÍA')}
                description={
                    pendingHitl?.mode === 'DELETE'
                        ? t(
                              'common.delete_button',
                              'Confirmar eliminación de activo escribiendo ELIMINAR.'
                          )
                        : t(
                              'hitl.modal_description',
                              'Revise el diferencial [Actual] -> [Sugerido] y escriba ACTUALIZAR para registrar en AuditLedger.'
                          )
                }
                keyword={pendingHitl?.mode === 'DELETE' ? 'ELIMINAR' : 'ACTUALIZAR'}
                comparisonDiff={pendingHitl?.diffs || []}
                confirmLabel={
                    pendingHitl?.mode === 'DELETE'
                        ? t('common.delete_button', 'ELIMINAR')
                        : t('hitl.save_audit', 'GUARDAR AUDITORÍA')
                }
                cancelLabel={t('common.cancel_button', 'CANCELAR')}
                loading={isSavingHitl}
                onConfirm={handleConfirmHitl}
                onCancel={() => setPendingHitl(null)}
            />
        </main>
    );
};
