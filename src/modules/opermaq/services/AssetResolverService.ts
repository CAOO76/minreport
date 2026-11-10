import { createHash } from 'crypto';
import { db } from '../../../config/firebase';
import { ResilientAIClient, Type } from '../../../core/resilient-ai-client';
import type { GlobalEquipmentTypeDoc, ResolvedAssetCandidate } from '../types/vault.types';
import { AssetOntologyEngine } from './AssetOntologyEngine';
import { getCachedMasterSymbologyIndex } from './SymbologyService';
import {
    detectDeterministicEquipmentTypeFromBrandAndModel,
    extractHomologousAxisValues,
    hasSelfDescribingTypeSchema,
    sanitizeDesignAndWorkContextItems,
    serializeCanonicalSlotsToSpecsArray,
} from '../utils/canonicalArchetypeSpecs';
import { DomainRejectionError, normalizeCatalogKey, validateIndustrialDomain } from '../utils/domainGuard';
import {
    BRAND_SYNONYM_TO_OFFICIAL,
    collapseSpacedModelDesignators,
    extractCanonicalDesignator,
    isNonModelAttributeToken,
    normalizeModelCode,
    readCollaborativeLineage,
    resolveFromLocalCommonsCatalog,
    saveCollaborativeLineage,
    stripTemporalAndHistoricalNoise,
} from './CanonicalEntityResolver';
import { enrichCatalogProfile } from './CatalogProfileEnricher';
import { buildAndPersistAssetSymbologyPack } from './EquipmentSymbologyPackBuilder';
import {
    buildVerifiedSlotsForEquipmentType,
    detectExplicitTypeFromQueryText,
    normalizeEquipmentTypeKey,
    resolveOrLearnEquipmentType,
} from './EquipmentTypeRegistryService';

/**
 * ASSET RESOLVER SERVICE v8.0 — ONTOLOGÍA DINÁMICA `TIPO`-FIRST + 2 PASADAS GROUNDED
 *
 * Secuencia Operativa Soberana (Etapa 1 — 100% Independiente de los 5 Pilares):
 * 1º Detectar el `TIPO` canónico del equipo/vehículo/herramienta buscado (ej. `MOTONIVELADORA`,
 *    `CAMIONETA PICK-UP`, `COMPRESOR DE AIRE`, `PERFORADORA NEUMÁTICA MANUAL`, `CHANCADOR DE MANDÍBULAS`).
 * 2º Resolver en `< 10 ms` desde `global_equipment_types/{typeKey}` (o sintetizar y aprender a `Temp: 0`
 *    la primera vez si es un `TIPO` inédito) cuáles son sus 3–5 características principales y diferenciadoras
 *    exclusivas (cero parámetros cruzados irrelevantes entre clases distintas).
 * 3º Ejecutar Pasada 1 Grounded (`useGoogleSearch: true` + `requireGroundedEvidence: true` en prosa técnica
 *    natural) buscando en fichas OEM exclusivamente las variantes reales y los parámetros exactos de ese `TIPO`.
 * 4º Ejecutar Pasada 2 Determinista (`Temperature: 0`, `responseSchema`) para extraer los slots auto-descriptivos
 *    verificados con unidad SI y URL comprobada.
 */

export interface DetectedEquipmentTypeMetadata {
    type_key: string;
    canonical_type_es: string;
    reused_existing_schema: boolean;
    resolution_source: string;
    type_resolution_latency_ms: number;
    spec_axes: string[];
}

export interface AssetResolutionResponse {
    requires_clarification?: boolean;
    clarification_message?: string;
    candidates: ResolvedAssetCandidate[];
    resolved_from_commons?: boolean;
    resolution_tier?: 'TIER_0_EXACT' | 'TIER_1_HYBRID_RRF' | 'TIER_2_WEB_DISCOVERY';
    resolution_latency_ms?: number;
    detected_equipment_type?: DetectedEquipmentTypeMetadata;
}

export function detectModelDesignator(input: string): string | null {
    const collapsed = collapseSpacedModelDesignators(input.trim());
    const canonical = extractCanonicalDesignator(collapsed);
    if (canonical && !isNonModelAttributeToken(canonical)) {
        return canonical;
    }

    const regex =
        /\b([A-Za-z]{0,6}\d{2,5}[A-Za-z0-9-]{0,6}|[A-Za-z]{1,4}-?\d{1,5}[A-Za-z0-9-]{0,6}|\d{1,5}[A-Za-z]{1,4}\d{0,3})\b/g;
    for (const match of collapsed.matchAll(regex)) {
        const candidate = match[1].toUpperCase();
        if (isNonModelAttributeToken(candidate)) continue;
        return candidate;
    }
    return null;
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) return [];
    const results = new Array<R>(items.length);
    let cursor = 0;
    const workerCount = Math.min(Math.max(1, concurrency), items.length);

    const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
            const currentIndex = cursor++;
            if (currentIndex >= items.length) break;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    });

    await Promise.all(workers);
    return results;
}

const STEP1_PRIMARY_TYPE_DETECTION_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        is_pertinent: {
            type: Type.BOOLEAN,
            description:
                'true para CUALQUIER vehículo (automóvil, pick-up, SUV, furgón, bus, camión, tractocamión, motocicleta, ATV/UTV, embarcación, aeronave), maquinaria (minera, construcción, agrícola, forestal, industrial), planta, compresor, generador, bomba, chancador, grúa, equipo, herramienta o instrumento. Solo false para artículos domésticos/personales ajenos (ej. cafetera, perfume, consola de videojuegos).',
        },
        rejection_reason: {
            type: Type.STRING,
            nullable: true,
        },
        requires_clarification: {
            type: Type.BOOLEAN,
            description:
                'true únicamente si el usuario escribió solo una marca aislada sin modelo ni tipo (ej. solo "Toyota" o solo "Caterpillar") o una palabra genérica extrema ("máquina", "vehículo", "herramienta").',
        },
        clarification_message: {
            type: Type.STRING,
            nullable: true,
        },
        corrected_make: {
            type: Type.STRING,
            description:
                'Marca oficial corregida ortográfica y fonéticamente en MAYÚSCULAS (ej. "PEUGUEOT" -> "PEUGEOT", "CAT" -> "CATERPILLAR", "KOMATZU" -> "KOMATSU", o "GENÉRICO" si no hay marca o es búsqueda genérica).',
        },
        corrected_model_or_family: {
            type: Type.STRING,
            description:
                'Código de modelo, serie o familia limpio y corregido sin años (ej. "LANDTRECK 4X4 2022" -> "LANDTREK", "140 M" -> "140M", "GD655", "XAS 185", "YT27", "C120").',
        },
        detected_tipo_equipo: {
            type: Type.STRING,
            description:
                'Nombre canónico singular en español MAYÚSCULAS del TIPO exacto de equipo sin marca ni modelo (ej. "MOTONIVELADORA", "BULLDOZER SOBRE ORUGAS", "MINICARGADOR SOBRE NEUMÁTICOS", "EXCAVADORA HIDRÁULICA", "CAMIONETA PICK-UP", "COMPRESOR DE AIRE", "PERFORADORA NEUMÁTICA MANUAL", "CHANCADOR DE MANDÍBULAS", "MANIPULADOR TELESCÓPICO"). Prohibido usar etiquetas vagas como "MAQUINARIA PESADA" o "EQUIPO INDUSTRIAL".',
        },
        detected_categoria_equipo: {
            type: Type.STRING,
            description:
                'Categoría funcional técnica en MAYÚSCULAS (ej. "MOVIMIENTO DE TIERRA Y NIVELACIÓN", "TRANSPORTE Y VEHÍCULOS LIVIANOS", "ENERGÍA Y AIRE COMPRIMIDO", "PERFORACIÓN Y SONDAJE", "CONMINUCIÓN Y CHANCADO", "IZAJE Y MANEJO DE CARGAS").',
        },
        needs_web_to_identify_type: {
            type: Type.BOOLEAN,
            description:
                'true únicamente si el código de modelo es poco conocido y no tienes certeza absoluta de qué TIPO de máquina o vehículo es sin consultar antes Google Search.',
        },
    },
    required: [
        'is_pertinent',
        'rejection_reason',
        'requires_clarification',
        'clarification_message',
        'corrected_make',
        'corrected_model_or_family',
        'detected_tipo_equipo',
        'detected_categoria_equipo',
        'needs_web_to_identify_type',
    ],
};

