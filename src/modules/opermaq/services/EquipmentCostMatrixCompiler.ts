import crypto from 'crypto';
import type {
    AssetPhysicalTraits,
    EquipmentSupplyLineItem,
    OperationalCostMatrix,
    PillarDocument,
    PillarItem,
    SupplyItemFamily,
} from '../types/vault.types';
import {
    deriveEnergyConsumptionProfile,
    MISSING_FULL_TECH_SPEC,
} from '../utils/canonicalArchetypeSpecs';
import { inferAssetConfigurationProfile } from '../utils/lockedVariantDirective';
import { AssetOntologyEngine } from './AssetOntologyEngine';
import { VaultPersistenceService } from './VaultPersistenceService';

/**
 * EQUIPMENT COST MATRIX COMPILER v4.0 (NÓMINA CANÓNICA DE INSUMOS Y RECAMBIOS — ZERO-HALLUCINATION)
 *
 * Compila determinísticamente y sin intervención IA:
 * 1. `supply_items[]`: Nómina unificada, reconciliada y costeable de insumos y piezas de recambio ad-hoc.
 * 2. Campos legados (`periodic_fluids`, `periodic_filters_and_seals`, `wear_parts_get`,
 *    `tires_and_undercarriage`, `energy_consumption`, etc.) limpios y reconciliados para compatibilidad M2M x402.
 *
 * Reglas de Integridad GEMINI.md:
 * - Cero invención de códigos OEM, cantidades, presiones ni vidas útiles (`null` / marcador estándar cuando falte).
 * - Compuerta `Header-Aware`: descarta chequeos de inspección (`10 h`), muestreos `S·O·S`, tablas de graseras Zerk
 *   y pasos procedimentales; prohíbe contaminación cruzada (ej. aceros de perforación en minicargadores).
 */

export const COST_MATRIX_SCHEMA_VERSION = '4.0.0';

interface MarkdownTableRowParsed {
    headers: string[];
    cells: string[];
    sourceItemTitle: string;
    pillarId: 'ficha_tecnica' | 'pauta_mantencion';
}

interface TableColumnMap {
    actionIdx: number;
    intervalIdx: number;
    partNoIdx: number;
    qtyIdx: number;
    zerkIdx: number;
    capacityIdx: number;
    fluidOrSpecIdx: number;
    viscosityIdx: number;
    locationIdx: number;
    pressureIdx: number;
    condemnIdx: number;
    pmStageIdx: number;
}

function stripAccentsLower(raw: string): string {
    return String(raw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanMarkdownCell(raw: string): string {
    return String(raw || '')
        .replace(/\[F\d+(?:\s*,\s*F\d+)*\]/gi, '')
        .replace(/\[S[ÍI]MBOLO:[^\]]+\]/gi, '')
        .replace(/\[\s*sin\s+trazabilidad\s+directa\s*\]/gi, '')
        .replace(/\[\s*trazabilidad\s+directa\s+pendiente\s*\]/gi, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

function isMissingMarker(val: string | null | undefined): boolean {
    if (!val) return true;
    const norm = stripAccentsLower(val);
    return (
        norm.length === 0 ||
        norm === '-' ||
        norm === '—' ||
        norm === 'n/a' ||
        norm.includes('no declarada en ficha') ||
        norm.includes('no declarado en ficha') ||
        norm.includes('pendiente de registro') ||
        norm.includes('codigo de parte oem no declarado') ||
        norm.includes('no declarado en fuente') ||
        norm.includes('not declared in sheet') ||
        norm.includes('pending registration') ||
        norm.includes('nao declarada na ficha')
    );
}

function formatDecimalEs(val: number): string {
    if (!Number.isFinite(val)) return '0';
    if (val >= 100) {
        const rounded = Math.abs(val - Math.round(val)) < 0.05 ? Math.round(val) : Number(val.toFixed(1));
        const parts = String(rounded).split('.');
        const intFmt = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return parts.length > 1 ? `${intFmt},${parts[1]}` : intFmt;
    }
    if (val >= 10) {
        const fixed = val.toFixed(1).replace(/\.0$/, '');
        return fixed.replace('.', ',');
    }
    const fixed = val.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    return fixed.replace('.', ',');
}

function detectColumnMap(headers: string[]): TableColumnMap {
    return {
        actionIdx: headers.findIndex(
            (h) => /\b(acci[oó]n|tarea|operaci[oó]n)\b/i.test(h) && !/\b(compartimento|subsistema|componente|punto)\b/i.test(h)
        ),
        intervalIdx: headers.findIndex((h) =>
            /\b(intervalo|frecuencia|per[ií]odo|cadencia|vida\s+[uú]til|duraci[oó]n)\b/i.test(h)
        ),
        partNoIdx: headers.findIndex(
            (h) => /\b(c[oó]digo|n[°º]?\s*parte|part\s*number|oem)\b/i.test(h) && !/\b(criterio|verificaci[oó]n)\b/i.test(h)
        ),
        qtyIdx: headers.findIndex(
            (h) => /\b(cant(?:idad)?|dotaci[oó]n|unidades?|unid\.?)\b/i.test(h) && !/\bgraseras?\b/i.test(h)
        ),
        zerkIdx: headers.findIndex((h) => /\b(graseras?|zerk)\b/i.test(h)),
        capacityIdx: headers.findIndex((h) => /\b(capacidad|volumen|llenado)\b/i.test(h)),
        fluidOrSpecIdx: headers.findIndex(
            (h) =>
                /\b(fluido|insumo|norma|especificaci[oó]n|medida|compuesto|material)\b/i.test(h) &&
                !/\b(intervalo|frecuencia)\b/i.test(h)
        ),
        viscosityIdx: headers.findIndex((h) => /\b(viscosidad|grado|sae\s*\/\s*iso)\b/i.test(h)),
        locationIdx: headers.findIndex((h) =>
            /\b(ubicaci[oó]n|sistema|zona|[oó]rgano|aplicaci[oó]n|localizaci[oó]n|subconjunto)\b/i.test(h)
        ),
        pressureIdx: headers.findIndex((h) =>
            /\b(presi[oó]n|inflado|tensi[oó]n|torque|precarga|comba|par\s+de\s+apriete)\b/i.test(h)
        ),
        condemnIdx: headers.findIndex((h) =>
            /\b(condena|l[ií]mite|criterio\s+de\s+retiro|desgaste\s+m[aá]x|espesor\s+m[ií]n|profundidad\s+m[ií]n)\b/i.test(h)
        ),
        pmStageIdx: headers.findIndex((h) => /\b(etapa|pauta\s*pm|estadio)\b/i.test(h)),
    };
}

function isNonReplacementActionRow(row: MarkdownTableRowParsed, cols: TableColumnMap): boolean {
    const col0 = (row.cells[0] || '').trim();
    const joined = row.cells.join(' ');
    const joinedLower = stripAccentsLower(joined);

    // Excluir tablas de procedimientos paso-a-paso (| 01 | Preparación y Aislamiento... |)
    if (
        row.headers[0] &&
        /\b(paso|step|n[°º])\b/i.test(row.headers[0]) &&
        /^\d{1,3}$/.test(col0)
    ) {
        return true;
    }

    // Excluir filas de muestreo de aceite / refrigerante S·O·S y holgura de válvulas
    if (
        /\b(botella\s+de\s+muestreo|toma\s+de\s+muestra|holgura\s+de\s+v[aá]lvulas)\b/i.test(joinedLower) ||
        /^(?:inspeccion|revision|verificacion|chequeo|drenaje|purga|ajuste|calibracion|prueba)\b/i.test(
            stripAccentsLower(col0)
        )
    ) {
        return true;
    }

    const actionCell = cols.actionIdx !== -1 ? row.cells[cols.actionIdx] || '' : '';
    const actionNorm = stripAccentsLower(actionCell);
    const secondCellNorm = cols.actionIdx === -1 && row.cells.length > 1 ? stripAccentsLower(row.cells[1] || '') : '';
    const effectiveAction = actionNorm || secondCellNorm;

    if (effectiveAction) {
        if (/^s[·.\-]?o[·.\-]?s$/i.test(effectiveAction)) {
            return true;
        }
        const hasReplacementVerb = /\b(reemplazar|cambiar|renovar|sustituir|lubricar|engrasar)\b/i.test(effectiveAction);
        const isDpfCleaning =
            /^limpiar\b/i.test(effectiveAction) &&
            /\b(dpf|filtro\s+de\s+particulas|cenizas)\b/i.test(joinedLower);

        if (
            !hasReplacementVerb &&
            !isDpfCleaning &&
            /^(?:inspeccionar|revisar|verificar|chequear|controlar|drenar|purgar|calibrar|ajustar|medir|muestrear|limpiar|analisis)\b/i.test(
                effectiveAction
            )
        ) {
            return true;
        }
    }

    // En tabla de puntos de engrase Zerk, excluir drenajes manuales de agua
    if (/\bdrenaje\s+manual\b/i.test(joinedLower)) {
        return true;
    }

    return false;
}

function extractPrimaryChangeInterval(raw: string): {
    intervalText: string;
    intervalValue: number | null;
    intervalBasis: 'h' | 'km' | null;
    samplingNote: string | null;
    conditionNote: string | null;
} {
    const clean = cleanMarkdownCell(raw);
    if (isMissingMarker(clean)) {
        return {
            intervalText: MISSING_FULL_TECH_SPEC,
            intervalValue: null,
            intervalBasis: null,
            samplingNote: null,
            conditionNote: null,
        };
    }

    let samplingNote: string | null = null;
    const sosMatch = clean.match(/(?:\/\s*)?(\d[\d.,]*\s*h\s*\(\s*S[·.\-]?O[·.\-]?S[^)]*\))/i);
    if (sosMatch) {
        samplingNote = sosMatch[1].replace(/\s+/g, ' ').trim();
    }

    const withoutSos = clean
        .replace(/\/\s*\d[\d.,]*\s*h\s*\(\s*S[·.\-]?O[·.\-]?S[^)]*\)/gi, '')
        .replace(/\(\s*S[·.\-]?O[·.\-]?S[^)]*\)/gi, '')
        .trim();

    // Rangos como "10 h a 50 h" o "10-50 h"
    const rangeMatch = withoutSos.match(/^(\d+(?:\.\d{3})*)\s*(?:h\b|horas?)?\s*(?:a|-|–)\s*(\d+(?:\.\d{3})*)\s*(h\b|horas?|km\b)/i);
    if (rangeMatch) {
        const unit = rangeMatch[3].toLowerCase().startsWith('k') ? 'km' : 'h';
        return {
            intervalText: `${rangeMatch[1]}–${rangeMatch[2]} ${unit}`,
            intervalValue: null,
            intervalBasis: null,
            samplingNote,
            conditionNote: null,
        };
    }

    const singleMatch = withoutSos.match(
        /^(?:cada\s+)?(\d+(?:\.\d{3})*(?:[.,]\d+)?)\s*(h\b|hr|hrs|horas?|km\b)/i
    );
    if (singleMatch) {
        const num = parseFloat(singleMatch[1].replace(/\./g, '').replace(',', '.'));
        const basis: 'h' | 'km' = singleMatch[2].toLowerCase().startsWith('k') ? 'km' : 'h';
        const tail = withoutSos.slice(singleMatch[0].length).replace(/^[\s/·,-]+/, '').trim();
        const conditionNote = tail.length > 0 && !isMissingMarker(tail) ? tail : null;
        return {
            intervalText: Number.isFinite(num) ? `${formatDecimalEs(num)} ${basis}` : withoutSos,
            intervalValue: Number.isFinite(num) && num > 0 ? num : null,
            intervalBasis: basis,
            samplingNote,
            conditionNote,
        };
    }

    return {
        intervalText: withoutSos || clean,
        intervalValue: null,
        intervalBasis: null,
        samplingNote,
        conditionNote: null,
    };
}

function extractNumericQuantity(
    raw: string,
    perSideMultiplier = 1
): {
    displayQty: string;
    numericQty: number | null;
    qtyUnit: string | null;
} {
    const clean = cleanMarkdownCell(raw);
    if (isMissingMarker(clean)) {
        return { displayQty: MISSING_FULL_TECH_SPEC, numericQty: null, qtyUnit: null };
    }

    // Quitar equivalencias imperiales entre paréntesis para capturar siempre la magnitud SI primaria
    const withoutImperialParens = clean.replace(
        /\(\s*\d+(?:[.,]\d+)?\s*(?:gal|galones|qt|fl\s*oz|lb|in|ft)\b[^)]*\)/gi,
        ''
    );

    const qtyMatch = withoutImperialParens.match(
        /\b(\d+(?:[.,]\d+)?)\s*(L|litros?|ml|kg|g|unid\.?|unidades?|pzas?\.?|piezas?|juegos?|kits?|cartuchos?|neum[aá]ticos?|ruedas?)\b/i
    );
    if (qtyMatch) {
        const baseVal = parseFloat(qtyMatch[1].replace(',', '.'));
        const rawUnit = qtyMatch[2].toLowerCase();
        let unit = rawUnit;
        if (rawUnit === 'l' || rawUnit.startsWith('litro')) unit = 'L';
        else if (rawUnit === 'ml') unit = 'mL';
        else if (rawUnit === 'kg') unit = 'kg';
        else if (rawUnit === 'g') unit = 'g';
        else if (
            rawUnit.startsWith('unid') ||
            rawUnit.startsWith('pza') ||
            rawUnit.startsWith('pieza') ||
            rawUnit.startsWith('neum') ||
            rawUnit.startsWith('rueda')
        ) {
            unit = 'unid.';
        } else if (rawUnit.startsWith('juego')) unit = 'juego';
        else if (rawUnit.startsWith('kit')) unit = 'kit';
        else if (rawUnit.startsWith('cartucho')) unit = 'cartucho';

        if (Number.isFinite(baseVal) && baseVal > 0) {
            const total = Number((baseVal * perSideMultiplier).toFixed(3));
            const displayQty =
                perSideMultiplier > 1
                    ? `${formatDecimalEs(total)} ${unit} (${perSideMultiplier} × ${formatDecimalEs(baseVal)} ${unit})`
                    : `${formatDecimalEs(total)} ${unit}`;
            return { displayQty, numericQty: total, qtyUnit: unit };
        }
    }

    const pureInt = clean.match(/^(\d{1,3})$/);
    if (pureInt) {
        const val = parseInt(pureInt[1], 10);
        if (Number.isFinite(val) && val > 0) {
            return { displayQty: `${val} unid.`, numericQty: val, qtyUnit: 'unid.' };
        }
    }

    return { displayQty: clean, numericQty: null, qtyUnit: null };
}

