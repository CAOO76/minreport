import {
    ResilientAIClient,
    Type,
    UngroundedEvidenceError,
    type GroundingSource,
} from '../../../core/resilient-ai-client';
import type { CatalogProfile, EquipmentTypeOrigin, GlobalEquipmentTypeDoc } from '../types/vault.types';
import {
    extractHomologousAxisValues,
    MISSING_AXIS_VALUE,
    MISSING_FULL_TECH_SPEC,
    serializeCanonicalSlotsToSpecsArray,
    type CanonicalSpecSlot,
    type MachineryArchetypeId,
} from '../utils/canonicalArchetypeSpecs';
import {
    buildVerifiedSlotsForEquipmentType,
    detectExplicitTypeFromQueryText,
    resolveOrLearnEquipmentType,
} from './EquipmentTypeRegistryService';
import { SegmentedDocumentProcessorService } from './SegmentedDocumentProcessorService';

/**
 * CATALOG PROFILE ENRICHER v4.0 — PIPELINE ONTOLÓGICO POR `TIPO` + 2 PASADAS GROUNDED FAIL-CLOSED
 *
 * Mecánica Soberana de 3 Fases (GEMINI.md §3.1 y Capa 4):
 * 1. Detección y Resolución del `TIPO` de Equipo (`global_equipment_types/{typeKey}`):
 *    Identifica primero qué `TIPO` canónico es el activo (ej. `MOTONIVELADORA`, `COMPRESOR DE AIRE`,
 *    `CAMIONETA PICK-UP`, `PERFORADORA NEUMÁTICA MANUAL`, `CHANCADOR DE MANDÍBULAS`) y obtiene o aprende
 *    sus 3–5 ejes técnicos principales y diferenciadores exclusivos.
 * 2. Pasada 1 — Búsqueda Documental Grounded Focalizada (`useGoogleSearch: true`, prosa técnica natural):
 *    Consulta Corpus PDF OEM local + Google Search buscando única y exclusivamente los ejes físicos de ese `TIPO`.
 *    Si hay 0 fuentes verificadas, aplica Fail-Closed inmediato (`[Información técnica no declarada en ficha]`).
 * 3. Pasada 2 — Extracción Determinista (`Temperature: 0`, `responseSchema` estricto):
 *    Extrae cada eje del esquema del `TIPO` con conversión SI, URL verificada y cita literal.
 */

const FORBIDDEN_GENERIC_TYPES = new Set([
    '',
    'maquinaria pesada',
    'maquinaria',
    'maquinaria industrial',
    'equipo pesado',
    'equipo operativo',
    'equipo industrial',
    'equipamiento industrial',
    'vehiculo',
    'herramienta',
    'equipo',
]);

const QUICK_ASSET_TYPE_CLASSIFIER_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        detected_tipo_equipo: {
            type: Type.STRING,
            description:
                'Nombre técnico exacto en español del TIPO de equipo o vehículo en singular y sin marcas ni modelos (ej. "MOTONIVELADORA", "BULLDOZER SOBRE ORUGAS", "CAMIONETA PICK-UP", "COMPRESOR DE AIRE", "PERFORADORA NEUMÁTICA MANUAL", "CHANCADOR DE MANDÍBULAS", "CAMIÓN PLUMA").',
        },
        detected_categoria_equipo: {
            type: Type.STRING,
            description:
                'Categoría funcional en MAYÚSCULAS (ej. "MOVIMIENTO DE TIERRA Y NIVELACIÓN", "TRANSPORTE Y VEHÍCULOS LIVIANOS", "ENERGÍA Y AIRE COMPRIMIDO", "PERFORACIÓN Y SONDAJE", "CONMINUCIÓN Y CHANCADO").',
        },
        needs_web_identification: {
            type: Type.BOOLEAN,
            description:
                'true únicamente si la combinación marca/modelo es desconocida o ambigua y requiere buscar primero en la web qué clase de máquina es.',
        },
    },
    required: ['detected_tipo_equipo', 'detected_categoria_equipo', 'needs_web_identification'],
};