const PASS2_TYPE_SCOPED_CANDIDATE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        is_pertinent: {
            type: Type.BOOLEAN,
        },
        rejection_reason: {
            type: Type.STRING,
            nullable: true,
        },
        requires_clarification: {
            type: Type.BOOLEAN,
        },
        clarification_message: {
            type: Type.STRING,
            nullable: true,
        },
        actual_tipo_equipo_if_different: {
            type: Type.STRING,
            nullable: true,
            description:
                'Rellena solo si las fichas técnicas web demostraron que el activo NO es del TIPO preliminar indicado, especificando su TIPO real exacto en español singular; en caso contrario devuelve null.',
        },
        candidates: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    make_oficial: {
                        type: Type.STRING,
                        description:
                            'Marca oficial corregida en MAYÚSCULAS (ej. "CATERPILLAR", "KOMATSU", "PEUGEOT", "ATLAS COPCO", "METSO", o "GENÉRICO" en modo genérico).',
                    },
                    model_oficial: {
                        type: Type.STRING,
                        description:
                            'Modelo, serie o versión comercial oficial limpia en MAYÚSCULAS SIN AÑOS NI RANGOS DE FECHAS (ej. "140M", "140M2", "140M3", "GD655-5", "LANDTREK ACTIVE 1.9D 4X4", "LANDTREK ACTION 1.9D 4X4", "LANDTREK 4ACTION 1.9D 4X4", "XAS 185", "C120"). Prohibido incluir "(desde 2020 a la actualidad)", "(2020-presente)" o años.',
                    },
                    ambiente_operativo: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description:
                            'CONDICIONES DE DISEÑO (2 a 4 viñetas técnicas concretas verificadas en la fuente OEM): certificaciones estructurales (ej. ROPS ISO 3471 / FOPS ISO 3449), régimen hidromecánico/térmico/altitud (ej. circuito auxiliar XHP 150 L/min @ 280 bar, enfriamiento de alta temperatura) y configuración de rodaje/terreno admisible. Prohibido usar palabras sueltas genéricas como "Superficie" o "Terreno".',
                    },
                    contexto_operativo: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description:
                            'CONTEXTO Y TRABAJO (2 a 4 viñetas técnicas concretas verificadas en la fuente OEM): aplicaciones operativas reales en minería, construcción o industria y familia de herramientas/implementos de trabajo compatibles. Prohibido usar frases vacías como "Operación Técnica" u "Operación Industrial".',
                    },
                    extracted_axes: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                axis_key: {
                                    type: Type.STRING,
                                    description: 'Clave exacta del eje según el esquema oficial del TIPO.',
                                },
                                value_si: {
                                    type: Type.STRING,
                                    nullable: true,
                                    description:
                                        'Magnitud física comprobada en unidad métrica SI (ej. "136 kW (183 HP)", "3.700 mm", "5,2 m³/min", "7 bar", "1.020 kg", "4x4") o null si NO consta en el informe verificado.',
                                },
                                source_url: {
                                    type: Type.STRING,
                                    nullable: true,
                                    description:
                                        'URL exacta tomada de FUENTES WEB VERIFICADAS DISPONIBLES que respalda esta cifra, o null.',
                                },
                                verbatim_evidence: {
                                    type: Type.STRING,
                                    nullable: true,
                                    description:
                                        'Cita breve literal del informe verificado de donde se extrajo el dato, o null.',
                                },
                            },
                            required: ['axis_key', 'value_si', 'source_url', 'verbatim_evidence'],
                        },
                    },
                    versions: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description:
                            'Todas las versiones, motorizaciones, configuraciones de tren motriz o sub-variantes reales verificadas en la evidencia.',
                    },
                    official_url: {
                        type: Type.STRING,
                        nullable: true,
                        description:
                            'URL exacta tomada de FUENTES WEB VERIFICADAS DISPONIBLES, o null si no aplica.',
                    },
                },
                required: [
                    'make_oficial',
                    'model_oficial',
                    'ambiente_operativo',
                    'contexto_operativo',
                    'extracted_axes',
                    'versions',
                    'official_url',
                ],
            },
        },
    },
    required: [
        'is_pertinent',
        'rejection_reason',
        'requires_clarification',
        'clarification_message',
        'actual_tipo_equipo_if_different',
        'candidates',
    ],
};

function isVagueDetectedType(raw?: string | null): boolean {
    if (!raw) return true;
    const norm = raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    return (
        norm.length < 3 ||
        norm === 'maquinaria' ||
        norm === 'maquinaria pesada' ||
        norm === 'maquinaria industrial' ||
        norm === 'equipo' ||
        norm === 'equipo industrial' ||
        norm === 'equipo pesado' ||
        norm === 'vehiculo' ||
        norm === 'herramienta'
    );
}

export interface QueryTechnicalConstraints {
    requestedYear: number | null;
    requestedTraction: string | null;
    requestedFuel: 'DIESEL' | 'GASOLINA' | 'ELECTRICO' | 'HIBRIDO' | null;
    requestedDisplacement: string | null;
    clarificationText: string | null;
    hasExplicitConstraints: boolean;
}

