import { z } from 'zod';

/**
 * CONTRATOS CANÓNICOS GEOESPACIALES MULTI-DISPOSITIVO — BLOQUE ATÓMICO 3.2
 * Compatibles con Zod 3.25 (Backend CJS) y Zod 4.6 (Frontend ESM).
 * Estándar dual obligatorio: WGS84 (EPSG:4326) + UTM (WGS84 / EPSG:326xx-327xx).
 */

export const GeoCaptureSourceSchema = z.enum([
    'CAPACITOR_GNSS',
    'WEB_GEOLOCATION',
    'EXIF_CAS_PHOTO',
    'BACKEND_GEOCODER',
    'MANUAL_INPUT',
]);
export type GeoCaptureSource = z.infer<typeof GeoCaptureSourceSchema>;

export const UtmHemisphereSchema = z.enum(['N', 'S']);
export type UtmHemisphere = z.infer<typeof UtmHemisphereSchema>;

export const UtmCoordinateSchema = z.object({
    zone: z.number().int().min(1).max(60),
    band: z.string().regex(/^[C-HJ-NP-X]$/, 'Banda latitudinal UTM inválida (C..X excluyendo I y O).'),
    hemisphere: UtmHemisphereSchema,
    eastingM: z.number().finite().min(100000).max(900000),
    northingM: z.number().finite().min(0).max(10000000),
    datum: z.literal('WGS84').default('WGS84'),
    epsg: z.string().regex(/^EPSG:32[67]\d{2}$/, 'Código EPSG UTM inválido (esperado EPSG:326xx o EPSG:327xx).'),
    formatted: z
        .string()
        .regex(
            /^\d{2}[C-HJ-NP-X]\s+\d{6}\.\d{2}\s+mE\s+\d{7,8}\.\d{2}\s+mN$/,
            'Formato UTM canónico inválido (esperado ZZB EEEEEE.dd mE NNNNNNN.dd mN).'
        ),
});
export type UtmCoordinate = z.infer<typeof UtmCoordinateSchema>;

export const CanonicalGeoFixSchema = z.object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    altitudeM: z.number().finite().min(-1000).max(12000).nullable().default(null),
    accuracyM: z.number().finite().nonnegative().max(100000).nullable().default(null),
    headingDeg: z.number().finite().min(0).max(360).nullable().optional(),
    speedMps: z.number().finite().nonnegative().nullable().optional(),
    capturedAt: z.string().min(10),
    source: GeoCaptureSourceSchema,
    srid: z.literal('EPSG:4326').default('EPSG:4326'),
    utm: UtmCoordinateSchema,
});
export type CanonicalGeoFix = z.infer<typeof CanonicalGeoFixSchema>;

export const GeoResolveModeSchema = z.enum(['FORWARD', 'REVERSE']);
export type GeoResolveMode = z.infer<typeof GeoResolveModeSchema>;

export const GeoResolveRequestSchema = z
    .object({
        mode: GeoResolveModeSchema,
        query: z.string().trim().max(240).optional(),
        lat: z.number().finite().min(-84).max(84).optional(),
        lng: z.number().finite().min(-180).max(180).optional(),
        countryCode: z
            .string()
            .trim()
            .regex(/^[A-Za-z]{2}$/, 'countryCode debe ser código ISO-3166 alfa-2.')
            .transform((val) => val.toUpperCase())
            .optional(),
        language: z.enum(['es', 'en', 'pt']).default('es'),
        limit: z.number().int().min(1).max(10).default(5),
    })
    .superRefine((data, ctx) => {
        if (data.mode === 'FORWARD') {
            if (!data.query || data.query.trim().length < 2) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['query'],
                    message: 'query (mínimo 2 caracteres) es obligatorio en modo FORWARD.',
                });
            }
        } else if (data.mode === 'REVERSE') {
            if (typeof data.lat !== 'number' || !Number.isFinite(data.lat)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['lat'],
                    message: 'lat finito es obligatorio en modo REVERSE.',
                });
            }
            if (typeof data.lng !== 'number' || !Number.isFinite(data.lng)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['lng'],
                    message: 'lng finito es obligatorio en modo REVERSE.',
                });
            }
        }
    });
export type GeoResolveRequest = z.infer<typeof GeoResolveRequestSchema>;

export const GeoProviderSchema = z.enum([
    'CACHE_SHA256',
    'GOOGLE_SERVER',
    'NOMINATIM_SERVER',
    'SOVEREIGN_GAZETTEER',
]);
export type GeoProvider = z.infer<typeof GeoProviderSchema>;

export const GeoResolvedCandidateSchema = z.object({
    placeId: z.string().min(1),
    formattedAddress: z.string().min(1),
    street: z.string().default(''),
    streetNumber: z.string().default(''),
    locality: z.string().default(''),
    region: z.string().default(''),
    postalCode: z.string().default(''),
    countryCode: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2}$/, 'countryCode debe tener 2 letras mayúsculas ISO.'),
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    utm: UtmCoordinateSchema,
    provider: GeoProviderSchema,
});
export type GeoResolvedCandidate = z.infer<typeof GeoResolvedCandidateSchema>;

export const GeoReportStampModuleSchema = z.enum([
    'core',
    'b2b-core',
    'opermaq',
    'stockpile',
    'edu',
    'test-pilot',
]);
export type GeoReportStampModule = z.infer<typeof GeoReportStampModuleSchema>;

export const CreateGeoReportStampBodySchema = z.object({
    accountId: z.string().trim().min(1).max(128).optional(),
    moduleId: GeoReportStampModuleSchema.default('core'),
    entityType: z.string().trim().min(2).max(80),
    entityId: z.string().trim().min(1).max(128),
    fix: CanonicalGeoFixSchema,
    label: z.string().trim().max(160).optional(),
});
export type CreateGeoReportStampBody = z.infer<typeof CreateGeoReportStampBodySchema>;

export const GeoReportStampSchema = z.object({
    stampId: z.string().min(8),
    accountId: z.string().min(1),
    moduleId: GeoReportStampModuleSchema,
    entityType: z.string().min(2).max(80),
    entityId: z.string().min(1).max(128),
    fix: CanonicalGeoFixSchema,
    vectorCutoutSvg: z.string().min(32),
    stampHashSha256: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.string().min(10),
    issuedByUid: z.string().min(1),
});
export type GeoReportStamp = z.infer<typeof GeoReportStampSchema>;

export const PmtilesTileTypeSchema = z.enum(['UNKNOWN', 'MVT', 'PNG', 'JPEG', 'WEBP', 'AVIF']);
export type PmtilesTileType = z.infer<typeof PmtilesTileTypeSchema>;

export const PmtilesHeaderMetadataSchema = z.object({
    specVersion: z.literal(3),
    tileType: PmtilesTileTypeSchema,
    minZoom: z.number().int().min(0).max(26),
    maxZoom: z.number().int().min(0).max(26),
    minLon: z.number().finite().min(-180).max(180),
    minLat: z.number().finite().min(-90).max(90),
    maxLon: z.number().finite().min(-180).max(180),
    maxLat: z.number().finite().min(-90).max(90),
    centerZoom: z.number().int().min(0).max(26),
    centerLon: z.number().finite().min(-180).max(180),
    centerLat: z.number().finite().min(-90).max(90),
    addressedTilesCount: z.number().int().nonnegative(),
    clustered: z.boolean(),
});
export type PmtilesHeaderMetadata = z.infer<typeof PmtilesHeaderMetadataSchema>;