const PASS2_TYPE_EXTRACTION_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        categoria_equipo: {
            type: Type.STRING,
            description:
                'Categoría funcional en MAYÚSCULAS (ej. MOVIMIENTO DE TIERRA, CARGUÍO Y TRANSPORTE, PERFORACIÓN Y SONDAJE, IZAJE, ENERGÍA Y AIRE COMPRIMIDO).',
        },
        ambiente_operativo: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
        },
        contexto_operativo: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
        },
        extracted_axes: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    axis_key: { type: Type.STRING },
                    value_si: {
                        type: Type.STRING,
                        nullable: true,
                        description:
                            'Magnitud física exacta en unidades métricas SI (ej. "136 kW (183 HP)", "3.700 mm", "8,5 m³/min", "7 bar", "4x4", "Levante vertical") o null si NO aparece explícitamente en la evidencia adjunta.',
                    },
                    source_url: {
                        type: Type.STRING,
                        nullable: true,
                        description:
                            'URL exacta tomada de la lista de FUENTES VERIFICADAS de donde proviene este dato, o null si no consta.',
                    },
                    verbatim_evidence: {
                        type: Type.STRING,
                        nullable: true,
                        description:
                            'Cita breve literal del extracto técnico que respalda la cifra extraída, o null si no consta.',
                    },
                },
                required: ['axis_key', 'value_si', 'source_url', 'verbatim_evidence'],
            },
        },
    },
    required: ['categoria_equipo', 'ambiente_operativo', 'contexto_operativo', 'extracted_axes'],
};

export interface EnrichCatalogOptions {
    globalAssetId?: string;
    forceFreshWeb?: boolean;
    preRetrievedEvidenceText?: string;
    preRetrievedSources?: GroundingSource[];
    preResolvedTypeDoc?: GlobalEquipmentTypeDoc;
}

export interface HomologationAxisDiff {
    axis_key: string;
    label_es: string;
    unit_hint: string;
    mandatory: boolean;
    is_differentiator?: boolean;
    current_value: string | null;
    suggested_value: string | null;
    source_url: string | null;
    verbatim_evidence: string | null;
    has_change: boolean;
}

export interface CatalogHomologationProposal {
    global_asset_id: string;
    make_oficial: string;
    model_oficial: string;
    equipment_type_key: string;
    type_origin: EquipmentTypeOrigin;
    reused_type_schema: boolean;
    archetype_id: MachineryArchetypeId;
    archetype_name_es: string;
    current_tipo_equipo: string;
    proposed_tipo_equipo: string;
    proposed_categoria_equipo: string;
    official_url: string;
    grounded_sources: GroundingSource[];
    had_legacy_marketing_prose: boolean;
    warnings: string[];
    axes_diff: HomologationAxisDiff[];
}

function isUsableSpecificTypeHint(raw?: string): boolean {
    if (!raw) return false;
    const clean = raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!clean || clean.length < 3 || clean.startsWith('[')) return false;
    return !FORBIDDEN_GENERIC_TYPES.has(clean);
}