export function extractQueryTechnicalConstraints(
    rawInput: string,
    clarificationContext?: string
): QueryTechnicalConstraints {
    const combined = `${rawInput || ''} ${clarificationContext || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();

    const yearMatch = combined.match(/\b(19[6-9]\d|20[0-3]\d)\b/);
    const requestedYear = yearMatch ? Number.parseInt(yearMatch[1], 10) : null;

    const tractionMatch = combined.match(/\b(4X4|4X2|6X4|6X6|8X4|AWD|4WD|2WD)\b/);
    let requestedTraction = tractionMatch ? tractionMatch[1] : null;
    if (requestedTraction === '4WD') requestedTraction = '4X4';
    if (requestedTraction === '2WD') requestedTraction = '4X2';

    let requestedFuel: QueryTechnicalConstraints['requestedFuel'] = null;
    if (/\b(DIESEL|TURBODIESEL|HDI|TDI|BLUEHDI|CRDI|DID)\b/.test(combined)) {
        requestedFuel = 'DIESEL';
    } else if (/\b(GASOLINA|BENCINA|BENCINERA|NAFTA|THP|TSI|ECOBOOST)\b/.test(combined)) {
        requestedFuel = 'GASOLINA';
    } else if (/\b(ELECTRICO|ELECTRICA|EV|BEV)\b/.test(combined)) {
        requestedFuel = 'ELECTRICO';
    } else if (/\b(HIBRIDO|HIBRIDA|HEV|PHEV)\b/.test(combined)) {
        requestedFuel = 'HIBRIDO';
    }

    const dispMatch = combined.match(/\b(\d[.,]\d)\s*(?:L|LITROS?|D|HDI|TDI|THP)?\b/);
    const requestedDisplacement = dispMatch ? `${dispMatch[1].replace(',', '.')}L` : null;

    const clarificationText = clarificationContext?.trim() ? clarificationContext.trim() : null;
    const hasExplicitConstraints = Boolean(
        requestedYear || requestedTraction || requestedFuel || requestedDisplacement || clarificationText
    );

    return {
        requestedYear,
        requestedTraction,
        requestedFuel,
        requestedDisplacement,
        clarificationText,
        hasExplicitConstraints,
    };
}

function formatConstraintsDirective(constraints: QueryTechnicalConstraints): string {
    if (!constraints.hasExplicitConstraints) return '';
    const rules: string[] = [];
    if (constraints.requestedFuel === 'DIESEL') {
        rules.push(
            '- MOTORIZACIÓN OBLIGATORIA: DIÉSEL / TURBODIÉSEL. Queda ESTRICTAMENTE PROHIBIDO incluir versiones a Gasolina / Bencina / Nafta / THP.'
        );
    } else if (constraints.requestedFuel === 'GASOLINA') {
        rules.push(
            '- MOTORIZACIÓN OBLIGATORIA: GASOLINA / BENCINA. Queda ESTRICTAMENTE PROHIBIDO incluir versiones Diésel.'
        );
    }
    if (constraints.requestedTraction) {
        rules.push(
            `- TRACCIÓN OBLIGATORIA: ${constraints.requestedTraction}. Queda ESTRICTAMENTE PROHIBIDO incluir configuraciones de tracción distinta (ej. si pidió 4X4, excluye 4X2/2WD).`
        );
    }
    if (constraints.requestedYear) {
        rules.push(
            `- AÑO DE REFERENCIA TÉCNICA: ${constraints.requestedYear}. Incluye ÚNICAMENTE las versiones y motorizaciones vigentes y comercializadas en el año ${constraints.requestedYear} (excluye motores o restylings lanzados en años posteriores a ${constraints.requestedYear}). JAMÁS escribas el año ni frases como "desde 2020 a la actualidad" dentro del nombre del modelo.`
        );
    }
    if (constraints.requestedDisplacement) {
        rules.push(`- CILINDRADA / MOTOR SOLICITADO: ${constraints.requestedDisplacement}.`);
    }
    if (constraints.clarificationText) {
        rules.push(
            `- ACLARACIÓN TÉCNICA APORTADA POR EL USUARIO (PRIORIDAD MÁXIMA): "${constraints.clarificationText}".`
        );
    }
    return `\nRESTRICCIONES TÉCNICAS EXPLÍCITAS DE LA CONSULTA (FILTRO DURO OBLIGATORIO):\n${rules.join('\n')}\n`;
}

function textViolatesConstraints(text: string, constraints: QueryTechnicalConstraints): boolean {
    if (!constraints.hasExplicitConstraints) return false;
    const norm = text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();

    if (constraints.requestedFuel === 'DIESEL') {
        if (/\b(GASOLINA|BENCINA|NAFTA|THP|2\.4\s*THP|2\.4L?\s*TURBO\s*GASOLINA)\b/.test(norm)) {
            return true;
        }
    } else if (constraints.requestedFuel === 'GASOLINA') {
        if (/\b(DIESEL|TURBODIESEL|HDI|BLUEHDI|1\.9\s*D|1\.9\s*HDI)\b/.test(norm)) {
            return true;
        }
    }

    if (constraints.requestedTraction === '4X4') {
        if (/\b(4X2|2WD|TRACCION\s+SIMPLE)\b/.test(norm) && !/\b4X4\b/.test(norm)) {
            return true;
        }
    } else if (constraints.requestedTraction === '4X2') {
        if (/\b(4X4|4WD|AWD)\b/.test(norm) && !/\b4X2\b/.test(norm)) {
            return true;
        }
    }

    return false;
}

function buildTypeScopedGroundedResearchPrompt(params: {
    rawInput: string;
    correctedMake: string;
    correctedModelOrFamily: string;
    isGeneric: boolean;
    designator: string | null;
    typeDoc: GlobalEquipmentTypeDoc;
    clarificationContext?: string;
    constraints: QueryTechnicalConstraints;
}): string {
    const {
        rawInput,
        correctedMake,
        correctedModelOrFamily,
        isGeneric,
        designator,
        typeDoc,
        clarificationContext,
        constraints,
    } = params;

    const axesInstructions = typeDoc.spec_schema
        .map((ax, i) => {
            const constraint =
                ax.value_kind === 'CLOSED_ENUM' && ax.allowed_enum_values?.length
                    ? `clasificación técnica cerrada [${ax.allowed_enum_values.join(' | ')}]`
                    : `magnitud en unidad métrica SI [${ax.unit_si}]`;
            const keywords = ax.search_keywords?.length
                ? ` — buscar en ficha como: ${ax.search_keywords.join(', ')}`
                : '';
            return `   ${i + 1}. ${ax.label_es} (${constraint})${keywords}`;
        })
        .join('\n');

    const constraintsDirective = formatConstraintsDirective(constraints);

    if (isGeneric && designator) {
        return `Usa Google Search para investigar en catálogos técnicos y fichas de ingeniería el activo correspondiente al código técnico "${designator}" (búsqueda original: "${rawInput}", TIPO CANÓNICO DETECTADO: "${typeDoc.canonical_type_es}"${clarificationContext ? `, aclaración: "${clarificationContext}"` : ''}).
${constraintsDirective}
Redacta un informe técnico conciso en español basado únicamente en las páginas web consultadas:
1. Enumera todas las variantes mecánicas o generaciones reales asociadas exactamente al código "${designator}" (sin sustituir el código por modelos vecinos distintos y sin añadir rangos de años al nombre del modelo).
2. Dado que el activo corresponde al TIPO "${typeDoc.canonical_type_es}", busca y reporta EXCLUSIVAMENTE estos ${typeDoc.spec_schema.length} parámetros propios de su clase para cada variante:
${axesInstructions}
3. NO reportes parámetros impropios de otros tipos de equipos. Si alguno de los parámetros anteriores no consta con cifra explícita en las fuentes consultadas, indícalo literalmente como "NO DECLARADO EN FUENTE".`;
    }

    if (isGeneric) {
        return `Usa Google Search para investigar las configuraciones técnicas e industriales reales correspondientes a la búsqueda genérica "${rawInput}" (TIPO CANÓNICO DETECTADO: "${typeDoc.canonical_type_es}"${clarificationContext ? `, aclaración: "${clarificationContext}"` : ''}).
${constraintsDirective}
Redacta un informe técnico conciso en español basado en las fuentes consultadas:
1. Desglosa las configuraciones estándar reales diferenciadas por escala operativa, energía motriz o configuración mecánica.
2. Para cada configuración de "${typeDoc.canonical_type_es}", busca y reporta EXCLUSIVAMENTE estos ${typeDoc.spec_schema.length} parámetros propios de su clase en unidades SI:
${axesInstructions}
3. Si algún parámetro no figura con cifra explícita en las fuentes consultadas, escribe "NO DECLARADO EN FUENTE".`;
    }

    const canonicalTarget = [correctedMake, correctedModelOrFamily]
        .filter((x) => x && x !== 'GENÉRICO')
        .join(' ')
        .trim();

    return `Usa Google Search para investigar en fichas técnicas oficiales OEM, hojas de especificaciones de fabricantes y registros técnicos verificados el siguiente activo:
- Búsqueda original del usuario: "${rawInput}"
${canonicalTarget ? `- Identidad corregida objetivo: "${canonicalTarget}"` : ''}
${designator ? `- Designador alfanumérico detectado: "${designator}"` : ''}
- TIPO CANÓNICO DE EQUIPO DETECTADO: "${typeDoc.canonical_type_es}" (${typeDoc.categoria_equipo})
${clarificationContext ? `- Contexto aclaratorio del usuario: "${clarificationContext}"` : ''}
${constraintsDirective}
INSTRUCCIONES DE INVESTIGACIÓN WEB FOCALIZADA POR TIPO (CENSO EXHAUSTIVO 1..N SIN LÍMITE DE CANTIDAD):
1. CENSO EXHAUSTIVO DE VERSIONES COMERCIALES O GENERACIONES REALES QUE CUMPLEN LAS RESTRICCIONES (1..N, CERO OMISIONES):
   - Si el usuario buscó un modelo específico con restricciones técnicas (ej. "PEUGEOT LANDTREK 4X4 DIESEL 2022"), identifica y lista por separado TODAS las versiones/equipamientos comerciales reales verificados que cumplan exactamente dichas restricciones (ej. "LANDTREK ACTIVE 1.9D 4X4", "LANDTREK ACTION 1.9D 4X4", "LANDTREK 4ACTION 1.9D 4X4", "LANDTREK ALLURE 1.9D 4X4", diferenciando transmisión MT6 / AT6 si aplica), EXCLUYENDO motorizaciones o tracciones que contradigan la consulta.
   - Si el usuario buscó una familia o serie de maquinaria (ej. "CAT D10", "CAT 140M", "KOMATSU PC200"), identifica y lista el 100% de las generaciones y series reales ("D10", "D10N", "D10R", "D10T", "D10T2", "D10 NEXT GEN"; "140M", "140M2", "140M3").
   - PROHIBICIÓN ABSOLUTA DE RANGOS TEMPORALES EN NOMBRES: Jamás agregues frases como "(desde 2020 a la actualidad)", "(2020-presente)" ni rangos de años a los nombres de modelos o versiones.
2. BÚSQUEDA EXCLUSIVA DE LAS CARACTERÍSTICAS DE "${typeDoc.canonical_type_es}" Y CONDICIONES DE DISEÑO / TRABAJO:
   Para cada versión, modelo o serie identificada, busca en las fichas técnicas OEM:
   A) Los ${typeDoc.spec_schema.length} parámetros principales y diferenciadores establecidos para "${typeDoc.canonical_type_es}" (incluyendo diferenciadores de sufijo OEM como XHP, XE, VHP, LGP, LC y consumos energéticos):
