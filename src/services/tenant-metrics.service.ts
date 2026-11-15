import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { db as defaultDb } from '../config/firebase';

export type TenantSegment = 'B2B' | 'EDU';

export interface TenantMetricCounters {
    aiRequestsTotal: number;
    aiCacheHits: number;
    aiTokensInput: number;
    aiTokensOutput: number;
    aiTierPro: number;
    aiTierFlash: number;
    aiTierFlashLite: number;
    casOriginalBytes: number;
    casOptimizedBytes: number;
    casAssetsCount: number;
    m2mRequests: number;
}

export interface TenantMetricsDocument extends TenantMetricCounters {
    accountId: string;
    segment: TenantSegment;
    period: string;
    updatedAt: string;
}

export const METRIC_COUNTER_KEYS: ReadonlyArray<keyof TenantMetricCounters> = [
    'aiRequestsTotal',
    'aiCacheHits',
    'aiTokensInput',
    'aiTokensOutput',
    'aiTierPro',
    'aiTierFlash',
    'aiTierFlashLite',
    'casOriginalBytes',
    'casOptimizedBytes',
    'casAssetsCount',
    'm2mRequests',
];

const SYNTHETIC_NON_TENANT_IDS = new Set([
    '',
    'global',
    'GLOBAL',
    'GLOBAL_VAULT',
    'global-identity',
    'm2m-unauthenticated',
    'admin-governance',
    'admin-master-console',
    'dev-master-console',
    'unknown',
    'system',
]);

const SEGMENT_CACHE_TTL_MS = 10 * 60 * 1000;
const SEGMENT_CACHE_MAX_SIZE = 2000;
const accountSegmentCache = new Map<string, { segment: TenantSegment; expiresAt: number }>();

