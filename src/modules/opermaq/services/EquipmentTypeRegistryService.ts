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
    PillarId,
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
import { AssetOntologyEngine } from './AssetOntologyEngine';
import { verifyAndNormalizeTechnicalUnits } from './NeuroSymbolicVerifier';

/**
 * EQUIPMENT TYPE REGISTRY SERVICE v3.0 (Ontología Universal Zero-Code por Rasgos — OPERMAQ)
 */

export const GLOBAL_EQUIPMENT_TYPES_COLLECTION = 'global_equipment_types';
export const EQUIPMENT_TYPE_SCHEMA_VERSION = 7;
const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000;

export function buildDedicatedConsumptionCoreChapter(
    typeDoc: Pick<
        GlobalEquipmentTypeDoc,
        'type_key' | 'canonical_type_es' | 'categoria_equipo' | 'archetype_id' | 'physical_traits'
    >
): EquipmentTypeCoreChapterItem {
    const traits = AssetOntologyEngine.inferAssetPhysicalTraits({
        type_key: typeDoc.type_key,
        canonical_type_es: typeDoc.canonical_type_es,
        categoria_equipo: typeDoc.categoria_equipo,
        archetype_id: typeDoc.archetype_id,
        existing_traits: typeDoc.physical_traits,
    });
    return AssetOntologyEngine.buildConsumptionCoreChapter(traits);
}

export function buildDedicatedCapexCoreChapter(
    _typeDoc?: Pick<GlobalEquipmentTypeDoc, 'type_key' | 'canonical_type_es' | 'categoria_equipo' | 'archetype_id'>
): EquipmentTypeCoreChapterItem {
    return {
        chapter_key: 'valorizacion_capex_vida_economica_y_depreciacion',
        title_es: 'Valorización Referencial (CAPEX), Vida Económica y Base de Depreciación',
        section_es: 'VALORIZACIÓN PATRIMONIAL Y VIDA ECONÓMICA',
        rationale_es:
            'Detalla el costo referencial de reposición como equipo nuevo (CAPEX OEM en USD/CLP, condición comercial FOB/Dealer y año de referencia), vida útil económica nominal antes de overhaul mayor o retiro (en horas h, kilómetros km, ciclos o años), porcentaje de valor residual referencial (%), base de depreciación lineal y dotación de fábrica para modelos TCO.',
        priority: 'CRÍTICO',
    };
}

