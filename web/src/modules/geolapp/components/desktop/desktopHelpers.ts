import type { CanonicalGeoFix } from '../../../../contracts/geo.contracts';
import { buildCanonicalGeoFix } from '../../../../core/geo/wgs84UtmProjection';
import { COPPER_DOMAIN_OPTIONS } from '../../core/utils/captureHelpers';
import type { CopperMineralDomain, StockpileAsset } from '../../core/types/GeolappTypes';

export const COPPER_DOMAIN_LIST: CopperMineralDomain[] = COPPER_DOMAIN_OPTIONS.map(
    (item) => item.value
);

export function formatKilobytes(bytes?: number | null): string | null {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatCasTraceLabel(
    origBytes?: number | null,
    optBytes?: number | null,
    savingsPct?: number | null
): string | null {
    const oStr = formatKilobytes(origBytes);
    const cStr = formatKilobytes(optBytes);
    if (!oStr && !cStr) return null;
    const pctPart =
        typeof savingsPct === 'number' && Number.isFinite(savingsPct)
            ? ` (-${savingsPct.toFixed(0)}%)`
            : '';
    return `${oStr || '--'} ➔ ${cStr || '--'}${pctPart}`;
}

export function formatSignedDelta(
    deltaM3?: number | null,
    deltaPct?: number | null
): string | null {
    if (typeof deltaM3 !== 'number' || !Number.isFinite(deltaM3)) return null;
    const sign = deltaM3 > 0 ? '+' : '';
    const m3Part = `${sign}${deltaM3.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`;
    if (typeof deltaPct === 'number' && Number.isFinite(deltaPct)) {
        const pctSign = deltaPct > 0 ? '+' : '';
        return `${m3Part} (${pctSign}${deltaPct.toFixed(1)}%)`;
    }
    return m3Part;
}

export function parseNullableNonNegativeNumber(raw: string): number | null {
    const trimmed = raw.trim().replace(',', '.');
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function resolveCanonicalFix(asset?: StockpileAsset | null): CanonicalGeoFix | null {
    if (!asset) return null;
    const lat = asset.geo_point?.latitude ?? asset.location?.lat;
    const lng = asset.geo_point?.longitude ?? asset.location?.lng;
    if (
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        (lat === 0 && lng === 0)
    ) {
        return null;
    }
    try {
        return buildCanonicalGeoFix({
            lat,
            lng,
            altitudeM: asset.geo_point?.altitude ?? null,
            accuracyM: asset.geo_point?.accuracy ?? null,
            source: 'CAPACITOR_GNSS',
        });
    } catch {
        return null;
    }
}

export interface AssetMetallurgySummary {
    volumeM3: number;
    weightT: number;
    thm: number | null;
    tms: number | null;
    fineCuT: number | null;
    rsPct: number | null;
}

export function computeAssetMetallurgySummary(asset: StockpileAsset): AssetMetallurgySummary {
    const volumeM3 = asset.last_volume_m3 ?? asset.volumen ?? asset.volume_m3 ?? 0;
    const weightT = asset.last_weight_t ?? asset.weight_t ?? asset.peso_final_toneladas ?? 0;
    const thm =
        asset.wet_weight_thm ?? (weightT > 0 ? weightT : null);
    let tms: number | null =
        typeof asset.dry_weight_tms === 'number' ? asset.dry_weight_tms : null;
    if (
        tms === null &&
        typeof thm === 'number' &&
        typeof asset.moisture_pct === 'number' &&
        Number.isFinite(asset.moisture_pct)
    ) {
        tms = Number((thm * (1 - asset.moisture_pct / 100)).toFixed(2));
    }
    let fineCuT: number | null =
        typeof asset.fine_cu_t === 'number' ? asset.fine_cu_t : null;
    if (
        fineCuT === null &&
        typeof (tms ?? thm) === 'number' &&
        typeof asset.cu_total_pct === 'number' &&
        Number.isFinite(asset.cu_total_pct)
    ) {
        const massBase = (tms ?? thm) as number;
        fineCuT = Number((massBase * (asset.cu_total_pct / 100)).toFixed(3));
    }
    const rsPct =
        typeof asset.cu_total_pct === 'number' &&
        asset.cu_total_pct > 0 &&
        typeof asset.cu_soluble_pct === 'number'
            ? Number(((asset.cu_soluble_pct / asset.cu_total_pct) * 100).toFixed(1))
            : null;

    return { volumeM3, weightT, thm, tms, fineCuT, rsPct };
}
