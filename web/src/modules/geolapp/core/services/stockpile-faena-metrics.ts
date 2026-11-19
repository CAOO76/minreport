import type {
    MiningSiteProfile,
    StockpileAsset,
    StockpileMeasurement,
} from '../types/GeolappTypes';

export interface FaenaTimelinePoint {
    dateKey: string;
    timestamp: number;
    label: string;
    volumeM3: number;
    wetWeightT: number;
    dryWeightT: number;
    fineCuT: number;
    activeCount: number;
}

export interface FaenaDomainSlice {
    domain: string;
    volumeM3: number;
    weightT: number;
    sharePct: number;
    count: number;
}

export interface FaenaSummaryMetrics {
    faenaId: string;
    faenaName: string;
    activeCount: number;
    closedCount: number;
    totalCount: number;
    activeVolumeM3: number;
    activeWetWeightT: number;
    activeDryWeightT: number | null;
    activeFineCuT: number | null;
    shippedWeightT: number;
    netDeltaVolumeM3: number | null;
    netDeltaVolumePct: number | null;
    pendingAiCount: number;
    pendingScaleCount: number;
    imsbcBlockedCount: number;
    sulfideAlertCount: number;
    domains: FaenaDomainSlice[];
    timeline: FaenaTimelinePoint[];
    assets: StockpileAsset[];
}

export const UNASSIGNED_FAENA_ID = '__UNASSIGNED_FAENA__';