${axesInstructions}
   B) CONDICIONES DE DISEÑO (ambiente_operativo): certificaciones de cabina/estructura (ROPS/FOPS, presurización), régimen hidráulico/térmico/emisiones (Tier/Stage) y configuración de tracción/rodado/superficie de trabajo.
   C) CONTEXTO Y TRABAJO (contexto_operativo): labores específicas en minería, construcción o industria y herramientas/implementos acoplables compatibles.
3. CERO PARÁMETROS CRUZADOS, FORMATO DENSO Y CERO PROSA PUBLICITARIA:
   - Formato ultra-compacto: presenta máximo 3 a 4 líneas densas por cada versión/generación con sus cifras SI, condiciones de diseño, trabajo y fuente. Prohibido redactar introducciones o párrafos extensos.
   - Si algún parámetro no figura explícitamente en las páginas web consultadas, escribe literalmente "NO DECLARADO EN FUENTE".`;
}

function buildTypeScopedPass2ExtractionPrompt(params: {
    rawInput: string;
    isGeneric: boolean;
    designator: string | null;
    typeDoc: GlobalEquipmentTypeDoc;
    groundedReportText: string;
    sourcesManifest: string;
    constraints: QueryTechnicalConstraints;
}): string {
    const { rawInput, isGeneric, designator, typeDoc, groundedReportText, sourcesManifest, constraints } = params;

    const schemaLines = typeDoc.spec_schema
        .map((ax) => {
            const constraint =
                ax.value_kind === 'CLOSED_ENUM' && ax.allowed_enum_values?.length
                    ? `Valor permitido exacto: uno de [${ax.allowed_enum_values.join(' | ')}]`
                    : `Unidad métrica SI requerida: "${ax.unit_si}"`;
            return `- axis_key: "${ax.axis_key}" | Etiqueta: "${ax.label_es}" | ${constraint}`;
        })
        .join('\n');

    const constraintsDirective = formatConstraintsDirective(constraints);

    return `Eres un Extractor Determinista de Catálogo Técnico OEM y Vehicular (Temperatura 0, Tolerancia Cero a la Alucinación, Cero Restricción de Cantidad 1..N).
Convierte el INFORME DE INVESTIGACIÓN WEB VERIFICADA adjunto abajo en la estructura JSON requerida para la búsqueda "${rawInput}" (modo: ${isGeneric ? 'GENÉRICO' : 'MARCA/OEM'}${designator && isGeneric ? `, designador bloqueado: "${designator}"` : ''}).
${constraintsDirective}
TIPO CANÓNICO DEL EQUIPO: "${typeDoc.canonical_type_es}" (clave: "${typeDoc.type_key}")
ESQUEMA OBLIGATORIO DE EJES A EXTRAER EN "extracted_axes" PARA CADA CANDIDATO:
${schemaLines}

FUENTES WEB VERIFICADAS DISPONIBLES (ÚNICAS URLS PERMITIDAS EN "official_url" Y "source_url"):
${sourcesManifest}

INFORME DE INVESTIGACIÓN WEB VERIFICADA (ÚNICA FUENTE DE VERDAD):
"""
${groundedReportText.slice(0, 48000)}
"""

REGLAS ESTRICTAS FAIL-CLOSED (1..N SIN RESTRICCIÓN DE CANTIDAD):
1. "is_pertinent": true para cualquier vehículo, maquinaria, compresor, generador, perforadora, chancador, bomba, grúa, equipo industrial o herramienta. Solo false para artículos domésticos/personales ajenos.
2. DESGLOSE DE CANDIDATOS SELECCIONABLES (SERIES O VERSIONES COMERCIALES):
   - PROHIBIDO recortar, limitar o resumir la lista de candidatos: extrae el 100% de las generaciones, series o versiones comerciales verificadas en el informe que cumplan las restricciones de la consulta.
   - Si el informe describe múltiples versiones comerciales/equipamientos de un mismo modelo (ej. para "PEUGEOT LANDTREK 4X4 DIESEL 2022": "LANDTREK ACTIVE 1.9D 4X4", "LANDTREK ACTION 1.9D 4X4", "LANDTREK 4ACTION 1.9D 4X4", "LANDTREK ALLURE 1.9D 4X4"), DEBES emitir CADA VERSIÓN COMERCIAL como un candidato independiente en el arreglo "candidates" con su "model_oficial" específico, para que el usuario pueda seleccionar directamente la versión exacta que desea registrar.
   - Si el informe describe múltiples series/generaciones de una familia de maquinaria (ej. "D10", "D10N", "D10R", "D10T", "D10T2", "D10 NEXT GEN" o "140M", "140M2", "140M3"), emite cada serie como un candidato independiente.
   - PROHIBICIÓN ABSOLUTA DE RUIDO TEMPORAL: Jamás incluyas años, rangos de años ni frases como "(desde 2020 a la actualidad)" o "(2020-presente)" en "model_oficial" ni en "versions".
   - En modo OEM, normaliza "make_oficial" a la marca oficial corregida en MAYÚSCULAS (ej. "PEUGUEOT" -> "PEUGEOT", "CAT" -> "CATERPILLAR").
3. EXTRACCIÓN EXACTA DE "extracted_axes", "ambiente_operativo" (CONDICIONES DE DISEÑO) Y "contexto_operativo" (CONTEXTO Y TRABAJO):
   - Devuelve en "extracted_axes" una entrada por cada "axis_key" del esquema de "${typeDoc.canonical_type_es}".
   - En "value_si" escribe ÚNICAMENTE la cifra con su unidad métrica SI (ej. "110 kW (150 HP)", "150 L/min @ 280 bar", "1.910 cm³", "350 Nm", "1.020 kg", "4x4") o el valor exacto del enum permitido. JAMÁS repitas el nombre de la etiqueta dentro de "value_si".
   - En "ambiente_operativo" extrae de 2 a 4 viñetas técnicas concretas de CONDICIONES DE DISEÑO (certificaciones ROPS/FOPS, circuito hidráulico/térmico/emisiones, configuración de tracción y terreno). Prohibido devolver palabras sueltas como "Superficie".
   - En "contexto_operativo" extrae de 2 a 4 viñetas técnicas concretas de CONTEXTO Y TRABAJO (labores específicas en minería/construcción/industria e implementos compatibles). Prohibido devolver frases vacías como "Operación Técnica".
   - Si un eje NO aparece con dato explícito en el informe verificado (o dice NO DECLARADO), devuelve "value_si": null, "source_url": null, "verbatim_evidence": null.
   - "source_url" y "official_url" DEBEN ser URLs literales tomadas de FUENTES WEB VERIFICADAS DISPONIBLES.`;
}

export async function resolveMachineryCandidates(
    jerga: string,
    isGeneric: boolean = false,
    clarificationContext?: string,
    forceWebDiscovery: boolean = false
): Promise<AssetResolutionResponse> {
    const cleanInput = jerga.trim();
    validateIndustrialDomain(cleanInput);
    const constraints = extractQueryTechnicalConstraints(cleanInput, clarificationContext);

    // ── COMPUERTA COLABORATIVA DE LINAJE COMPLETO (< 30 ms, $0 IA, 0 Duplicados) ──
    if (!forceWebDiscovery && !clarificationContext) {
        const lineageHit = await readCollaborativeLineage(cleanInput, isGeneric);
        if (lineageHit.matched && lineageHit.candidates.length > 0) {
            return {
                requires_clarification: false,
                candidates: lineageHit.candidates,
                resolved_from_commons: true,
                resolution_tier: 'TIER_0_EXACT',
                resolution_latency_ms: lineageHit.latencyMs,
            };
        }
    }

    const webStartMs = Date.now();
    const designator = detectModelDesignator(cleanInput);
    const localPreexistingPromise = resolveFromLocalCommonsCatalog(cleanInput, isGeneric).catch(() => ({
        matched: false,
        tier: 'NONE' as const,
        latencyMs: 0,
        candidates: [] as ResolvedAssetCandidate[],
    }));

    // ── PASO 1: Detección Primaria del `TIPO` de Equipo y Pertinencia (Con Fast-Path Determinista < 1 ms) ──
    const explicitTypeInQuery = detectExplicitTypeFromQueryText(
        `${cleanInput} ${clarificationContext || ''}`
    );
    const deterministicBrandModelType = !isGeneric
        ? detectDeterministicEquipmentTypeFromBrandAndModel(cleanInput)
        : null;

    let correctedMake = isGeneric
        ? 'GENÉRICO'
        : deterministicBrandModelType?.correctedMake || '';
    let correctedModelOrFamily =
        deterministicBrandModelType?.correctedModel || designator || cleanInput;
    let detectedTipoHint =
        deterministicBrandModelType?.canonical_type_es ||
        explicitTypeInQuery?.canonical_type_es ||
        '';
    let detectedCategoriaHint = deterministicBrandModelType?.categoria_equipo || '';
    let needsWebTypeIdentification = false;

    if (!deterministicBrandModelType) {
        try {
            const { data: step1 } = await ResilientAIClient.generateStructured<{
                is_pertinent: boolean;
                rejection_reason: string | null;
                requires_clarification: boolean;
                clarification_message: string | null;
                corrected_make: string;
                corrected_model_or_family: string;
                detected_tipo_equipo: string;
                detected_categoria_equipo: string;
                needs_web_to_identify_type: boolean;
            }>({
                module: 'opermaq',
                preferredTier: 'ANCHOR_HA',
                temperature: 0,
                topP: 1,
                topK: 1,
                maxOutputTokens: 768,
                bypassCache: forceWebDiscovery,
                responseSchema: STEP1_PRIMARY_TYPE_DETECTION_SCHEMA,
                prompt: `Analiza la siguiente solicitud de búsqueda/registro de activo en OPERMAQ:
