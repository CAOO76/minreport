/**
 * MINREPORT · ABASTECIMIENTO — Motor Determinístico de Normalización de Unidades (SI)
 *
 * Convierte coloquialismos mineros y formatos de empaque chilenos/LatAm hacia
 * unidades canónicas del Sistema Internacional (`kg`, `L`, `un`, `par`, `m`, `m3`, `caja`, `bolsa`),
 * aplicando la Ley del Saco N° 20.949 (25 kg) y alias personalizados por tenant.
 */

import {
    CanonicalSupplySku,
    SupplyUnitSi,
    roundSupplyQty,
} from './types';
import { matchCanonicalSkuByText, normalizeCatalogText } from '../catalog/DefaultSupplyCatalogSeed';

export interface TenantUnitAlias {
    alias: string;
    canonicalSkuId?: string;
    factorToSi: number;
    unitSi: SupplyUnitSi;
    leySaco25kgApplied?: boolean;
}

export interface UnitNormalizationRule {
    pattern: string;
    canonicalSkuHint?: string;
    factorToSi: number;
    unitSi: SupplyUnitSi;
    leySaco25kgApplied?: boolean;
    packLabel: string;
}

export interface UnitNormalizationInput {
    quantity: number;
    unitRaw?: string;
    itemText?: string;
    sku?: CanonicalSupplySku;
    tenantAliases?: readonly TenantUnitAlias[];
}

export interface UnitNormalizationResult {
    originalQuantity: number;
    originalUnitRaw: string;
    quantitySi: number;
    unitSi: SupplyUnitSi;
    factorApplied: number;
    matchedAlias: string;
    leySaco25kgApplied: boolean;
    canonicalSkuHint?: string;
    isAmbiguous: boolean;
}

/**
 * Reglas determinísticas base para faenas mineras Chile/LatAm.
 * Ordenadas por especificidad de frase (longest-first).
 */