async function resolveTargetEquipmentTypeForAsset(
    makeOficial: string,
    modelOficial: string,
    seedHint?: Partial<CatalogProfile>,
    preResolvedTypeDoc?: GlobalEquipmentTypeDoc
): Promise<{
    typeDoc: GlobalEquipmentTypeDoc;
    reusedExistingSchema: boolean;
}> {
    if (preResolvedTypeDoc) {
        return { typeDoc: preResolvedTypeDoc, reusedExistingSchema: true };
    }

    const assetContext = `${makeOficial} ${modelOficial}`.trim();

    if (seedHint?.equipment_type_key || isUsableSpecificTypeHint(seedHint?.tipo_equipo)) {
        const res = await resolveOrLearnEquipmentType({
            rawTypeKey: seedHint?.equipment_type_key,
            rawTypeHint: seedHint?.tipo_equipo,
            rawCategoryHint: seedHint?.categoria_equipo,
            assetQueryContext: assetContext,
        });
        return { typeDoc: res.typeDoc, reusedExistingSchema: res.reusedExistingSchema };
    }

    const explicitFromText = detectExplicitTypeFromQueryText(
        `${assetContext} ${seedHint?.tipo_equipo || ''}`
    );
    if (explicitFromText) {
        const res = await resolveOrLearnEquipmentType({
            rawTypeKey: explicitFromText.type_key,
            rawTypeHint: explicitFromText.canonical_type_es,
            rawCategoryHint: seedHint?.categoria_equipo,
            assetQueryContext: assetContext,
        });
        return { typeDoc: res.typeDoc, reusedExistingSchema: res.reusedExistingSchema };
    }

    // Clasificar primero el TIPO de equipo para saber qué ejes específicos buscar
    let detectedTipo = '';
    let detectedCategoria = seedHint?.categoria_equipo || '';
    try {
        const { data: classified } = await ResilientAIClient.generateStructured<{
            detected_tipo_equipo: string;
            detected_categoria_equipo: string;
            needs_web_identification: boolean;
        }>({
            module: 'opermaq',
            preferredTier: 'ANCHOR_HA',
            temperature: 0,
            topP: 1,
            topK: 1,
            maxOutputTokens: 512,
            responseSchema: QUICK_ASSET_TYPE_CLASSIFIER_SCHEMA,
            prompt: `Identifica con precisión técnica qué TIPO exacto de vehículo, maquinaria, equipo o herramienta es el activo:
- Marca: "${makeOficial}"
- Modelo / Código: "${modelOficial}"
${seedHint?.categoria_equipo ? `- Categoría preliminar: "${seedHint.categoria_equipo}"` : ''}

Devuelve en "detected_tipo_equipo" el nombre canónico singular en español del TIPO de activo sin incluir marca ni modelo (ej. "MOTONIVELADORA", "BULLDOZER SOBRE ORUGAS", "MINICARGADOR SOBRE NEUMÁTICOS", "CAMIONETA PICK-UP", "COMPRESOR DE AIRE", "PERFORADORA NEUMÁTICA MANUAL", "CHANCADOR DE MANDÍBULAS").`,
        });

        detectedTipo = String(classified.detected_tipo_equipo || '').trim();
        detectedCategoria = String(classified.detected_categoria_equipo || detectedCategoria).trim();

        if (classified.needs_web_identification || !isUsableSpecificTypeHint(detectedTipo)) {
            const webIdRes = await ResilientAIClient.generate({
                module: 'opermaq',
                preferredTier: 'SECONDARY',
                temperature: 0,
                useGoogleSearch: true,
                requireGroundedEvidence: true,
                maxOutputTokens: 1024,
                prompt: `Usa Google Search para identificar qué tipo exacto de vehículo, maquinaria, equipo industrial o herramienta es "${makeOficial} ${modelOficial}". Indica en una frase técnica concisa en español su clase exacta (ej. Motoniveladora, Compresor de aire portátil, Chancador de mandíbulas, Camioneta pick-up, Perforadora neumática manual).`,
            });
            const { data: reClassified } = await ResilientAIClient.generateStructured<{
                detected_tipo_equipo: string;
                detected_categoria_equipo: string;
                needs_web_identification: boolean;
            }>({
                module: 'opermaq',
                preferredTier: 'SECONDARY',
                temperature: 0,
                maxOutputTokens: 512,
                responseSchema: QUICK_ASSET_TYPE_CLASSIFIER_SCHEMA,
                prompt: `A partir de esta identificación web verificada para "${makeOficial} ${modelOficial}":
"""
${webIdRes.text.slice(0, 2000)}
"""
Extrae el nombre canónico exacto del TIPO de equipo en español singular sin marca ni modelo.`,
            });
            if (isUsableSpecificTypeHint(reClassified.detected_tipo_equipo)) {
                detectedTipo = reClassified.detected_tipo_equipo.trim();
                detectedCategoria = reClassified.detected_categoria_equipo || detectedCategoria;
            }
        }
    } catch {
        // Continuar con resolución/fallback en EquipmentTypeRegistryService
    }

    const res = await resolveOrLearnEquipmentType({
        rawTypeHint: detectedTipo || seedHint?.tipo_equipo || assetContext,
        rawCategoryHint: detectedCategoria,
        assetQueryContext: assetContext,
    });
    return { typeDoc: res.typeDoc, reusedExistingSchema: res.reusedExistingSchema };
}

