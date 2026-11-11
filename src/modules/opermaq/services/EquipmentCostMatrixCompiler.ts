import crypto from 'crypto';
import type {
    OperationalCostMatrix,
    PillarDocument,
    PillarItem,
} from '../types/vault.types';
import {
    deriveEnergyConsumptionProfile,
    MISSING_FULL_TECH_SPEC,
} from '../utils/canonicalArchetypeSpecs';
import { inferAssetConfigurationProfile } from '../utils/lockedVariantDirective';
import { AssetOntologyEngine } from './AssetOntologyEngine';
import { VaultPersistenceService } from './VaultPersistenceService';

/**
 * EQUIPMENT COST MATRIX COMPILER v1.0 (CERO ESPECULACIÓN IA — SÍNTESIS DETERMINISTA AUTOMÁTICA)
 *
 * Compila sin interacción humana la Matriz de Consumos, Insumos, Recambios Periódicos,
 * Elementos de Desgaste (`GET`), Tren de Rodado y Base CAPEX/Depreciación de cualquier activo
 * registrado en OPERMAQ (desde una Fiat Fiorino, Perforadora YT27 o Carro de Arrastre de Combustible
 * hasta un Chancador Móvil o Pala Eléctrica Komatsu).
 *
 * Reglas de Gobernanza GEMINI.md:
 * 1. Tolerancia Cero a la Alucinación: Solo extrae parámetros, códigos OEM, capacidades, intervalos
 *    y costos presentes en los capítulos verificados de `01 · Ficha Técnica OEM` y `03 · Pauta de Mantención`.
 * 2. Cualquier campo no declarado en las fuentes figura como `null` (proyectado en UI como
 *    `[Información técnica no declarada en ficha]`).
 * 3. Persiste el contrato tipado `operational_cost_matrix` en `global_asset_catalog/{id}` para
 *    consumo directo por la pestaña automática de UI y por aplicaciones paralelas de control de costos.
 */

interface MarkdownTableRowParsed {
    headers: string[];
    cells: string[];
    sourceItemTitle: string;
    pillarId: 'ficha_tecnica' | 'pauta_mantencion';
}

function cleanMarkdownCell(raw: string): string {
    return String(raw || '')
        .replace(/\[F\d+(?:\s*,\s*F\d+)*\]/gi, '')
        .replace(/\[S[ÍI]MBOLO:[^\]]+\]/gi, '')
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
    const norm = val.trim().toLowerCase();
    return (
        norm.length === 0 ||
        norm === '-' ||
        norm === '—' ||
        norm === 'n/a' ||
        norm.includes('no declarada en ficha') ||
        norm.includes('no declarado en ficha') ||
        norm.includes('pendiente de registro')
    );
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

            // Detectar fila separadora `| :--- | :--- |`
            if (rawCells.every((c) => /^[:\-\s]+$/.test(c))) {
                inTable = true;
                continue;
            }

            // Si la siguiente línea es separadora, esta línea es el encabezado
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

function computeProratedPer1000Hours(capacityStr: string, intervalStr: string): string | null {
    if (isMissingMarker(capacityStr) || isMissingMarker(intervalStr)) return null;

    const capMatch = capacityStr.match(/(\d+(?:[.,]\d+)?)\s*(L|litros?|kg|ml|g)\b/i);
    const intMatch = intervalStr.match(/(\d+(?:\.\d{3})*(?:[.,]\d+)?)\s*(h|hr|hrs|horas)\b/i);
    if (!capMatch || !intMatch) return null;

    const rawCap = parseFloat(capMatch[1].replace(',', '.'));
    const unit = capMatch[2].toLowerCase();
    const rawHours = parseFloat(intMatch[1].replace(/\./g, '').replace(',', '.'));

    if (!Number.isFinite(rawCap) || !Number.isFinite(rawHours) || rawCap <= 0 || rawHours <= 0) {
        return null;
    }

    const factor = 1000 / rawHours;
    const prorated = rawCap * factor;
    const normUnit = unit.startsWith('l') ? 'L' : unit === 'kg' ? 'kg' : unit;
    const formatted =
        prorated >= 10 ? prorated.toFixed(1).replace('.', ',') : prorated.toFixed(2).replace('.', ',');
    return `${formatted} ${normUnit} / 1.000 h`;
}

function computeLinearHourlyDepreciationIfPossible(
    capexUsdStr: string | null,
    lifeHoursStr: string | null,
    residualPctStr: string | null
): string | null {
    // Prohibido inventar porcentaje de valor residual (ej. 15%) si no fue declarado en la ficha cazada
    if (isMissingMarker(capexUsdStr) || isMissingMarker(lifeHoursStr) || isMissingMarker(residualPctStr)) {
        return null;
    }

    const usdClean = String(capexUsdStr)
        .replace(/US\$|USD|\$/gi, '')
        .trim();
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

    return `${hourlyUsd.toFixed(2).replace('.', ',')} USD/h (Base lineal est.)`;
}

/**
 * Compila de forma pura y determinista la `OperationalCostMatrix` EXCLUSIVAMENTE a partir de los capítulos
 * efectivamente cazados (`content_status === 'COMPLETADO'`) en `01 · Ficha Técnica OEM` y `03 · Pauta de Mantención CMRP`.
 *
 * Compuerta Zero-Hallucination:
 * - Prohibido filtrar `canonical_specs`, `caracteristicas_principales` o `energy_consumption_profile` preliminares de Etapa 1.
 * - Prohibido cruzar filas descriptivas de `01 · Ficha Técnica` hacia las Tablas IV (Filtros/Sellos), V (Desgaste) o VII (Kits PM).
 * - Prohibido inventar valores por defecto (`'1 unid.'`, `'Según pauta PM'`, `'Pauta Preventiva'`, `'Sistema Principal'`).
 */