const BUILTIN_COMPOUND_UNIT_RULES: readonly UnitNormalizationRule[] = [
    // Ley del Saco N° 20.949 (límite legal de carga manual 25 kg en Chile)
    { pattern: 'malla de papas', canonicalSkuHint: 'SKU-VIV-PAPAS', factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, packLabel: 'malla (25 kg)' },
    { pattern: 'mallas de papas', canonicalSkuHint: 'SKU-VIV-PAPAS', factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, packLabel: 'malla (25 kg)' },
    { pattern: 'malla papas', canonicalSkuHint: 'SKU-VIV-PAPAS', factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, packLabel: 'malla (25 kg)' },
    { pattern: 'saco de papas', canonicalSkuHint: 'SKU-VIV-PAPAS', factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, packLabel: 'saco (25 kg)' },
    { pattern: 'sacos de papas', canonicalSkuHint: 'SKU-VIV-PAPAS', factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, packLabel: 'saco (25 kg)' },
    { pattern: 'malla de cebollas', canonicalSkuHint: 'SKU-VIV-CEBOLLAS', factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, packLabel: 'malla (25 kg)' },
    { pattern: 'mallas de cebollas', canonicalSkuHint: 'SKU-VIV-CEBOLLAS', factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, packLabel: 'malla (25 kg)' },
    { pattern: 'saco de cemento', canonicalSkuHint: 'SKU-FER-CEMENTO', factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, packLabel: 'saco (25 kg)' },
    { pattern: 'sacos de cemento', canonicalSkuHint: 'SKU-FER-CEMENTO', factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, packLabel: 'saco (25 kg)' },
    { pattern: 'saco cemento', canonicalSkuHint: 'SKU-FER-CEMENTO', factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, packLabel: 'saco (25 kg)' },

    // Alimentación campamento
    { pattern: 'bandeja de huevos', canonicalSkuHint: 'SKU-SUP-HUEVOS', factorToSi: 30, unitSi: 'un', packLabel: 'bandeja (30 un)' },
    { pattern: 'bandejas de huevos', canonicalSkuHint: 'SKU-SUP-HUEVOS', factorToSi: 30, unitSi: 'un', packLabel: 'bandeja (30 un)' },
    { pattern: 'carton de huevos', canonicalSkuHint: 'SKU-SUP-HUEVOS', factorToSi: 30, unitSi: 'un', packLabel: 'bandeja (30 un)' },
    { pattern: 'cartones de huevos', canonicalSkuHint: 'SKU-SUP-HUEVOS', factorToSi: 30, unitSi: 'un', packLabel: 'bandeja (30 un)' },
    { pattern: 'pote de mantequilla', canonicalSkuHint: 'SKU-SUP-MANTEQUILLA', factorToSi: 0.25, unitSi: 'kg', packLabel: 'pote (250 g)' },
    { pattern: 'potes de mantequilla', canonicalSkuHint: 'SKU-SUP-MANTEQUILLA', factorToSi: 0.25, unitSi: 'kg', packLabel: 'pote (250 g)' },
    { pattern: 'pan de mantequilla', canonicalSkuHint: 'SKU-SUP-MANTEQUILLA', factorToSi: 0.25, unitSi: 'kg', packLabel: 'pan (250 g)' },
    { pattern: 'panes de mantequilla', canonicalSkuHint: 'SKU-SUP-MANTEQUILLA', factorToSi: 0.25, unitSi: 'kg', packLabel: 'pan (250 g)' },
    { pattern: 'barra de mantequilla', canonicalSkuHint: 'SKU-SUP-MANTEQUILLA', factorToSi: 0.25, unitSi: 'kg', packLabel: 'barra (250 g)' },
    { pattern: 'paquete de tallarines', canonicalSkuHint: 'SKU-SUP-TALLARINES', factorToSi: 0.4, unitSi: 'kg', packLabel: 'paquete (400 g)' },
    { pattern: 'paquetes de tallarines', canonicalSkuHint: 'SKU-SUP-TALLARINES', factorToSi: 0.4, unitSi: 'kg', packLabel: 'paquete (400 g)' },
    { pattern: 'paquete de fideos', canonicalSkuHint: 'SKU-SUP-TALLARINES', factorToSi: 0.4, unitSi: 'kg', packLabel: 'paquete (400 g)' },
    { pattern: 'paquetes de fideos', canonicalSkuHint: 'SKU-SUP-TALLARINES', factorToSi: 0.4, unitSi: 'kg', packLabel: 'paquete (400 g)' },
    { pattern: 'caja de tomates', canonicalSkuHint: 'SKU-VIV-TOMATES', factorToSi: 18, unitSi: 'kg', packLabel: 'caja (18 kg)' },
    { pattern: 'cajas de tomates', canonicalSkuHint: 'SKU-VIV-TOMATES', factorToSi: 18, unitSi: 'kg', packLabel: 'caja (18 kg)' },

    // Gas licuado GLP
    { pattern: 'balon de 45', canonicalSkuHint: 'SKU-GAS-GLP45', factorToSi: 45, unitSi: 'kg', packLabel: 'balón GLP 45 kg' },
    { pattern: 'balones de 45', canonicalSkuHint: 'SKU-GAS-GLP45', factorToSi: 45, unitSi: 'kg', packLabel: 'balón GLP 45 kg' },
    { pattern: 'cilindro de 45', canonicalSkuHint: 'SKU-GAS-GLP45', factorToSi: 45, unitSi: 'kg', packLabel: 'cilindro GLP 45 kg' },
    { pattern: 'cilindros de 45', canonicalSkuHint: 'SKU-GAS-GLP45', factorToSi: 45, unitSi: 'kg', packLabel: 'cilindro GLP 45 kg' },
    { pattern: 'balon 45', canonicalSkuHint: 'SKU-GAS-GLP45', factorToSi: 45, unitSi: 'kg', packLabel: 'balón GLP 45 kg' },
    { pattern: 'gas de 45', canonicalSkuHint: 'SKU-GAS-GLP45', factorToSi: 45, unitSi: 'kg', packLabel: 'balón GLP 45 kg' },
    { pattern: 'balon de 15', canonicalSkuHint: 'SKU-GAS-GLP15', factorToSi: 15, unitSi: 'kg', packLabel: 'balón GLP 15 kg' },
    { pattern: 'balones de 15', canonicalSkuHint: 'SKU-GAS-GLP15', factorToSi: 15, unitSi: 'kg', packLabel: 'balón GLP 15 kg' },
    { pattern: 'cilindro de 15', canonicalSkuHint: 'SKU-GAS-GLP15', factorToSi: 15, unitSi: 'kg', packLabel: 'cilindro GLP 15 kg' },
    { pattern: 'cilindros de 15', canonicalSkuHint: 'SKU-GAS-GLP15', factorToSi: 15, unitSi: 'kg', packLabel: 'cilindro GLP 15 kg' },
    { pattern: 'balon 15', canonicalSkuHint: 'SKU-GAS-GLP15', factorToSi: 15, unitSi: 'kg', packLabel: 'balón GLP 15 kg' },
    { pattern: 'gas de 15', canonicalSkuHint: 'SKU-GAS-GLP15', factorToSi: 15, unitSi: 'kg', packLabel: 'balón GLP 15 kg' },
    { pattern: 'balon de 11', factorToSi: 11, unitSi: 'kg', packLabel: 'balón GLP 11 kg' },
    { pattern: 'balon de 5', factorToSi: 5, unitSi: 'kg', packLabel: 'balón GLP 5 kg' },

    // Agua, líquidos y lubricantes
    { pattern: 'bidon 20l', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'bidón 20 L' },
    { pattern: 'bidones 20l', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'bidón 20 L' },
    { pattern: 'bidon 20 l', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'bidón 20 L' },
    { pattern: 'bidones 20 l', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'bidón 20 L' },
    { pattern: 'bidon de 20l', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'bidón 20 L' },
    { pattern: 'bidones de 20l', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'bidón 20 L' },
    { pattern: 'bidon de 20', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'bidón 20 L' },
    { pattern: 'bidones de 20', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'bidón 20 L' },
    { pattern: 'bidon 20', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'bidón 20 L' },
    { pattern: 'bidones 20', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'bidón 20 L' },
    { pattern: 'bidon de agua', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'bidón 20 L' },
    { pattern: 'bidones de agua', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'bidón 20 L' },
    { pattern: 'botellon de agua', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'botellón 20 L' },
    { pattern: 'botellones de agua', canonicalSkuHint: 'SKU-AGUA-BIDON', factorToSi: 20, unitSi: 'L', packLabel: 'botellón 20 L' },
    { pattern: 'bidon 5l', factorToSi: 5, unitSi: 'L', packLabel: 'bidón 5 L' },
    { pattern: 'bidon 5 l', factorToSi: 5, unitSi: 'L', packLabel: 'bidón 5 L' },
    { pattern: 'bidon de 5l', factorToSi: 5, unitSi: 'L', packLabel: 'bidón 5 L' },
    { pattern: 'bidon de 5', factorToSi: 5, unitSi: 'L', packLabel: 'bidón 5 L' },
    { pattern: 'balde 20l', factorToSi: 20, unitSi: 'L', packLabel: 'balde 20 L' },
    { pattern: 'balde 20 l', factorToSi: 20, unitSi: 'L', packLabel: 'balde 20 L' },
    { pattern: 'balde de 20l', factorToSi: 20, unitSi: 'L', packLabel: 'balde 20 L' },
    { pattern: 'balde de 20', factorToSi: 20, unitSi: 'L', packLabel: 'balde 20 L' },
    { pattern: 'tambor 200l', factorToSi: 200, unitSi: 'L', packLabel: 'tambor 200 L' },
    { pattern: 'tambor de 200', factorToSi: 200, unitSi: 'L', packLabel: 'tambor 200 L' },

    // EPP calzado / guantes
    { pattern: 'bototos', canonicalSkuHint: 'SKU-EPP-BOTOTOS', factorToSi: 1, unitSi: 'par', packLabel: 'par EPP' },
    { pattern: 'bototo', canonicalSkuHint: 'SKU-EPP-BOTOTOS', factorToSi: 1, unitSi: 'par', packLabel: 'par EPP' },
    { pattern: 'zapatos de seguridad', canonicalSkuHint: 'SKU-EPP-BOTOTOS', factorToSi: 1, unitSi: 'par', packLabel: 'par EPP' },
    { pattern: 'zapato de seguridad', canonicalSkuHint: 'SKU-EPP-BOTOTOS', factorToSi: 1, unitSi: 'par', packLabel: 'par EPP' },
    { pattern: 'guantes de seguridad', canonicalSkuHint: 'SKU-EPP-GUANTES', factorToSi: 1, unitSi: 'par', packLabel: 'par EPP' },
    { pattern: 'guantes', canonicalSkuHint: 'SKU-EPP-GUANTES', factorToSi: 1, unitSi: 'par', packLabel: 'par EPP' },
];