function toUtcDateKey(ts: number): string {
    const d = new Date(ts);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatShortDateLabel(ts: number): string {
    const d = new Date(ts);
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${day}/${month}`;
}

function getAssetVolume(asset: StockpileAsset): number {
    if (asset.status === 'CLOSED') return 0;
    const raw = asset.last_volume_m3 ?? asset.volumen ?? asset.volume_m3 ?? 0;
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

function getAssetWetWeight(asset: StockpileAsset): number {
    if (asset.status === 'CLOSED') return 0;
    const raw =
        asset.wet_weight_thm ?? asset.last_weight_t ?? asset.peso_final_toneladas ?? 0;
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

function getAssetDryWeight(asset: StockpileAsset): number | null {
    if (asset.status === 'CLOSED') return 0;
    if (typeof asset.dry_weight_tms === 'number' && Number.isFinite(asset.dry_weight_tms)) {
        return Math.max(0, asset.dry_weight_tms);
    }
    const thm = getAssetWetWeight(asset);
    if (
        thm > 0 &&
        typeof asset.moisture_pct === 'number' &&
        Number.isFinite(asset.moisture_pct)
    ) {
        return Math.max(0, thm * (1 - asset.moisture_pct / 100));
    }
    return null;
}

function getAssetFineCu(asset: StockpileAsset): number | null {
    if (asset.status === 'CLOSED') return 0;
    if (typeof asset.fine_cu_t === 'number' && Number.isFinite(asset.fine_cu_t)) {
        return Math.max(0, asset.fine_cu_t);
    }
    const tms = getAssetDryWeight(asset);
    if (
        tms !== null &&
        tms > 0 &&
        typeof asset.cu_total_pct === 'number' &&
        Number.isFinite(asset.cu_total_pct)
    ) {
        return Math.max(0, tms * (asset.cu_total_pct / 100));
    }
    return null;
}

function resolveMeasurementDryWeight(
    meas: StockpileMeasurement,
    asset?: StockpileAsset
): number {
    if (typeof meas.dry_weight_tms === 'number' && Number.isFinite(meas.dry_weight_tms)) {
        return Math.max(0, meas.dry_weight_tms);
    }
    const thm = meas.wet_weight_thm ?? meas.peso_t ?? 0;
    const moisture = meas.moisture_pct ?? asset?.moisture_pct;
    if (thm > 0 && typeof moisture === 'number' && Number.isFinite(moisture)) {
        return Math.max(0, thm * (1 - moisture / 100));
    }
    return 0;
}

function resolveMeasurementFineCu(
    meas: StockpileMeasurement,
    dryWeight: number,
    asset?: StockpileAsset
): number {
    if (typeof meas.fine_cu_t === 'number' && Number.isFinite(meas.fine_cu_t)) {
        return Math.max(0, meas.fine_cu_t);
    }
    const cuT = meas.cu_total_pct ?? asset?.cu_total_pct;
    if (dryWeight > 0 && typeof cuT === 'number' && Number.isFinite(cuT)) {
        return Math.max(0, dryWeight * (cuT / 100));
    }
    return 0;
}

function resolveFaenaId(asset: StockpileAsset): string {
    return (asset.project_id || '').trim() || UNASSIGNED_FAENA_ID;
}

export function computeFaenaMetrics(
    assets: StockpileAsset[],
    measurements: StockpileMeasurement[],
    faenaFilterId: string | 'ALL',
    knownSites: MiningSiteProfile[] = [],
    daysWindow: number | null = null
): FaenaSummaryMetrics {
    const scopedAssets =
        faenaFilterId === 'ALL'
            ? [...assets]
            : assets.filter((a) => resolveFaenaId(a) === faenaFilterId);

    const siteMatch =
        faenaFilterId === 'ALL'
            ? null
            : knownSites.find((s) => s.id === faenaFilterId) || null;
    const faenaName =
        faenaFilterId === 'ALL'
            ? 'ALL'
            : siteMatch?.name ||
              scopedAssets.find((a) => a.project_name)?.project_name ||
              faenaFilterId;

    let activeCount = 0;
    let closedCount = 0;
    let activeVolumeM3 = 0;
    let activeWetWeightT = 0;
    let dryAccumulator = 0;
    let hasDeclaredDry = false;
    let fineAccumulator = 0;
    let hasDeclaredFine = false;
    let shippedWeightT = 0;
    let pendingAiCount = 0;
    let pendingScaleCount = 0;
    let imsbcBlockedCount = 0;
    let sulfideAlertCount = 0;

    const domainMap = new Map<string, { volumeM3: number; weightT: number; count: number }>();

    for (const asset of scopedAssets) {
        const isClosed = asset.status === 'CLOSED';
        if (isClosed) {
            closedCount += 1;
            if (
                asset.closure_reason === 'SHIPPED' &&
                typeof asset.shipped_weight_t === 'number' &&
                Number.isFinite(asset.shipped_weight_t)
            ) {
                shippedWeightT += Math.max(0, asset.shipped_weight_t);
            }
        } else {
            activeCount += 1;
        }

        const vol = getAssetVolume(asset);
        const thm = getAssetWetWeight(asset);
        const tms = getAssetDryWeight(asset);
        const fine = getAssetFineCu(asset);

        activeVolumeM3 += vol;
        activeWetWeightT += thm;
        if (!isClosed && tms !== null) {
            dryAccumulator += tms;
            hasDeclaredDry = true;
        }
        if (!isClosed && fine !== null) {
            fineAccumulator += fine;
            hasDeclaredFine = true;
        }

        if (asset.analysis_status === 'PENDING_AI_SYNC') pendingAiCount += 1;
        if (asset.analysis_status === 'PENDING_SCALE') pendingScaleCount += 1;

        for (const alert of asset.copper_governance_alerts || []) {
            if (alert.code === 'CONCENTRATE_TML_EXCEEDED') imsbcBlockedCount += 1;
            if (
                alert.code === 'SULFIDE_AGING_WARNING' ||
                alert.code === 'SULFIDE_AGING_CRITICAL'
            ) {
                sulfideAlertCount += 1;
            }
        }

        if (!isClosed) {
            const domainKey = asset.copper_domain || 'UNDECLARED';
            const prev = domainMap.get(domainKey) || { volumeM3: 0, weightT: 0, count: 0 };
            prev.volumeM3 += vol;
            prev.weightT += thm;
            prev.count += 1;
            domainMap.set(domainKey, prev);
        }
    }

    const domains: FaenaDomainSlice[] = Array.from(domainMap.entries())
        .map(([domain, stats]) => ({
            domain,
            volumeM3: Number(stats.volumeM3.toFixed(2)),
            weightT: Number(stats.weightT.toFixed(2)),
            sharePct:
                activeVolumeM3 > 0
                    ? Number(((stats.volumeM3 / activeVolumeM3) * 100).toFixed(1))
                    : 0,
            count: stats.count,
        }))
        .sort((a, b) => b.volumeM3 - a.volumeM3);

    const assetById = new Map<string, StockpileAsset>();
    for (const a of scopedAssets) {
        assetById.set(a.id, a);
    }

    // Construye serie temporal consolidada cronológica usando mediciones válidas (no ignoradas)
    const validMeas = measurements
        .filter((m) => !m.ignored && assetById.has(m.assetId) && typeof m.timestamp === 'number' && m.timestamp > 0)
        .sort((a, b) => a.timestamp - b.timestamp);

    const measByAssetIds = new Set(validMeas.map((m) => m.assetId));

    interface DailyEvent {
        dateKey: string;
        timestamp: number;
        assetId: string;
        volumeM3: number;
        wetWeightT: number;
        dryWeightT: number;
        fineCuT: number;
        isClosed: boolean;
    }

    const events: DailyEvent[] = [];
    for (const m of validMeas) {
        const asset = assetById.get(m.assetId);
        const isClosure = Boolean(m.is_closure_measurement);
        const vol = isClosure ? 0 : Math.max(0, Number(m.volumen_m3) || 0);
        const wet = isClosure ? 0 : Math.max(0, Number(m.wet_weight_thm ?? m.peso_t) || 0);
        const dry = isClosure ? 0 : resolveMeasurementDryWeight(m, asset);
        const fine = isClosure ? 0 : resolveMeasurementFineCu(m, dry, asset);
        events.push({
            dateKey: toUtcDateKey(m.timestamp),
            timestamp: m.timestamp,
            assetId: m.assetId,
            volumeM3: vol,
            wetWeightT: wet,
            dryWeightT: dry,
            fineCuT: fine,
            isClosed: isClosure,
        });
    }

    // Fallback determinista para acopios recién creados sin medición cargada en memoria todavía
    for (const asset of scopedAssets) {
        if (measByAssetIds.has(asset.id)) continue;
        const ts = asset.last_measured_at || asset.captured_at || asset.createdAt;
        if (!ts || !Number.isFinite(ts)) continue;
        events.push({
            dateKey: toUtcDateKey(ts),
            timestamp: ts,
            assetId: asset.id,
            volumeM3: getAssetVolume(asset),
            wetWeightT: getAssetWetWeight(asset),
            dryWeightT: getAssetDryWeight(asset) ?? 0,
            fineCuT: getAssetFineCu(asset) ?? 0,
            isClosed: asset.status === 'CLOSED',
        });
    }

    events.sort((a, b) => a.timestamp - b.timestamp);

    const eventsByDate = new Map<string, DailyEvent[]>();
    for (const ev of events) {
        const list = eventsByDate.get(ev.dateKey) || [];
        list.push(ev);
        eventsByDate.set(ev.dateKey, list);
    }

    const runningState = new Map<
        string,
        { volumeM3: number; wetWeightT: number; dryWeightT: number; fineCuT: number; isClosed: boolean }
    >();
    let fullTimeline: FaenaTimelinePoint[] = [];

    for (const [dateKey, dayEvents] of eventsByDate.entries()) {
        let dayTs = 0;
        for (const ev of dayEvents) {
            dayTs = Math.max(dayTs, ev.timestamp);
            runningState.set(ev.assetId, {
                volumeM3: ev.volumeM3,
                wetWeightT: ev.wetWeightT,
                dryWeightT: ev.dryWeightT,
                fineCuT: ev.fineCuT,
                isClosed: ev.isClosed,
            });
        }
        let sumVol = 0;
        let sumWet = 0;
        let sumDry = 0;
        let sumFine = 0;
        let activeAtDay = 0;
        for (const snap of runningState.values()) {
            if (!snap.isClosed) {
                activeAtDay += 1;
                sumVol += snap.volumeM3;
                sumWet += snap.wetWeightT;
                sumDry += snap.dryWeightT;
                sumFine += snap.fineCuT;
            }
        }
        fullTimeline.push({
            dateKey,
            timestamp: dayTs,
            label: formatShortDateLabel(dayTs),
            volumeM3: Number(sumVol.toFixed(2)),
            wetWeightT: Number(sumWet.toFixed(2)),
            dryWeightT: Number(sumDry.toFixed(2)),
            fineCuT: Number(sumFine.toFixed(2)),
            activeCount: activeAtDay,
        });
    }

    if (typeof daysWindow === 'number' && daysWindow > 0 && fullTimeline.length > 0) {
        const cutoff = Date.now() - daysWindow * 24 * 60 * 60 * 1000;
        const windowed = fullTimeline.filter((pt) => pt.timestamp >= cutoff);
        if (windowed.length > 0) {
            fullTimeline = windowed;
        }
    }

    let netDeltaVolumeM3: number | null = null;
    let netDeltaVolumePct: number | null = null;
    if (fullTimeline.length >= 2) {
        const prev = fullTimeline[fullTimeline.length - 2];
        const curr = fullTimeline[fullTimeline.length - 1];
        netDeltaVolumeM3 = Number((curr.volumeM3 - prev.volumeM3).toFixed(2));
        netDeltaVolumePct =
            prev.volumeM3 > 0
                ? Number((((curr.volumeM3 - prev.volumeM3) / prev.volumeM3) * 100).toFixed(1))
                : null;
    }

    return {
        faenaId: faenaFilterId,
        faenaName,
        activeCount,
        closedCount,
        totalCount: scopedAssets.length,
        activeVolumeM3: Number(activeVolumeM3.toFixed(2)),
        activeWetWeightT: Number(activeWetWeightT.toFixed(2)),
        activeDryWeightT: hasDeclaredDry ? Number(dryAccumulator.toFixed(2)) : null,
        activeFineCuT: hasDeclaredFine ? Number(fineAccumulator.toFixed(2)) : null,
        shippedWeightT: Number(shippedWeightT.toFixed(2)),
        netDeltaVolumeM3,
        netDeltaVolumePct,
        pendingAiCount,
        pendingScaleCount,
        imsbcBlockedCount,
        sulfideAlertCount,
        domains,
        timeline: fullTimeline,
        assets: scopedAssets,
    };
}

export function computeAllFaenasBreakdown(
    assets: StockpileAsset[],
    measurements: StockpileMeasurement[],
    knownSites: MiningSiteProfile[] = []
): FaenaSummaryMetrics[] {
    const idSet = new Set<string>();
    for (const s of knownSites) {
        if (s.id && s.status !== 'ARCHIVED') idSet.add(s.id);
    }
    for (const a of assets) {
        idSet.add(resolveFaenaId(a));
    }
    return Array.from(idSet)
        .map((faenaId) =>
            computeFaenaMetrics(assets, measurements, faenaId, knownSites, null)
        )
        .filter((m) => m.totalCount > 0 || knownSites.some((s) => s.id === m.faenaId))
        .sort((a, b) => b.activeVolumeM3 - a.activeVolumeM3);
}
