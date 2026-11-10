import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../../config/firebase';
import { ResilientAIClient, Type } from '../../../core/resilient-ai-client';
import type {
    CanonicalSpecSlot,
    EquipmentAxisValueKind,
    EquipmentTypeAxisSchemaItem,
    EquipmentTypeConditionalSubsystemItem,
    EquipmentTypeCoreChapterItem,
    EquipmentTypePillarBlueprint,
    GlobalEquipmentTypeDoc,
    MachineryArchetypeId,
} from '../types/vault.types';
import {
    ACCESSORY_HISTORICAL_SPEC_REGEX,
    buildUniversalEnergySpecAxesForType,
    cleanDynamicAxisValue,
    ensureUniversalEnergyAxesInSpecSchema,
    FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX,
    resolveMachineryArchetype,
    validateCrossAxisPhysicalPlausibility,
} from '../utils/canonicalArchetypeSpecs';
import { verifyAndNormalizeTechnicalUnits } from './NeuroSymbolicVerifier';

/**
 * EQUIPMENT TYPE REGISTRY SERVICE v2.0 (Ontología Dinámica Auto-Aprendida por `TIPO` — OPERMAQ)
 *
 * Mecánica Soberana de 2 Tiempos:
 * 1. Al registrar o buscar cualquier activo, OPERMAQ detecta primero su `TIPO` técnico real
 *    (ej. `MOTONIVELADORA`, `CAMIONETA PICK-UP`, `COMPRESOR DE AIRE`, `PERFORADORA NEUMÁTICA MANUAL`,
 *    `CHANCADOR DE MANDÍBULAS`, `MANIPULADOR TELESCÓPICO`).
 * 2. Consulta `global_equipment_types/{typeKey}` (< 10 ms):
 *    - Si el `TIPO` ya existe, reutiliza de inmediato sus 3 a 5 ejes físicos diferenciadores (SI) y `search_keywords`.
 *    - Si el `TIPO` se consulta por 1ª vez en MINREPORT, sintetiza a `Temperature: 0` sus ejes físicos exclusivos
 *      (bloqueando prosa comercial, fechas históricas y parámetros cruzados de otros equipos), genera su vector
 *      semántico `768d` para unificar sinónimos futuros y lo persiste en `global_equipment_types/{typeKey}`.
 */

export const GLOBAL_EQUIPMENT_TYPES_COLLECTION = 'global_equipment_types';
export const EQUIPMENT_TYPE_SCHEMA_VERSION = 4;
const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000;