export function formatMetricsPeriod(dateOrMs: Date | number = Date.now()): string {
    const d = dateOrMs instanceof Date ? dateOrMs : new Date(dateOrMs);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${year}_${month}`;
}

export function isTrackableTenantAccountId(accountId?: string | null): accountId is string {
    if (typeof accountId !== 'string') return false;
    const trimmed = accountId.trim();
    if (trimmed.length === 0 || trimmed.length > 128) return false;
    if (trimmed.includes('/')) return false;
    return !SYNTHETIC_NON_TENANT_IDS.has(trimmed);
}

export function normalizeMetricsDocument(
    raw: Record<string, any> | undefined,
    fallback: { accountId: string; segment: TenantSegment; period: string }
): TenantMetricsDocument {
    const normalized: TenantMetricsDocument = {
        accountId: String(raw?.accountId || fallback.accountId),
        segment: raw?.segment === 'EDU' ? 'EDU' : fallback.segment,
        period: String(raw?.period || fallback.period),
        aiRequestsTotal: Number(raw?.aiRequestsTotal || 0),
        aiCacheHits: Number(raw?.aiCacheHits || 0),
        aiTokensInput: Number(raw?.aiTokensInput || 0),
        aiTokensOutput: Number(raw?.aiTokensOutput || 0),
        aiTierPro: Number(raw?.aiTierPro || 0),
        aiTierFlash: Number(raw?.aiTierFlash || 0),
        aiTierFlashLite: Number(raw?.aiTierFlashLite || 0),
        casOriginalBytes: Number(raw?.casOriginalBytes || 0),
        casOptimizedBytes: Number(raw?.casOptimizedBytes || 0),
        casAssetsCount: Number(raw?.casAssetsCount || 0),
        m2mRequests: Number(raw?.m2mRequests || 0),
        updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : '',
    };
    return normalized;
}

export class TenantMetricsService {
    public static clearSegmentCacheForTesting(): void {
        accountSegmentCache.clear();
    }

    private static async resolveSegment(
        accountId: string,
        explicitSegment: TenantSegment | undefined,
        explicitIsEdu: boolean | undefined,
        store: any
    ): Promise<TenantSegment> {
        if (explicitIsEdu === true || explicitSegment === 'EDU') {
            return 'EDU';
        }
        if (explicitSegment === 'B2B' || explicitIsEdu === false) {
            return 'B2B';
        }

        const now = Date.now();
        const cached = accountSegmentCache.get(accountId);
        if (cached && cached.expiresAt > now) {
            return cached.segment;
        }

        let resolved: TenantSegment = 'B2B';
        try {
            const accSnap = await store.collection('accounts').doc(accountId).get();
            if (accSnap?.exists) {
                const data = accSnap.data() || {};
                const isEdu =
                    data.type === 'EDUCATIONAL' ||
                    data.classification === 'edu' ||
                    data.isEduSandbox === true;
                resolved = isEdu ? 'EDU' : 'B2B';
            }
        } catch {
            resolved = 'B2B';
        }

        if (accountSegmentCache.size >= SEGMENT_CACHE_MAX_SIZE) {
            const oldestKey = accountSegmentCache.keys().next().value;
            if (oldestKey) accountSegmentCache.delete(oldestKey);
        }
        accountSegmentCache.set(accountId, {
            segment: resolved,
            expiresAt: now + SEGMENT_CACHE_TTL_MS,
        });
        return resolved;
    }

    /**
     * Incrementa atómicamente los contadores mensuales del tenant mediante `FieldValue.increment`
     * sin escaneos de colección:
     * - B2B -> `accounts/{accountId}/metrics/{YYYY_MM}` (`segment: 'B2B'`)
     * - EDU -> `accounts/{accountId}/metrics/{YYYY_MM}` (`segment: 'EDU'`) Y `edu_metrics/{accountId}_{YYYY_MM}`
     */
    public static async recordIncrement(params: {
        accountId?: string | null;
        segment?: TenantSegment;
        isEduSandbox?: boolean;
        period?: string;
        deltas: Partial<TenantMetricCounters>;
        dbOverride?: any;
    }): Promise<{ written: boolean; segment: TenantSegment; period: string; paths: string[] }> {
        const period =
            params.period && /^\d{4}_(0[1-9]|1[0-2])$/.test(params.period)
                ? params.period
                : formatMetricsPeriod();

        if (!isTrackableTenantAccountId(params.accountId)) {
            return {
                written: false,
                segment: params.isEduSandbox || params.segment === 'EDU' ? 'EDU' : 'B2B',
                period,
                paths: [],
            };
        }

        const cleanAccountId = params.accountId.trim();
        const store = params.dbOverride || defaultDb;
        const segment = await this.resolveSegment(
            cleanAccountId,
            params.segment,
            params.isEduSandbox,
            store
        );

        const incrementPayload: Record<string, any> = {
            accountId: cleanAccountId,
            segment,
            period,
            updatedAt: new Date().toISOString(),
        };

        let hasValidDelta = false;
        for (const key of METRIC_COUNTER_KEYS) {
            const rawVal = params.deltas[key];
            if (typeof rawVal === 'number' && Number.isFinite(rawVal) && rawVal !== 0) {
                incrementPayload[key] = FieldValue.increment(Math.round(rawVal));
                hasValidDelta = true;
            }
        }

        if (!hasValidDelta) {
            return { written: false, segment, period, paths: [] };
        }

        const accountMetricPath = `accounts/${cleanAccountId}/metrics/${period}`;
        const accountMetricRef = store
            .collection('accounts')
            .doc(cleanAccountId)
            .collection('metrics')
            .doc(period);

        if (segment === 'EDU') {
            const eduDocId = `${cleanAccountId}_${period}`;
            const eduMetricPath = `edu_metrics/${eduDocId}`;
            const eduMetricRef = store.collection('edu_metrics').doc(eduDocId);

            if (typeof store.batch === 'function') {
                const batch = store.batch();
                batch.set(accountMetricRef, incrementPayload, { merge: true });
                batch.set(eduMetricRef, incrementPayload, { merge: true });
                await batch.commit();
            } else {
                await Promise.all([
                    accountMetricRef.set(incrementPayload, { merge: true }),
                    eduMetricRef.set(incrementPayload, { merge: true }),
                ]);
            }

            return {
                written: true,
                segment,
                period,
                paths: [accountMetricPath, eduMetricPath],
            };
        }

        await accountMetricRef.set(incrementPayload, { merge: true });
        return {
            written: true,
            segment,
            period,
            paths: [accountMetricPath],
        };
    }

    public static async recordAiUsage(params: {
        accountId?: string | null;
        segment?: TenantSegment;
        isEduSandbox?: boolean;
        cacheHit: boolean;
        tier: 'PRIMARY' | 'SECONDARY' | 'ANCHOR_HA';
        tokensInput?: number;
        tokensOutput?: number;
        period?: string;
        dbOverride?: any;
    }) {
        const deltas: Partial<TenantMetricCounters> = {
            aiRequestsTotal: 1,
        };
        if (params.cacheHit) {
            deltas.aiCacheHits = 1;
        } else {
            if (params.tier === 'PRIMARY') deltas.aiTierPro = 1;
            else if (params.tier === 'SECONDARY') deltas.aiTierFlash = 1;
            else deltas.aiTierFlashLite = 1;
        }
        if (typeof params.tokensInput === 'number' && params.tokensInput > 0) {
            deltas.aiTokensInput = Math.round(params.tokensInput);
        }
        if (typeof params.tokensOutput === 'number' && params.tokensOutput > 0) {
            deltas.aiTokensOutput = Math.round(params.tokensOutput);
        }

        return this.recordIncrement({
            accountId: params.accountId,
            segment: params.segment,
            isEduSandbox: params.isEduSandbox,
            period: params.period,
            deltas,
            dbOverride: params.dbOverride,
        });
    }

    public static async recordCasDigestion(params: {
        accountId?: string | null;
        segment?: TenantSegment;
        isEduSandbox?: boolean;
        originalBytes: number;
        optimizedBytes: number;
        period?: string;
        dbOverride?: any;
    }) {
        return this.recordIncrement({
            accountId: params.accountId,
            segment: params.segment,
            isEduSandbox: params.isEduSandbox,
            period: params.period,
            deltas: {
                casAssetsCount: 1,
                casOriginalBytes: Math.max(0, Math.round(params.originalBytes || 0)),
                casOptimizedBytes: Math.max(0, Math.round(params.optimizedBytes || 0)),
            },
            dbOverride: params.dbOverride,
        });
    }

    public static async recordM2mRequest(params: {
        accountId?: string | null;
        segment?: TenantSegment;
        isEduSandbox?: boolean;
        count?: number;
        period?: string;
        dbOverride?: any;
    }) {
        return this.recordIncrement({
            accountId: params.accountId,
            segment: params.segment,
            isEduSandbox: params.isEduSandbox,
            period: params.period,
            deltas: {
                m2mRequests: Math.max(1, Math.round(params.count ?? 1)),
            },
            dbOverride: params.dbOverride,
        });
    }

    /**
     * Consulta separada para el panel Super Admin sin escaneos O(N) globales:
     * - `EDU`: consulta directa indexada sobre `edu_metrics` filtrada por `period`.
     * - `B2B`: hidrata únicamente documentos puntuales `accounts/{id}/metrics/{period}` vía `db.getAll`.
     */
    public static async listMetricsBySegment(params: {
        segment: TenantSegment;
        period?: string;
        limit?: number;
        dbOverride?: Firestore;
    }): Promise<{
        segment: TenantSegment;
        period: string;
        count: number;
        totals: TenantMetricCounters;
        items: Array<TenantMetricsDocument & { accountName?: string }>;
    }> {
        const store = params.dbOverride || defaultDb;
        const period =
            params.period && /^\d{4}_(0[1-9]|1[0-2])$/.test(params.period)
                ? params.period
                : formatMetricsPeriod();
        const maxItems = Math.min(200, Math.max(1, params.limit ?? 100));

        const items: Array<TenantMetricsDocument & { accountName?: string }> = [];

        if (params.segment === 'EDU') {
            const eduSnap = await store
                .collection('edu_metrics')
                .where('period', '==', period)
                .limit(maxItems)
                .get();

            const eduDocs = eduSnap.docs.map((d) => {
                const raw = d.data() || {};
                const fallbackAccountId = d.id.endsWith(`_${period}`)
                    ? d.id.slice(0, -(period.length + 1))
                    : String(raw.accountId || d.id);
                return normalizeMetricsDocument(raw, {
                    accountId: fallbackAccountId,
                    segment: 'EDU',
                    period,
                });
            });

            if (eduDocs.length > 0) {
                const accountRefs = eduDocs.map((m) => store.collection('accounts').doc(m.accountId));
                const accountSnaps = await store.getAll(...accountRefs);
                const namesById = new Map<string, string>();
                for (const snap of accountSnaps) {
                    if (snap.exists) {
                        const accData = snap.data() || {};
                        namesById.set(snap.id, String(accData.name || accData.fantasyName || snap.id));
                    }
                }
                for (const m of eduDocs) {
                    items.push({
                        ...m,
                        accountName: namesById.get(m.accountId),
                    });
                }
            }
        } else {
            const b2bAccountsSnap = await store
                .collection('accounts')
                .where('type', 'in', ['BUSINESS', 'ENTERPRISE', 'PERSONAL', 'B2B'])
                .limit(maxItems)
                .get();

            const b2bAccounts = b2bAccountsSnap.docs
                .map((d) => ({ id: d.id, data: d.data() || {} }))
                .filter(
                    (acc) =>
                        acc.data.isEduSandbox !== true &&
                        acc.data.classification !== 'edu' &&
                        acc.data.type !== 'EDUCATIONAL'
                );

            if (b2bAccounts.length > 0) {
                const metricRefs = b2bAccounts.map((acc) =>
                    store.collection('accounts').doc(acc.id).collection('metrics').doc(period)
                );
                const metricSnaps = await store.getAll(...metricRefs);
                metricSnaps.forEach((mSnap, idx) => {
                    const acc = b2bAccounts[idx];
                    if (!mSnap.exists) return;
                    const normalized = normalizeMetricsDocument(mSnap.data() || {}, {
                        accountId: acc.id,
                        segment: 'B2B',
                        period,
                    });
                    items.push({
                        ...normalized,
                        accountName: String(acc.data.name || acc.data.fantasyName || acc.id),
                    });
                });
            }
        }

        const totals: TenantMetricCounters = {
            aiRequestsTotal: 0,
            aiCacheHits: 0,
            aiTokensInput: 0,
            aiTokensOutput: 0,
            aiTierPro: 0,
            aiTierFlash: 0,
            aiTierFlashLite: 0,
            casOriginalBytes: 0,
            casOptimizedBytes: 0,
            casAssetsCount: 0,
            m2mRequests: 0,
        };

        for (const item of items) {
            for (const key of METRIC_COUNTER_KEYS) {
                totals[key] += Number(item[key] || 0);
            }
        }

        return {
            segment: params.segment,
            period,
            count: items.length,
            totals,
            items,
        };
    }
}
