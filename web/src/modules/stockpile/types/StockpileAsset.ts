/**
 * StockpileAsset Type
 * Representa la identidad de un acopio físico en terreno.
 * El activo persiste mientras el acopio no se extinga.
 */

export interface StockpileAsset {
    // Identificación
    id: string;
    name: string;
    clase: 'mineral' | 'esteril' | 'baja_ley';
    createdAt: number;
    createdBy: string;

    // Georeferencia Inicial (Alta del Activo)
    geo_point: {
        latitude: number;
        longitude: number;
        altitude: number | null;
        accuracy: number;
    };
    location_ref?: string; // Descripción manual de la ubicación

    // Recursos
    initial_photo_url?: string;
    thumbnail_url?: string; // Optimizada para listas

    // Estado Actual (Metadata derivada de la última medición)
    last_volume_m3?: number;
    last_weight_t?: number;
    last_photo_url?: string;
    last_measured_at?: number;

    // --- LEGACY COMPATIBILITY for DesktopAnalytics & ResultsDashboard ---
    volumen?: number;
    volume_m3?: number; // Alias for last_volume_m3
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

    // Historial se maneja como una subcolección o array de mediciones
}

/**
 * StockpileMeasurement Type
 * Representa una cubicación técnica realizada en un momento específico.
 */
export interface StockpileMeasurement {
    id: string;
    assetId: string;
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

    // Detalles de Geometría (Si aplica)
    geometry?: {
        type: string;
        dimensions: Record<string, number>;
    };

    // --- NUEVOS CAMPOS PARA APRENDIZAJE IA (MODO DIGITAL) ---
    operator_classification?: 'COLPA' | 'GRANSA' | 'FINO';
    operator_density?: number;
    texture_features?: {
        mean_luminance: number;
        std_dev: number;
        [key: string]: number;
    };
    imu_data?: {
        alpha: number | null; // Giroscopio
        beta: number | null;
        gamma: number | null;
        accel_x: number | null; // Acelerómetro
        accel_y: number | null;
        accel_z: number | null;
    };

    // Deltas vs Medición Anterior (Calculados en runtime o guardado)
    delta_volumen?: number;
    delta_peso?: number;

    // Estado Logico
    ignored?: boolean; // Si true, esta medición se excluye de cálculos y gráficos (pero no se borra)
}
