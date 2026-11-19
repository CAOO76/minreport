import { getSecret } from '../../config/secrets';
import { CasStorageService } from '../../core/media/CasStorageService';
import { safeFetchExternal } from '../../utils/ssrfGuard';

export interface StaticSatelliteMapRequest {
    stockpileId: string;
    tenantId: string;
    actorUid: string;
    latitude: number;
    longitude: number;
    zoom?: number;
}

export interface StaticSatelliteMapResponse {
    ok: boolean;
    available: boolean;
    reason?: 'INVALID_COORDINATES' | 'SECRET_UNCONFIGURED' | 'UPSTREAM_UNAVAILABLE';
    staticMapUrl?: string;
    sha256?: string;
    originalBytes?: number;
    optimizedBytes?: number;
    savingsPct?: number;
}

export interface StaticMapBinaryFetchResult {
    ok: boolean;
    status: number;
    contentType: string;
    buffer: Buffer;
}

export type StaticMapFetcher = (url: string) => Promise<StaticMapBinaryFetchResult>;

export interface StockpileStaticMapDependencies {
    apiKey?: string | null;
    fetcher?: StaticMapFetcher;
    resolveSecret?: (secretName: string) => Promise<string | null>;
}

async function defaultStaticMapFetcher(url: string): Promise<StaticMapBinaryFetchResult> {
    const resp = await safeFetchExternal(url, {
        method: 'GET',
        timeoutMs: 8000,
        maxBytes: 4 * 1024 * 1024,
        maxRedirects: 2,
    });
    const arrayBuf = await resp.arrayBuffer();
    return {
        ok: resp.ok,
        status: resp.status,
        contentType: resp.headers.get('content-type') || 'image/png',
        buffer: Buffer.from(arrayBuf),
    };
}

export function isValidStaticMapCoordinatePair(latitude: number, longitude: number): boolean {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    if (latitude < -85 || latitude > 85 || longitude < -180 || longitude > 180) return false;
    if (latitude === 0 && longitude === 0) return false;
    return true;
}

/**
 * Servicio soberano de Mapa Satelital Estático en `southamerica-west1`:
 * - Lee la credencial únicamente server-side desde Cloud Secret Manager (`GOOGLE_STATIC_MAPS_API_KEY`).
 * - Descarga una imagen satelital estática (sin interacción cliente) con pin Cobre MINREPORT (`#C68346`).
 * - Consolida y deduplica el binario una sola vez en `CasStorageService` (`SHA-256`, `TENANT_PRIVATE`).
 */
export async function generateAndStoreStaticSatelliteMap(
    input: StaticSatelliteMapRequest,
    deps?: StockpileStaticMapDependencies
): Promise<StaticSatelliteMapResponse> {
    const { stockpileId, tenantId, actorUid, latitude, longitude } = input;
    if (!isValidStaticMapCoordinatePair(latitude, longitude)) {
        return {
            ok: false,
            available: false,
            reason: 'INVALID_COORDINATES',
        };
    }

    const secretResolver = deps?.resolveSecret ?? getSecret;
    const resolvedKey =
        deps?.apiKey !== undefined
            ? deps.apiKey
            : (await secretResolver('GOOGLE_STATIC_MAPS_API_KEY')) ||
              (await secretResolver('GOOGLE_MAPS_STATIC_API_KEY'));

    if (!resolvedKey || !resolvedKey.trim()) {
        return {
            ok: true,
            available: false,
            reason: 'SECRET_UNCONFIGURED',
        };
    }

    const zoom =
        typeof input.zoom === 'number' && Number.isInteger(input.zoom)
            ? Math.min(20, Math.max(12, input.zoom))
            : 18;
    const latStr = latitude.toFixed(6);
    const lngStr = longitude.toFixed(6);
    const staticMapsUrl =
        `https://maps.googleapis.com/maps/api/staticmap` +
        `?center=${latStr},${lngStr}` +
        `&zoom=${zoom}` +
        `&size=640x400` +
        `&maptype=satellite` +
        `&scale=2` +
        `&format=png` +
        `&markers=color:0xC68346%7C${latStr},${lngStr}` +
        `&key=${encodeURIComponent(resolvedKey.trim())}`;

    try {
        const fetcher = deps?.fetcher ?? defaultStaticMapFetcher;
        const fetched = await fetcher(staticMapsUrl);
        if (
            !fetched.ok ||
            !fetched.contentType.toLowerCase().startsWith('image/') ||
            !Buffer.isBuffer(fetched.buffer) ||
            fetched.buffer.length === 0
        ) {
            return {
                ok: true,
                available: false,
                reason: 'UPSTREAM_UNAVAILABLE',
            };
        }

        const { descriptor } = await CasStorageService.digestAndStore(
            fetched.buffer,
            fetched.contentType,
            'IMAGE_FIELD_EVIDENCE',
            {
                scope: 'TENANT_PRIVATE',
                tenantId,
                actorUid,
                originalFilename: `stockpile_static_map_${stockpileId}.png`,
                clientOriginalBytes: fetched.buffer.length,
            }
        );

        const savingsPct =
            typeof descriptor.savingsPct === 'number'
                ? descriptor.savingsPct
                : Number((descriptor.savingsRatio * 100).toFixed(1));

        return {
            ok: true,
            available: true,
            staticMapUrl: descriptor.downloadUrl,
            sha256: descriptor.sha256,
            originalBytes: descriptor.originalBytes,
            optimizedBytes: descriptor.optimizedBytes,
            savingsPct,
        };
    } catch {
        return {
            ok: true,
            available: false,
            reason: 'UPSTREAM_UNAVAILABLE',
        };
    }
}