export async function enrichCatalogProfile(
    makeOficial: string,
    modelOficial: string,
    seedHint?: Partial<CatalogProfile>,
    _isGeneric: boolean = false,
    options: EnrichCatalogOptions = {}
): Promise<CatalogProfile> {
    // FASE 1: Resolver (o aprender si es inédito) el esquema canónico exclusivo del TIPO de equipo
    const { typeDoc } = await resolveTargetEquipmentTypeForAsset(
        makeOficial,
        modelOficial,
        seedHint,
        options.preResolvedTypeDoc
    );

    const targetArchetypeId: MachineryArchetypeId =
        typeDoc.archetype_id || 'HERRAMIENTA_INDUSTRIAL_GENERAL';

    const requestedAxesGuide = typeDoc.spec_schema
        .map((ax) => {
            const enumInfo =
                ax.value_kind === 'CLOSED_ENUM' && ax.allowed_enum_values?.length
                    ? ` | valores válidos: ${ax.allowed_enum_values.join(' / ')}`
                    : ` | unidad SI requerida: ${ax.unit_si}`;
            const kwInfo = ax.search_keywords?.length
                ? ` (términos en ficha: ${ax.search_keywords.join(', ')})`
                : '';
            return `- "${ax.axis_key}" -> ${ax.label_es} [${ax.is_differentiator ? 'DIFERENCIADOR PRINCIPAL' : 'PRINCIPAL'}]${enumInfo}${kwInfo}`;
        })
        .join('\n');

    // FASE 2A: Consultar fragmentos PDF OEM ya ingeridos en el activo (si existe globalAssetId)
    let localEvidenceBlock = '';
    const allowedSourceUrls = new Set<string>();
    const collectedGroundingSources: GroundingSource[] = [];

    if (options.globalAssetId) {
        try {
            const schemaKeywords = typeDoc.spec_schema.map((a) => a.label_es).join(' ');
            const chunks = await SegmentedDocumentProcessorService.searchLocalAssetCorpus(
                options.globalAssetId,
                `${makeOficial} ${modelOficial} ${typeDoc.canonical_type_es} ${schemaKeywords}`,
                4
            );
            if (chunks.length > 0) {
                localEvidenceBlock = chunks
                    .map((c) => {
                        const corpusUri = `#corpus:${c.chunkId}`;
                        allowedSourceUrls.add(corpusUri);
                        collectedGroundingSources.push({
                            uri: corpusUri,
                            title: `${c.sourceFilename} (${c.title})`,
                        });
                        return `[FUENTE LOCAL ${corpusUri} — ${c.sourceFilename}]:\n${c.markdown.slice(0, 2000)}`;
                    })
                    .join('\n\n');
            }
        } catch {
            // Continuar con Google Search Grounding
        }
    }

    // FASE 2B: PASADA 1 — Búsqueda Web Grounded Focalizada en los parámetros exactos del TIPO
    let webEvidenceText = options.preRetrievedEvidenceText || '';
    if (options.preRetrievedSources && options.preRetrievedSources.length > 0) {
        for (const s of options.preRetrievedSources) {
            if (s.uri && !allowedSourceUrls.has(s.uri)) {
                allowedSourceUrls.add(s.uri);
                collectedGroundingSources.push(s);
            }
        }
    }

    if (!webEvidenceText || collectedGroundingSources.length === 0) {
        const pass1Prompt = `Actúa como Investigador Metrológico de Fichas Técnicas Oficiales OEM.
Consulta mediante Google Search la hoja de especificaciones oficial del fabricante (OEM Spec Sheet, ficha técnica oficial o catálogo técnico verificado) para el siguiente activo:
- Marca oficial: "${makeOficial}"
- Modelo / Serie: "${modelOficial}"
- TIPO CANÓNICO DE EQUIPO: "${typeDoc.canonical_type_es}" (${typeDoc.categoria_equipo})

TAREA EXCLUSIVA — BÚSQUEDA DIRIGIDA POR TIPO DE EQUIPO:
Para un equipo de tipo "${typeDoc.canonical_type_es}", busca y reporta en español técnico conciso ÚNICAMENTE las cifras reales comprobadas de estos ${typeDoc.spec_schema.length} parámetros específicos de su clase:
${requestedAxesGuide}

REGLAS ESTRICTAS:
1. NO busques ni reportes parámetros ajenos a "${typeDoc.canonical_type_es}".
2. Reporta valores exactos en unidades métricas SI (convirtiendo o conservando equivalencia métrica si la fuente está en sistema imperial).
3. Si alguno de los parámetros anteriores NO figura con cifra explícita en las fuentes web consultadas, escribe literalmente "NO DECLARADO EN FUENTE CONSULTADA".
4. PROHIBIDO incluir eslóganes comerciales, adjetivos promocionales ("mayor alcance", "alta eficiencia") o períodos históricos de fabricación.
5. PRESUPUESTO DE BÚSQUEDA GROUNDING (OPTIMIZACIÓN GEMINI 3.x): Ejecuta máximo 1 a 2 consultas de búsqueda consolidadas que combinen marca, modelo y palabras clave de la ficha técnica en una misma consulta.`;

        try {
            const pass1Res = await ResilientAIClient.generate({
                module: 'opermaq',
                preferredTier: 'SECONDARY',
                temperature: 0,
                useGoogleSearch: true,
                requireGroundedEvidence: localEvidenceBlock.length === 0,
                bypassCache: Boolean(options.forceFreshWeb),
                prompt: pass1Prompt,
            });

            webEvidenceText = pass1Res.text;
            for (const src of pass1Res.groundingSources) {
                if (src.uri && !allowedSourceUrls.has(src.uri)) {
                    allowedSourceUrls.add(src.uri);
                    collectedGroundingSources.push(src);
                }
            }
        } catch (err) {
            if (!(err instanceof UngroundedEvidenceError)) {
                console.warn(
                    `[CatalogProfileEnricher] Fallo en Pasada 1 Grounded para ${makeOficial} ${modelOficial} (${typeDoc.canonical_type_es}):`,
                    err
                );
            }
        }
    }

    // COMPUERTA FAIL-CLOSED ESTRICTA: Cero fuentes verificadas => Cero datos inventados
    if (collectedGroundingSources.length === 0 || (!localEvidenceBlock && !webEvidenceText.trim())) {
        const emptySlots = buildVerifiedSlotsForEquipmentType({
            typeDoc,
            rawExtractedAxes: [],
            allowedSourceUrls: new Set(),
            defaultVerifiedUrl: null,
        });
        return {
            equipment_type_key: typeDoc.type_key,
            archetype_id: targetArchetypeId,
            tipo_equipo: typeDoc.canonical_type_es,
            categoria_equipo: (seedHint?.categoria_equipo || typeDoc.categoria_equipo || 'EQUIPAMIENTO INDUSTRIAL')
                .trim()
                .toUpperCase(),
            canonical_specs: emptySlots,
            ambiente_operativo: seedHint?.ambiente_operativo?.length ? seedHint.ambiente_operativo : ['Superficie'],
            contexto_operativo: seedHint?.contexto_operativo?.length
                ? seedHint.contexto_operativo
                : ['Operación Industrial'],
            caracteristicas_principales: [MISSING_FULL_TECH_SPEC],
            grounded_sources: [],
        };
    }

    // FASE 3: PASADA 2 — Extracción Estructurada Determinista (`Temperature: 0`) sobre el esquema del TIPO
    const sourcesManifest = collectedGroundingSources
        .map((s, idx) => `[${idx + 1}] ${s.title} -> ${s.uri}`)
        .join('\n');

    const pass2Prompt = `Eres un Extractor Determinista de Ingeniería Mecánica (Temperatura 0, Tolerancia Cero a la Alucinación).
Estructura los parámetros físicos de "${makeOficial} ${modelOficial}" (TIPO CANÓNICO: "${typeDoc.canonical_type_es}") usando EXCLUSIVAMENTE la evidencia documental verificada adjunta abajo.

ESQUEMA OBLIGATORIO DEL TIPO "${typeDoc.canonical_type_es}" (devuelve una entrada en "extracted_axes" por cada "axis_key"):
${typeDoc.spec_schema
    .map((ax) => {
        const constraint =
            ax.value_kind === 'CLOSED_ENUM' && ax.allowed_enum_values?.length
                ? `Valor permitido exacto: uno de [${ax.allowed_enum_values.join(' | ')}]`
                : `Unidad métrica SI esperada: "${ax.unit_si}"`;
        return `- axis_key: "${ax.axis_key}" | Etiqueta: "${ax.label_es}" | ${constraint}`;
    })
    .join('\n')}

FUENTES VERIFICADAS DISPONIBLES (ÚNICAS URLS VÁLIDAS PARA "source_url"):
${sourcesManifest}

EVIDENCIA DOCUMENTAL RECUPERADA:
"""
${localEvidenceBlock ? `${localEvidenceBlock}\n\n` : ''}${webEvidenceText.slice(0, 14000)}
"""

REGLAS INVIOLABLES FAIL-CLOSED:
1. PROHIBIDO usar conocimiento externo o memoria interna fuera del bloque EVIDENCIA DOCUMENTAL RECUPERADA.
2. Si un eje ("axis_key") NO tiene cifra o configuración explícita en la evidencia adjunta (o dice "NO DECLARADO"), DEBES devolver "value_si": null, "source_url": null, "verbatim_evidence": null.
3. En "value_si" escribe ÚNICAMENTE la magnitud numérica con su unidad métrica SI (ej. "136 kW (183 HP)", "3.700 mm", "8,5 m³/min", "7 bar", "15.800 kg") o el valor exacto del enum técnico permitido. JAMÁS incluyas el nombre de la etiqueta dentro de "value_si".
4. PROHIBIDO escribir eslóganes comerciales, adjetivos promocionales o afirmaciones operacionales.
5. "source_url" DEBE ser exactamente una de las URLs listadas en FUENTES VERIFICADAS DISPONIBLES.`;

    try {
        const { data } = await ResilientAIClient.generateStructured<{
            categoria_equipo: string;
            ambiente_operativo: string[];
            contexto_operativo: string[];
            extracted_axes: Array<{
                axis_key: string;
                value_si: string | null;
                source_url: string | null;
                verbatim_evidence: string | null;
            }>;
        }>({
            module: 'opermaq',
            preferredTier: 'SECONDARY',
            temperature: 0,
            topP: 1,
            topK: 1,
            bypassCache: Boolean(options.forceFreshWeb),
            responseSchema: PASS2_TYPE_EXTRACTION_SCHEMA,
            prompt: pass2Prompt,
        });

        const defaultVerifiedUrl = collectedGroundingSources[0]?.uri || null;
        const canonicalSlots: CanonicalSpecSlot[] = buildVerifiedSlotsForEquipmentType({
            typeDoc,
            rawExtractedAxes: Array.isArray(data.extracted_axes) ? data.extracted_axes : [],
            allowedSourceUrls,
            defaultVerifiedUrl,
        });

        return {
            equipment_type_key: typeDoc.type_key,
            archetype_id: targetArchetypeId,
            tipo_equipo: typeDoc.canonical_type_es,
            categoria_equipo: (
                data.categoria_equipo ||
                seedHint?.categoria_equipo ||
                typeDoc.categoria_equipo ||
                'EQUIPAMIENTO INDUSTRIAL'
            )
                .trim()
                .toUpperCase(),
            canonical_specs: canonicalSlots,
            ambiente_operativo:
                Array.isArray(data.ambiente_operativo) && data.ambiente_operativo.length > 0
                    ? data.ambiente_operativo
                    : seedHint?.ambiente_operativo?.length
                    ? seedHint.ambiente_operativo
                    : ['Superficie'],
            contexto_operativo:
                Array.isArray(data.contexto_operativo) && data.contexto_operativo.length > 0
                    ? data.contexto_operativo
                    : seedHint?.contexto_operativo?.length
                    ? seedHint.contexto_operativo
                    : ['Operación Industrial'],
            caracteristicas_principales: serializeCanonicalSlotsToSpecsArray(canonicalSlots),
            grounded_sources: collectedGroundingSources.map((s) => s.uri),
        };
    } catch (err) {
        console.warn(
            `[CatalogProfileEnricher] Fallback Fail-Closed en Pasada 2 para ${makeOficial} ${modelOficial}:`,
            err
        );
        const emptySlots = buildVerifiedSlotsForEquipmentType({
            typeDoc,
            rawExtractedAxes: [],
            allowedSourceUrls: new Set(),
            defaultVerifiedUrl: null,
        });
        return {
            equipment_type_key: typeDoc.type_key,
            archetype_id: targetArchetypeId,
            tipo_equipo: typeDoc.canonical_type_es,
            categoria_equipo: (seedHint?.categoria_equipo || typeDoc.categoria_equipo || 'EQUIPAMIENTO INDUSTRIAL')
                .trim()
                .toUpperCase(),
            canonical_specs: emptySlots,
            ambiente_operativo: seedHint?.ambiente_operativo?.length ? seedHint.ambiente_operativo : ['Superficie'],
            contexto_operativo: seedHint?.contexto_operativo?.length
                ? seedHint.contexto_operativo
                : ['Operación Industrial'],
            caracteristicas_principales: [MISSING_FULL_TECH_SPEC],
            grounded_sources: collectedGroundingSources.map((s) => s.uri),
        };
    }
}