interface SimpleUnitSpec {
    factorToSi: number;
    unitSi: SupplyUnitSi;
    leySaco25kgApplied?: boolean;
    label: string;
}

const SIMPLE_UNIT_MAP: Readonly<Record<string, SimpleUnitSpec>> = {
    // Masa
    kg: { factorToSi: 1, unitSi: 'kg', label: 'kg' },
    kilo: { factorToSi: 1, unitSi: 'kg', label: 'kg' },
    kilos: { factorToSi: 1, unitSi: 'kg', label: 'kg' },
    kilogramo: { factorToSi: 1, unitSi: 'kg', label: 'kg' },
    kilogramos: { factorToSi: 1, unitSi: 'kg', label: 'kg' },
    g: { factorToSi: 0.001, unitSi: 'kg', label: 'g' },
    gr: { factorToSi: 0.001, unitSi: 'kg', label: 'g' },
    gramo: { factorToSi: 0.001, unitSi: 'kg', label: 'g' },
    gramos: { factorToSi: 0.001, unitSi: 'kg', label: 'g' },
    t: { factorToSi: 1000, unitSi: 'kg', label: 'ton' },
    ton: { factorToSi: 1000, unitSi: 'kg', label: 'ton' },
    tonelada: { factorToSi: 1000, unitSi: 'kg', label: 'ton' },
    toneladas: { factorToSi: 1000, unitSi: 'kg', label: 'ton' },

    // Volumen
    l: { factorToSi: 1, unitSi: 'L', label: 'L' },
    lt: { factorToSi: 1, unitSi: 'L', label: 'L' },
    lts: { factorToSi: 1, unitSi: 'L', label: 'L' },
    litro: { factorToSi: 1, unitSi: 'L', label: 'L' },
    litros: { factorToSi: 1, unitSi: 'L', label: 'L' },
    ml: { factorToSi: 0.001, unitSi: 'L', label: 'ml' },
    cc: { factorToSi: 0.001, unitSi: 'L', label: 'cc' },
    m3: { factorToSi: 1, unitSi: 'm3', label: 'm3' },
    balde: { factorToSi: 20, unitSi: 'L', label: 'balde (20 L)' },
    baldes: { factorToSi: 20, unitSi: 'L', label: 'balde (20 L)' },
    tambor: { factorToSi: 200, unitSi: 'L', label: 'tambor (200 L)' },
    tambores: { factorToSi: 200, unitSi: 'L', label: 'tambor (200 L)' },

    // Longitud
    m: { factorToSi: 1, unitSi: 'm', label: 'm' },
    mt: { factorToSi: 1, unitSi: 'm', label: 'm' },
    mts: { factorToSi: 1, unitSi: 'm', label: 'm' },
    metro: { factorToSi: 1, unitSi: 'm', label: 'm' },
    metros: { factorToSi: 1, unitSi: 'm', label: 'm' },
    cm: { factorToSi: 0.01, unitSi: 'm', label: 'cm' },
    mm: { factorToSi: 0.001, unitSi: 'm', label: 'mm' },

    // Conteo / empaques chilenos
    un: { factorToSi: 1, unitSi: 'un', label: 'un' },
    und: { factorToSi: 1, unitSi: 'un', label: 'un' },
    u: { factorToSi: 1, unitSi: 'un', label: 'un' },
    unidad: { factorToSi: 1, unitSi: 'un', label: 'un' },
    unidades: { factorToSi: 1, unitSi: 'un', label: 'un' },
    docena: { factorToSi: 12, unitSi: 'un', label: 'docena' },
    docenas: { factorToSi: 12, unitSi: 'un', label: 'docena' },
    par: { factorToSi: 1, unitSi: 'par', label: 'par' },
    pares: { factorToSi: 1, unitSi: 'par', label: 'par' },
    bandeja: { factorToSi: 30, unitSi: 'un', label: 'bandeja (30 un)' },
    bandejas: { factorToSi: 30, unitSi: 'un', label: 'bandeja (30 un)' },
    pote: { factorToSi: 0.25, unitSi: 'kg', label: 'pote (250 g)' },
    potes: { factorToSi: 0.25, unitSi: 'kg', label: 'pote (250 g)' },
    pan: { factorToSi: 0.25, unitSi: 'kg', label: 'pan (250 g)' },
    panes: { factorToSi: 0.25, unitSi: 'kg', label: 'pan (250 g)' },
    malla: { factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, label: 'malla (25 kg Ley Saco)' },
    mallas: { factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, label: 'malla (25 kg Ley Saco)' },
    saco: { factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, label: 'saco (25 kg Ley Saco)' },
    sacos: { factorToSi: 25, unitSi: 'kg', leySaco25kgApplied: true, label: 'saco (25 kg Ley Saco)' },
    caja: { factorToSi: 1, unitSi: 'caja', label: 'caja' },
    cajas: { factorToSi: 1, unitSi: 'caja', label: 'caja' },
    bolsa: { factorToSi: 1, unitSi: 'bolsa', label: 'bolsa' },
    bolsas: { factorToSi: 1, unitSi: 'bolsa', label: 'bolsa' },
};

