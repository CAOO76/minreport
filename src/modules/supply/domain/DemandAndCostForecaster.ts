/**
 * MINREPORT · ABASTECIMIENTO — Pronóstico de Demanda, Guardrail DS 594 y Señales Anónimas Ley 21.719
 *
 * Implementación 100% determinística:
 * - Tasa per-cápita EWMA (`PAX/día`) y Días de Inventario (`DOI` en bodega y efectivo con tránsito).
 * - Guardrail sanitario **DS 594 Art. 14** de agua potable (`100–120 L/PAX/día × leadTimeDays`)
 *   con factor de hipobaria en gran altura geográfica (> 3.000 msnm, **DS 28**).
 * - **`DemandSignalProjector`** conforme a **Ley N° 21.719 (Chile)**: exige opt-in explícito y
 *   k-anonimato estricto (`k >= 3` sitios Y `k >= 3` tenants distintos por distrito minero),
 *   garantizando estructuralmente cero exposición de `tenantId`, `siteId` o coordenadas GPS.
 */

import {
    CanonicalSupplySku,
    DemandForecast,
    DemandPoolSignal,
    Ds594WaterGuardrailEvaluation,
    ProcurementBucket,
    SupplyCategoryCode,
    SupplySite,
    SupplyUnitSi,
    roundClp,
    roundSupplyQty,
} from './types';
import { findCanonicalSkuById } from '../catalog/DefaultSupplyCatalogSeed';

export const DS594_MIN_WATER_L_PER_PAX_DAY = 100;
export const DS594_DEFAULT_WATER_L_PER_PAX_DAY = 120;
export const DS28_HIGH_ALTITUDE_THRESHOLD_M = 3000;
export const DS28_VERY_HIGH_ALTITUDE_THRESHOLD_M = 4000;
export const LEY21719_MIN_K_ANONYMITY = 5;

export function isSandboxTenantId(
    tenantId: string,
    isEduSandbox?: boolean,
    accountType?: string
): boolean {
    if (isEduSandbox === true) return true;
    const normalizedType = String(accountType || '').trim().toUpperCase();
    if (
        normalizedType &&
        normalizedType !== 'B2B' &&
        (normalizedType === 'EDUCATIONAL' ||
            normalizedType === 'EDU' ||
            normalizedType === 'TEST_PILOT' ||
            normalizedType === 'DEV' ||
            normalizedType === 'DEV_ROOT' ||
            normalizedType === 'ADMIN')
    ) {
        return true;
    }
    const clean = String(tenantId || '').trim().toLowerCase();
    if (!clean) return true;
    return (
        clean === 'dev-master-sandbox' ||
        clean.startsWith('pilot-') ||
        clean.startsWith('edu-') ||
        clean.startsWith('dev-')
    );
}

export interface DailyConsumptionObservation {
    dateIso: string;
    consumedQtySi: number;
    headcount: number;
}

export interface ForecastSkuDemandInput {
    site: SupplySite;
    canonicalSkuId: string;
    categoryCode: SupplyCategoryCode;
    unitSi: SupplyUnitSi;
    history: readonly DailyConsumptionObservation[];
    currentWarehouseStockSi: number;
    currentInTransitStockSi: number;
    /** Factor suavizado EWMA (default 0.3) */
    ewmaAlpha?: number;
    /** Días de stock de seguridad adicionales al lead time (default 2) */
    safetyDays?: number;
    /** Días objetivo de reposición (default leadTimeDays + safetyDays + 7) */
    targetCoverageDays?: number;
    /** Tasa base per-cápita si no existe historial previo */
    fallbackDailyPerPaxSi?: number;
    computedAt?: string;
}

export interface TenantDemandObservation {
    tenantId: string;
    siteId: string;
    districtCode: string;
    geoFix?: { lat: number; lng: number };
    optInMarketplace: boolean;
    isEduSandbox?: boolean;
    accountType?: string;
    canonicalSkuId: string;
    skuName?: string;
    categoryCode?: SupplyCategoryCode;
    procurementBucket: ProcurementBucket;
    unitSi: SupplyUnitSi;
    projectedDemandSi: number;
    unitPriceClp?: number;
}

export interface DemandSignalProjectionOptions {
    windowStartIso: string;
    windowEndIso: string;
    periodWindow?: string;
    expiresAt?: string;
    customCatalog?: readonly CanonicalSupplySku[];
    /** Mínimo k-anonimato (se aplica piso inviolable `>= 5` B2B por Ley N° 21.719) */
    minK?: number;
    generatedAt?: string;
}

