import { z } from 'zod';

/**
 * MINREPORT GEOSPATIAL CORE CONTRACTS (Bloque 3.2 — Client / PWA Mirror)
 * Paridad 1:1 con `src/contracts/geo.contracts.ts` (compatible Zod 4.6).
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
    band: z.string().regex(/^[C-HJ-NP-X]$/, 'Banda UTM inválida (C-X sin I/O).'),
    hemisphere: UtmHemisphereSchema,
    eastingM: z.number().min(100000).max(900000),
    northingM: z.number().min(0).max(10000000),
    datum: z.literal('WGS84').default('WGS84'),
    epsg: z.string().regex(/^EPSG:32[67]\d{2}$/, 'Código EPSG UTM inválido.'),
    formatted: z
        .string()
        .regex(
            /^\d{2}[C-HJ-NP-X]\s\d{6}\.\d{2}\smE\s\d{7,8}\.\d{2}\smN$/,
            'Formato UTM canónico inválido (ZZB EEEEEE.dd mE NNNNNNN.dd mN).'
        ),
});

export type UtmCoordinate = z.infer<typeof UtmCoordinateSchema>;

export const CanonicalGeoFixSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    altitudeM: z.number().min(-1000).max(12000).nullable().default(null),
    accuracyM: z.number().nonnegative().max(100000).nullable().default(null),
    headingDeg: z.number().min(0).max(360).nullable().optional(),
    speedMps: z.number().nonnegative().nullable().optional(),
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
        lat: z.number().min(-84).max(84).optional(),
        lng: z.number().min(-180).max(180).optional(),
        countryCode: z
            .string()
            .trim()
            .regex(/^[A-Za-z]{2}$/, 'Código ISO-3166 alpha-2 inválido.')
            .transform((v) => v.toUpperCase())
            .optional(),
        language: z.enum(['es', 'en', 'pt']).default('es'),
        limit: z.number().int().min(1).max(10).default(5),
    })
    .superRefine((val, ctx) => {
        if (val.mode === 'FORWARD' && (!val.query || val.query.trim().length < 2)) {
            ctx.addIssue({
                code: 'custom',
                path: ['query'],
                message: 'query es obligatorio en modo FORWARD (mínimo 2 caracteres).',
            });
        }
        if (
            val.mode === 'REVERSE' &&
            (typeof val.lat !== 'number' ||
                !Number.isFinite(val.lat) ||
                typeof val.lng !== 'number' ||
                !Number.isFinite(val.lng))
        ) {
            ctx.addIssue({
                code: 'custom',
                path: ['lat'],
                message: 'lat y lng finitos son obligatorios en modo REVERSE.',
            });
        }
    });

export type GeoResolveRequest = z.input<typeof GeoResolveRequestSchema>;
export type GeoResolveRequestOutput = z.infer<typeof GeoResolveRequestSchema>;

export const GeoResolvedProviderSchema = z.enum([
    'CACHE_SHA256',
    'GOOGLE_SERVER',
    'NOMINATIM_SERVER',
    'SOVEREIGN_GAZETTEER',
]);

export type GeoResolvedProvider = z.infer<typeof GeoResolvedProviderSchema>;

export const GeoProviderSchema = GeoResolvedProviderSchema;
export type GeoProvider = GeoResolvedProvider;

export const GeoResolvedCandidateSchema = z.object({
    placeId: z.string().min(1).max(240),
    formattedAddress: z.string().min(1).max(400),
    street: z.string().max(200).nullish().transform((v) => v ?? ''),
    streetNumber: z.string().max(64).nullish().transform((v) => v ?? ''),
    locality: z.string().max(160).nullish().transform((v) => v ?? ''),
    region: z.string().max(160).nullish().transform((v) => v ?? ''),
    postalCode: z.string().max(32).nullish().transform((v) => v ?? ''),
    countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    utm: UtmCoordinateSchema,
    provider: GeoResolvedProviderSchema,
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

export type CreateGeoReportStampBody = z.input<typeof CreateGeoReportStampBodySchema>;
export type CreateGeoReportStampBodyOutput = z.infer<typeof CreateGeoReportStampBodySchema>;

export const GeoReportStampSchema = z.object({
    stampId: z.string().min(8).max(128),
    accountId: z.string().min(1).max(128),
    moduleId: GeoReportStampModuleSchema,
    entityType: z.string().min(2).max(80),
    entityId: z.string().min(1).max(128),
    fix: CanonicalGeoFixSchema,
    vectorCutoutSvg: z.string().min(32),
    stampHashSha256: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.string().min(10),
    issuedByUid: z.string().min(1).max(128),
});

export type GeoReportStamp = z.infer<typeof GeoReportStampSchema>;

export const PmtilesTileTypeSchema = z.enum([
    'UNKNOWN',
    'MVT',
    'PNG',
    'JPEG',
    'WEBP',
    'AVIF',
]);

export type PmtilesTileType = z.infer<typeof PmtilesTileTypeSchema>;

export const PmtilesHeaderMetadataSchema = z.object({
    specVersion: z.literal(3),
    tileType: PmtilesTileTypeSchema,
    minZoom: z.number().int().min(0).max(26),
    maxZoom: z.number().int().min(0).max(26),
    minLon: z.number().min(-180).max(180),
    minLat: z.number().min(-90).max(90),
    maxLon: z.number().min(-180).max(180),
    maxLat: z.number().min(-90).max(90),
    centerZoom: z.number().int().min(0).max(26),
    centerLon: z.number().min(-180).max(180),
    centerLat: z.number().min(-90).max(90),
    addressedTilesCount: z.number().int().nonnegative(),
    clustered: z.boolean(),
});

export type PmtilesHeaderMetadata = z.infer<typeof PmtilesHeaderMetadataSchema>;