function computeNormalizedRatePer1000h(params: {
    numericQty: number | null;
    qtyUnit: string | null;
    intervalValue: number | null;
    intervalBasis: 'h' | 'km' | 'ciclos' | 'L/h' | 'km/L' | 'kWh/h' | 'continuo' | null;
    eventLabelPlural?: string;
    eventLabelSingular?: string;
}): {
    proratedText: string | null;
    numericRate: number | null;
} {
    const {
        numericQty,
        qtyUnit,
        intervalValue,
        intervalBasis,
        eventLabelPlural = 'cambios',
        eventLabelSingular = 'cambio',
    } = params;

    if (intervalBasis === 'L/h' && intervalValue && intervalValue > 0) {
        const rate = Number((intervalValue * 1000).toFixed(2));
        return {
            proratedText: `${formatDecimalEs(rate)} L / 1.000 h`,
            numericRate: rate,
        };
    }

    if (intervalBasis === 'kWh/h' && intervalValue && intervalValue > 0) {
        const rate = Number((intervalValue * 1000).toFixed(2));
        return {
            proratedText: `${formatDecimalEs(rate)} kWh / 1.000 h`,
            numericRate: rate,
        };
    }

    if (intervalBasis !== 'h' || !intervalValue || intervalValue <= 0) {
        return { proratedText: null, numericRate: null };
    }

    const cyclesPer1000 = 1000 / intervalValue;
    if (numericQty !== null && numericQty > 0 && qtyUnit) {
        const rate = Number((numericQty * cyclesPer1000).toFixed(3));
        return {
            proratedText: `${formatDecimalEs(rate)} ${qtyUnit} / 1.000 h`,
            numericRate: rate,
        };
    }

    const rate = Number(cyclesPer1000.toFixed(3));
    const unitWord = Math.abs(rate - 1) < 0.001 ? eventLabelSingular : eventLabelPlural;
    return {
        proratedText: `${formatDecimalEs(rate)} ${unitWord} / 1.000 h`,
        numericRate: rate,
    };
}

function extractValidOemPartNumber(raw: string, fromExplicitPartCol: boolean): string | null {
    const clean = cleanMarkdownCell(raw);
    if (isMissingMarker(clean)) return null;

    // Prohibir que intervalos horarios o distancias contaminen jamás un número de parte OEM
    if (/\b\d[\d.,]*\s*(?:h\b|hr|hrs|horas?|km\b|diario|semanal|mensual|a[ñn]os?|l\b|litros?|gal)\b/i.test(clean)) {
        return null;
    }
    if (!/\d/.test(clean)) return null;

    const codeMatch = clean.match(
        /\b(\d{3,4}[-]\d{3,4}|(?:LF|FF|FS|AF|HF|WF|CV|RE|AR|DZ|P)\d{4,6}|(?=.*\d)[A-Z0-9]{2,6}[-][A-Z0-9]{2,10})\b/
    );
    if (codeMatch) return codeMatch[1];

    if (fromExplicitPartCol && clean.length <= 48 && !/\s{2,}/.test(clean) && /^[A-Z0-9][A-Z0-9.\-/ ]*[A-Z0-9]$/i.test(clean)) {
        return clean;
    }

    return null;
}

function splitFluidSpecAndCapacity(raw: string): {
    specPart: string | null;
    viscosityPart: string | null;
    capacityPart: string | null;
} {
    const clean = cleanMarkdownCell(raw);
    if (isMissingMarker(clean)) {
        return { specPart: null, viscosityPart: null, capacityPart: null };
    }

    const viscMatch = clean.match(
        /\b((?:SAE\s*)?\d+W[-/]\d+|SAE\s*\d+|ISO\s*VG\s*\d+|NLGI\s*#?\d+(?:\.\d+)?|DOT\s*[345](?:\.1)?)\b/i
    );
    const viscosityPart = viscMatch ? viscMatch[1].toUpperCase() : null;

    const capMatch = clean.match(
        /\b\d+(?:[.,]\d+)?\s*(?:L\b|litros?|kg|ml|g)(?:\s*\([^)]*\))?(?:\s+por\s+lado)?/i
    );
    const capacityPart = capMatch ? capMatch[0].trim() : null;

    let specPart = clean;
    if (capacityPart) {
        specPart = specPart.replace(capacityPart, '').trim();
    }
    specPart = specPart.replace(/^[,;\s]+|[,;\s]+$/g, '').trim();

    if (/^(?:reemplazar|cambiar|inspeccionar|lubricar|engrasar|s[·.\-]?o[·.\-]?s)$/i.test(specPart)) {
        specPart = '';
    }

    return {
        specPart: specPart && !isMissingMarker(specPart) ? specPart : null,
        viscosityPart,
        capacityPart,
    };
}

function extractFluidFingerprintTokens(specText: string): {
    brandFamilies: string[];
    viscosityGrades: string[];
} {
    const norm = stripAccentsLower(specText).toUpperCase();
    const brandFamilies = Array.from(
        new Set(
            (
                norm.match(
                    /\b(DEO-ULS|TDTO|TO-4|HYDO(?:\s+ADVANCED\s*\d+)?|FDAO|ELC|OAT|ULSD|ADBLUE|DEF|GL-4|GL-5|DOT\s*[345]|ATF|DEXRON|MERCON|3MOLY|MOS2|UTILITY|MULTIPURPOSE|VDS-4(?:\.5)?|CES\s*\d+)\b/g
                ) || []
            ).map((s) => s.replace(/\s+/g, ' ').trim())
        )
    );
    const viscosityGrades = Array.from(
        new Set(
            (
                norm.match(
                    /\b((?:SAE\s*)?\d{1,2}W[-/]\d{2}|SAE\s*(?:10W|15W|30|40|50)|ISO\s*VG\s*\d{2,3}|NLGI\s*#?\d)\b/g
                ) || []
            ).map((s) => s.replace(/\s+/g, ' ').trim())
        )
    );
    return { brandFamilies, viscosityGrades };
}

function detectFluidSpecConflict(specA: string, viscA: string, specB: string, viscB: string): string | null {
    const labelA = [specA, viscA].filter((s) => s && !isMissingMarker(s)).join(' · ');
    const labelB = [specB, viscB].filter((s) => s && !isMissingMarker(s)).join(' · ');
    if (!labelA || !labelB) return null;

    const fpA = extractFluidFingerprintTokens(labelA);
    const fpB = extractFluidFingerprintTokens(labelB);

    const hasFamilyA = fpA.brandFamilies.length > 0;
    const hasFamilyB = fpB.brandFamilies.length > 0;
    const familyOverlap = fpA.brandFamilies.some((t) => fpB.brandFamilies.includes(t));

    // Compatibilidad explícita ISO VG 46 == SAE 10W en hidráulicos HYDO
    const normVisc = (v: string) => (v === 'ISO VG 46' || v === 'SAE 10W' ? 'HYD_10W_VG46' : v);
    const vSetA = fpA.viscosityGrades.map(normVisc);
    const vSetB = fpB.viscosityGrades.map(normVisc);
    const viscConflict = vSetA.length > 0 && vSetB.length > 0 && !vSetA.some((v) => vSetB.includes(v));

    if ((hasFamilyA && hasFamilyB && !familyOverlap) || viscConflict) {
        return `${labelA} ≠ ${labelB}`;
    }
    return null;
}

/**
 * Verifica que un capítulo haya sido efectivamente cazado (`content_status === 'COMPLETADO'` o equivalente con contenido verificado)
 * y no esté descartado ni pendiente.
 */
export function isVerifiedHuntedPillarItem(item: PillarItem | null | undefined): boolean {
    if (!item || item.is_discarded) return false;
    if (typeof item.content !== 'string' || item.content.trim().length === 0) return false;
    if (item.content_status === 'PENDIENTE' || item.content_status === 'ERROR' || item.content_status === 'GENERANDO') {
        return false;
    }
    return true;
}

/**
 * Extrae todas las filas de tablas Markdown (`| A | B | C |`) de una lista de capítulos (`PillarItem[]`)
 * que ya han sido efectivamente cazados.
 */
export function extractMarkdownTableRowsFromItems(
    items: PillarItem[],
    pillarId: 'ficha_tecnica' | 'pauta_mantencion'
): MarkdownTableRowParsed[] {
    const rows: MarkdownTableRowParsed[] = [];

    for (const item of items) {
        if (!isVerifiedHuntedPillarItem(item)) continue;

        const lines = item.content!.split(/\r?\n/);
        let currentHeaders: string[] = [];
        let inTable = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.startsWith('|') || !line.endsWith('|')) {
                if (inTable && !line.startsWith('|')) {
                    inTable = false;
                    currentHeaders = [];
                }
                continue;
            }

            const rawCells = line
                .slice(1, -1)
                .split('|')
                .map((c) => cleanMarkdownCell(c));

            if (rawCells.every((c) => /^[:\-\s]+$/.test(c))) {
                inTable = true;
                continue;
            }

            const nextLine = (lines[i + 1] || '').trim();
            if (
                nextLine.startsWith('|') &&
                nextLine
                    .slice(1, -1)
                    .split('|')
                    .every((c) => /^[:\-\s]+$/.test(c.trim()))
            ) {
                currentHeaders = rawCells.map((h) => h.toLowerCase());
                inTable = true;
                continue;
            }

            if (inTable && rawCells.some((c) => c.length > 0)) {
                rows.push({
                    headers: currentHeaders,
                    cells: rawCells,
                    sourceItemTitle: item.title,
                    pillarId,
                });
            }
        }
    }

    return rows;
}