export interface DemandSignalProjectionResult {
    signals: DemandPoolSignal[];
    droppedOptOutCount: number;
    droppedSandboxCount: number;
    suppressedLowKGroupCount: number;
    enforcedK: number;
}

/**
 * Calcula Media Móvil Exponencial Ponderada (EWMA):
 * S_0 = x_0, S_t = alpha * x_t + (1 - alpha) * S_{t-1}.
 */
export function computeEwmaSeries(values: readonly number[], alpha: number = 0.3): number {
    const clean = values.filter((v) => Number.isFinite(v) && v >= 0);
    if (clean.length === 0) return 0;
    const clampedAlpha = Math.min(1, Math.max(0.05, alpha));
    let ewma = clean[0];
    for (let i = 1; i < clean.length; i++) {
        ewma = clampedAlpha * clean[i] + (1 - clampedAlpha) * ewma;
    }
    return roundSupplyQty(ewma);
}

/**
 * Calcula el factor de hidratación adicional por gran altura geográfica (DS 28 Minsal Chile):
 * - <= 3.000 msnm: 1.00
 * - 3.001 – 4.000 msnm: 1.20 (+20%)
 * - > 4.000 msnm: 1.30 (+30%)
 */
export function resolveAltitudeHydrationFactor(altitudeMeters?: number): number {
    if (!altitudeMeters || !Number.isFinite(altitudeMeters) || altitudeMeters <= DS28_HIGH_ALTITUDE_THRESHOLD_M) {
        return 1.0;
    }
    if (altitudeMeters > DS28_VERY_HIGH_ALTITUDE_THRESHOLD_M) {
        return 1.3;
    }
    return 1.2;
}

/**
 * Evalúa el cumplimiento del guardrail sanitario DS 594 Art. 14 + factor altura DS 28
 * para agua potable en campamento minero (`100–120 L/PAX/día × leadTimeDays`).
 */
export function evaluateDs594WaterGuardrail(params: {
    site: SupplySite;
    currentWaterWarehouseL: number;
    currentWaterInTransitL: number;
}): Ds594WaterGuardrailEvaluation {
    const baseTarget = Math.max(
        DS594_MIN_WATER_L_PER_PAX_DAY,
        params.site.ds594DailyWaterTargetLPerPax || DS594_DEFAULT_WATER_L_PER_PAX_DAY
    );
    const altitudeFactorApplied = resolveAltitudeHydrationFactor(params.site.altitudeMeters);
    const requiredDailyLPerPax = roundSupplyQty(baseTarget * altitudeFactorApplied);

    const headcount = Math.max(0, params.site.currentHeadcount);
    const leadTimeDays = Math.max(1, params.site.leadTimeDays);
    const dailyTotalRequiredL = roundSupplyQty(requiredDailyLPerPax * headcount);
    const requiredReserveL = roundSupplyQty(dailyTotalRequiredL * leadTimeDays);

    const currentWarehouseL = roundSupplyQty(Math.max(0, params.currentWaterWarehouseL));
    const currentInTransitL = roundSupplyQty(Math.max(0, params.currentWaterInTransitL));
    const currentAvailableL = roundSupplyQty(currentWarehouseL + currentInTransitL);

    const coverageDays =
        dailyTotalRequiredL > 0 ? roundSupplyQty(currentAvailableL / dailyTotalRequiredL) : 999;

    const deficitL =
        currentAvailableL < requiredReserveL
            ? roundSupplyQty(requiredReserveL - currentAvailableL)
            : 0;

    const waterStorageCapacityL = roundSupplyQty(Math.max(0, params.site.waterStorageCapacityL));

    return {
        requiredDailyLPerPax,
        altitudeFactorApplied,
        requiredReserveL,
        currentAvailableL,
        currentWarehouseL,
        currentInTransitL,
        waterStorageCapacityL,
        coverageDays,
        compliant: deficitL <= 0,
        deficitL,
        storageCapacitySufficient: waterStorageCapacityL >= requiredReserveL,
    };
}

/**
 * Pronostica demanda diaria EWMA per-cápita, DOI y punto de reorden para un SKU en un sitio minero.
 */
