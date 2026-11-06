import { createHmac } from 'crypto';
import { db } from '../../../config/firebase';
import { env } from '../../../config/env';

/**
 * COLLECTIVE BENCHMARK & SHARED MATERIAL CATALOG SERVICE v4.0
 *
 * Inteligencia Colectiva Empírica $(k \ge 5)$-Anónima (`OPERMAQ` + `STOCKPILE CONTROL`):
 * 1. Aporta aprendizaje empírico transversal entre todos los módulos de MINREPORT sin exponer
 *    jamás la identidad, costos, contratos ni operación individual de ninguna empresa cliente.
 * 2. Seudonimización irreversible `HMAC-SHA256` del `tenantId` antes de escribir en `benchmark_events`.
 * 3. Regla matemática estricta $(k \ge 5)$-anonimato: ninguna métrica agregada (`P25`, `P50`, `P75`, `P90`)
 *    se expone hasta que al menos **5 empresas distintas** hayan reportado sobre el mismo activo o material.
 * 4. Catálogo Universal de Materiales Mineros y Áridos (`global_material_catalog`) compartido una sola vez
 *    para cubicaciones volumétricas y tonelajes en `STOCKPILE CONTROL`.
 */

export const MIN_K_ANONYMITY_TENANTS = 5;

export type BenchmarkMetricKind =
    | 'FUEL_CONSUMPTION_LH'
    | 'HYDRAULIC_FILTER_LIFE_H'
    | 'TIRE_OR_TRACK_LIFE_H'
    | 'PM_AVAILABILITY_PCT'
    | 'MATERIAL_BULK_DENSITY_TM3';

export interface RecordEmpiricalEventInput {
    tenantId: string;
    module: 'opermaq' | 'stockpile';
    targetCanonicalId: string; // `globalAssetId` o `materialId`
    metricKind: BenchmarkMetricKind;
    numericValue: number;
    unitSi: string;
    operatingContextTag?: string;
}

export interface AnonymousBenchmarkSummary {
    targetCanonicalId: string;
    metricKind: BenchmarkMetricKind;
    unitSi: string;
    kAnonymityMet: boolean;
    requiredMinTenants: number;
    distinctTenantsCount: number;
    sampleSize: number;
    p25: number | null;
    medianP50: number | null;
    p75: number | null;
    p90: number | null;
    statusMessageEs: string;
}

export interface CanonicalMaterialEntry {
    material_id: string;
    name_es: string;
    category: 'MINERIA_METALICA' | 'MINERIA_NO_METALICA' | 'ARIDOS_CONSTRUCCION' | 'CONCENTRADOS_RELAVES';
    bulk_density_loose_tm3: number;
    bulk_density_compacted_tm3: number;
    swell_factor_pct: number;
    angle_of_repose_deg: number;
    ghs_refs: string[];
    iso_ppe_refs: string[];
}