const SPANISH_NUMBER_WORDS: Readonly<Record<string, number>> = {
    un: 1,
    uno: 1,
    una: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
    quince: 15,
    veinte: 20,
    treinta: 30,
    medio: 0.5,
    media: 0.5,
};

function matchesPhrase(haystack: string, needle: string): boolean {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(haystack);
}

/**
 * Normaliza una cantidad y unidad/empaque coloquial hacia SI con 100% determinismo.
 */
export function normalizeQuantityToSi(input: UnitNormalizationInput): UnitNormalizationResult {
    const qty = Number.isFinite(input.quantity) && input.quantity > 0 ? input.quantity : 0;
    const rawUnitNormalized = normalizeCatalogText(input.unitRaw || '');
    const rawItemNormalized = normalizeCatalogText(input.itemText || '');
    const combinedText = [rawUnitNormalized, rawItemNormalized].filter(Boolean).join(' ').trim();

    // 1. Prioridad máxima: Alias personalizados del tenant (más largos primero)
    if (input.tenantAliases && input.tenantAliases.length > 0) {
        const sortedAliases = [...input.tenantAliases].sort(
            (a, b) => normalizeCatalogText(b.alias).length - normalizeCatalogText(a.alias).length
        );
        for (const aliasRule of sortedAliases) {
            const aliasNorm = normalizeCatalogText(aliasRule.alias);
            if (!aliasNorm) continue;
            if (
                aliasRule.canonicalSkuId &&
                input.sku &&
                aliasRule.canonicalSkuId !== input.sku.canonicalSkuId
            ) {
                continue;
            }
            if (matchesPhrase(combinedText, aliasNorm) || rawUnitNormalized === aliasNorm) {
                return {
                    originalQuantity: qty,
                    originalUnitRaw: input.unitRaw || aliasRule.alias,
                    quantitySi: roundSupplyQty(qty * aliasRule.factorToSi),
                    unitSi: aliasRule.unitSi,
                    factorApplied: aliasRule.factorToSi,
                    matchedAlias: aliasRule.alias,
                    leySaco25kgApplied: Boolean(aliasRule.leySaco25kgApplied),
                    canonicalSkuHint: aliasRule.canonicalSkuId || input.sku?.canonicalSkuId,
                    isAmbiguous: false,
                };
            }
        }
    }

    const effectiveSku = input.sku || matchCanonicalSkuByText(combinedText);

    // 2. Reglas compuestas de jerga minera chilena/LatAm (ej. "malla de papas", "balón de 45", "bidón 20L")
    const sortedRules = [...BUILTIN_COMPOUND_UNIT_RULES].sort(
        (a, b) => b.pattern.length - a.pattern.length
    );
    for (const rule of sortedRules) {
        if (
            rule.canonicalSkuHint &&
            effectiveSku &&
            rule.canonicalSkuHint !== effectiveSku.canonicalSkuId
        ) {
            continue;
        }
        if (matchesPhrase(combinedText, rule.pattern)) {
            // Si el usuario indicó explícitamente una unidad SI directa (ej. "2 kilos de papas"),
            // NO sobrescribir con factor de empaque compuesto a menos que la unidad raw sea el empaque.
            const simpleExplicit = SIMPLE_UNIT_MAP[rawUnitNormalized];
            const isExplicitDirectMetric =
                simpleExplicit &&
                ['kg', 'g', 'ton', 'L', 'ml', 'cc', 'm', 'cm', 'mm', 'm3', 'un', 'par'].includes(
                    simpleExplicit.label
                );

            if (!isExplicitDirectMetric) {
                return {
                    originalQuantity: qty,
                    originalUnitRaw: input.unitRaw || rule.packLabel,
                    quantitySi: roundSupplyQty(qty * rule.factorToSi),
                    unitSi: rule.unitSi,
                    factorApplied: rule.factorToSi,
                    matchedAlias: rule.packLabel,
                    leySaco25kgApplied: Boolean(rule.leySaco25kgApplied),
                    canonicalSkuHint: rule.canonicalSkuHint || effectiveSku?.canonicalSkuId,
                    isAmbiguous: false,
                };
            }
        }
    }

    // 3. Empaque específico del SKU canónico (ej. "paquete" en tallarines -> 0.4 kg, "bidon" en cloro -> 5 L, "bidon" en agua -> 20 L)
    if (effectiveSku?.defaultPackToSi && rawUnitNormalized) {
        const packNorm = normalizeCatalogText(effectiveSku.defaultPackToSi.packLabel);
        const packSingular = packNorm.split(' ')[0];
        if (
            rawUnitNormalized === packNorm ||
            rawUnitNormalized === packSingular ||
            rawUnitNormalized === `${packSingular}s` ||
            rawUnitNormalized === `${packSingular}es`
        ) {
            return {
                originalQuantity: qty,
                originalUnitRaw: input.unitRaw || effectiveSku.defaultPackToSi.packLabel,
                quantitySi: roundSupplyQty(qty * effectiveSku.defaultPackToSi.factorToSi),
                unitSi: effectiveSku.defaultPackToSi.unitSi,
                factorApplied: effectiveSku.defaultPackToSi.factorToSi,
                matchedAlias: effectiveSku.defaultPackToSi.packLabel,
                leySaco25kgApplied: Boolean(effectiveSku.leySaco25kgApplied),
                canonicalSkuHint: effectiveSku.canonicalSkuId,
                isAmbiguous: false,
            };
        }
    }

    // 3b. "bidon" / "botellon" sin volumen explícito ni metadata SKU: marcar ambiguo en vez de asumir 20 L hardcoded
    if (
        rawUnitNormalized === 'bidon' ||
        rawUnitNormalized === 'bidones' ||
        rawUnitNormalized === 'botellon' ||
        rawUnitNormalized === 'botellones'
    ) {
        return {
            originalQuantity: qty,
            originalUnitRaw: input.unitRaw || rawUnitNormalized,
            quantitySi: roundSupplyQty(qty),
            unitSi: effectiveSku?.baseUnitSi || 'un',
            factorApplied: 1,
            matchedAlias: rawUnitNormalized,
            leySaco25kgApplied: false,
            canonicalSkuHint: effectiveSku?.canonicalSkuId,
            isAmbiguous: true,
        };
    }

    // 4. Mapa de unidades simples (kg, L, bandeja, pote, saco, malla, etc.)
    const simpleUnit = SIMPLE_UNIT_MAP[rawUnitNormalized];
    if (simpleUnit) {
        // Caso especial: "pan" solo como producto (ej. "pan" sin unidad) vs "pan" como unidad de mantequilla
        if (
            (rawUnitNormalized === 'pan' || rawUnitNormalized === 'panes') &&
            effectiveSku?.canonicalSkuId === 'SKU-SUP-PAN'
        ) {
            return {
                originalQuantity: qty,
                originalUnitRaw: 'un',
                quantitySi: roundSupplyQty(qty),
                unitSi: 'un',
                factorApplied: 1,
                matchedAlias: 'un',
                leySaco25kgApplied: false,
                canonicalSkuHint: effectiveSku.canonicalSkuId,
                isAmbiguous: false,
            };
        }

        // Caso especial: "paquete" cuando hay SKU con empaque por defecto
        return {
            originalQuantity: qty,
            originalUnitRaw: input.unitRaw || simpleUnit.label,
            quantitySi: roundSupplyQty(qty * simpleUnit.factorToSi),
            unitSi: simpleUnit.unitSi,
            factorApplied: simpleUnit.factorToSi,
            matchedAlias: simpleUnit.label,
            leySaco25kgApplied: Boolean(simpleUnit.leySaco25kgApplied),
            canonicalSkuHint: effectiveSku?.canonicalSkuId,
            isAmbiguous: false,
        };
    }

    // 5. "paquete" / "paquetes" genérico
    if (rawUnitNormalized === 'paquete' || rawUnitNormalized === 'paquetes') {
        if (effectiveSku?.defaultPackToSi) {
            return {
                originalQuantity: qty,
                originalUnitRaw: input.unitRaw || 'paquete',
                quantitySi: roundSupplyQty(qty * effectiveSku.defaultPackToSi.factorToSi),
                unitSi: effectiveSku.defaultPackToSi.unitSi,
                factorApplied: effectiveSku.defaultPackToSi.factorToSi,
                matchedAlias: effectiveSku.defaultPackToSi.packLabel,
                leySaco25kgApplied: Boolean(effectiveSku.leySaco25kgApplied),
                canonicalSkuHint: effectiveSku.canonicalSkuId,
                isAmbiguous: false,
            };
        }
        return {
            originalQuantity: qty,
            originalUnitRaw: input.unitRaw || 'paquete',
            quantitySi: roundSupplyQty(qty),
            unitSi: 'un',
            factorApplied: 1,
            matchedAlias: 'paquete',
            leySaco25kgApplied: false,
            canonicalSkuHint: effectiveSku?.canonicalSkuId,
            isAmbiguous: true,
        };
    }

    // 6. Fallback a unidad base del SKU si existe
    const matchedSku = effectiveSku;
    if (matchedSku) {
        return {
            originalQuantity: qty,
            originalUnitRaw: input.unitRaw || matchedSku.baseUnitSi,
            quantitySi: roundSupplyQty(qty),
            unitSi: matchedSku.baseUnitSi,
            factorApplied: 1,
            matchedAlias: matchedSku.baseUnitSi,
            leySaco25kgApplied: Boolean(matchedSku.leySaco25kgApplied && /saco|malla/.test(combinedText)),
            canonicalSkuHint: matchedSku.canonicalSkuId,
            isAmbiguous: !rawUnitNormalized && matchedSku.requiredSlots.includes('packagingUnit'),
        };
    }

    return {
        originalQuantity: qty,
        originalUnitRaw: input.unitRaw || 'un',
        quantitySi: roundSupplyQty(qty),
        unitSi: 'un',
        factorApplied: 1,
        matchedAlias: rawUnitNormalized || 'un',
        leySaco25kgApplied: false,
        isAmbiguous: !rawUnitNormalized,
    };
}