- Texto ingresado: "${cleanInput}"
- Modo: ${isGeneric ? 'GENÉRICO (sin marca obligatoria)' : 'MARCA / MODELO OEM'}
${designator ? `- Código alfanumérico detectado: "${designator}"` : ''}
${explicitTypeInQuery ? `- Tipo explícito detectado en texto: "${explicitTypeInQuery.canonical_type_es}"` : ''}
${clarificationContext ? `- Aclaración adicional del usuario: "${clarificationContext}"` : ''}

TAREA PRIMARIA (PASO 1):
1. Valida pertinencia ("is_pertinent": true para cualquier vehículo liviano/pesado, maquinaria, compresor, generador, perforadora, chancador, grúa, bomba, equipo o herramienta; false solo para objetos domésticos/personales ajenos).
2. Verifica si requiere aclaración ("requires_clarification": true solo si escribió únicamente una marca suelta sin modelo ni tipo, p. ej. solo "Caterpillar" o solo "Toyota", o una palabra vacía como "máquina").
3. Corrige errores ortográficos de marca y modelo SIN INCLUIR AÑOS NI TRACCIÓN EN EL MODELO BASE (ej. "PEUGUEOT LANDTRECK 4X4 DIESEL 2022" -> marca "PEUGEOT", modelo "LANDTREK"; "CAT 140M" -> marca "CATERPILLAR", modelo "140M").
4. Identifica en "detected_tipo_equipo" el TIPO canónico exacto de equipo en español singular MAYÚSCULAS (ej. "MOTONIVELADORA", "CAMIONETA PICK-UP", "COMPRESOR DE AIRE", "PERFORADORA NEUMÁTICA MANUAL", "CHANCADOR DE MANDÍBULAS", "EXCAVADORA HIDRÁULICA", "BULLDOZER SOBRE ORUGAS").`,
            });

            if (step1.is_pertinent === false) {
                throw new DomainRejectionError(
                    step1.rejection_reason ||
                    `"${cleanInput}" corresponde a un artículo doméstico o de consumo personal ajeno a vehículos, maquinaria o equipamiento técnico.`
                );
            }

            if (step1.requires_clarification === true && !clarificationContext) {
                return {
                    requires_clarification: true,
                    clarification_message:
                        step1.clarification_message ||
                        'La búsqueda es demasiado amplia. Especifique modelo, serie o tipo específico de equipo.',
                    candidates: [],
                };
            }

            const rawMakeUpper = String(step1.corrected_make || '').trim().toUpperCase();
            correctedMake = isGeneric
                ? 'GENÉRICO'
                : BRAND_SYNONYM_TO_OFFICIAL[rawMakeUpper] || rawMakeUpper;
            correctedModelOrFamily = normalizeModelCode(
                String(step1.corrected_model_or_family || designator || cleanInput).trim()
            );
            if (!isVagueDetectedType(step1.detected_tipo_equipo)) {
                detectedTipoHint = step1.detected_tipo_equipo.trim();
            }
            detectedCategoriaHint = String(step1.detected_categoria_equipo || '').trim();
            needsWebTypeIdentification = Boolean(step1.needs_web_to_identify_type);
        } catch (step1Err) {
            if (step1Err instanceof DomainRejectionError) {
                throw step1Err;
            }
            needsWebTypeIdentification = !detectedTipoHint;
        }
    }

    // Segunda verificación de Linaje Colaborativo post-corrección ortográfica (ej. "landtreck" -> "LANDTREK")
    if (!forceWebDiscovery && !clarificationContext && correctedMake && correctedModelOrFamily) {
        const canonicalLineageHit = await readCollaborativeLineage(cleanInput, isGeneric, {
            make: correctedMake,
            model: correctedModelOrFamily,
        });
        if (canonicalLineageHit.matched && canonicalLineageHit.candidates.length > 0) {
            return {
                requires_clarification: false,
                candidates: canonicalLineageHit.candidates,
                resolved_from_commons: true,
                resolution_tier: 'TIER_0_EXACT',
                resolution_latency_ms: canonicalLineageHit.latencyMs,
            };
        }
    }

    // Si el código es poco conocido y requiere confirmación web para saber qué TIPO de máquina es antes de fijar sus ejes:
    if ((needsWebTypeIdentification || isVagueDetectedType(detectedTipoHint)) && !explicitTypeInQuery) {
        try {
            const quickWebId = await ResilientAIClient.generate({
                module: 'opermaq',
                preferredTier: 'SECONDARY',
                temperature: 0,
                useGoogleSearch: true,
                requireGroundedEvidence: true,
                maxOutputTokens: 1024,
                bypassCache: forceWebDiscovery,
                prompt: `Usa Google Search para identificar qué clase o tipo exacto de vehículo, maquinaria, equipo industrial o herramienta corresponde a "${cleanInput}"${clarificationContext ? ` (${clarificationContext})` : ''}. Responde en español técnico conciso indicando marca oficial, modelo y el TIPO exacto de máquina (ej. Motoniveladora, Compresor de aire portátil, Chancador de mandíbulas, Camioneta pick-up, Perforadora neumática manual).`,
            });

            const { data: postWebType } = await ResilientAIClient.generateStructured<{
                is_pertinent: boolean;
                rejection_reason: string | null;
                requires_clarification: boolean;
                clarification_message: string | null;
                corrected_make: string;
                corrected_model_or_family: string;
                detected_tipo_equipo: string;
                detected_categoria_equipo: string;
                needs_web_to_identify_type: boolean;
            }>({
                module: 'opermaq',
                preferredTier: 'SECONDARY',
                temperature: 0,
                maxOutputTokens: 512,
                responseSchema: STEP1_PRIMARY_TYPE_DETECTION_SCHEMA,
                prompt: `Con base en esta identificación web verificada para "${cleanInput}":
