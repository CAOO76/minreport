/**
 * MINREPORT · ACOPIOS Core Types
 * Contratos de dominio para cubicación industrial, gobernanza geo-metalúrgica de Cobre (Cu),
 * trazabilidad CAS y soporte a geometrías cono, windrow y acopio contra muro.
 */

import type {
    DemGridV1,
    MeasurementLifecycleStatus,
    MetrologyGrade,
    ReconciliationStatus,
    UnifiedBoundingBoxM,
} from '../../../../contracts/acopios.contracts';

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

export type GeolappDomainMode = 'STOCKPILE';

export type StockpileClosureReason = 'SHIPPED' | 'FIELD_REMOVED' | 'ZERO_VOLUME' | 'MANUAL_CLOSE';

export type GeolappGeometryType =
    | 'CONO_ELIPTICO'
    | 'CONO_ELIPTICO_TRUNCADO'
    | 'CONO_TRUNCADO_PERIMETRO'
    | 'PILA_LONGITUDINAL_WINDROW'
    | 'ACOPIO_CONTRA_MURO'
    | 'INDETERMINADO'
    | 'NO_ES_ACOPIO';

export type GeolappDigitalScaleAnchorType =
    | 'ARCORE_VIO_DEPTH'
    | 'CONO_070'
    | 'MIRA_100'
    | 'CASCO_030'
    | 'BALDE_280'
    | 'MANUAL_BASE_M'
    | 'NONE';

export type GeolappAnalysisStatus =
    | 'AI_VERIFIED'
    | 'PENDING_AI_SYNC'
    | 'PENDING_SCALE'
    | 'MANUAL';

export interface MiningSiteProfile {
    id: string;
    tenantId: string;
    accountId: string;
    name: string;
    code?: string;
    status: 'ACTIVE' | 'ARCHIVED';
    source: 'DEV_MANUAL_REGISTRY' | 'MINREPORT_PROJECTS_MODULE';
    createdAt: number;
    createdBy: string;
    updatedAt?: number;
}