export function buildDedicatedConsumptionCoreChapter(
    typeDoc: Pick<GlobalEquipmentTypeDoc, 'type_key' | 'canonical_type_es' | 'categoria_equipo' | 'archetype_id'>
): EquipmentTypeCoreChapterItem {
    const typeText = `${typeDoc.type_key} ${typeDoc.canonical_type_es} ${typeDoc.categoria_equipo || ''} ${typeDoc.archetype_id || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const isPneumaticOrDrill =
        /\b(neumatic|jackleg|stoper|martillo\s+neumatico|perforadora\s+neumatica)\b/i.test(typeText);

    const isGridElectricPlant =
        /\b(electric|subestacion|transformador|tablero|chancador|molino|harnero|criba|correa\s+transportadora|soldadora|planta\s+de)\b/i.test(
            typeText
        ) && !/\b(diesel|gasolina|camion|camioneta|excavadora|tractor|motoniveladora|fresadora)\b/i.test(typeText);

    const isBatteryOrHybrid =
        /\b(bateria|bev\b|hibrid|diesel[\s-]*electric|trolley)\b/i.test(typeText);

    const isRoadOrUtilityVehicle =
        /\b(camion|camioneta|pick\s*up|furgon|utilitario|suv|tractocamion|remolcador|bus|minibus|van|chasis\s+cabina|volquete|tolva)\b/i.test(
            typeText
        ) && !/\b(caex|camion\s+de\s+extraccion|ultra\s*class)\b/i.test(typeText);

    if (isPneumaticOrDrill) {
        return {
            chapter_key: 'matriz_energetica_consumos_y_autonomia',
            title_es: 'Consumos de Energía, Aire Comprimido, Combustible y Fluidos de Barrido',
            section_es: 'CONSUMOS DE ENERGÍA, AIRE COMPRIMIDO Y COMBUSTIBLE',
            rationale_es:
                'Detalla la fuente de energía primaria, demanda de caudal de aire comprimido (L/s, m³/min, CFM) a presión nominal de trabajo (bar), consumo de combustible o energía eléctrica si aplica (L/h o kWh/h), consumo de aceite de línea/lubricador y caudal de agua de barrido (L/min) para gestión de costos.',
            priority: 'CRÍTICO',
        };
    }

    if (isGridElectricPlant) {
        return {
            chapter_key: 'matriz_energetica_consumos_y_autonomia',
            title_es: 'Consumos de Energía Eléctrica, Demanda de Potencia y Factor de Carga Operativo',
            section_es: 'CONSUMOS DE ENERGÍA, DEMANDA ELÉCTRICA Y AUTONOMÍA',
            rationale_es:
                'Detalla el suministro eléctrico (tensión V, fases, frecuencia Hz), potencia nominal e instalada (kW / kVA), consumo energético horario por factor de carga bajo/medio/alto (kWh/h), consumo específico por tonelada o volumen procesado (kWh/t, kWh/m³) y factor de potencia (cos φ) para gestión de costos.',
            priority: 'CRÍTICO',
        };
    }

    if (isBatteryOrHybrid) {
        return {
            chapter_key: 'matriz_energetica_consumos_y_autonomia',
            title_es: 'Consumos de Energía (Batería / Híbrido / Combustible), Regeneración y Autonomía por Ciclo',
            section_es: 'CONSUMOS DE ENERGÍA, COMBUSTIBLE Y AUTONOMÍA',
            rationale_es:
                'Detalla la arquitectura energética (batería LFP/NMC, híbrido diésel-eléctrico o trolley), consumo energético horario o vial (kWh/h, kWh/100 km), consumo de combustible diésel por factor de carga (L/h), capacidad útil de almacenamiento (kWh y L), potencia de recarga/regeneración (kW) y autonomía efectiva por ciclo.',
            priority: 'CRÍTICO',
        };
    }

    if (isRoadOrUtilityVehicle) {
        return {
            chapter_key: 'matriz_energetica_consumos_y_autonomia',
            title_es: 'Consumos de Combustible, Insumos Energéticos (DEF/AdBlue) y Autonomía Operativa',
            section_es: 'CONSUMOS DE COMBUSTIBLE, ENERGÍA Y AUTONOMÍA',
            rationale_es:
                'Detalla el tipo de combustible o energía (Diésel ULSD, Gasolina, Gas o Eléctrico), consumo horario en operación/toma de fuerza (L/h) por factor de carga bajo/medio/alto, rendimiento vial en ruta y faena (km/L y L/100 km), consumo específico BSFC (g/kWh), consumo de agente reductor DEF/AdBlue (% o L/h), capacidad de estanque (L) y autonomía operativa efectiva (h / km) para gestión de costos.',
            priority: 'CRÍTICO',
        };
    }

    return {
        chapter_key: 'matriz_energetica_consumos_y_autonomia',
        title_es: 'Consumos de Combustible / Energía por Factor de Carga, DEF/AdBlue y Autonomía Operativa',
        section_es: 'CONSUMOS DE COMBUSTIBLE, ENERGÍA Y AUTONOMÍA',
        rationale_es:
            'Detalla la fuente de energía primaria (Diésel, Gasolina, Eléctrico, Híbrido o Neumático), consumo horario por factor de carga bajo (25-35%), medio (50-65%) y alto (80-100%) en L/h o kWh/h, consumo en ralentí/trabajo continuo, consumo específico BSFC (g/kWh), consumo de urea/DEF (AdBlue) si aplica, capacidad de estanque o banco energético (L / kWh) y autonomía efectiva en turno para gestión de costos.',
        priority: 'CRÍTICO',
    };
}

export function upgradeEquipmentTypeSchemaIfNeeded(doc: GlobalEquipmentTypeDoc): {
    doc: GlobalEquipmentTypeDoc;
    modified: boolean;
} {
    const existingAxes = Array.isArray(doc.spec_schema) ? doc.spec_schema : [];
    const hasEnergySource = existingAxes.some((a) => a.axis_key === 'fuente_energia');
    const hasConsumption = existingAxes.some(
        (a) => a.axis_key === 'consumo_energetico_nominal' || a.axis_key === 'consumo_nominal_o_tasa'
    );
    const hasCapacity = existingAxes.some(
        (a) => a.axis_key === 'capacidad_energetica_autonomia' || a.axis_key === 'capacidad_estanque_o_bateria'
    );

    const isSkidSteerOrCtl =
        doc.archetype_id === 'MINICARGADOR_SSL_CTL' ||
        doc.type_key === 'minicargador_sobre_neumaticos' ||
        doc.type_key === 'cargador_compacto_sobre_orugas';
    const hasAuxHydraulics =
        !isSkidSteerOrCtl || existingAxes.some((a) => a.axis_key === 'caudal_presion_hidraulica_aux');

    const existingFichaCore = doc.pillar_blueprints?.ficha_tecnica?.core_chapters;
    const hasDedicatedConsumptionChapter =
        !Array.isArray(existingFichaCore) ||
        existingFichaCore.some(
            (c) =>
                c.chapter_key === 'matriz_energetica_consumos_y_autonomia' &&
                /^Consumos\s+de\b/i.test(c.title_es)
        );

    const needsUpgrade =
        (doc.schema_version ?? 1) < EQUIPMENT_TYPE_SCHEMA_VERSION ||
        !hasEnergySource ||
        !hasConsumption ||
        !hasCapacity ||
        !hasAuxHydraulics ||
        !hasDedicatedConsumptionChapter;

    if (!needsUpgrade) {
        return { doc, modified: false };
    }

    let baseAxes = [...existingAxes];
    if (isSkidSteerOrCtl) {
        if (!baseAxes.some((a) => a.axis_key === 'carga_vuelco_estatica')) {
            baseAxes.splice(1, 0, {
                axis_key: 'carga_vuelco_estatica',
                label_es: 'Carga estática vuelco',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['tipping load', 'carga estática de vuelco', 'carga de vuelco', 'kg', 'lb'],
                mandatory: false,
                is_differentiator: true,
            });
        }
        if (!baseAxes.some((a) => a.axis_key === 'caudal_presion_hidraulica_aux')) {
            baseAxes.push({
                axis_key: 'caudal_presion_hidraulica_aux',
                label_es: 'Hidráulica auxiliar',
                unit_si: 'L/min @ bar',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: [
                    'hydraulic flow',
                    'caudal hidráulico auxiliar',
                    'presión hidráulica',
                    'XHP',
                    'high flow',
                    'L/min',
                    'bar',
                    'psi',
                ],
                mandatory: false,
                is_differentiator: true,
            });
        }
    }

    const typeContextText = `${doc.type_key} ${doc.canonical_type_es} ${doc.categoria_equipo || ''}`;
    const upgradedSchema = ensureUniversalEnergyAxesInSpecSchema(baseAxes, typeContextText);

    const upgradedDoc: GlobalEquipmentTypeDoc = {
        ...doc,
        spec_schema: upgradedSchema,
        schema_version: EQUIPMENT_TYPE_SCHEMA_VERSION,
        updated_at: new Date().toISOString(),
    };

    if (upgradedDoc.pillar_blueprints?.ficha_tecnica) {
        upgradedDoc.pillar_blueprints = {
            ...upgradedDoc.pillar_blueprints,
            ficha_tecnica: resolveElasticFichaTecnicaBlueprint(upgradedDoc),
        };
    }

    return { doc: upgradedDoc, modified: true };
}

interface CachedTypeEntry {
    doc: GlobalEquipmentTypeDoc;
    expiresAt: number;
}

const memoryByTypeKey = new Map<string, CachedTypeEntry>();
const memoryAliasToKey = new Map<string, string>();

const FORBIDDEN_VAGUE_TYPE_HINTS = new Set([
    '',
    'maquinaria',
    'maquinaria pesada',
    'maquinaria industrial',
    'equipo',
    'equipo pesado',
    'equipo industrial',
    'equipo operativo',
    'equipamiento industrial',
    'activo',
    'vehiculo',
    'herramienta',
    '[informacion tecnica no declarada en ficha]',
    '[pendiente de registro]',
]);

const FORBIDDEN_AXIS_META_REGEX =
    /\b(a[ñn]o|per[ií]odo|producci[oó]n|fabricaci[oó]n|lanzamiento|historia|origen|pa[ií]s|descripci[oó]n|resumen|ventaja|beneficio|eslogan|marketing|garant[ií]a|precio|costo|aplicaci[oó]n\s+general|comentario)\b/i;

const VALID_SI_UNIT_DECLARATION_REGEX =
    /\b(kg|t\b|g\b|ton|kw|w\b|mw|hp|cv|kva|va\b|v\b|kv|a\b|ah|kwh|hz|khz|mhz|m³|m3|cm³|cm3|cc|l\b|ml|mm|cm|m\b|km|m²|m2|l\/s|l\/min|l\/h|m³\/min|m3\/min|m³\/h|m3\/h|cfm|gpm|bar|mbar|pa\b|kpa|mpa|psi|kn|n·m|nm|t·m|kn·m|kgf|j\b|kj|bpm|rpm|km\/h|m\/s|db|dba|°c|°|%)\b/i;

const TYPE_STOPWORDS = new Set([
    'de',
    'del',
    'la',
    'las',
    'el',
    'los',
    'en',
    'con',
    'sin',
    'para',
    'por',
    'sobre',
    'y',
    'o',
    'a',
    'tipo',
    'serie',
]);

function stripAccentsLower(raw: string): string {
    return String(raw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

export function cleanCanonicalTypeDisplayEs(rawType: string): string {
    const cleaned = String(rawType || '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\b(19|20)\d{2}\s*[-–—/]\s*((19|20)\d{2}|presente|actualidad|hoy)\b/gi, ' ')
        .replace(/\b(19|20)\d{2}\+?\b/g, ' ')
        .replace(/\s*[-–—]\s*serie\s+[a-z0-9-]+$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.toUpperCase();
}

export function normalizeEquipmentTypeAlias(raw: string): string {
    return stripAccentsLower(
        String(raw || '')
            .replace(/\([^)]*\)/g, ' ')
            .replace(/\b(19|20)\d{2}\b/g, ' ')
    )
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeEquipmentTypeKey(rawType: string): string {
    const alias = normalizeEquipmentTypeAlias(rawType);
    if (!alias) return '';
    return alias
        .split(' ')
        .filter((tok) => tok.length > 0 && !/^(el|la|los|las)$/.test(tok))
        .join('_')
        .slice(0, 72);
}

function buildTypeSearchTokens(
    canonicalTypeEs: string,
    categoriaEs: string,
    aliases: string[]
): string[] {
    const bag = [canonicalTypeEs, categoriaEs, ...aliases]
        .map((s) => normalizeEquipmentTypeAlias(s))
        .join(' ')
        .split(/\s+/)
        .filter((t) => t.length >= 2 && !TYPE_STOPWORDS.has(t));
    return Array.from(new Set(bag)).slice(0, 35);
}

interface SeedTypeBlueprint {
    type_key: string;
    canonical_type_es: string;
    categoria_equipo: string;
    archetype_id: MachineryArchetypeId;
    type_aliases: string[];
    synonymRegex: RegExp;
    spec_schema: EquipmentTypeAxisSchemaItem[];
}

const SEEDED_TYPE_BLUEPRINTS: SeedTypeBlueprint[] = [
    {
        type_key: 'motoniveladora',
        canonical_type_es: 'MOTONIVELADORA',
        categoria_equipo: 'MOVIMIENTO DE TIERRA Y VIALIDAD',
        archetype_id: 'MOTONIVELADORA',
        type_aliases: [
            'motoniveladora',
            'motoniveladora articulada',
            'motor grader',
            'niveladora vial',
            'motoniveladora de chasis articulado',
        ],
        synonymRegex: /\b(motoniveladora|motor\s*grader|niveladora\s+vial)\b/i,
        spec_schema: [
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['potencia neta', 'net power', 'VHP', 'potencia base', 'kW', 'HP'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'ancho_vertedera',
                label_es: 'Vertedera',
                unit_si: 'mm',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['ancho de vertedera', 'hoja vertedera', 'blade width', 'moldboard width', 'mm', 'ft'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'traccion_hoja',
                label_es: 'Tracción hoja',
                unit_si: 'kN (kg)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['tracción en la hoja', 'blade pull', 'drawbar pull', 'kN', 'kg'],
                mandatory: false,
                is_differentiator: true,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['peso operativo', 'operating weight', 'peso de operación', 'kg', 'lb'],
                mandatory: true,
                is_differentiator: false,
            },
        ],
    },
    {
        type_key: 'bulldozer_sobre_orugas',
        canonical_type_es: 'BULLDOZER SOBRE ORUGAS',
        categoria_equipo: 'MOVIMIENTO DE TIERRA',
        archetype_id: 'BULLDOZER_ORUGAS',
        type_aliases: [
            'bulldozer sobre orugas',
            'tractor topador sobre orugas',
            'tractor de cadenas',
            'track type tractor',
            'crawler dozer',
            'bulldozer',
        ],
        synonymRegex:
            /^(?!.*\b(neumatic|ruedas|wheel)\b).*\b(bulldozer|tractor\s+topador|tractor\s+(?:sobre\s+orugas|de\s+cadenas)|crawler\s+dozer|track[- ]type\s+tractor)\b/i,
        spec_schema: [
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['potencia neta', 'flywheel power', 'net power', 'potencia al volante', 'kW', 'HP'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['peso operativo', 'operating weight', 'masa operativa', 'kg', 'lb'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'capacidad_hoja',
                label_es: 'Hoja',
                unit_si: 'm³',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['capacidad de hoja', 'blade capacity', 'SU-blade', 'U-blade', 'm3', 'yd3'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'tren_rodaje',
                label_es: 'Rodaje',
                unit_si: 'Rueda cabilla elevada | Oruga convencional | Baja presión LGP',
                value_kind: 'CLOSED_ENUM',
                allowed_enum_values: ['Rueda cabilla elevada', 'Oruga convencional', 'Baja presión LGP'],
                search_keywords: ['rueda cabilla elevada', 'elevated sprocket', 'high drive', 'oruga convencional', 'LGP'],
                mandatory: false,
                is_differentiator: true,
            },
        ],
    },
    {
        type_key: 'bulldozer_sobre_neumaticos',
        canonical_type_es: 'BULLDOZER SOBRE NEUMÁTICOS',
        categoria_equipo: 'MOVIMIENTO DE TIERRA',
        archetype_id: 'BULLDOZER_NEUMATICOS',
        type_aliases: ['bulldozer sobre neumaticos', 'tractor topador sobre ruedas', 'wheel dozer'],
        synonymRegex: /\b(wheel\s+dozer|(?:bulldozer|tractor\s+topador).*\b(?:neumatic|ruedas))\b/i,
        spec_schema: [
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['potencia neta', 'net power', 'kW', 'HP'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['peso operativo', 'operating weight', 'kg'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'capacidad_hoja',
                label_es: 'Hoja',
                unit_si: 'm³',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['capacidad de hoja', 'blade capacity', 'm3'],
                mandatory: true,
                is_differentiator: true,
            },
        ],
    },
    {
        type_key: 'minicargador_sobre_neumaticos',
        canonical_type_es: 'MINICARGADOR SOBRE NEUMÁTICOS',
        categoria_equipo: 'CARGUÍO COMPACTO Y MOVIMIENTO DE TIERRA',
        archetype_id: 'MINICARGADOR_SSL_CTL',
        type_aliases: [
            'minicargador sobre neumaticos',
            'minicargador de chasis rigido sobre neumaticos',
            'minicargador',
            'minicargador frontal',
            'skid steer loader',
            'ssl',
        ],
        synonymRegex:
            /^(?!.*\b(orugas|track)\b).*\b(minicargador|skid\s*steer|\bssl\b)\b/i,
        spec_schema: [
            {
                axis_key: 'capacidad_nominal_roc',
                label_es: 'ROC',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['rated operating capacity', 'capacidad nominal de operación', 'ROC', 'kg', 'lb'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'carga_vuelco_estatica',
                label_es: 'Carga estática vuelco',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['tipping load', 'carga estática de vuelco', 'carga de vuelco', 'kg', 'lb'],
                mandatory: false,
                is_differentiator: true,
            },
            {
                axis_key: 'altura_max_descarga',
                label_es: 'Altura máx. descarga',
                unit_si: 'mm',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: [
                    'maximum dump clearance',
                    'altura máxima de descarga',
                    'dump height',
                    'hinge pin height',
                    'mm',
                ],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['net power', 'potencia neta', 'kW', 'HP'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'caudal_presion_hidraulica_aux',
                label_es: 'Hidráulica auxiliar',
                unit_si: 'L/min @ bar',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: [
                    'hydraulic flow',
                    'caudal hidráulico auxiliar',
                    'presión hidráulica',
                    'XHP',
                    'high flow',
                    'L/min',
                    'bar',
                    'psi',
                ],
                mandatory: false,
                is_differentiator: true,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['operating weight', 'peso operativo', 'kg', 'lb'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'cinematica_levante',
                label_es: 'Cinemática',
                unit_si: 'Levante vertical | Levante radial',
                value_kind: 'CLOSED_ENUM',
                allowed_enum_values: ['Levante vertical', 'Levante radial'],
                search_keywords: ['vertical lift', 'radial lift', 'levante vertical', 'levante radial'],
                mandatory: false,
                is_differentiator: true,
            },
        ],
    },
    {
        type_key: 'cargador_compacto_sobre_orugas',
        canonical_type_es: 'CARGADOR COMPACTO SOBRE ORUGAS',
        categoria_equipo: 'CARGUÍO COMPACTO Y MOVIMIENTO DE TIERRA',
        archetype_id: 'MINICARGADOR_SSL_CTL',
        type_aliases: [
            'cargador compacto sobre orugas',
            'minicargador sobre orugas',
            'compact track loader',
            'multi terrain loader',
            'ctl',
        ],
        synonymRegex:
            /\b(compact\s+track\s+loader|multi\s+terrain\s+loader|\bctl\b|(?:minicargador|cargador\s+compacto).*\borugas\b)\b/i,
        spec_schema: [
            {
                axis_key: 'capacidad_nominal_roc',
                label_es: 'ROC',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['rated operating capacity', 'ROC 35%', 'ROC 50%', 'capacidad nominal', 'kg'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'carga_vuelco_estatica',
                label_es: 'Carga estática vuelco',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['tipping load', 'carga estática de vuelco', 'carga de vuelco', 'kg', 'lb'],
                mandatory: false,
                is_differentiator: true,
            },
            {
                axis_key: 'altura_max_descarga',
                label_es: 'Altura máx. descarga',
                unit_si: 'mm',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['maximum dump clearance', 'altura máxima de descarga', 'mm'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['net power', 'potencia neta', 'kW', 'HP'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'caudal_presion_hidraulica_aux',
                label_es: 'Hidráulica auxiliar',
                unit_si: 'L/min @ bar',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: [
                    'hydraulic flow',
                    'caudal hidráulico auxiliar',
                    'presión hidráulica',
                    'XHP',
                    'high flow',
                    'L/min',
                    'bar',
                    'psi',
                ],
                mandatory: false,
                is_differentiator: true,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['operating weight', 'peso operativo', 'kg'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'cinematica_levante',
                label_es: 'Cinemática',
                unit_si: 'Levante vertical | Levante radial',
                value_kind: 'CLOSED_ENUM',
                allowed_enum_values: ['Levante vertical', 'Levante radial'],
                search_keywords: ['vertical lift', 'radial lift', 'levante vertical', 'levante radial'],
                mandatory: false,
                is_differentiator: true,
            },
        ],
    },
    {
        type_key: 'excavadora_hidraulica',
        canonical_type_es: 'EXCAVADORA HIDRÁULICA',
        categoria_equipo: 'EXCAVACIÓN Y CARGUÍO',
        archetype_id: 'EXCAVADORA_HIDRAULICA',
        type_aliases: [
            'excavadora hidraulica',
            'excavadora hidraulica sobre orugas',
            'excavadora sobre orugas',
            'hydraulic excavator',
            'pala hidraulica',
        ],
        synonymRegex: /^(?!.*\bretroexcavadora\b).*\b(excavadora\s+hidraulica|excavadora\s+sobre\s+orugas|hydraulic\s+excavator|pala\s+hidraulica)\b/i,
        spec_schema: [
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['operating weight', 'peso operativo', 'kg', 't'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['net power', 'potencia neta', 'kW', 'HP'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'capacidad_balde',
                label_es: 'Balde',
                unit_si: 'm³',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['bucket capacity', 'capacidad de balde', 'capacidad de cucharón', 'm3'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'profundidad_max_excavacion',
                label_es: 'Prof. máx. excavación',
                unit_si: 'mm',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['maximum digging depth', 'profundidad máxima de excavación', 'mm', 'm'],
                mandatory: true,
                is_differentiator: true,
            },
        ],
    },
    {
        type_key: 'retroexcavadora',
        canonical_type_es: 'RETROEXCAVADORA CARGADORA',
        categoria_equipo: 'EXCAVACIÓN Y CARGUÍO POLIVALENTE',
        archetype_id: 'RETROEXCAVADORA',
        type_aliases: ['retroexcavadora', 'retroexcavadora cargadora', 'backhoe loader'],
        synonymRegex: /\b(retroexcavadora|backhoe\s*loader)\b/i,
        spec_schema: [
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['net power', 'potencia neta', 'kW', 'HP'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'profundidad_max_excavacion',
                label_es: 'Prof. máx. excavación',
                unit_si: 'mm',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['digging depth', 'profundidad máxima de excavación', 'mm'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'capacidad_balde',
                label_es: 'Balde cargador',
                unit_si: 'm³',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['loader bucket capacity', 'capacidad balde cargador', 'm3'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['operating weight', 'peso operativo', 'kg'],
                mandatory: true,
                is_differentiator: false,
            },
        ],
    },
    {
        type_key: 'cargador_frontal',
        canonical_type_es: 'CARGADOR FRONTAL',
        categoria_equipo: 'CARGUÍO Y MOVIMIENTO DE TIERRA',
        archetype_id: 'CARGADOR_FRONTAL',
        type_aliases: [
            'cargador frontal',
            'cargador frontal de ruedas',
            'cargador sobre ruedas',
            'wheel loader',
        ],
        synonymRegex: /^(?!.*\b(scooptram|\blhd\b|subterraneo)\b).*\b(cargador\s+frontal|cargador\s+(?:sobre|de)\s+ruedas|wheel\s+loader)\b/i,
        spec_schema: [
            {
                axis_key: 'capacidad_balde',
                label_es: 'Balde',
                unit_si: 'm³',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['bucket capacity', 'capacidad de balde', 'cucharón', 'm3'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'carga_util_o_vuelco',
                label_es: 'Carga nominal',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['rated payload', 'static tipping load', 'carga útil', 'carga de vuelco', 'kg'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'altura_max_descarga',
                label_es: 'Altura máx. descarga',
                unit_si: 'mm',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['dump clearance', 'altura máxima de descarga', 'hinge pin', 'mm'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['net power', 'potencia neta', 'kW', 'HP'],
                mandatory: true,
                is_differentiator: false,
            },
        ],
    },
    {
        type_key: 'camion_minero_caex',
        canonical_type_es: 'CAMIÓN MINERO CAEX',
        categoria_equipo: 'TRANSPORTE MINERO DE ALTO TONELAJE',
        archetype_id: 'CAMION_TOLVA_CAEX',
        type_aliases: [
            'camion minero caex',
            'camion de extraccion minera',
            'camion minero rigido',
            'mining truck',
            'haul truck',
            'caex',
        ],
        synonymRegex: /\b(camion\s+(?:minero|de\s+extraccion|caex)|\bcaex\b|mining\s+truck|haul\s+truck)\b/i,
        spec_schema: [
            {
                axis_key: 'carga_util_nominal',
                label_es: 'Carga útil',
                unit_si: 't',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['nominal payload', 'rated payload', 'carga útil nominal', 'toneladas', 't'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'capacidad_tolva',
                label_es: 'Tolva colmada',
                unit_si: 'm³',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['heaped capacity 2:1', 'capacidad de tolva colmada', 'body capacity', 'm3'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'potencia_motor',
                label_es: 'Potencia bruta',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['gross power', 'potencia bruta', 'potencia neta', 'kW', 'HP'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'peso_bruto_vehicular',
                label_es: 'PBV operativo',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['gross machine operating weight', 'GMW', 'GVW', 'peso bruto operativo', 'kg'],
                mandatory: false,
                is_differentiator: false,
            },
        ],
    },
    {
        type_key: 'camion_tolva',
        canonical_type_es: 'CAMIÓN TOLVA',
        categoria_equipo: 'TRANSPORTE PESADO Y MOVIMIENTO DE TIERRA',
        archetype_id: 'CAMION_TOLVA_CAEX',
        type_aliases: ['camion tolva', 'camion volquete', 'dumper', 'camion batea'],
        synonymRegex: /\b(camion\s+(?:tolva|volquete|batea)|volquete\b)\b/i,
        spec_schema: [
            {
                axis_key: 'carga_util_nominal',
                label_es: 'Carga útil',
                unit_si: 'kg / t',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['carga útil', 'payload', 'capacidad de carga', 'kg', 't'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'capacidad_tolva',
                label_es: 'Capacidad tolva',
                unit_si: 'm³',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['capacidad de tolva', 'volumen tolva', 'm3'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'potencia_motor',
                label_es: 'Potencia',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['potencia motor', 'engine power', 'kW', 'HP', 'CV'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'traccion_ejes',
                label_es: 'Configuración ejes',
                unit_si: '4x2 | 6x4 | 8x4 | 6x6',
                value_kind: 'CLOSED_ENUM',
                allowed_enum_values: ['4x2', '6x4', '8x4', '6x6'],
                search_keywords: ['configuración de ejes', 'axle configuration', '6x4', '8x4', '6x6'],
                mandatory: false,
                is_differentiator: true,
            },
        ],
    },
    {
        type_key: 'tractocamion',
        canonical_type_es: 'TRACTOCAMIÓN',
        categoria_equipo: 'TRANSPORTE PESADO DE RUTA Y FAENA',
        archetype_id: 'VEHICULO_LIVIANO_TRANSPORTE',
        type_aliases: ['tractocamion', 'camion tracto', 'cabeza tractora', 'tractor de carretera'],
        synonymRegex: /\b(tractocamion|camion\s+tracto|cabeza\s+tractora)\b/i,
        spec_schema: [
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['potencia máxima', 'engine power', 'kW', 'HP', 'CV'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'par_motor',
                label_es: 'Torque máx.',
                unit_si: 'N·m',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['torque máximo', 'par motor', 'max torque', 'Nm'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'capacidad_carga_o_arrastre',
                label_es: 'PBVC / Arrastre',
                unit_si: 'kg / t',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['peso bruto combinado', 'PBVC', 'GCW', 'capacidad de tracción', 'kg', 't'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'traccion',
                label_es: 'Configuración ejes',
                unit_si: '4x2 | 6x2 | 6x4 | 8x4',
                value_kind: 'CLOSED_ENUM',
                allowed_enum_values: ['4x2', '6x2', '6x4', '8x4'],
                search_keywords: ['4x2', '6x2', '6x4', '8x4', 'tracción'],
                mandatory: false,
                is_differentiator: true,
            },
        ],
    },
    {
        type_key: 'camioneta_pickup',
        canonical_type_es: 'CAMIONETA PICK-UP',
        categoria_equipo: 'TRANSPORTE Y VEHÍCULOS LIVIANOS',
        archetype_id: 'VEHICULO_LIVIANO_TRANSPORTE',
        type_aliases: [
            'camioneta pick up',
            'camioneta pickup',
            'camioneta pick-up doble cabina',
            'camioneta doble cabina',
            'camioneta cabina simple',
            'pick-up',
            'pickup',
            'camioneta 4x4',
        ],
        synonymRegex: /\b(camioneta|pick[- ]?up)\b/i,
        spec_schema: [
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['potencia máxima', 'potencia motor', 'max power', 'kW', 'HP', 'CV'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'par_motor',
                label_es: 'Torque',
                unit_si: 'N·m',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['torque', 'par motor', 'par máximo', 'Nm'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'capacidad_carga_o_arrastre',
                label_es: 'Carga útil',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['carga útil', 'capacidad de carga', 'payload', 'kg'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'capacidad_remolque',
                label_es: 'Remolque máx.',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['capacidad de remolque con freno', 'towing capacity', 'arrastre', 'kg'],
                mandatory: false,
                is_differentiator: false,
            },
            {
                axis_key: 'traccion',
                label_es: 'Tracción',
                unit_si: '4x4 | 4x2 | AWD',
                value_kind: 'CLOSED_ENUM',
                allowed_enum_values: ['4x4', '4x2', 'AWD'],
                search_keywords: ['tracción', 'drive type', '4x4', '4x2', 'AWD', '4WD'],
                mandatory: false,
                is_differentiator: true,
            },
        ],
    },
    {
        type_key: 'automovil_suv',
        canonical_type_es: 'AUTOMÓVIL / SUV',
        categoria_equipo: 'TRANSPORTE Y VEHÍCULOS LIVIANOS',
        archetype_id: 'VEHICULO_LIVIANO_TRANSPORTE',
        type_aliases: ['automovil suv', 'suv', 'todoterreno', 'automovil sedan', 'hatchback', 'crossover'],
        synonymRegex: /\b(\bsuv\b|crossover|automovil|sedan|hatchback|station\s+wagon|citycar)\b/i,
        spec_schema: [
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['potencia máxima', 'power', 'kW', 'HP', 'CV'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'par_motor',
                label_es: 'Torque',
                unit_si: 'N·m',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['torque', 'par motor', 'Nm'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'capacidad_maletero_o_carga',
                label_es: 'Volumen maletero',
                unit_si: 'L',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['capacidad maletero', 'volumen baúl', 'boot capacity', 'litros', 'L'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'traccion',
                label_es: 'Tracción',
                unit_si: '4x2 | 4x4 | AWD | FWD | RWD',
                value_kind: 'CLOSED_ENUM',
                allowed_enum_values: ['4x2', '4x4', 'AWD', 'FWD', 'RWD'],
                search_keywords: ['tracción', 'AWD', '4x4', '4x2', 'FWD', 'RWD'],
                mandatory: false,
                is_differentiator: true,
            },
        ],
    },
    {
        type_key: 'furgon_van',
        canonical_type_es: 'FURGÓN / VAN UTILITARIA',
        categoria_equipo: 'TRANSPORTE COMERCIAL Y APOYO',
        archetype_id: 'VEHICULO_LIVIANO_TRANSPORTE',
        type_aliases: ['furgon', 'furgoneta', 'van utilitaria', 'van de carga', 'furgon cerrado'],
        synonymRegex: /\b(furgon|furgoneta|van\s+(?:utilitaria|de\s+carga|comercial))\b/i,
        spec_schema: [
            {
                axis_key: 'capacidad_carga_o_arrastre',
                label_es: 'Carga útil',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['carga útil', 'payload', 'capacidad de carga', 'kg'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'volumen_carga',
                label_es: 'Volumen carga',
                unit_si: 'm³',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['volumen de carga', 'cargo volume', 'm3'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['potencia', 'kW', 'HP', 'CV'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'par_motor',
                label_es: 'Torque',
                unit_si: 'N·m',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['torque', 'par motor', 'Nm'],
                mandatory: true,
                is_differentiator: false,
            },
        ],
    },
    {
        type_key: 'compresor_aire',
        canonical_type_es: 'COMPRESOR DE AIRE',
        categoria_equipo: 'ENERGÍA NEUMÁTICA Y COMPRESIÓN',
        archetype_id: 'COMPRESOR_GENERADOR_BOMBA',
        type_aliases: [
            'compresor de aire',
            'compresor portatil',
            'compresor de tornillo',
            'compresor neumatico',
            'air compressor',
            'compresor',
        ],
        synonymRegex: /\b(compresor(\s+de\s+aire|\s+portatil|\s+de\s+tornillo|\s+estacionario)?|air\s+compressor)\b/i,
        spec_schema: [
            {
                axis_key: 'caudal_aire_libre_fad',
                label_es: 'Caudal FAD',
                unit_si: 'm³/min (CFM)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['free air delivery', 'FAD', 'caudal de aire libre', 'entrega de aire', 'm3/min', 'CFM', 'L/s'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'presion_nominal_trabajo',
                label_es: 'Presión nominal',
                unit_si: 'bar (PSI)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['normal effective working pressure', 'presión nominal de trabajo', 'working pressure', 'bar', 'PSI'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'potencia_motriz',
                label_es: 'Potencia motriz',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['engine power', 'motor power', 'potencia motor', 'kW', 'HP'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'configuracion_montaje',
                label_es: 'Configuración',
                unit_si: 'Portátil remolcable | Estacionario | Sobre camión',
                value_kind: 'CLOSED_ENUM',
                allowed_enum_values: ['Portátil remolcable', 'Estacionario', 'Sobre camión'],
                search_keywords: ['portable', 'towable', 'stationary', 'portátil', 'remolcable', 'estacionario'],
                mandatory: false,
                is_differentiator: true,
            },
        ],
    },
    {
        type_key: 'grupo_electrogeno',
        canonical_type_es: 'GRUPO ELECTRÓGENO',
        categoria_equipo: 'GENERACIÓN ELÉCTRICA E INDUSTRIAL',
        archetype_id: 'COMPRESOR_GENERADOR_BOMBA',
        type_aliases: ['grupo electrogeno', 'generador electrico', 'generador diesel', 'genset'],
        synonymRegex: /\b(grupo\s+electrogeno|generador\s+(?:electrico|diesel|gasolina|industrial)|genset)\b/i,
        spec_schema: [
            {
                axis_key: 'potencia_prime',
                label_es: 'Potencia Prime',
                unit_si: 'kVA (kW)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['prime power', 'potencia prime', 'PRP', 'potencia continua', 'kVA', 'kW'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'potencia_standby',
                label_es: 'Potencia Standby',
                unit_si: 'kVA (kW)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['standby power', 'ESP', 'potencia emergencia', 'kVA', 'kW'],
                mandatory: false,
                is_differentiator: true,
            },
            {
                axis_key: 'tension_nominal',
                label_es: 'Tensión nominal',
                unit_si: 'V',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['rated voltage', 'tensión nominal', 'voltaje', '400 V', '380 V', '220 V'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'frecuencia_nominal',
                label_es: 'Frecuencia',
                unit_si: 'Hz',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['frequency', 'frecuencia', '50 Hz', '60 Hz'],
                mandatory: true,
                is_differentiator: false,
            },
        ],
    },
    {
        type_key: 'perforadora_neumatica_manual',
        canonical_type_es: 'PERFORADORA NEUMÁTICA MANUAL',
        categoria_equipo: 'PERFORACIÓN Y TRONADURA',
        archetype_id: 'PERFORADORA_SONDAJE',
        type_aliases: [
            'perforadora neumatica manual',
            'perforadora manual',
            'perforadora jackleg',
            'perforadora stopper',
            'pusher leg rock drill',
            'jackleg',
        ],
        synonymRegex: /\b(perforadora\s+(?:neumatica\s+)?manual|jackleg|stopper|pusher\s+leg\s+rock\s+drill|martillo\s+perforador\s+neumatico)\b/i,
        spec_schema: [
            {
                axis_key: 'diametro_perforacion',
                label_es: 'Diámetro perf.',
                unit_si: 'mm',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['hole range', 'hole diameter', 'diámetro de perforación', 'rango de perforación', 'mm'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'frecuencia_impacto',
                label_es: 'Frecuencia impacto',
                unit_si: 'Hz (BPM)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['impact frequency', 'blows per minute', 'frecuencia de impacto', 'Hz', 'BPM'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'consumo_aire',
                label_es: 'Consumo aire',
                unit_si: 'L/s',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['air consumption', 'consumo de aire', 'L/s', 'CFM', 'm3/min'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'presion_trabajo',
                label_es: 'Presión trabajo',
                unit_si: 'bar',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['working pressure', 'presión de trabajo', 'air pressure', 'bar', 'MPa'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['weight', 'peso neto', 'peso sin barra', 'kg'],
                mandatory: true,
                is_differentiator: false,
            },
        ],
    },
    {
        type_key: 'sondaje_diamantino',
        canonical_type_es: 'EQUIPO DE SONDAJE DIAMANTINO',
        categoria_equipo: 'EXPLORACIÓN Y SONDAJE',
        archetype_id: 'PERFORADORA_SONDAJE',
        type_aliases: [
            'equipo de sondaje diamantino',
            'sondaje diamantino',
            'perforadora de diamantina',
            'core drill rig',
            'diamond drill rig',
        ],
        synonymRegex: /\b(sondaje\s+diamantino|perforadora\s+de\s+diamantina|core\s+drill\s+rig|diamond\s+drill)\b/i,
        spec_schema: [
            {
                axis_key: 'capacidad_profundidad_nq',
                label_es: 'Capacidad NQ',
                unit_si: 'm',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['depth capacity NQ', 'capacidad de profundidad NQ', 'HQ', 'PQ', 'm'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'fuerza_traccion_pullback',
                label_es: 'Pullback (Tracción)',
                unit_si: 'kN',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['pullback', 'fuerza de tracción', 'capacidad de levante cabezal', 'kN', 'daN'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'potencia_instalada',
                label_es: 'Potencia instalada',
                unit_si: 'kW (HP)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['power unit', 'engine power', 'potencia instalada', 'kW', 'HP'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['weight', 'peso operativo', 'kg'],
                mandatory: false,
                is_differentiator: false,
            },
        ],
    },
    {
        type_key: 'camion_pluma',
        canonical_type_es: 'CAMIÓN PLUMA / GRÚA ARTICULADA',
        categoria_equipo: 'IZAJE Y MANIPULACIÓN DE CARGAS',
        archetype_id: 'GRUA_IZAJE_MANIPULADOR',
        type_aliases: [
            'camion pluma',
            'grua articulada',
            'grua articulada sobre camion',
            'loader crane',
            'knuckle boom crane',
        ],
        synonymRegex: /\b(camion\s+pluma|grua\s+articulada|loader\s+crane|knuckle\s+boom)\b/i,
        spec_schema: [
            {
                axis_key: 'momento_max_izaje',
                label_es: 'Momento izaje',
                unit_si: 't·m (kN·m)',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['lifting capacity', 'momento de elevación', 'momento de izaje', 'tm', 'kNm'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'capacidad_max_izaje',
                label_es: 'Carga máx.',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['max load', 'capacidad máxima de carga', 'carga máxima', 'kg', 't'],
                mandatory: true,
                is_differentiator: true,
            },
            {
                axis_key: 'alcance_hidraulico_max',
                label_es: 'Alcance hidráulico',
                unit_si: 'm',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['hydraulic outreach', 'alcance hidráulico máximo', 'horizontal outreach', 'm'],
                mandatory: true,
                is_differentiator: false,
            },
            {
                axis_key: 'peso_propio_grua',
                label_es: 'Peso grúa',
                unit_si: 'kg',
                value_kind: 'PHYSICAL_MAGNITUDE',
                search_keywords: ['crane weight', 'peso propio', 'dead weight', 'kg'],
                mandatory: false,
                is_differentiator: false,
            },
        ],
    },
];

const SEED_BY_KEY = new Map<string, SeedTypeBlueprint>(
    SEEDED_TYPE_BLUEPRINTS.map((b) => [b.type_key, b])
);

function blueprintToDoc(bp: SeedTypeBlueprint): GlobalEquipmentTypeDoc {
    const nowIso = new Date().toISOString();
    const aliases = Array.from(
        new Set([bp.type_key.replace(/_/g, ' '), ...bp.type_aliases.map(normalizeEquipmentTypeAlias)])
    ).filter(Boolean);
    const enrichedSchema = ensureUniversalEnergyAxesInSpecSchema(
        bp.spec_schema,
        `${bp.type_key} ${bp.canonical_type_es} ${bp.categoria_equipo}`
    );
    return {
        type_key: bp.type_key,
        canonical_type_es: bp.canonical_type_es,
        categoria_equipo: bp.categoria_equipo,
        archetype_id: bp.archetype_id,
        type_aliases: aliases,
        search_tokens: buildTypeSearchTokens(bp.canonical_type_es, bp.categoria_equipo, aliases),
        spec_schema: enrichedSchema,
        schema_version: EQUIPMENT_TYPE_SCHEMA_VERSION,
        origin: 'SEEDED_ISO_BASE',
        is_human_locked: false,
        usage_count: 1,
        created_at: nowIso,
        updated_at: nowIso,
    };
}

function putInMemoryCache(doc: GlobalEquipmentTypeDoc): void {
    memoryByTypeKey.set(doc.type_key, {
        doc,
        expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
    });
    memoryAliasToKey.set(normalizeEquipmentTypeAlias(doc.canonical_type_es), doc.type_key);
    memoryAliasToKey.set(doc.type_key.replace(/_/g, ' '), doc.type_key);
    for (const al of doc.type_aliases || []) {
        const norm = normalizeEquipmentTypeAlias(al);
        if (norm) memoryAliasToKey.set(norm, doc.type_key);
    }
}

function getFromMemoryCacheByKey(typeKey: string): GlobalEquipmentTypeDoc | null {
    const entry = memoryByTypeKey.get(typeKey);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        memoryByTypeKey.delete(typeKey);
        return null;
    }
    return entry.doc;
}

function matchSeededBlueprint(rawTypeHint: string): SeedTypeBlueprint | null {
    const clean = stripAccentsLower(
        String(rawTypeHint || '').replace(/\([^)]*\)/g, ' ')
    );
    if (!clean) return null;

    const exactSlug = normalizeEquipmentTypeKey(rawTypeHint);
    if (SEED_BY_KEY.has(exactSlug)) {
        return SEED_BY_KEY.get(exactSlug)!;
    }

    const normAlias = normalizeEquipmentTypeAlias(rawTypeHint);
    for (const bp of SEEDED_TYPE_BLUEPRINTS) {
        if (bp.type_aliases.some((a) => normalizeEquipmentTypeAlias(a) === normAlias)) {
            return bp;
        }
    }

    for (const bp of SEEDED_TYPE_BLUEPRINTS) {
        if (bp.synonymRegex.test(clean)) {
            return bp;
        }
    }

    return null;
}

/**
 * Detecta si la propia consulta del usuario ya menciona explícitamente un `TIPO` conocido
 * (ej. "MOTONIVELADORA CAT 140M", "COMPRESOR ATLAS COPCO XAS 185", "CAMIONETA PEUGEOT LANDTREK"),
 * permitiendo resolver el esquema en 0 ms sin llamada clasificadora previa.
 */
export function detectExplicitTypeFromQueryText(rawQuery: string): SeedTypeBlueprint | null {
    return matchSeededBlueprint(rawQuery);
}

const DYNAMIC_TYPE_SYNTHESIS_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        canonical_type_es: {
            type: Type.STRING,
            description:
                'Denominación técnica exacta y concisa del TIPO de equipo en español singular MAYÚSCULAS, sin marca, sin modelo y sin años (ej. "CHANCADOR DE MANDÍBULAS", "MANIPULADOR TELESCÓPICO", "MOTOBOMBA SUMERGIBLE", "RODILLO COMPACTADOR VIBRATORIO", "DRON INDUSTRIAL MULTIRROTOR").',
        },
        categoria_equipo: {
            type: Type.STRING,
            description:
                'Categoría funcional de ingeniería en MAYÚSCULAS (ej. "CONMINUCIÓN Y CHANCADO", "IZAJE Y MANIPULACIÓN", "BOMBEO Y FLUIDOS", "COMPACTACIÓN VIAL").',
        },
        type_aliases: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
                'Entre 3 y 7 sinónimos técnicos reales en español e inglés para este mismo TIPO de equipo.',
        },
        spec_schema: {
            type: Type.ARRAY,
            description:
                'Entre 3 y 5 características técnicas principales y diferenciadoras EXCLUSIVAS de este TIPO de equipo (solo magnitudes físicas en unidades SI o enumeraciones mecánicas cerradas; CERO parámetros de otros tipos de equipos, CERO prosa y CERO fechas históricas).',
            items: {
                type: Type.OBJECT,
                properties: {
                    axis_key: {
                        type: Type.STRING,
                        description:
                            'Identificador snake_case técnico en español sin tildes (ej. "abertura_alimentacion", "capacidad_produccion", "altura_dinamica_total").',
                    },
                    label_es: {
                        type: Type.STRING,
                        description:
                            'Etiqueta técnica concisa para tabla comparativa (máx. 24 caracteres, ej. "Abertura alim.", "Caudal máx.", "Altura máx. levante").',
                    },
                    unit_si: {
                        type: Type.STRING,
                        description:
                            'Unidad métrica SI obligatoria si es PHYSICAL_MAGNITUDE (ej. "mm", "t/h", "kW (HP)", "L/s", "m", "bar", "kg", "N·m") o lista de valores separados por | si es CLOSED_ENUM.',
                    },
                    value_kind: {
                        type: Type.STRING,
                        enum: ['PHYSICAL_MAGNITUDE', 'CLOSED_ENUM'],
                    },
                    allowed_enum_values: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        nullable: true,
                        description:
                            'Solo cuando value_kind = CLOSED_ENUM: lista cerrada de 2 a 6 opciones mecánicas discretas cortas.',
                    },
                    search_keywords: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description:
                            'Entre 3 y 6 términos exactos en español e inglés como aparecen en las hojas de especificaciones OEM para buscar este dato específico.',
                    },
                    mandatory: {
                        type: Type.BOOLEAN,
                        description: 'true para los 3 o 4 parámetros nucleares obligatorios de comparación del TIPO.',
                    },
                    is_differentiator: {
                        type: Type.BOOLEAN,
                        description: 'true para las 1 o 2 magnitudes principales que diferencian la capacidad/escala de este TIPO.',
                    },
                },
                required: [
                    'axis_key',
                    'label_es',
                    'unit_si',
                    'value_kind',
                    'allowed_enum_values',
                    'search_keywords',
                    'mandatory',
                    'is_differentiator',
                ],
            },
        },
    },
    required: ['canonical_type_es', 'categoria_equipo', 'type_aliases', 'spec_schema'],
};

/**
 * Cortafuegos estructural sobre los ejes propuestos por IA al descubrir un `TIPO` nuevo:
 * garantiza que jamás se persistan ejes subjetivos, comerciales, históricos ni carentes de unidad SI.
 */
export function validateAndSanitizeLearnedAxes(
    rawAxes: Array<Record<string, any>>
): EquipmentTypeAxisSchemaItem[] {
    const sanitized: EquipmentTypeAxisSchemaItem[] = [];
    const seenKeys = new Set<string>();

    for (const raw of rawAxes || []) {
        const axisKey = normalizeEquipmentTypeKey(String(raw.axis_key || raw.label_es || '')).slice(0, 48);
        const labelEs = String(raw.label_es || '').replace(/\s+/g, ' ').trim().slice(0, 32);
        const unitSi = String(raw.unit_si || '').replace(/\s+/g, ' ').trim().slice(0, 48);
        const valueKind: EquipmentAxisValueKind =
            raw.value_kind === 'CLOSED_ENUM' ? 'CLOSED_ENUM' : 'PHYSICAL_MAGNITUDE';

        if (!axisKey || !labelEs || seenKeys.has(axisKey)) continue;
        if (
            FORBIDDEN_AXIS_META_REGEX.test(axisKey) ||
            FORBIDDEN_AXIS_META_REGEX.test(labelEs) ||
            FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX.test(labelEs) ||
            ACCESSORY_HISTORICAL_SPEC_REGEX.test(labelEs)
        ) {
            continue;
        }

        let allowedEnums: string[] | undefined;
        if (valueKind === 'CLOSED_ENUM') {
            const rawEnums = Array.isArray(raw.allowed_enum_values) ? raw.allowed_enum_values : [];
            allowedEnums = rawEnums
                .map((v) => String(v || '').trim())
                .filter(
                    (v) =>
                        v.length >= 2 &&
                        v.length <= 36 &&
                        !FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX.test(v)
                )
                .slice(0, 6);
            if (allowedEnums.length < 2) continue;
        } else {
            if (!unitSi || !VALID_SI_UNIT_DECLARATION_REGEX.test(unitSi)) {
                continue;
            }
        }

        const keywords = Array.from(
            new Set(
                [
                    labelEs.toLowerCase(),
                    ...(Array.isArray(raw.search_keywords)
                        ? raw.search_keywords.map((k) => String(k || '').trim()).filter(Boolean)
                        : []),
                ].slice(0, 8)
            )
        );

        seenKeys.add(axisKey);
        sanitized.push({
            axis_key: axisKey,
            label_es: labelEs,
            unit_si: valueKind === 'CLOSED_ENUM' && !unitSi ? allowedEnums!.join(' | ') : unitSi,
            value_kind: valueKind,
            ...(allowedEnums ? { allowed_enum_values: allowedEnums } : {}),
            search_keywords: keywords.length > 0 ? keywords : [labelEs.toLowerCase()],
            mandatory: raw.mandatory !== false,
            is_differentiator: Boolean(raw.is_differentiator),
        });

        if (sanitized.length >= 5) break;
    }

    if (sanitized.length > 0 && !sanitized.some((a) => a.mandatory)) {
        sanitized[0].mandatory = true;
    }
    if (sanitized.length > 0 && !sanitized.some((a) => a.is_differentiator)) {
        sanitized[0].is_differentiator = true;
    }

    return sanitized;
}

async function persistTypeDocWithEmbedding(
    doc: GlobalEquipmentTypeDoc,
    extraAlias?: string
): Promise<GlobalEquipmentTypeDoc> {
    const mergedAliases = Array.from(
        new Set(
            [
                ...doc.type_aliases,
                normalizeEquipmentTypeAlias(doc.canonical_type_es),
                ...(extraAlias ? [normalizeEquipmentTypeAlias(extraAlias)] : []),
            ].filter((a) => a.length >= 2 && !FORBIDDEN_VAGUE_TYPE_HINTS.has(a))
        )
    );

    const searchTokens = buildTypeSearchTokens(
        doc.canonical_type_es,
        doc.categoria_equipo,
        mergedAliases
    );

    let embedding = doc.embedding_768_raw;
    if (!Array.isArray(embedding) || embedding.length === 0) {
        try {
            embedding = await ResilientAIClient.embedText(
                `TIPO DE EQUIPO: ${doc.canonical_type_es} | CATEGORÍA: ${doc.categoria_equipo} | SINÓNIMOS: ${mergedAliases.join(', ')}`,
                {
                    taskType: 'RETRIEVAL_DOCUMENT',
                    outputDimensionality: 768,
                    title: doc.canonical_type_es,
                }
            );
        } catch {
            // Entorno offline: continuar con indexación léxica exacta
        }
    }

    const enrichedSchema = ensureUniversalEnergyAxesInSpecSchema(
        doc.spec_schema || [],
        `${doc.type_key} ${doc.canonical_type_es} ${doc.categoria_equipo}`
    );

    const finalDoc: GlobalEquipmentTypeDoc = {
        ...doc,
        spec_schema: enrichedSchema,
        schema_version: EQUIPMENT_TYPE_SCHEMA_VERSION,
        type_aliases: mergedAliases,
        search_tokens: searchTokens,
        ...(embedding ? { embedding_768_raw: embedding } : {}),
        updated_at: new Date().toISOString(),
    };

    try {
        await db
            .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
            .doc(finalDoc.type_key)
            .set(finalDoc, { merge: true });
    } catch (err: any) {
        console.warn('[EquipmentTypeRegistry] No se pudo persistir en global_equipment_types:', err?.message);
    }

    putInMemoryCache(finalDoc);
    return finalDoc;
}

export interface ResolveEquipmentTypeParams {
    rawTypeKey?: string | null;
    rawTypeHint?: string | null;
    rawCategoryHint?: string | null;
    assetQueryContext?: string | null;
}

export interface ResolvedEquipmentTypeResult {
    typeDoc: GlobalEquipmentTypeDoc;
    reusedExistingSchema: boolean;
    resolutionSource: 'MEMORY_CACHE' | 'FIRESTORE_EXACT' | 'SEEDED_ISO' | 'SEMANTIC_768D' | 'AI_LEARNED_NEW';
    latencyMs: number;
}

/**
 * Resuelve en `< 10 ms` el esquema técnico de un `TIPO` si ya fue registrado previamente,
 * o aprende, valida y persiste automáticamente sus ejes físicos diferenciadores si es inédito.
 */
export async function resolveOrLearnEquipmentType(
    params: ResolveEquipmentTypeParams
): Promise<ResolvedEquipmentTypeResult> {
    const startMs = Date.now();
    const rawHint = String(params.rawTypeHint || '').trim();
    const normHintAlias = normalizeEquipmentTypeAlias(rawHint);
    const explicitKey = params.rawTypeKey ? normalizeEquipmentTypeKey(params.rawTypeKey) : '';
    const candidateSlug = explicitKey || normalizeEquipmentTypeKey(rawHint);

    // 1. Caché caliente en memoria (< 1 ms)
    if (explicitKey) {
        const mem = getFromMemoryCacheByKey(explicitKey);
        if (mem) {
            const { doc: upgraded, modified } = upgradeEquipmentTypeSchemaIfNeeded(mem);
            if (modified) {
                putInMemoryCache(upgraded);
                void db
                    .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                    .doc(upgraded.type_key)
                    .set(upgraded, { merge: true })
                    .catch(() => undefined);
            }
            return {
                typeDoc: upgraded,
                reusedExistingSchema: true,
                resolutionSource: 'MEMORY_CACHE',
                latencyMs: Date.now() - startMs,
            };
        }
    }
    if (normHintAlias && memoryAliasToKey.has(normHintAlias)) {
        const mappedKey = memoryAliasToKey.get(normHintAlias)!;
        const mem = getFromMemoryCacheByKey(mappedKey);
        if (mem) {
            const { doc: upgraded, modified } = upgradeEquipmentTypeSchemaIfNeeded(mem);
            if (modified) {
                putInMemoryCache(upgraded);
                void db
                    .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                    .doc(upgraded.type_key)
                    .set(upgraded, { merge: true })
                    .catch(() => undefined);
            }
            return {
                typeDoc: upgraded,
                reusedExistingSchema: true,
                resolutionSource: 'MEMORY_CACHE',
                latencyMs: Date.now() - startMs,
            };
        }
    }

    // 2. Consulta directa en Firestore `global_equipment_types` por `type_key` o `type_aliases` (< 10 ms)
    if (candidateSlug && !FORBIDDEN_VAGUE_TYPE_HINTS.has(normHintAlias)) {
        try {
            const directSnap = await db
                .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                .doc(candidateSlug)
                .get();
            if (directSnap.exists) {
                const existing = directSnap.data() as GlobalEquipmentTypeDoc;
                if (Array.isArray(existing.spec_schema) && existing.spec_schema.length >= 2) {
                    const { doc: upgraded, modified } = upgradeEquipmentTypeSchemaIfNeeded(existing);
                    putInMemoryCache(upgraded);
                    if (modified) {
                        void db
                            .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                            .doc(upgraded.type_key)
                            .set(upgraded, { merge: true })
                            .catch(() => undefined);
                    } else {
                        void db
                            .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                            .doc(existing.type_key)
                            .update({ usage_count: FieldValue.increment(1) })
                            .catch(() => undefined);
                    }
                    return {
                        typeDoc: upgraded,
                        reusedExistingSchema: true,
                        resolutionSource: 'FIRESTORE_EXACT',
                        latencyMs: Date.now() - startMs,
                    };
                }
            }

            if (normHintAlias.length >= 3) {
                const aliasSnap = await db
                    .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                    .where('type_aliases', 'array-contains', normHintAlias)
                    .limit(1)
                    .get();
                if (!aliasSnap.empty) {
                    const existing = aliasSnap.docs[0].data() as GlobalEquipmentTypeDoc;
                    if (Array.isArray(existing.spec_schema) && existing.spec_schema.length >= 2) {
                        const { doc: upgraded, modified } = upgradeEquipmentTypeSchemaIfNeeded(existing);
                        putInMemoryCache(upgraded);
                        if (modified) {
                            void db
                                .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                                .doc(upgraded.type_key)
                                .set(upgraded, { merge: true })
                                .catch(() => undefined);
                        } else {
                            void db
                                .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                                .doc(existing.type_key)
                                .update({ usage_count: FieldValue.increment(1) })
                                .catch(() => undefined);
                        }
                        return {
                            typeDoc: upgraded,
                            reusedExistingSchema: true,
                            resolutionSource: 'FIRESTORE_EXACT',
                            latencyMs: Date.now() - startMs,
                        };
                    }
                }
            }
        } catch {
            // Continuar con semilla determinista
        }
    }

    // 3. Coincidencia contra la Semilla Base Curada ISO (`SEEDED_ISO_BASE`) y materialización inmediata en Firestore
    const seedMatch =
        (explicitKey && SEED_BY_KEY.get(explicitKey)) ||
        matchSeededBlueprint(rawHint) ||
        (params.assetQueryContext ? matchSeededBlueprint(params.assetQueryContext) : null);

    if (seedMatch) {
        try {
            const storedSeedSnap = await db
                .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                .doc(seedMatch.type_key)
                .get();
            if (storedSeedSnap.exists) {
                const storedDoc = storedSeedSnap.data() as GlobalEquipmentTypeDoc;
                if (Array.isArray(storedDoc.spec_schema) && storedDoc.spec_schema.length >= 2) {
                    const { doc: upgraded, modified } = upgradeEquipmentTypeSchemaIfNeeded(storedDoc);
                    if (normHintAlias && !storedDoc.type_aliases?.includes(normHintAlias)) {
                        void db
                            .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                            .doc(storedDoc.type_key)
                            .update({
                                type_aliases: FieldValue.arrayUnion(normHintAlias),
                                usage_count: FieldValue.increment(1),
                            })
                            .catch(() => undefined);
                    }
                    if (modified) {
                        void db
                            .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                            .doc(upgraded.type_key)
                            .set(upgraded, { merge: true })
                            .catch(() => undefined);
                    }
                    putInMemoryCache(upgraded);
                    return {
                        typeDoc: upgraded,
                        reusedExistingSchema: true,
                        resolutionSource: 'FIRESTORE_EXACT',
                        latencyMs: Date.now() - startMs,
                    };
                }
            }
        } catch {
            // Materializar semilla nueva abajo
        }

        const seededDoc = blueprintToDoc(seedMatch);
        void persistTypeDocWithEmbedding(seededDoc, rawHint);
        putInMemoryCache(seededDoc);
        return {
            typeDoc: seededDoc,
            reusedExistingSchema: true,
            resolutionSource: 'SEEDED_ISO',
            latencyMs: Date.now() - startMs,
        };
    }

    // 4. Deduplicación Semántica Vectorial `768d` contra tipos ya aprendidos en `global_equipment_types`
    if (normHintAlias.length >= 3 && !FORBIDDEN_VAGUE_TYPE_HINTS.has(normHintAlias)) {
        try {
            const allTypesSnap = await db.collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION).limit(250).get();
            if (!allTypesSnap.empty) {
                const queryVec = await ResilientAIClient.embedText(
                    `TIPO DE EQUIPO: ${cleanCanonicalTypeDisplayEs(rawHint)} | CATEGORÍA: ${params.rawCategoryHint || ''}`,
                    {
                        taskType: 'RETRIEVAL_QUERY',
                        outputDimensionality: 768,
                    }
                );

                const hintHeadNoun = normHintAlias.split(' ')[0];
                let bestMatch: { doc: GlobalEquipmentTypeDoc; sim: number } | null = null;

                for (const d of allTypesSnap.docs) {
                    const data = d.data() as GlobalEquipmentTypeDoc;
                    if (!Array.isArray(data.embedding_768_raw) || !Array.isArray(data.spec_schema)) continue;
                    const sim = ResilientAIClient.cosineSimilarity(queryVec, data.embedding_768_raw);
                    const docNorm = normalizeEquipmentTypeAlias(data.canonical_type_es);
                    const sharesCoreToken =
                        docNorm.split(' ')[0] === hintHeadNoun ||
                        (data.search_tokens || []).includes(hintHeadNoun);

                    // Umbral estricto (>= 0.92 con sustantivo base compartido o >= 0.95 global) para evitar fusionar "Camión Pluma" con "Camión Tolva"
                    if ((sim >= 0.92 && sharesCoreToken) || sim >= 0.95) {
                        if (!bestMatch || sim > bestMatch.sim) {
                            bestMatch = { doc: data, sim };
                        }
                    }
                }

                if (bestMatch) {
                    void db
                        .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                        .doc(bestMatch.doc.type_key)
                        .update({
                            type_aliases: FieldValue.arrayUnion(normHintAlias),
                            usage_count: FieldValue.increment(1),
                        })
                        .catch(() => undefined);
                    putInMemoryCache(bestMatch.doc);
                    return {
                        typeDoc: bestMatch.doc,
                        reusedExistingSchema: true,
                        resolutionSource: 'SEMANTIC_768D',
                        latencyMs: Date.now() - startMs,
                    };
                }
            }
        } catch {
            // Continuar con aprendizaje de nuevo TIPO
        }
    }

    // 5. COLD-START: Aprendizaje Automático Estructurado (`Temperature: 0`) para un `TIPO` inédito en MINREPORT
    const synthesisTarget =
        !FORBIDDEN_VAGUE_TYPE_HINTS.has(normHintAlias) && rawHint.length >= 3
            ? rawHint
            : String(params.assetQueryContext || rawHint || 'Equipamiento Técnico').trim();

    try {
        const prompt = `Eres un Arquitecto Metrológico Industrial ISO (Temperatura 0).
Se está registrando por primera vez en la plataforma un activo correspondiente a:
- Indicio de TIPO de equipo: "${synthesisTarget}"
${params.rawCategoryHint ? `- Categoría preliminar: "${params.rawCategoryHint}"` : ''}
${params.assetQueryContext ? `- Activo consultado: "${params.assetQueryContext}"` : ''}

TAREA:
1. Establece el nombre canónico exacto del TIPO de equipo en español MAYÚSCULAS singular ("canonical_type_es"), sin marcas, sin modelos y sin años (ej. "CHANCADOR DE MANDÍBULAS", "MANIPULADOR TELESCÓPICO", "MOTOBOMBA CENTRÍFUGA", "JUMBO ELECTROHIDRÁULICO", "RODILLO COMPACTADOR VIBRATORIO", "MOTOCICLETA TODO TERRENO", "SOLDADORA INVERTER INDUSTRIAL").
2. Determina entre 3 y 5 características técnicas principales y diferenciadoras ("spec_schema") que un ingeniero especialista evalúa EXCLUSIVAMENTE para ESE TIPO de equipo.
3. PROHIBICIÓN DE PARÁMETROS CRUZADOS:
   - Jamás asignes "capacidad de balde" a compresores, bombas, generadores, grúas o vehículos de transporte.
   - Jamás asignes "presión PSI/bar de aire" a camionetas, automóviles o excavadoras.
   - Cada eje debe ser una magnitud física medible con unidad SI explícita ("PHYSICAL_MAGNITUDE", ej. mm, m, kg, t, kW (HP), N·m, kN, t·m, m³/min, L/s, bar, kVA, V, Hz) o una enumeración mecánica cerrada ("CLOSED_ENUM" con 2 a 6 opciones técnicas breves).
   - Prohibido incluir años de fabricación, origen, reseñas históricas o prosa comercial.`;

        const { data } = await ResilientAIClient.generateStructured<{
            canonical_type_es: string;
            categoria_equipo: string;
            type_aliases: string[];
            spec_schema: Array<Record<string, any>>;
        }>({
            module: 'opermaq',
            preferredTier: 'SECONDARY',
            temperature: 0,
            topP: 1,
            topK: 1,
            responseSchema: DYNAMIC_TYPE_SYNTHESIS_SCHEMA,
            prompt,
        });

        const cleanTypeEs = cleanCanonicalTypeDisplayEs(data.canonical_type_es || synthesisTarget);
        const learnedKey = normalizeEquipmentTypeKey(cleanTypeEs);
        const validatedAxes = validateAndSanitizeLearnedAxes(data.spec_schema);

        if (learnedKey && validatedAxes.length >= 2) {
            // Verificar una última vez si el nombre canónico normalizado ya existía en Firestore o Semilla
            const postNormalizedSeed = SEED_BY_KEY.get(learnedKey);
            if (postNormalizedSeed) {
                const seededDoc = blueprintToDoc(postNormalizedSeed);
                const persisted = await persistTypeDocWithEmbedding(seededDoc, rawHint);
                return {
                    typeDoc: persisted,
                    reusedExistingSchema: true,
                    resolutionSource: 'SEEDED_ISO',
                    latencyMs: Date.now() - startMs,
                };
            }

            const existingLearnedSnap = await db
                .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                .doc(learnedKey)
                .get()
                .catch(() => null);
            if (existingLearnedSnap && existingLearnedSnap.exists) {
                const existingDoc = existingLearnedSnap.data() as GlobalEquipmentTypeDoc;
                if (Array.isArray(existingDoc.spec_schema) && existingDoc.spec_schema.length >= 2) {
                    if (normHintAlias) {
                        void db
                            .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
                            .doc(learnedKey)
                            .update({
                                type_aliases: FieldValue.arrayUnion(normHintAlias),
                                usage_count: FieldValue.increment(1),
                            })
                            .catch(() => undefined);
                    }
                    putInMemoryCache(existingDoc);
                    return {
                        typeDoc: existingDoc,
                        reusedExistingSchema: true,
                        resolutionSource: 'FIRESTORE_EXACT',
                        latencyMs: Date.now() - startMs,
                    };
                }
            }

            const nowIso = new Date().toISOString();
            const fallbackArch = resolveMachineryArchetype(cleanTypeEs, data.categoria_equipo);
            const rawAliases = [
                learnedKey.replace(/_/g, ' '),
                normHintAlias,
                ...(Array.isArray(data.type_aliases) ? data.type_aliases.map(normalizeEquipmentTypeAlias) : []),
            ].filter((a) => a.length >= 2 && !FORBIDDEN_VAGUE_TYPE_HINTS.has(a));

            const newTypeDoc: GlobalEquipmentTypeDoc = {
                type_key: learnedKey,
                canonical_type_es: cleanTypeEs,
                categoria_equipo: String(data.categoria_equipo || params.rawCategoryHint || 'EQUIPAMIENTO TÉCNICO')
                    .trim()
                    .toUpperCase(),
                archetype_id: fallbackArch.id,
                type_aliases: Array.from(new Set(rawAliases)),
                search_tokens: [],
                spec_schema: validatedAxes,
                schema_version: EQUIPMENT_TYPE_SCHEMA_VERSION,
                origin: 'AI_DISCOVERED',
                is_human_locked: false,
                usage_count: 1,
                created_at: nowIso,
                updated_at: nowIso,
            };

            const persistedDoc = await persistTypeDocWithEmbedding(newTypeDoc, rawHint);
            return {
                typeDoc: persistedDoc,
                reusedExistingSchema: false,
                resolutionSource: 'AI_LEARNED_NEW',
                latencyMs: Date.now() - startMs,
            };
        }
    } catch (err: any) {
        console.warn('[EquipmentTypeRegistry] Fallback determinista en aprendizaje de TIPO:', err?.message);
    }

    // 6. Respaldo Determinista Final si el servicio IA no estuvo disponible
    const fallbackArch = resolveMachineryArchetype(rawHint, params.rawCategoryHint);
    const fallbackTypeEs =
        !FORBIDDEN_VAGUE_TYPE_HINTS.has(normHintAlias) && rawHint.length >= 3
            ? cleanCanonicalTypeDisplayEs(rawHint)
            : fallbackArch.name_es.toUpperCase();
    const fallbackKey = normalizeEquipmentTypeKey(fallbackTypeEs) || 'equipamiento_industrial_general';
    const nowIso = new Date().toISOString();

    const fallbackDoc: GlobalEquipmentTypeDoc = {
        type_key: fallbackKey,
        canonical_type_es: fallbackTypeEs,
        categoria_equipo: String(params.rawCategoryHint || 'EQUIPAMIENTO INDUSTRIAL').trim().toUpperCase(),
        archetype_id: fallbackArch.id,
        type_aliases: [fallbackKey.replace(/_/g, ' ')],
        search_tokens: buildTypeSearchTokens(fallbackTypeEs, params.rawCategoryHint || '', []),
        spec_schema: fallbackArch.axes.map((ax, idx) => ({
            axis_key: ax.axis_key,
            label_es: ax.label_es,
            unit_si: ax.unit_hint,
            value_kind: 'PHYSICAL_MAGNITUDE',
            search_keywords: [ax.label_es.toLowerCase(), ax.unit_hint.toLowerCase()],
            mandatory: ax.mandatory,
            is_differentiator: idx < 2,
        })),
        schema_version: EQUIPMENT_TYPE_SCHEMA_VERSION,
        origin: 'SEEDED_ISO_BASE',
        is_human_locked: false,
        usage_count: 1,
        created_at: nowIso,
        updated_at: nowIso,
    };

    return {
        typeDoc: fallbackDoc,
        reusedExistingSchema: false,
        resolutionSource: 'SEEDED_ISO',
        latencyMs: Date.now() - startMs,
    };
}

/**
 * Construye y valida el vector auto-descriptivo `CanonicalSpecSlot[]` de un activo contra el esquema
 * oficial de su `TIPO` (`GlobalEquipmentTypeDoc`), aplicando conversión imperial->SI, validación de
 * URL grounded y chequeo cruzado de plausibilidad física.
 */
export function buildVerifiedSlotsForEquipmentType(params: {
    typeDoc: GlobalEquipmentTypeDoc;
    rawExtractedAxes: Array<{
        axis_key: string;
        value_si?: string | null;
        source_url?: string | null;
        verbatim_evidence?: string | null;
    }>;
    allowedSourceUrls: Set<string>;
    defaultVerifiedUrl?: string | null;
}): CanonicalSpecSlot[] {
    const { typeDoc, rawExtractedAxes, allowedSourceUrls, defaultVerifiedUrl } = params;
    const rawByKey = new Map(
        (Array.isArray(rawExtractedAxes) ? rawExtractedAxes : []).map((item) => [item.axis_key, item])
    );

    let slots: CanonicalSpecSlot[] = typeDoc.spec_schema.map((axisSchema) => {
        const baseSlot: CanonicalSpecSlot = {
            axis_key: axisSchema.axis_key,
            label_es: axisSchema.label_es,
            value_si: null,
            unit_si: axisSchema.unit_si,
            mandatory: axisSchema.mandatory,
            is_differentiator: axisSchema.is_differentiator,
            value_kind: axisSchema.value_kind,
            ...(axisSchema.allowed_enum_values ? { allowed_enum_values: axisSchema.allowed_enum_values } : {}),
            source_url: null,
            verbatim_evidence: null,
        };

        const rawSlot = rawByKey.get(axisSchema.axis_key);
        if (!rawSlot || !rawSlot.value_si) {
            return baseSlot;
        }

        const normalizedVal =
            axisSchema.value_kind === 'PHYSICAL_MAGNITUDE'
                ? verifyAndNormalizeTechnicalUnits(rawSlot.value_si).normalizedMarkdown
                : rawSlot.value_si;
        const cleanedVal = cleanDynamicAxisValue(normalizedVal, axisSchema);

        const candidateUrl = rawSlot.source_url ? rawSlot.source_url.trim() : '';
        const hasVerbatim = Boolean(rawSlot.verbatim_evidence && rawSlot.verbatim_evidence.trim().length >= 3);
        const verifiedUrl = allowedSourceUrls.has(candidateUrl)
            ? candidateUrl
            : hasVerbatim && defaultVerifiedUrl && allowedSourceUrls.has(defaultVerifiedUrl)
            ? defaultVerifiedUrl
            : defaultVerifiedUrl && allowedSourceUrls.has(defaultVerifiedUrl)
            ? defaultVerifiedUrl
            : null;

        if (!cleanedVal || !verifiedUrl) {
            return baseSlot;
        }

        return {
            ...baseSlot,
            value_si: cleanedVal,
            source_url: verifiedUrl,
            verbatim_evidence: rawSlot.verbatim_evidence?.trim() || null,
        };
    });

    if (typeDoc.archetype_id) {
        const physicsCheck = validateCrossAxisPhysicalPlausibility(typeDoc.archetype_id, slots);
        if (!physicsCheck.valid) {
            const rejectedSet = new Set(physicsCheck.rejectedAxes);
            slots = slots.map((s) =>
                rejectedSet.has(s.axis_key)
                    ? { ...s, value_si: null, source_url: null, verbatim_evidence: null }
                    : s
            );
        }
    }

    return slots;
}

/**
 * Lista todos los esquemas de `TIPO` registrados en `global_equipment_types` (combinados con la semilla base)
 * para inspección técnica en `CATÁLOGO`.
 */
export async function listRegisteredEquipmentTypes(): Promise<GlobalEquipmentTypeDoc[]> {
    const byKey = new Map<string, GlobalEquipmentTypeDoc>();
    for (const bp of SEEDED_TYPE_BLUEPRINTS) {
        byKey.set(bp.type_key, blueprintToDoc(bp));
    }

    try {
        const snap = await db.collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION).limit(500).get();
        for (const d of snap.docs) {
            const data = d.data() as GlobalEquipmentTypeDoc;
            if (data?.type_key && Array.isArray(data.spec_schema)) {
                const cleanData: GlobalEquipmentTypeDoc = { ...data };
                delete cleanData.embedding_768_raw;
                byKey.set(data.type_key, cleanData);
            }
        }
    } catch {
        // Retornar semilla en memoria si Firestore no responde
    }

    return Array.from(byKey.values()).sort((a, b) =>
        a.canonical_type_es.localeCompare(b.canonical_type_es, 'es', { sensitivity: 'base' })
    );
}

/**
 * Resuelve la Ontología Elástica en 2 Anillos para el Itemizado de `ficha_tecnica` según el `TIPO` físico del activo:
 * - Anillo 1 (`core_chapters`): Los 4 a 6 capítulos basales invariantes del `TIPO` (garantizan homologación comparativa).
 * - Anillo 2 (`conditional_subsystems`): Catálogo evolutivo de subsistemas complejos (`activation_rule: 'EVIDENCE_PRESENT'`)
 *   que NUNCA contamina a equipos simples (ej. `FIAT Fiorino`) pero se activa y expande sin techo en equipos de alta
 *   complejidad (ej. `Ford F-350 Super Duty`, `CAT 797F`).
 */
export function resolveElasticFichaTecnicaBlueprint(
    typeDoc: GlobalEquipmentTypeDoc
): EquipmentTypePillarBlueprint {
    const existing = typeDoc.pillar_blueprints?.ficha_tecnica;
    const typeText = `${typeDoc.type_key} ${typeDoc.canonical_type_es} ${typeDoc.categoria_equipo} ${typeDoc.archetype_id || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const axesLabels = (typeDoc.spec_schema || [])
        .map((a) => `${a.label_es}${a.unit_si ? ` [${a.unit_si}]` : ''}`)
        .join(', ');

    const isStationaryOrHandTool =
        /\b(compresor|generador|grupo electrogeno|bomba|motobomba|perforadora manual|jackleg|stoper|martillo neumatico|soldadora|chancador|molino|harnero|criba|tablero|transformador|torre de iluminacion|herramienta)\b/i.test(
            typeText
        ) && !/\b(camion|camioneta|excavadora|cargador|motoniveladora|tractor|bulldozer|rodillo|jumbo|manipulador|grua)\b/i.test(typeText);

    const isLightOrHeavyUtilityVehicle =
        /\b(camioneta|pick\s*up|furgon|utilitario|suv|vehiculo liviano|camion liviano|van|chasis cabina)\b/i.test(
            typeText
        );

    const isHaulOrDumpTruck =
        /\b(camion de extraccion|caex|camion minero|camion articulado|camion tolva|dumper|volquete)\b/i.test(
            typeText
        );

    // ── ANILLO 1: NÚCLEO MÍNIMO INVARIANTE DEL TIPO (`core_chapters`) ────────
    const consumptionCoreChapter = buildDedicatedConsumptionCoreChapter(typeDoc);
    let defaultCore: EquipmentTypeCoreChapterItem[];

    if (isStationaryOrHandTool) {
        defaultCore = [
            {
                chapter_key: 'parametros_nominales_si',
                title_es: `Parámetros Críticos y Capacidades Nominales SI (${typeDoc.canonical_type_es})`,
                section_es: 'DESEMPEÑO NOMINAL Y EJES DIFERENCIADORES',
                rationale_es: `Consolida las magnitudes físicas diferenciadoras del tipo ${typeDoc.canonical_type_es}: ${axesLabels || 'potencia, caudal, presión o frecuencia nominal'}.`,
                priority: 'CRÍTICO',
            },
            consumptionCoreChapter,
            {
                chapter_key: 'unidad_proceso_o_trabajo',
                title_es: 'Unidad Funcional de Trabajo, Etapas de Proceso y Presiones/Caudales',
                section_es: 'SISTEMA DE TRABAJO',
                rationale_es: 'Detalla el cabezal compresor, cámara de chancado, mecanismo de percusión, bomba o alternador y sus límites operativos.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'dimensiones_peso_y_conexiones',
                title_es: 'Dimensiones Generales, Peso Seco/Operativo y Acometidas/Conexiones',
                section_es: 'GEOMETRÍA E INSTALACIÓN',
                rationale_es: 'Dimensiones envolventes, masa total, diámetros de acoples/bridas y requerimientos de anclaje o transporte.',
                priority: 'IMPORTANTE',
            },
            {
                chapter_key: 'fluidos_lubricacion_y_protecciones',
                title_es: 'Capacidades de Lubricación, Refrigeración y Dispositivos de Protección',
                section_es: 'SERVICIO Y CONTROL',
                rationale_es: 'Volúmenes y viscosidades de lubricantes/refrigerantes, válvulas de alivio, nivel de presión sonora (dBA) e instrumentación.',
                priority: 'IMPORTANTE',
            },
        ];
    } else if (isLightOrHeavyUtilityVehicle) {
        defaultCore = [
            {
                chapter_key: 'parametros_nominales_si',
                title_es: `Parámetros Críticos y Capacidades Nominales SI (${typeDoc.canonical_type_es})`,
                section_es: 'DESEMPEÑO Y CAPACIDADES NOMINALES',
                rationale_es: `Consolida los ejes físicos diferenciadores del tipo ${typeDoc.canonical_type_es}: ${axesLabels || 'potencia, torque, tracción y carga útil'}.`,
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'motorizacion_y_alimentacion',
                title_es: 'Motorización, Cilindrada, Sobrealimentación y Curvas de Par/Potencia',
                section_es: 'PLANTA MOTRIZ',
                rationale_es: 'Código de motor, ciclo, inyección, potencia neta en kW (HP) y par motor máximo en N·m con sus rangos de RPM.',
                priority: 'CRÍTICO',
            },
            consumptionCoreChapter,
            {
                chapter_key: 'transmision_y_traccion',
                title_es: 'Caja de Cambios, Relaciones de Marcha y Sistema de Tracción',
                section_es: 'TREN MOTRIZ',
                rationale_es: 'Tipo de transmisión, escalonamiento de marchas, relación final de diferencial y configuración de tracción (4x2 / 4x4 / AWD).',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'chasis_suspension_frenos_y_rodado',
                title_es: 'Chasis, Suspensión Delantera/Trasera, Dirección, Frenos y Neumáticos',
                section_es: 'CHASIS Y RODADO',
                rationale_es: 'Arquitectura de bastidor, esquemas de suspensión, frenos de servicio/estacionamiento y medida/índice de carga de neumáticos.',
                priority: 'IMPORTANTE',
            },
            {
                chapter_key: 'dimensiones_pesos_y_volumen_carga',
                title_es: 'Dimensiones Exteriores, Cotas Todo Terreno, Pesos (PBV/Tara) y Caja de Carga',
                section_es: 'GEOMETRÍA Y PESOS',
                rationale_es: 'Largo, ancho, alto, distancia entre ejes, despeje al suelo, ángulos de ataque/salida, Peso Bruto Vehicular (PBV) y capacidad útil.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'capacidades_fluidos_y_sistema_electrico',
                title_es: 'Capacidades de Estanque, Fluidos de Servicio y Sistema Eléctrico Base',
                section_es: 'CAPACIDADES Y ELECTRICIDAD',
                rationale_es: 'Capacidad de combustible, aceite de motor, transmisión, refrigerante, líquido de frenos, voltaje de sistema, alternador y batería.',
                priority: 'IMPORTANTE',
            },
        ];
    } else {
        defaultCore = [
            {
                chapter_key: 'parametros_nominales_si',
                title_es: `Parámetros Críticos y Capacidades Nominales SI (${typeDoc.canonical_type_es})`,
                section_es: 'DESEMPEÑO NOMINAL Y EJES DIFERENCIADORES',
                rationale_es: `Consolida los ejes físicos diferenciadores del tipo ${typeDoc.canonical_type_es}: ${axesLabels || 'potencia neta, peso operativo y capacidad de trabajo'}.`,
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'planta_motriz_y_desempeno',
                title_es: 'Motorización, Curvas de Potencia/Torque, Emisiones y Derateo por Altitud',
                section_es: 'PLANTA MOTRIZ',
                rationale_es: 'Modelo de motor, potencia bruta y neta ISO 9249 / SAE J1349 en kW (HP), reserva de par, cilindrada y altitud máxima sin derateo.',
                priority: 'CRÍTICO',
            },
            consumptionCoreChapter,
            {
                chapter_key: 'tren_potencia_y_propulsion',
                title_es: 'Transmisión, Convertidor/Propulsión, Ejes, Diferenciales y Mandos Finales',
                section_es: 'TREN DE POTENCIA',
                rationale_es: 'Arquitectura de transmisión o propulsión, velocidades de desplazamiento (avance/retroceso), fuerza de tracción y reducción final.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'sistema_hidraulico_e_implementos',
                title_es: 'Sistema Hidráulico de Trabajo, Bombas, Caudales, Presiones de Alivio y Tiempos de Ciclo',
                section_es: 'HIDRÁULICA E IMPLEMENTOS',
                rationale_es: 'Tipo de bombas, caudal máximo en L/min, presión de alivio principal en bar/MPa (PSI) y fuerzas/tiempos de ciclo del equipo.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'dimensiones_envolvente_y_pesos',
                title_es: 'Dimensiones Geométricas de Operación/Transporte y Distribución de Peso Operativo',
                section_es: 'GEOMETRÍA Y MASAS',
                rationale_es: 'Cotas oficiales de transporte y trabajo en mm/m, radios de giro, despeje mínimo y masa operativa distribuida por eje o sobre terreno.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'capacidades_servicio_cabina_y_electrico',
                title_es: 'Capacidades de Llenado de Fluidos, Sistema Eléctrico y Cabina ROPS/FOPS',
                section_es: 'SERVICIO, ELECTRICIDAD Y CABINA',
                rationale_es: 'Volúmenes de rellenado en litros (L), arquitectura eléctrica 24V/12V, certificaciones estructurales ROPS/FOPS ISO y nivel sonoro.',
                priority: 'IMPORTANTE',
            },
        ];
    }

    // ── ANILLO 2: CATÁLOGO CONDICIONAL DE SUBSISTEMAS AVANZADOS (`conditional_subsystems`) ──
    const defaultConditionals: EquipmentTypeConditionalSubsystemItem[] = [];

    if (isLightOrHeavyUtilityVehicle) {
        defaultConditionals.push(
            {
                subsystem_key: 'caja_transferencia_4x4_drw_y_puentes_hd',
                title_es: 'Caja de Transferencia 4x4 (Low/High), Eje Trasero Dually (DRW) y Relaciones de Puente Configurables',
                section_es: 'TREN MOTRIZ HEAVY-DUTY',
                rationale_es: 'Se activa en camionetas 4x4 o Heavy-Duty (ej. Ford F-350 DRW) con reductora, bloqueo electrónico de diferencial (ELD) o doble rodado trasero.',
                trigger_keywords: ['4x4', 'transfer case', 'reductora', 'drw', 'dually', 'doble rodado', 'axle ratio', 'bloqueo de diferencial'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'toma_fuerza_pto_y_transmision_hd',
                title_es: 'Toma de Fuerza en Vivo (Live-Drive PTO) y Enfriamiento Auxiliar de Transmisión',
                section_es: 'TOMA DE FUERZA E HIDRÁULICA AUXILIAR',
                rationale_es: 'Se activa en modelos Heavy-Duty o chasis cabina con provisión de Toma de Fuerza (PTO) en la transmisión para equipos hidráulicos externos.',
                trigger_keywords: ['pto', 'power take-off', 'toma de fuerza', 'live-drive', 'torqshift'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'arrastre_quinta_rueda_gooseneck_y_tbc',
                title_es: 'Capacidades de Arrastre Convencional, Quinta Rueda / Gooseneck (GCWR) y Control de Freno de Remolque (TBC)',
                section_es: 'INGENIERÍA DE REMOLQUE Y CARGA SEVERA',
                rationale_es: 'Se activa cuando el vehículo declara Peso Bruto Combinado (GCWR), arrastre en Quinta Rueda/Gooseneck o controlador de freno de remolque integrado.',
                trigger_keywords: ['gcwr', '5th wheel', 'quinta rueda', 'gooseneck', 'tbc', 'trailer brake', 'capacidad de remolque'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'postratamiento_def_dpf_y_electrico_upfitter',
                title_es: 'Postratamiento Diésel (DEF/AdBlue, SCR, DPF) y Sistema Eléctrico Dual / Upfitter Switches',
                section_es: 'EMISIONES Y EQUIPAMIENTO INDUSTRIAL',
                rationale_es: 'Se activa en motorizaciones turbodiésel modernas con sistema SCR/DPF o doble alternador/batería auxiliar para carrozado minero.',
                trigger_keywords: ['adblue', 'def', 'scr', 'dpf', 'dual alternator', 'doble alternador', 'upfitter', 'bateria auxiliar'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'geometria_chasis_carrozado_cab_to_axle',
                title_es: 'Geometría de Bastidor para Carrozado (Cab-to-Axle, GAWR Delantero/Trasero y Módulo de Sección)',
                section_es: 'INGENIERÍA DE CHASIS Y CARROZADO',
                rationale_es: 'Se activa en versiones Chasis Cabina o Heavy-Duty con cotas Cab-to-Axle (CA), cargas máximas por eje (GAWR) y resistencia del larguero.',
                trigger_keywords: ['cab-to-axle', 'gawr', 'chasis cabina', 'chassis cab', 'section modulus', 'bastidor'],
                activation_rule: 'EVIDENCE_PRESENT',
            }
        );
    } else if (isHaulOrDumpTruck) {
        defaultConditionals.push(
            {
                subsystem_key: 'propulsion_ac_igbt_o_lockup_hd',
                title_es: 'Sistema de Propulsión Eléctrica AC/IGBT o Convertidor de Par con Embrague de Traba (Lock-Up Clutch)',
                section_es: 'PROPULSIÓN MINERA DE ALTA CAPACIDAD',
                rationale_es: 'Se activa en CAEX Ultra-Class (ej. CAT 797F mecánico Lock-Up o Komatsu 980E AC/IGBT con alternador principal y motores de tracción en rueda).',
                trigger_keywords: ['lock-up', 'embrague de traba', 'igbt', 'inversor ac', 'wheel motor', 'motor de traccion', 'parrilla de retardo'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'frenos_humedos_enfriados_aceite_y_retardo_arc',
                title_es: 'Frenos de Discos Múltiples Húmedos Enfriados por Aceite Forzado y Control Automático de Retardo (ARC / Dinámico)',
                section_es: 'FRENADO Y RETARDO EN PENDIENTE',
                rationale_es: 'Detalla la superficie de fricción, enfriamiento de frenos en las 4 esquinas, potencia de retardo continuo y curvas ARC/retardo dinámico.',
                trigger_keywords: ['arc', 'automatic retarder', 'frenos enfriados por aceite', 'oil-cooled brakes', 'retardo dinamico', 'grid resistor'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'enfriamiento_independiente_ejes_rax_y_autolube',
                title_es: 'Sistema de Enfriamiento Forzado de Ejes/Mandos Finales (RAX) y Lubricación Automática Centralizada (Autolube)',
                section_es: 'GESTIÓN TÉRMICA DE EJES Y LUBRICACIÓN',
                rationale_es: 'Se activa en CAEX de gran tonelaje con circuito de filtración/enfriamiento continuo de eje trasero (RAX) y sistema Autolube.',
                trigger_keywords: ['rax', 'rear axle cooling', 'enfriamiento de eje', 'autolube', 'lubricacion automatica'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'monitoreo_carga_util_tpms_y_telemetria_vims',
                title_es: 'Sistema de Pesaje de Carga Útil a Bordo (TPMS / Política 10/10/20) y Telemetría de Salud Estructural (VIMS / PLM)',
                section_es: 'TELEMETRÍA Y GESTIÓN DE CARGA ÚTIL',
                rationale_es: 'Especifica el sistema de pesaje en suspensión, luces externas de carguío, política de sobrecarga 10/10/20 y arquitectura VIMS/MineStar.',
                trigger_keywords: ['tpms', '10/10/20', 'vims', 'payload', 'minestar', 'komtrax plus', 'plm'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'tolva_minera_msd_y_envolvente_ruta_bermas',
                title_es: 'Configuraciones de Tolva Minera (Struck/Heaped SAE 2:1, Revestimientos) y Envolvente de Ruta/Bermas y Neumáticos Gigantes',
                section_es: 'TOLVA, RUTA MINERA Y NEUMÁTICOS',
                rationale_es: 'Cubre variantes de tolva (MSD II, X Body, Carbón), ángulo y altura libre de volteo, neumáticos radiales gigantes (ej. 59/80R63) y ancho de pista.',
                trigger_keywords: ['heaped', 'struck', 'sae 2:1', 'msd', 'x body', '59/80r63', 'altura de descarga', 'turning circle'],
                activation_rule: 'EVIDENCE_PRESENT',
            }
        );
    } else {
        defaultConditionals.push(
            {
                subsystem_key: 'sistema_frenos_direccion_secundaria_y_ejes',
                title_es: 'Sistema de Frenos de Servicio/Secundario (ISO 3450), Dirección Articulada/Auxiliar y Oscilación de Ejes/Tándem',
                section_es: 'DIRECCIÓN, FRENADO Y TREN DE RODAJE',
                rationale_es: 'Se activa en maquinaria móvil con dirección articulada, tándem oscilante, tracción total hidrostática (AWD) o frenos húmedos ISO 3450.',
                trigger_keywords: ['iso 3450', 'tandem', 'articulacion', 'awd', 'direccion secundaria', 'orugas', 'tren de rodaje'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'herramienta_corte_balde_vertedera_y_ripper',
                title_es: 'Geometría de Herramienta de Ataque (Vertedera / Círculo / Balde / Pluma / Ripper Trasero) y Fuerzas de Arranque',
                section_es: 'HERRAMIENTA DE TRABAJO Y CINEMÁTICA',
                rationale_es: 'Se activa en equipos con hoja vertedera, círculo de giro, balde, aguilón/brazo o escarificador/ripper trasero.',
                trigger_keywords: ['vertedera', 'moldboard', 'blade pull', 'ripper', 'escarificador', 'breakout force', 'fuerza de arranque', 'pluma'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'control_automatico_grade_telemetria_y_automatizacion',
                title_es: 'Sistemas de Control Asistido 2D/3D (Grade Control), Telemetría Embarcada y Operación Tele-Remota',
                section_es: 'AUTOMATIZACIÓN Y TELEMETRÍA',
                rationale_es: 'Se activa cuando el modelo incorpora nivelación automática Cross-Slope/3D GNSS, control electrohidráulico joystick o telemetría OEM.',
                trigger_keywords: ['cross slope', 'accugrade', 'cat grade', 'topcon', 'trimble', 'product link', 'komtrax', 'teleremoto'],
                activation_rule: 'EVIDENCE_PRESENT',
            }
        );
    }

    let mergedCore: EquipmentTypeCoreChapterItem[];
    if (existing?.core_chapters && existing.core_chapters.length >= 4) {
        const existingConsumptionIdx = existing.core_chapters.findIndex(
            (c) =>
                c.chapter_key === 'matriz_energetica_consumos_y_autonomia' ||
                /\b(consumos?\s+de\s+combustible|consumos?\s+de\s+energ[ií]a|rendimiento\s+de\s+combustible|matriz\s+energ[eé]tica)\b/i.test(
                    `${c.title_es} ${c.section_es}`
                )
        );
        if (existingConsumptionIdx !== -1) {
            mergedCore = existing.core_chapters.map((c, idx) =>
                idx === existingConsumptionIdx ? consumptionCoreChapter : c
            );
        } else {
            const copy = [...existing.core_chapters];
            const insertIdx = Math.min(2, copy.length);
            copy.splice(insertIdx, 0, consumptionCoreChapter);
            mergedCore = copy;
        }
    } else {
        mergedCore = defaultCore;
    }

    const condByKey = new Map<string, EquipmentTypeConditionalSubsystemItem>();
    for (const c of defaultConditionals) {
        condByKey.set(c.subsystem_key, c);
    }
    for (const c of existing?.conditional_subsystems || []) {
        if (c?.subsystem_key && c?.title_es) {
            condByKey.set(c.subsystem_key, c);
        }
    }

    return {
        core_chapters: mergedCore,
        conditional_subsystems: Array.from(condByKey.values()),
        updated_at: existing?.updated_at || new Date().toISOString(),
    };
}

/**
 * Aprendizaje Ascendente Sin Techo (`Upward Subsystem Evolution`):
 * Cuando un modelo complejo (ej. `Ford F-350 Super Duty` o `CAT 797F`) descubre subsistemas inéditos
 * durante su itemizado de `ficha_tecnica`, los incorpora al Anillo 2 (`conditional_subsystems`) de
 * `global_equipment_types/{typeKey}` con `activation_rule: 'EVIDENCE_PRESENT'` sin alterar el Anillo 1 (`core_chapters`).
 */
export async function evolveEquipmentTypeFichaTecnicaBlueprint(params: {
    typeKey: string;
    modelOficial: string;
    discoveredSubsystems: Array<{
        title_es: string;
        section_es: string;
        rationale_es: string;
        trigger_keywords?: string[];
    }>;
}): Promise<void> {
    const cleanKey = normalizeEquipmentTypeKey(params.typeKey);
    if (!cleanKey || !Array.isArray(params.discoveredSubsystems) || params.discoveredSubsystems.length === 0) {
        return;
    }

    try {
        const docRef = db.collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION).doc(cleanKey);
        const snap = await docRef.get();
        if (!snap.exists) return;

        const typeDoc = snap.data() as GlobalEquipmentTypeDoc;
        const currentBlueprint = resolveElasticFichaTecnicaBlueprint(typeDoc);
        const existingSubsystems = [...currentBlueprint.conditional_subsystems];
        const nowIso = new Date().toISOString();

        let addedCount = 0;
        for (const sub of params.discoveredSubsystems) {
            const subSlug = normalizeEquipmentTypeKey(sub.title_es).slice(0, 64);
            if (!subSlug || subSlug.length < 4) continue;

            const alreadyExists =
                currentBlueprint.core_chapters.some(
                    (c) => normalizeEquipmentTypeKey(c.title_es) === subSlug
                ) ||
                existingSubsystems.some(
                    (s) =>
                        s.subsystem_key === subSlug ||
                        normalizeEquipmentTypeKey(s.title_es) === subSlug
                );

            if (alreadyExists) continue;

            const autoKeywords = Array.from(
                new Set(
                    [
                        ...(sub.trigger_keywords || []),
                        ...normalizeEquipmentTypeAlias(sub.title_es)
                            .split(' ')
                            .filter((w) => w.length >= 4 && !TYPE_STOPWORDS.has(w)),
                    ].slice(0, 8)
                )
            );

            existingSubsystems.push({
                subsystem_key: subSlug,
                title_es: sub.title_es.trim(),
                section_es: (sub.section_es || 'SUBSISTEMA ESPECIALIZADO').trim().toUpperCase(),
                rationale_es: sub.rationale_es.trim(),
                trigger_keywords: autoKeywords,
                activation_rule: 'EVIDENCE_PRESENT',
                discovered_from_model: params.modelOficial,
                discovered_at: nowIso,
            });
            addedCount++;
        }

        if (addedCount > 0) {
            const updatedBlueprint: EquipmentTypePillarBlueprint = {
                core_chapters: currentBlueprint.core_chapters,
                conditional_subsystems: existingSubsystems.slice(0, 30),
                updated_at: nowIso,
            };

            await docRef.set(
                {
                    pillar_blueprints: {
                        ...(typeDoc.pillar_blueprints || {}),
                        ficha_tecnica: updatedBlueprint,
                    },
                    updated_at: nowIso,
                },
                { merge: true }
            );

            const cached = memoryByTypeKey.get(cleanKey);
            if (cached) {
                cached.doc = {
                    ...cached.doc,
                    pillar_blueprints: {
                        ...(cached.doc.pillar_blueprints || {}),
                        ficha_tecnica: updatedBlueprint,
                    },
                    updated_at: nowIso,
                };
            }
        }
    } catch (err: any) {
        console.warn('[EquipmentTypeRegistry] No se pudo evolucionar conditional_subsystems:', err?.message);
    }
}

/**
 * Resuelve la Ontología Elástica en 2 Anillos + 5 Fases Cronológicas para el Itemizado de `manual_operaciones`:
 * - Anillo 1 (`core_chapters`): Las 5 Fases Cronológicas invariantes adaptadas a la naturaleza física del TIPO
 *   (Maquinaria móvil con cabina vs Vehículo liviano/pesado vs Herramienta manual / Equipo estacionario).
 * - Anillo 2 (`conditional_subsystems`): Modos operativos especializados (`activation_rule: 'EVIDENCE_PRESENT'`)
 *   que solo se activan cuando el modelo o su Pilar 01 (`Ficha Técnica OEM`) confirma el subsistema físico.
 */
export function resolveElasticManualOperacionesBlueprint(
    typeDoc: GlobalEquipmentTypeDoc
): EquipmentTypePillarBlueprint {
    const existing = typeDoc.pillar_blueprints?.manual_operaciones;
    const typeText = `${typeDoc.type_key} ${typeDoc.canonical_type_es} ${typeDoc.categoria_equipo} ${typeDoc.archetype_id || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const isStationaryOrHandTool =
        /\b(compresor|generador|grupo electrogeno|bomba|motobomba|perforadora manual|jackleg|stoper|martillo neumatico|soldadora|chancador|molino|harnero|criba|tablero|transformador|torre de iluminacion|herramienta)\b/i.test(
            typeText
        ) && !/\b(camion|camioneta|excavadora|cargador|motoniveladora|tractor|bulldozer|rodillo|jumbo|manipulador|grua)\b/i.test(typeText);

    const isLightOrHeavyUtilityVehicle =
        /\b(camioneta|pick\s*up|furgon|utilitario|suv|vehiculo liviano|camion liviano|van|chasis cabina)\b/i.test(
            typeText
        );

    const isHaulOrDumpTruck =
        /\b(camion de extraccion|caex|camion minero|camion articulado|camion tolva|dumper|volquete)\b/i.test(
            typeText
        );

    let defaultCore: EquipmentTypeCoreChapterItem[];

    if (isStationaryOrHandTool) {
        defaultCore = [
            {
                chapter_key: 'fase_1_mandos_empunadura_e_indicadores',
                title_es: 'Reconocimiento de Mandos, Empuñadura / Panel de Control, Válvulas e Indicadores',
                section_es: 'FASE I — ARQUITECTURA DE MANDOS E INDICADORES',
                rationale_es: 'Identifica controles físicos, selectores, manómetros/indicadores y paradas de emergencia reales del equipo sin inventar cabina.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'fase_2_conexion_energizacion_y_arranque',
                title_es: 'Conexión a Suministro / Red, Purga Previa, Puesta en Marcha y Pruebas Funcionales en Vacío',
                section_es: 'FASE II — PUESTA EN MARCHA Y VERIFICACIÓN',
                rationale_es: 'Secuencia de acoplamiento neumático/eléctrico o encendido, verificación de lubricación/aislamiento y chequeo inicial sin carga.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'fase_3_tecnica_operativa_y_ciclo_trabajo',
                title_es: `Técnica Correcta de Operación, Regulación de Carga/Caudal y Ciclo de Trabajo (${typeDoc.canonical_type_es})`,
                section_es: 'FASE III — OPERACIÓN PRODUCTIVA',
                rationale_es: 'Procedimiento paso a paso para ejecutar el trabajo nominal del activo con postura ergonómica y control de reacción/proceso.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'fase_4_limites_operativos_y_condiciones_adversas',
                title_es: 'Límites de Ciclo de Trabajo Continuo, Presiones/Temperaturas Máximas y Control de Polvo/Ruido/Vibración',
                section_es: 'FASE IV — LÍMITES OPERATIVOS Y ENTORNO',
                rationale_es: 'Parámetros umbrales que no deben excederse, operación en ambientes confinados/húmedos y mitigación de exposición ocupacional.',
                priority: 'IMPORTANTE',
            },
            {
                chapter_key: 'fase_5_parada_despresurizacion_y_loto',
                title_es: 'Parada Normal, Despresurización / Purga de Energías Residuales, Emergencia y Bloqueo LOTO',
                section_es: 'FASE V — PARADA, EMERGENCIA Y BLOQUEO LOTO',
                rationale_es: 'Secuencia de detención controlada, alivio de presión residual, desconexión física y aplicación de candado personal LOTO.',
                priority: 'CRÍTICO',
            },
        ];
    } else if (isLightOrHeavyUtilityVehicle) {
        defaultCore = [
            {
                chapter_key: 'fase_1_puesto_conduccion_mandos_y_testigos',
                title_es: 'Puesto de Conducción, Cuadro de Instrumentos, Selectores y Testigos Luminosos de Cabina',
                section_es: 'FASE I — ARQUITECTURA DE MANDOS E INDICADORES',
                rationale_es: 'Reconocimiento de controles del volante/consola, indicadores de tablero y código de acción ante testigos rojos y ámbar.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'fase_2_arranque_precalentamiento_y_chequeo_dinamico',
                title_es: 'Secuencia de Arranque, Precalentamiento, Prueba Dinámica de Frenos/Dirección y Salida Segura',
                section_es: 'FASE II — PUESTA EN MARCHA Y VERIFICACIÓN',
                rationale_es: 'Ajuste ergonómico, uso de cinturón de seguridad, precalentamiento de motor, código de bocina y verificación de frenos antes de iniciar marcha.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'fase_3_conduccion_estiba_y_operacion_ruta_faena',
                title_es: 'Técnicas de Conducción Defensiva en Ruta/Faena, Estiba de Carga Útil y Gestión de Transmisión',
                section_es: 'FASE III — OPERACIÓN PRODUCTIVA',
                rationale_es: 'Selección de marchas, distribución y amarre de carga dentro del PBV nominal, freno motor en pendientes y distancias de seguimiento.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'fase_4_limites_pendientes_vadeo_y_altitud',
                title_es: 'Límites Operativos en Pendientes, Vadeo, Gran Altitud y Condiciones Climáticas Adversas',
                section_es: 'FASE IV — LÍMITES OPERATIVOS Y ENTORNO',
                rationale_es: 'Ángulos máximos, profundidad máxima de vadeo, compensación en altitud/baja adherencia y prohibiciones operativas OEM.',
                priority: 'IMPORTANTE',
            },
            {
                chapter_key: 'fase_5_detencion_estacionamiento_acunamiento_y_emergencia',
                title_es: 'Detención de Motor (Enfriamiento Turbo), Estacionamiento en Rampa/Acuñamiento, Remolque y Cortacorriente LOTO',
                section_es: 'FASE V — PARADA, EMERGENCIA Y BLOQUEO LOTO',
                rationale_es: 'Ralentí de enfriamiento del turbocompresor, freno de estacionamiento + cuñas, puntos de rescate/remolque y aislamiento eléctrico.',
                priority: 'CRÍTICO',
            },
        ];
    } else {
        defaultCore = [
            {
                chapter_key: 'fase_1_cabina_mandos_joysticks_y_monitores',
                title_es: 'Cabina ROPS/FOPS, Mandos Joysticks/Pedales, Monitores y Categorías de Advertencia OEM',
                section_es: 'FASE I — ARQUITECTURA DE MANDOS E INDICADORES',
                rationale_es: 'Disposición física de controles de operación, interruptores de cabina, pantalla de monitoreo y niveles de alarma OEM.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'fase_2_arranque_calentamiento_hidraulico_y_pruebas',
                title_es: 'Arranque de Motor, Ciclo de Calentamiento Hidráulico/Transmisión y Pruebas de Freno y Dirección',
                section_es: 'FASE II — PUESTA EN MARCHA Y VERIFICACIÓN',
                rationale_es: 'Subida con 3 puntos de apoyo, secuencia de arranque, desacoplamiento de bloqueo hidráulico y pruebas funcionales antes de operar.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'fase_3_ciclo_operativo_productivo_y_traslado',
                title_es: `Técnicas de Operación Productiva y Traslado Seguro en Faena (${typeDoc.canonical_type_es})`,
                section_es: 'FASE III — OPERACIÓN PRODUCTIVA',
                rationale_es: 'Maniobras paso a paso del ciclo productivo (ataque, llenado, levante, acarreo, descarga o nivelación) y coordinación con otros equipos.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'fase_4_limites_estabilidad_pendientes_y_sobrecarga',
                title_es: 'Límites de Estabilidad, Operación en Rampas/Taludes, Altitud y Prohibiciones Operativas OEM',
                section_es: 'FASE IV — LÍMITES OPERATIVOS Y ENTORNO',
                rationale_es: 'Pendientes longitudinales/transversales máximas, altura de implemento en traslado, prevención de vuelco y límites térmicos/presión.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'fase_5_parada_enfriamiento_parqueo_remolque_y_loto',
                title_es: 'Parada Gradual, Bajada de Implementos, Estacionamiento, Remolque de Emergencia y Bloqueo LOTO',
                section_es: 'FASE V — PARADA, EMERGENCIA Y BLOQUEO LOTO',
                rationale_es: 'Apoyo de implementos en suelo, alivio de presión hidráulica residual, enfriamiento de motor, liberación para remolque y energía cero LOTO.',
                priority: 'CRÍTICO',
            },
        ];
    }

    const defaultConditionals: EquipmentTypeConditionalSubsystemItem[] = [];

    if (isLightOrHeavyUtilityVehicle) {
        defaultConditionals.push(
            {
                subsystem_key: 'op_traccion_4x4_reductora_4l_y_eld',
                title_es: 'Operación de Caja de Transferencia 4x4 (2H / 4H / 4L) y Bloqueo Electrónico de Diferencial (ELD)',
                section_es: 'FASE III — OPERACIÓN PRODUCTIVA',
                rationale_es: 'Procedimiento de acople/desacople de tracción 4WD alta y reductora 4L, velocidades máximas permitidas y uso del bloqueo de diferencial.',
                trigger_keywords: ['4x4', '4wd', '4h', '4l', 'reductora', 'transfer case', 'bloqueo de diferencial', 'eld'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'op_remolque_pesado_tow_haul_tbc_y_freno_escape',
                title_es: 'Operación en Modo Remolque Pesado (Tow/Haul), Quinta Rueda/Gooseneck, Controlador TBC y Freno de Escape Diésel',
                section_es: 'FASE III — OPERACIÓN PRODUCTIVA',
                rationale_es: 'Activación del modo Tow/Haul, calibración de ganancia del controlador de freno de remolque (TBC), freno de escape y límites GCWR.',
                trigger_keywords: ['tow/haul', 'tbc', 'trailer brake', 'quinta rueda', 'gooseneck', 'freno de escape', 'exhaust brake', 'gcwr'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'op_toma_fuerza_pto_estacionaria_y_movil',
                title_es: 'Procedimiento de Acoplamiento y Operación de Toma de Fuerza (Live-Drive PTO) y Control de RPM Auxiliar (SEIC)',
                section_es: 'FASE IV — LÍMITES OPERATIVOS Y ENTORNO',
                rationale_es: 'Condiciones de enclavamiento para activar la Toma de Fuerza (PTO) en estacionario o movimiento y control electrónico de ralentí elevado.',
                trigger_keywords: ['pto', 'power take-off', 'toma de fuerza', 'live-drive', 'seic', 'upfitter'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'op_regeneracion_dpf_y_gestion_def_scr',
                title_es: 'Gestión Operativa de Regeneración del Filtro de Partículas (DPF) y Sistema DEF / AdBlue SCR',
                section_es: 'FASE IV — LÍMITES OPERATIVOS Y ENTORNO',
                rationale_es: 'Cuándo y cómo ejecutar regeneración activa o estacionaria por comando del operador (OCR), zonas seguras y alertas de derateo SCR.',
                trigger_keywords: ['dpf', 'regeneracion', 'def', 'adblue', 'scr', 'filtro de particulas'],
                activation_rule: 'EVIDENCE_PRESENT',
            }
        );
    } else if (isHaulOrDumpTruck) {
        defaultConditionals.push(
            {
                subsystem_key: 'op_retardo_dinamico_arc_y_descenso_cargado',
                title_es: 'Operación del Control Automático de Retardo (ARC) / Retardo Dinámico y Tablas de Velocidad/Marcha en Descenso',
                section_es: 'FASE III — OPERACIÓN PRODUCTIVA',
                rationale_es: 'Ajuste y monitoreo del retardo automático/manual en rampas mineras, selección de marcha antes de la cresta y protección contra sobrevelocidad.',
                trigger_keywords: ['arc', 'automatic retarder', 'retardo dinamico', 'parrilla de retardo', 'frenos enfriados por aceite'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'op_freno_carga_posicionamiento_pala_y_descarga_botadero',
                title_es: 'Procedimiento de Aculatamiento en Pala (Freno de Carga), Política 10/10/20 (TPMS) y Descarga Segura en Botadero/Chancador',
                section_es: 'FASE III — OPERACIÓN PRODUCTIVA',
                rationale_es: 'Ingreso a zona de carguío, uso del freno de carga, interpretación de semáforo TPMS y secuencia de levante/bajada de tolva en berma.',
                trigger_keywords: ['tpms', '10/10/20', 'freno de carga', 'load brake', 'tolva', 'botadero', 'chancador'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'op_gestion_alarmas_vims_y_monitoreo_tkph_rax',
                title_es: 'Protocolo de Actuación ante Categorías de Advertencia VIMS/PLM (Nivel 1, 2, 2-S y 3), Enfriamiento RAX y Límites TKPH',
                section_es: 'FASE IV — LÍMITES OPERATIVOS Y ENTORNO',
                rationale_es: 'Respuesta inmediata del operador según nivel de advertencia VIMS, gestión térmica de ejes RAX/convertidor y límites TKPH de neumáticos gigantes.',
                trigger_keywords: ['vims', 'plm', 'rax', 'tkph', 'rear axle cooling', 'categoria de advertencia'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'op_direccion_secundaria_freno_emergencia_y_remolque_caex',
                title_es: 'Actuación ante Pérdida de Potencia, Uso de Freno Secundario / Dirección Auxiliar y Procedimiento de Remolque CAEX',
                section_es: 'FASE V — PARADA, EMERGENCIA Y BLOQUEO LOTO',
                rationale_es: 'Accionamiento del pedal de freno secundario con acumuladores, dirección de emergencia, barra rígida de remolque y presurización externa.',
                trigger_keywords: ['freno secundario', 'direccion secundaria', 'acumulador', 'remolque', 'towing'],
                activation_rule: 'EVIDENCE_PRESENT',
            }
        );
    } else {
        defaultConditionals.push(
            {
                subsystem_key: 'op_acople_rapido_hidraulica_auxiliar_high_flow',
                title_es: 'Procedimiento de Cambio de Aditamento con Acoplador Rápido (Quick Coupler) y Circuito Hidráulico Auxiliar High-Flow',
                section_es: 'FASE III — OPERACIÓN PRODUCTIVA',
                rationale_es: 'Secuencia de desbloqueo/bloqueo de pasadores, prueba de presión contra el piso, alivio de presión auxiliar y activación de caudal continuo.',
                trigger_keywords: ['acoplador rapido', 'quick coupler', 'high-flow', 'hidraulica auxiliar', 'aditamento', 'martillo'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'op_articulacion_bastidor_awd_y_control_grade_3d',
                title_es: 'Operación de Articulación de Bastidor / Dirección en Cangrejo, Tracción AWD y Control Asistido 2D/3D (Grade Control)',
                section_es: 'FASE III — OPERACIÓN PRODUCTIVA',
                rationale_es: 'Uso coordinado de articulación de bastidor, ángulo de vertedera/círculo, modo Creep/AWD y automatización de pendiente transversal.',
                trigger_keywords: ['articulacion', 'awd', 'cross slope', 'grade control', 'accugrade', 'vertedera', 'ripper'],
                activation_rule: 'EVIDENCE_PRESENT',
            }
        );
    }

    const mergedCore =
        existing?.core_chapters && existing.core_chapters.length >= 4
            ? existing.core_chapters
            : defaultCore;

    const condByKey = new Map<string, EquipmentTypeConditionalSubsystemItem>();
    for (const c of defaultConditionals) {
        condByKey.set(c.subsystem_key, c);
    }
    for (const c of existing?.conditional_subsystems || []) {
        if (c?.subsystem_key && c?.title_es) {
            condByKey.set(c.subsystem_key, c);
        }
    }

    return {
        core_chapters: mergedCore,
        conditional_subsystems: Array.from(condByKey.values()),
        updated_at: existing?.updated_at || new Date().toISOString(),
    };
}

/**
 * Aprendizaje Ascendente Sin Techo para `manual_operaciones`:
 * Incorpora modos operativos especializados descubiertos en modelos complejos al Anillo 2 (`conditional_subsystems`)
 * sin alterar las 5 fases basales del Anillo 1 (`core_chapters`).
 */
export async function evolveEquipmentTypeManualOperacionesBlueprint(params: {
    typeKey: string;
    modelOficial: string;
    discoveredSubsystems: Array<{
        title_es: string;
        section_es: string;
        rationale_es: string;
        trigger_keywords?: string[];
    }>;
}): Promise<void> {
    const cleanKey = normalizeEquipmentTypeKey(params.typeKey);
    if (!cleanKey || !Array.isArray(params.discoveredSubsystems) || params.discoveredSubsystems.length === 0) {
        return;
    }

    try {
        const docRef = db.collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION).doc(cleanKey);
        const snap = await docRef.get();
        if (!snap.exists) return;

        const typeDoc = snap.data() as GlobalEquipmentTypeDoc;
        const currentBlueprint = resolveElasticManualOperacionesBlueprint(typeDoc);
        const existingSubsystems = [...currentBlueprint.conditional_subsystems];
        const nowIso = new Date().toISOString();

        let addedCount = 0;
        for (const sub of params.discoveredSubsystems) {
            const subSlug = normalizeEquipmentTypeKey(sub.title_es).slice(0, 64);
            if (!subSlug || subSlug.length < 4) continue;

            const alreadyExists =
                currentBlueprint.core_chapters.some(
                    (c) => normalizeEquipmentTypeKey(c.title_es) === subSlug
                ) ||
                existingSubsystems.some(
                    (s) =>
                        s.subsystem_key === subSlug ||
                        normalizeEquipmentTypeKey(s.title_es) === subSlug
                );

            if (alreadyExists) continue;

            const autoKeywords = Array.from(
                new Set(
                    [
                        ...(sub.trigger_keywords || []),
                        ...normalizeEquipmentTypeAlias(sub.title_es)
                            .split(' ')
                            .filter((w) => w.length >= 4 && !TYPE_STOPWORDS.has(w)),
                    ].slice(0, 8)
                )
            );

            existingSubsystems.push({
                subsystem_key: subSlug,
                title_es: sub.title_es.trim(),
                section_es: (sub.section_es || 'FASE IV — LÍMITES OPERATIVOS Y ENTORNO').trim().toUpperCase(),
                rationale_es: sub.rationale_es.trim(),
                trigger_keywords: autoKeywords,
                activation_rule: 'EVIDENCE_PRESENT',
                discovered_from_model: params.modelOficial,
                discovered_at: nowIso,
            });
            addedCount++;
        }

        if (addedCount > 0) {
            const updatedBlueprint: EquipmentTypePillarBlueprint = {
                core_chapters: currentBlueprint.core_chapters,
                conditional_subsystems: existingSubsystems.slice(0, 30),
                updated_at: nowIso,
            };

            await docRef.set(
                {
                    pillar_blueprints: {
                        ...(typeDoc.pillar_blueprints || {}),
                        manual_operaciones: updatedBlueprint,
                    },
                    updated_at: nowIso,
                },
                { merge: true }
            );

            const cached = memoryByTypeKey.get(cleanKey);
            if (cached) {
                cached.doc = {
                    ...cached.doc,
                    pillar_blueprints: {
                        ...(cached.doc.pillar_blueprints || {}),
                        manual_operaciones: updatedBlueprint,
                    },
                    updated_at: nowIso,
                };
            }
        }
    } catch (err: any) {
        console.warn('[EquipmentTypeRegistry] No se pudo evolucionar manual_operaciones:', err?.message);
    }
}

/**
 * Resuelve la Ontología Elástica en 2 Anillos + 6 Etapas CMRP para el Itemizado de `pauta_mantencion` (`03 · Pauta de Mantención`):
 * - Anillo 1 (`core_chapters`): Las 6 Etapas CMRP invariantes (`ETAPA I` a `ETAPA VI`) adaptadas a la unidad de control real del TIPO:
 *   * Herramienta manual / Equipo estacionario: Jornada / Semanal / Mensual / Overhaul de piezas internas.
 *   * Vehículo liviano / Utilitario / Camioneta: Kilometraje severo minero (`5.000 km`, `10.000 km`, `20.000 km`, `40.000–100.000 km`) + horas motor.
 *   * Maquinaria pesada / Gran Minería CAEX: Horómetro (`10 h / Diario`, `50 h`, `250 h PM1`, `500 h PM2`, `1.000 h PM3`, `2.000 h PM4`, `4.000 h+`).
 * - Anillo 2 (`conditional_subsystems`): Programas de mantenimiento especializado y monitoreo de condición (`S·O·S`, `RAX`, frenos húmedos,
 *   acumuladores ISO 3450, `Autolube`, `4x4/DRW`, `PTO`, `Quinta Rueda`, `DPF/DEF`, neumáticos gigantes) activados por evidencia y herencia de `01` y `02`.
 */
export function resolveElasticPautaMantencionBlueprint(
    typeDoc: GlobalEquipmentTypeDoc
): EquipmentTypePillarBlueprint {
    const existing = typeDoc.pillar_blueprints?.pauta_mantencion;
    const typeText = `${typeDoc.type_key} ${typeDoc.canonical_type_es} ${typeDoc.categoria_equipo} ${typeDoc.archetype_id || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const isStationaryOrHandTool =
        /\b(compresor|generador|grupo electrogeno|bomba|motobomba|perforadora manual|jackleg|stoper|martillo neumatico|soldadora|chancador|molino|harnero|criba|tablero|transformador|torre de iluminacion|herramienta)\b/i.test(
            typeText
        ) && !/\b(camion|camioneta|excavadora|cargador|motoniveladora|tractor|bulldozer|rodillo|jumbo|manipulador|grua)\b/i.test(typeText);

    const isLightOrHeavyUtilityVehicle =
        /\b(camioneta|pick\s*up|furgon|utilitario|suv|vehiculo liviano|camion liviano|van|chasis cabina)\b/i.test(
            typeText
        );

    const isHaulOrDumpTruck =
        /\b(camion de extraccion|caex|camion minero|camion articulado|camion tolva|dumper|volquete)\b/i.test(
            typeText
        );

    let defaultCore: EquipmentTypeCoreChapterItem[];

    if (isStationaryOrHandTool) {
        defaultCore = [
            {
                chapter_key: 'etapa_1_lubricantes_insumos_y_especificaciones',
                title_es: 'Especificaciones de Lubricantes, Aceite Neumático/Dieléctrico, Grasas, Sellos y Consumibles OEM',
                section_es: 'ETAPA I — LUBRICANTES, FLUIDOS Y CONSUMIBLES OEM',
                rationale_es: 'Tabla maestra de viscosidades ISO VG/SAE, grasas, kits de sellos/empaquetaduras y capacidades verificadas contra Ficha Técnica.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'etapa_2_mantenimiento_diario_jornada_y_lubricacion',
                title_es: 'Mantenimiento Diario Pre/Post-Jornada, Limpieza, Drenaje de Condensado y Lubricación en Línea',
                section_es: 'ETAPA II — MANTENIMIENTO RUTINARIO DIARIO Y SEMANAL',
                rationale_es: 'Tareas de conservación en cada turno: purga de humedad, recarga de lubricador, limpieza de filtros primarios y ajuste de acoples.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'etapa_3_pauta_preventiva_mensual_trimestral',
                title_es: 'Pauta Preventiva Periódica (Semanal / Mensual / 100–250 h): Inspección de Mecanismos, Válvulas y Conexiones',
                section_es: 'ETAPA III — PAUTAS PREVENTIVAS MENORES E INTERMEDIAS (PM1 / PM2)',
                rationale_es: 'Inspección programada de desgaste en bujes/retenidas/escobillas, reemplazo de elementos filtrantes y chequeo de fugas o aislamiento.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'etapa_4_overhaul_desarme_y_reemplazo_componentes',
                title_es: 'Mantenimiento Mayor y Overhaul: Desarme, Medición de Piezas Internas (Pistón/Cilindro/Rotor) y Pruebas en Banco',
                section_es: 'ETAPA IV — PAUTAS PREVENTIVAS MAYORES Y OVERHAUL (PM3 / PM4)',
                rationale_es: 'Reacondicionamiento integral en taller, reemplazo de sellos/rodamientos/resortes y prueba funcional certificada bajo carga.',
                priority: 'IMPORTANTE',
            },
            {
                chapter_key: 'etapa_6_pares_apriete_tolerancias_desgaste_y_loto',
                title_es: 'Pares de Apriete de Tirantes/Pernos, Límites Dimensionales de Condena y Aislamiento LOTO para Intervención',
                section_es: 'ETAPA VI — PARES DE APRIETE, TOLERANCIAS Y LOTO DE MANTENCIÓN',
                rationale_es: 'Torques exactos en N·m, holguras máximas admisibles de piezas sujetas a fricción y despresurización/desenergización LOTO antes de abrir el equipo.',
                priority: 'CRÍTICO',
            },
        ];
    } else if (isLightOrHeavyUtilityVehicle) {
        defaultCore = [
            {
                chapter_key: 'etapa_1_carta_fluidos_viscosidades_y_filtros_oem',
                title_es: 'Carta Maestra de Lubricantes, Viscosidades SAE/API/ACEA, Refrigerante, Líquido de Frenos y Filtros OEM',
                section_es: 'ETAPA I — LUBRICANTES, FLUIDOS Y CONSUMIBLES OEM',
                rationale_es: 'Especificación exacta y volúmenes de llenado para aceite de motor, caja de cambios, diferencial, dirección, frenos DOT y filtros.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'etapa_2_inspeccion_diaria_semanal_y_servicio_severo_5000km',
                title_es: 'Mantenimiento Rutinario Semanal y Servicio en Condición Severa Minera (Cada 5.000 km / 150 h)',
                section_es: 'ETAPA II — MANTENIMIENTO RUTINARIO DIARIO Y SEMANAL',
                rationale_es: 'Revisión de niveles, purga de filtro decantador de combustible, limpieza/reemplazo de filtro de aire en polvo faenero y rotación/presión de neumáticos.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'etapa_3_pauta_preventiva_10000km_pm1_y_20000km_pm2',
                title_es: 'Pauta Preventiva Periódica Menor e Intermedia: Servicio 10.000 km (PM1) y 20.000 km (PM2)',
                section_es: 'ETAPA III — PAUTAS PREVENTIVAS MENORES E INTERMEDIAS (PM1 / PM2)',
                rationale_es: 'Cambio de aceite de motor y filtro, filtros de combustible/cabina, inspección de pastillas/discos/tambores de freno, suspensión, dirección y alineación.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'etapa_4_pauta_preventiva_mayor_40000_a_100000km',
                title_es: 'Pauta Preventiva Mayor (40.000 km, 60.000 km y 100.000 km): Transmisión, Diferenciales, Refrigeración y Distribución',
                section_es: 'ETAPA IV — PAUTAS PREVENTIVAS MAYORES Y OVERHAUL (PM3 / PM4)',
                rationale_es: 'Renovación de fluidos de transmisión y ejes, correa/cadena de distribución y accesorios, líquido de frenos, bujías/inyectores y refrigerante de larga duración.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'etapa_6_pares_apriete_ruedas_chasis_frenos_y_loto',
                title_es: 'Pares de Apriete Críticos (Tuercas de Rueda, Suspensión, Calipers), Espesores Mínimos de Freno y Bloqueo LOTO en Taller',
                section_es: 'ETAPA VI — PARES DE APRIETE, TOLERANCIAS Y LOTO DE MANTENCIÓN',
                rationale_es: 'Torque oficial de llantas (y re-torqueo), espesores mínimos de discos/balatas, cotas de suspensión y desconexión segura de batería/elevador en taller.',
                priority: 'CRÍTICO',
            },
        ];
    } else {
        defaultCore = [
            {
                chapter_key: 'etapa_1_carta_lubricantes_refrigerante_filtros_y_capacidades',
                title_es: 'Carta Maestra de Lubricantes SAE/ISO, Refrigerante ELC, Filtros OEM y Capacidades de Rellenado por Compartimento',
                section_es: 'ETAPA I — LUBRICANTES, FLUIDOS Y CONSUMIBLES OEM',
                rationale_es: 'Especificación técnica de aceites de motor, hidráulico, transmisión, mandos finales/ejes, grasa NLGI y capacidades en litros.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'etapa_2_mantenimiento_diario_10h_semanal_50h_y_engrase',
                title_es: 'Mantenimiento Rutinario Diario (10 h), Semanal (50 h) y Mapa de Puntos de Engrase y Drenajes',
                section_es: 'ETAPA II — MANTENIMIENTO RUTINARIO DIARIO Y SEMANAL',
                rationale_es: 'Inspección de niveles, drenaje de agua/sedimentos de tanque y separador, indicadores de restricción de aire, tensión de correas/orugas y engrase de pasadores.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'etapa_3_pauta_preventiva_250h_pm1_y_500h_pm2',
                title_es: 'Pauta Preventiva Periódica Menor e Intermedia: Servicio 250 Horas (PM1) y 500 Horas (PM2)',
                section_es: 'ETAPA III — PAUTAS PREVENTIVAS MENORES E INTERMEDIAS (PM1 / PM2)',
                rationale_es: 'Cambio de aceite y filtro de motor, filtros de combustible primarios/secundarios, respiraderos, filtros hidráulicos/transmisión y chequeo de frenos/ROPS.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'etapa_4_pauta_preventiva_mayor_1000h_pm3_2000h_pm4_y_overhaul',
                title_es: 'Pauta Preventiva Mayor: Servicio 1.000 Horas (PM3), 2.000 Horas (PM4) y Renovación de Fluidos / Calibración de Válvulas',
                section_es: 'ETAPA IV — PAUTAS PREVENTIVAS MAYORES Y OVERHAUL (PM3 / PM4)',
                rationale_es: 'Reemplazo de aceite de transmisión, hidráulico, diferenciales y mandos finales, ajuste de luz de válvulas/inyectores, secador de aire y refrigerante ELC.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'etapa_6_pares_apriete_tolerancias_get_y_loto_mantencion',
                title_es: 'Pares de Apriete Estructurales, Tolerancias de Desgaste (GET / Tren de Rodaje / Frenos) y Protocolo LOTO de Intervención',
                section_es: 'ETAPA VI — PARES DE APRIETE, TOLERANCIAS Y LOTO DE MANTENCIÓN',
                rationale_es: 'Torques de pernos de rueda/tornamesa/cuchillas, límites de desgaste y procedimiento de alivio de presión residual hidráulica/neumática y bloqueo LOTO.',
                priority: 'CRÍTICO',
            },
        ];
    }

    const defaultConditionals: EquipmentTypeConditionalSubsystemItem[] = [];

    if (isLightOrHeavyUtilityVehicle) {
        defaultConditionals.push(
            {
                subsystem_key: 'pm_caja_transferencia_4x4_ejes_drw_y_cubos',
                title_es: 'Mantenimiento de Caja de Transferencia 4x4, Bloqueo Diferencial (ELD), Cubos Delanteros y Eje Trasero Dually (DRW)',
                section_es: 'ETAPA V — MANTENIMIENTO DE SUBSISTEMAS ESPECIALIZADOS Y PDM',
                rationale_es: 'Intervalos de cambio de fluido de caja de transferencia 4WD, aceite sintético de puente trasero bajo carga, engrase de cardanes y torque de ruedas gemelas DRW.',
                trigger_keywords: ['4x4', '4wd', 'transfer case', 'reductora', 'drw', 'dually', 'doble rodado', 'eld', 'bloqueo de diferencial'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'pm_transmision_hd_remolque_pto_y_quinta_rueda',
                title_es: 'Servicio de Transmisión Heavy-Duty bajo Remolque, Toma de Fuerza (Live-Drive PTO) y Enganche Quinta Rueda / Gooseneck',
                section_es: 'ETAPA V — MANTENIMIENTO DE SUBSISTEMAS ESPECIALIZADOS Y PDM',
                rationale_es: 'Mantenimiento de transmisión TorqShift/automática HD y filtro en uso severo con PTO, inspección de muela/kingpin de Quinta Rueda y conector TBC.',
                trigger_keywords: ['pto', 'power take-off', 'toma de fuerza', 'torqshift', 'quinta rueda', '5th wheel', 'gooseneck', 'tbc', 'gcwr'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'pm_postratamiento_dpf_scr_def_y_sistema_electrico_dual',
                title_es: 'Mantenimiento del Sistema de Postratamiento Diésel (Limpieza DPF, Dosificador DEF/SCR) y Sistema Eléctrico Dual',
                section_es: 'ETAPA V — MANTENIMIENTO DE SUBSISTEMAS ESPECIALIZADOS Y PDM',
                rationale_es: 'Intervalo de limpieza de cenizas del filtro DPF, filtro de bomba DEF/AdBlue, sensores NOx y prueba de doble batería/alternador auxiliar.',
                trigger_keywords: ['dpf', 'def', 'adblue', 'scr', 'dual alternator', 'doble alternador', 'bateria auxiliar', 'upfitter'],
                activation_rule: 'EVIDENCE_PRESENT',
            }
        );
    } else if (isHaulOrDumpTruck) {
        defaultConditionals.push(
            {
                subsystem_key: 'pm_muestreo_tribologico_sos_y_filtros_magneticos',
                title_es: 'Programa de Análisis Tribológico de Fluidos (S·O·S), Inspección de Tapones Magnéticos y Pantallas de Succión',
                section_es: 'ETAPA V — MANTENIMIENTO DE SUBSISTEMAS ESPECIALIZADOS Y PDM',
                rationale_es: 'Frecuencia de muestreo S·O·S (250 h / 500 h), límites de limpieza ISO 4406 y revisión de partículas metálicas en convertidor, transmisión, diferencial y mandos finales.',
                trigger_keywords: ['sos', 's·o·s', 'muestreo de aceite', 'tapones magneticos', 'magnetic screen', 'iso 4406', 'mandos finales'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'pm_frenos_discos_humedos_retardo_arc_y_acumuladores',
                title_es: 'Mantenimiento de Paquetes de Frenos Húmedos Enfriados por Aceite, Indicadores de Desgaste, Enfriadores y Acumuladores ISO 3450',
                section_es: 'ETAPA V — MANTENIMIENTO DE SUBSISTEMAS ESPECIALIZADOS Y PDM',
                rationale_es: 'Medición de espesor de discos de freno húmedos, purga del circuito de enfriamiento de frenos, precarga de nitrógeno en acumuladores de freno/dirección y parrillas/ARC.',
                trigger_keywords: ['frenos enfriados por aceite', 'oil-cooled brakes', 'arc', 'acumulador', 'iso 3450', 'parrilla de retardo', 'desgaste de frenos'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'pm_enfriamiento_ejes_rax_suspension_y_autolube',
                title_es: 'Servicio del Sistema de Enfriamiento de Ejes (RAX), Cilindros Hidroneumáticos de Suspensión, Autolube y Calibración TPMS',
                section_es: 'ETAPA V — MANTENIMIENTO DE SUBSISTEMAS ESPECIALIZADOS Y PDM',
                rationale_es: 'Cambio de filtros de eje RAX, altura de carga de nitrógeno/aceite en cilindros de suspensión, inyectores del sistema Autolube y recalibración de sensores TPMS.',
                trigger_keywords: ['rax', 'rear axle cooling', 'autolube', 'lubricacion automatica', 'cilindros de suspension', 'tpms', 'vims'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'pm_neumaticos_gigantes_torque_clamps_y_tolva_minera',
                title_es: 'Gestión y Mantenimiento de Neumáticos Gigantes (Nitrógeno / Rotación / TKPH), Torque de Clamps y Revestimiento de Tolva (Liner)',
                section_es: 'ETAPA V — MANTENIMIENTO DE SUBSISTEMAS ESPECIALIZADOS Y PDM',
                rationale_es: 'Control de presión en frío con nitrógeno, secuencia de reapriete de tuercas/clamps, inspección ultrasónica/NDT de bastidor y espesor de planchas de desgaste de tolva.',
                trigger_keywords: ['59/80r63', 'neumaticos', 'tkph', 'tolva', 'msd', 'x body', 'liner', 'pads de tolva'],
                activation_rule: 'EVIDENCE_PRESENT',
            }
        );
    } else {
        defaultConditionals.push(
            {
                subsystem_key: 'pm_muestreo_sos_hidraulico_y_acumuladores_pilotaje',
                title_es: 'Muestreo de Aceite (S·O·S), Limpieza de Circuito Hidráulico Auxiliar / High-Flow y Acumuladores de Pilotaje/Freno',
                section_es: 'ETAPA V — MANTENIMIENTO DE SUBSISTEMAS ESPECIALIZADOS Y PDM',
                rationale_es: 'Intervalos de muestreo tribológico, reemplazo de filtros de retorno/drenaje de caja (case drain), acoples rápidos y verificación de precarga de acumuladores.',
                trigger_keywords: ['sos', 'high-flow', 'hidraulica auxiliar', 'case drain', 'acumulador', 'quick coupler', 'acoplador rapido'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'pm_tren_rodaje_orugas_tornamesa_o_tandem',
                title_es: 'Mantenimiento de Tren de Rodaje (Tensión de Orugas / Rodillos / Rueda Guía), Corona de Giro (Tornamesa) o Cajas Tándem',
                section_es: 'ETAPA V — MANTENIMIENTO DE SUBSISTEMAS ESPECIALIZADOS Y PDM',
                rationale_es: 'Medición de comba/tensión de cadenas u orugas, engrase de baño de corona de giro/piñón, nivel de aceite de cajas tándem y ajuste de bandas de desgaste de círculo.',
                trigger_keywords: ['orugas', 'tren de rodaje', 'tornamesa', 'swing drive', 'tandem', 'vertedera', 'circulo'],
                activation_rule: 'EVIDENCE_PRESENT',
            }
        );
    }

    const mergedCore =
        existing?.core_chapters && existing.core_chapters.length >= 4
            ? existing.core_chapters
            : defaultCore;

    const condByKey = new Map<string, EquipmentTypeConditionalSubsystemItem>();
    for (const c of defaultConditionals) {
        condByKey.set(c.subsystem_key, c);
    }
    for (const c of existing?.conditional_subsystems || []) {
        if (c?.subsystem_key && c?.title_es) {
            condByKey.set(c.subsystem_key, c);
        }
    }

    return {
        core_chapters: mergedCore,
        conditional_subsystems: Array.from(condByKey.values()),
        updated_at: existing?.updated_at || new Date().toISOString(),
    };
}

/**
 * Aprendizaje Ascendente Sin Techo para `pauta_mantencion`:
 * Incorpora pautas de subsistemas especializados descubiertas en modelos complejos al Anillo 2 (`conditional_subsystems`)
 * sin alterar las etapas basales del Anillo 1 (`core_chapters`).
 */
export async function evolveEquipmentTypePautaMantencionBlueprint(params: {
    typeKey: string;
    modelOficial: string;
    discoveredSubsystems: Array<{
        title_es: string;
        section_es: string;
        rationale_es: string;
        trigger_keywords?: string[];
    }>;
}): Promise<void> {
    const cleanKey = normalizeEquipmentTypeKey(params.typeKey);
    if (!cleanKey || !Array.isArray(params.discoveredSubsystems) || params.discoveredSubsystems.length === 0) {
        return;
    }

    try {
        const docRef = db.collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION).doc(cleanKey);
        const snap = await docRef.get();
        if (!snap.exists) return;

        const typeDoc = snap.data() as GlobalEquipmentTypeDoc;
        const currentBlueprint = resolveElasticPautaMantencionBlueprint(typeDoc);
        const existingSubsystems = [...currentBlueprint.conditional_subsystems];
        const nowIso = new Date().toISOString();

        let addedCount = 0;
        for (const sub of params.discoveredSubsystems) {
            const subSlug = normalizeEquipmentTypeKey(sub.title_es).slice(0, 64);
            if (!subSlug || subSlug.length < 4) continue;

            const alreadyExists =
                currentBlueprint.core_chapters.some(
                    (c) => normalizeEquipmentTypeKey(c.title_es) === subSlug
                ) ||
                existingSubsystems.some(
                    (s) =>
                        s.subsystem_key === subSlug ||
                        normalizeEquipmentTypeKey(s.title_es) === subSlug
                );

            if (alreadyExists) continue;

            const autoKeywords = Array.from(
                new Set(
                    [
                        ...(sub.trigger_keywords || []),
                        ...normalizeEquipmentTypeAlias(sub.title_es)
                            .split(' ')
                            .filter((w) => w.length >= 4 && !TYPE_STOPWORDS.has(w)),
                    ].slice(0, 8)
                )
            );

            existingSubsystems.push({
                subsystem_key: subSlug,
                title_es: sub.title_es.trim(),
                section_es: (sub.section_es || 'ETAPA V — MANTENIMIENTO DE SUBSISTEMAS ESPECIALIZADOS Y PDM').trim().toUpperCase(),
                rationale_es: sub.rationale_es.trim(),
                trigger_keywords: autoKeywords,
                activation_rule: 'EVIDENCE_PRESENT',
                discovered_from_model: params.modelOficial,
                discovered_at: nowIso,
            });
            addedCount++;
        }

        if (addedCount > 0) {
            const updatedBlueprint: EquipmentTypePillarBlueprint = {
                core_chapters: currentBlueprint.core_chapters,
                conditional_subsystems: existingSubsystems.slice(0, 30),
                updated_at: nowIso,
            };

            await docRef.set(
                {
                    pillar_blueprints: {
                        ...(typeDoc.pillar_blueprints || {}),
                        pauta_mantencion: updatedBlueprint,
                    },
                    updated_at: nowIso,
                },
                { merge: true }
            );

            const cached = memoryByTypeKey.get(cleanKey);
            if (cached) {
                cached.doc = {
                    ...cached.doc,
                    pillar_blueprints: {
                        ...(cached.doc.pillar_blueprints || {}),
                        pauta_mantencion: updatedBlueprint,
                    },
                    updated_at: nowIso,
                };
            }
        }
    } catch (err: any) {
        console.warn('[EquipmentTypeRegistry] No se pudo evolucionar pauta_mantencion:', err?.message);
    }
}

/**
 * Resuelve la Ontología Elástica en 2 Anillos + 6 Dominios HSEC para el Itemizado de `matriz_riesgos` (`04 · Matriz de Riesgos HSEC`):
 * - Anillo 1 (`core_chapters`): 6 Dominios HSEC invariantes (`DOMINIO I` a `DOMINIO VI`) adaptados a la naturaleza física del TIPO
 *   (herramienta manual / equipo estacionario, vehículo liviano / Heavy-Duty, maquinaria pesada / CAEX), bajo ISO 45001 / ISO 12100 / DS 132.
 * - Anillo 2 (`conditional_subsystems`): Peligros de subsistemas especializados activados por evidencia y herencia de `01`, `02` y `03`.
 */
export function resolveElasticMatrizRiesgosBlueprint(
    typeDoc: GlobalEquipmentTypeDoc
): EquipmentTypePillarBlueprint {
    const existing = typeDoc.pillar_blueprints?.matriz_riesgos;
    const typeText = `${typeDoc.type_key} ${typeDoc.canonical_type_es} ${typeDoc.categoria_equipo} ${typeDoc.archetype_id || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const isStationaryOrHandTool =
        /\b(compresor|generador|grupo electrogeno|bomba|motobomba|perforadora manual|jackleg|stoper|martillo neumatico|soldadora|chancador|molino|harnero|criba|tablero|transformador|torre de iluminacion|herramienta)\b/i.test(
            typeText
        ) && !/\b(camion|camioneta|excavadora|cargador|motoniveladora|tractor|bulldozer|rodillo|jumbo|manipulador|grua)\b/i.test(typeText);

    const isLightOrHeavyUtilityVehicle =
        /\b(camioneta|pick\s*up|furgon|utilitario|suv|vehiculo liviano|camion liviano|van|chasis cabina)\b/i.test(
            typeText
        );

    const isHaulOrDumpTruck =
        /\b(camion de extraccion|caex|camion minero|camion articulado|camion tolva|dumper|volquete)\b/i.test(
            typeText
        );

    let defaultCore: EquipmentTypeCoreChapterItem[];
    const defaultConditionals: EquipmentTypeConditionalSubsystemItem[] = [];

    if (isStationaryOrHandTool) {
        defaultCore = [
            {
                chapter_key: 'dominio_1_loto_despresurizacion_desconexion',
                title_es: 'Aislamiento de Energías Neumática / Eléctrica / Hidráulica, Despresurización de Líneas y Bloqueo LOTO',
                section_es: 'DOMINIO I — AISLAMIENTO Y CONTROL DE ENERGÍAS PELIGROSAS (LOTO)',
                rationale_es: 'Identificación de fuentes de energía del equipo, corte de suministro, alivio de presión residual, candado personal y prueba de energía cero.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'dominio_2_atrapamiento_proyeccion_latigazo',
                title_es: 'Atrapamiento en Partes Rotatorias, Proyección de Partículas y Latigazo de Mangueras Presurizadas',
                section_es: 'DOMINIO II — RIESGOS CRÍTICOS EN OPERACIÓN',
                rationale_es: 'Peligros durante el ciclo de trabajo nominal: guardas, retenedores whipcheck, distancias de seguridad y controles de reacción del equipo.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'dominio_3_intervencion_desarme_y_manipulacion',
                title_es: 'Riesgos en Desarme, Cambio de Piezas de Desgaste, Manipulación Manual y Pruebas Funcionales',
                section_es: 'DOMINIO III — RIESGOS EN INTERVENCIÓN Y MANTENCIÓN',
                rationale_es: 'Peligros derivados de las tareas de la Pauta de Mantención: liberación de resortes/presión, cortes, sobreesfuerzo y prueba post-armado.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'dominio_5_havs_ruido_silice',
                title_es: 'Exposición a Vibración Mano-Brazo (ISO 5349), Ruido (PREXOR), Sílice Cristalina (PLANESI) y Ergonomía',
                section_es: 'DOMINIO V — HIGIENE OCUPACIONAL Y AGENTES FÍSICOS/QUÍMICOS',
                rationale_es: 'Agentes de exposición ocupacional inherentes al equipo, límites permisibles DS 594 y controles de ingeniería/administrativos.',
                priority: 'IMPORTANTE',
            },
            {
                chapter_key: 'dominio_6_electrico_incendio_epp',
                title_es: 'Riesgo Eléctrico / Arco, Prevención de Incendio, Respuesta a Emergencias y EPP Certificado',
                section_es: 'DOMINIO VI — INCENDIO, EMERGENCIAS Y EPP',
                rationale_es: 'Puesta a tierra, protección diferencial, fuentes de ignición, extintor asociado, actuación ante emergencia y matriz de EPP por tarea.',
                priority: 'IMPORTANTE',
            },
        ];
    } else if (isLightOrHeavyUtilityVehicle) {
        defaultCore = [
            {
                chapter_key: 'dominio_1_inmovilizacion_cortacorriente_loto',
                title_es: 'Inmovilización, Acuñamiento, Cortacorriente y Bloqueo LOTO del Vehículo en Taller',
                section_es: 'DOMINIO I — AISLAMIENTO Y CONTROL DE ENERGÍAS PELIGROSAS (LOTO)',
                rationale_es: 'Freno de estacionamiento, cuñas, desconexión de batería/cortacorriente, retiro de llave y tarjeta de bloqueo antes de intervenir.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'dominio_2_conduccion_faena_interaccion_equipos',
                title_es: 'Conducción en Faena, Interacción con Maquinaria Pesada, Puntos Ciegos y Pérdida de Control en Rampa',
                section_es: 'DOMINIO II — RIESGOS CRÍTICOS EN OPERACIÓN',
                rationale_es: 'Riesgos de colisión y volcamiento en caminos mineros, distancias de seguimiento, señalización (pértiga/baliza) y prioridad de tránsito.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'dominio_3_levante_cambio_rueda_mantencion',
                title_es: 'Riesgos en Levante con Gata/Elevador, Cambio de Rueda y Mantención Básica',
                section_es: 'DOMINIO III — RIESGOS EN INTERVENCIÓN Y MANTENCIÓN',
                rationale_es: 'Aplastamiento por caída del vehículo, uso de caballetes certificados, puntos de levante OEM y contacto con fluidos calientes.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'dominio_5_estiba_ergonomia_agentes',
                title_es: 'Desplazamiento de Carga, Ergonomía de Conducción, Fatiga/Somnolencia y Agentes Físicos (Polvo/Ruido)',
                section_es: 'DOMINIO V — HIGIENE OCUPACIONAL Y AGENTES FÍSICOS/QUÍMICOS',
                rationale_es: 'Amarre de carga dentro del PBV, postura de conducción, gestión de fatiga en turnos y exposición en ruta.',
                priority: 'IMPORTANTE',
            },
            {
                chapter_key: 'dominio_6_incendio_emergencia_vial_epp',
                title_es: 'Prevención de Incendio Vehicular, Emergencia Vial en Faena y EPP Obligatorio',
                section_es: 'DOMINIO VI — INCENDIO, EMERGENCIAS Y EPP',
                rationale_es: 'Extintor, kit de emergencia, procedimiento ante falla/accidente en ruta minera y EPP exigido al conductor.',
                priority: 'IMPORTANTE',
            },
        ];
        defaultConditionals.push(
            {
                subsystem_key: 'mr_pto_cardan_atrapamiento',
                title_es: 'Riesgo de Atrapamiento y Amputación en Eje Cardán de Toma de Fuerza (PTO)',
                section_es: 'DOMINIO IV — RIESGOS DE SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Guardas del eje, prohibición de intervención con PTO acoplada y bloqueo del accionamiento.',
                trigger_keywords: ['pto', 'toma de fuerza', 'power take-off', 'cardan'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'mr_quinta_rueda_remolque',
                title_es: 'Riesgo de Efecto Tijera, Aplastamiento en Acople de Quinta Rueda / Gooseneck y Falla de Freno de Remolque',
                section_es: 'DOMINIO IV — RIESGOS DE SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Maniobra de acople/desacople, verificación de traba, cadenas de seguridad y controlador de frenos de remolque.',
                trigger_keywords: ['quinta rueda', 'fifth wheel', 'gooseneck', 'remolque', 'trailer', 'enganche'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'mr_drw_rueda_gemela',
                title_es: 'Riesgo de Estallido y Aplastamiento en Intervención de Doble Rodado Trasero (DRW)',
                section_es: 'DOMINIO IV — RIESGOS DE SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Desinflado previo, jaula de inflado, secuencia de torque de tuercas y verificación de llanta interior.',
                trigger_keywords: ['drw', 'dually', 'doble rodado', 'rueda gemela'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'mr_common_rail_dpf_def',
                title_es: 'Riesgo de Inyección Cutánea Common-Rail, Quemadura por Regeneración DPF y Exposición a DEF',
                section_es: 'DOMINIO IV — RIESGOS DE SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Tiempo de despresurización del riel, zonas térmicas durante regeneración y manipulación de urea (DEF/AdBlue).',
                trigger_keywords: ['common rail', 'dpf', 'def', 'scr', 'adblue', 'regeneracion'],
                activation_rule: 'EVIDENCE_PRESENT',
            }
        );
    } else {
        defaultCore = [
            {
                chapter_key: 'dominio_1_loto_multipunto_trabas_mecanicas',
                title_es: 'Aislamiento y Bloqueo LOTO Multipunto (Eléctrico, Arranque, Hidráulico, Dirección/Frenos) y Trabas Mecánicas de Implementos',
                section_es: 'DOMINIO I — AISLAMIENTO Y CONTROL DE ENERGÍAS PELIGROSAS (LOTO)',
                rationale_es: 'Inventario de energías del equipo, puntos de bloqueo OEM, apoyo/traba de implementos izados y prueba de energía cero.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'dominio_2_perdida_control_vuelco_puntos_ciegos',
                title_es: isHaulOrDumpTruck
                    ? 'Pérdida de Control en Rampa, Sobrecarga, Colisión y Puntos Ciegos 360°'
                    : 'Pérdida de Estabilidad / Vuelco (ROPS/FOPS), Interacción Hombre-Máquina y Puntos Ciegos',
                section_es: 'DOMINIO II — RIESGOS CRÍTICOS EN OPERACIÓN',
                rationale_es: 'Riesgos de fatalidad durante la operación productiva heredados del Manual de Operaciones: pendientes, bermas, segregación y visibilidad.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'dominio_3_intervencion_izaje_pruebas_hidraulicas',
                title_es: 'Aplastamiento y Liberación de Energía en Mantención Mayor, Izaje de Componentes y Pruebas Hidráulicas',
                section_es: 'DOMINIO III — RIESGOS EN INTERVENCIÓN Y MANTENCIÓN',
                rationale_es: 'Peligros derivados de la Pauta de Mantención: inyección cutánea de fluido, componentes pesados, fluidos calientes y pruebas con presión.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'dominio_5_ruido_vibracion_silice_gases',
                title_es: 'Higiene Ocupacional en Cabina y Taller (Ruido PREXOR, Vibración Cuerpo Entero ISO 2631, Sílice PLANESI y Gases Diésel)',
                section_es: 'DOMINIO V — HIGIENE OCUPACIONAL Y AGENTES FÍSICOS/QUÍMICOS',
                rationale_es: 'Agentes de exposición propios del equipo, presurización/filtrado de cabina y límites permisibles DS 594.',
                priority: 'IMPORTANTE',
            },
            {
                chapter_key: 'dominio_6_incendio_afex_evacuacion_epp',
                title_es: 'Prevención de Incendios en Compartimento Motor, Sistema de Supresión, Evacuación de Emergencia y EPP',
                section_es: 'DOMINIO VI — INCENDIO, EMERGENCIAS Y EPP',
                rationale_es: 'Fuentes de ignición (turbo/escape/eléctrico), sistema de supresión automática, salida de emergencia de cabina y EPP por tarea.',
                priority: 'IMPORTANTE',
            },
        ];
        defaultConditionals.push(
            {
                subsystem_key: 'mr_acumuladores_suspension_hidroneumatica',
                title_es: 'Riesgo de Descarga Violenta de Acumuladores Hidráulicos (ISO 3450) y Cilindros de Suspensión Hidroneumáticos',
                section_es: 'DOMINIO IV — RIESGOS DE SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Purga de acumuladores de frenos/dirección, carga de nitrógeno y prohibición de desarme bajo presión.',
                trigger_keywords: ['acumulador', 'iso 3450', 'suspension hidroneumatica', 'nitrogeno', 'frenos humedos'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'mr_neumaticos_gigantes_piroforicidad',
                title_es: 'Riesgo de Piroforicidad, Explosión y Desmontaje de Neumáticos Gigantes y Llantas Multipieza',
                section_es: 'DOMINIO IV — RIESGOS DE SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Zona de exclusión ante calentamiento, inflado con nitrógeno, jaula/manipulador de neumáticos y secuencia de destorque.',
                trigger_keywords: ['neumatico gigante', 'otr', 'r63', 'r57', 'r51', 'llanta multipieza', 'neumaticos'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'mr_trabajo_altura_pasarelas',
                title_es: 'Riesgo de Caída a Distinto Nivel en Escaleras, Pasarelas Perimetrales y Techo de Cabina',
                section_es: 'DOMINIO IV — RIESGOS DE SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Regla de 3 puntos de apoyo, barandas, arnés con punto de anclaje certificado para trabajos sobre 1,8 m.',
                trigger_keywords: ['pasarela', 'escalera', 'plataforma', 'altura', 'barandas'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'mr_tolva_pluma_hoja_izada',
                title_es: 'Riesgo de Atrapamiento por Caída de Tolva / Pluma / Hoja Izada sin Pines o Cables de Retención',
                section_es: 'DOMINIO IV — RIESGOS DE SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Uso obligatorio de dispositivos mecánicos de retención OEM antes de ingresar bajo implementos elevados.',
                trigger_keywords: ['tolva', 'pluma', 'brazo', 'hoja', 'cucharon', 'balde', 'vertedera', 'implemento'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'mr_alta_presion_autolube_levante',
                title_es: 'Riesgo de Proyección e Inyección Cutánea de Fluido a Alta Presión en Circuitos de Levante, Frenos y Engrase Automático',
                section_es: 'DOMINIO IV — RIESGOS DE SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Detección de fugas sin contacto (cartón), despresurización de Autolube y mangueras de levante, atención médica inmediata.',
                trigger_keywords: ['autolube', 'engrase automatico', 'levante', 'hoist', 'alta presion', 'rax'],
                activation_rule: 'EVIDENCE_PRESENT',
            }
        );
    }

    const mergedCore =
        existing?.core_chapters && existing.core_chapters.length >= 4
            ? existing.core_chapters
            : defaultCore;

    const condByKey = new Map<string, EquipmentTypeConditionalSubsystemItem>();
    for (const c of defaultConditionals) {
        condByKey.set(c.subsystem_key, c);
    }
    for (const c of existing?.conditional_subsystems || []) {
        if (c?.subsystem_key && c?.title_es) {
            condByKey.set(c.subsystem_key, c);
        }
    }

    return {
        core_chapters: mergedCore,
        conditional_subsystems: Array.from(condByKey.values()),
        updated_at: existing?.updated_at || new Date().toISOString(),
    };
}

/**
 * Aprendizaje Ascendente Sin Techo para `matriz_riesgos`:
 * Incorpora peligros de subsistemas especializados descubiertos en modelos complejos al Anillo 2 (`conditional_subsystems`)
 * sin alterar los dominios basales del Anillo 1 (`core_chapters`).
 */
export async function evolveEquipmentTypeMatrizRiesgosBlueprint(params: {
    typeKey: string;
    modelOficial: string;
    discoveredSubsystems: Array<{
        title_es: string;
        section_es: string;
        rationale_es: string;
        trigger_keywords?: string[];
    }>;
}): Promise<void> {
    const cleanKey = normalizeEquipmentTypeKey(params.typeKey);
    if (!cleanKey || !Array.isArray(params.discoveredSubsystems) || params.discoveredSubsystems.length === 0) {
        return;
    }

    try {
        const docRef = db.collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION).doc(cleanKey);
        const snap = await docRef.get();
        if (!snap.exists) return;

        const typeDoc = snap.data() as GlobalEquipmentTypeDoc;
        const currentBlueprint = resolveElasticMatrizRiesgosBlueprint(typeDoc);
        const existingSubsystems = [...currentBlueprint.conditional_subsystems];
        const nowIso = new Date().toISOString();

        let addedCount = 0;
        for (const sub of params.discoveredSubsystems) {
            const subSlug = normalizeEquipmentTypeKey(sub.title_es).slice(0, 64);
            if (!subSlug || subSlug.length < 4) continue;

            const alreadyExists =
                currentBlueprint.core_chapters.some(
                    (c) => normalizeEquipmentTypeKey(c.title_es) === subSlug
                ) ||
                existingSubsystems.some(
                    (s) =>
                        s.subsystem_key === subSlug ||
                        normalizeEquipmentTypeKey(s.title_es) === subSlug
                );

            if (alreadyExists) continue;

            const autoKeywords = Array.from(
                new Set(
                    [
                        ...(sub.trigger_keywords || []),
                        ...normalizeEquipmentTypeAlias(sub.title_es)
                            .split(' ')
                            .filter((w) => w.length >= 4 && !TYPE_STOPWORDS.has(w)),
                    ].slice(0, 8)
                )
            );

            existingSubsystems.push({
                subsystem_key: subSlug,
                title_es: sub.title_es.trim(),
                section_es: (sub.section_es || 'DOMINIO IV — RIESGOS DE SUBSISTEMAS ESPECIALIZADOS').trim().toUpperCase(),
                rationale_es: sub.rationale_es.trim(),
                trigger_keywords: autoKeywords,
                activation_rule: 'EVIDENCE_PRESENT',
                discovered_from_model: params.modelOficial,
                discovered_at: nowIso,
            });
            addedCount++;
        }

        if (addedCount > 0) {
            const updatedBlueprint: EquipmentTypePillarBlueprint = {
                core_chapters: currentBlueprint.core_chapters,
                conditional_subsystems: existingSubsystems.slice(0, 30),
                updated_at: nowIso,
            };

            await docRef.set(
                {
                    pillar_blueprints: {
                        ...(typeDoc.pillar_blueprints || {}),
                        matriz_riesgos: updatedBlueprint,
                    },
                    updated_at: nowIso,
                },
                { merge: true }
            );

            const cached = memoryByTypeKey.get(cleanKey);
            if (cached) {
                cached.doc = {
                    ...cached.doc,
                    pillar_blueprints: {
                        ...(cached.doc.pillar_blueprints || {}),
                        matriz_riesgos: updatedBlueprint,
                    },
                    updated_at: nowIso,
                };
            }
        }
    } catch (err: any) {
        console.warn('[EquipmentTypeRegistry] No se pudo evolucionar matriz_riesgos:', err?.message);
    }
}

/**
 * Resuelve la Ontología Elástica en 2 Anillos + 6 Zonas Cronológicas para el Itemizado de `checklist_pre_op` (`05 · Checklist Pre-Op`):
 * - Anillo 1 (`core_chapters`): Recorrido físico basal (`ZONA I` a `ZONA VI`) ejecutable en < 15 min, adaptado a la naturaleza del TIPO
 *   (herramienta manual / equipo estacionario, vehículo liviano / Heavy-Duty, maquinaria pesada / CAEX).
 * - Anillo 2 (`conditional_subsystems`): Verificaciones pre-uso de subsistemas especializados heredados de `01`, `02`, `03` y `04`.
 */
export function resolveElasticChecklistPreOpBlueprint(
    typeDoc: GlobalEquipmentTypeDoc
): EquipmentTypePillarBlueprint {
    const existing = typeDoc.pillar_blueprints?.checklist_pre_op;
    const typeText = `${typeDoc.type_key} ${typeDoc.canonical_type_es} ${typeDoc.categoria_equipo} ${typeDoc.archetype_id || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const isStationaryOrHandTool =
        /\b(compresor|generador|grupo electrogeno|bomba|motobomba|perforadora manual|jackleg|stoper|martillo neumatico|soldadora|chancador|molino|harnero|criba|tablero|transformador|torre de iluminacion|herramienta)\b/i.test(
            typeText
        ) && !/\b(camion|camioneta|excavadora|cargador|motoniveladora|tractor|bulldozer|rodillo|jumbo|manipulador|grua)\b/i.test(typeText);

    const isLightOrHeavyUtilityVehicle =
        /\b(camioneta|pick\s*up|furgon|utilitario|suv|vehiculo liviano|camion liviano|van|chasis cabina)\b/i.test(
            typeText
        );

    const isHaulOrDumpTruck =
        /\b(camion de extraccion|caex|camion minero|camion articulado|camion tolva|dumper|volquete)\b/i.test(
            typeText
        );

    let defaultCore: EquipmentTypeCoreChapterItem[];
    const defaultConditionals: EquipmentTypeConditionalSubsystemItem[] = [];

    if (isStationaryOrHandTool) {
        defaultCore = [
            {
                chapter_key: 'zona_1_carcasa_guardas_anclaje',
                title_es: 'Inspección Física de Carcasa, Guardas de Partes Rotatorias, Base de Anclaje y Ausencia de Fugas',
                section_es: 'ZONA I — INSPECCIÓN PERIMETRAL, ESTRUCTURA Y ESTANQUEIDAD',
                rationale_es: 'Verificación visual con equipo desconectado: fisuras, pernos de anclaje/soporte, guardas instaladas y ausencia de fugas de aceite/aire.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'zona_2_lineas_suministro_whipcheck_lubricador',
                title_es: 'Líneas de Suministro: Mangueras, Acoples con Cadena Antilatigazo (Whipcheck), Lubricador en Línea y Cables/Puesta a Tierra',
                section_es: 'ZONA II — NIVELES DE FLUIDOS Y LÍNEAS DE SUMINISTRO DE ENERGÍA',
                rationale_es: 'Estado de mangueras y cables, traba de acoples, nivel del lubricador o aceite de cárter y continuidad de puesta a tierra.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'zona_3_organo_trabajo_herramental',
                title_es: 'Órgano de Trabajo y Herramental: Acero de Perforación / Disco / Elemento de Corte, Fijación y Desgaste',
                section_es: 'ZONA III — IMPLEMENTOS Y SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Estado y fijación del elemento de trabajo, retenedores y límites de desgaste antes de energizar.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'zona_4_paradas_emergencia_gatillo',
                title_es: 'Dispositivos de Seguridad: Parada de Emergencia, Gatillo Hombre Muerto, Válvula de Corte y Extintor Asociado',
                section_es: 'ZONA IV — DISPOSITIVOS DE SEGURIDAD CRÍTICA Y SUPRESIÓN',
                rationale_es: 'Funcionamiento de los controles de seguridad derivados de la Matriz de Riesgos, condición BLOQUEANTE si fallan.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'zona_6_prueba_vacio',
                title_es: 'Energización y Prueba Funcional en Vacío: Presión/Voltaje, Ruidos/Vibraciones Anormales y Respuesta de Mandos',
                section_es: 'ZONA VI — PUESTA EN MARCHA Y PRUEBA FUNCIONAL',
                rationale_es: 'Verificación final energizada sin carga antes de iniciar la tarea, con criterio PASA / NO PASA.',
                priority: 'IMPORTANTE',
            },
        ];
    } else if (isLightOrHeavyUtilityVehicle) {
        defaultCore = [
            {
                chapter_key: 'zona_1_perimetro_neumaticos_luces_fugas',
                title_es: 'Nivel de Piso: Neumáticos (Presión/Cortes), Tuercas de Rueda, Suspensión, Luces y Ausencia de Fugas',
                section_es: 'ZONA I — INSPECCIÓN PERIMETRAL, ESTRUCTURA Y ESTANQUEIDAD',
                rationale_es: 'Recorrido 360° con vehículo detenido: estado de rodado, carrocería, luces exteriores y manchas bajo el vehículo.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'zona_2_bajo_capo_niveles_bateria',
                title_es: 'Bajo Capó: Niveles de Aceite Motor, Refrigerante, Líquido de Frenos/Dirección, Correas y Batería',
                section_es: 'ZONA II — NIVELES DE FLUIDOS Y LÍNEAS DE SUMINISTRO DE ENERGÍA',
                rationale_es: 'Verificación con motor frío de niveles entre mínimo y máximo, estado de correas, mangueras y bornes de batería.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'zona_4_equipamiento_minero_extintor_cunas',
                title_es: 'Equipamiento de Seguridad Minera: Extintor Vigente, Cuñas, Pértiga/Baliza, Kit de Emergencia y Estiba de Carga',
                section_es: 'ZONA IV — DISPOSITIVOS DE SEGURIDAD CRÍTICA Y SUPRESIÓN',
                rationale_es: 'Elementos exigidos para circular en faena y barreras derivadas de la Matriz de Riesgos.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'zona_5_cabina_cinturon_espejos_testigos',
                title_es: 'Cabina: Cinturón de Seguridad, Espejos, Parabrisas/Limpiaparabrisas, Testigos de Tablero y Documentación',
                section_es: 'ZONA V — CABINA, INSTRUMENTACIÓN Y VISIBILIDAD',
                rationale_es: 'Condición interior del puesto de conducción y ausencia de testigos rojos/ámbar activos tras el contacto.',
                priority: 'IMPORTANTE',
            },
            {
                chapter_key: 'zona_6_prueba_frenos_direccion_alarma',
                title_es: 'Prueba Funcional: Arranque, Freno de Servicio y Estacionamiento, Dirección, Bocina y Alarma de Retroceso',
                section_es: 'ZONA VI — PUESTA EN MARCHA Y PRUEBA FUNCIONAL',
                rationale_es: 'Verificación dinámica a baja velocidad antes de salir; cualquier falla de frenos o dirección es BLOQUEANTE.',
                priority: 'CRÍTICO',
            },
        ];
        defaultConditionals.push(
            {
                subsystem_key: 'cp_drw_rueda_gemela',
                title_es: 'Inspección de Doble Rodado Trasero (DRW): Presión de Gemelas, Piedras Atrapadas y Torque de Espárragos',
                section_es: 'ZONA III — IMPLEMENTOS Y SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Verificación específica de rueda gemela heredada de la Ficha Técnica y la Matriz de Riesgos.',
                trigger_keywords: ['drw', 'dually', 'doble rodado', 'rueda gemela'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'cp_quinta_rueda_remolque',
                title_es: 'Verificación de Enganche Quinta Rueda / Gooseneck, Traba de Kingpin, Cadenas y Conector de Freno de Remolque',
                section_es: 'ZONA III — IMPLEMENTOS Y SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Chequeo pre-viaje del acople y del controlador de frenos de remolque.',
                trigger_keywords: ['quinta rueda', 'fifth wheel', 'gooseneck', 'remolque', 'trailer', 'enganche'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'cp_pto_cardan',
                title_es: 'Chequeo Pre-Uso de Toma de Fuerza (PTO), Guarda de Cardán y Circuito Hidráulico Auxiliar',
                section_es: 'ZONA III — IMPLEMENTOS Y SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Guarda instalada, ausencia de fugas y desacople verificado antes de circular.',
                trigger_keywords: ['pto', 'toma de fuerza', 'power take-off', 'cardan'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'cp_def_dpf_4x4',
                title_es: 'Verificación de Nivel DEF/AdBlue, Drenaje de Separador Agua/Diésel, Testigo DPF y Acoplamiento 4x4',
                section_es: 'ZONA II — NIVELES DE FLUIDOS Y LÍNEAS DE SUMINISTRO DE ENERGÍA',
                rationale_es: 'Controles del sistema de postratamiento y tracción heredados de la Pauta de Mantención (Etapa II).',
                trigger_keywords: ['def', 'adblue', 'dpf', 'scr', '4x4', 'transferencia', 'separador de agua'],
                activation_rule: 'EVIDENCE_PRESENT',
            }
        );
    } else {
        defaultCore = [
            {
                chapter_key: 'zona_1_perimetro_360_loto',
                title_es: 'Nivel de Piso (360°): Bastidor, Rodado/Orugas, Ausencia de Fugas y Caja de Bloqueo LOTO / Cortacorriente',
                section_es: 'ZONA I — INSPECCIÓN PERIMETRAL, ESTRUCTURA Y ESTANQUEIDAD',
                rationale_es: 'Recorrido inicial con equipo detenido: fisuras estructurales, estado de rodado, fugas y retiro de bloqueos LOTO.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'zona_2_mirillas_fluidos',
                title_es: 'Niveles en Mirillas/Varillas: Aceite Motor, Transmisión/Convertidor, Hidráulico, Refrigerante y Combustible',
                section_es: 'ZONA II — NIVELES DE FLUIDOS Y LÍNEAS DE SUMINISTRO DE ENERGÍA',
                rationale_es: 'Verificación pre-arranque con motor frío alineada a la Etapa II diaria de la Pauta de Mantención.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'zona_3_implemento_organo_trabajo',
                title_es: isHaulOrDumpTruck
                    ? 'Tolva, Pines de Pivote, Almohadillas de Apoyo y Cables de Retención de Tolva'
                    : 'Implemento de Trabajo (Hoja / Balde / Pluma / Herramientas de Corte GET), Pasadores y Desgaste',
                section_es: 'ZONA III — IMPLEMENTOS Y SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Estado del órgano de trabajo y sus pasadores, retenedores y elementos de desgaste confirmados en la Ficha Técnica.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'zona_4_accesos_afex_seguridad',
                title_es: 'Accesos, Escaleras, Pasarelas, Barandas, Sistema de Supresión de Incendios, Extintores y Cámaras/Espejos',
                section_es: 'ZONA IV — DISPOSITIVOS DE SEGURIDAD CRÍTICA Y SUPRESIÓN',
                rationale_es: 'Barreras duras derivadas de la Matriz de Riesgos; cualquier dispositivo inoperativo es BLOQUEANTE.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'zona_5_cabina_rops_instrumentacion',
                title_es: 'Cabina ROPS/FOPS: Cinturón, Asiento, Visibilidad, Consola de Instrumentos y Códigos de Falla Activos',
                section_es: 'ZONA V — CABINA, INSTRUMENTACIÓN Y VISIBILIDAD',
                rationale_es: 'Condición del puesto de comando y ausencia de alarmas activas en el sistema de monitoreo del equipo.',
                priority: 'IMPORTANTE',
            },
            {
                chapter_key: 'zona_6_prueba_frenos_direccion',
                title_es: 'Puesta en Marcha y Prueba Funcional: Freno de Servicio, Secundario y Estacionamiento, Dirección, Retardo y Alarmas',
                section_es: 'ZONA VI — PUESTA EN MARCHA Y PRUEBA FUNCIONAL',
                rationale_es: 'Verificación dinámica final según la Fase II del Manual de Operaciones, con criterio PASA / NO PASA BLOQUEANTE.',
                priority: 'CRÍTICO',
            },
        ];
        defaultConditionals.push(
            {
                subsystem_key: 'cp_neumaticos_gigantes',
                title_es: 'Inspección de Neumáticos Gigantes: Cortes en Banda/Flanco, Presión, Clamps/Pernos y Rocas Atrapadas',
                section_es: 'ZONA I — INSPECCIÓN PERIMETRAL, ESTRUCTURA Y ESTANQUEIDAD',
                rationale_es: 'Verificación visual de neumáticos OTR heredada de la Matriz de Riesgos (piroforicidad/explosión).',
                trigger_keywords: ['neumatico gigante', 'otr', 'r63', 'r57', 'r51', 'neumaticos'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'cp_suspension_acumuladores',
                title_es: 'Verificación de Cilindros de Suspensión Hidroneumáticos (Altura de Carga) y Precarga de Acumuladores',
                section_es: 'ZONA III — IMPLEMENTOS Y SUBSISTEMAS ESPECIALIZADOS',
                rationale_es: 'Altura de cilindros y presión de acumuladores de frenos/dirección según criterio OEM.',
                trigger_keywords: ['suspension hidroneumatica', 'acumulador', 'iso 3450', 'nitrogeno'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'cp_autolube_rax',
                title_es: 'Chequeo del Depósito de Engrase Automático, Líneas de Distribución y Circuito de Enfriamiento de Ejes',
                section_es: 'ZONA II — NIVELES DE FLUIDOS Y LÍNEAS DE SUMINISTRO DE ENERGÍA',
                rationale_es: 'Nivel de grasa, ausencia de líneas cortadas e indicadores del sistema de enfriamiento de ejes.',
                trigger_keywords: ['autolube', 'engrase automatico', 'rax', 'enfriamiento de ejes'],
                activation_rule: 'EVIDENCE_PRESENT',
            },
            {
                subsystem_key: 'cp_tren_rodaje_orugas',
                title_es: 'Tren de Rodaje: Tensión de Orugas, Zapatas, Rodillos, Rueda Guía y Corona de Giro',
                section_es: 'ZONA I — INSPECCIÓN PERIMETRAL, ESTRUCTURA Y ESTANQUEIDAD',
                rationale_es: 'Inspección visual de componentes de rodaje de oruga y tornamesa antes de traslado.',
                trigger_keywords: ['orugas', 'tren de rodaje', 'tornamesa', 'swing', 'zapatas'],
                activation_rule: 'EVIDENCE_PRESENT',
            }
        );
    }

    const mergedCore =
        existing?.core_chapters && existing.core_chapters.length >= 4
            ? existing.core_chapters
            : defaultCore;

    const condByKey = new Map<string, EquipmentTypeConditionalSubsystemItem>();
    for (const c of defaultConditionals) {
        condByKey.set(c.subsystem_key, c);
    }
    for (const c of existing?.conditional_subsystems || []) {
        if (c?.subsystem_key && c?.title_es) {
            condByKey.set(c.subsystem_key, c);
        }
    }

    return {
        core_chapters: mergedCore,
        conditional_subsystems: Array.from(condByKey.values()),
        updated_at: existing?.updated_at || new Date().toISOString(),
    };
}

/**
 * Aprendizaje Ascendente Sin Techo para `checklist_pre_op`:
 * Incorpora zonas de verificación de subsistemas especializados descubiertas en modelos complejos al Anillo 2
 * sin alterar el recorrido basal del Anillo 1.
 */
export async function evolveEquipmentTypeChecklistPreOpBlueprint(params: {
    typeKey: string;
    modelOficial: string;
    discoveredSubsystems: Array<{
        title_es: string;
        section_es: string;
        rationale_es: string;
        trigger_keywords?: string[];
    }>;
}): Promise<void> {
    const cleanKey = normalizeEquipmentTypeKey(params.typeKey);
    if (!cleanKey || !Array.isArray(params.discoveredSubsystems) || params.discoveredSubsystems.length === 0) {
        return;
    }

    try {
        const docRef = db.collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION).doc(cleanKey);
        const snap = await docRef.get();
        if (!snap.exists) return;

        const typeDoc = snap.data() as GlobalEquipmentTypeDoc;
        const currentBlueprint = resolveElasticChecklistPreOpBlueprint(typeDoc);
        const existingSubsystems = [...currentBlueprint.conditional_subsystems];
        const nowIso = new Date().toISOString();

        let addedCount = 0;
        for (const sub of params.discoveredSubsystems) {
            const subSlug = normalizeEquipmentTypeKey(sub.title_es).slice(0, 64);
            if (!subSlug || subSlug.length < 4) continue;

            const alreadyExists =
                currentBlueprint.core_chapters.some(
                    (c) => normalizeEquipmentTypeKey(c.title_es) === subSlug
                ) ||
                existingSubsystems.some(
                    (s) =>
                        s.subsystem_key === subSlug ||
                        normalizeEquipmentTypeKey(s.title_es) === subSlug
                );

            if (alreadyExists) continue;

            const autoKeywords = Array.from(
                new Set(
                    [
                        ...(sub.trigger_keywords || []),
                        ...normalizeEquipmentTypeAlias(sub.title_es)
                            .split(' ')
                            .filter((w) => w.length >= 4 && !TYPE_STOPWORDS.has(w)),
                    ].slice(0, 8)
                )
            );

            existingSubsystems.push({
                subsystem_key: subSlug,
                title_es: sub.title_es.trim(),
                section_es: (sub.section_es || 'ZONA III — IMPLEMENTOS Y SUBSISTEMAS ESPECIALIZADOS').trim().toUpperCase(),
                rationale_es: sub.rationale_es.trim(),
                trigger_keywords: autoKeywords,
                activation_rule: 'EVIDENCE_PRESENT',
                discovered_from_model: params.modelOficial,
                discovered_at: nowIso,
            });
            addedCount++;
        }

        if (addedCount > 0) {
            const updatedBlueprint: EquipmentTypePillarBlueprint = {
                core_chapters: currentBlueprint.core_chapters,
                conditional_subsystems: existingSubsystems.slice(0, 30),
                updated_at: nowIso,
            };

            await docRef.set(
                {
                    pillar_blueprints: {
                        ...(typeDoc.pillar_blueprints || {}),
                        checklist_pre_op: updatedBlueprint,
                    },
                    updated_at: nowIso,
                },
                { merge: true }
            );

            const cached = memoryByTypeKey.get(cleanKey);
            if (cached) {
                cached.doc = {
                    ...cached.doc,
                    pillar_blueprints: {
                        ...(cached.doc.pillar_blueprints || {}),
                        checklist_pre_op: updatedBlueprint,
                    },
                    updated_at: nowIso,
                };
            }
        }
    } catch (err: any) {
        console.warn('[EquipmentTypeRegistry] No se pudo evolucionar checklist_pre_op:', err?.message);
    }
}