export function buildDedicatedWearAndRodadoCoreChapter(
    typeDoc: Pick<
        GlobalEquipmentTypeDoc,
        'type_key' | 'canonical_type_es' | 'categoria_equipo' | 'archetype_id' | 'physical_traits'
    >
): EquipmentTypeCoreChapterItem {
    const traits = AssetOntologyEngine.inferAssetPhysicalTraits({
        type_key: typeDoc.type_key,
        canonical_type_es: typeDoc.canonical_type_es,
        categoria_equipo: typeDoc.categoria_equipo,
        archetype_id: typeDoc.archetype_id,
        existing_traits: typeDoc.physical_traits,
    });
    return AssetOntologyEngine.buildWearAndSupportCoreChapter(traits, typeDoc.canonical_type_es);
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

    const inferredTraits = AssetOntologyEngine.inferAssetPhysicalTraits({
        type_key: doc.type_key,
        canonical_type_es: doc.canonical_type_es,
        categoria_equipo: doc.categoria_equipo,
        archetype_id: doc.archetype_id,
        spec_schema: existingAxes,
        existing_traits: doc.physical_traits,
    });
    const costSchemaBlueprint = AssetOntologyEngine.buildDynamicCostMatrixTaxonomy(
        inferredTraits,
        doc.canonical_type_es
    );

    const expectedConsumptionChapter = AssetOntologyEngine.buildConsumptionCoreChapter(inferredTraits);
    const expectedWearChapter = AssetOntologyEngine.buildWearAndSupportCoreChapter(
        inferredTraits,
        doc.canonical_type_es
    );

    const existingFichaCore = doc.pillar_blueprints?.ficha_tecnica?.core_chapters;
    const hasDedicatedConsumptionChapter =
        !Array.isArray(existingFichaCore) ||
        existingFichaCore.some(
            (c) =>
                c.chapter_key === 'matriz_energetica_consumos_y_autonomia' &&
                c.title_es === expectedConsumptionChapter.title_es
        );
    const hasDedicatedCapexChapter =
        !Array.isArray(existingFichaCore) ||
        existingFichaCore.some(
            (c) => c.chapter_key === 'valorizacion_capex_vida_economica_y_depreciacion'
        );

    const existingPmCore = doc.pillar_blueprints?.pauta_mantencion?.core_chapters;
    const hasDedicatedWearRodadoChapter =
        !Array.isArray(existingPmCore) ||
        existingPmCore.some(
            (c) =>
                c.chapter_key === 'etapa_5_recambio_elementos_desgaste_get_y_rodado' &&
                c.title_es === expectedWearChapter.title_es
        );

    const needsUpgrade =
        (doc.schema_version ?? 1) < EQUIPMENT_TYPE_SCHEMA_VERSION ||
        !doc.physical_traits ||
        !doc.cost_schema_blueprint ||
        !hasEnergySource ||
        !hasConsumption ||
        !hasCapacity ||
        !hasDedicatedConsumptionChapter ||
        !hasDedicatedCapexChapter ||
        !hasDedicatedWearRodadoChapter;

    if (!needsUpgrade) {
        return { doc, modified: false };
    }

    const typeContextText = `${doc.type_key} ${doc.canonical_type_es} ${doc.categoria_equipo || ''}`;
    const upgradedSchema = ensureUniversalEnergyAxesInSpecSchema([...existingAxes], typeContextText);

    const upgradedDoc: GlobalEquipmentTypeDoc = {
        ...doc,
        physical_traits: inferredTraits,
        cost_schema_blueprint: costSchemaBlueprint,
        spec_schema: upgradedSchema,
        schema_version: EQUIPMENT_TYPE_SCHEMA_VERSION,
        updated_at: new Date().toISOString(),
    };

    if (upgradedDoc.pillar_blueprints) {
        const nextBlueprints: Partial<Record<PillarId, EquipmentTypePillarBlueprint>> = {
            ...upgradedDoc.pillar_blueprints,
        };
        if (nextBlueprints.ficha_tecnica) {
            nextBlueprints.ficha_tecnica = resolveElasticFichaTecnicaBlueprint(upgradedDoc);
        }
        if (nextBlueprints.manual_operaciones) {
            nextBlueprints.manual_operaciones = resolveElasticManualOperacionesBlueprint(upgradedDoc);
        }
        if (nextBlueprints.pauta_mantencion) {
            nextBlueprints.pauta_mantencion = resolveElasticPautaMantencionBlueprint(upgradedDoc);
        }
        if (nextBlueprints.matriz_riesgos) {
            nextBlueprints.matriz_riesgos = resolveElasticMatrizRiesgosBlueprint(upgradedDoc);
        }
        if (nextBlueprints.checklist_pre_op) {
            nextBlueprints.checklist_pre_op = resolveElasticChecklistPreOpBlueprint(upgradedDoc);
        }
        upgradedDoc.pillar_blueprints = nextBlueprints;
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
    /\b(kg|t\b|g\b|ton|kw|w\b|mw|hp|cv|kva|va\b|v\b|kv|a\b|ah|mah|wh|kwh|mwh|hz|khz|mhz|ghz|m³|m3|cm³|cm3|cc|l\b|ml|mm|cm|m\b|km|in\b|m²|m2|l\/s|l\/min|l\/h|m³\/min|m3\/min|m³\/h|m3\/h|t\/h|g\/t|kwh\/t|m\.c\.a\.|mca|cfm|gpm|bar|mbar|pa\b|kpa|mpa|psi|kn|n·m|nm|ft·lbf|t·m|kn·m|kgf|j\b|kj|bpm|rpm|km\/h|m\/s|lm\b|lux|cd\b|mpx|px|ppm|pts\/s|db|dba|dbm|ciclos|vuelos|min\b|h\b|°c|°|%)\b/i;

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
    const physicalTraits = AssetOntologyEngine.inferAssetPhysicalTraits({
        type_key: bp.type_key,
        canonical_type_es: bp.canonical_type_es,
        categoria_equipo: bp.categoria_equipo,
        archetype_id: bp.archetype_id,
        spec_schema: enrichedSchema,
    });
    const costSchemaBlueprint = AssetOntologyEngine.buildDynamicCostMatrixTaxonomy(
        physicalTraits,
        bp.canonical_type_es
    );
    return {
        type_key: bp.type_key,
        canonical_type_es: bp.canonical_type_es,
        categoria_equipo: bp.categoria_equipo,
        archetype_id: bp.archetype_id,
        physical_traits: physicalTraits,
        cost_schema_blueprint: costSchemaBlueprint,
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
    const physicalTraits = AssetOntologyEngine.inferAssetPhysicalTraits({
        type_key: doc.type_key,
        canonical_type_es: doc.canonical_type_es,
        categoria_equipo: doc.categoria_equipo,
        archetype_id: doc.archetype_id,
        spec_schema: enrichedSchema,
        existing_traits: doc.physical_traits,
    });
    const costSchemaBlueprint = AssetOntologyEngine.buildDynamicCostMatrixTaxonomy(
        physicalTraits,
        doc.canonical_type_es
    );

    const finalDoc: GlobalEquipmentTypeDoc = {
        ...doc,
        physical_traits: physicalTraits,
        cost_schema_blueprint: costSchemaBlueprint,
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
 * Resolución Composicional Universal en 2 Anillos (`OPERMAQ v3.0` — `AssetOntologyEngine`):
 * - Anillo 1 (`core_chapters`): Capítulos basales derivados ortogonalmente de los rasgos físicos del activo
 *   (cero fallbacks de excavadora, cero diésel/AdBlue en equipos eléctricos/hidráulicos/batería).
 * - Anillo 2 (`conditional_subsystems`): Catálogo evolutivo por evidencia (`activation_rule: 'EVIDENCE_PRESENT'`).
 */
export function resolveElasticPillarBlueprint(
    pillarId: PillarId,
    typeDoc: GlobalEquipmentTypeDoc
): EquipmentTypePillarBlueprint {
    const compositional = AssetOntologyEngine.buildCompositionalPillarBlueprint(pillarId, typeDoc);
    const existing = typeDoc.pillar_blueprints?.[pillarId];

    let mergedCore = compositional.core_chapters;
    if (typeDoc.is_human_locked && Array.isArray(existing?.core_chapters) && existing.core_chapters.length >= 3) {
        const byKey = new Map<string, EquipmentTypeCoreChapterItem>(
            existing.core_chapters.map((c) => [c.chapter_key, c])
        );
        for (const compChapter of compositional.core_chapters) {
            if (
                compChapter.chapter_key === 'matriz_energetica_consumos_y_autonomia' ||
                compChapter.chapter_key === 'valorizacion_capex_vida_economica_y_depreciacion' ||
                compChapter.chapter_key === 'etapa_5_recambio_elementos_desgaste_get_y_rodado' ||
                !byKey.has(compChapter.chapter_key)
            ) {
                byKey.set(compChapter.chapter_key, compChapter);
            }
        }
        mergedCore = Array.from(byKey.values());
    }

    const condByKey = new Map<string, EquipmentTypeConditionalSubsystemItem>();
    for (const c of compositional.conditional_subsystems) {
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

export async function evolveEquipmentTypePillarBlueprint(
    pillarId: PillarId,
    params: {
        typeKey: string;
        modelOficial: string;
        discoveredSubsystems: Array<{
            title_es: string;
            section_es: string;
            rationale_es: string;
            trigger_keywords?: string[];
        }>;
    }
): Promise<void> {
    const cleanKey = normalizeEquipmentTypeKey(params.typeKey);
    if (!cleanKey || !Array.isArray(params.discoveredSubsystems) || params.discoveredSubsystems.length === 0) {
        return;
    }

    try {
        const docRef = db.collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION).doc(cleanKey);
        const snap = await docRef.get();
        if (!snap.exists) return;

        const typeDoc = snap.data() as GlobalEquipmentTypeDoc;
        const currentBlueprint = resolveElasticPillarBlueprint(pillarId, typeDoc);
        const existingSubsystems = [...currentBlueprint.conditional_subsystems];
        const nowIso = new Date().toISOString();

        let addedCount = 0;
        for (const sub of params.discoveredSubsystems) {
            const subSlug = normalizeEquipmentTypeKey(sub.title_es).slice(0, 64);
            if (!subSlug || subSlug.length < 4) continue;

            const alreadyExists =
                currentBlueprint.core_chapters.some((c) => normalizeEquipmentTypeKey(c.title_es) === subSlug) ||
                existingSubsystems.some(
                    (s) => s.subsystem_key === subSlug || normalizeEquipmentTypeKey(s.title_es) === subSlug
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
                        [pillarId]: updatedBlueprint,
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
                        [pillarId]: updatedBlueprint,
                    },
                    updated_at: nowIso,
                };
            }
        }
    } catch (err: any) {
        console.warn(`[EquipmentTypeRegistry] No se pudo evolucionar ${pillarId}:`, err?.message);
    }
}

export function resolveElasticFichaTecnicaBlueprint(typeDoc: GlobalEquipmentTypeDoc): EquipmentTypePillarBlueprint {
    return resolveElasticPillarBlueprint('ficha_tecnica', typeDoc);
}

export function resolveElasticManualOperacionesBlueprint(typeDoc: GlobalEquipmentTypeDoc): EquipmentTypePillarBlueprint {
    return resolveElasticPillarBlueprint('manual_operaciones', typeDoc);
}

export function resolveElasticPautaMantencionBlueprint(typeDoc: GlobalEquipmentTypeDoc): EquipmentTypePillarBlueprint {
    return resolveElasticPillarBlueprint('pauta_mantencion', typeDoc);
}

export function resolveElasticMatrizRiesgosBlueprint(typeDoc: GlobalEquipmentTypeDoc): EquipmentTypePillarBlueprint {
    return resolveElasticPillarBlueprint('matriz_riesgos', typeDoc);
}

export function resolveElasticChecklistPreOpBlueprint(typeDoc: GlobalEquipmentTypeDoc): EquipmentTypePillarBlueprint {
    return resolveElasticPillarBlueprint('checklist_pre_op', typeDoc);
}

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
    return evolveEquipmentTypePillarBlueprint('ficha_tecnica', params);
}

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
    return evolveEquipmentTypePillarBlueprint('manual_operaciones', params);
}

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
    return evolveEquipmentTypePillarBlueprint('pauta_mantencion', params);
}

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
    return evolveEquipmentTypePillarBlueprint('matriz_riesgos', params);
}

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
    return evolveEquipmentTypePillarBlueprint('checklist_pre_op', params);
}