const CANONICAL_MATERIALS_SEED: CanonicalMaterialEntry[] = [
    {
        material_id: 'mineral_rom_cobre_sulfurado',
        name_es: 'Mineral ROM Cobre Sulfurado (Chancado Primario)',
        category: 'MINERIA_METALICA',
        bulk_density_loose_tm3: 1.68,
        bulk_density_compacted_tm3: 1.92,
        swell_factor_pct: 38,
        angle_of_repose_deg: 37,
        ghs_refs: ['ghs_08_health_hazard_silica_fumes'],
        iso_ppe_refs: ['iso_7010_m014', 'iso_7010_m017', 'iso_7010_m004'],
    },
    {
        material_id: 'ripio_lixiviacion_cobre',
        name_es: 'Ripio de Lixiviación Agotado ( Óxidos Cu )',
        category: 'MINERIA_METALICA',
        bulk_density_loose_tm3: 1.58,
        bulk_density_compacted_tm3: 1.81,
        swell_factor_pct: 32,
        angle_of_repose_deg: 35,
        ghs_refs: ['ghs_05_corrosive_battery_acid', 'ghs_08_health_hazard_silica_fumes'],
        iso_ppe_refs: ['iso_7010_m014', 'iso_7010_m017', 'iso_7010_m009'],
    },
    {
        material_id: 'concentrado_cobre_humedo',
        name_es: 'Concentrado de Cobre Filtrado (8–10% Humedad)',
        category: 'CONCENTRADOS_RELAVES',
        bulk_density_loose_tm3: 2.05,
        bulk_density_compacted_tm3: 2.38,
        swell_factor_pct: 22,
        angle_of_repose_deg: 39,
        ghs_refs: ['ghs_08_health_hazard_silica_fumes', 'ghs_09_environmental_spill_hazard'],
        iso_ppe_refs: ['iso_7010_m017', 'iso_7010_m009', 'iso_7010_m004'],
    },
    {
        material_id: 'lastre_esteril_rajo',
        name_es: 'Lastre / Estéril de Tronadura (Granodiorita / Andesita)',
        category: 'MINERIA_METALICA',
        bulk_density_loose_tm3: 1.62,
        bulk_density_compacted_tm3: 1.88,
        swell_factor_pct: 42,
        angle_of_repose_deg: 38,
        ghs_refs: ['ghs_08_health_hazard_silica_fumes'],
        iso_ppe_refs: ['iso_7010_m014', 'iso_7010_m015', 'iso_7010_m017'],
    },
    {
        material_id: 'gravilla_chancada_20mm',
        name_es: 'Gravilla Chancada 3/4" (19–20 mm)',
        category: 'ARIDOS_CONSTRUCCION',
        bulk_density_loose_tm3: 1.52,
        bulk_density_compacted_tm3: 1.68,
        swell_factor_pct: 18,
        angle_of_repose_deg: 34,
        ghs_refs: ['ghs_08_health_hazard_silica_fumes'],
        iso_ppe_refs: ['iso_7010_m014', 'iso_7010_m004', 'iso_7010_m008'],
    },
    {
        material_id: 'arena_manufacturada_5mm',
        name_es: 'Arena Manufacturada Seca (< 5 mm)',
        category: 'ARIDOS_CONSTRUCCION',
        bulk_density_loose_tm3: 1.48,
        bulk_density_compacted_tm3: 1.66,
        swell_factor_pct: 14,
        angle_of_repose_deg: 32,
        ghs_refs: ['ghs_08_health_hazard_silica_fumes'],
        iso_ppe_refs: ['iso_7010_m017', 'iso_7010_m004'],
    },
    {
        material_id: 'caliche_sales_litio_nitrato',
        name_es: 'Caliche / Sales Evaporíticas (Nitrato / Litio)',
        category: 'MINERIA_NO_METALICA',
        bulk_density_loose_tm3: 1.38,
        bulk_density_compacted_tm3: 1.61,
        swell_factor_pct: 28,
        angle_of_repose_deg: 33,
        ghs_refs: ['ghs_07_irritant_sensitizer'],
        iso_ppe_refs: ['iso_7010_m014', 'iso_7010_m004', 'iso_7010_m017'],
    },
];

let materialsSeededInMemory = false;

function computeTenantCohortHmac(tenantId: string): string {
    const secretSalt =
        process.env.MINREPORT_BENCHMARK_HMAC_SECRET ||
        `${env.GCP_PROJECT_ID || 'minreport'}_sovereign_k5_hmac_salt_v4`;
    return createHmac('sha256', secretSalt).update(tenantId.trim().toLowerCase()).digest('hex');
}

function percentileSorted(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = (sorted.length - 1) * p;
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return Math.round(sorted[lower] * 100) / 100;
    const weight = idx - lower;
    const val = sorted[lower] * (1 - weight) + sorted[upper] * weight;
    return Math.round(val * 100) / 100;
}

