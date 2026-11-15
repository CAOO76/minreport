/**
 * GEOLAPP Core Types (MINREPORT)
 * Contratos de dominio para cubicación industrial, gobernanza geo-metalúrgica de Cobre (Cu),
 * trazabilidad CAS y soporte a geometrías cono, windrow y acopio contra muro.
 */

export type CopperMineralDomain =
    | 'OXIDO_CU'
    | 'MIXTO_CU'
    | 'SULFURO_SECUNDARIO_CU'
    | 'SULFURO_PRIMARIO_CU'
    | 'CONCENTRADO_CU'
    | 'BAJA_LEY_CU'
    | 'ESTERIL_RIPIOS';

export type CopperDomain = CopperMineralDomain;

export type StockpileStatus = 'ACTIVE' | 'ARCHIVED' | 'CONCILIATED' | 'CLOSED';

export type GeolappGeometryType =
    | 'CONO_ELIPTICO'
    | 'CONO_ELIPTICO_TRUNCADO'
    | 'CONO_TRUNCADO_PERIMETRO'
    | 'PILA_LONGITUDINAL_WINDROW'
    | 'ACOPIO_CONTRA_MURO';

export type CopperGovernanceAlertCode =
    | 'SULFIDE_AGING_WARNING'
    | 'SULFIDE_AGING_CRITICAL'
    | 'CONCENTRATE_TML_EXCEEDED';

export interface CopperGovernanceAlert {
    code: CopperGovernanceAlertCode;
    severity: 'WARNING' | 'CRITICAL' | 'BLOCK';
    message: string;
    residenceDays?: number;
    moisturePct?: number;
    tmlLimitPct?: number;
}

export interface CopperGovernanceResult {
    alerts: CopperGovernanceAlert[];
    hasCriticalBlock: boolean;
    isValidForDispatch: boolean;
}

export interface WindrowDimensions {
    baseLengthM: number;
    baseWidthM: number;
    heightM: number;
    crestLengthM?: number;
    crestWidthM?: number;
}

export interface ToeWallDimensions {
    lengthM: number;
    widthFromWallM: number;
    heightAtWallM: number;
    wallAngleDeg?: number;
}

export interface HitlFieldDiff {
    field: string;
    current: string;
    suggested: string;
}

export interface BoulderDetectionBox2D {
    /** Bounding box normalizado [ymin, xmin, ymax, xmax] en rango 0..1000 */
    box_2d: [number, number, number, number];
    label: string;
    estimated_mm?: number;
    confidence?: number;
    crop_cas_url?: string;
    cas_original_bytes?: number;
    cas_optimized_bytes?: number;
    cas_savings_pct?: number;
}

export interface RosinRammlerSievePoint {
    size_mm: number;
    passing_pct: number;
    retained_pct: number;
}

export interface RosinRammlerProfile {
    xc_mm: number;
    uniformity_n: number;
    p80_mm: number;
    p50_mm: number;
    p20_mm: number;
    max_boulder_mm?: number;
    oversize_count: number;
    oversize_threshold_mm: number;
    source: 'VISION_BOX2D_SCALED' | 'MANUAL_PERCENTILES';
    curve: RosinRammlerSievePoint[];
}

export interface StockpileAsset {
    // Identificación y Aislamiento Multi-Tenant
    id: string;
    tenantId?: string;
    accountId?: string;
    name: string;
    clase: 'mineral' | 'esteril' | 'baja_ley';
    status?: StockpileStatus;
    createdAt: number;
    createdBy: string;
    updatedAt?: number;

    // Georeferencia Inicial (Opcional — Cero coordenadas falsas 0,0 cuando no hay GPS)
    geo_point?: {
        latitude: number;
        longitude: number;
        altitude: number | null;
        accuracy?: number;
    };
    location_ref?: string;

    // Recursos
    initial_photo_url?: string;
    thumbnail_url?: string;

    // Estado Actual (Metadata derivada de la última medición)
    last_volume_m3?: number;
    last_weight_t?: number;
    last_photo_url?: string;
    last_measured_at?: number;
    last_geometry_type?: GeolappGeometryType | string;

    // Compatibilidad con DesktopAnalytics & Reportes
    volumen?: number;
    volume_m3?: number;
    weight_t?: number;
    peso_final_toneladas?: number;
    density_factor?: number;
    tipo_granulometria?: 'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS';
    geometria?: string;
    location?: { lat: number; lng: number };
    timestamp?: number;
    peso_romana?: number | null;
    factor_real?: number;
    metadata?: {
        conciliado?: boolean;
        fecha_conciliacion?: number;
        [key: string]: any;
    };

    training_data?: {
        original_granulometry_prediction?: string;
        applied_granulometry?: string;
        photo_texture_features?: Record<string, number>;
        user_correction?: boolean;
    };