/**
 * Genera una propuesta comparativa HITL (`[Actual] ➔ [Sugerido Grounded]`) eje por eje
 * sobre el esquema canónico del `TIPO` (`global_equipment_types/{typeKey}`), sin mutar
 * `global_asset_catalog` hasta que un operador humano confirme con `"ACTUALIZAR"`.
 */
export async function proposeCatalogHomologation(
    globalAssetId: string,
    existingData: Record<string, any>
): Promise<CatalogHomologationProposal> {
    const makeOficial = String(existingData.make_oficial || existingData.make || 'GENÉRICO')
        .trim()
        .toUpperCase();
    const modelOficial = String(existingData.model_oficial || existingData.model || globalAssetId).trim();
    const isGeneric = Boolean(existingData.is_generic || makeOficial === 'GENÉRICO');

    const typeResolution = await resolveTargetEquipmentTypeForAsset(makeOficial, modelOficial, {
        equipment_type_key: existingData.equipment_type_key,
        tipo_equipo: existingData.tipo_equipo,
        categoria_equipo: existingData.categoria_equipo,
    });
    const { typeDoc, reusedExistingSchema } = typeResolution;

    const currentExtracted = extractHomologousAxisValues(existingData);
    const currentByKey = new Map(currentExtracted.slots.map((s) => [s.axis_key, s]));
    const currentByLabel = new Map(
        currentExtracted.slots.map((s) => [s.label_es.trim().toLowerCase(), s])
    );

    const enriched = await enrichCatalogProfile(
        makeOficial,
        modelOficial,
        {
            equipment_type_key: typeDoc.type_key,
            tipo_equipo: typeDoc.canonical_type_es,
            categoria_equipo: existingData.categoria_equipo || typeDoc.categoria_equipo,
            ambiente_operativo: existingData.ambiente_operativo,
            contexto_operativo: existingData.contexto_operativo,
        },
        isGeneric,
        {
            globalAssetId,
            forceFreshWeb: true,
            preResolvedTypeDoc: typeDoc,
        }
    );

    const proposedByKey = new Map((enriched.canonical_specs || []).map((s) => [s.axis_key, s]));

    const axesDiff: HomologationAxisDiff[] = typeDoc.spec_schema.map((axisDef) => {
        const curSlot =
            currentByKey.get(axisDef.axis_key) ||
            currentByLabel.get(axisDef.label_es.trim().toLowerCase());
        const cur = curSlot?.value_si || null;
        const sugSlot = proposedByKey.get(axisDef.axis_key);
        const sug = sugSlot?.value_si || null;
        return {
            axis_key: axisDef.axis_key,
            label_es: axisDef.label_es,
            unit_hint: axisDef.unit_si,
            mandatory: axisDef.mandatory,
            is_differentiator: axisDef.is_differentiator,
            current_value: cur,
            suggested_value: sug,
            source_url: sugSlot?.source_url || null,
            verbatim_evidence: sugSlot?.verbatim_evidence || null,
            has_change: (cur || MISSING_AXIS_VALUE) !== (sug || MISSING_AXIS_VALUE) && sug !== null,
        };
    });

    const warnings: string[] = [];
    if ((enriched.grounded_sources || []).length === 0) {
        warnings.push(
            'No se encontraron fichas técnicas web verificables en esta consulta; los ejes sin evidencia permanecen como [No declarado en ficha].'
        );
    }

    const hadLegacyMarketingProse = Boolean(existingData.caracteristica_diferenciadora);

    return {
        global_asset_id: globalAssetId,
        make_oficial: makeOficial,
        model_oficial: modelOficial,
        equipment_type_key: typeDoc.type_key,
        type_origin: typeDoc.origin,
        reused_type_schema: reusedExistingSchema,
        archetype_id: typeDoc.archetype_id || 'HERRAMIENTA_INDUSTRIAL_GENERAL',
        archetype_name_es: typeDoc.canonical_type_es,
        current_tipo_equipo: String(existingData.tipo_equipo || MISSING_FULL_TECH_SPEC),
        proposed_tipo_equipo: typeDoc.canonical_type_es,
        proposed_categoria_equipo: enriched.categoria_equipo,
        official_url: existingData.official_url || enriched.grounded_sources?.[0] || '',
        grounded_sources: (enriched.grounded_sources || []).map((uri) => ({ uri, title: uri })),
        had_legacy_marketing_prose: hadLegacyMarketingProse,
        warnings,
        axes_diff: axesDiff,
    };
}