export function compileEquipmentCostMatrixFromPillars(params: {
    assetData: Record<string, any>;
    fichaDoc?: PillarDocument | null;
    mantencionDoc?: PillarDocument | null;
}): OperationalCostMatrix {
    const { assetData, fichaDoc, mantencionDoc } = params;
    const fichaItems = Array.isArray(fichaDoc?.items)
        ? fichaDoc!.items.filter((i) => isVerifiedHuntedPillarItem(i))
        : [];
    const mantItems = Array.isArray(mantencionDoc?.items)
        ? mantencionDoc!.items.filter((i) => isVerifiedHuntedPillarItem(i))
        : [];

    const fichaMarkdown = fichaItems.map((i) => `### ${i.title}\n${i.content || ''}`).join('\n\n');
    const mantMarkdown = mantItems.map((i) => `### ${i.title}\n${i.content || ''}`).join('\n\n');

    const merkleSeed = `${fichaMarkdown}\n===MANT===\n${mantMarkdown}`;
    const sourceMerkleRoot =
        fichaItems.length > 0 || mantItems.length > 0
            ? crypto.createHash('sha256').update(merkleSeed).digest('hex')
            : null;

    const fichaRows = extractMarkdownTableRowsFromItems(fichaItems, 'ficha_tecnica');
    const mantRows = extractMarkdownTableRowsFromItems(mantItems, 'pauta_mantencion');

    // ── 1. CAPEX, VIDA ECONÓMICA Y DEPRECIACIÓN (Exclusivamente Pilar 01 cazado) ──
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

    for (const row of fichaRows) {
        const paramCol = (row.cells[0] || '').toLowerCase();
        const valCol = row.cells[1] || '';
        const extraCol = row.cells.slice(2).join(' · ');
        const combinedVal = [valCol, extraCol].filter((x) => !isMissingMarker(x)).join(' · ');

        if (isMissingMarker(valCol)) continue;

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
            if (!economicLifeHours && !economicLifeKm && !economicLifeYears) {
                economicLifeHours = valCol;
                capexSourceItemTitle = capexSourceItemTitle || row.sourceItemTitle;
            }
        } else if (/\b(valor\s+residual|residual\s+referencial|salvamento|reventa)\b/i.test(paramCol) && !residualValuePct) {
            residualValuePct = valCol;
            capexSourceItemTitle = capexSourceItemTitle || row.sourceItemTitle;
        } else if (/\b(depreciaci[oó]n\s+lineal|tasa\s+de\s+depreciaci[oó]n|base\s+de\s+depreciaci[oó]n|costo\s+horario\s+de\s+posesi[oó]n)\b/i.test(paramCol) && !hourlyDepreciationBase) {
            hourlyDepreciationBase = valCol;
            capexSourceItemTitle = capexSourceItemTitle || row.sourceItemTitle;
        } else if (
            /^(?:neum[aá]ticos?\s+(?:est[aá]ndar|delanteros?|traseros?)|medida\s+de\s+neum[aá]ticos?|dotaci[oó]n\s+(?:est[aá]ndar\s+)?de\s+rodado|orugas?\s+est[aá]ndar|zapatas?\s+est[aá]ndar)\b/i.test(
                paramCol.trim()
            ) &&
            !factoryTireOrTrackEquip
        ) {
            factoryTireOrTrackEquip = valCol;
        } else if (
            /^(?:dotaci[oó]n\s+(?:est[aá]ndar\s+)?(?:herramienta|de\s+[oó]rgano)|balde\s+est[aá]ndar|hoja\s+est[aá]ndar|capacidad\s+de\s+(?:balde|tolva|estanque|cuchara))\b/i.test(
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

    // ── 2. CONSUMOS ENERGÉTICOS Y OPERACIONALES CONTINUOS (Exclusivamente capítulos cazados de Pilar 01) ──
    // Compuerta Zero-Hallucination: solo se procesan capítulos de consumos efectivamente cazados en `01 · Ficha Técnica`.
    // No se inyectan `canonical_specs`, `caracteristicas_principales` ni `existingProfile` preliminares de Etapa 1.
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
    const taxonomyMeta = AssetOntologyEngine.buildDynamicCostMatrixTaxonomy(
        traits,
        assetData.tipo_equipo
    );

    const huntedConsumptionItems = fichaItems.filter((it) =>
        /\b(consumos?\s+de\s+(?:combustible|energ[ií]a|aire)|matriz\s+energ[eé]tica|rendimiento\s+vial|autonom[ií]a\s+operativa|condici[oó]n\s+remolcada|suministro\s+hidr[aá]ulico|energ[ií]a\s+en\s+bater[ií]as|capacidad\s+de\s+bater[ií]as|alimentaci[oó]n\s+el[eé]ctrica|accionamiento\s+mec[aá]nico|demanda\s+de\s+aire)\b/i.test(
            `${it.title || ''} ${it.section || ''}`
        )
    );
    const consumptionMarkdownOnly = huntedConsumptionItems
        .map((i) => `### ${i.title}\n${i.content || ''}`)
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

    // Si aún no se ha cazado el capítulo de consumos en `01 · Ficha Técnica`, forzar estado limpio NO_DECLARADO
    if (huntedConsumptionItems.length === 0) {
        baseEnergyProfile.energy_source = 'NO_DECLARADO';
        baseEnergyProfile.energy_spec_label = null;
    }

    const assetIdentityText = `${assetData.make_model || ''} ${assetData.make || ''} ${assetData.model || ''} ${assetData.tipo_equipo || ''} ${assetData.categoria_equipo || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const isWheeledTruckOrVehicle =
        traits.mobility === 'SELF_PROPELLED_WHEELED' &&
        (traits.functional_domain === 'HAULAGE_AND_TRANSPORT' ||
            traits.functional_domain === 'VOCATIONAL_SERVICE_SUPPORT');
    const isTrackedMachine = traits.mobility === 'SELF_PROPELLED_TRACKED';
        /\b(orugas|excavadora\s+hidraulica|bulldozer|tractor\s+sobre\s+orugas|ctl\b|pala\s+electrica|pala\s+hidraulica|fresadora)\b/i.test(
            assetIdentityText
        ) && !/\b(neumaticos|ruedas|camion|camioneta)\b/i.test(assetIdentityText);

    // Enriquecer rendimiento vial (Carretera vs Fuera de Carretera), autonomía y cargas horarias desde las filas del capítulo de consumos cazado
    for (const row of consumptionRowsOnly) {
        const col0 = (row.cells[0] || '').toLowerCase();
        const col1 = row.cells[1] || '';
        const col2 = row.cells[2] || '';
        const combinedVal = [col1, col2].filter((x) => !isMissingMarker(x)).join(' · ');
        if (isMissingMarker(col1)) continue;

        // a) Rendimiento por kilómetro en Carretera vs. Fuera de Carretera / Faena
        if (/\b(rendimiento\s+vial|rendimiento\s+en\s+(?:ruta|carretera|faena)|km\s*\/\s*l\b|l\s*\/\s*100\s*km)\b/i.test(`${col0} ${col1}`)) {
            const kmlMatch = combinedVal.match(
                /(\d+(?:[.,]\d+)?(?:\s*(?:a|-|–)\s*\d+(?:[.,]\d+)?)?\s*km\s*\/\s*L\b)/i
            );
            const l100Match = combinedVal.match(
                /(\d+(?:[.,]\d+)?(?:\s*(?:a|-|–)\s*\d+(?:[.,]\d+)?)?\s*L\s*\/\s*100\s*km\b)/i
            );
            const isOffRoadRow =
                /\b(urbano|faena|faenero|fuera\s+de\s+carretera|off[\s-]*road|rampa|pesado|ciclo\s+severo|interior\s+mina)\b/i.test(
                    `${col0} ${col2}`
                ) && !/\b(homologado\s*\(\s*carretera)\b/i.test(col0);
            const isHighwayRow =
                /\b(homologado|carretera|autopista|ruta\s+pavimentada|traslado|on[\s-]*road)\b/i.test(
                    `${col0} ${col2}`
                ) && !isOffRoadRow;

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

        // b) Autonomía vial en kilómetros (km) vs Autonomía operativa en horas (h) y capacidad de estanque
        if (/\b(capacidad\s+(?:total\s+de\s+)?(?:estanques?|tanques?)\s+de\s+combustible|capacidad\s+de\s+estanque|capacidad\s+energ[eé]tica)\b/i.test(col0)) {
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

        // c) Cargas horarias (Ralentí / Baja / Media / Alta) — prioriza el valor completo SI + Imperial de la fila tabular
        if (/\b(ralent[ií]|idle|espera|auxiliar\s+en\s+vac[ií]o|tracci[oó]n\s+propia)\b/i.test(col0)) {
            if (/\b(L\/h|kWh\/h|L\/s|L\/min)\b/i.test(col1) || !baseEnergyProfile.hourly_consumption_by_load.idle_or_pto) {
                baseEnergyProfile.hourly_consumption_by_load.idle_or_pto = col1;
            }
        } else if (/\b(carga\s+baja|factor\s+de\s+carga\s+bajo|25\s*[-–a]\s*35\s*%|\bbaja\s+carga\b|ciclo\s+ligero|pto\s+ligero)\b/i.test(col0)) {
            if (/\b(L\/h|kWh\/h|L\/s|L\/min)\b/i.test(col1) || !baseEnergyProfile.hourly_consumption_by_load.low_load_25_35pct) {
                baseEnergyProfile.hourly_consumption_by_load.low_load_25_35pct = col1;
            }
        } else if (/\b(carga\s+media|carga\s+nominal|factor\s+de\s+carga\s+medio|50\s*[-–a]\s*65\s*%|\bnominal\b|ciclo\s+t[ií]pico)\b/i.test(col0)) {
            if (/\b(L\/h|kWh\/h|L\/s|m³\/min|L\/min|g\/kWh)\b/i.test(col1)) {
                baseEnergyProfile.hourly_consumption_by_load.medium_load_50_65pct = col1;
            }
        } else if (/\b(carga\s+alta|carga\s+severa|factor\s+de\s+carga\s+alto|80\s*[-–a]\s*100\s*%|plena\s+carga|100\s*%\s+carga)\b/i.test(col0)) {
            if (/\b(L\/h|kWh\/h|L\/s|L\/min)\b/i.test(col1) || !baseEnergyProfile.hourly_consumption_by_load.high_load_80_100pct) {
                baseEnergyProfile.hourly_consumption_by_load.high_load_80_100pct = col1;
            }
        }
    }

    // Condicionalidad universal Zero-Hallucination de DEF / AdBlue (SCR) sin parches por marca/modelo literal
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

    // ── 3. INSUMOS DE MANTENCIÓN PERIÓDICA (FLUIDOS, LUBRICANTES Y GRASAS) ────
    // Compuerta de Origen: Solo capítulos de Fluidos/Capacidades en `01 · Ficha Técnica` y capítulos de Lubricación/PM en `03 · Pauta de Mantención`.
    // Priorizamos `mantRows` primero (porque contienen intervalos de cambio reales) y luego `fichaRows` (capacidades de llenado).
    const fluidEligibleFichaRows = fichaRows.filter((r) =>
        /\b(fluidos?|lubricaci[oó]n|capacidades\s+de\s+(?:llenado|servicio|estanque|lubricaci[oó]n)|refrigeraci[oó]n)\b/i.test(
            r.sourceItemTitle
        )
    );
    const fluidSourceRows = [...mantRows, ...fluidEligibleFichaRows];
    const periodicFluids: OperationalCostMatrix['periodic_fluids'] = [];
    const seenFluidKeys = new Set<string>();

    for (const row of fluidSourceRows) {
        const joinedRow = row.cells.join(' ').toLowerCase();
        const compartment = row.cells[0] || '';
        if (isMissingMarker(compartment) || compartment.length < 3) continue;
        if (/^(par[aá]metro|sistema|compartimento|componente|fluido|etapa|tarea)$/i.test(compartment.trim())) {
            continue;
        }
        // Excluir tareas de inspección/muestreo y filas que son capacidad de estanque de combustible, frenos mecánicos/neumáticos o tasas de consumo
        if (
            /^(?:inspecci[oó]n|revisi[oó]n|verificaci[oó]n|chequeo|control\s+de|muestreo|an[aá]lisis\s+sos|toma\s+de\s+muestra|limpieza|drenaje\s+de\s+(?:agua|sedimento)|purga|ajuste|calibraci[oó]n|prueba)\b/i.test(
                compartment.trim()
            ) ||
            /\b(estanque\s+de\s+combustible|tanque\s+de\s+combustible|consumo\s+horario|rendimiento\s+vial|autonom[ií]a|frenos?\s+de\s+servicio|neum[aá]ticos?\s+de\s+tambor|voltaje|alternador|bater[ií]as?\s+12v|nivel\s+de\s+ruido|certificaci[oó]n\s+cabina|rops|fops)\b/i.test(
                compartment
            )
        ) {
            continue;
        }

        const isFluidContext =
            /\b(lubricante|aceite|fluido|refrigerante|coolant|elc|grasa|nlgi|sae\s*\d|iso\s*vg|api\s*c|dot\s*[345]|tdto|hydo|adblue|def|urea|l[ií]quido\s+de\s+frenos|aceite\s+neum[aá]tico)\b/i.test(
                joinedRow
            ) &&
            !/^(?:filtro|elemento\s+filtrante|sello|empaquetadura|oruga|neum[aá]tico|diente|cuchilla)\b/i.test(
                compartment.trim()
            );

        if (!isFluidContext || row.cells.length < 2) continue;

        if (
            !baseEnergyProfile.def_adblue_consumption.requires_def &&
            /\b(adblue|def\b|urea|scr\b)\b/i.test(joinedRow)
        ) {
            continue;
        }

        let fluidSpec = '';
        let viscosity = '';
        let capacityPerChange = '';
        let interval = '';

        for (let idx = 1; idx < row.cells.length; idx++) {
            const cell = row.cells[idx];
            const hdr = row.headers[idx] || '';
            if (isMissingMarker(cell)) continue;

            if (
                /\b(sae\s*\d+\w*[-/]\d+\w*|sae\s*\d+|iso\s*vg\s*\d+|nlgi\s*#?\d+|dot\s*[345](?:\.1)?)\b/i.test(cell) &&
                !viscosity
            ) {
                const viscMatch = cell.match(
                    /\b((?:SAE\s*)?\d+W[-/]\d+|SAE\s*\d+|ISO\s*VG\s*\d+|NLGI\s*#?\d+(?:\.\d+)?|DOT\s*[345](?:\.1)?)\b/i
                );
                viscosity = viscMatch ? viscMatch[1].toUpperCase() : cell;
                if (!fluidSpec && cell.length > viscosity.length + 3) {
                    fluidSpec = cell;
                }
            } else if (
                (/\b(capacidad|volumen|litros|cantidad)\b/i.test(hdr) ||
                    /\b\d+(?:[.,]\d+)?\s*(?:L\b|litros?|gal|kg|ml|cartuchos?)\b/i.test(cell)) &&
                !/\b(L\/h|L\/min|L\/s|L\/100\s*km)\b/i.test(cell) &&
                !capacityPerChange
            ) {
                capacityPerChange = cell;
            } else if (
                row.pillarId === 'pauta_mantencion' &&
                (/\b(intervalo|frecuencia|cambio|pauta|horas|km)\b/i.test(hdr) ||
                    /\b(?:cada\s+)?\d[\d.,]*\s*(?:h\b|hr|hrs|horas|km\b|meses|a[ñn]os?|diario|semanal|mensual)\b/i.test(
                        cell
                    )) &&
                !interval
            ) {
                interval = cell;
            } else if (!fluidSpec) {
                fluidSpec = cell;
            }
        }

        if (!fluidSpec && viscosity) {
            fluidSpec = viscosity;
        }
        if (!capacityPerChange && !viscosity && !interval && !/\b(api|acea|cat\s|iso\s|sae\s|dot\s|nlgi|elc)\b/i.test(fluidSpec)) {
            continue;
        }

        const dedupKey = `${compartment.toLowerCase().trim()}::${(viscosity || fluidSpec).toLowerCase().trim()}`;
        if (seenFluidKeys.has(dedupKey)) continue;
        seenFluidKeys.add(dedupKey);

        const finalCapacity = capacityPerChange || MISSING_FULL_TECH_SPEC;
        // Prohibido inventar 'Según pauta PM' cuando el intervalo no fue declarado en la fila cazada
        const finalInterval = interval || MISSING_FULL_TECH_SPEC;

        periodicFluids.push({
            compartment,
            fluid_spec: fluidSpec || MISSING_FULL_TECH_SPEC,
            viscosity: viscosity || MISSING_FULL_TECH_SPEC,
            capacity_per_change: finalCapacity,
            interval: finalInterval,
            prorated_per_1000h: computeProratedPer1000Hours(finalCapacity, finalInterval),
            source_item_title: row.sourceItemTitle,
        });
    }

    // ── 4. RECAMBIO PERIÓDICO DE FILTROS, SELLOS Y KITS PREVENTIVOS ───────────
    // Compuerta Estricta Zero-Hallucination: EXCLUSIVAMENTE desde `mantRows` (`03 · Pauta de Mantención`).
    // Prohibido extraer filas de `01 · Ficha Técnica` hacia la Tabla IV.
    const periodicFiltersAndSeals: OperationalCostMatrix['periodic_filters_and_seals'] = [];
    const seenFilterKeys = new Set<string>();

    for (const row of mantRows) {
        const col0 = row.cells[0] || '';
        const joinedRow = row.cells.join(' ');
        if (isMissingMarker(col0) || col0.length < 3) continue;
        if (/^(par[aá]metro|sistema|compartimento|componente|insumo|filtro|etapa|tarea)$/i.test(col0.trim())) {
            continue;
        }

        // Exigir que la columna 0 identifique un filtro, respiradero, sello, correa, manguera o kit preventivo de recambio
        // (bloqueando tareas de inspección diaria y filas de aceite como "Cárter de motor con cambio de filtros")
        const isFilterOrSeal =
            /\b(filtro|elemento\s+filtrante|separador\s+(?:de\s+)?agua|filtro\s+coalescente|respiradero|breather|secador\s+de\s+aire|cartucho\s+desecante|sello|ret[eé]n|empaquetadura|junta|o-?ring|kit\s+de\s+sellos|correa\s+(?:de\s+)?(?:accesorios|distribuci[oó]n|alternador|ventilador)|manguera\s+(?:antiest[aá]tica|dispensadora|hidr[aá]ulica)|kit\s+pm\d?)\b/i.test(
                col0
            ) &&
            !/^(?:inspecci[oó]n|revisi[oó]n|verificaci[oó]n|chequeo|limpieza\s+primaria|drenaje\s+de\s+agua|indicador\s+de|sensor\s+de|c[aá]rter\s+de\s+motor|aceite\s+de\s+motor|diente|cuchilla|cantonera|neum[aá]tico|oruga|zapata|mand[ií]bula|manto)\b/i.test(
                col0.trim()
            );

        if (!isFilterOrSeal) continue;
        if (
            !baseEnergyProfile.def_adblue_consumption.requires_def &&
            /\b(adblue|def\b|urea|scr\b)\b/i.test(joinedRow)
        ) {
            continue;
        }

        let category: OperationalCostMatrix['periodic_filters_and_seals'][number]['category'] = 'FILTRO';
        if (/\b(sello|ret[eé]n|empaquetadura|junta|o-?ring)\b/i.test(col0)) {
            category = 'SELLO_EMPAQUETADURA';
        } else if (/\b(respiradero|breather|secador\s+de\s+aire|cartucho\s+desecante|venteo)\b/i.test(col0)) {
            category = 'RESPIRADERO';
        } else if (/\b(correa|manguera)\b/i.test(col0)) {
            category = 'CORREA_MANGUERA';
        } else if (/\b(kit\s+pm|kit\s+de\s+mantenimiento)\b/i.test(col0)) {
            category = 'KIT_PM';
        }

        let system = '';
        let oemPartNumber = '';
        let quantityPerChange = '';
        let interval = '';
        let pmStage = '';

        for (let idx = 1; idx < row.cells.length; idx++) {
            const cell = row.cells[idx];
            const hdr = row.headers[idx] || '';
            if (isMissingMarker(cell)) continue;

            if (
                (/\b(c[oó]digo|parte|part\s*number|n[°º]\s*parte|oem|referencia)\b/i.test(hdr) ||
                    /\b([A-Z0-9]{2,5}[-][A-Z0-9]{3,8}|\d{3}[-]\d{4}|\bP\d{6}\b|\bLF\d{4,5}\b|\bFF\d{4,5}\b|\bAF\d{4,5}\b|\bHF\d{4,5}\b)\b/.test(
                        cell
                    )) &&
                !oemPartNumber
            ) {
                oemPartNumber = cell;
            } else if (
                (/\b(cant|cantidad|unid|dotaci[oó]n)\b/i.test(hdr) ||
                    /^\d{1,2}\s*(?:unid\.?|u\.?|pza\.?|kit|juego)$/i.test(cell.trim())) &&
                !quantityPerChange
            ) {
                quantityPerChange = cell;
            } else if (
                /\b(intervalo|frecuencia|horas|km|per[ií]odo)\b/i.test(hdr) ||
                /\b(?:cada\s+)?\d[\d.,]*\s*(?:h\b|hr|hrs|horas|km\b|meses)\b/i.test(cell)
            ) {
                if (!interval) interval = cell;
                const pmMatch = cell.match(/\b(PM[1234]|250\s*h|500\s*h|1\.?000\s*h|2\.?000\s*h|10\.?000\s*km|20\.?000\s*km)\b/i);
                if (pmMatch && !pmStage) pmStage = pmMatch[1].toUpperCase();
            } else if (
                (/\b(etapa|pauta|pm)\b/i.test(hdr) || /\b(pm[1234]|etapa\s+[i1234v]+)\b/i.test(cell)) &&
                !pmStage
            ) {
                pmStage = cell;
            } else if (/\b(sistema|aplicaci[oó]n|compartimento|ubicaci[oó]n|funci[oó]n)\b/i.test(hdr) && !system) {
                system = cell;
            }
        }

        if (!pmStage) {
            const titlePm = row.sourceItemTitle.match(/\b(PM[1234]|250\s*h|500\s*h|1\.?000\s*h|2\.?000\s*h|10\.?000\s*km|20\.?000\s*km)\b/i);
            if (titlePm) pmStage = titlePm[1].toUpperCase();
        }

        const dedupKey = `${col0.toLowerCase().trim()}::${oemPartNumber.toLowerCase().trim()}::${interval.toLowerCase().trim()}`;
        if (seenFilterKeys.has(dedupKey)) continue;
        seenFilterKeys.add(dedupKey);

        periodicFiltersAndSeals.push({
            component_name: col0,
            category,
            system: system || MISSING_FULL_TECH_SPEC,
            oem_part_number: oemPartNumber || MISSING_FULL_TECH_SPEC,
            quantity_per_change: quantityPerChange || MISSING_FULL_TECH_SPEC,
            interval: interval || MISSING_FULL_TECH_SPEC,
            pm_stage: pmStage || MISSING_FULL_TECH_SPEC,
            source_item_title: row.sourceItemTitle,
        });
    }

    // ── 5. ELEMENTOS DE DESGASTE (`GET` / FRENOS / EMBRAGUE / SUSPENSIÓN / TOLVA) ─
    // Compuerta Estricta Zero-Hallucination: EXCLUSIVAMENTE desde `mantRows` (`03 · Pauta de Mantención`).
    // Prohibido extraer filas descriptivas de `01 · Ficha Técnica` hacia la Tabla V.
    const wearPartsGet: OperationalCostMatrix['wear_parts_get'] = [];
    const seenWearKeys = new Set<string>();

    for (const row of mantRows) {
        const col0 = row.cells[0] || '';
        const joinedRow = row.cells.join(' ');
        if (isMissingMarker(col0) || col0.length < 3) continue;
        if (/^(par[aá]metro|sistema|componente|elemento|pieza|etapa|tarea)$/i.test(col0.trim())) {
            continue;
        }

        const isWearPart =
            /\b(dientes?\s+de\s+(?:balde|dipper)|puntas?\s+de\s+(?:balde|excavaci[oó]n|ripper)|adaptador(?:es)?\s+de\s+diente|cuchilla\s+(?:central|reversible|empernada|de\s+ataque|de\s+vertedera)|cantonera|protector\s+de\s+(?:labio|fald[oó]n|brazo)|labio\s+de\s+(?:balde|dipper)|placa\s+de\s+desgaste|planchas?\s+de\s+(?:desgaste|sacrificio)|liner\s+de\s+tolva|revestimiento\s+(?:antidesgaste|de\s+tolva)|wear\s+plate|escarificador|ripper|mand[ií]bula\s+(?:fija|m[oó]vil)|muela\s+de\s+chancado|manto\s+y\s+c[oó]ncavo|barra\s+de\s+impacto|blow\s+bar|malla\s+de\s+harnero|fald[oó]n\s+de\s+goma|raspador\s+de\s+(?:correa|tambor)|broca\s+de\s+perforaci[oó]n|bit\s+de\s+botones|barra\s+(?:integral|de\s+perforaci[oó]n|hexagonal)|culat[ií]n|shank\s+adapter|copla\s+de\s+perforaci[oó]n|buje\s+de\s+rotaci[oó]n|picas?\s+de\s+(?:carburo|corte|fresado)|portapicas?|pastillas?\s+de\s+freno|balatas?\s+de\s+freno|bloques?\s+de\s+freno|disco\s+de\s+freno|tambor(?:es)?\s+de\s+freno|pulm[oó]n\s+de\s+freno|c[aá]mara\s+de\s+freno|kit\s+de\s+embrague|disco\s+de\s+embrague|prensa\s+de\s+embrague|paquete\s+de\s+resortes|ballestas?|muelles?\s+de\s+suspensi[oó]n|bujes?\s+de\s+(?:barra|bogie|suspensi[oó]n|muelle)|amortiguador(?:es)?\s+de\s+suspensi[oó]n|pernos?\s+u\b|mano\s+de\s+acople|quinta\s+rueda|kingpin|pistola\s+(?:dispensadora|de\s+suministro)|impulsor|difusor\s+de\s+goma|camisa\s+de\s+desgaste|sello\s+mec[aá]nico|toberas?\s+de\s+soldadura|puntas?\s+de\s+contacto|liner\s+de\s+antorcha|rodillos?\s+alimentadores|escobillas?\s+(?:de\s+carb[oó]n|colectoras)|h[eé]lices?\b|rotores?\s+de\s+vuelo|dampers?\s+de\s+gimbal|cuadradillo\s+de\s+mando|trinquete|brazo\s+de\s+reacci[oó]n|kit\s+de\s+sellos\s+(?:700\s*bar|alta\s+presi[oó]n)|cables?\s+(?:de\s+izaje|hoist|crowd|trip|de\s+acero\s+de\s+m[aá]stil)|almohadillas?\s+de\s+pluma|horquillas?\s+de\s+carga|m[oó]dulos?\s+led)\b/i.test(
                col0
            ) &&
            !/\b(neum[aá]tico\s+radial|neum[aá]ticos?\s+delanteros?|neum[aá]ticos?\s+traseros?|oruga\s+de\s+goma|aceite\s+sae|filtro\s+de)\b/i.test(col0) &&
            !/^(?:inspecci[oó]n|revisi[oó]n|verificaci[oó]n|chequeo|medici[oó]n\s+de|control\s+de|ajuste\s+de|regulaci[oó]n\s+de|prueba\s+de|dotaci[oó]n\s+(?:est[aá]ndar|herramienta|de\s+f[aá]brica))\b/i.test(
                col0.trim()
            );

        if (!isWearPart) continue;
        const normalizedRowLower = joinedRow
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        if (
            Array.isArray(taxonomyMeta.wear_exclude_keywords) &&
            taxonomyMeta.wear_exclude_keywords.some((kw) => normalizedRowLower.includes(kw.toLowerCase()))
        ) {
            continue;
        }
        if (
            isWheeledTruckOrVehicle &&
            /\b(cuchilla|dientes?\s+de\s+balde|puntas?\s+de\s+balde|adaptador\s+de\s+diente|cantonera|vertedera|ripper|escarificador|mand[ií]bula|manto\s+y\s+c[oó]ncavo|broca\s+de\s+perforaci[oó]n|culat[ií]n|oruga)\b/i.test(
                joinedRow
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
            const cell = row.cells[idx];
            const hdr = row.headers[idx] || '';
            if (isMissingMarker(cell)) continue;

            if (/\b(zona|[oó]rgano|ubicaci[oó]n|sistema|implemento|eje|subconjunto)\b/i.test(hdr) && !workToolZone) {
                workToolZone = cell;
            } else if (
                (/\b(c[oó]digo|medida|especificaci[oó]n|serie|sistema\s+get|parte|material)\b/i.test(hdr) ||
                    /\b(serie\s+[jk]\d{3}|cat\s+j\d{3}|esco|mtb|hb\s*\d{3}|hardox\s*\d{3}|\d+\s*mm)\b/i.test(cell)) &&
                !oemSpecOrCode
            ) {
                oemSpecOrCode = cell;
            } else if (
                (/\b(dotaci[oó]n|cant|cantidad|unid)\b/i.test(hdr) ||
                    /^\d{1,3}\s*(?:unid\.?|u\.?|pzas?\.?|dientes?|segmentos?|juegos?)$/i.test(cell.trim())) &&
                !installedQty
            ) {
                installedQty = cell;
            } else if (
                (/\b(vida\s+[uú]til|intervalo|duraci[oó]n|frecuencia|recambio)\b/i.test(hdr) ||
                    /\b\d[\d.,]*\s*(?:h\b|hr|hrs|horas|km\b|m\s+perforados|toneladas|t\b)\b/i.test(cell)) &&
                !estimatedLife
            ) {
                estimatedLife = cell;
            } else if (
                (/\b(l[ií]mite|condena|desgaste\s+m[aá]x|espesor\s+m[ií]n|tolerancia|criterio\s+de\s+retiro)\b/i.test(hdr) ||
                    /\b(\d+\s*%|m[ií]n\.?\s*\d+(?:[.,]\d+)?\s*mm|reemplazo\s+al)\b/i.test(cell)) &&
                !condemnationLimit
            ) {
                condemnationLimit = cell;
            } else if (!oemSpecOrCode) {
                oemSpecOrCode = cell;
            }
        }

        const dedupKey = `${col0.toLowerCase().trim()}::${oemSpecOrCode.toLowerCase().trim()}`;
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

    // ── 6. RECAMBIO DE NEUMÁTICOS, ORUGAS Y TREN DE RODAJE ───────────────────
    // Compuerta Estricta Zero-Hallucination:
    // - Prioriza `mantRows` (`03 · Pauta de Mantención`) para vida útil, presión de servicio y límite de condena.
    // - En `fichaRows` (`01 · Ficha Técnica`), SOLO permite filas cuya columna 0 comience literalmente con el componente de rodado
    //   (`Neumáticos...`, `Orugas...`, `Zapatas...`, `Rodillos...`), bloqueando por completo falsos positivos como
    //   "Frenos de Servicio: Neumáticos de tambor".
    const tiresAndUndercarriage: OperationalCostMatrix['tires_and_undercarriage'] = [];
    const seenRodadoKeys = new Set<string>();
    const rodadoSourceRows = [...mantRows, ...fichaRows];

    for (const row of rodadoSourceRows) {
        const col0 = row.cells[0] || '';
        const joinedRow = row.cells.join(' ');
        if (isMissingMarker(col0) || col0.length < 3) continue;

        const isExplicitRodadoCol0 =
            /^(?:neum[aá]ticos?\b|llantas?\s+y\s+neum[aá]ticos?\b|medida\s+de\s+neum[aá]ticos?\b|orugas?\s+de\b|cadenas?\s+de\s+oruga\b|zapatas?\s+de\b|rodillos?\s+(?:inferiores|superiores|de\s+oruga)\b|rueda\s+gu[ií]a\b|idler\b|rueda\s+cabilla\b|sprocket\b|segmentos?\s+de\s+sprocket\b|mazas?\s+de\s+rueda\b|rodamientos?\s+de\s+rueda\b|silentblock\b|aislador\s+elast[oó]mero\b|polines?\s+de\s+carga\b|correa\s+transportadora\b|tren\s+de\s+aterrizaje\b|bater[ií]as?\s+de\s+vuelo\b|mangueras?\s+gemelas\b|acoples?\s+r[aá]pidos\b|carrete\s+de\s+cable\b)/i.test(
                col0.trim()
            ) &&
            !/\b(frenos?\b|tambor(?:es)?\s+de\s+freno|s-?cam|abs\b|aceite\s+de|filtro\s+de|par\s+de\s+apriete)\b/i.test(
                col0
            ) &&
            !/^dotaci[oó]n\s+(?:est[aá]ndar|herramienta|de\s+rodado|de\s+f[aá]brica)/i.test(col0.trim());

        if (!isExplicitRodadoCol0) continue;

        if (
            isWheeledTruckOrVehicle &&
            /\b(oruga|zapata|sprocket|rueda\s+gu[ií]a|idler|cabilla|rodillo\s+(?:inferior|superior|de\s+oruga))\b/i.test(
                joinedRow
            )
        ) {
            continue;
        }
        if (isTrackedMachine && /\b(neum[aá]tico\s+radial|llanta\s+de\s+neum[aá]tico)\b/i.test(joinedRow)) {
            continue;
        }

        let category: OperationalCostMatrix['tires_and_undercarriage'][number]['category'] = 'NEUMATICO';
        if (/\b(tren\s+de\s+aterrizaje|bater[ií]a\s+de\s+vuelo|h[eé]lice|rotor)\b/i.test(col0)) {
            category = 'HELICE_ROTOR_TREN_ATERRIZAJE';
        } else if (/\b(manguera\s+gemela|acople\s+r[aá]pido|carrete|cable\s+de\s+izaje)\b/i.test(col0)) {
            category = 'CABLE_IZAJE_CARRETE';
        } else if (/\b(oruga\s+de\s+goma|banda\s+de\s+goma|correa\s+transportadora)\b/i.test(col0)) {
            category = 'ORUGA_GOMA';
        } else if (/\b(oruga\s+de\s+acero|zapata|cadena\s+de\s+oruga|link\s+assembly)\b/i.test(col0)) {
            category = 'ORUGA_ACERO_ZAPATA';
        } else if (/\b(rodillo|rueda\s+gu[ií]a|idler|sprocket|cabilla|maza|rodamiento\s+de\s+rueda|pol[ií]n)\b/i.test(col0)) {
            category = 'RODILLO_RUEDA_GUIA_SPROCKET';
        } else if (/\b(silentblock|elast[oó]mero|amortiguador\s+de\s+goma)\b/i.test(col0)) {
            category = 'SOPORTE_ELASTOMERO';
        }

        let sizeOrCompoundSpec = '';
        let installedQty = '';
        let nominalPressureOrTension = '';
        let estimatedLife = '';
        let condemnationLimit = '';

        for (let idx = 1; idx < row.cells.length; idx++) {
            const cell = row.cells[idx];
            const hdr = row.headers[idx] || '';
            if (isMissingMarker(cell)) continue;

            // Si la celda incluye dotación entre paréntesis (ej. "315/80 R22.5 (4 unidades en configuración 8x4)"), extraer dotación
            if (!installedQty) {
                const inlineQty = cell.match(/\b(\d{1,2}\s*(?:unidades?|unid\.?|neum[aá]ticos?|ruedas?|orugas?|zapatas?))\b/i);
                if (inlineQty) {
                    installedQty = inlineQty[1].trim();
                }
            }

            if (
                (/\b(medida|especificaci[oó]n|compuesto|dimensiones|modelo|valor\s+oem)\b/i.test(hdr) ||
                    /\b(\d{2,3}\/\d{2}\s*R\s*\d{2}(?:\.\d)?|\d{1,2}\.\d{2}\s*[-R]\s*\d{2}|\d{3}\s*x\s*\d{2,3}(?:\.\d)?\s*x\s*\d{2}|TRA\s+L[-]?[2345]|PR\s*\d{2})\b/i.test(
                        cell
                    )) &&
                !sizeOrCompoundSpec
            ) {
                sizeOrCompoundSpec = cell;
            } else if (
                (/\b(dotaci[oó]n|cant|cantidad|unid)\b/i.test(hdr) ||
                    /^\d{1,3}\s*(?:unid\.?|unidades?|u\.?|neum[aá]ticos?|orugas?|zapatas?|rodillos?)$/i.test(cell.trim())) &&
                !installedQty
            ) {
                installedQty = cell;
            } else if (
                (/\b(presi[oó]n|inflado|tensi[oó]n|comba|sag)\b/i.test(hdr) ||
                    /\b(\d+(?:[.,]\d+)?\s*(?:bar|psi|kpa)|comba\s+\d+\s*mm)\b/i.test(cell)) &&
                !nominalPressureOrTension
            ) {
                nominalPressureOrTension = cell;
            } else if (
                row.pillarId === 'pauta_mantencion' &&
                (/\b(vida\s+[uú]til|duraci[oó]n|intervalo|recambio)\b/i.test(hdr) ||
                    /\b\d[\d.,]*\s*(?:h\b|hr|hrs|horas|km\b)\b/i.test(cell)) &&
                !estimatedLife
            ) {
                estimatedLife = cell;
            } else if (
                row.pillarId === 'pauta_mantencion' &&
                (/\b(l[ií]mite|condena|profundidad\s+m[ií]n|desgaste|retiro)\b/i.test(hdr) ||
                    /\b(m[ií]n\.?\s*\d+(?:[.,]\d+)?\s*mm|100\s*%\s+desgaste|twi)\b/i.test(cell)) &&
                !condemnationLimit
            ) {
                condemnationLimit = cell;
            } else if (!sizeOrCompoundSpec && idx === 1) {
                sizeOrCompoundSpec = cell;
            }
        }

        const dedupKey = col0.toLowerCase().trim();
        if (seenRodadoKeys.has(dedupKey)) continue;
        seenRodadoKeys.add(dedupKey);

        tiresAndUndercarriage.push({
            component_name: col0,
            category,
            size_or_compound_spec: sizeOrCompoundSpec || MISSING_FULL_TECH_SPEC,
            installed_qty: installedQty || MISSING_FULL_TECH_SPEC,
            nominal_pressure_or_tension: nominalPressureOrTension || MISSING_FULL_TECH_SPEC,
            estimated_life: estimatedLife || MISSING_FULL_TECH_SPEC,
            condemnation_limit: condemnationLimit || MISSING_FULL_TECH_SPEC,
            source_item_title: row.sourceItemTitle,
        });
    }

    // ── 7. SÍNTESIS DE KITS Y PAUTAS PROGRAMADAS (PM1 / PM2 / PM3 / PM4) ─────
    // Compuerta Estricta Zero-Hallucination: EXCLUSIVAMENTE cuando existen capítulos cazados en `03 · Pauta de Mantención` (`mantItems.length > 0`).
    const scheduledPmKitsSummary: OperationalCostMatrix['scheduled_pm_kits_summary'] = [];
    if (mantItems.length > 0) {
        const pmStagesOrder: Array<{ code: string; label: string; regex: RegExp }> = [
            {
                code: 'DIARIO / SEMANAL',
                label: '10 h – 50 h / Semanal (5.000 km)',
                regex: /\b(10\s*h|50\s*h|diario|semanal|5\.?000\s*km)\b/i,
            },
            {
                code: 'PM1 (MENOR)',
                label: '250 h / 10.000 km',
                regex: /\b(pm\s*1\b|250\s*h|10\.?000\s*km|mensual)\b/i,
            },
            {
                code: 'PM2 (INTERMEDIO)',
                label: '500 h / 20.000 km',
                regex: /\b(pm\s*2\b|500\s*h|20\.?000\s*km|trimestral)\b/i,
            },
            {
                code: 'PM3 (MAYOR)',
                label: '1.000 h / 40.000 km',
                regex: /\b(pm\s*3\b|1\.?000\s*h|40\.?000\s*km|semestral)\b/i,
            },
            {
                code: 'PM4 (OVERHAUL / 2.000 h+)',
                label: '2.000 h / 80.000–100.000 km',
                regex: /\b(pm\s*4\b|2\.?000\s*h|4\.?000\s*h|80\.?000\s*km|100\.?000\s*km|overhaul|anual)\b/i,
            },
        ];

        for (const st of pmStagesOrder) {
            const matchingFluids = periodicFluids
                .filter((f) => !isMissingMarker(f.interval) && st.regex.test(`${f.interval} ${f.source_item_title}`))
                .map((f) => `${f.compartment} (${f.capacity_per_change})`)
                .slice(0, 4);

            const matchingFilters = periodicFiltersAndSeals
                .filter((fl) => st.regex.test(`${fl.interval} ${fl.pm_stage} ${fl.source_item_title}`))
                .map((fl) => `${fl.component_name}${!isMissingMarker(fl.oem_part_number) ? ` [${fl.oem_part_number}]` : ''}`)
                .slice(0, 5);

            const matchingWearOrRodado = [
                ...wearPartsGet
                    .filter((w) => !isMissingMarker(w.estimated_life) && st.regex.test(`${w.estimated_life} ${w.source_item_title}`))
                    .map((w) => w.part_name),
                ...tiresAndUndercarriage
                    .filter((t) => !isMissingMarker(t.estimated_life) && st.regex.test(`${t.estimated_life} ${t.source_item_title}`))
                    .map((t) => t.component_name),
            ].slice(0, 4);

            if (matchingFluids.length > 0 || matchingFilters.length > 0 || matchingWearOrRodado.length > 0) {
                scheduledPmKitsSummary.push({
                    pm_code: st.code,
                    interval: st.label,
                    fluids_summary:
                        matchingFluids.length > 0 ? matchingFluids.join(' · ') : MISSING_FULL_TECH_SPEC,
                    filters_and_seals_summary:
                        matchingFilters.length > 0 ? matchingFilters.join(' · ') : MISSING_FULL_TECH_SPEC,
                    wear_and_rodado_checks:
                        matchingWearOrRodado.length > 0
                            ? matchingWearOrRodado.join(' · ')
                            : MISSING_FULL_TECH_SPEC,
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

    const hasCapexData = Boolean(
        referenceNewPriceUsd || referenceNewPriceClp || economicLifeHours || economicLifeKm
    );

    const hasMaintenanceTables =
        mantItems.length > 0 &&
        (periodicFluids.some((f) => !isMissingMarker(f.interval)) ||
            periodicFiltersAndSeals.length > 0 ||
            wearPartsGet.length > 0 ||
            tiresAndUndercarriage.some((t) => !isMissingMarker(t.estimated_life)));

    let completenessStatus: OperationalCostMatrix['completeness_status'] = 'EMPTY';
    if (hasEnergyData && hasMaintenanceTables && (hasCapexData || periodicFiltersAndSeals.length >= 1)) {
        completenessStatus = 'COMPLETE';
    } else if (hasEnergyData || hasCapexData || periodicFluids.length > 0 || tiresAndUndercarriage.length > 0 || hasMaintenanceTables) {
        completenessStatus = 'PARTIAL';
    }

    return {
        version: '3.0.0',
        compiled_at: new Date().toISOString(),
        source_merkle_root_sha256: sourceMerkleRoot,
        completeness_status: completenessStatus,
        taxonomy_meta: taxonomyMeta,
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
 * compila determinísticamente su `OperationalCostMatrix v3.0` y la persiste en `derived/cost_matrix`
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
