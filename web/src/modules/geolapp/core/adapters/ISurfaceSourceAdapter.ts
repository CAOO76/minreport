/**
 * ISurfaceSourceAdapter — Contratos Universales de Adaptadores Hardware Externos GEOLAPP®
 *
 * Estándar MINREPORT Fase 4:
 *  - Soporta ingesta determinista de fotogrametría UAV (.las/.xyz/.csv/.pts),
 *    LiDAR móvil (.ply/.glb) y receptores GNSS RTK NMEA-0183 ($GNGGA/$GPGGA/$GPRMC).
 *  - Tolerancia cero a datos sintéticos o simulados.
 */

export type SurfaceSourceKind = 'UAV_PHOTOGRAMMETRY' | 'MOBILE_LIDAR' | 'GNSS_RTK_NMEA';

export type GnssFixQualityCode =
    | 'INVALID'
    | 'GPS_SPS'
    | 'DGPS'
    | 'PPS'
    | 'RTK_FIXED'
    | 'RTK_FLOAT'
    | 'ESTIMATED';

export interface GnssRtkFixRecord {
    sentenceType: 'GGA' | 'RMC';
    timestampUtc: string | null;
    latitude: number;
    longitude: number;
    orthometricAltitudeM: number | null;
    geoidSeparationM: number | null;
    fixQualityCode: number;
    fixQuality: GnssFixQualityCode;
    satellitesUsed: number;
    hdop: number | null;
    utmZone: number;
    utmBand: string;
    hemisphere: 'N' | 'S';
    easting: number;
    northing: number;
    epsg: number;
    datum: 'SIRGAS-Chile / WGS84';
    rawSentence: string;
}

export interface SurfacePointCloudSummary {
    sourceKind: SurfaceSourceKind;
    format: 'LAS' | 'XYZ' | 'CSV' | 'PLY' | 'GLB';
    pointCount: number;
    decimatedPointCount: number;
    boundsM: {
        widthX: number;
        depthZ: number;
        reliefY: number;
        minElevationM: number;
        maxElevationM: number;
    };
    tinVolumeM3: number;
    surfaceAreaM2: number;
    vertexCount: number;
    triangleCount: number;
    glbBuffer: ArrayBuffer;
    originalBytes: number;
    optimizedGlbBytes: number;
    casSha256?: string;
    casDownloadUrl?: string;
    casSavingsPct?: number;
}

export interface SurfaceAdapterParseOptions {
    filename?: string;
    format?: 'LAS' | 'XYZ' | 'CSV' | 'PLY' | 'GLB' | 'NMEA';
    gridSize?: number;
    baseElevationM?: number;
    tenantId?: string;
    uploadCas?: boolean;
    maxPoints?: number;
    meshName?: string;
}

export interface ISurfaceSourceAdapter<TRawInput, TResult> {
    readonly sourceKind: SurfaceSourceKind;
    readonly supportedExtensions: readonly string[];
    canHandle(filenameOrHint: string): boolean;
    parse(input: TRawInput, options?: SurfaceAdapterParseOptions): Promise<TResult>;
}