"""
${quickWebId.text.slice(0, 2500)}
"""
Extrae la marca corregida, el modelo/familia y el nombre canónico singular en español MAYÚSCULAS del TIPO de equipo ("detected_tipo_equipo").`,
            });

            if (postWebType.is_pertinent === false) {
                throw new DomainRejectionError(
                    postWebType.rejection_reason ||
                    `"${cleanInput}" no corresponde a un vehículo, maquinaria ni equipo técnico.`
                );
            }
            if (!isVagueDetectedType(postWebType.detected_tipo_equipo)) {
                detectedTipoHint = postWebType.detected_tipo_equipo.trim();
            }
            if (postWebType.detected_categoria_equipo) {
                detectedCategoriaHint = postWebType.detected_categoria_equipo.trim();
            }
            if (!isGeneric && postWebType.corrected_make) {
                const mk = postWebType.corrected_make.trim().toUpperCase();
                correctedMake = BRAND_SYNONYM_TO_OFFICIAL[mk] || mk;
            }
            if (postWebType.corrected_model_or_family) {
                correctedModelOrFamily = normalizeModelCode(postWebType.corrected_model_or_family.trim());
            }
        } catch (webIdErr) {
            if (webIdErr instanceof DomainRejectionError) throw webIdErr;
        }
    }

    // ── PASO 2: Resolución (< 10 ms en 2ª..Nª consulta) o Aprendizaje Único del Esquema de `TIPO` ──
    const typeResolution = await resolveOrLearnEquipmentType({
        rawTypeKey: explicitTypeInQuery?.type_key,
        rawTypeHint: detectedTipoHint || cleanInput,
        rawCategoryHint: detectedCategoriaHint,
        assetQueryContext: `${correctedMake} ${correctedModelOrFamily}`.trim() || cleanInput,
    });

    let activeTypeDoc = typeResolution.typeDoc;
    console.info(
        `[OPERMAQ-TYPE-ONTOLOGY] TIPO="${activeTypeDoc.canonical_type_es}" (key=${activeTypeDoc.type_key}, source=${typeResolution.resolutionSource}, reused=${typeResolution.reusedExistingSchema}, ${typeResolution.latencyMs}ms) -> Ejes: [${activeTypeDoc.spec_schema.map((a) => a.axis_key).join(', ')}]`
    );

    // ── PASO 3 (PASADA 1 GROUNDED): Búsqueda Web en Prosa Natural Dirigida Exclusivamente a los Ejes de `activeTypeDoc` + Caché Determinista SHA-256 (30 días) ──
    const pass1Prompt = buildTypeScopedGroundedResearchPrompt({
        rawInput: cleanInput,
        correctedMake,
        correctedModelOrFamily,
        isGeneric,
        designator,
        typeDoc: activeTypeDoc,
        clarificationContext,
        constraints,
    });

    const groundedCacheKey = createHash('sha256')
        .update(
            JSON.stringify({
                v: 3,
                make: correctedMake.toUpperCase(),
                model: correctedModelOrFamily.toUpperCase(),
                typeKey: activeTypeDoc.type_key,
                isGeneric,
                query: cleanInput.toUpperCase().replace(/\s+/g, ' '),
            })
        )
        .digest('hex');

    const GROUNDED_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    let pass1Response: {
        text: string;
        groundingSources: Array<{ title: string; uri: string }>;
    } | null = null;

    if (!forceWebDiscovery && !clarificationContext) {
        try {
            const cacheSnap = await db.collection('ai_grounded_discovery_cache').doc(groundedCacheKey).get();
            if (cacheSnap.exists) {
                const cData = cacheSnap.data()!;
                const createdMs = Number(cData.createdAtMs || 0);
                if (
                    createdMs > 0 &&
                    Date.now() - createdMs < GROUNDED_CACHE_TTL_MS &&
                    typeof cData.text === 'string' &&
                    cData.text.length > 50 &&
                    Array.isArray(cData.groundingSources) &&
                    cData.groundingSources.length > 0
                ) {
                    pass1Response = {
                        text: cData.text,
                        groundingSources: cData.groundingSources,
                    };
                }
            }
        } catch {
            // Continuar a búsqueda web en vivo si el caché no está disponible
        }
    }

    if (!pass1Response) {
        try {
            const liveResponse = await ResilientAIClient.generate({
                module: 'opermaq',
                preferredTier: 'SECONDARY',
                thinkingLevel: 'low',
                temperature: 0,
                useGoogleSearch: true,
                requireGroundedEvidence: true,
                maxOutputTokens: 8192,
                bypassCache: forceWebDiscovery || Boolean(clarificationContext),
                prompt: pass1Prompt,
            });
            pass1Response = {
                text: liveResponse.text,
                groundingSources: liveResponse.groundingSources,
            };

            if (!clarificationContext && liveResponse.groundingSources.length > 0) {
                await db
                    .collection('ai_grounded_discovery_cache')
                    .doc(groundedCacheKey)
                    .set({
                        cacheKey: groundedCacheKey,
                        normalizedQuery: cleanInput.toUpperCase(),
                        make: correctedMake,
                        model: correctedModelOrFamily,
                        typeKey: activeTypeDoc.type_key,
                        text: liveResponse.text,
                        groundingSources: liveResponse.groundingSources,
                        createdAtMs: Date.now(),
                        expiresAtMs: Date.now() + GROUNDED_CACHE_TTL_MS,
                    })
                    .catch(() => { });
            }
        } catch (aiErr) {
            const localFallback = await localPreexistingPromise;
            if (localFallback.matched && localFallback.candidates.length > 0) {
                return {
                    requires_clarification: false,
                    candidates: localFallback.candidates,
                    resolved_from_commons: true,
                    resolution_tier: localFallback.tier === 'TIER_0_EXACT' ? 'TIER_0_EXACT' : 'TIER_1_HYBRID_RRF',
                    resolution_latency_ms: localFallback.latencyMs,
                    detected_equipment_type: {
                        type_key: activeTypeDoc.type_key,
                        canonical_type_es: activeTypeDoc.canonical_type_es,
                        reused_existing_schema: typeResolution.reusedExistingSchema,
                        resolution_source: typeResolution.resolutionSource,
                        type_resolution_latency_ms: typeResolution.latencyMs,
                        spec_axes: activeTypeDoc.spec_schema.map((a) => a.axis_key),
                    },
                };
            }
            throw aiErr;
        }
    }

    // ── PASO 4 (PASADA 2 ESTRUCTURADA): Extracción Determinista (`Temperature: 0`) sobre `activeTypeDoc.spec_schema` ──
    const groundedSources = pass1Response.groundingSources;
    const groundedUrls = groundedSources.map((s) => s.uri);
    const allowedUrlsSet = new Set(groundedUrls);
    const sourcesManifest = groundedSources
        .map((s, idx) => `[${idx + 1}] ${s.title} -> ${s.uri}`)
        .join('\n');

    const pass2Prompt = buildTypeScopedPass2ExtractionPrompt({
        rawInput: cleanInput,
        isGeneric,
        designator,
        typeDoc: activeTypeDoc,
        groundedReportText: pass1Response.text,
        sourcesManifest,
        constraints,
    });

    const { data: parsed } = await ResilientAIClient.generateStructured<{
        is_pertinent: boolean;
        rejection_reason: string | null;
        requires_clarification: boolean;
        clarification_message: string | null;
        actual_tipo_equipo_if_different: string | null;
        candidates: Array<{
            make_oficial: string;
            model_oficial: string;
            ambiente_operativo: string[];
            contexto_operativo: string[];
            extracted_axes: Array<{
                axis_key: string;
                value_si: string | null;
                source_url: string | null;
                verbatim_evidence: string | null;
            }>;
            versions: string[];
            official_url: string | null;
        }>;
    }>({
        module: 'opermaq',
        preferredTier: 'SECONDARY',
        thinkingLevel: 'none',
        temperature: 0,
        topP: 1,
        topK: 1,
        maxOutputTokens: 32768,
        bypassCache: forceWebDiscovery || Boolean(clarificationContext),
        responseSchema: PASS2_TYPE_SCOPED_CANDIDATE_SCHEMA,
        prompt: pass2Prompt,
    });

    if (parsed.is_pertinent === false) {
        throw new DomainRejectionError(
            parsed.rejection_reason ||
            `"${cleanInput}" corresponde a un artículo doméstico o de consumo personal ajeno a vehículos, maquinaria o equipamiento técnico.`
        );
    }

    if (
        parsed.requires_clarification === true &&
        (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0)
    ) {
        return {
            requires_clarification: true,
            clarification_message:
                parsed.clarification_message ||
                'La búsqueda es ambigua. Especifique modelo, serie o configuración motriz.',
            candidates: [],
        };
    }

    // Si la evidencia web reveló que el activo pertenece a un TIPO distinto al estimado preliminarmente, realinear esquema
    let typeMismatchDetected = false;
    if (
        parsed.actual_tipo_equipo_if_different &&
        !isVagueDetectedType(parsed.actual_tipo_equipo_if_different)
    ) {
        const diffKey = normalizeEquipmentTypeKey(parsed.actual_tipo_equipo_if_different);
        if (diffKey && diffKey !== activeTypeDoc.type_key) {
            const realigned = await resolveOrLearnEquipmentType({
                rawTypeHint: parsed.actual_tipo_equipo_if_different,
                assetQueryContext: cleanInput,
            });
            if (realigned.typeDoc.type_key !== activeTypeDoc.type_key) {
                activeTypeDoc = realigned.typeDoc;
                typeMismatchDetected = true;
            }
        }
    }

    const initialRawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];

    // Sanitización determinista de ruido temporal, filtro de restricciones duras y expansión de versiones empaquetadas
    const sanitizedRawCandidates = initialRawCandidates
        .map((c) => {
            const cleanModel = normalizeModelCode(String(c.model_oficial || correctedModelOrFamily || cleanInput));
            const cleanVersions = Array.isArray(c.versions)
                ? c.versions
                    .map((v) => stripTemporalAndHistoricalNoise(String(v || '')))
                    .filter((v) => Boolean(v) && !textViolatesConstraints(v, constraints))
                : [];
            return {
                ...c,
                model_oficial: cleanModel,
                versions: cleanVersions.length > 0 ? cleanVersions : ['ESTÁNDAR'],
            };
        })
        .filter((c) => !textViolatesConstraints(c.model_oficial, constraints));

    const effectiveRawCandidates =
        sanitizedRawCandidates.length > 0 ? sanitizedRawCandidates : initialRawCandidates;

    // Si Pass 2 devolvió 1 solo candidato base con múltiples versiones comerciales en `versions[]`, expandirlas en candidatos independientes seleccionables
    let expandedRawCandidates = effectiveRawCandidates;
    if (
        effectiveRawCandidates.length === 1 &&
        Array.isArray(effectiveRawCandidates[0].versions) &&
        effectiveRawCandidates[0].versions.length > 1
    ) {
        const single = effectiveRawCandidates[0];
        const baseModel = normalizeModelCode(single.model_oficial || correctedModelOrFamily || cleanInput);
        const nonTrivialVersions = single.versions
            .map((v) => stripTemporalAndHistoricalNoise(String(v || '')).trim())
            .filter((v) => v.length > 1 && v.toUpperCase() !== 'ESTÁNDAR' && v.toUpperCase() !== baseModel);

        if (nonTrivialVersions.length > 1) {
            expandedRawCandidates = nonTrivialVersions.map((ver) => {
                const verUpper = ver.toUpperCase();
                const fullModel = verUpper.startsWith(baseModel)
                    ? normalizeModelCode(verUpper)
                    : normalizeModelCode(`${baseModel} ${verUpper}`);
                return {
                    ...single,
                    model_oficial: fullModel,
                    versions: [ver],
                };
            });
        }
    }

    // Procesar el 100% de los candidatos (concurrencia controlada = 4)
    const resolvedCandidates = await mapWithConcurrency(
        expandedRawCandidates,
        4,
        async (raw, idx): Promise<ResolvedAssetCandidate> => {
            const rawMakeUpper = (isGeneric ? 'GENÉRICO' : String(raw.make_oficial || correctedMake || 'GENÉRICO'))
                .trim()
                .toUpperCase();
            const safeMake = BRAND_SYNONYM_TO_OFFICIAL[rawMakeUpper] || rawMakeUpper;
            let safeModel = normalizeModelCode(String(raw.model_oficial || cleanInput));

            if (isGeneric && designator && !safeModel.includes(designator)) {
                safeModel = designator;
            }

            const catalogKey = normalizeCatalogKey(safeMake, safeModel);

            // Consulta exacta por catalog_key en global_asset_catalog
            let existingDocSnap: FirebaseFirestore.DocumentSnapshot | null = null;
            const querySnap = await db
                .collection('global_asset_catalog')
                .where('catalog_key', '==', catalogKey)
                .limit(1)
                .get();

            if (!querySnap.empty) {
                existingDocSnap = querySnap.docs[0];
            } else {
                const directSnap = await db.collection('global_asset_catalog').doc(catalogKey).get();
                if (directSnap.exists) existingDocSnap = directSnap;
            }

            if (existingDocSnap && existingDocSnap.exists) {
                const existingData = existingDocSnap.data()!;
                const homologous = extractHomologousAxisValues(existingData);
                const rawExistingVersions =
                    Array.isArray(existingData.chassis_versions) && existingData.chassis_versions.length > 0
                        ? existingData.chassis_versions
                        : Array.isArray(existingData.versions) && existingData.versions.length > 0
                            ? existingData.versions
                            : Array.isArray(raw.versions) && raw.versions.length > 0
                                ? raw.versions
                                : ['ESTÁNDAR'];
                const existingVersions = rawExistingVersions
                    .map((v: unknown) => stripTemporalAndHistoricalNoise(String(v || '')))
                    .filter((v: string) => Boolean(v) && !textViolatesConstraints(v, constraints));
                const cleanExistingModel = normalizeModelCode(
                    String(existingData.model_oficial || existingData.model || safeModel)
                );

                const existingTraits =
                    existingData.physical_traits ||
                    activeTypeDoc.physical_traits ||
                    AssetOntologyEngine.inferAssetPhysicalTraits({
                        type_key: existingData.equipment_type_key || activeTypeDoc.type_key,
                        canonical_type_es: existingData.tipo_equipo || activeTypeDoc.canonical_type_es,
                        categoria_equipo: existingData.categoria_equipo || activeTypeDoc.categoria_equipo,
                        canonical_specs: hasSelfDescribingTypeSchema(existingData)
                            ? existingData.canonical_specs
                            : homologous.slots,
                    });

                return {
                    global_asset_id: existingDocSnap.id,
                    existing_catalog_id: existingDocSnap.id,
                    catalog_key: catalogKey,
                    make_oficial: existingData.make_oficial || existingData.make || safeMake,
                    model_oficial: cleanExistingModel || safeModel,
                    equipment_type_key: existingData.equipment_type_key || activeTypeDoc.type_key,
                    archetype_id: homologous.archetype.id,
                    tipo_equipo: existingData.tipo_equipo || activeTypeDoc.canonical_type_es,
                    categoria_equipo:
                        existingData.categoria_equipo || activeTypeDoc.categoria_equipo || 'EQUIPAMIENTO INDUSTRIAL',
                    physical_traits: existingTraits,
                    canonical_specs: hasSelfDescribingTypeSchema(existingData)
                        ? existingData.canonical_specs
                        : homologous.slots,
                    ambiente_operativo: sanitizeDesignAndWorkContextItems(
                        raw.ambiente_operativo,
                        existingData.ambiente_operativo
                    ),
                    contexto_operativo: sanitizeDesignAndWorkContextItems(
                        raw.contexto_operativo,
                        existingData.contexto_operativo
                    ),
                    caracteristicas_principales: serializeCanonicalSlotsToSpecsArray(homologous.slots),
                    versions: existingVersions.length > 0 ? existingVersions : ['ESTÁNDAR'],
                    chassis_versions:
                        existingVersions.length > 0 ? Array.from(new Set(existingVersions)) : ['ESTÁNDAR'],
                    official_url: existingData.official_url || groundedUrls[idx] || groundedUrls[0] || '',
                    isNew: false,
                    is_pertinent: true,
                };
            }

            const assignedGroundedUrl =
                typeof raw.official_url === 'string' && allowedUrlsSet.has(raw.official_url)
                    ? raw.official_url
                    : groundedUrls[idx] || groundedUrls[0] || '';

            const verifiedSlots = buildVerifiedSlotsForEquipmentType({
                typeDoc: activeTypeDoc,
                rawExtractedAxes: Array.isArray(raw.extracted_axes) ? raw.extracted_axes : [],
                allowedSourceUrls: allowedUrlsSet,
                defaultVerifiedUrl: assignedGroundedUrl || null,
            });

            const profile = !typeMismatchDetected
                ? {
                    equipment_type_key: activeTypeDoc.type_key,
                    archetype_id: activeTypeDoc.archetype_id || 'HERRAMIENTA_INDUSTRIAL_GENERAL',
                    tipo_equipo: activeTypeDoc.canonical_type_es,
                    categoria_equipo: activeTypeDoc.categoria_equipo,
                    canonical_specs: verifiedSlots,
                    ambiente_operativo: sanitizeDesignAndWorkContextItems(raw.ambiente_operativo),
                    contexto_operativo: sanitizeDesignAndWorkContextItems(raw.contexto_operativo),
                    caracteristicas_principales: serializeCanonicalSlotsToSpecsArray(verifiedSlots),
                }
                : await enrichCatalogProfile(
                    safeMake,
                    safeModel,
                    {
                        equipment_type_key: activeTypeDoc.type_key,
                        tipo_equipo: activeTypeDoc.canonical_type_es,
                        categoria_equipo: activeTypeDoc.categoria_equipo,
                        ambiente_operativo: raw.ambiente_operativo,
                        contexto_operativo: raw.contexto_operativo,
                    },
                    isGeneric,
                    {
                        preRetrievedEvidenceText: pass1Response.text,
                        preRetrievedSources: groundedSources,
                        preResolvedTypeDoc: activeTypeDoc,
                    }
                );

            const candidateTraits = AssetOntologyEngine.inferAssetPhysicalTraits({
                type_key: profile.equipment_type_key || activeTypeDoc.type_key,
                canonical_type_es: profile.tipo_equipo || activeTypeDoc.canonical_type_es,
                categoria_equipo: profile.categoria_equipo || activeTypeDoc.categoria_equipo,
                canonical_specs: profile.canonical_specs || verifiedSlots,
                corpusText: `${safeMake} ${safeModel} ${(profile.ambiente_operativo || []).join(' ')} ${(profile.contexto_operativo || []).join(' ')}`,
                existingTraits: activeTypeDoc.physical_traits || null,
            });

            const candidateVersions =
                Array.isArray(raw.versions) && raw.versions.length > 0
                    ? raw.versions
                        .map((v) => stripTemporalAndHistoricalNoise(String(v || '')).trim())
                        .filter(Boolean)
                    : ['ESTÁNDAR'];

            return {
                make_oficial: safeMake,
                model_oficial: safeModel,
                ...profile,
                physical_traits: candidateTraits,
                versions: candidateVersions.length > 0 ? candidateVersions : ['ESTÁNDAR'],
                chassis_versions: candidateVersions.length > 0 ? candidateVersions : ['ESTÁNDAR'],
                official_url: assignedGroundedUrl,
                isNew: true,
                is_pertinent: true,
                existing_catalog_id: null,
                catalog_key: catalogKey,
            };
        }
    );

    // Fusionar cualquier variante previamente existente en `global_asset_catalog` que cumpla las restricciones y no sea un registro padre genérico redundante
    const localPreexisting = await localPreexistingPromise;
    const hasSpecificSubmodels =
        resolvedCandidates.length > 1 &&
        Boolean(correctedModelOrFamily) &&
        resolvedCandidates.some((c) => c.model_oficial.length > correctedModelOrFamily.length);

    const compatibleLocalCandidates = localPreexisting.candidates
        .map((c) => ({
            ...c,
            model_oficial: normalizeModelCode(c.model_oficial),
            versions: Array.isArray(c.versions)
                ? c.versions
                    .map((v) => stripTemporalAndHistoricalNoise(String(v || '')))
                    .filter((v) => Boolean(v) && !textViolatesConstraints(v, constraints))
                : ['ESTÁNDAR'],
        }))
        .filter((c) => {
            if (textViolatesConstraints(c.model_oficial, constraints)) return false;
            if (
                hasSpecificSubmodels &&
                correctedModelOrFamily &&
                c.model_oficial === normalizeModelCode(correctedModelOrFamily)
            ) {
                return false;
            }
            return true;
        });

    const combinedCandidates = [...resolvedCandidates, ...compatibleLocalCandidates];

    const seenKeys = new Set<string>();
    let uniqueCandidates = combinedCandidates.filter((c) => {
        const key = c.catalog_key || normalizeCatalogKey(c.make_oficial, c.model_oficial);
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
    });

    if (uniqueCandidates.length > 0 && !clarificationContext) {
        uniqueCandidates = await saveCollaborativeLineage(cleanInput, isGeneric, uniqueCandidates, {
            make: correctedMake,
            model: correctedModelOrFamily,
        });
    }

    return {
        requires_clarification: false,
        candidates: uniqueCandidates,
        resolved_from_commons: false,
        resolution_tier: 'TIER_2_WEB_DISCOVERY',
        resolution_latency_ms: Date.now() - webStartMs,
        detected_equipment_type: {
            type_key: activeTypeDoc.type_key,
            canonical_type_es: activeTypeDoc.canonical_type_es,
            reused_existing_schema: typeResolution.reusedExistingSchema,
            resolution_source: typeResolution.resolutionSource,
            type_resolution_latency_ms: typeResolution.latencyMs,
            spec_axes: activeTypeDoc.spec_schema.map((a) => a.axis_key),
        },
    };
}

/**
 * Hidrata los íconos ISO 7000 / variantes por marca desde `master_symbology_vault`
 * al leer un documento de `global_asset_catalog`.
 */
export async function resolveAssetSymbology(assetData: Record<string, any>): Promise<Record<string, any>> {
    // Asegurar paquete ad-hoc de simbología normativa si el activo aún no lo tiene materializado
    let symbologyPack = assetData?.symbology_pack;
    if (!symbologyPack && assetData?.id) {
        try {
            symbologyPack = await buildAndPersistAssetSymbologyPack(String(assetData.id), assetData);
        } catch {
            // No bloquear lectura de activo
        }
    }

    const vault = assetData?.knowledge_vault;
    if (!vault || typeof vault !== 'object') {
        return symbologyPack ? { ...assetData, symbology_pack: symbologyPack } : assetData;
    }

    const conceptIds = new Set<string>();
    for (const pillarKey of Object.keys(vault)) {
        const items = vault[pillarKey]?.items;
        if (Array.isArray(items)) {
            for (const item of items) {
                if (Array.isArray(item?.symbology_refs)) {
                    for (const ref of item.symbology_refs) {
                        if (typeof ref === 'string') conceptIds.add(ref);
                        else if (ref?.concept_id) conceptIds.add(String(ref.concept_id));
                    }
                }
            }
        }
    }

    if (conceptIds.size === 0) return assetData;

    const makeKey = String(assetData.make_oficial || assetData.make || '').trim().toLowerCase();
    const resolvedSymbology: Record<string, any> = {};

    const masterIndex = await getCachedMasterSymbologyIndex();
    for (const conceptId of conceptIds) {
        const sym = masterIndex.docsById.get(conceptId);
        if (!sym) continue;
        const brandVariant = sym.brands_variants?.[makeKey] || sym.brand_variants?.[makeKey.toUpperCase()];
        const preferredUrl =
            brandVariant?.verified_by_human && brandVariant?.asset_storage_url
                ? brandVariant.asset_storage_url
                : brandVariant?.human_verified && brandVariant?.icon_url
                    ? brandVariant.icon_url
                    : sym.standard_icon_url || '';

        resolvedSymbology[conceptId] = {
            concept_id: conceptId,
            technical_name_es: sym.technical_name_es || sym.name_es || conceptId,
            iso_reference: sym.iso_reference || sym.iso_code || '',
            url: preferredUrl,
            icon_url: preferredUrl,
            is_brand_specific: Boolean(
                (brandVariant?.verified_by_human && brandVariant?.asset_storage_url) ||
                (brandVariant?.human_verified && brandVariant?.icon_url)
            ),
        };
    }

    return {
        ...assetData,
        ...(symbologyPack ? { symbology_pack: symbologyPack } : {}),
        resolved_symbology: resolvedSymbology,
    };
}