export type GeolappGnssStatus = 'FIX_OK' | 'UNDERGROUND_NO_FIX';

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
    description?: string;
    clase?: 'mineral' | 'esteril' | 'baja_ley' | null;
    status?: StockpileStatus;
    createdAt: number;
    createdBy: string;
    updatedAt?: number;

    // Agrupación por Proyecto (Preparado para Desarrollo Futuro)
    project_id?: string | null;
    project_name?: string | null;

    // Georeferencia Inicial (Opcional — Cero coordenadas falsas 0,0 cuando no hay GPS)
    geo_point?: {
        latitude: number;
        longitude: number;
        altitude: number | null;
        accuracy?: number;
    };
    location_ref?: string;

    // Mapa Satelital Estático Soberano (CAS SHA-256, sin interacción en cliente)
    static_map_url?: string;
    static_map_sha256?: string;
    static_map_original_bytes?: number;
    static_map_optimized_bytes?: number;
    static_map_savings_pct?: number;

    // Recursos
    initial_photo_url?: string;
    thumbnail_url?: string;

    // Estado Actual (Metadata derivada de la última medición)
    last_volume_m3?: number;
    last_weight_t?: number;
    last_photo_url?: string;
    last_measured_at?: number;
    last_geometry_type?: GeolappGeometryType | string;
    last_delta_volumen_m3?: number | null;
    last_delta_volumen_pct?: number | null;

    // Cierre de Ciclo exclusivo móvil (Embarque / Eliminación en terreno con causa / Volumen Cero)
    closed_at?: number | null;
    closed_by?: string | null;
    closure_reason?: StockpileClosureReason | null;
    closure_cause?: string | null;
    closure_origin?: 'MOBILE_FIELD' | null;
    dispatch_reference?: string | null;
    dispatch_transport?: string | null;
    dispatch_destination?: string | null;
    dispatch_timestamp?: number | null;
    shipped_weight_t?: number | null;
    pre_closure_volume_m3?: number | null;

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

    // Estado Digital Offline-First & Talud IA
    analysis_status?: GeolappAnalysisStatus;
    lifecycle_status?: MeasurementLifecycleStatus;
    metrology_grade?: MetrologyGrade;
    reconciliation_status?: ReconciliationStatus;
    capture_session_id?: string;
    offline_in_situ_m3?: number | null;
    cloud_refined_m3?: number | null;
    reconciliation_delta_pct?: number | null;
    local_preview_mesh?: DemGridV1 | null;
    rejection_code?: string | null;
    rejection_reason?: string | null;
    mesh_vertex_count?: number;
    mesh_triangle_count?: number;
    mesh_surface_area_m2?: number;
    mesh_bounding_box_m?: UnifiedBoundingBoxM;
    scale_anchor_type?: GeolappDigitalScaleAnchorType;
    uncertainty_pct?: number | null;
    toe_score?: number | null;
    coverage_pct?: number | null;
    depth_mode?: string | null;
    ground_slope_deg?: number | null;
    is_non_stockpile?: boolean;
    detected_slope_angle_deg?: number;
    slope_warning?: string | null;
    wall_confinement?: 'NONE' | 'SINGLE_WALL' | 'BUNKER_3_WALLS';
    gnss_status?: GeolappGnssStatus;
    underground_sector?: string;
    captured_at?: number;

    // Telemetría Hardware & Calibración (Trazabilidad Metrológica)
    device_model?: string;
    calibration_id?: string;
    calibration_scale_factor?: number;
    scanner_engine_version?: string;
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

    // Evidencia y Trazabilidad Previa
    photo_url: string;
    previous_measurement_id?: string | null;
    previous_photo_url?: string | null;
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
    delta_volumen_pct?: number | null;
    delta_peso?: number;

    // Cierre de Ciclo (Agotamiento 0 m³ / Despacho / Eliminación en Terreno)
    is_closure_measurement?: boolean;
    closure_reason?: StockpileClosureReason;
    dispatch_reference?: string;
    dispatch_transport?: string;
    dispatch_destination?: string;
    dispatch_timestamp?: number;
    closure_cause?: string | null;
    closure_origin?: 'MOBILE_FIELD' | null;

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

    // Estado Lógico y Captura Digital Offline-First
    ignored?: boolean;
    analysis_status?: GeolappAnalysisStatus;
    lifecycle_status?: MeasurementLifecycleStatus;
    metrology_grade?: MetrologyGrade;
    reconciliation_status?: ReconciliationStatus;
    capture_session_id?: string;
    offline_in_situ_m3?: number | null;
    cloud_refined_m3?: number | null;
    reconciliation_delta_pct?: number | null;
    local_preview_mesh?: DemGridV1 | null;
    rejection_code?: string | null;
    rejection_reason?: string | null;
    mesh_vertex_count?: number;
    mesh_triangle_count?: number;
    mesh_surface_area_m2?: number;
    mesh_bounding_box_m?: UnifiedBoundingBoxM;
    scale_anchor_type?: GeolappDigitalScaleAnchorType;
    scale_anchor_meters?: number;
    reference_base_meters?: number;
    uncertainty_pct?: number | null;
    toe_score?: number | null;
    coverage_pct?: number | null;
    depth_mode?: string | null;
    ground_slope_deg?: number | null;
    is_non_stockpile?: boolean;
    detected_slope_angle_deg?: number;
    slope_left_deg?: number;
    slope_right_deg?: number;
    slope_warning?: string | null;
    wall_confinement?: 'NONE' | 'SINGLE_WALL' | 'BUNKER_3_WALLS';
    gnss_status?: GeolappGnssStatus;
    underground_sector?: string;
    captured_at?: number;

    // Telemetría Hardware & Calibración (Trazabilidad Metrológica)
    device_model?: string;
    calibration_id?: string;
    calibration_scale_factor?: number;
    scanner_engine_version?: string;
}