function computeLinearHourlyDepreciationIfPossible(
    capexUsdStr: string | null,
    lifeHoursStr: string | null,
    residualPctStr: string | null
): string | null {
    if (isMissingMarker(capexUsdStr) || isMissingMarker(lifeHoursStr) || isMissingMarker(residualPctStr)) {
        return null;
    }

    const usdClean = String(capexUsdStr).replace(/US\$|USD|\$/gi, '').trim();
    const numMatches = usdClean.match(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g);
    if (!numMatches || numMatches.length === 0) return null;

    const parseMoney = (s: string): number => {
        const cleaned = s.replace(/\.(?=\d{3}\b)/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
        return parseFloat(cleaned);
    };

    const usdValues = numMatches.map(parseMoney).filter((n) => Number.isFinite(n) && n >= 100);
    if (usdValues.length === 0) return null;
    const avgCapex = usdValues.reduce((a, b) => a + b, 0) / usdValues.length;

    const hoursMatches = String(lifeHoursStr).match(/\d{1,3}(?:[.,]\d{3})+|\d{3,6}/g);
    if (!hoursMatches || hoursMatches.length === 0) return null;
    const hoursValues = hoursMatches
        .map((h) => parseFloat(h.replace(/\./g, '').replace(/,/g, '')))
        .filter((n) => Number.isFinite(n) && n >= 500);
    if (hoursValues.length === 0) return null;
    const avgHours = hoursValues.reduce((a, b) => a + b, 0) / hoursValues.length;

    const pctMatch = String(residualPctStr).match(/(\d{1,2}(?:[.,]\d+)?)\s*%/);
    if (!pctMatch) return null;
    const pct = parseFloat(pctMatch[1].replace(',', '.'));
    if (!Number.isFinite(pct) || pct < 0 || pct >= 90) return null;
    const residualFraction = pct / 100;

    const hourlyUsd = (avgCapex * (1 - residualFraction)) / avgHours;
    if (!Number.isFinite(hourlyUsd) || hourlyUsd <= 0) return null;

    return `${hourlyUsd.toFixed(2).replace('.', ',')} USD/h`;
}

/**
 * Calcula el digest determinista SHA-256 sobre capítulos cazados + rasgos ontológicos resueltos.
 */
export function computeCostMatrixSourceDigest(params: {
    assetData: Record<string, any>;
    fichaDoc?: PillarDocument | null;
    mantencionDoc?: PillarDocument | null;
    traits?: AssetPhysicalTraits;
}): string | null {
    const fichaItems = Array.isArray(params.fichaDoc?.items)
        ? params.fichaDoc!.items.filter((i) => isVerifiedHuntedPillarItem(i))
        : [];
    const mantItems = Array.isArray(params.mantencionDoc?.items)
        ? params.mantencionDoc!.items.filter((i) => isVerifiedHuntedPillarItem(i))
        : [];

    if (fichaItems.length === 0 && mantItems.length === 0) {
        return null;
    }

    const resolvedTraits =
        params.traits ||
        AssetOntologyEngine.inferAssetPhysicalTraits({
            type_key: params.assetData.equipment_type_key,
            canonical_type_es: params.assetData.tipo_equipo,
            categoria_equipo: params.assetData.categoria_equipo,
            archetype_id: params.assetData.archetype_id,
            make_oficial: params.assetData.make_oficial || params.assetData.make,
            model_oficial: params.assetData.model_oficial || params.assetData.model,
            caracteristicas_principales: params.assetData.caracteristicas_principales,
            ambiente_operativo: params.assetData.ambiente_operativo,
            contexto_operativo: params.assetData.contexto_operativo,
            existing_traits: params.assetData.physical_traits,
        });

    const fichaMarkdown = fichaItems.map((i) => `### ${i.title}\n${i.content || ''}`).join('\n\n');
    const mantMarkdown = mantItems.map((i) => `### ${i.title}\n${i.content || ''}`).join('\n\n');
    const seed = `${COST_MATRIX_SCHEMA_VERSION}\n${JSON.stringify(resolvedTraits)}\n${fichaMarkdown}\n===MANT===\n${mantMarkdown}`;
    return crypto.createHash('sha256').update(seed).digest('hex');
}

function resolveCanonicalFluidEntry(compartmentRaw: string): {
    key: string;
    itemName: string;
    subsystem: string;
    family: Extract<SupplyItemFamily, 'LUBRICANTE' | 'REFRIGERANTE' | 'GRASA'>;
    isDualSide: boolean;
    isTotalCircuit: boolean;
} {
    const n = stripAccentsLower(compartmentRaw);
    const parenMatch = compartmentRaw.match(/\(([^)]+)\)/);
    const parenDetail = parenMatch && !/^(?:total|por\s+lado|transmisi[oó]n)$/i.test(parenMatch[1].trim())
        ? parenMatch[1].trim()
        : null;

    if (/\b(carter|aceite\s+de\s+motor)\b/.test(n)) {
        return {
            key: 'fluid_engine_oil',
            itemName: 'Aceite de Motor',
            subsystem: parenDetail ? `Cárter (${parenDetail})` : 'Cárter de Motor',
            family: 'LUBRICANTE',
            isDualSide: false,
            isTotalCircuit: false,
        };
    }
    if (/\b(caja(?:s)?\s+de\s+cadenas?|mando(?:s)?\s+de\s+cadenas?|chain\s*cases?)\b/.test(n)) {
        return {
            key: 'fluid_chain_cases',
            itemName: 'Aceite de Cajas de Cadenas',
            subsystem: 'Transmisión Final (Izq. + Der.)',
            family: 'LUBRICANTE',
            isDualSide: true,
            isTotalCircuit: false,
        };
    }
    if (/\b(tanque\s+hidraulic|sistema\s+hidraulic|circuito\s+hidraulic|aceite\s+hidraulic)\b/.test(n)) {
        return {
            key: 'fluid_hydraulic_oil',
            itemName: 'Aceite Hidráulico e Hidrostático',
            subsystem: 'Sistema Hidráulico / Tanque',
            family: 'LUBRICANTE',
            isDualSide: false,
            isTotalCircuit: /\b(total)\b/i.test(n),
        };
    }
    if (/\b(enfriamiento|refrigerante|coolant)\b/.test(n)) {
        return {
            key: 'fluid_coolant',
            itemName: 'Refrigerante de Motor',
            subsystem: 'Sistema de Enfriamiento',
            family: 'REFRIGERANTE',
            isDualSide: false,
            isTotalCircuit: false,
        };
    }
    if (/\b(articulaci[oó]n|puntos?\s+de\s+engrase|grasa|pasador)\b/.test(n)) {
        return {
            key: 'fluid_grease',
            itemName: 'Grasa de Articulaciones y Pasadores',
            subsystem: 'Brazos, Cilindros y Acoplador',
            family: 'GRASA',
            isDualSide: false,
            isTotalCircuit: false,
        };
    }
    if (/\b(caja\s+de\s+cambios|servotransmisi[oó]n|transmisi[oó]n)\b/.test(n)) {
        return {
            key: 'fluid_transmission',
            itemName: 'Aceite de Transmisión',
            subsystem: compartmentRaw,
            family: 'LUBRICANTE',
            isDualSide: false,
            isTotalCircuit: false,
        };
    }
    if (/\b(diferencial\s+delantero|eje\s+delantero)\b/.test(n)) {
        return {
            key: 'fluid_front_axle',
            itemName: 'Aceite de Eje / Diferencial Delantero',
            subsystem: compartmentRaw,
            family: 'LUBRICANTE',
            isDualSide: false,
            isTotalCircuit: false,
        };
    }
    if (/\b(diferencial\s+trasero|eje\s+trasero)\b/.test(n)) {
        return {
            key: 'fluid_rear_axle',
            itemName: 'Aceite de Eje / Diferencial Trasero',
            subsystem: compartmentRaw,
            family: 'LUBRICANTE',
            isDualSide: false,
            isTotalCircuit: false,
        };
    }
    if (/\b(mando(?:s)?\s+final(?:es)?|cubo(?:s)?\s+reductor(?:es)?)\b/.test(n)) {
        return {
            key: 'fluid_final_drives',
            itemName: 'Aceite de Mandos Finales',
            subsystem: compartmentRaw,
            family: 'LUBRICANTE',
            isDualSide: /\bpor\s+lado\b/i.test(n),
            isTotalCircuit: false,
        };
    }
    if (/\b(diferencial|eje\s+motriz)\b/.test(n)) {
        return {
            key: 'fluid_differential',
            itemName: 'Aceite de Diferenciales / Ejes',
            subsystem: compartmentRaw,
            family: 'LUBRICANTE',
            isDualSide: false,
            isTotalCircuit: false,
        };
    }

    const family: Extract<SupplyItemFamily, 'LUBRICANTE' | 'REFRIGERANTE' | 'GRASA'> = /\brefrigerante\b/.test(n)
        ? 'REFRIGERANTE'
        : /\bgrasa\b/.test(n)
        ? 'GRASA'
        : 'LUBRICANTE';
    return {
        key: `fluid_${n.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
        itemName: compartmentRaw,
        subsystem: compartmentRaw,
        family,
        isDualSide: /\bpor\s+lado\b/i.test(n),
        isTotalCircuit: false,
    };
}

function canonicalizeFilterOrPartKey(name: string): {
    key: string;
    isDpfService: boolean;
} {
    const n = stripAccentsLower(name);
    if (/\b(dpf|particulas\s+diesel)\b/.test(n)) {
        return { key: 'postratamiento_dpf', isDpfService: true };
    }
    if (/\b(adblue|def|scr)\b/.test(n) && /\bfiltro\b/.test(n)) {
        return { key: 'filtro_def_adblue', isDpfService: false };
    }
    if (/\b(respiradero|breather|secador\s+de\s+aire)\b/.test(n)) {
        return {
            key: /\bhidraulic/.test(n) ? 'respiradero_hidraulico' : 'respiradero_sistema',
            isDpfService: false,
        };
    }
    if (/\baceite\b/.test(n) && /\bmotor\b/.test(n)) {
        return { key: 'filtro_aceite_motor', isDpfService: false };
    }
    if (/\btransmisi[oó]n\b/.test(n) && !/\bhidraulic/.test(n)) {
        return { key: 'filtro_aceite_transmision', isDpfService: false };
    }
    if (/\bhidraulic|hidrostatic/.test(n)) {
        return { key: 'filtro_hidraulico', isDpfService: false };
    }
    if (/\b(combustible|diesel|separador\s+de\s+agua)\b/.test(n)) {
        if (/\bsecundario|en\s+linea|fino\b/.test(n)) {
            return { key: 'filtro_combustible_secundario', isDpfService: false };
        }
        return { key: 'filtro_combustible_primario', isDpfService: false };
    }
    if (/\baire\b/.test(n) && /\b(cabina|hvac|habitaculo|acondicionado)\b/.test(n)) {
        return { key: 'filtro_cabina_hvac', isDpfService: false };
    }
    if (/\baire\b/.test(n) && /\b(secundario|seguridad|interno)\b/.test(n)) {
        return { key: 'filtro_aire_secundario', isDpfService: false };
    }
    if (/\baire\b/.test(n)) {
        return { key: 'filtro_aire_primario', isDpfService: false };
    }
    return {
        key: `part_${n.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
        isDpfService: false,
    };
}

/**
 * Compila de forma pura y determinista la `OperationalCostMatrix v4.0` EXCLUSIVAMENTE a partir de
 * los capítulos efectivamente cazados en `01 · Ficha Técnica OEM` y `03 · Pauta de Mantención`.
 */
export function compileEquipmentCostMatrixFromPillars(params: {
    assetData: Record<string, any>;
    fichaDoc?: PillarDocument | null;
    mantencionDoc?: PillarDocument | null;
}): OperationalCostMatrix {
    const { assetData, fichaDoc, mantencionDoc } = params;

    const traits = AssetOntologyEngine.inferAssetPhysicalTraits({
        type_key: assetData.equipment_type_key,
        canonical_type_es: assetData.tipo_equipo,
        categoria_equipo: assetData.categoria_equipo,
        archetype_id: assetData.archetype_id,
        make_oficial: assetData.make_oficial || assetData.make,
        model_oficial: assetData.model_oficial || assetData.model,
        caracteristicas_principales: assetData.caracteristicas_principales,
        ambiente_operativo: assetData.ambiente_operativo,
        contexto_operativo: assetData.contexto_operativo,
        existing_traits: assetData.physical_traits,
    });
    const taxonomyMeta = AssetOntologyEngine.buildDynamicCostMatrixTaxonomy(traits, assetData.tipo_equipo);

    const fichaItems = Array.isArray(fichaDoc?.items)
        ? fichaDoc!.items.filter((i) => isVerifiedHuntedPillarItem(i))
        : [];
    const mantItems = Array.isArray(mantencionDoc?.items)
        ? mantencionDoc!.items.filter((i) => isVerifiedHuntedPillarItem(i))
        : [];

    const fichaMarkdown = fichaItems.map((i) => `### ${i.title}\n${i.content || ''}`).join('\n\n');
    const sourceMerkleRoot = computeCostMatrixSourceDigest({
        assetData,
        fichaDoc,
        mantencionDoc,
        traits,
    });

    const fichaRows = extractMarkdownTableRowsFromItems(fichaItems, 'ficha_tecnica');
    const mantRows = extractMarkdownTableRowsFromItems(mantItems, 'pauta_mantencion');

    const configProfile = inferAssetConfigurationProfile({
        make_oficial: assetData.make_oficial || assetData.make,
        model_oficial: assetData.model_oficial || assetData.model,
        tipo_equipo: assetData.tipo_equipo,
        categoria_equipo: assetData.categoria_equipo,
        version: assetData.version,
        physical_traits: traits,
        canonical_specs: assetData.canonical_specs,
        caracteristicas_principales: Array.isArray(assetData.caracteristicas_principales)
            ? assetData.caracteristicas_principales
            : typeof assetData.caracteristicas_principales === 'string' && assetData.caracteristicas_principales
            ? [assetData.caracteristicas_principales]
            : undefined,
        chassis_versions: assetData.chassis_versions,
        existing_profile: assetData.configuration_profile,
    });

    // ── 1. CAPEX Y DOTACIÓN BASE EN FICHA ────────────────────────────────────
    let referenceNewPriceUsd: string | null = null;
    let referenceNewPriceClp: string | null = null;
    let priceConditionAndYear: string | null = null;
    let economicLifeHours: string | null = null;
    let economicLifeKm: string | null = null;
    let economicLifeYears: string | null = null;
    let residualValuePct: string | null = null;
    let hourlyDepreciationBase: string | null = null;
    let factoryTireOrTrackEquip: string | null = null;
    let factoryWorkToolEquip: string | null = null;
    let capexSourceItemTitle: string | null = null;
    let engineModelFromFicha: string | null = null;
    let fuelSpecFromMant: string | null = null;

    for (const row of fichaRows) {
        const paramCol = (row.cells[0] || '').toLowerCase();
        const valCol = row.cells[1] || '';
        const extraCol = row.cells.slice(2).join(' · ');
        const combinedVal = [valCol, extraCol].filter((x) => !isMissingMarker(x)).join(' · ');
        if (isMissingMarker(valCol)) continue;

        if (/\bmodelo\s+de\s+motor\b/i.test(paramCol) && !engineModelFromFicha) {
            engineModelFromFicha = valCol;
        }

        if (/\b(capex|costo\s+referencial|precio\s+(?:referencial|equipo\s+nuevo|lista|fob)|valor\s+reposici[oó]n)\b/i.test(paramCol)) {
            if (/\b(usd|us\$|\$)\b/i.test(combinedVal) && !referenceNewPriceUsd) {
                referenceNewPriceUsd = valCol;
                capexSourceItemTitle = row.sourceItemTitle;
            }
            if (/\b(clp|uf|pesos)\b/i.test(combinedVal) && !referenceNewPriceClp) {
                referenceNewPriceClp = valCol;
                capexSourceItemTitle = capexSourceItemTitle || row.sourceItemTitle;
            }
            if (!referenceNewPriceUsd && !referenceNewPriceClp) {
                referenceNewPriceUsd = valCol;
                capexSourceItemTitle = row.sourceItemTitle;
            }
            if (!priceConditionAndYear && extraCol && !isMissingMarker(extraCol)) {
                priceConditionAndYear = extraCol;
            }
        } else if (/\b(condici[oó]n\s+comercial|incoterm|a[ñn]o\s+referencia)\b/i.test(paramCol) && !priceConditionAndYear) {
            priceConditionAndYear = valCol;
        } else if (/\b(vida\s+[uú]til\s+econ[oó]mica|horizonte\s+econ[oó]mico|vida\s+econ[oó]mica|vida\s+[uú]til\s+nominal\s+antes\s+de\s+overhaul)\b/i.test(paramCol)) {
            if (/\b\d[\d.,]*\s*(?:h\b|hr|hrs|horas)\b/i.test(combinedVal) && !economicLifeHours) {
                const m = combinedVal.match(/(\d[\d.,]*(?:\s*[-–a]\s*\d[\d.,]*)?\s*(?:h\b|horas))/i);
                economicLifeHours = m ? m[1] : valCol;
                capexSourceItemTitle = capexSourceItemTitle || row.sourceItemTitle;
            }
            if (/\b\d[\d.,]*\s*km\b/i.test(combinedVal) && !economicLifeKm) {
                const m = combinedVal.match(/(\d[\d.,]*(?:\s*[-–a]\s*\d[\d.,]*)?\s*km\b)/i);
                economicLifeKm = m ? m[1] : valCol;
                capexSourceItemTitle = capexSourceItemTitle || row.sourceItemTitle;
            }
            if (/\b\d[\d.,]*\s*a[ñn]os?\b/i.test(combinedVal) && !economicLifeYears) {
                const m = combinedVal.match(/(\d[\d.,]*(?:\s*[-–a]\s*\d[\d.,]*)?\s*a[ñn]os?)/i);
                economicLifeYears = m ? m[1] : valCol;
                capexSourceItemTitle = capexSourceItemTitle || row.sourceItemTitle;
            }
        } else if (/\b(valor\s+residual|residual\s+referencial|salvamento|reventa)\b/i.test(paramCol) && !residualValuePct) {
            residualValuePct = valCol;
            capexSourceItemTitle = capexSourceItemTitle || row.sourceItemTitle;
        } else if (/\b(depreciaci[oó]n\s+lineal|tasa\s+de\s+depreciaci[oó]n|base\s+de\s+depreciaci[oó]n)\b/i.test(paramCol) && !hourlyDepreciationBase) {
            hourlyDepreciationBase = valCol;
            capexSourceItemTitle = capexSourceItemTitle || row.sourceItemTitle;
        } else if (
            /^(?:neum[aá]ticos?\s+(?:est[aá]ndar|delanteros?|traseros?)|medida\s+de\s+neum[aá]ticos?(?:\s+est[aá]ndar)?|dotaci[oó]n\s+(?:est[aá]ndar\s+)?de\s+rodado|orugas?\s+est[aá]ndar|zapatas?\s+est[aá]ndar)\b/i.test(
                paramCol.trim()
            ) &&
            !factoryTireOrTrackEquip
        ) {
            factoryTireOrTrackEquip = valCol;
        } else if (
            /^(?:dotaci[oó]n\s+(?:est[aá]ndar\s+)?(?:herramienta|de\s+[oó]rgano)|balde\s+est[aá]ndar|hoja\s+est[aá]ndar|capacidad\s+de\s+(?:balde|tolva|cuchara|cuchar[oó]n))\b/i.test(
                paramCol.trim()
            ) &&
            !factoryWorkToolEquip
        ) {
            factoryWorkToolEquip = valCol;
        }
    }

    if (!hourlyDepreciationBase) {
        hourlyDepreciationBase = computeLinearHourlyDepreciationIfPossible(
            referenceNewPriceUsd,
            economicLifeHours,
            residualValuePct
        );
    }

    // ── 2. CONSUMO ENERGÉTICO LIMPIO DESDE CAPÍTULOS CAZADOS DE PILAR 01 ────────
    const huntedConsumptionItems = fichaItems.filter((it) =>
        /\b(consumos?\s+de\s+(?:combustible|energ[ií]a|aire)|motor[^|\n]{0,40}combustible|combustible\s+y\s+autonom[ií]a|tanque\s+de\s+combustible|sistema\s+de\s+combustible|matriz\s+energ[eé]tica|rendimiento\s+vial|autonom[ií]a\s+operativa|condici[oó]n\s+remolcada|suministro\s+hidr[aá]ulico|energ[ií]a\s+en\s+bater[ií]as|capacidad\s+de\s+bater[ií]as|alimentaci[oó]n\s+el[eé]ctrica|accionamiento\s+mec[aá]nico|demanda\s+de\s+aire)\b/i.test(
            `${it.title || ''} ${it.section || ''}`
        )
    );
    const consumptionMarkdownOnly = huntedConsumptionItems
        .map((i) => `### ${i.title}\n${cleanMarkdownCell(i.content || '')}`)
        .join('\n\n');
    const consumptionRowsOnly = extractMarkdownTableRowsFromItems(huntedConsumptionItems, 'ficha_tecnica');

    const baseEnergyProfile = deriveEnergyConsumptionProfile({
        tipo_equipo: assetData.tipo_equipo,
        categoria_equipo: assetData.categoria_equipo,
        canonical_specs: [],
        caracteristicas_principales: [],
        fichaTecnicaMarkdown: consumptionMarkdownOnly,
        official_url:
            huntedConsumptionItems.find((it) => Array.isArray(it.item_sources) && it.item_sources.length > 0)
                ?.item_sources?.[0]?.url || null,
        existingProfile: undefined,
    });

    if (huntedConsumptionItems.length > 0 && baseEnergyProfile.energy_source === 'NO_DECLARADO') {
        baseEnergyProfile.energy_source = traits.primary_energy;
    }
    baseEnergyProfile.cost_driver_unit = AssetOntologyEngine.resolveDefaultCostDriverUnit(traits);

    if (huntedConsumptionItems.length === 0) {
        baseEnergyProfile.energy_source = 'NO_DECLARADO';
        baseEnergyProfile.energy_spec_label = null;
    }

    for (const row of consumptionRowsOnly) {
        const col0 = (row.cells[0] || '').toLowerCase();
        const col1 = row.cells[1] || '';
        const col2 = row.cells[2] || '';
        const combinedVal = [col1, col2].filter((x) => !isMissingMarker(x)).join(' · ');
        if (isMissingMarker(col1)) continue;

        if (/\b(rendimiento\s+vial|rendimiento\s+en\s+(?:ruta|carretera|faena)|km\s*\/\s*l\b|l\s*\/\s*100\s*km)\b/i.test(`${col0} ${col1}`)) {
            const kmlMatch = combinedVal.match(/(\d+(?:[.,]\d+)?(?:\s*(?:a|-|–)\s*\d+(?:[.,]\d+)?)?\s*km\s*\/\s*L\b)/i);
            const l100Match = combinedVal.match(/(\d+(?:[.,]\d+)?(?:\s*(?:a|-|–)\s*\d+(?:[.,]\d+)?)?\s*L\s*\/\s*100\s*km\b)/i);
            const isOffRoadRow =
                /\b(urbano|faena|faenero|fuera\s+de\s+carretera|off[\s-]*road|rampa|pesado|ciclo\s+severo|interior\s+mina)\b/i.test(
                    `${col0} ${col2}`
                ) && !/\b(homologado\s*\(\s*carretera)\b/i.test(col0);
            const isHighwayRow =
                /\b(homologado|carretera|autopista|ruta\s+pavimentada|traslado|on[\s-]*road)\b/i.test(`${col0} ${col2}`) &&
                !isOffRoadRow;

            if (isHighwayRow) {
                if (kmlMatch && !baseEnergyProfile.road_haul_efficiency.highway_km_per_liter) {
                    baseEnergyProfile.road_haul_efficiency.highway_km_per_liter = kmlMatch[1].trim();
                }
                if (l100Match && !baseEnergyProfile.road_haul_efficiency.highway_liters_per_100km) {
                    baseEnergyProfile.road_haul_efficiency.highway_liters_per_100km = l100Match[1].trim();
                }
                if (kmlMatch && !baseEnergyProfile.road_haul_efficiency.km_per_liter) {
                    baseEnergyProfile.road_haul_efficiency.km_per_liter = kmlMatch[1].trim();
                }
                if (l100Match && !baseEnergyProfile.road_haul_efficiency.liters_per_100km) {
                    baseEnergyProfile.road_haul_efficiency.liters_per_100km = l100Match[1].trim();
                }
            } else if (isOffRoadRow) {
                if (kmlMatch && !baseEnergyProfile.road_haul_efficiency.offroad_km_per_liter) {
                    baseEnergyProfile.road_haul_efficiency.offroad_km_per_liter = kmlMatch[1].trim();
                }
                if (l100Match && !baseEnergyProfile.road_haul_efficiency.offroad_liters_per_100km) {
                    baseEnergyProfile.road_haul_efficiency.offroad_liters_per_100km = l100Match[1].trim();
                }
            } else {
                if (kmlMatch && !baseEnergyProfile.road_haul_efficiency.km_per_liter) {
                    baseEnergyProfile.road_haul_efficiency.km_per_liter = kmlMatch[1].trim();
                }
                if (l100Match && !baseEnergyProfile.road_haul_efficiency.liters_per_100km) {
                    baseEnergyProfile.road_haul_efficiency.liters_per_100km = l100Match[1].trim();
                }
            }
        }

        if (/\b(capacidad\s+(?:total\s+de\s+|utilizable\s+de\s+)?(?:estanques?|tanques?)\s+de\s+combustible|capacidad\s+de\s+estanque|capacidad\s+energ[eé]tica)\b/i.test(col0)) {
            if (!baseEnergyProfile.storage_and_autonomy.tank_or_battery_capacity) {
                baseEnergyProfile.storage_and_autonomy.tank_or_battery_capacity = col1;
            }
        } else if (/\b(autonom[ií]a\s+vial|rango\s+vial|autonom[ií]a\s+en\s+ruta)\b/i.test(col0)) {
            const kmRange = col1.match(/(\d[\d.,]*(?:\s*km)?(?:\s*(?:a|-|–)\s*\d[\d.,]*)?\s*km\b)/i);
            if (kmRange) {
                baseEnergyProfile.road_haul_efficiency.estimated_range_km = kmRange[1].trim();
            }
        } else if (/\b(autonom[ií]a\s+operativa|autonom[ií]a\s+proyectada|autonom[ií]a\s+en\s+faena)\b/i.test(col0)) {
            if (/\b(horas?|h\b)\b/i.test(col1) && !baseEnergyProfile.storage_and_autonomy.estimated_autonomy) {
                baseEnergyProfile.storage_and_autonomy.estimated_autonomy = col1;
            }
        }

        if (/\b(ralent[ií]|idle|espera|auxiliar\s+en\s+vac[ií]o|tracci[oó]n\s+propia)\b/i.test(col0)) {
            baseEnergyProfile.hourly_consumption_by_load.idle_or_pto = col1;
        } else if (/\b(carga\s+baja|factor\s+de\s+carga\s+bajo|25\s*[-–a]\s*35\s*%|\bbaja\s+carga\b|ciclo\s+ligero|pto\s+ligero)\b/i.test(col0)) {
            baseEnergyProfile.hourly_consumption_by_load.low_load_25_35pct = col1;
        } else if (/\b(carga\s+media|carga\s+nominal|factor\s+de\s+carga\s+medio|50\s*[-–a]\s*65\s*%|\bnominal\b|ciclo\s+t[ií]pico)\b/i.test(col0)) {
            baseEnergyProfile.hourly_consumption_by_load.medium_load_50_65pct = col1;
        } else if (/\b(carga\s+alta|carga\s+severa|factor\s+de\s+carga\s+alto|80\s*[-–a]\s*100\s*%|plena\s+carga|100\s*%\s+carga)\b/i.test(col0)) {
            baseEnergyProfile.hourly_consumption_by_load.high_load_80_100pct = col1;
        }
    }

    const supportsDieselScrCandidate =
        traits.primary_energy === 'DIESEL' ||
        traits.primary_energy === 'HIBRIDO_DIESEL_ELECTRICO' ||
        traits.primary_energy === 'DUAL_FUEL_DIESEL_GAS';
    const explicitlyNoScrInRows = [...fichaRows, ...mantRows].some((r) =>
        /\b(no\s+aplica[^|]*(?:scr|adblue|def|urea)|sin\s+(?:sistema\s+)?(?:scr|adblue|def|urea)|motor\s+sin\s+scr)\b/i.test(
            r.cells.join(' ')
        )
    );
    const isPreScrEmissionTierWithoutPositiveEvidence =
        /\b(euro\s*(?:ii|iii|2|3)\b|tier\s*[123]\b|epa\s*tier\s*[123]\b)\b/i.test(fichaMarkdown) &&
        !/\b(equipa\s+scr|requiere\s+(?:adblue|def|urea)|estanque\s+de\s+(?:adblue|def|urea)\s*:\s*\d)\b/i.test(
            consumptionMarkdownOnly
        );

    if (
        !supportsDieselScrCandidate ||
        explicitlyNoScrInRows ||
        isPreScrEmissionTierWithoutPositiveEvidence ||
        huntedConsumptionItems.length === 0
    ) {
        baseEnergyProfile.def_adblue_consumption = {
            requires_def: false,
            consumption_pct_of_fuel: null,
            tank_capacity_liters: null,
        };
    }

    // ── 3. AGREGACIÓN DE PUNTOS DE ENGRASE ZERK (SIN CREAR FILAS FALSAS) ────
    let totalZerkPoints = 0;
    let fallbackGreaseSpec: string | null = null;
    for (const row of mantRows) {
        const cols = detectColumnMap(row.headers);
        if (cols.zerkIdx === -1) continue;
        if (/\b(drenaje\s+manual|separador\s+de\s+agua)\b/i.test(stripAccentsLower(row.cells.join(' ')))) continue;
        const cnt = parseInt((row.cells[cols.zerkIdx] || '').trim(), 10);
        if (Number.isFinite(cnt) && cnt > 0 && cnt <= 64) {
            totalZerkPoints += cnt;
            const lastCell = row.cells[row.cells.length - 1] || '';
            if (!fallbackGreaseSpec && /\b(grasa|nlgi)\b/i.test(lastCell)) {
                fallbackGreaseSpec = lastCell.replace(/\s+o\s+equivalente.*$/i, '').trim();
            }
        }
    }

    // ── 4. EXTRACCIÓN Y RECONCILIACIÓN CANÓNICA DE FLUIDOS ────────────────────
    interface MergedFluid {
        key: string;
        itemName: string;
        subsystem: string;
        family: Extract<SupplyItemFamily, 'LUBRICANTE' | 'REFRIGERANTE' | 'GRASA'>;
        fluidSpec: string | null;
        viscosity: string | null;
        qtyDisplay: string | null;
        numericQty: number | null;
        qtyUnit: string | null;
        intervalDisplay: string | null;
        intervalValue: number | null;
        intervalBasis: 'h' | 'km' | null;
        samplingNote: string | null;
        extraNote: string | null;
        specConflict: string | null;
        sourcePillar: 'ficha_tecnica' | 'pauta_mantencion';
        sourceItemTitle: string;
        isDualSide: boolean;
    }

    const fluidMap = new Map<string, MergedFluid>();
    const fluidEligibleFichaRows = fichaRows.filter((r) =>
        /\b(fluidos?|lubricaci[oó]n|capacidades(?:\s+de\s+(?:llenado|servicio|estanque|lubricaci[oó]n))?|refrigeraci[oó]n|hidr[aá]ulico)\b/i.test(
            r.sourceItemTitle
        )
    );
    // Prioridad: ETAPA I (Carta Maestra) -> ETAPA III/IV -> Capacidades Ficha Técnica
    const orderedFluidRows = [
        ...mantRows.filter((r) => /\b(etapa\s*i\b|carta\s+maestra)\b/i.test(r.sourceItemTitle)),
        ...mantRows.filter((r) => !/\b(etapa\s*i\b|carta\s+maestra)\b/i.test(r.sourceItemTitle)),
        ...fluidEligibleFichaRows,
    ];

    for (const row of orderedFluidRows) {
        const cols = detectColumnMap(row.headers);
        if (cols.zerkIdx !== -1) continue;
        if (isNonReplacementActionRow(row, cols)) continue;

        const col0 = row.cells[0] || '';
        const joinedLower = stripAccentsLower(row.cells.join(' '));
        if (isMissingMarker(col0) || col0.length < 3) continue;
        if (/^(par[aá]metro|sistema|compartimento|componente|fluido|etapa|tarea|paso|punto\s+de\s+servicio)$/i.test(col0.trim())) {
            continue;
        }
        if (
            /\b(estanque\s+de\s+combustible|tanque\s+de\s+combustible|consumo\s+horario|rendimiento\s+vial|autonom[ií]a|frenos?\s+de\s+servicio|neum[aá]ticos?|voltaje|alternador|bater[ií]a|nivel\s+de\s+ruido|certificaci[oó]n|rops|fops)\b/i.test(
                joinedLower
            )
        ) {
            if (/\b(estanque\s+de\s+combustible)\b/i.test(joinedLower) && !fuelSpecFromMant && row.cells[1] && !isMissingMarker(row.cells[1])) {
                fuelSpecFromMant = row.cells[1];
            }
            continue;
        }
        if (/^(?:filtro|elemento\s+filtrante|sello|empaquetadura|respiradero|oruga|diente|cuchilla)\b/i.test(col0.trim())) {
            continue;
        }

        const isFluidContext =
            /\b(lubricante|aceite|fluido|refrigerante|coolant|elc|grasa|nlgi|sae\s*\d|iso\s*vg|api\s*c|dot\s*[345]|tdto|hydo|adblue|def|urea|liquido\s+de\s+frenos)\b/i.test(
                joinedLower
            );
        if (!isFluidContext || row.cells.length < 2) continue;

        if (!baseEnergyProfile.def_adblue_consumption.requires_def && /\b(adblue|def\b|urea|scr\b)\b/i.test(joinedLower)) {
            continue;
        }

        const canonical = resolveCanonicalFluidEntry(col0);
        let spec: string | null = null;
        let viscosity: string | null = null;
        let capacityRaw: string | null = null;
        let intervalRaw: string | null = null;

        for (let idx = 1; idx < row.cells.length; idx++) {
            if (idx === cols.actionIdx) continue;
            const cell = row.cells[idx];
            const hdr = row.headers[idx] || '';
            if (isMissingMarker(cell)) continue;

            if (cols.intervalIdx === idx || (/\b(intervalo|frecuencia|cambio|pauta|horas|km)\b/i.test(hdr) && !intervalRaw)) {
                intervalRaw = cell;
                continue;
            }
            if (cols.viscosityIdx === idx && cols.fluidOrSpecIdx !== idx) {
                viscosity = cell;
                continue;
            }
            if (cols.fluidOrSpecIdx === idx || cols.viscosityIdx === idx) {
                const split = splitFluidSpecAndCapacity(cell);
                if (split.specPart && !spec) spec = split.specPart;
                if (split.viscosityPart && !viscosity) viscosity = split.viscosityPart;
                if (!spec && !split.viscosityPart && cols.viscosityIdx === idx) viscosity = cell;
                if (split.capacityPart && !capacityRaw && cols.capacityIdx !== idx) capacityRaw = split.capacityPart;
                continue;
            }
            if (cols.capacityIdx === idx) {
                const split = splitFluidSpecAndCapacity(cell);
                if (split.specPart && !spec) spec = split.specPart;
                if (split.viscosityPart && !viscosity) viscosity = split.viscosityPart;
                capacityRaw = split.capacityPart || cell;
                continue;
            }
            if (cols.fluidOrSpecIdx === idx) {
                const split = splitFluidSpecAndCapacity(cell);
                if (split.specPart && !spec) spec = split.specPart;
                if (split.viscosityPart && !viscosity) viscosity = split.viscosityPart;
                if (split.capacityPart && !capacityRaw) capacityRaw = split.capacityPart;
                continue;
            }

            // Clasificación heurística si no hubo columna dedicada
            if (/\b(?:cada\s+)?\d[\d.,]*\s*(?:h\b|hr|hrs|horas|km\b|meses|a[ñn]os?)\b/i.test(cell) && !/\b(11158|cj-4|to-4)\b/i.test(cell)) {
                if (!intervalRaw && row.pillarId === 'pauta_mantencion') intervalRaw = cell;
            } else {
                const split = splitFluidSpecAndCapacity(cell);
                if (split.capacityPart && !capacityRaw) capacityRaw = split.capacityPart;
                if (split.viscosityPart && !viscosity) viscosity = split.viscosityPart;
                if (split.specPart && !spec && !/\b(llenar|drenar|purgar|nivel|mirilla)\b/i.test(stripAccentsLower(cell))) {
                    spec = split.specPart;
                }
            }
        }

        if (!spec && viscosity) spec = viscosity;
        if (!capacityRaw && !viscosity && !intervalRaw && !spec) continue;

        const explicitTotalMatch = capacityRaw?.match(/(\d+(?:[.,]\d+)?\s*(?:L\b|litros?|kg|ml|g))\s*total\b/i);
        const perSideMult =
            !explicitTotalMatch &&
            canonical.isDualSide &&
            (/\b(?:por\s+lado|por\s+caja|cada\s+caja|c\/u)\b/i.test(col0) ||
                /\b(?:por\s+lado|por\s+caja|cada\s+caja|c\/u)\b/i.test(capacityRaw || ''))
                ? 2
                : 1;
        const parsedQty = explicitTotalMatch
            ? extractNumericQuantity(explicitTotalMatch[1], 1)
            : capacityRaw
            ? extractNumericQuantity(capacityRaw, perSideMult)
            : { displayQty: MISSING_FULL_TECH_SPEC, numericQty: null, qtyUnit: null };
        const parsedInt = intervalRaw
            ? extractPrimaryChangeInterval(intervalRaw)
            : { intervalText: MISSING_FULL_TECH_SPEC, intervalValue: null, intervalBasis: null, samplingNote: null, conditionNote: null };

        const existing = fluidMap.get(canonical.key);
        if (!existing) {
            const extraParts: string[] = [];
            if (parsedInt.samplingNote) extraParts.push(parsedInt.samplingNote);
            if (canonical.isTotalCircuit && parsedQty.numericQty) {
                extraParts.push(`Capacidad total circuito: ${parsedQty.displayQty}`);
            }
            fluidMap.set(canonical.key, {
                key: canonical.key,
                itemName: canonical.itemName,
                subsystem: canonical.subsystem,
                family: canonical.family,
                fluidSpec: canonical.isTotalCircuit ? spec : spec,
                viscosity,
                qtyDisplay: canonical.isTotalCircuit ? null : parsedQty.numericQty !== null ? parsedQty.displayQty : null,
                numericQty: canonical.isTotalCircuit ? null : parsedQty.numericQty,
                qtyUnit: canonical.isTotalCircuit ? null : parsedQty.qtyUnit,
                intervalDisplay: parsedInt.intervalValue !== null || parsedInt.intervalText !== MISSING_FULL_TECH_SPEC ? parsedInt.intervalText : null,
                intervalValue: parsedInt.intervalValue,
                intervalBasis: parsedInt.intervalBasis,
                samplingNote: parsedInt.samplingNote,
                extraNote: extraParts.length > 0 ? extraParts.join(' · ') : null,
                specConflict: null,
                sourcePillar: row.pillarId,
                sourceItemTitle: row.sourceItemTitle,
                isDualSide: canonical.isDualSide,
            });
            continue;
        }

        // Fusión canónica de circuito total vs tanque de servicio + detección de conflictos documentales
        if (canonical.isTotalCircuit) {
            if (parsedQty.numericQty !== null && !existing.extraNote?.includes('Capacidad total circuito')) {
                const capNote = `Capacidad total circuito: ${parsedQty.displayQty}`;
                existing.extraNote = existing.extraNote ? `${capNote} · ${existing.extraNote}` : capNote;
            }
        } else {
            const conflict = detectFluidSpecConflict(
                existing.fluidSpec || '',
                existing.viscosity || '',
                spec || '',
                viscosity || ''
            );
            if (conflict && !existing.specConflict) {
                existing.specConflict = conflict;
            }
            if (!existing.fluidSpec && spec) existing.fluidSpec = spec;
            if (!existing.viscosity && viscosity) existing.viscosity = viscosity;
            if (existing.numericQty === null && parsedQty.numericQty !== null) {
                existing.numericQty = parsedQty.numericQty;
                existing.qtyUnit = parsedQty.qtyUnit;
                existing.qtyDisplay = parsedQty.displayQty;
            }
            if (existing.intervalValue === null && parsedInt.intervalValue !== null) {
                existing.intervalValue = parsedInt.intervalValue;
                existing.intervalBasis = parsedInt.intervalBasis;
                existing.intervalDisplay = parsedInt.intervalText;
            }
            if (parsedInt.samplingNote && (!existing.samplingNote || !existing.extraNote?.includes('S·O·S'))) {
                existing.samplingNote = parsedInt.samplingNote;
                existing.extraNote = existing.extraNote ? `${existing.extraNote} · ${parsedInt.samplingNote}` : parsedInt.samplingNote;
            }
        }
    }

    if (fluidMap.has('fluid_grease') && totalZerkPoints > 0) {
        const g = fluidMap.get('fluid_grease')!;
        const zerkNote = `${totalZerkPoints} graseras (Zerk)`;
        g.extraNote = g.extraNote ? `${zerkNote} · ${g.extraNote}` : zerkNote;
        if (!g.fluidSpec && fallbackGreaseSpec) g.fluidSpec = fallbackGreaseSpec;
    }

    const periodicFluids: OperationalCostMatrix['periodic_fluids'] = Array.from(fluidMap.values()).map((fl) => {
        const rate = computeNormalizedRatePer1000h({
            numericQty: fl.numericQty,
            qtyUnit: fl.qtyUnit,
            intervalValue: fl.intervalValue,
            intervalBasis: fl.intervalBasis,
        });
        return {
            compartment: fl.subsystem,
            fluid_spec: fl.fluidSpec || MISSING_FULL_TECH_SPEC,
            viscosity: fl.viscosity || MISSING_FULL_TECH_SPEC,
            capacity_per_change: fl.qtyDisplay || MISSING_FULL_TECH_SPEC,
            interval: fl.intervalDisplay || MISSING_FULL_TECH_SPEC,
            prorated_per_1000h: rate.proratedText,
            source_item_title: fl.sourceItemTitle,
        };
    });

    // ── 5. RECAMBIO PERIÓDICO DE FILTROS, RESPIRADEROS Y POSTRATAMIENTO DPF ───
    interface MergedPart {
        key: string;
        componentName: string;
        category: OperationalCostMatrix['periodic_filters_and_seals'][number]['category'];
        supplyFamily: SupplyItemFamily;
        system: string | null;
        oemPartNumber: string | null;
        qtyDisplay: string | null;
        numericQty: number | null;
        qtyUnit: string | null;
        intervalDisplay: string | null;
        intervalValue: number | null;
        intervalBasis: 'h' | 'km' | null;
        pmStage: string | null;
        conditionNote: string | null;
        isDpfService: boolean;
        sourceItemTitle: string;
    }

    const partMap = new Map<string, MergedPart>();
    const orderedFilterRows = [
        ...mantRows.filter((r) => /\b(etapa\s*i\b|carta\s+maestra)\b/i.test(r.sourceItemTitle)),
        ...mantRows.filter((r) => !/\b(etapa\s*i\b|carta\s+maestra)\b/i.test(r.sourceItemTitle)),
    ];

    for (const row of orderedFilterRows) {
        const cols = detectColumnMap(row.headers);
        if (cols.zerkIdx !== -1) continue;
        if (isNonReplacementActionRow(row, cols)) continue;

        const col0 = row.cells[0] || '';
        const joinedRow = row.cells.join(' ');
        const col0Lower = stripAccentsLower(col0);
        if (isMissingMarker(col0) || col0.length < 3) continue;
        if (/^(par[aá]metro|sistema|compartimento|componente|insumo|filtro|etapa|tarea)$/i.test(col0.trim())) {
            continue;
        }
        // Si es fila combinada "Aceite de motor y filtro de aceite", evitar duplicar la línea del filtro si ya se procesó filtro de aceite de motor
        const isCombinedOilAndFilter = /\baceite\s+de\s+motor\s+y\s+filtro\b/i.test(col0Lower);

        const isFilterOrSeal =
            (/\b(filtro|elemento\s+filtrante|separador\s+(?:de\s+)?agua|filtro\s+coalescente|respiradero|breather|secador\s+de\s+aire|cartucho\s+desecante|sello|ret[eé]n|empaquetadura|junta|o-?ring|kit\s+de\s+sellos|correa\s+(?:de\s+)?(?:accesorios|distribuci[oó]n|alternador|ventilador)|manguera\s+(?:antiest[aá]tica|dispensadora|hidr[aá]ulica)|kit\s+pm\d?)\b/i.test(
                col0Lower
            ) ||
                isCombinedOilAndFilter) &&
            !/^(?:inspeccion|revision|verificacion|chequeo|drenaje|aceite\s+de\s+motor$|carter|diente|cuchilla|cantonera|neumatico|oruga|zapata)\b/i.test(
                col0Lower
            );

        if (!isFilterOrSeal) continue;
        if (!baseEnergyProfile.def_adblue_consumption.requires_def && /\b(adblue|def\b|urea|scr\b)\b/i.test(joinedRow)) {
            continue;
        }

        const { key: canonicalKey, isDpfService } = isCombinedOilAndFilter
            ? { key: 'filtro_aceite_motor', isDpfService: false }
            : canonicalizeFilterOrPartKey(col0);

        let category: OperationalCostMatrix['periodic_filters_and_seals'][number]['category'] = 'FILTRO';
        let supplyFamily: SupplyItemFamily = isDpfService ? 'POSTRATAMIENTO' : 'FILTRO';
        if (/\b(sello|reten|empaquetadura|junta|o-?ring)\b/i.test(col0Lower)) {
            category = 'SELLO_EMPAQUETADURA';
            supplyFamily = 'SELLO_CORREA_MANGUERA';
        } else if (/\b(respiradero|breather|secador\s+de\s+aire|cartucho\s+desecante|venteo)\b/i.test(col0Lower)) {
            category = 'RESPIRADERO';
            supplyFamily = 'RESPIRADERO';
        } else if (/\b(correa|manguera)\b/i.test(col0Lower)) {
            category = 'CORREA_MANGUERA';
            supplyFamily = 'SELLO_CORREA_MANGUERA';
        } else if (/\b(kit\s+pm|kit\s+de\s+mantenimiento)\b/i.test(col0Lower)) {
            category = 'KIT_PM';
            supplyFamily = 'FILTRO';
        }

        let system: string | null = null;
        let oemPartNumber: string | null = null;
        let qtyRaw: string | null = null;
        let intervalRaw: string | null = null;
        let pmStage: string | null = null;

        for (let idx = 1; idx < row.cells.length; idx++) {
            if (idx === cols.actionIdx) continue;
            const cell = row.cells[idx];
            const hdr = row.headers[idx] || '';
            if (isMissingMarker(cell)) continue;

            if (cols.partNoIdx === idx) {
                oemPartNumber = extractValidOemPartNumber(cell, true) || oemPartNumber;
            } else if (cols.qtyIdx === idx) {
                qtyRaw = cell;
            } else if (cols.intervalIdx === idx) {
                intervalRaw = cell;
            } else if (cols.locationIdx === idx) {
                system = cell;
            } else if (cols.pmStageIdx === idx) {
                pmStage = cell.toUpperCase();
            } else {
                const explicitPart = extractValidOemPartNumber(cell, false);
                if (explicitPart && !oemPartNumber) {
                    oemPartNumber = explicitPart;
                } else if (/^\d{1,2}\s*(?:unid\.?|u\.?|pza\.?|kit|juego)$/i.test(cell.trim()) && !qtyRaw) {
                    qtyRaw = cell;
                } else if (/\b(?:cada\s+)?\d[\d.,]*\s*(?:h\b|hr|hrs|horas|km\b|meses)\b/i.test(cell) && !intervalRaw) {
                    intervalRaw = cell;
                } else if (/\bfunci[oó]n|eficiencia|micraje\b/i.test(hdr) && !system) {
                    // conservar nota de sistema/función solo si no había ubicación física
                }
            }
        }

        const parsedInterval = intervalRaw
            ? extractPrimaryChangeInterval(intervalRaw)
            : { intervalText: MISSING_FULL_TECH_SPEC, intervalValue: null, intervalBasis: null, samplingNote: null, conditionNote: null };
        const parsedQty = qtyRaw ? extractNumericQuantity(qtyRaw) : { displayQty: MISSING_FULL_TECH_SPEC, numericQty: null, qtyUnit: null };

        if (!pmStage && parsedInterval.intervalValue && parsedInterval.intervalBasis) {
            pmStage = `${formatDecimalEs(parsedInterval.intervalValue)} ${parsedInterval.intervalBasis.toUpperCase()}`;
        }

        const cleanTitle = isCombinedOilAndFilter
            ? 'Filtro de Aceite de Motor'
            : isDpfService
            ? 'Filtro de Partículas Diésel (DPF) — Limpieza Cenizas'
            : col0;

        const existing = partMap.get(canonicalKey);
        if (!existing) {
            partMap.set(canonicalKey, {
                key: canonicalKey,
                componentName: cleanTitle,
                category,
                supplyFamily,
                system: system || (isDpfService ? 'Postratamiento de Escape' : null),
                oemPartNumber,
                qtyDisplay: parsedQty.numericQty !== null ? parsedQty.displayQty : null,
                numericQty: parsedQty.numericQty,
                qtyUnit: parsedQty.qtyUnit,
                intervalDisplay:
                    parsedInterval.intervalText !== MISSING_FULL_TECH_SPEC ? parsedInterval.intervalText : null,
                intervalValue: parsedInterval.intervalValue,
                intervalBasis: parsedInterval.intervalBasis,
                pmStage,
                conditionNote: parsedInterval.conditionNote,
                isDpfService,
                sourceItemTitle: row.sourceItemTitle,
            });
        } else {
            if (!existing.oemPartNumber && oemPartNumber) existing.oemPartNumber = oemPartNumber;
            if (!existing.system && system) existing.system = system;
            if (existing.numericQty === null && parsedQty.numericQty !== null) {
                existing.numericQty = parsedQty.numericQty;
                existing.qtyUnit = parsedQty.qtyUnit;
                existing.qtyDisplay = parsedQty.displayQty;
            }
            if (existing.intervalValue === null && parsedInterval.intervalValue !== null) {
                existing.intervalValue = parsedInterval.intervalValue;
                existing.intervalBasis = parsedInterval.intervalBasis;
                existing.intervalDisplay = parsedInterval.intervalText;
                existing.pmStage = pmStage || existing.pmStage;
                existing.conditionNote = existing.conditionNote || parsedInterval.conditionNote;
            }
        }
    }

    const periodicFiltersAndSeals: OperationalCostMatrix['periodic_filters_and_seals'] = Array.from(
        partMap.values()
    )
        .filter((p) => !p.isDpfService)
        .map((p) => ({
            component_name: p.componentName,
            category: p.category,
            system: p.system || MISSING_FULL_TECH_SPEC,
            oem_part_number: p.oemPartNumber || MISSING_FULL_TECH_SPEC,
            quantity_per_change: p.qtyDisplay || MISSING_FULL_TECH_SPEC,
            interval: p.intervalDisplay || MISSING_FULL_TECH_SPEC,
            pm_stage: p.pmStage || MISSING_FULL_TECH_SPEC,
            source_item_title: p.sourceItemTitle,
        }));

    // ── 6. ELEMENTOS DE DESGASTE ESPECÍFICOS POR TAXONOMÍA (`DESGASTE`) ─────────
    const wearPartsGet: OperationalCostMatrix['wear_parts_get'] = [];
    const seenWearKeys = new Set<string>();
    const isWheeledTruckOrVehicle =
        traits.mobility === 'SELF_PROPELLED_WHEELED' &&
        (traits.functional_domain === 'HAULAGE_AND_TRANSPORT' ||
            traits.functional_domain === 'VOCATIONAL_SERVICE_SUPPORT');

    for (const row of mantRows) {
        const cols = detectColumnMap(row.headers);
        if (cols.zerkIdx !== -1 || isNonReplacementActionRow(row, cols)) continue;

        const col0 = row.cells[0] || '';
        const col0Lower = stripAccentsLower(col0);
        const joinedLower = stripAccentsLower(row.cells.join(' '));
        if (isMissingMarker(col0) || col0.length < 3) continue;
        if (/^(par[aá]metro|sistema|componente|elemento|pieza|etapa|tarea)$/i.test(col0Lower)) continue;

        const isWearPart =
            /\b(dientes?\s+de\s+(?:balde|dipper)|puntas?\s+de\s+(?:balde|excavacion|ripper)|adaptador(?:es)?\s+de\s+diente|cuchillas?\s+(?:central|reversible|empernada|reemplazable|soldable|de\s+ataque|de\s+vertedera|de\s+balde)|bolt-?on\s+cutting\s+edge|cantonera|protector\s+de\s+(?:labio|faldon|brazo)|labio\s+de\s+(?:balde|dipper)|placa\s+de\s+desgaste|planchas?\s+de\s+(?:desgaste|sacrificio)|liner\s+de\s+tolva|revestimiento\s+(?:antidesgaste|de\s+tolva)|wear\s+plate|escarificador|ripper|mandibula\s+(?:fija|movil)|muela\s+de\s+chancado|manto\s+y\s+concavo|barra\s+de\s+impacto|blow\s+bar|malla\s+de\s+harnero|faldon\s+de\s+goma|raspador\s+de\s+(?:correa|tambor)|broca\s+de\s+perforacion|bit\s+de\s+botones|barra\s+(?:integral|de\s+perforacion|hexagonal)|culatin|shank\s+adapter|copla\s+de\s+perforacion|buje\s+de\s+rotacion|picas?\s+de\s+(?:carburo|corte|fresado)|portapicas?|pastillas?\s+de\s+freno|balatas?\s+de\s+freno|bloques?\s+de\s+freno|disco\s+de\s+freno|tambor(?:es)?\s+de\s+freno|kit\s+de\s+embrague|disco\s+de\s+embrague|prensa\s+de\s+embrague|paquete\s+de\s+resortes|ballestas?|muelles?\s+de\s+suspension|amortiguador(?:es)?\s+de\s+suspension|quinta\s+rueda|kingpin|impulsor|difusor\s+de\s+goma|camisa\s+de\s+desgaste|sello\s+mecanico|toberas?\s+de\s+soldadura|puntas?\s+de\s+contacto|liner\s+de\s+antorcha|rodillos?\s+alimentadores|escobillas?\s+(?:de\s+carbon|colectoras)|helices?\b|rotores?\s+de\s+vuelo|dampers?\s+de\s+gimbal|cuadradillo\s+de\s+mando|trinquete|brazo\s+de\s+reaccion|cables?\s+(?:de\s+izaje|hoist|crowd|trip|de\s+acero\s+de\s+mastil)|almohadillas?\s+de\s+pluma|horquillas?\s+de\s+carga)\b/i.test(
                col0Lower
            ) &&
            !/\b(neumatico|oruga\s+de\s+goma|aceite\s+sae|filtro\s+de)\b/i.test(col0Lower);

        if (!isWearPart) continue;
        if (
            traits.functional_domain !== 'DRILLING_AND_GROUND_SUPPORT' &&
            /\b(broca\s+de\s+perforacion|bit\s+de\s+botones|barra\s+(?:integral|de\s+perforacion|hexagonal)|culatin|shank\s+adapter|copla\s+de\s+perforacion|buje\s+de\s+rotacion)\b/i.test(
                joinedLower
            )
        ) {
            continue;
        }
        if (
            Array.isArray(taxonomyMeta.wear_exclude_keywords) &&
            taxonomyMeta.wear_exclude_keywords.some((kw) => joinedLower.includes(stripAccentsLower(kw)))
        ) {
            continue;
        }
        if (
            isWheeledTruckOrVehicle &&
            /\b(cuchilla|dientes?\s+de\s+balde|puntas?\s+de\s+balde|adaptador\s+de\s+diente|cantonera|vertedera|ripper|escarificador|mandibula|manto\s+y\s+concavo|broca\s+de\s+perforacion|culatin|oruga)\b/i.test(
                joinedLower
            )
        ) {
            continue;
        }

        let workToolZone = '';
        let oemSpecOrCode = '';
        let installedQty = '';
        let estimatedLife = '';
        let condemnationLimit = '';

        for (let idx = 1; idx < row.cells.length; idx++) {
            if (idx === cols.actionIdx) continue;
            const cell = row.cells[idx];
            const hdr = row.headers[idx] || '';
            if (isMissingMarker(cell)) continue;

            if ((cols.locationIdx === idx || /\b(zona|[oó]rgano|ubicaci[oó]n|sistema|implemento|eje|subconjunto)\b/i.test(hdr)) && !workToolZone) {
                workToolZone = cell;
            } else if (
                cols.partNoIdx === idx ||
                (/\b(c[oó]digo|medida|especificaci[oó]n|serie|sistema\s+get|parte|material)\b/i.test(hdr) && !oemSpecOrCode)
            ) {
                oemSpecOrCode = cell;
            } else if (
                cols.qtyIdx === idx ||
                (/^\d{1,3}\s*(?:unid\.?|u\.?|pzas?\.?|dientes?|segmentos?|juegos?)$/i.test(cell.trim()) && !installedQty)
            ) {
                installedQty = cell;
            } else if (
                cols.intervalIdx === idx ||
                (/\b\d[\d.,]*\s*(?:h\b|hr|hrs|horas|km\b|m\s+perforados|toneladas|t\b)\b/i.test(cell) && !estimatedLife)
            ) {
                estimatedLife = cell;
            } else if (
                cols.condemnIdx === idx ||
                (/\b(\d+\s*%|m[ií]n\.?\s*\d+(?:[.,]\d+)?\s*mm|reemplazo\s+al)\b/i.test(cell) && !condemnationLimit)
            ) {
                condemnationLimit = cell;
            } else if (!oemSpecOrCode) {
                oemSpecOrCode = cell;
            }
        }

        const dedupKey = `${col0Lower}::${oemSpecOrCode.toLowerCase().trim()}`;
        if (seenWearKeys.has(dedupKey)) continue;
        seenWearKeys.add(dedupKey);

        wearPartsGet.push({
            part_name: col0,
            work_tool_zone: workToolZone || MISSING_FULL_TECH_SPEC,
            oem_spec_or_code: oemSpecOrCode || MISSING_FULL_TECH_SPEC,
            installed_qty: installedQty || MISSING_FULL_TECH_SPEC,
            estimated_life: estimatedLife || MISSING_FULL_TECH_SPEC,
            condemnation_limit: condemnationLimit || MISSING_FULL_TECH_SPEC,
            source_item_title: row.sourceItemTitle,
        });
    }

    // ── 7. NEUMÁTICOS, ORUGAS Y TREN DE RODAJE AD-HOC (SIN INSPECCIONES 10H) ──
    const tiresAndUndercarriage: OperationalCostMatrix['tires_and_undercarriage'] = [];
    const seenRodadoKeys = new Set<string>();
    const rodadoSourceRows = [...mantRows, ...fichaRows];

    const inferPhysicalWheelCountForSingleGlobalTireRow = (): number | null => {
        if (configProfile.tire_or_track_count && configProfile.tire_or_track_count >= 2) {
            return configProfile.tire_or_track_count;
        }
        const ctxNorm = stripAccentsLower(
            `${assetData.tipo_equipo || ''} ${assetData.categoria_equipo || ''} ${configProfile.axle_or_undercarriage_config || ''}`
        );
        if (/\b8x[468]\b/.test(ctxNorm)) return 12;
        if (/\b6x[246]\b/.test(ctxNorm) && /\b(camion|tracto|tolva|volquete|aljibe|mixer)\b/.test(ctxNorm)) return 10;
        if (/\b(motoniveladora|dumper\s+articulado|camion\s+articulado)\b/.test(ctxNorm)) return 6;
        if (
            /\b(minicargador|skid\s*steer|retroexcavadora|cargador\s+frontal|manipulador\s+telescopico|telehandler|autohormigonera|camioneta|pick\s*up|suv|furgon|4x4)\b/.test(
                ctxNorm
            )
        ) {
            return 4;
        }
        return null;
    };

    for (const row of rodadoSourceRows) {
        const cols = detectColumnMap(row.headers);
        if (cols.zerkIdx !== -1 || isNonReplacementActionRow(row, cols)) continue;

        const col0 = row.cells[0] || '';
        const col0Lower = stripAccentsLower(col0);
        const joinedLower = stripAccentsLower(row.cells.join(' '));
        if (isMissingMarker(col0) || col0.length < 3) continue;

        const isExplicitRodadoCol0 =
            /^(?:neumaticos?\b|llantas?\s+y\s+neumaticos?\b|medida\s+de\s+neumaticos?(?:\s+estandar)?\b|orugas?\s+de\b|cadenas?\s+de\s+oruga\b|zapatas?\s+de\b|rodillos?\s+(?:inferiores|superiores|de\s+oruga)\b|rueda\s+guia\b|idler\b|rueda\s+cabilla\b|sprocket\b|segmentos?\s+de\s+sprocket\b|mazas?\s+de\s+rueda\b|rodamientos?\s+de\s+rueda\b|silentblock\b|aislador\s+elastomero\b|polines?\s+de\s+carga\b|correa\s+transportadora\b|tren\s+de\s+aterrizaje\b|baterias?\s+de\s+vuelo\b|mangueras?\s+gemelas\b|acoples?\s+rapidos\b|carrete\s+de\s+cable\b)/i.test(
                col0Lower
            ) &&
            !/\b(frenos?\b|tambores?\s+de\s+freno|s-?cam|abs\b|aceite\s+de|filtro\s+de|par\s+de\s+apriete)\b/i.test(
                col0Lower
            );

        if (!isExplicitRodadoCol0) continue;

        if (
            isWheeledTruckOrVehicle &&
            /\b(oruga|zapata|sprocket|rueda\s+guia|idler|cabilla|rodillo\s+(?:inferior|superior|de\s+oruga))\b/i.test(
                joinedLower
            )
        ) {
            continue;
        }
        if (traits.mobility === 'SELF_PROPELLED_TRACKED' && /\b(neumatico\s+radial|llanta\s+de\s+neumatico)\b/i.test(joinedLower)) {
            continue;
        }

        let category: OperationalCostMatrix['tires_and_undercarriage'][number]['category'] = 'NEUMATICO';
        if (/\b(tren\s+de\s+aterrizaje|bateria\s+de\s+vuelo|helice|rotor)\b/i.test(col0Lower)) {
            category = 'HELICE_ROTOR_TREN_ATERRIZAJE';
        } else if (/\b(manguera\s+gemela|acople\s+rapido|carrete|cable\s+de\s+izaje)\b/i.test(col0Lower)) {
            category = 'CABLE_IZAJE_CARRETE';
        } else if (/\b(oruga\s+de\s+goma|banda\s+de\s+goma|correa\s+transportadora)\b/i.test(col0Lower)) {
            category = 'ORUGA_GOMA';
        } else if (/\b(oruga\s+de\s+acero|zapata|cadena\s+de\s+oruga|link\s+assembly)\b/i.test(col0Lower)) {
            category = 'ORUGA_ACERO_ZAPATA';
        } else if (/\b(rodillo|rueda\s+guia|idler|sprocket|cabilla|maza|rodamiento\s+de\s+rueda|polin)\b/i.test(col0Lower)) {
            category = 'RODILLO_RUEDA_GUIA_SPROCKET';
        } else if (/\b(silentblock|elastomero|amortiguador\s+de\s+goma)\b/i.test(col0Lower)) {
            category = 'SOPORTE_ELASTOMERO';
        }

        let sizeOrCompoundSpec = '';
        let installedQty = '';
        let nominalPressureOrTension = '';
        let estimatedLife = '';
        let condemnationLimit = '';

        for (let idx = 1; idx < row.cells.length; idx++) {
            if (idx === cols.actionIdx) continue;
            const cell = row.cells[idx];
            const hdr = row.headers[idx] || '';
            if (isMissingMarker(cell)) continue;

            if (!installedQty) {
                const inlineQty = cell.match(/\b(\d{1,2}\s*(?:unidades?|unid\.?|neum[aá]ticos?|ruedas?|orugas?|zapatas?))\b/i);
                if (inlineQty) installedQty = inlineQty[1].trim();
            }

            if (
                cols.fluidOrSpecIdx === idx ||
                (/\b(\d{2,3}\/\d{2}\s*R\s*\d{2}(?:\.\d)?|\d{1,2}(?:\.\d{2})?\s*[x×R-]\s*\d{2}(?:\.\d)?|\d{3}\s*x\s*\d{2,3}(?:\.\d)?\s*x\s*\d{2}|TRA\s+L[-]?[2345]|PR\s*\d{2})\b/i.test(
                    cell
                ) &&
                    !sizeOrCompoundSpec)
            ) {
                sizeOrCompoundSpec = cell;
            } else if (
                cols.qtyIdx === idx ||
                (/^\d{1,3}\s*(?:unid\.?|unidades?|u\.?|neum[aá]ticos?|orugas?|zapatas?|rodillos?)$/i.test(cell.trim()) && !installedQty)
            ) {
                installedQty = cell;
            } else if (
                cols.pressureIdx === idx ||
                (/\b(\d+(?:[.,]\d+)?\s*(?:bar|psi|kpa)|comba\s+\d+\s*mm)\b/i.test(cell) && !nominalPressureOrTension)
            ) {
                nominalPressureOrTension = cell;
            } else if (
                row.pillarId === 'pauta_mantencion' &&
                (cols.intervalIdx === idx || /\b\d[\d.,]*\s*(?:h\b|hr|hrs|horas|km\b)\b/i.test(cell)) &&
                !estimatedLife
            ) {
                estimatedLife = cell;
            } else if (
                row.pillarId === 'pauta_mantencion' &&
                (cols.condemnIdx === idx || /\b(m[ií]n\.?\s*\d+(?:[.,]\d+)?\s*mm|100\s*%\s+desgaste|twi)\b/i.test(cell)) &&
                !condemnationLimit
            ) {
                condemnationLimit = cell;
            } else if (!sizeOrCompoundSpec && idx === 1 && !/\b(configuraci[oó]n\s+de\s+f[aá]brica|est[aá]ndar\s+oem)\b/i.test(cell)) {
                sizeOrCompoundSpec = cell;
            }
        }

        const displayName = /^(?:medida\s+de\s+neumatico(?:s)?(?:\s+estandar)?|neumaticos?\s+estandar)$/i.test(col0Lower)
            ? 'Neumáticos Estándar'
            : col0;
        const dedupKey = category === 'NEUMATICO' && displayName === 'Neumáticos Estándar'
            ? 'neumaticos_estandar'
            : stripAccentsLower(displayName);

        if (!installedQty && category === 'NEUMATICO' && !/\b(delanter|traser)\b/i.test(col0Lower)) {
            const inferredWheelCount = inferPhysicalWheelCountForSingleGlobalTireRow();
            if (inferredWheelCount) {
                installedQty = `${inferredWheelCount} unid.`;
            }
        }

        if (seenRodadoKeys.has(dedupKey)) {
            const existing = tiresAndUndercarriage.find(
                (t) =>
                    (category === 'NEUMATICO' && dedupKey === 'neumaticos_estandar' && t.component_name === 'Neumáticos Estándar') ||
                    stripAccentsLower(t.component_name) === dedupKey
            );
            if (existing) {
                if (isMissingMarker(existing.size_or_compound_spec) && sizeOrCompoundSpec) {
                    existing.size_or_compound_spec = sizeOrCompoundSpec;
                }
                if (isMissingMarker(existing.installed_qty) && installedQty) {
                    existing.installed_qty = installedQty;
                }
                if (isMissingMarker(existing.nominal_pressure_or_tension) && nominalPressureOrTension) {
                    existing.nominal_pressure_or_tension = nominalPressureOrTension;
                }
                if (isMissingMarker(existing.estimated_life) && estimatedLife) {
                    existing.estimated_life = estimatedLife;
                }
                if (isMissingMarker(existing.condemnation_limit) && condemnationLimit) {
                    existing.condemnation_limit = condemnationLimit;
                }
            }
            continue;
        }
        seenRodadoKeys.add(dedupKey);

        tiresAndUndercarriage.push({
            component_name: displayName,
            category,
            size_or_compound_spec: sizeOrCompoundSpec || MISSING_FULL_TECH_SPEC,
            installed_qty: installedQty || MISSING_FULL_TECH_SPEC,
            nominal_pressure_or_tension: nominalPressureOrTension || MISSING_FULL_TECH_SPEC,
            estimated_life: estimatedLife || MISSING_FULL_TECH_SPEC,
            condemnation_limit: condemnationLimit || MISSING_FULL_TECH_SPEC,
            source_item_title: row.sourceItemTitle,
        });
    }

    // Garantía ad-hoc: todo equipo sobre neumáticos debe declarar su línea de neumáticos en el listado
    if (
        (traits.mobility === 'SELF_PROPELLED_WHEELED' ||
            (traits.mobility === 'TOWED_TRAILER' && Boolean(factoryTireOrTrackEquip))) &&
        !tiresAndUndercarriage.some((t) => t.category === 'NEUMATICO')
    ) {
        const inferredWheelCount = inferPhysicalWheelCountForSingleGlobalTireRow();
        tiresAndUndercarriage.push({
            component_name: 'Neumáticos Estándar',
            category: 'NEUMATICO',
            size_or_compound_spec: factoryTireOrTrackEquip || MISSING_FULL_TECH_SPEC,
            installed_qty: inferredWheelCount ? `${inferredWheelCount} unid.` : MISSING_FULL_TECH_SPEC,
            nominal_pressure_or_tension: MISSING_FULL_TECH_SPEC,
            estimated_life: MISSING_FULL_TECH_SPEC,
            condemnation_limit: MISSING_FULL_TECH_SPEC,
            source_item_title: capexSourceItemTitle || '01 · Ficha Técnica OEM',
        });
    }

    // ── 8. CONSTRUCCIÓN DE NÓMINA CANÓNICA DE INSUMOS (`supply_items[]`) ─────
    const supplyItems: EquipmentSupplyLineItem[] = [];

    // 8.1 Combustible / Energía primaria operativa
    if (
        huntedConsumptionItems.length > 0 &&
        baseEnergyProfile.energy_source !== 'NO_DECLARADO' &&
        baseEnergyProfile.energy_source !== 'MANUAL_MECANICO' &&
        baseEnergyProfile.energy_source !== 'REMOLCADO_SIN_PROPULSION_PROPIA'
    ) {
        const isThermal =
            baseEnergyProfile.energy_source === 'DIESEL' ||
            baseEnergyProfile.energy_source === 'GASOLINA' ||
            baseEnergyProfile.energy_source === 'GLP_GNV' ||
            baseEnergyProfile.energy_source === 'HIBRIDO_DIESEL_ELECTRICO' ||
            baseEnergyProfile.energy_source === 'DUAL_FUEL_DIESEL_GAS';
        const fuelName =
            baseEnergyProfile.energy_source === 'DIESEL'
                ? 'Combustible Diésel'
                : baseEnergyProfile.energy_source === 'GASOLINA'
                ? 'Combustible Gasolina'
                : baseEnergyProfile.energy_source === 'GLP_GNV'
                ? 'Gas Combustible (GLP/GNV)'
                : baseEnergyProfile.energy_source === 'ELECTRICO_RED_AC' || baseEnergyProfile.energy_source === 'ELECTRICO_BATERIA_BEV'
                ? 'Energía Eléctrica de Operación'
                : baseEnergyProfile.energy_source;

        const medLoadRaw =
            baseEnergyProfile.hourly_consumption_by_load.medium_load_50_65pct ||
            baseEnergyProfile.hourly_consumption_by_load.high_load_80_100pct ||
            baseEnergyProfile.hourly_consumption_by_load.low_load_25_35pct ||
            baseEnergyProfile.hourly_consumption_by_load.idle_or_pto;
        const rateMatch = medLoadRaw?.match(/(\d+(?:[.,]\d+)?)\s*(L\/h|kWh\/h)\b/i);
        const hourlyVal = rateMatch ? parseFloat(rateMatch[1].replace(',', '.')) : null;
        const hourlyBasis: 'L/h' | 'kWh/h' | null = rateMatch
            ? rateMatch[2].toLowerCase().startsWith('kwh')
                ? 'kWh/h'
                : 'L/h'
            : null;
        const rateCalc = computeNormalizedRatePer1000h({
            numericQty: null,
            qtyUnit: null,
            intervalValue: hourlyVal,
            intervalBasis: hourlyBasis,
        });

        const tankParsed = baseEnergyProfile.storage_and_autonomy.tank_or_battery_capacity
            ? extractNumericQuantity(baseEnergyProfile.storage_and_autonomy.tank_or_battery_capacity)
            : { displayQty: '', numericQty: null, qtyUnit: null };

        const notes: string[] = [];
        if (tankParsed.numericQty !== null) notes.push(`Estanque: ${tankParsed.displayQty}`);
        if (baseEnergyProfile.hourly_consumption_by_load.high_load_80_100pct) {
            notes.push(`Carga alta: ${cleanMarkdownCell(baseEnergyProfile.hourly_consumption_by_load.high_load_80_100pct)}`);
        }
        if (baseEnergyProfile.road_haul_efficiency.highway_km_per_liter || baseEnergyProfile.road_haul_efficiency.km_per_liter) {
            notes.push(
                `Ruta: ${baseEnergyProfile.road_haul_efficiency.highway_km_per_liter || baseEnergyProfile.road_haul_efficiency.km_per_liter}`
            );
        }
        if (baseEnergyProfile.road_haul_efficiency.offroad_km_per_liter) {
            notes.push(`Faena: ${baseEnergyProfile.road_haul_efficiency.offroad_km_per_liter}`);
        }

        const roadRateRaw =
            baseEnergyProfile.road_haul_efficiency.highway_km_per_liter ||
            baseEnergyProfile.road_haul_efficiency.km_per_liter;
        const intervalDisplay =
            hourlyVal !== null && hourlyBasis
                ? `${formatDecimalEs(hourlyVal)} ${hourlyBasis}`
                : roadRateRaw || null;

        supplyItems.push({
            item_key: 'combustible_energia_primaria',
            family: 'COMBUSTIBLE',
            item_name: fuelName,
            subsystem: engineModelFromFicha ? `Motor ${engineModelFromFicha}` : 'Sistema de Alimentación Primaria',
            oem_spec_or_size: fuelSpecFromMant || (isThermal ? baseEnergyProfile.energy_spec_label || baseEnergyProfile.energy_source : baseEnergyProfile.energy_source),
            oem_part_number: null,
            change_or_installed_qty: tankParsed.numericQty !== null ? tankParsed.displayQty : null,
            numeric_qty: tankParsed.numericQty,
            qty_unit: tankParsed.qtyUnit,
            change_interval_or_life: intervalDisplay,
            interval_value: hourlyVal,
            interval_basis: hourlyBasis || (roadRateRaw ? 'km/L' : null),
            prorated_per_1000h: rateCalc.proratedText,
            numeric_rate_per_1000h: rateCalc.numericRate,
            service_note: notes.length > 0 ? notes.join(' · ') : null,
            spec_conflict: null,
            source_pillar: 'ficha_tecnica',
            source_item_title: huntedConsumptionItems[0]?.title || '01 · Ficha Técnica OEM',
        });
    }

    if (baseEnergyProfile.def_adblue_consumption.requires_def) {
        supplyItems.push({
            item_key: 'postratamiento_def_adblue',
            family: 'POSTRATAMIENTO',
            item_name: 'Fluido de Escape Diésel (DEF / AdBlue)',
            subsystem: 'Sistema Postratamiento SCR',
            oem_spec_or_size: 'ISO 22241 (Urea automotriz 32,5%)',
            oem_part_number: null,
            change_or_installed_qty: baseEnergyProfile.def_adblue_consumption.tank_capacity_liters || null,
            numeric_qty: null,
            qty_unit: null,
            change_interval_or_life: baseEnergyProfile.def_adblue_consumption.consumption_pct_of_fuel || null,
            interval_value: null,
            interval_basis: 'continuo',
            prorated_per_1000h: null,
            numeric_rate_per_1000h: null,
            service_note: null,
            spec_conflict: null,
            source_pillar: 'ficha_tecnica',
            source_item_title: huntedConsumptionItems[0]?.title || '01 · Ficha Técnica OEM',
        });
    }

    // 8.2 Fluidos, Lubricantes, Refrigerante y Grasa
    for (const fl of fluidMap.values()) {
        const rate = computeNormalizedRatePer1000h({
            numericQty: fl.numericQty,
            qtyUnit: fl.qtyUnit,
            intervalValue: fl.intervalValue,
            intervalBasis: fl.intervalBasis,
        });
        const rawSpecParts = [fl.fluidSpec, fl.viscosity].filter(
            (x): x is string => Boolean(x) && !isMissingMarker(x)
        );
        const dedupSpecParts: string[] = [];
        for (const part of rawSpecParts) {
            const lower = part.toLowerCase();
            if (dedupSpecParts.some((kept) => kept.toLowerCase().includes(lower))) continue;
            dedupSpecParts.push(part);
        }
        const specCombined = dedupSpecParts.join(' · ') || null;
        supplyItems.push({
            item_key: fl.key,
            family: fl.family,
            item_name: fl.itemName,
            subsystem: fl.subsystem,
            oem_spec_or_size: specCombined,
            oem_part_number: null,
            change_or_installed_qty: fl.qtyDisplay,
            numeric_qty: fl.numericQty,
            qty_unit: fl.qtyUnit,
            change_interval_or_life: fl.intervalDisplay,
            interval_value: fl.intervalValue,
            interval_basis: fl.intervalBasis,
            prorated_per_1000h: rate.proratedText,
            numeric_rate_per_1000h: rate.numericRate,
            service_note: fl.extraNote,
            spec_conflict: fl.specConflict,
            source_pillar: fl.sourcePillar,
            source_item_title: fl.sourceItemTitle,
        });
    }

    // 8.3 Filtros, Respiraderos, Sellos y Postratamiento DPF
    for (const pt of partMap.values()) {
        const rate = computeNormalizedRatePer1000h({
            numericQty: pt.numericQty,
            qtyUnit: pt.qtyUnit,
            intervalValue: pt.intervalValue,
            intervalBasis: pt.intervalBasis,
            eventLabelPlural: pt.isDpfService ? 'servicios' : 'cambios',
            eventLabelSingular: pt.isDpfService ? 'servicio' : 'cambio',
        });
        supplyItems.push({
            item_key: pt.key,
            family: pt.supplyFamily,
            item_name: pt.componentName,
            subsystem: pt.system || 'Subsistema de Motor / Hidráulico',
            oem_spec_or_size: pt.isDpfService ? 'Servicio limpieza térmica/neumática cenizas DPF' : null,
            oem_part_number: pt.oemPartNumber,
            change_or_installed_qty: pt.qtyDisplay,
            numeric_qty: pt.numericQty,
            qty_unit: pt.qtyUnit,
            change_interval_or_life: pt.intervalDisplay,
            interval_value: pt.intervalValue,
            interval_basis: pt.intervalBasis,
            prorated_per_1000h: rate.proratedText,
            numeric_rate_per_1000h: rate.numericRate,
            service_note: pt.conditionNote,
            spec_conflict: null,
            source_pillar: 'pauta_mantencion',
            source_item_title: pt.sourceItemTitle,
        });
    }

    // 8.4 Neumáticos / Rodaje
    for (const sp of tiresAndUndercarriage) {
        const parsedQty = !isMissingMarker(sp.installed_qty)
            ? extractNumericQuantity(sp.installed_qty)
            : { displayQty: MISSING_FULL_TECH_SPEC, numericQty: null, qtyUnit: null };
        const parsedLife = !isMissingMarker(sp.estimated_life)
            ? extractPrimaryChangeInterval(sp.estimated_life)
            : { intervalText: MISSING_FULL_TECH_SPEC, intervalValue: null, intervalBasis: null, samplingNote: null, conditionNote: null };
        const rate = computeNormalizedRatePer1000h({
            numericQty: parsedQty.numericQty,
            qtyUnit: parsedQty.qtyUnit,
            intervalValue: parsedLife.intervalValue,
            intervalBasis: parsedLife.intervalBasis,
        });
        const rodadoNotes: string[] = [];
        if (!isMissingMarker(sp.nominal_pressure_or_tension)) {
            rodadoNotes.push(`Presión/Tensión: ${sp.nominal_pressure_or_tension}`);
        }
        if (!isMissingMarker(sp.condemnation_limit)) {
            rodadoNotes.push(`Condena: ${sp.condemnation_limit}`);
        }

        const fam: SupplyItemFamily = sp.category === 'NEUMATICO' ? 'NEUMATICO' : 'RODAJE';
        supplyItems.push({
            item_key: `rodado_${stripAccentsLower(sp.component_name).replace(/[^a-z0-9]+/g, '_')}`,
            family: fam,
            item_name: sp.component_name,
            subsystem: fam === 'NEUMATICO' ? 'Rodado del Equipo' : 'Tren de Rodaje / Apoyo',
            oem_spec_or_size: !isMissingMarker(sp.size_or_compound_spec) ? sp.size_or_compound_spec : null,
            oem_part_number: null,
            change_or_installed_qty: parsedQty.numericQty !== null ? parsedQty.displayQty : null,
            numeric_qty: parsedQty.numericQty,
            qty_unit: parsedQty.qtyUnit,
            change_interval_or_life:
                parsedLife.intervalText !== MISSING_FULL_TECH_SPEC ? parsedLife.intervalText : null,
            interval_value: parsedLife.intervalValue,
            interval_basis: parsedLife.intervalBasis,
            prorated_per_1000h: rate.proratedText,
            numeric_rate_per_1000h: rate.numericRate,
            service_note: rodadoNotes.length > 0 ? rodadoNotes.join(' · ') : null,
            spec_conflict: null,
            source_pillar: /ficha/i.test(sp.source_item_title) ? 'ficha_tecnica' : 'pauta_mantencion',
            source_item_title: sp.source_item_title,
        });
    }

    // 8.5 Elementos de Desgaste (`DESGASTE`)
    for (const wp of wearPartsGet) {
        const parsedQty = !isMissingMarker(wp.installed_qty)
            ? extractNumericQuantity(wp.installed_qty)
            : { displayQty: MISSING_FULL_TECH_SPEC, numericQty: null, qtyUnit: null };
        const parsedLife = !isMissingMarker(wp.estimated_life)
            ? extractPrimaryChangeInterval(wp.estimated_life)
            : { intervalText: MISSING_FULL_TECH_SPEC, intervalValue: null, intervalBasis: null, samplingNote: null, conditionNote: null };
        const rate = computeNormalizedRatePer1000h({
            numericQty: parsedQty.numericQty,
            qtyUnit: parsedQty.qtyUnit,
            intervalValue: parsedLife.intervalValue,
            intervalBasis: parsedLife.intervalBasis,
        });
        const oemCode = !isMissingMarker(wp.oem_spec_or_code)
            ? extractValidOemPartNumber(wp.oem_spec_or_code, false)
            : null;
        supplyItems.push({
            item_key: `desgaste_${stripAccentsLower(wp.part_name).replace(/[^a-z0-9]+/g, '_')}`,
            family: 'DESGASTE',
            item_name: wp.part_name,
            subsystem: !isMissingMarker(wp.work_tool_zone) ? wp.work_tool_zone : 'Implemento / Subsistema de Trabajo',
            oem_spec_or_size: !isMissingMarker(wp.oem_spec_or_code) ? wp.oem_spec_or_code : null,
            oem_part_number: oemCode,
            change_or_installed_qty: parsedQty.numericQty !== null ? parsedQty.displayQty : null,
            numeric_qty: parsedQty.numericQty,
            qty_unit: parsedQty.qtyUnit,
            change_interval_or_life:
                parsedLife.intervalText !== MISSING_FULL_TECH_SPEC ? parsedLife.intervalText : null,
            interval_value: parsedLife.intervalValue,
            interval_basis: parsedLife.intervalBasis,
            prorated_per_1000h: rate.proratedText,
            numeric_rate_per_1000h: rate.numericRate,
            service_note: !isMissingMarker(wp.condemnation_limit) ? `Condena: ${wp.condemnation_limit}` : null,
            spec_conflict: null,
            source_pillar: 'pauta_mantencion',
            source_item_title: wp.source_item_title,
        });
    }

    // ── 9. SÍNTESIS LEGADA PM Y ESTADO DE COMPLETITUD ────────────────────────
    const scheduledPmKitsSummary: OperationalCostMatrix['scheduled_pm_kits_summary'] = [];
    if (mantItems.length > 0) {
        const pmStagesOrder: Array<{ code: string; label: string; regex: RegExp }> = [
            { code: 'DIARIO / SEMANAL', label: '10 h – 50 h / Semanal (5.000 km)', regex: /\b(10\s*h|50\s*h|diario|semanal|5\.?000\s*km)\b/i },
            { code: 'PM1 (MENOR)', label: '250 h / 10.000 km', regex: /\b(pm\s*1\b|250\s*h|10\.?000\s*km|mensual)\b/i },
            { code: 'PM2 (INTERMEDIO)', label: '500 h / 20.000 km', regex: /\b(pm\s*2\b|500\s*h|20\.?000\s*km|trimestral)\b/i },
            { code: 'PM3 (MAYOR)', label: '1.000 h / 40.000 km', regex: /\b(pm\s*3\b|1\.?000\s*h|40\.?000\s*km|semestral)\b/i },
            { code: 'PM4 (OVERHAUL / 2.000 h+)', label: '2.000 h / 80.000–100.000 km', regex: /\b(pm\s*4\b|2\.?000\s*h|4\.?000\s*h|80\.?000\s*km|100\.?000\s*km|overhaul|anual)\b/i },
        ];

        for (const st of pmStagesOrder) {
            const matchingFluids = periodicFluids
                .filter((f) => !isMissingMarker(f.interval) && st.regex.test(f.interval))
                .map((f) => `${f.compartment} (${f.capacity_per_change})`)
                .slice(0, 5);
            const matchingFilters = periodicFiltersAndSeals
                .filter((fl) => st.regex.test(`${fl.interval} ${fl.pm_stage}`))
                .map((fl) => `${fl.component_name}${!isMissingMarker(fl.oem_part_number) ? ` [${fl.oem_part_number}]` : ''}`)
                .slice(0, 6);
            const matchingWearOrRodado = [
                ...wearPartsGet
                    .filter((w) => !isMissingMarker(w.estimated_life) && st.regex.test(w.estimated_life))
                    .map((w) => w.part_name),
                ...tiresAndUndercarriage
                    .filter((t) => !isMissingMarker(t.estimated_life) && st.regex.test(t.estimated_life))
                    .map((t) => t.component_name),
            ].slice(0, 4);

            if (matchingFluids.length > 0 || matchingFilters.length > 0 || matchingWearOrRodado.length > 0) {
                scheduledPmKitsSummary.push({
                    pm_code: st.code,
                    interval: st.label,
                    fluids_summary: matchingFluids.length > 0 ? matchingFluids.join(' · ') : MISSING_FULL_TECH_SPEC,
                    filters_and_seals_summary: matchingFilters.length > 0 ? matchingFilters.join(' · ') : MISSING_FULL_TECH_SPEC,
                    wear_and_rodado_checks: matchingWearOrRodado.length > 0 ? matchingWearOrRodado.join(' · ') : MISSING_FULL_TECH_SPEC,
                });
            }
        }
    }

    const hasEnergyData =
        huntedConsumptionItems.length > 0 &&
        (baseEnergyProfile.energy_source !== 'NO_DECLARADO' ||
            Boolean(baseEnergyProfile.hourly_consumption_by_load.medium_load_50_65pct) ||
            Boolean(baseEnergyProfile.road_haul_efficiency.km_per_liter) ||
            Boolean(baseEnergyProfile.pneumatic_or_hydraulic_flow));
    const hasCapexData = Boolean(referenceNewPriceUsd || referenceNewPriceClp || economicLifeHours || economicLifeKm);
    const hasMaintenanceTables =
        mantItems.length > 0 &&
        (periodicFluids.some((f) => !isMissingMarker(f.interval)) ||
            periodicFiltersAndSeals.length > 0 ||
            wearPartsGet.length > 0 ||
            tiresAndUndercarriage.some((t) => !isMissingMarker(t.estimated_life)));

    let completenessStatus: OperationalCostMatrix['completeness_status'] = 'EMPTY';
    if (hasEnergyData && hasMaintenanceTables && (hasCapexData || periodicFiltersAndSeals.length >= 1)) {
        completenessStatus = 'COMPLETE';
    } else if (supplyItems.length > 0 || hasEnergyData || hasCapexData || periodicFluids.length > 0 || tiresAndUndercarriage.length > 0) {
        completenessStatus = 'PARTIAL';
    }

    return {
        version: COST_MATRIX_SCHEMA_VERSION,
        compiled_at: new Date().toISOString(),
        source_merkle_root_sha256: sourceMerkleRoot,
        completeness_status: completenessStatus,
        taxonomy_meta: taxonomyMeta,
        supply_items: supplyItems,
        capex_and_depreciation: {
            reference_new_price_usd: referenceNewPriceUsd,
            reference_new_price_clp: referenceNewPriceClp,
            price_condition_and_year: priceConditionAndYear,
            economic_life_hours: economicLifeHours,
            economic_life_km: economicLifeKm,
            economic_life_years: economicLifeYears,
            residual_value_pct: residualValuePct,
            hourly_depreciation_base: hourlyDepreciationBase,
            factory_tire_or_track_equip: factoryTireOrTrackEquip,
            factory_work_tool_equip: factoryWorkToolEquip,
            source_item_title: capexSourceItemTitle,
        },
        energy_consumption: baseEnergyProfile,
        periodic_fluids: periodicFluids,
        periodic_filters_and_seals: periodicFiltersAndSeals,
        wear_parts_get: wearPartsGet,
        tires_and_undercarriage: tiresAndUndercarriage,
        scheduled_pm_kits_summary: scheduledPmKitsSummary,
    };
}

/**
 * Hidrata `ficha_tecnica` y `pauta_mantencion` vía `VaultPersistenceService` (`Dual-Read`),
 * compila determinísticamente su `OperationalCostMatrix v4.0` y la persiste en `derived/cost_matrix`
 * manteniendo ligero el documento raíz (`Anti-1MiB`).
 */
export async function buildAndPersistEquipmentCostMatrix(
    globalAssetId: string
): Promise<OperationalCostMatrix> {
    const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
    const assetData = (hydrated.data || {}) as Record<string, any>;
    const fichaDoc = (assetData.knowledge_vault?.ficha_tecnica || null) as PillarDocument | null;
    const mantencionDoc = (assetData.knowledge_vault?.pauta_mantencion || null) as PillarDocument | null;

    const matrix = compileEquipmentCostMatrixFromPillars({
        assetData,
        fichaDoc,
        mantencionDoc,
    });

    if (hydrated.exists) {
        const physicalTraits = AssetOntologyEngine.inferAssetPhysicalTraits({
            type_key: assetData.equipment_type_key,
            canonical_type_es: assetData.tipo_equipo,
            categoria_equipo: assetData.categoria_equipo,
            archetype_id: assetData.archetype_id,
            make_oficial: assetData.make_oficial || assetData.make,
            model_oficial: assetData.model_oficial || assetData.model,
            caracteristicas_principales: assetData.caracteristicas_principales,
            ambiente_operativo: assetData.ambiente_operativo,
            contexto_operativo: assetData.contexto_operativo,
            existing_traits: assetData.physical_traits,
        });
        const configurationProfile = inferAssetConfigurationProfile({
            make_oficial: assetData.make_oficial || assetData.make,
            model_oficial: assetData.model_oficial || assetData.model,
            tipo_equipo: assetData.tipo_equipo,
            categoria_equipo: assetData.categoria_equipo,
            version: assetData.version,
            physical_traits: physicalTraits,
            canonical_specs: assetData.canonical_specs,
            caracteristicas_principales: assetData.caracteristicas_principales,
            chassis_versions: assetData.chassis_versions,
            existing_profile: assetData.configuration_profile,
        });
        await VaultPersistenceService.saveDerivedCostMatrix(globalAssetId, matrix, {
            energy_consumption_profile: matrix.energy_consumption,
            physical_traits: physicalTraits,
            configuration_profile: configurationProfile,
        });
    }

    return matrix;
}