export function forecastSkuDemand(input: ForecastSkuDemandInput): DemandForecast {
    const alpha = input.ewmaAlpha ?? 0.3;
    const safetyDays = input.safetyDays ?? 2;
    const leadTimeDays = Math.max(1, input.site.leadTimeDays);
    const targetCoverageDays = input.targetCoverageDays ?? leadTimeDays + safetyDays + 7;
    const headcount = Math.max(0, input.site.currentHeadcount);

    // Ordenar historial cronológicamente y calcular consumo per-cápita (PAX/día)
    const sortedHistory = [...input.history].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
    const perPaxRates = sortedHistory
        .filter((obs) => obs.headcount > 0 && obs.consumedQtySi >= 0)
        .map((obs) => obs.consumedQtySi / obs.headcount);

    let ewmaDailyPerPaxSi =
        perPaxRates.length > 0
            ? computeEwmaSeries(perPaxRates, alpha)
            : roundSupplyQty(input.fallbackDailyPerPaxSi ?? 0);

    let ds594WaterGuardrail: Ds594WaterGuardrailEvaluation | undefined;
    if (input.categoryCode === 'AGUA_POTABLE' && input.unitSi === 'L') {
        ds594WaterGuardrail = evaluateDs594WaterGuardrail({
            site: input.site,
            currentWaterWarehouseL: input.currentWarehouseStockSi,
            currentWaterInTransitL: input.currentInTransitStockSi,
        });
        // El mínimo legal DS 594 Art. 14 + DS 28 nunca puede ser inferior al consumo proyectado
        ewmaDailyPerPaxSi = Math.max(ewmaDailyPerPaxSi, ds594WaterGuardrail.requiredDailyLPerPax);
    }

    const ewmaDailyTotalSi = roundSupplyQty(ewmaDailyPerPaxSi * headcount);
    const warehouse = roundSupplyQty(Math.max(0, input.currentWarehouseStockSi));
    const inTransit = roundSupplyQty(Math.max(0, input.currentInTransitStockSi));
    const effectiveStock = roundSupplyQty(warehouse + inTransit);

    const daysOfInventoryWarehouse =
        ewmaDailyTotalSi > 0 ? roundSupplyQty(warehouse / ewmaDailyTotalSi) : 999;
    const daysOfInventoryEffective =
        ewmaDailyTotalSi > 0 ? roundSupplyQty(effectiveStock / ewmaDailyTotalSi) : 999;

    const reorderPointSi = roundSupplyQty(ewmaDailyTotalSi * (leadTimeDays + safetyDays));
    const targetStockSi = roundSupplyQty(ewmaDailyTotalSi * targetCoverageDays);

    let recommendedOrderQtySi =
        effectiveStock < reorderPointSi
            ? roundSupplyQty(Math.max(0, targetStockSi - effectiveStock))
            : 0;

    if (ds594WaterGuardrail && !ds594WaterGuardrail.compliant) {
        recommendedOrderQtySi = roundSupplyQty(
            Math.max(recommendedOrderQtySi, ds594WaterGuardrail.deficitL)
        );
    }

    return {
        siteId: input.site.siteId,
        tenantId: input.site.tenantId,
        canonicalSkuId: input.canonicalSkuId,
        unitSi: input.unitSi,
        ewmaDailyTotalSi,
        ewmaDailyPerPaxSi,
        currentHeadcount: headcount,
        currentWarehouseStockSi: warehouse,
        currentInTransitStockSi: inTransit,
        daysOfInventoryWarehouse,
        daysOfInventoryEffective,
        reorderPointSi,
        recommendedOrderQtySi,
        ds594WaterGuardrail,
        computedAt: input.computedAt || new Date().toISOString(),
    };
}

function computeMedianReferenceClp(prices: readonly number[]): number | undefined {
    const valid = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
    if (valid.length === 0) return undefined;
    const mid = Math.floor(valid.length / 2);
    const median =
        valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
    return roundClp(median);
}

/**
 * `DemandSignalProjector` — Proyector Anónimo de Demanda para Marketplace (Ley N° 21.719 Chile).
 *
 * Garantías inviolables (alineado 1:1 con `DemandPoolSignalSchema.strict()`):
 * 1. Opt-in explícito: descarta toda observación con `optInMarketplace !== true`.
 * 2. Exclusión de sandboxes: descarta cualquier cuenta EDU (`isEduSandbox`), TEST-PILOT (`pilot-*`) o DEV (`dev-master-sandbox`).
 * 3. k-anonimato estricto (`k >= 5`): solo emite señal si existen al menos `k` tenants B2B distintos
 *    Y `k` sitios distintos en el mismo `districtCode` + `canonicalSkuId`.
 * 4. Cero exposición de PII/identificadores: la salida no contiene `tenantId`, `siteId` ni `geoFix`.
 */