export class CollectiveBenchmarkService {
    /**
     * Registra una observación empírica anonimizada mediante `HMAC-SHA256` sin persistir jamás el `tenantId` en claro
     * dentro de las lecturas agregadas.
     */
    public static async recordAnonymousMetricEvent(
        input: RecordEmpiricalEventInput
    ): Promise<{ eventId: string; cohortTenantHashPrefix: string }> {
        if (!Number.isFinite(input.numericValue) || input.numericValue <= 0) {
            throw new Error('numericValue debe ser un número positivo válido.');
        }

        const cohortHash = computeTenantCohortHmac(input.tenantId);
        const ref = await db.collection('benchmark_events').add({
            cohort_tenant_hash: cohortHash,
            module: input.module,
            target_canonical_id: input.targetCanonicalId,
            metric_kind: input.metricKind,
            numeric_value: input.numericValue,
            unit_si: input.unitSi,
            operating_context_tag: input.operatingContextTag || 'STANDARD_FAENA',
            recorded_at: new Date().toISOString(),
        });

        return {
            eventId: ref.id,
            cohortTenantHashPrefix: cohortHash.slice(0, 10),
        };
    }

    /**
     * Calcula estadísticos empíricos (`P25`, `P50`, `P75`, `P90`) exigiendo estrictamente $(k \ge 5)$ empresas distintas.
     */
    public static async getAnonymousBenchmarkSummary(
        targetCanonicalId: string,
        metricKind: BenchmarkMetricKind
    ): Promise<AnonymousBenchmarkSummary> {
        const snap = await db
            .collection('benchmark_events')
            .where('target_canonical_id', '==', targetCanonicalId)
            .where('metric_kind', '==', metricKind)
            .limit(500)
            .get();

        const distinctTenants = new Set<string>();
        const values: number[] = [];
        let unitSi = '';

        for (const doc of snap.docs) {
            const d = doc.data();
            if (d.cohort_tenant_hash) distinctTenants.add(String(d.cohort_tenant_hash));
            if (typeof d.numeric_value === 'number' && Number.isFinite(d.numeric_value)) {
                values.push(d.numeric_value);
            }
            if (!unitSi && d.unit_si) unitSi = String(d.unit_si);
        }

        if (distinctTenants.size < MIN_K_ANONYMITY_TENANTS || values.length < MIN_K_ANONYMITY_TENANTS) {
            return {
                targetCanonicalId,
                metricKind,
                unitSi: unitSi || 'SI',
                kAnonymityMet: false,
                requiredMinTenants: MIN_K_ANONYMITY_TENANTS,
                distinctTenantsCount: distinctTenants.size,
                sampleSize: values.length,
                p25: null,
                medianP50: null,
                p75: null,
                p90: null,
                statusMessageEs: `[Cohorte insuficiente: ${distinctTenants.size}/${MIN_K_ANONYMITY_TENANTS} faenas distintas requeridas para k-anonimato]`,
            };
        }

        const sorted = [...values].sort((a, b) => a - b);
        return {
            targetCanonicalId,
            metricKind,
            unitSi: unitSi || 'SI',
            kAnonymityMet: true,
            requiredMinTenants: MIN_K_ANONYMITY_TENANTS,
            distinctTenantsCount: distinctTenants.size,
            sampleSize: sorted.length,
            p25: percentileSorted(sorted, 0.25),
            medianP50: percentileSorted(sorted, 0.5),
            p75: percentileSorted(sorted, 0.75),
            p90: percentileSorted(sorted, 0.9),
            statusMessageEs: `Estadística empírica verificada sobre ${distinctTenants.size} faenas independientes (${sorted.length} muestras).`,
        };
    }

    /**
     * Semilla y consulta del Catálogo Universal de Materiales (`global_material_catalog`) para `STOCKPILE CONTROL`.
     */
    public static async listGlobalMaterialsCatalog(): Promise<CanonicalMaterialEntry[]> {
        const col = db.collection('global_material_catalog');
        if (!materialsSeededInMemory) {
            const check = await col.doc('mineral_rom_cobre_sulfurado').get();
            if (!check.exists) {
                const batch = db.batch();
                const nowIso = new Date().toISOString();
                for (const m of CANONICAL_MATERIALS_SEED) {
                    batch.set(col.doc(m.material_id), { ...m, updated_at: nowIso }, { merge: true });
                }
                await batch.commit();
            }
            materialsSeededInMemory = true;
        }

        const snap = await col.get();
        return snap.docs.map((d) => d.data() as CanonicalMaterialEntry);
    }
}
