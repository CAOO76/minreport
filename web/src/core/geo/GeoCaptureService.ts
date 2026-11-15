import { auth } from '../../config/firebase';
import {
    CanonicalGeoFixSchema,
    CreateGeoReportStampBodySchema,
    GeoReportStampSchema,
    GeoResolveRequestSchema,
    GeoResolvedCandidateSchema,
    type CanonicalGeoFix,
    type CreateGeoReportStampBody,
    type GeoCaptureSource,
    type GeoReportStamp,
    type GeoResolveRequest,
    type GeoResolvedCandidate,
    type UtmHemisphere,
} from '../../contracts/geo.contracts';
import { coreAuthFetch } from '../network/coreAuthFetch';
import { offlineStorage } from '../offline/OfflineStorage';
import { syncQueueEngine } from '../offline/SyncQueueEngine';
import { extractExifGeoFix } from './exifGpsExtractor';
import {
    buildCanonicalGeoFix,
    buildGeoStampVectorSvg,
    computeDeterministicGeoStampHash,
    sha256Hex,
    utmToWgs84,
} from './wgs84UtmProjection';

/**
 * MINREPORT SOVEREIGN GEO CAPTURE SERVICE (Multi-Dispositivo & Offline-First)
 * Unifica GNSS nativo Capacitor 6, Web Geolocation API, extracción EXIF local,
 * entrada manual WGS84/UTM, geocodificación soberana con caché SHA-256 y sellado offline-first.
 */

export interface CapturePositionOptions {
    enableHighAccuracy?: boolean;
    timeoutMs?: number;
    maximumAgeMs?: number;
    tenantId?: string;
}

export interface ResolveAddressResult {
    candidates: GeoResolvedCandidate[];
    cached: boolean;
    offlineFallback: boolean;
}

export interface IssueGeoReportStampResult {
    synced: boolean;
    stamp: GeoReportStamp;
    queuedTaskId?: string;
}

function resolveTenantKey(tenantId?: string): string {
    if (typeof tenantId === 'string' && tenantId.trim().length > 0) {
        return tenantId.trim();
    }
    if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('minreport_active_account_id')?.trim();
        if (stored) return stored;
    }
    return 'global';
}

function isCapacitorNativeRuntime(): boolean {
    if (typeof window === 'undefined') return false;
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
        ?.Capacitor;
    return typeof cap?.isNativePlatform === 'function' && Boolean(cap.isNativePlatform());
}