export function projectAnonymousDemandSignals(
    observations: readonly TenantDemandObservation[],
    options: DemandSignalProjectionOptions
): DemandSignalProjectionResult {
    const enforcedK = Math.max(LEY21719_MIN_K_ANONYMITY, Math.floor(options.minK ?? LEY21719_MIN_K_ANONYMITY));
    const generatedAt = options.generatedAt || new Date().toISOString();
    const periodWindow =
        options.periodWindow ||
        `${options.windowStartIso.slice(0, 10)}..${options.windowEndIso.slice(0, 10)}`;
    const expiresAt = options.expiresAt || options.windowEndIso;

    let droppedOptOutCount = 0;
    let droppedSandboxCount = 0;

    interface GroupBucket {
        districtCode: string;
        canonicalSkuId: string;
        skuName: string;
        categoryCode: SupplyCategoryCode;
        procurementBucket: ProcurementBucket;
        unitSi: SupplyUnitSi;
        distinctTenants: Set<string>;
        distinctSites: Set<string>;
        totalDemandSi: number;
        unitPricesClp: number[];
    }

    const groups = new Map<string, GroupBucket>();

    for (const obs of observations) {
        if (obs.optInMarketplace !== true) {
            droppedOptOutCount += 1;
            continue;
        }
        if (isSandboxTenantId(obs.tenantId, obs.isEduSandbox, obs.accountType)) {
            droppedSandboxCount += 1;
            continue;
        }
        if (obs.projectedDemandSi <= 0 || !obs.districtCode.trim() || !obs.canonicalSkuId.trim()) {
            continue;
        }

        const districtCode = obs.districtCode.trim().toUpperCase();
        const key = `${districtCode}::${obs.canonicalSkuId}::${obs.unitSi}`;
        const catalogSku = findCanonicalSkuById(obs.canonicalSkuId, options.customCatalog);

        let group = groups.get(key);
        if (!group) {
            group = {
                districtCode,
                canonicalSkuId: obs.canonicalSkuId,
                skuName: obs.skuName || catalogSku?.name || obs.canonicalSkuId,
                categoryCode: obs.categoryCode || catalogSku?.categoryCode || 'OTROS_OPERACIONAL',
                procurementBucket: obs.procurementBucket,
                unitSi: obs.unitSi,
                distinctTenants: new Set<string>(),
                distinctSites: new Set<string>(),
                totalDemandSi: 0,
                unitPricesClp: [],
            };
            groups.set(key, group);
        }

        group.distinctTenants.add(obs.tenantId);
        group.distinctSites.add(`${obs.tenantId}::${obs.siteId}`);
        group.totalDemandSi = roundSupplyQty(group.totalDemandSi + obs.projectedDemandSi);
        if (obs.unitPriceClp && obs.unitPriceClp > 0) {
            group.unitPricesClp.push(obs.unitPriceClp);
        }
    }

    const signals: DemandPoolSignal[] = [];
    let suppressedLowKGroupCount = 0;

    for (const group of groups.values()) {
        if (
            group.distinctTenants.size < enforcedK ||
            group.distinctSites.size < enforcedK
        ) {
            suppressedLowKGroupCount += 1;
            continue;
        }

        const medianRef = computeMedianReferenceClp(group.unitPricesClp);
        const signal: DemandPoolSignal = {
            signalId: `sig-${group.districtCode}-${group.canonicalSkuId}-${options.windowStartIso.slice(0, 10)}`,
            districtCode: group.districtCode,
            periodWindow,
            canonicalSkuId: group.canonicalSkuId,
            skuName: group.skuName,
            categoryCode: group.categoryCode,
            procurementBucket: group.procurementBucket,
            unitSi: group.unitSi,
            aggregatedQty: group.totalDemandSi,
            participatingEntitiesCount: group.distinctTenants.size,
            optInVerified: true,
            ...(medianRef !== undefined ? { medianReferenceUnitClp: medianRef } : {}),
            generatedAt,
            expiresAt,
        };

        signals.push(signal);
    }

    signals.sort((a, b) => a.signalId.localeCompare(b.signalId));

    return {
        signals,
        droppedOptOutCount,
        droppedSandboxCount,
        suppressedLowKGroupCount,
        enforcedK,
    };
}