export interface ParsedExpressionResult extends UnitNormalizationResult {
    hasExplicitQuantity: boolean;
    hasExplicitUnit: boolean;
    cleanedItemText: string;
}

/**
 * Parsea una expresión en lenguaje natural chileno (ej. "2 mallas de papas",
 * "1 balón de 45", "3 bandejas de huevos", "2 kilos de papas", "bidón 20L")
 * y la convierte determinísticamente a SI.
 */
export function normalizeUnitExpression(
    expression: string,
    options?: {
        sku?: CanonicalSupplySku;
        tenantAliases?: readonly TenantUnitAlias[];
        customCatalog?: readonly CanonicalSupplySku[];
    }
): ParsedExpressionResult {
    const decimalSafe = String(expression || '').replace(/(\d),(\d)/g, '$1.$2');
    const normalized = normalizeCatalogText(decimalSafe);
    const tokens = normalized.split(' ').filter(Boolean);

    let quantity = 1;
    let hasExplicitQuantity = false;
    let remainderStartIndex = 0;

    if (tokens.length > 0) {
        const numericMatch = tokens[0].replace(',', '.');
        if (/^\d+(\.\d+)?$/.test(numericMatch)) {
            quantity = Number(numericMatch);
            hasExplicitQuantity = true;
            remainderStartIndex = 1;
        } else if (SPANISH_NUMBER_WORDS[tokens[0]] !== undefined) {
            quantity = SPANISH_NUMBER_WORDS[tokens[0]];
            hasExplicitQuantity = true;
            remainderStartIndex = 1;
        }
    }

    const remainderTokens = tokens.slice(remainderStartIndex);
    const remainderText = remainderTokens.join(' ');
    const resolvedSku =
        options?.sku || matchCanonicalSkuByText(remainderText || normalized, options?.customCatalog);

    // Detectar si el primer token del resto es una unidad simple conocida (ej. "kilos de papas", "potes de mantequilla")
    let unitRaw = '';
    let hasExplicitUnit = false;
    let cleanedItemText = remainderText || normalized;

    // Verificar primero alias tenant y reglas compuestas antes de partir por token simple
    const tenantHit = options?.tenantAliases?.find((a) =>
        matchesPhrase(remainderText || normalized, normalizeCatalogText(a.alias))
    );
    const compoundHit = [...BUILTIN_COMPOUND_UNIT_RULES]
        .sort((a, b) => b.pattern.length - a.pattern.length)
        .find((r) => matchesPhrase(remainderText || normalized, r.pattern));

    if (tenantHit) {
        unitRaw = tenantHit.alias;
        hasExplicitUnit = true;
    } else if (
        remainderTokens.length >= 1 &&
        SIMPLE_UNIT_MAP[remainderTokens[0]] &&
        !(
            (remainderTokens[0] === 'pan' || remainderTokens[0] === 'panes') &&
            (remainderTokens.length === 1 || remainderTokens[1] !== 'de')
        )
    ) {
        // Verificar si es compuesto como "balon de 45" o "bidon 20l" (donde compoundHit tiene mayor especificidad)
        if (compoundHit && compoundHit.pattern.startsWith(remainderTokens[0])) {
            unitRaw = compoundHit.pattern;
            hasExplicitUnit = true;
        } else {
            unitRaw = remainderTokens[0];
            hasExplicitUnit = true;
            const afterUnit = remainderTokens.slice(1);
            cleanedItemText = afterUnit[0] === 'de' ? afterUnit.slice(1).join(' ') : afterUnit.join(' ');
        }
    } else if (
        remainderTokens[0] === 'paquete' ||
        remainderTokens[0] === 'paquetes' ||
        remainderTokens[0] === 'bidon' ||
        remainderTokens[0] === 'bidones' ||
        remainderTokens[0] === 'botellon' ||
        remainderTokens[0] === 'botellones'
    ) {
        if (compoundHit && compoundHit.pattern.startsWith(remainderTokens[0])) {
            unitRaw = compoundHit.pattern;
            hasExplicitUnit = true;
        } else {
            unitRaw = remainderTokens[0];
            hasExplicitUnit = true;
            const afterUnit = remainderTokens.slice(1);
            cleanedItemText = afterUnit[0] === 'de' ? afterUnit.slice(1).join(' ') : afterUnit.join(' ');
        }
    } else if (compoundHit) {
        unitRaw = compoundHit.pattern;
        hasExplicitUnit = true;
    }

    const result = normalizeQuantityToSi({
        quantity: hasExplicitQuantity ? quantity : 1,
        unitRaw,
        itemText: remainderText || normalized,
        sku: resolvedSku,
        tenantAliases: options?.tenantAliases,
    });

    return {
        ...result,
        hasExplicitQuantity,
        hasExplicitUnit,
        cleanedItemText: cleanedItemText || remainderText || normalized,
    };
}