    // Parámetros Geo-Metalúrgicos Cobre (Cu) + Trazabilidad CAS
    copper_domain?: CopperMineralDomain;
    moisture_pct?: number | null;
    tml_pct?: number | null;
    wet_weight_thm?: number | null;
    dry_weight_tms?: number | null;
    cu_total_pct?: number | null;
    cu_soluble_pct?: number | null;
    fine_cu_t?: number | null;
    residence_days?: number | null;
    perimeter_photo_urls?: string[];
    cas_original_bytes?: number;
    cas_optimized_bytes?: number;
    cas_savings_pct?: number;
    copper_governance_alerts?: CopperGovernanceAlert[];

    // Gemelo Digital 3D (.glb) & Granulometría Rosin-Rammler (Fase 3)
    mesh_url?: string;
    mesh_sha256?: string;
    mesh_source?: string;
    tin_volume_m3?: number;
    mesh_original_bytes?: number;
    mesh_optimized_bytes?: number;
    mesh_savings_pct?: number;
    p80_mm?: number;
    rosin_rammler?: RosinRammlerProfile;
    boulder_detections?: BoulderDetectionBox2D[];
}

export interface StockpileMeasurement {
    id: string;
    assetId: string;
    tenantId?: string;
    accountId?: string;
    timestamp: number;

    // Resultados Técnicos
    volumen_m3: number;
    peso_t: number;
    density_factor?: number;

    // Evidencia
    photo_url: string;
    method: 'digital' | 'manual';

    // Georeferencia (Metadata de trazabilidad)
    location_metadata?: {
        lat: number;
        lng: number;
        accuracy: number;
    };

    // Usuario que realizó la medición (Trazabilidad)
    user_id?: string;

    // Detalles de Geometría
    geometry?: {
        type: GeolappGeometryType | string;
        dimensions: Record<string, number>;
    };

    // Aprendizaje IA (Modo Digital)
    operator_classification?: 'COLPA' | 'GRANSA' | 'FINO';
    operator_density?: number;
    texture_features?: {
        mean_luminance: number;
        std_dev: number;
        [key: string]: number;
    };
    imu_data?: {
        alpha: number | null;
        beta: number | null;
        gamma: number | null;
        accel_x: number | null;
        accel_y: number | null;
        accel_z: number | null;
    };

    // Clinometría IMU & Geometrías Avanzadas Wave 1
    imu_pitch_deg?: number;
    imu_height_m?: number;
    imu_distance_m?: number;
    imu_eye_height_m?: number;
    crest_length_m?: number;
    crest_width_m?: number;
    wall_angle_deg?: number;

    // Deltas vs Medición Anterior
    delta_volumen?: number;
    delta_peso?: number;

    // Parámetros Geo-Metalúrgicos Cobre (Cu) + Trazabilidad CAS
    copper_domain?: CopperMineralDomain;
    moisture_pct?: number | null;
    tml_pct?: number | null;
    wet_weight_thm?: number | null;
    dry_weight_tms?: number | null;
    cu_total_pct?: number | null;
    cu_soluble_pct?: number | null;
    fine_cu_t?: number | null;
    residence_days?: number | null;
    perimeter_photo_urls?: string[];
    cas_original_bytes?: number;
    cas_optimized_bytes?: number;
    cas_savings_pct?: number;
    copper_governance_alerts?: CopperGovernanceAlert[];

    // Gemelo Digital 3D (.glb) & Granulometría Rosin-Rammler (Fase 3)
    mesh_url?: string;
    mesh_sha256?: string;
    mesh_source?: string;
    tin_volume_m3?: number;
    mesh_original_bytes?: number;
    mesh_optimized_bytes?: number;
    mesh_savings_pct?: number;
    p80_mm?: number;
    rosin_rammler?: RosinRammlerProfile;
    boulder_detections?: BoulderDetectionBox2D[];

    // Estado Lógico
    ignored?: boolean;
}

// ─── FASE 4: DOMINIOS GEOCIENTÍFICOS Y TOPOGRÁFICOS GEOLAPP® ───

export type GeolappDomainMode =
    | 'STOCKPILE'
    | 'GEOMENSURA_GEO'
    | 'EXPLORACION_SONDAJES'
    | 'ESTRUCTURAL_HIDRO';

export type GeolappNonStockpileDomainMode = Exclude<GeolappDomainMode, 'STOCKPILE'>;

export type GeolappDomainRecordStatus = 'ACTIVE' | 'VERIFIED' | 'ARCHIVED';

export interface GeomensuraPolygonVertex {
    code: string;
    easting: number;
    northing: number;
    elevationM?: number;
}