export class GeoCaptureService {
    public async captureCurrentPosition(
        options: CapturePositionOptions = {}
    ): Promise<CanonicalGeoFix> {
        const enableHighAccuracy = options.enableHighAccuracy ?? true;
        const timeoutMs = options.timeoutMs ?? 12000;
        const maximumAgeMs = options.maximumAgeMs ?? 15000;

        let fix: CanonicalGeoFix;

        if (isCapacitorNativeRuntime()) {
            const { Geolocation } = await import('@capacitor/geolocation');
            try {
                const perms = await Geolocation.checkPermissions();
                if (perms.location !== 'granted' && perms.coarseLocation !== 'granted') {
                    await Geolocation.requestPermissions();
                }
            } catch {
                // Continuar al intento directo si el runtime nativo ya concedió permiso por manifest
            }

            const pos = await Geolocation.getCurrentPosition({
                enableHighAccuracy,
                timeout: timeoutMs,
                maximumAge: maximumAgeMs,
            });

            fix = buildCanonicalGeoFix({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                altitudeM: pos.coords.altitude ?? null,
                accuracyM: pos.coords.accuracy ?? null,
                headingDeg: pos.coords.heading ?? null,
                speedMps: pos.coords.speed ?? null,
                capturedAt: new Date(pos.timestamp || Date.now()).toISOString(),
                source: 'CAPACITOR_GNSS',
            });
        } else {
            if (typeof navigator === 'undefined' || !navigator.geolocation) {
                throw new Error('Geolocalización GNSS/Web no disponible en este navegador.');
            }

            const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy,
                    timeout: timeoutMs,
                    maximumAge: maximumAgeMs,
                });
            });

            fix = buildCanonicalGeoFix({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                altitudeM: pos.coords.altitude ?? null,
                accuracyM: pos.coords.accuracy ?? null,
                headingDeg: pos.coords.heading ?? null,
                speedMps: pos.coords.speed ?? null,
                capturedAt: new Date(pos.timestamp || Date.now()).toISOString(),
                source: 'WEB_GEOLOCATION',
            });
        }

        const tenantKey = resolveTenantKey(options.tenantId);
        await offlineStorage
            .putOfflineMetadata(`geo_last_fix_${tenantKey}`, fix)
            .catch(() => {});

        return fix;
    }

    public async getLastKnownFix(tenantId?: string): Promise<CanonicalGeoFix | null> {
        const tenantKey = resolveTenantKey(tenantId);
        const raw = await offlineStorage
            .getOfflineMetadata<unknown>(`geo_last_fix_${tenantKey}`)
            .catch(() => null);
        if (!raw) return null;
        const parsed = CanonicalGeoFixSchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
    }

    public async extractFromMediaBlob(
        blob: Blob | ArrayBuffer | Uint8Array
    ): Promise<CanonicalGeoFix | null> {
        return extractExifGeoFix(blob);
    }

    public fromCoordinates(
        lat: number,
        lng: number,
        extra: {
            altitudeM?: number | null;
            accuracyM?: number | null;
            headingDeg?: number | null;
            speedMps?: number | null;
            capturedAt?: string;
            source?: GeoCaptureSource;
            forcedZone?: number;
        } = {}
    ): CanonicalGeoFix {
        return buildCanonicalGeoFix({
            lat,
            lng,
            altitudeM: extra.altitudeM ?? null,
            accuracyM: extra.accuracyM ?? null,
            headingDeg: extra.headingDeg ?? null,
            speedMps: extra.speedMps ?? null,
            capturedAt: extra.capturedAt,
            source: extra.source ?? 'MANUAL_INPUT',
            forcedZone: extra.forcedZone,
        });
    }

    public fromUtm(input: {
        zone: number;
        hemisphere: UtmHemisphere;
        eastingM: number;
        northingM: number;
        altitudeM?: number | null;
        accuracyM?: number | null;
        capturedAt?: string;
        source?: GeoCaptureSource;
    }): CanonicalGeoFix {
        const { lat, lng } = utmToWgs84({
            zone: input.zone,
            hemisphere: input.hemisphere,
            eastingM: input.eastingM,
            northingM: input.northingM,
        });
        return buildCanonicalGeoFix({
            lat,
            lng,
            altitudeM: input.altitudeM ?? null,
            accuracyM: input.accuracyM ?? null,
            capturedAt: input.capturedAt,
            source: input.source ?? 'MANUAL_INPUT',
            forcedZone: input.zone,
        });
    }

    public async resolveAddress(req: GeoResolveRequest): Promise<ResolveAddressResult> {
        const parsed = GeoResolveRequestSchema.parse(req);
        const cacheHash = sha256Hex(
            JSON.stringify({
                mode: parsed.mode,
                query: (parsed.query || '').trim().toLowerCase(),
                lat: typeof parsed.lat === 'number' ? Number(parsed.lat.toFixed(5)) : null,
                lng: typeof parsed.lng === 'number' ? Number(parsed.lng.toFixed(5)) : null,
                countryCode: parsed.countryCode || '',
                language: parsed.language,
                limit: parsed.limit,
            })
        );
        const offlineCacheKey = `geo_resolve_cache_${cacheHash}`;

        const readOfflineCandidates = async (): Promise<GeoResolvedCandidate[]> => {
            const rawList = await offlineStorage
                .getOfflineMetadata<unknown[]>(offlineCacheKey)
                .catch(() => null);
            if (!Array.isArray(rawList)) return [];
            const valid: GeoResolvedCandidate[] = [];
            for (const item of rawList) {
                const c = GeoResolvedCandidateSchema.safeParse(item);
                if (c.success) valid.push(c.data);
            }
            return valid;
        };

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            const cachedCandidates = await readOfflineCandidates();
            return {
                candidates: cachedCandidates,
                cached: cachedCandidates.length > 0,
                offlineFallback: true,
            };
        }

        try {
            const res = await coreAuthFetch('/api/geo/resolve', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(parsed),
            });

            if (!res.ok) {
                const cachedCandidates = await readOfflineCandidates();
                return {
                    candidates: cachedCandidates,
                    cached: cachedCandidates.length > 0,
                    offlineFallback: cachedCandidates.length > 0,
                };
            }

            const payload = (await res.json()) as {
                cached?: boolean;
                candidates?: unknown[];
            };
            const rawCandidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
            const validCandidates: GeoResolvedCandidate[] = [];
            for (const item of rawCandidates) {
                const c = GeoResolvedCandidateSchema.safeParse(item);
                if (c.success) validCandidates.push(c.data);
            }

            if (validCandidates.length > 0) {
                await offlineStorage
                    .putOfflineMetadata(offlineCacheKey, validCandidates)
                    .catch(() => {});
            }

            return {
                candidates: validCandidates,
                cached: Boolean(payload?.cached),
                offlineFallback: false,
            };
        } catch {
            const cachedCandidates = await readOfflineCandidates();
            return {
                candidates: cachedCandidates,
                cached: cachedCandidates.length > 0,
                offlineFallback: true,
            };
        }
    }

    public async issueGeoReportStamp(
        input: CreateGeoReportStampBody
    ): Promise<IssueGeoReportStampResult> {
        const body = CreateGeoReportStampBodySchema.parse(input);
        const resolvedAccountId =
            body.accountId ||
            (typeof window !== 'undefined'
                ? localStorage.getItem('minreport_active_account_id')?.trim() || ''
                : '') ||
            'default';

        const hash = computeDeterministicGeoStampHash({
            accountId: resolvedAccountId,
            moduleId: body.moduleId,
            entityType: body.entityType,
            entityId: body.entityId,
            fix: body.fix,
            label: body.label,
        });

        const localStamp: GeoReportStamp = GeoReportStampSchema.parse({
            stampId: `gst_${hash.slice(0, 24)}`,
            accountId: resolvedAccountId,
            moduleId: body.moduleId,
            entityType: body.entityType,
            entityId: body.entityId,
            fix: body.fix,
            vectorCutoutSvg: buildGeoStampVectorSvg(body.fix, { label: body.label }),
            stampHashSha256: hash,
            issuedAt: new Date().toISOString(),
            issuedByUid: auth.currentUser?.uid || 'offline-edge',
        });

        const requestBody = {
            ...body,
            accountId: resolvedAccountId,
        };

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            const queuedTaskId = await syncQueueEngine.enqueueTask(
                'GEO_REPORT_STAMP',
                requestBody
            );
            return {
                synced: false,
                stamp: localStamp,
                queuedTaskId,
            };
        }

        try {
            const res = await coreAuthFetch('/api/geo/report-stamp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Active-Account-Id': resolvedAccountId,
                },
                body: JSON.stringify(requestBody),
            });

            if (res.ok) {
                const json = (await res.json()) as { stamp?: unknown };
                const parsedServerStamp = GeoReportStampSchema.safeParse(json?.stamp);
                return {
                    synced: true,
                    stamp: parsedServerStamp.success ? parsedServerStamp.data : localStamp,
                };
            }

            if (res.status >= 500 || res.status === 408 || res.status === 429) {
                const queuedTaskId = await syncQueueEngine.enqueueTask(
                    'GEO_REPORT_STAMP',
                    requestBody
                );
                return {
                    synced: false,
                    stamp: localStamp,
                    queuedTaskId,
                };
            }

            const errPayload = await res.json().catch(() => ({}));
            const clientErr = new Error(
                (errPayload as any)?.error ||
                    `Error HTTP ${res.status} al emitir sello georreferenciado.`
            );
            (clientErr as Error & { isHttpClientRejection?: boolean }).isHttpClientRejection = true;
            throw clientErr;
        } catch (err) {
            const isClientRejection = Boolean(
                (err as { isHttpClientRejection?: boolean } | null)?.isHttpClientRejection
            );
            if (!isClientRejection) {
                const queuedTaskId = await syncQueueEngine.enqueueTask(
                    'GEO_REPORT_STAMP',
                    requestBody
                );
                return {
                    synced: false,
                    stamp: localStamp,
                    queuedTaskId,
                };
            }
            throw err;
        }
    }
}

export const geoCaptureService = new GeoCaptureService();