export interface GeomensuraSurveyPayload {
    stationCode: string;
    stationEasting: number;
    stationNorthing: number;
    stationElevationM: number;
    utmZone: number;
    hemisphere: 'N' | 'S';
    targetCode?: string;
    targetEasting?: number;
    targetNorthing?: number;
    targetElevationM?: number;
    deltaE?: number;
    deltaN?: number;
    deltaZ?: number;
    horizontalDistanceM?: number;
    slopeDistanceM?: number;
    azimuthDeg?: number;
    slopePct?: number;
    polygonVertices?: GeomensuraPolygonVertex[];
    polygonAreaM2?: number | null;
    polygonPerimeterM?: number | null;
    rtkFixQuality?: string | null;
    hdop?: number | null;
}

export type DrillholeRqdQuality = 'MUY_MALA' | 'MALA' | 'REGULAR' | 'BUENA' | 'EXCELENTE';

export interface ExploracionIntervalItem {
    id: string;
    fromM: number;
    toM: number;
    recoveredM: number;
    sumPiecesGe10cmM: number;
    recoveryPct: number;
    rqdPct: number;
    rqdQuality: DrillholeRqdQuality;
    lithology: string;
    alteration: string;
    copperDomain: CopperDomain;
    cuTotalPct: number | null;
    cuSolublePct: number | null;
    coreBoxPhotoUrl?: string | null;
    coreBoxSha256?: string | null;
    coreBoxOriginalBytes?: number | null;
    coreBoxOptimizedBytes?: number | null;
    coreBoxSavingsPct?: number | null;
}

export interface ExploracionSondajePayload {
    holeId: string;
    method: 'DDH' | 'RC';
    collarEasting: number;
    collarNorthing: number;
    collarElevationM: number;
    utmZone: number;
    hemisphere: 'N' | 'S';
    azimuthDeg: number;
    dipDeg: number;
    totalDepthM: number;
    intervals: ExploracionIntervalItem[];
    weightedCuTotalPct: number | null;
    weightedCuSolublePct: number | null;
    meanRqdPct: number | null;
    meanRecoveryPct?: number | null;
    qaqcSampleType?: 'NONE' | 'STANDARD' | 'BLANK' | 'DUPLICATE';
    qaqcOriginalPct?: number | null;
    qaqcCheckPct?: number | null;
    qaqcRpdPct?: number | null;
    qaqcPassed?: boolean | null;
}

export interface EstructuralPlaneItem {
    id: string;
    structureType: 'FALLA' | 'DIACLASA' | 'ESTRATIFICACION' | 'VETILLA_CU' | 'CONTACTO' | string;
    dipDeg: number;
    dipDirectionDeg: number;
    strikeDeg: number;
    jrcBarton?: number | null;
    apertureMm?: number | null;
    infill?: string;
}

export interface HydrogeologyReading {
    piezometerId: string;
    staticWaterLevelM: number | null;
    wellDepthM: number | null;
    ph: number | null;
    conductivityUsCm: number | null;
    temperatureC: number | null;
}

export interface EstructuralHidroPayload {
    stationCode: string;
    easting?: number | null;
    northing?: number | null;
    elevationM?: number | null;
    utmZone?: number | null;
    hemisphere?: 'N' | 'S' | null;
    planes: EstructuralPlaneItem[];
    hydrogeology?: HydrogeologyReading | null;
}

export type GeolappDomainPayload =
    | GeomensuraSurveyPayload
    | ExploracionSondajePayload
    | EstructuralHidroPayload;

export interface GeolappDomainUtmFix {
    zone: number;
    band: string;
    hemisphere: 'N' | 'S';
    easting: number;
    northing: number;
    altitudeM: number | null;
    accuracyM?: number | null;
    fixQuality?: string | null;
}

interface GeolappDomainRecordCommon {
    id: string;
    tenantId: string;
    accountId: string;
    code: string;
    title: string;
    status: GeolappDomainRecordStatus;
    utmFix?: GeolappDomainUtmFix;
    notes?: string;
    createdAt: number;
    updatedAt: number;
    createdBy: string;
    updatedBy?: string;
    synced?: boolean;
}

export interface GeomensuraDomainRecord extends GeolappDomainRecordCommon {
    domainMode: 'GEOMENSURA_GEO';
    payload: GeomensuraSurveyPayload;
}

export interface ExploracionSondajeDomainRecord extends GeolappDomainRecordCommon {
    domainMode: 'EXPLORACION_SONDAJES';
    payload: ExploracionSondajePayload;
}

export interface EstructuralHidroDomainRecord extends GeolappDomainRecordCommon {
    domainMode: 'ESTRUCTURAL_HIDRO';
    payload: EstructuralHidroPayload;
}

export type GeolappDomainRecord =
    | GeomensuraDomainRecord
    | ExploracionSondajeDomainRecord
    | EstructuralHidroDomainRecord;
