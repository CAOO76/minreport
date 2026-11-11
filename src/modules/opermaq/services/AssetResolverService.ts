import { createHash } from 'crypto';
import { db } from '../../../config/firebase';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { ResilientAIClient, Type } from '../../../core/resilient-ai-client';
import type {
    DisambiguationFacetGroup,
    EphemeralIdentificationImageInput,
    GlobalEquipmentTypeDoc,
    OpticalIdentificationSummary,
    ResolvedAssetCandidate,
} from '../types/vault.types';
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
    formatTransmissionCategoryLabelEs,
    inferAssetConfigurationProfile,
} from '../utils/lockedVariantDirective';
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
    optical_identification_summary?: OpticalIdentificationSummary | null;
    disambiguation_facets?: DisambiguationFacetGroup[];
    resolved_from_commons?: boolean;
    resolution_tier?: 'TIER_0_EXACT' | 'TIER_1_HYBRID_RRF' | 'TIER_2_WEB_DISCOVERY';
    resolution_latency_ms?: number;
    detected_equipment_type?: DetectedEquipmentTypeMetadata;
}

const EPHEMERAL_OPTICAL_IDENTIFICATION_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        detected_make: {
            type: Type.STRING,
            nullable: true,
            description:
                'Marca oficial del fabricante leída en placa metálica, emblema frontal/lateral, código WMI o cabina en MAYÚSCULAS (ej. "MACK", "CATERPILLAR", "KOMATSU", "ATLAS COPCO"), o null si no es identificable.',
        },
        detected_model_or_series: {
            type: Type.STRING,
            nullable: true,
            description:
                'Modelo o serie exacta leída en placa de datos, insignia de puerta/capó o código VDS (ej. "GU813E", "GRANITE GU813", "272D XHP", "336D2 L"), SIN números de serie individuales ni años.',
        },
        wmi_vds_structural_code: {
            type: Type.STRING,
            nullable: true,
            description:
                'ÚNICAMENTE las posiciones estructurales 1 a 8 del VIN/PIN (WMI + VDS que codifican fabricante, línea, ejes y motorización). PROHIBIDO extraer los dígitos finales de serie individual de la unidad.',
        },
        observed_axle_or_undercarriage: {
            type: Type.STRING,
            nullable: true,
            description:
                'Configuración física de ejes/ruedas u orugas verificada visualmente o en placa FAWR/RAWR (ej. "8x4 (4 ejes: doble direccional delantero + tándem trasero)", "6x4 (3 ejes)", "4x4", "Orugas de acero LGP", "Portátil remolcable 1 eje"), o null.',
        },
        observed_transmission: {
            type: Type.STRING,
            nullable: true,
            description:
                'Tipo y modelo exacto de transmisión/caja leído en placa de transmisión/chasis o en controles de cabina (ej. "Automática Allison 4500 RDS (selector botonera)", "Automatizada Mack mDRIVE", "Manual Eaton Fuller Roadranger 18 vel.", "Hidrostática"), o null.',
        },
        observed_work_body_or_implement: {
            type: Type.STRING,
            nullable: true,
            description:
                'Carrocería vocacional u órgano de trabajo visible o estampado en placa (ej. "Tolva minera/roquera ~20 m³", "Estanque aljibe", "Trompo mixer", "Quinta rueda tractocamión", "Hidráulica High-Flow XHP"), o null.',
        },
        observed_engine_or_rating: {
            type: Type.STRING,
            nullable: true,
            description:
                'Motorización o capacidad nominal leída en placa (ej. "Mack MP8 440 HP", "CAT C3.8 73 kW", "500 kVA · 400 V"), o null.',
        },
        observed_emission_or_grid: {
            type: Type.STRING,
            nullable: true,
            description:
                'Norma de emisiones de fábrica o frecuencia eléctrica leída en etiqueta EPA/ECE/motor (ej. "EPA Tier 4 Interim / Stage IIIB (DPF)", "Euro V SCR", "50 Hz"), o null.',
        },
        evidence_notes_es: {
            type: Type.STRING,
            nullable: true,
            description:
                'Síntesis técnica aséptica de 1 línea explicando qué evidencia visual permitió determinar la variante (PROHIBIDO incluir patentes, RUT, nombres de empresas o números de serie).',
        },
        confidence: {
            type: Type.STRING,
            enum: ['HIGH', 'MEDIUM', 'LOW'],
        },
    },
    required: [
        'detected_make',
        'detected_model_or_series',
        'wmi_vds_structural_code',
        'observed_axle_or_undercarriage',
        'observed_transmission',
        'observed_work_body_or_implement',
        'observed_engine_or_rating',
        'observed_emission_or_grid',
        'evidence_notes_es',
        'confidence',
    ],
};

/**
 * Decodificador Óptico Efímero RAM-Only (Ley N° 21.719):
 * Inspecciona de 1 a 3 imágenes en memoria volátil (placas OEM/VIN, placa de caja/motor, selector de cabina o foto 3/4)
 * exclusivamente para identificar el modelo y su configuración mecánica exacta, purgando cualquier PII/serie individual
 * y sin persistir jamás los bytes en Cloud Storage ni Firestore.
 */
async function decodeEphemeralEquipmentEvidence(
    ephemeralImages: EphemeralIdentificationImageInput[],
    rawQuery: string,
    clarificationContext?: string
): Promise<OpticalIdentificationSummary | null> {
    if (!Array.isArray(ephemeralImages) || ephemeralImages.length === 0) {
        return null;
    }

    const validMedia = ephemeralImages
        .slice(0, 3)
        .filter((img) => img && typeof img.base64Data === 'string' && img.base64Data.length > 32)
        .map((img) => ({
            mimeType: img.mimeType,
            dataBase64: img.base64Data.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, ''),
        }));

    if (validMedia.length === 0) return null;

    const scrubField = (val: string | null | undefined): string | null => {
        if (!val || !String(val).trim()) return null;
        const { scrubbed } = ConfidentialityAirlockService.scrubIdentificationPlateAndVinText(String(val));
        return scrubbed || null;
    };

    try {
        const { data } = await ResilientAIClient.generateStructured<OpticalIdentificationSummary>({
            module: 'opermaq',
            preferredTier: 'PRIMARY',
            thinkingLevel: 'medium',
            temperature: 0,
            maxOutputTokens: 1536,
            bypassCache: true,
            media: validMedia,
            responseSchema: EPHEMERAL_OPTICAL_IDENTIFICATION_SCHEMA,
            prompt: `Actúa como Perito Forense de Identificación de Maquinaria y Vehículos Industriales (OEM Data Plate & Morphology Decoder).
Analiza las ${validMedia.length} imagen(es) efímera(s) adjuntadas por el usuario para identificar con exactitud el modelo y la configuración mecánica de fábrica del equipo a registrar en el Catálogo Técnico.
${rawQuery ? `- Texto base ingresado por el usuario: "${rawQuery}"` : ''}
${clarificationContext ? `- Contexto técnico adicional del usuario: "${clarificationContext}"` : ''}

INSTRUCCIONES FORENSES DE LECTURA MULTIMODAL (TOLERANCIA CERO A LA ALUCINACIÓN):
1. PLACAS METÁLICAS OEM / VIN / PIN / PLACAS DE TRANSMISIÓN O MOTOR:
   - Si hay una placa de datos del fabricante, lee exactamente la Marca, Código de Modelo/Variante, Código de Motor, Código de Transmisión/Caja (ej. Allison, Eaton Fuller, Mack mDRIVE, Volvo I-Shift, ZF, Powershift, Hidrostática), capacidades por eje (FAWR/RAWR) y etiquetas de emisión/frecuencia (EPA Tier / EU Stage / Euro / Hz).
   - PRIVACIDAD LEY 21.719: Si observas un código VIN/PIN de 17 caracteres, extrae en "wmi_vds_structural_code" ÚNICAMENTE las posiciones 1 a 8 (WMI + VDS estructural). JAMÁS transcribas los dígitos finales de serie individual de la unidad, patentes vehiculares (PPU) ni nombres de empresas/contratistas.
2. MORFOLOGÍA EXTERIOR E INTERIOR DE CABINA:
   - Si es una fotografía exterior del equipo, CUENTA CON PRECISIÓN QUIRÚRGICA los ejes y configuración de rodado: distingue sin error entre 8x4 (4 ejes: 2 ejes direccionales delanteros + 2 traseros), 6x4 (3 ejes: 1 direccional delantero + 2 traseros), 4x4, 4x2, orugas LGP/LC o equipo estacionario/remolcable.
   - Identifica la carrocería u órgano de trabajo montado (ej. Tolva minera/roquera y volumen si es visible, Aljibe, Trompo mixer, Pluma articulada, Quinta rueda, Hidráulica auxiliar High-Flow XHP).
   - Si muestra el interior de cabina o selector de cambios, distingue entre botonera automática (Allison), selector rotativo/palanca AMT sin pedal de embrague (mDRIVE / I-Shift / Opticruise / TraXon), palanca manual con splitter/rango Eaton Fuller y pedal de embrague, o joysticks hidrostáticos.
3. Si un atributo NO es visible ni deducible con certeza de las imágenes, devuelve null en ese campo.`,
        });

        const rawWmi = data.wmi_vds_structural_code
            ? String(data.wmi_vds_structural_code).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8)
            : null;

        return {
            detected_make: scrubField(data.detected_make)?.toUpperCase() || null,
            detected_model_or_series: scrubField(data.detected_model_or_series)?.toUpperCase() || null,
            wmi_vds_structural_code: rawWmi && rawWmi.length >= 3 ? rawWmi : null,
            observed_axle_or_undercarriage: scrubField(data.observed_axle_or_undercarriage),
            observed_transmission: scrubField(data.observed_transmission),
            observed_work_body_or_implement: scrubField(data.observed_work_body_or_implement),
            observed_engine_or_rating: scrubField(data.observed_engine_or_rating),
            observed_emission_or_grid: scrubField(data.observed_emission_or_grid),
            evidence_notes_es: scrubField(data.evidence_notes_es),
            confidence: data.confidence || 'MEDIUM',
        };
    } catch (err: any) {
        console.warn('[OPERMAQ-OPTICAL-ID] Decodificación óptica efímera degradada:', err?.message);
        return null;
    }
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
        suggested_quick_refinements: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
            description:
                'Solo cuando requires_clarification = true: entre 3 y 6 opciones concretas de series o tipos reales para que el usuario refine con 1 clic (ej. si escribió "Mack" -> ["MACK GRANITE GU813 8X4 TOLVA", "MACK GRANITE GU813 6X4", "MACK ANTHEM 6X4 TRACTO", "MACK MD"]). En caso contrario devuelve null.',
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
                            'CONDICIONES DE DISEÑO (2 a 4 viñetas telegráficas <= 12 palabras cada una, 100% presencia positiva verificada): motor/norma real de fábrica (ej. "Motor Cat C3.8 DIT — EPA Tier 4 Interim / EU Stage IIIB"), certificaciones estructurales (ROPS ISO 3471 / FOPS ISO 3449, presurización) y circuito hidromecánico/térmico real. PROHIBIDO declarar subsistemas inexistentes ("sin SCR/AdBlue", "no aplica"), PROHIBIDO usar marketing ("confort del operador", "alto rendimiento", "alta demanda") y PROHIBIDO repetir tautológicamente el TIPO del equipo.',
                    },
                    contexto_operativo: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description:
                            'CONTEXTO Y TRABAJO (2 a 3 viñetas telegráficas <= 12 palabras cada una, 100% verificadas en fuente OEM): labores reales e implementos/carrozados compatibles. PROHIBIDO inventar duraciones de turno ("ciclos de 8 a 10 horas", "factores de carga medios") o usar frases vacías ("Operación Técnica", "Operación Industrial").',
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
                    configuration_hints: {
                        type: Type.OBJECT,
                        nullable: true,
                        properties: {
                            axle_or_undercarriage: {
                                type: Type.STRING,
                                nullable: true,
                                description:
                                    'Configuración de ejes o tren de rodaje de esta variante específica (ej. "8x4", "6x4", "4x4", "Orugas LGP"), o null.',
                            },
                            transmission_spec: {
                                type: Type.STRING,
                                nullable: true,
                                description:
                                    'Tipo y modelo de caja/transmisión de esta variante específica (ej. "Automática Allison 4500 RDS 6 vel.", "Automatizada Mack mDRIVE 12 vel.", "Manual Eaton Fuller 18 vel.", "Hidrostática 2 vel.", "Powershift"), o null.',
                            },
                            work_body_or_implement: {
                                type: Type.STRING,
                                nullable: true,
                                description:
                                    'Carrocería u órgano de trabajo diferenciador de esta variante (ej. "Tolva 20 m³", "Tractocamión quinta rueda", "Hidráulica XHP"), o null.',
                            },
                            factory_emission_or_grid: {
                                type: Type.STRING,
                                nullable: true,
                                description:
                                    'Norma de emisión de fábrica o frecuencia eléctrica declarada en la ficha OEM de esta variante (ej. "EPA Tier 4 Interim / EU Stage IIIB (DPF)", "Euro V SCR", "50 Hz"), o null.',
                            },
                        },
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
    requestedTransmissionFamily:
        | 'AUTOMATICA'
        | 'AUTOMATIZADA_AMT'
        | 'MANUAL_FULLER'
        | 'MANUAL'
        | 'POWERSHIFT'
        | 'HIDROSTATICA'
        | 'ELECTRICA'
        | null;
    requestedTransmissionBrand: string | null;
    requestedBodyCapacity: string | null;
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

    const tractionMatch = combined.match(
        /\b(10X6|10X4|8X8|8X6|8X4|6X6|6X4|6X2|4X4|4X2|AWD|4WD|2WD)\b/
    );
    let requestedTraction = tractionMatch ? tractionMatch[1] : null;
    if (requestedTraction === '4WD') requestedTraction = '4X4';
    if (requestedTraction === '2WD') requestedTraction = '4X2';

    let requestedTransmissionFamily: QueryTechnicalConstraints['requestedTransmissionFamily'] = null;
    let requestedTransmissionBrand: string | null = null;

    if (/\bALLISON\b/.test(combined)) {
        requestedTransmissionFamily = 'AUTOMATICA';
        requestedTransmissionBrand = 'ALLISON';
    } else if (/\b(M-?DRIVE|I-?SHIFT|OPTICRUISE|TRAXON|AS[- ]?TRONIC|ULTRASHIFT|ENDURANT|DT12)\b/.test(combined)) {
        const m = combined.match(/\b(M-?DRIVE|I-?SHIFT|OPTICRUISE|TRAXON|AS[- ]?TRONIC|ULTRASHIFT|ENDURANT|DT12)\b/);
        requestedTransmissionFamily = 'AUTOMATIZADA_AMT';
        requestedTransmissionBrand = m ? m[1].replace('-', '') : null;
    } else if (/\b(FULLER|ROADRANGER|RTLO-?\d{4,5})\b/.test(combined)) {
        requestedTransmissionFamily = 'MANUAL_FULLER';
        requestedTransmissionBrand = 'EATON FULLER';
    } else if (/\b(AUTOMATIZAD[AO]|\bAMT\b)\b/.test(combined)) {
        requestedTransmissionFamily = 'AUTOMATIZADA_AMT';
    } else if (
        /\b(AUTOMATIC[AO]|CONVERTIDOR\s+DE\s+PAR|\b\d{1,2}\s*AT\b)\b/.test(combined) &&
        !/\b(ENGRASE\s+AUTOMATICO|LUBRICACION\s+AUTOMATICA|APAGADO\s+AUTOMATICO)\b/.test(combined)
    ) {
        requestedTransmissionFamily = 'AUTOMATICA';
    } else if (/\b(CAJA\s+MANUAL|TRANSMISION\s+MANUAL|CAMBIO\s+MANUAL|MANUAL\s+\d{1,2}\s*VEL|\b\d{1,2}\s*MT\b|MECANICA)\b/.test(combined)) {
        requestedTransmissionFamily = 'MANUAL';
    } else if (/\b(POWERSHIFT|SERVOTRANSMISION|TORQFLOW)\b/.test(combined)) {
        requestedTransmissionFamily = 'POWERSHIFT';
    } else if (/\bHIDROSTATIC[AO]\b/.test(combined)) {
        requestedTransmissionFamily = 'HIDROSTATICA';
    }

    let requestedBodyCapacity: string | null = null;
    const m3Match = combined.match(/\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:M3|M³|METROS?\s+CUBICOS?)\b/);
    if (m3Match) {
        const val = m3Match[1].replace(',', '.');
        requestedBodyCapacity = /\b(MIXER|BETONERA|HORMIGONERA)\b/.test(combined)
            ? `MIXER ${val}M3`
            : `TOLVA ${val}M3`;
    } else if (/\bTOLVA\b/.test(combined)) {
        requestedBodyCapacity = 'TOLVA';
    } else if (/\bALJIBE|CISTERNA\b/.test(combined)) {
        requestedBodyCapacity = 'ALJIBE';
    } else if (/\bXHP\b/.test(combined)) {
        requestedBodyCapacity = 'XHP';
    }

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

    const dispMatch = combined.match(/\b(\d[.,]\d)\s*(?:L|LITROS?|D|HDI|TDI|THP)\b/);
    const requestedDisplacement = dispMatch ? `${dispMatch[1].replace(',', '.')}L` : null;

    const clarificationText = clarificationContext?.trim() ? clarificationContext.trim() : null;
    const hasExplicitConstraints = Boolean(
        requestedYear ||
            requestedTraction ||
            requestedTransmissionFamily ||
            requestedBodyCapacity ||
            requestedFuel ||
            requestedDisplacement ||
            clarificationText
    );

    return {
        requestedYear,
        requestedTraction,
        requestedTransmissionFamily,
        requestedTransmissionBrand,
        requestedBodyCapacity,
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
            `- CONFIGURACIÓN DE EJES / TRACCIÓN OBLIGATORIA: ${constraints.requestedTraction}. Queda ESTRICTAMENTE PROHIBIDO devolver candidatos de otra configuración de ejes (ej. si solicitó 8X4, EXCLUYE 6X4, 6X2 y 4X2; si solicitó 6X4, EXCLUYE 8X4 y 4X2).`
        );
    }
    if (constraints.requestedTransmissionFamily) {
        const brandNote = constraints.requestedTransmissionBrand ? ` (${constraints.requestedTransmissionBrand})` : '';
        if (constraints.requestedTransmissionFamily === 'AUTOMATICA') {
            rules.push(
                `- TRANSMISIÓN / CAJA OBLIGATORIA: AUTOMÁTICA${brandNote} (ej. Allison con convertidor de par y/o automatizada OEM sin pedal de embrague como mDRIVE/I-Shift si la marca las comercializa para este chasis, diferenciándolas claramente). EXCLUYE cajas manuales Eaton Fuller o mecánicas con pedal de embrague.`
            );
        } else if (constraints.requestedTransmissionFamily === 'AUTOMATIZADA_AMT') {
            rules.push(
                `- TRANSMISIÓN / CAJA OBLIGATORIA: AUTOMATIZADA AMT${brandNote} (ej. Mack mDRIVE, Volvo I-Shift, Scania Opticruise, ZF TraXon). EXCLUYE cajas manuales no automatizadas.`
            );
        } else if (constraints.requestedTransmissionFamily === 'MANUAL_FULLER') {
            rules.push(
                '- TRANSMISIÓN / CAJA OBLIGATORIA: MANUAL NO SINCRONIZADA EATON FULLER / ROADRANGER. EXCLUYE cajas automáticas Allison o automatizadas.'
            );
        } else if (constraints.requestedTransmissionFamily === 'MANUAL') {
            rules.push(
                '- TRANSMISIÓN / CAJA OBLIGATORIA: MANUAL / MECÁNICA. EXCLUYE cajas automáticas con convertidor de par.'
            );
        }
    }
    if (constraints.requestedBodyCapacity) {
        rules.push(
            `- CARROCERÍA / ÓRGANO DE TRABAJO SOLICITADO: ${constraints.requestedBodyCapacity}. Refleja esta configuración vocacional y volumen exacto en el candidato.`
        );
    }
    if (constraints.requestedYear) {
        rules.push(
            `- AÑO DE REFERENCIA TÉCNICA: ${constraints.requestedYear}. Incluye ÚNICAMENTE las versiones y motorizaciones vigentes y comercializadas en el año ${constraints.requestedYear}. JAMÁS escribas el año ni frases como "desde 2020 a la actualidad" dentro del nombre del modelo.`
        );
    }
    if (constraints.requestedDisplacement) {
        rules.push(`- CILINDRADA / MOTOR SOLICITADO: ${constraints.requestedDisplacement}.`);
    }
    if (constraints.clarificationText) {
        rules.push(
            `- ESPECIFICACIÓN ADICIONAL / EVIDENCIA DEL USUARIO (PRIORIDAD MÁXIMA): "${constraints.clarificationText}".`
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

    if (constraints.requestedTraction) {
        const reqAxle = constraints.requestedTraction.toUpperCase();
        const allAxles = ['10X6', '10X4', '8X8', '8X6', '8X4', '6X6', '6X4', '6X2', '4X4', '4X2'];
        if (allAxles.includes(reqAxle)) {
            const mentionsReq = new RegExp(`\\b${reqAxle}\\b`).test(norm);
            const mentionsOtherAxle = allAxles
                .filter((ax) => ax !== reqAxle)
                .some((ax) => new RegExp(`\\b${ax}\\b`).test(norm));
            if (mentionsOtherAxle && !mentionsReq) {
                return true;
            }
        }
        if (reqAxle === '4X4' && /\b(2WD|TRACCION\s+SIMPLE)\b/.test(norm) && !/\b4X4\b/.test(norm)) {
            return true;
        }
    }

    if (constraints.requestedTransmissionFamily === 'AUTOMATICA') {
        if (
            /\b(MANUAL\s+FULLER|EATON\s+FULLER|ROADRANGER|CAJA\s+MANUAL|TRANSMISION\s+MANUAL|\bMT6\b|\b6MT\b)\b/.test(
                norm
            ) &&
            !/\b(AUTOMATICA|AUTOMATIC|ALLISON|M-?DRIVE|I-?SHIFT|OPTICRUISE|AMT)\b/.test(norm)
        ) {
            return true;
        }
    } else if (constraints.requestedTransmissionFamily === 'AUTOMATIZADA_AMT') {
        if (
            /\b(MANUAL\s+FULLER|EATON\s+FULLER|ROADRANGER|CAJA\s+MANUAL)\b/.test(norm) &&
            !/\b(AUTOMATIZADA|AMT|M-?DRIVE|I-?SHIFT|OPTICRUISE|TRAXON)\b/.test(norm)
        ) {
            return true;
        }
    } else if (
        constraints.requestedTransmissionFamily === 'MANUAL_FULLER' ||
        constraints.requestedTransmissionFamily === 'MANUAL'
    ) {
        if (
            /\b(AUTOMATICA|ALLISON|CONVERTIDOR\s+DE\s+PAR|\bAT6\b|\b6AT\b)\b/.test(norm) &&
            !/\b(MANUAL|FULLER|ROADRANGER|MECANICA)\b/.test(norm)
        ) {
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

    return `Usa Google Search para investigar en fichas técnicas oficiales OEM globales (100% Worldwide OEM: US/EPA, Europa/Stage, LATAM, Asia y exportación directa), hojas de especificaciones de fabricantes y registros técnicos verificados el siguiente activo:
- Búsqueda original del usuario: "${rawInput}"
${canonicalTarget ? `- Identidad corregida objetivo: "${canonicalTarget}"` : ''}
${designator ? `- Designador alfanumérico detectado: "${designator}"` : ''}
- TIPO CANÓNICO DE EQUIPO DETECTADO: "${typeDoc.canonical_type_es}" (${typeDoc.categoria_equipo})
${clarificationContext ? `- Contexto técnico / evidencia de placa aportada: "${clarificationContext}"` : ''}
${constraintsDirective}
INSTRUCCIONES DE INVESTIGACIÓN WEB GLOBAL FOCALIZADA POR TIPO (CENSO EXHAUSTIVO 1..N SIN RESTRICCIÓN GEOGRÁFICA):
1. REGLA GLOBAL-FIRST NO-RESTRICTIVA (SOPORTE DE IMPORTACIÓN DIRECTA):
   - Consulta SIEMPRE el catálogo mundial completo del fabricante. JAMÁS excluyas ni ocultes un modelo por no comercializarse en un país específico (ej. equipos importados directamente como "CAT 272D / 272D XHP" EPA Tier 4i, camiones norteamericanos o europeos). Reporta siempre su configuración real de fábrica sin inventar variantes locales inexistentes.
2. CENSO EXHAUSTIVO Y DESGLOSE DE CONFIGURACIONES MECÁNICAS DIFERENCIADORAS (EJES, TRANSMISIÓN/CAJA, CARROCERÍA/IMPLEMENTO):
   - Si el modelo existe en múltiples configuraciones mecánicas reales de fábrica (ej. en camiones vocacionales como "MACK GU813 / GRANITE": chasis "6x4" vs "8x4", cajas "Automática Allison 4500 RDS" vs "Automatizada Mack mDRIVE" vs "Manual Eaton Fuller 18 vel.", y carrozados como "Tolva minera 20 m³" vs "Tractocamión"; en maquinaria: hidráulica estándar vs "XHP", tren "XL" vs "LGP", o normas de motorización distintas como "Tier 3 / Euro V sin DPF" vs "EPA Tier 4 / Stage V con DPF"), DEBES listar y desglosar explícitamente CADA CONFIGURACIÓN que cumpla las restricciones solicitadas por el usuario.
   - Si el usuario especificó configuración (ej. "GU813 8x4 20 m³ automática"), investiga focalizadamente las configuraciones 8x4 con tolva ~20 m³ y transmisión automática/automatizada disponibles en ese modelo (ej. Allison serie 4000/4500 RDS y Mack mDRIVE HD), reportando con exactitud el tipo y modelo de caja, configuración de 4 ejes (8x4) y capacidad de tolva.
   - PROHIBICIÓN ABSOLUTA DE RANGOS TEMPORALES EN NOMBRES: Jamás agregues frases como "(desde 2020 a la actualidad)", "(2020-presente)" ni rangos de años a los nombres de modelos o versiones.
3. BÚSQUEDA EXCLUSIVA DE LAS CARACTERÍSTICAS DE "${typeDoc.canonical_type_es}" Y CONDICIONES DE DISEÑO / TRABAJO:
   Para cada configuración, versión o serie identificada, busca en las fichas técnicas OEM:
   A) Los ${typeDoc.spec_schema.length} parámetros principales y diferenciadores establecidos para "${typeDoc.canonical_type_es}" (incluyendo obligatoriamente tipo/modelo de transmisión/caja, configuración de ejes/rodaje si aplica y consumos energéticos):
${axesInstructions}
   B) CONDICIONES DE DISEÑO (ambiente_operativo): motor/norma de emisiones o frecuencia real de fábrica (Tier/Stage/Euro/Hz), certificaciones estructurales (ROPS/FOPS, presurización, IP) y circuito hidráulico/térmico equipado (100% presencia positiva: PROHIBIDO listar subsistemas que NO equipa como "sin SCR/AdBlue", PROHIBIDO usar "confort" o repetir el TIPO).
   C) CONTEXTO Y TRABAJO (contexto_operativo): labores técnicas reales y carrocerías/implementos compatibles declarados por el OEM (PROHIBIDO inventar turnos de "8 a 10 horas").
4. CERO PARÁMETROS CRUZADOS, FORMATO DENSO Y CERO PROSA PUBLICITARIA:
   - Formato ultra-compacto: presenta máximo 3 a 4 líneas densas por cada variante/configuración con sus cifras SI, transmisión exacta, ejes, condiciones de diseño y fuente.
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
                    ? `Valor permitido (puedes especificar código OEM si es caja de cambios, ej. "Automática (Allison 4500 RDS)" o "Manual Eaton Fuller (18 vel.)"): [${ax.allowed_enum_values.join(' | ')}]`
                    : `Unidad métrica SI requerida: "${ax.unit_si}"`;
            return `- axis_key: "${ax.axis_key}" | Etiqueta: "${ax.label_es}" | ${constraint}`;
        })
        .join('\n');

    const constraintsDirective = formatConstraintsDirective(constraints);

    return `Eres un Extractor Determinista de Catálogo Técnico OEM Global (Temperatura 0, Tolerancia Cero a la Alucinación, Cero Restricción Geográfica y Cero Colisión de Variantes 1..N).
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

REGLAS ESTRICTAS FAIL-CLOSED (1..N SIN RESTRICCIÓN DE CANTIDAD NI COLAPSO DE VARIANTES):
1. "is_pertinent": true para cualquier vehículo, maquinaria, compresor, generador, perforadora, chancador, bomba, grúa, equipo industrial o herramienta. Solo false para artículos domésticos/personales ajenos.
2. DESGLOSE DE CANDIDATOS SELECCIONABLES CON IDENTIDAD MECÁNICA EXPLÍCITA EN "model_oficial":
   - PROHIBIDO colapsar configuraciones mecánicas distintas en un único candidato genérico: si el informe describe variantes con distinta configuración de ejes ("6X4" vs "8X4"), distinto tipo/familia de transmisión ("AUTOMATICA ALLISON" vs "AUTOMATIZADA MDRIVE" vs "MANUAL FULLER"), distinta carrocería/capacidad ("TOLVA 20M3" vs "TRACTO") o paquete hidráulico/rodaje ("272D" vs "272D XHP", "D6T XL" vs "D6T LGP"), DEBES emitir CADA CONFIGURACIÓN REAL como un candidato independiente e incluir los diferenciadores en "model_oficial" (ej. "GU813E 8X4 TOLVA 20M3 AUTOMATICA ALLISON", "GU813E 8X4 TOLVA 20M3 AUTOMATIZADA MDRIVE", "GU813E 6X4 MANUAL FULLER"; o "272D", "272D XHP").
   - Respeta estrictamente las restricciones del usuario: si el usuario pidió "8x4" y "automática", NO emitas candidatos "6x4" ni "Manual".
   - Rellena siempre "configuration_hints" con la configuración exacta de ejes/rodaje, tipo/modelo de caja, carrocería/implemento y norma de emisión/frecuencia declarada para ese candidato.
   - PROHIBICIÓN ABSOLUTA DE RUIDO TEMPORAL: Jamás incluyas años, rangos de años ni frases como "(desde 2020 a la actualidad)" o "(2020-presente)" en "model_oficial" ni en "versions".
   - En modo OEM, normaliza "make_oficial" a la marca oficial corregida en MAYÚSCULAS (ej. "PEUGUEOT" -> "PEUGEOT", "CAT" -> "CATERPILLAR").
3. EXTRACCIÓN EXACTA DE "extracted_axes", "ambiente_operativo" (CONDICIONES DE DISEÑO) Y "contexto_operativo" (CONTEXTO Y TRABAJO):
   - Devuelve en "extracted_axes" una entrada por cada "axis_key" del esquema de "${typeDoc.canonical_type_es}".
   - En "value_si" escribe ÚNICAMENTE la cifra con su unidad métrica SI (ej. "328 kW (440 HP)", "20 m³", "8x4", "Automática (Allison 4500 RDS)") sin repetir el nombre de la etiqueta.
   - En "ambiente_operativo" extrae de 2 a 4 viñetas telegráficas (<= 12 palabras) de CONDICIONES DE DISEÑO con 100% presencia positiva (motor/emisiones reales, certificaciones ROPS/FOPS/IP y circuito hidráulico/térmico). PROHIBIDO mencionar qué subsistemas NO posee el equipo ("sin SCR/AdBlue", "no aplica"), PROHIBIDO usar términos subjetivos ("confort", "alto rendimiento", "alta demanda") y PROHIBIDO repetir tautológicamente "${typeDoc.canonical_type_es}".
   - En "contexto_operativo" extrae de 2 a 3 viñetas telegráficas (<= 12 palabras) de CONTEXTO Y TRABAJO (aplicaciones reales e implemento/carrozado compatible). PROHIBIDO inventar duraciones de turno ("8 a 10 horas").
   - Si un eje NO aparece con dato explícito en el informe verificado (o dice NO DECLARADO), devuelve "value_si": null, "source_url": null, "verbatim_evidence": null.
   - "source_url" y "official_url" DEBEN ser URLs literales tomadas de FUENTES WEB VERIFICADAS DISPONIBLES.`;
}

interface RawPass2Candidate {
    make_oficial: string;
    model_oficial: string;
    configuration_hints?: {
        axle_or_undercarriage?: string | null;
        transmission_category?: string | null;
        transmission_spec?: string | null;
        transmission_model?: string | null;
        work_body_or_implement?: string | null;
        factory_emission_or_grid?: string | null;
        emission_or_regulation?: string | null;
        power_grid_spec?: string | null;
    } | null;
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
}

function candidateCorpusViolatesConstraints(
    candidate: {
        model_oficial?: string;
        caracteristicas_principales?: string[];
        configuration_profile?: {
            axle_or_undercarriage_config?: string | null;
            transmission_category?: string | null;
            transmission_model_spec?: string | null;
            work_body_or_implement?: string | null;
        } | null;
    },
    constraints: QueryTechnicalConstraints
): boolean {
    if (!constraints.hasExplicitConstraints) return false;
    const parts = [
        candidate.model_oficial || '',
        ...(Array.isArray(candidate.caracteristicas_principales) ? candidate.caracteristicas_principales : []),
        candidate.configuration_profile?.axle_or_undercarriage_config || '',
        candidate.configuration_profile?.transmission_model_spec || '',
        candidate.configuration_profile?.work_body_or_implement || '',
    ].join(' ');
    if (textViolatesConstraints(parts, constraints)) return true;

    if (constraints.requestedTransmissionFamily && candidate.configuration_profile?.transmission_category) {
        const cat = candidate.configuration_profile.transmission_category;
        if (cat !== 'NOT_APPLICABLE') {
            const req = constraints.requestedTransmissionFamily;
            let catMatches = true;
            if (req === 'AUTOMATICA') {
                catMatches = cat === 'AUTOMATIC_PLANETARY_CONVERTER' || cat === 'AUTOMATED_MANUAL_AMT';
            } else if (req === 'AUTOMATIZADA_AMT') {
                catMatches = cat === 'AUTOMATED_MANUAL_AMT';
            } else if (req === 'MANUAL_FULLER') {
                catMatches = cat === 'MANUAL_UNSYNCHRONIZED_FULLER' || cat === 'MANUAL_SYNCHRONIZED';
            } else if (req === 'MANUAL') {
                catMatches = cat === 'MANUAL_SYNCHRONIZED' || cat === 'MANUAL_UNSYNCHRONIZED_FULLER';
            } else if (req === 'HIDROSTATICA') {
                catMatches = cat === 'HYDROSTATIC';
            } else if (req === 'POWERSHIFT') {
                catMatches = cat === 'POWERSHIFT';
            }
            if (!catMatches) return true;
        }
    }
    return false;
}

function conciseTransmissionToken(
    hints?: RawPass2Candidate['configuration_hints']
): string | null {
    const modelUpper = String(hints?.transmission_spec || hints?.transmission_model || '').toUpperCase();
    if (/\bALLISON\b/.test(modelUpper)) return 'ALLISON';
    if (/\bM[\s-]?DRIVE\b/.test(modelUpper)) return 'MDRIVE';
    if (/\bI[\s-]?SHIFT\b/.test(modelUpper)) return 'I-SHIFT';
    if (/\bOPTICRUISE\b/.test(modelUpper)) return 'OPTICRUISE';
    if (/\bTRAXON\b/.test(modelUpper)) return 'TRAXON';
    if (/\bPOWERSHIFT\b/.test(modelUpper)) return 'POWERSHIFT';
    if (/\b(FULLER|EATON|ROADRANGER)\b/.test(modelUpper)) return 'FULLER';
    if (/\b(AUTOMATICA|AUTOMATIC)\b/.test(modelUpper)) return 'AUTO';
    if (/\b(AUTOMATIZADA|AMT)\b/.test(modelUpper)) return 'AMT';
    const catUpper = String(hints?.transmission_category || '').toUpperCase();
    if (catUpper === 'AUTOMATIC_PLANETARY_CONVERTER') return 'AUTO';
    if (catUpper === 'AUTOMATED_MANUAL_AMT') return 'AMT';
    if (catUpper === 'MANUAL_UNSYNCHRONIZED_FULLER') return 'FULLER';
    if (catUpper === 'MANUAL_SYNCHRONIZED') return 'MANUAL';
    return null;
}

function conciseWorkBodyToken(rawBody: string | null | undefined): string | null {
    if (!rawBody) return null;
    const upper = rawBody
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
    const m3Match = upper.match(/\b(\d{1,2}(?:[.,]\d)?)\s*(?:M3|METROS?\s+CUBICOS?)\b/);
    const volSuffix = m3Match ? ` ${m3Match[1].replace(',', '.')}M3` : '';
    if (/\b(TOLVA|VOLQUETE|DUMP)\b/.test(upper)) return `TOLVA${volSuffix}`;
    if (/\b(TRACTO|QUINTA\s+RUEDA)\b/.test(upper)) return 'TRACTO';
    if (/\b(ALJIBE|CISTERNA)\b/.test(upper)) return `ALJIBE${volSuffix}`;
    if (/\b(MIXER|BETONERA|HORMIGONERA)\b/.test(upper)) return `MIXER${volSuffix}`;
    if (/\bLUBRICADOR\b/.test(upper)) return 'LUBRICADOR';
    if (/\bXHP\b/.test(upper)) return 'XHP';
    return null;
}

function disambiguateSiblingCandidateModels(
    candidates: RawPass2Candidate[],
    constraints: QueryTechnicalConstraints,
    opticalSummary: OpticalIdentificationSummary | null
): RawPass2Candidate[] {
    if (candidates.length === 0) return candidates;

    const distinctAxles = new Set(
        candidates
            .map((c) => {
                const m = String(c.configuration_hints?.axle_or_undercarriage || '').match(/\b(4x2|4x4|6x2|6x4|6x6|8x4|8x6|8x8|10x4|10x6)\b/i);
                return m ? m[1].toUpperCase() : '';
            })
            .filter(Boolean)
    );
    const distinctBodies = new Set(
        candidates.map((c) => conciseWorkBodyToken(c.configuration_hints?.work_body_or_implement) || '').filter(Boolean)
    );

    const firstPass = candidates.map((c) => {
        let model = normalizeModelCode(c.model_oficial);
        const axleMatch = String(c.configuration_hints?.axle_or_undercarriage || '').match(
            /\b(4x2|4x4|6x2|6x4|6x6|8x4|8x6|8x8|10x4|10x6)\b/i
        );
        const axleToken = axleMatch ? axleMatch[1].toUpperCase() : null;
        if (
            axleToken &&
            !model.includes(axleToken) &&
            (distinctAxles.size > 1 ||
                Boolean(constraints.requestedTraction) ||
                Boolean(opticalSummary?.observed_axle_or_undercarriage))
        ) {
            model = normalizeModelCode(`${model} ${axleToken}`);
        }

        const bodyToken = conciseWorkBodyToken(c.configuration_hints?.work_body_or_implement);
        if (
            bodyToken &&
            !model.includes(bodyToken.split(' ')[0]) &&
            (distinctBodies.size > 1 ||
                Boolean(constraints.requestedBodyCapacity) ||
                Boolean(opticalSummary?.observed_work_body_or_implement))
        ) {
            model = normalizeModelCode(`${model} ${bodyToken}`);
        }

        return {
            ...c,
            model_oficial: model,
        };
    });

    const modelCounts = new Map<string, number>();
    for (const c of firstPass) {
        const key = `${String(c.make_oficial || '').toUpperCase()}::${c.model_oficial}`;
        modelCounts.set(key, (modelCounts.get(key) || 0) + 1);
    }

    return firstPass.map((c) => {
        const key = `${String(c.make_oficial || '').toUpperCase()}::${c.model_oficial}`;
        const hasCollision = (modelCounts.get(key) || 0) > 1;
        const txToken = conciseTransmissionToken(c.configuration_hints);
        if (
            txToken &&
            !c.model_oficial.includes(txToken) &&
            (hasCollision ||
                Boolean(constraints.requestedTransmissionFamily) ||
                Boolean(opticalSummary?.observed_transmission))
        ) {
            return {
                ...c,
                model_oficial: normalizeModelCode(`${c.model_oficial} ${txToken}`),
            };
        }
        return c;
    });
}

export function buildDisambiguationFacets(candidates: ResolvedAssetCandidate[]): DisambiguationFacetGroup[] {
    if (!Array.isArray(candidates) || candidates.length < 2) return [];

    const facets: DisambiguationFacetGroup[] = [];

    const collectGroup = (
        facetKey: DisambiguationFacetGroup['facet_key'],
        labelEs: string,
        helperEs: string | undefined,
        extractor: (c: ResolvedAssetCandidate) => string | null | undefined
    ) => {
        const counts = new Map<string, { label: string; count: number }>();
        for (const c of candidates) {
            const rawVal = extractor(c);
            const cleanVal = String(rawVal || '').trim();
            if (!cleanVal || cleanVal.startsWith('[')) continue;
            const normKey = cleanVal.toUpperCase();
            const prev = counts.get(normKey);
            if (prev) {
                prev.count += 1;
            } else {
                counts.set(normKey, { label: cleanVal.slice(0, 56), count: 1 });
            }
        }
        if (counts.size >= 2) {
            facets.push({
                facet_key: facetKey,
                label_es: labelEs,
                ...(helperEs ? { helper_es: helperEs } : {}),
                options: [
                    { value: 'ALL', label_es: 'Todas', candidate_count: candidates.length },
                    ...Array.from(counts.entries()).map(([normKey, entry]) => ({
                        value: normKey,
                        label_es: entry.label,
                        candidate_count: entry.count,
                    })),
                ],
            });
        }
    };

    collectGroup(
        'axle_config',
        'Ejes / Rodaje',
        undefined,
        (c) => c.configuration_profile?.axle_or_undercarriage_config
    );
    collectGroup('transmission', 'Transmisión / Caja', undefined, (c) => {
        const p = c.configuration_profile;
        if (!p) return null;
        if (p.transmission_model_spec) return p.transmission_model_spec;
        if (p.transmission_category && p.transmission_category !== 'NOT_APPLICABLE') {
            return formatTransmissionCategoryLabelEs(p.transmission_category);
        }
        return null;
    });
    collectGroup(
        'work_body',
        'Carrocería / Implemento',
        undefined,
        (c) => c.configuration_profile?.work_body_or_implement
    );
    collectGroup(
        'emission_or_spec_origin',
        'Norma OEM de Fábrica',
        'Informativo no restrictivo (incluye importación directa)',
        (c) => {
            const spec = c.configuration_profile?.factory_emission_or_grid_spec;
            if (!spec || /\b(?:50|60)\s*hz\b/i.test(spec)) return null;
            return spec;
        }
    );
    collectGroup('power_grid', 'Frecuencia / Red', undefined, (c) => {
        const spec = c.configuration_profile?.factory_emission_or_grid_spec;
        const m = String(spec || '').match(/\b(50\s*Hz|60\s*Hz|50\s*\/\s*60\s*Hz)\b/i);
        return m ? m[1] : null;
    });

    return facets;
}

export async function resolveMachineryCandidates(
    jerga: string,
    isGeneric: boolean = false,
    clarificationContext?: string,
    forceWebDiscovery: boolean = false,
    ephemeralImages?: EphemeralIdentificationImageInput[]
): Promise<AssetResolutionResponse> {
    const hasEphemeralImages = Array.isArray(ephemeralImages) && ephemeralImages.length > 0;
    const opticalSummary = hasEphemeralImages
        ? await decodeEphemeralEquipmentEvidence(ephemeralImages!, jerga.trim(), clarificationContext)
        : null;

    let cleanInput = jerga.trim();
    if (opticalSummary) {
        const opticalMakeModel = [opticalSummary.detected_make, opticalSummary.detected_model_or_series]
            .filter(Boolean)
            .join(' ')
            .trim();
        if (!cleanInput && opticalMakeModel) {
            cleanInput = opticalMakeModel;
        } else if (
            cleanInput &&
            !detectModelDesignator(cleanInput) &&
            opticalSummary.detected_model_or_series &&
            !cleanInput.toUpperCase().includes(opticalSummary.detected_model_or_series.toUpperCase())
        ) {
            cleanInput = `${cleanInput} ${opticalSummary.detected_model_or_series}`.trim();
        }
    }

    const opticalEvidenceParts = opticalSummary
        ? [
              opticalSummary.detected_make ? `Marca placa/visual: ${opticalSummary.detected_make}` : '',
              opticalSummary.detected_model_or_series
                  ? `Modelo/Serie placa/visual: ${opticalSummary.detected_model_or_series}`
                  : '',
              opticalSummary.wmi_vds_structural_code
                  ? `WMI/VDS estructural (1-8): ${opticalSummary.wmi_vds_structural_code}`
                  : '',
              opticalSummary.observed_axle_or_undercarriage
                  ? `Ejes/Rodaje verificado: ${opticalSummary.observed_axle_or_undercarriage}`
                  : '',
              opticalSummary.observed_transmission
                  ? `Transmisión/Caja verificada: ${opticalSummary.observed_transmission}`
                  : '',
              opticalSummary.observed_work_body_or_implement
                  ? `Carrocería/Implemento verificado: ${opticalSummary.observed_work_body_or_implement}`
                  : '',
              opticalSummary.observed_engine_or_rating
                  ? `Motor/Capacidad placa: ${opticalSummary.observed_engine_or_rating}`
                  : '',
              opticalSummary.observed_emission_or_grid
                  ? `Norma emisión/red fábrica: ${opticalSummary.observed_emission_or_grid}`
                  : '',
          ].filter(Boolean)
        : [];

    const effectiveClarification =
        [
            clarificationContext ? clarificationContext.trim() : '',
            opticalEvidenceParts.length > 0
                ? `EVIDENCIA ÓPTICA EFÍMERA VERIFICADA (${opticalSummary?.confidence}): ${opticalEvidenceParts.join(' | ')}`
                : '',
        ]
            .filter(Boolean)
            .join('\n') || undefined;

    if (!cleanInput || cleanInput.length < 2) {
        return {
            requires_clarification: true,
            clarification_message:
                'No fue posible leer marca o código de modelo nítido en las imágenes adjuntas. Indique marca/modelo o adjunte una placa de datos legible.',
            candidates: [],
            optical_identification_summary: opticalSummary,
            disambiguation_facets: [],
        };
    }

    validateIndustrialDomain(cleanInput);
    const constraints = extractQueryTechnicalConstraints(cleanInput, effectiveClarification);
    const bypassLineageAndCache =
        forceWebDiscovery ||
        Boolean(effectiveClarification) ||
        hasEphemeralImages ||
        constraints.hasExplicitConstraints;

    // ── COMPUERTA COLABORATIVA DE LINAJE COMPLETO (< 30 ms, $0 IA, 0 Duplicados) ──
    if (!bypassLineageAndCache) {
        const lineageHit = await readCollaborativeLineage(cleanInput, isGeneric);
        const hasV95Profiles =
            lineageHit.candidates.length > 0 &&
            lineageHit.candidates.every((c) => Boolean(c.configuration_profile));
        if (lineageHit.matched && hasV95Profiles) {
            return {
                requires_clarification: false,
                candidates: lineageHit.candidates,
                optical_identification_summary: opticalSummary,
                disambiguation_facets: buildDisambiguationFacets(lineageHit.candidates),
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
        `${cleanInput} ${effectiveClarification || ''}`
    );
    const deterministicBrandModelType = !isGeneric
        ? detectDeterministicEquipmentTypeFromBrandAndModel(cleanInput)
        : null;

    let correctedMake = isGeneric
        ? 'GENÉRICO'
        : opticalSummary?.detected_make || deterministicBrandModelType?.correctedMake || '';
    let correctedModelOrFamily =
        deterministicBrandModelType?.correctedModel ||
        opticalSummary?.detected_model_or_series ||
        designator ||
        cleanInput;
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
                suggested_quick_refinements?: string[];
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
                maxOutputTokens: 896,
                bypassCache: bypassLineageAndCache,
                responseSchema: STEP1_PRIMARY_TYPE_DETECTION_SCHEMA,
                prompt: `Analiza la siguiente solicitud de búsqueda/registro de activo en OPERMAQ (Alcance Global Worldwide OEM, sin restricción geográfica por país):
- Texto ingresado: "${cleanInput}"
- Modo: ${isGeneric ? 'GENÉRICO (sin marca obligatoria)' : 'MARCA / MODELO OEM'}
${designator ? `- Código alfanumérico detectado: "${designator}"` : ''}
${explicitTypeInQuery ? `- Tipo explícito detectado en texto: "${explicitTypeInQuery.canonical_type_es}"` : ''}
${effectiveClarification ? `- Contexto técnico / evidencia óptica adicional: "${effectiveClarification}"` : ''}

TAREA PRIMARIA (PASO 1):
1. Valida pertinencia ("is_pertinent": true para cualquier vehículo liviano/pesado, maquinaria, compresor, generador, perforadora, chancador, grúa, bomba, equipo o herramienta; false solo para objetos domésticos/personales ajenos).
2. Verifica si requiere aclaración ("requires_clarification": true solo si escribió únicamente una marca suelta sin modelo ni tipo, p. ej. solo "Caterpillar" o solo "Mack", o una palabra vacía como "máquina"). Si "requires_clarification" es true, rellena "suggested_quick_refinements" con 3 a 6 líneas/modelos representativos de esa marca para selección en 1 clic.
3. Corrige errores ortográficos de marca y modelo base (ej. "PEUGUEOT LANDTRECK 4X4 DIESEL 2022" -> marca "PEUGEOT", modelo "LANDTREK"; "CAT 272D" -> marca "CATERPILLAR", modelo "272D"; "MACK GU813 8X4" -> marca "MACK", modelo "GU813").
4. Identifica en "detected_tipo_equipo" el TIPO canónico exacto de equipo en español singular MAYÚSCULAS (ej. "CAMIÓN TOLVA", "MINICARGADOR", "MOTONIVELADORA", "CAMIONETA PICK-UP", "COMPRESOR DE AIRE", "PERFORADORA NEUMÁTICA MANUAL", "EXCAVADORA HIDRÁULICA").`,
            });

            if (step1.is_pertinent === false) {
                throw new DomainRejectionError(
                    step1.rejection_reason ||
                    `"${cleanInput}" corresponde a un artículo doméstico o de consumo personal ajeno a vehículos, maquinaria o equipamiento técnico.`
                );
            }

            if (step1.requires_clarification === true && !effectiveClarification) {
                const quickOptions = Array.isArray(step1.suggested_quick_refinements)
                    ? step1.suggested_quick_refinements.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 6)
                    : [];
                return {
                    requires_clarification: true,
                    clarification_message:
                        step1.clarification_message ||
                        'La búsqueda es demasiado amplia. Especifique modelo, serie o tipo específico de equipo.',
                    candidates: [],
                    optical_identification_summary: opticalSummary,
                    disambiguation_facets:
                        quickOptions.length > 0
                            ? [
                                  {
                                      facet_key: 'model_family',
                                      label_es: 'Líneas / Modelos Frecuentes',
                                      helper_es: 'Seleccione una línea en 1 clic o ingrese el modelo exacto',
                                      options: quickOptions.map((opt) => ({
                                          value: opt,
                                          label_es: opt,
                                      })),
                                  },
                              ]
                            : [],
                };
            }

            const rawMakeUpper = String(step1.corrected_make || '').trim().toUpperCase();
            correctedMake = isGeneric
                ? 'GENÉRICO'
                : BRAND_SYNONYM_TO_OFFICIAL[rawMakeUpper] || rawMakeUpper || correctedMake;
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

    // Segunda verificación de Linaje Colaborativo post-corrección ortográfica
    if (!bypassLineageAndCache && correctedMake && correctedModelOrFamily) {
        const canonicalLineageHit = await readCollaborativeLineage(cleanInput, isGeneric, {
            make: correctedMake,
            model: correctedModelOrFamily,
        });
        const hasV95Profiles =
            canonicalLineageHit.candidates.length > 0 &&
            canonicalLineageHit.candidates.every((c) => Boolean(c.configuration_profile));
        if (canonicalLineageHit.matched && hasV95Profiles) {
            return {
                requires_clarification: false,
                candidates: canonicalLineageHit.candidates,
                optical_identification_summary: opticalSummary,
                disambiguation_facets: buildDisambiguationFacets(canonicalLineageHit.candidates),
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
                bypassCache: bypassLineageAndCache,
                prompt: `Usa Google Search en alcance mundial (Global OEM, incluyendo modelos de otros mercados e importación directa) para identificar qué clase o tipo exacto de vehículo, maquinaria, equipo industrial o herramienta corresponde a "${cleanInput}"${effectiveClarification ? ` (${effectiveClarification})` : ''}. Responde en español técnico conciso indicando marca oficial, modelo y el TIPO exacto de máquina.`,
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

    // ── PASO 3 (PASADA 1 GROUNDED): Búsqueda Web Global OEM Dirigida a los Ejes y Variantes Diferenciadoras + Caché SHA-256 v4 ──
    const pass1Prompt = buildTypeScopedGroundedResearchPrompt({
        rawInput: cleanInput,
        correctedMake,
        correctedModelOrFamily,
        isGeneric,
        designator,
        typeDoc: activeTypeDoc,
        clarificationContext: effectiveClarification,
        constraints,
    });

    const groundedCacheKey = createHash('sha256')
        .update(
            JSON.stringify({
                v: 4,
                make: correctedMake.toUpperCase(),
                model: correctedModelOrFamily.toUpperCase(),
                typeKey: activeTypeDoc.type_key,
                isGeneric,
                query: cleanInput.toUpperCase().replace(/\s+/g, ' '),
                constraints: {
                    traction: constraints.requestedTraction,
                    tx: constraints.requestedTransmissionFamily,
                    txBrand: constraints.requestedTransmissionBrand,
                    body: constraints.requestedBodyCapacity,
                },
            })
        )
        .digest('hex');

    const GROUNDED_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    let pass1Response: {
        text: string;
        groundingSources: Array<{ title: string; uri: string }>;
    } | null = null;

    if (!forceWebDiscovery && !effectiveClarification) {
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
                bypassCache: forceWebDiscovery || Boolean(effectiveClarification),
                prompt: pass1Prompt,
            });
            pass1Response = {
                text: liveResponse.text,
                groundingSources: liveResponse.groundingSources,
            };

            if (!effectiveClarification && liveResponse.groundingSources.length > 0) {
                await db
                    .collection('ai_grounded_discovery_cache')
                    .doc(groundedCacheKey)
                    .set({
                        cacheKey: groundedCacheKey,
                        schemaVersion: 4,
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
            const filteredFallback = localFallback.candidates.filter(
                (c) => !candidateCorpusViolatesConstraints(c, constraints)
            );
            if (localFallback.matched && filteredFallback.length > 0) {
                return {
                    requires_clarification: false,
                    candidates: filteredFallback,
                    optical_identification_summary: opticalSummary,
                    disambiguation_facets: buildDisambiguationFacets(filteredFallback),
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
        candidates: RawPass2Candidate[];
    }>({
        module: 'opermaq',
        preferredTier: 'SECONDARY',
        thinkingLevel: 'none',
        temperature: 0,
        topP: 1,
        topK: 1,
        maxOutputTokens: 32768,
        bypassCache: forceWebDiscovery || Boolean(effectiveClarification),
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
            optical_identification_summary: opticalSummary,
            disambiguation_facets: [],
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
        .filter((c) => {
            const hintCorpus = [
                c.model_oficial,
                c.configuration_hints?.axle_or_undercarriage || '',
                c.configuration_hints?.transmission_spec || c.configuration_hints?.transmission_model || '',
                c.configuration_hints?.work_body_or_implement || '',
            ].join(' ');
            return !textViolatesConstraints(hintCorpus, constraints);
        });

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

    const disambiguatedRawCandidates = disambiguateSiblingCandidateModels(
        expandedRawCandidates,
        constraints,
        opticalSummary
    );

    // Procesar el 100% de los candidatos (concurrencia controlada = 4)
    const resolvedCandidates = await mapWithConcurrency(
        disambiguatedRawCandidates,
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

                const resolvedSlots = hasSelfDescribingTypeSchema(existingData)
                    ? existingData.canonical_specs
                    : homologous.slots;

                const existingTraits =
                    existingData.physical_traits ||
                    activeTypeDoc.physical_traits ||
                    AssetOntologyEngine.inferAssetPhysicalTraits({
                        type_key: existingData.equipment_type_key || activeTypeDoc.type_key,
                        canonical_type_es: existingData.tipo_equipo || activeTypeDoc.canonical_type_es,
                        categoria_equipo: existingData.categoria_equipo || activeTypeDoc.categoria_equipo,
                        canonical_specs: resolvedSlots,
                    });

                const existingConfigProfile = inferAssetConfigurationProfile({
                    make_oficial: existingData.make_oficial || existingData.make || safeMake,
                    model_oficial: cleanExistingModel || safeModel,
                    tipo_equipo: existingData.tipo_equipo || activeTypeDoc.canonical_type_es,
                    categoria_equipo: existingData.categoria_equipo || activeTypeDoc.categoria_equipo,
                    version: existingData.version || existingVersions[0] || undefined,
                    versions: existingVersions,
                    canonical_specs: resolvedSlots,
                    caracteristicas_principales: serializeCanonicalSlotsToSpecsArray(homologous.slots),
                    ambiente_operativo: existingData.ambiente_operativo,
                    contexto_operativo: existingData.contexto_operativo,
                    physical_traits: existingTraits,
                    existing_profile: existingData.configuration_profile || null,
                    optical_summary: opticalSummary,
                    identification_source: hasEphemeralImages ? 'MULTIMODAL_PLATE_AND_PHOTO' : 'GROUNDED_OEM_SPEC',
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
                    configuration_profile: existingConfigProfile,
                    canonical_specs: resolvedSlots,
                    ambiente_operativo: sanitizeDesignAndWorkContextItems(
                        raw.ambiente_operativo,
                        existingData.ambiente_operativo,
                        { canonicalTypeEs: existingData.tipo_equipo || activeTypeDoc.canonical_type_es }
                    ),
                    contexto_operativo: sanitizeDesignAndWorkContextItems(
                        raw.contexto_operativo,
                        existingData.contexto_operativo,
                        { canonicalTypeEs: existingData.tipo_equipo || activeTypeDoc.canonical_type_es }
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
                    ambiente_operativo: sanitizeDesignAndWorkContextItems(raw.ambiente_operativo, undefined, {
                        canonicalTypeEs: activeTypeDoc.canonical_type_es,
                    }),
                    contexto_operativo: sanitizeDesignAndWorkContextItems(raw.contexto_operativo, undefined, {
                        canonicalTypeEs: activeTypeDoc.canonical_type_es,
                    }),
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

            const rawHints = raw.configuration_hints || undefined;
            const hintTransmissionCat =
                rawHints?.transmission_category &&
                [
                    'MANUAL_SYNCHRONIZED',
                    'MANUAL_UNSYNCHRONIZED_FULLER',
                    'AUTOMATED_MANUAL_AMT',
                    'AUTOMATIC_PLANETARY_CONVERTER',
                    'POWERSHIFT',
                    'HYDROSTATIC',
                    'ELECTRIC_DRIVE',
                    'DIRECT_MECHANICAL',
                    'NOT_APPLICABLE',
                ].includes(rawHints.transmission_category)
                    ? (rawHints.transmission_category as any)
                    : undefined;

            const candidateConfigProfile = inferAssetConfigurationProfile({
                make_oficial: safeMake,
                model_oficial: safeModel,
                tipo_equipo: profile.tipo_equipo || activeTypeDoc.canonical_type_es,
                categoria_equipo: profile.categoria_equipo || activeTypeDoc.categoria_equipo,
                version: candidateVersions[0] || undefined,
                versions: candidateVersions,
                canonical_specs: profile.canonical_specs || verifiedSlots,
                caracteristicas_principales: profile.caracteristicas_principales,
                ambiente_operativo: profile.ambiente_operativo,
                contexto_operativo: profile.contexto_operativo,
                physical_traits: candidateTraits,
                optical_summary: opticalSummary,
                existing_profile: {
                    axle_or_undercarriage_config:
                        rawHints?.axle_or_undercarriage || opticalSummary?.observed_axle_or_undercarriage || null,
                    transmission_category: hintTransmissionCat || null,
                    transmission_model_spec:
                        rawHints?.transmission_spec ||
                        rawHints?.transmission_model ||
                        opticalSummary?.observed_transmission ||
                        null,
                    work_body_or_implement:
                        rawHints?.work_body_or_implement || opticalSummary?.observed_work_body_or_implement || null,
                    factory_emission_or_grid_spec:
                        rawHints?.factory_emission_or_grid ||
                        rawHints?.emission_or_regulation ||
                        rawHints?.power_grid_spec ||
                        opticalSummary?.observed_emission_or_grid ||
                        null,
                },
                identification_source: hasEphemeralImages ? 'MULTIMODAL_PLATE_AND_PHOTO' : 'GROUNDED_OEM_SPEC',
            });

            return {
                make_oficial: safeMake,
                model_oficial: safeModel,
                ...profile,
                physical_traits: candidateTraits,
                configuration_profile: candidateConfigProfile,
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
        .map((c) => {
            const enrichedLocalProfile =
                c.configuration_profile ||
                inferAssetConfigurationProfile({
                    make_oficial: c.make_oficial,
                    model_oficial: c.model_oficial,
                    tipo_equipo: c.tipo_equipo,
                    categoria_equipo: c.categoria_equipo,
                    versions: c.versions,
                    canonical_specs: c.canonical_specs,
                    caracteristicas_principales: c.caracteristicas_principales,
                    ambiente_operativo: c.ambiente_operativo,
                    contexto_operativo: c.contexto_operativo,
                    physical_traits: c.physical_traits || null,
                });
            return {
                ...c,
                model_oficial: normalizeModelCode(c.model_oficial),
                configuration_profile: enrichedLocalProfile,
                versions: Array.isArray(c.versions)
                    ? c.versions
                        .map((v) => stripTemporalAndHistoricalNoise(String(v || '')))
                        .filter((v) => Boolean(v) && !textViolatesConstraints(v, constraints))
                    : ['ESTÁNDAR'],
            };
        })
        .filter((c) => {
            if (candidateCorpusViolatesConstraints(c, constraints)) return false;
            if (
                hasSpecificSubmodels &&
                correctedModelOrFamily &&
                c.model_oficial === normalizeModelCode(correctedModelOrFamily)
            ) {
                return false;
            }
            return true;
        });

    const filteredResolvedCandidates = resolvedCandidates.filter(
        (c) => !candidateCorpusViolatesConstraints(c, constraints)
    );
    const combinedCandidates = [
        ...(filteredResolvedCandidates.length > 0 ? filteredResolvedCandidates : resolvedCandidates),
        ...compatibleLocalCandidates,
    ];

    const seenKeys = new Set<string>();
    let uniqueCandidates = combinedCandidates.filter((c) => {
        const key = c.catalog_key || normalizeCatalogKey(c.make_oficial, c.model_oficial);
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
    });

    if (uniqueCandidates.length > 0 && !effectiveClarification && !constraints.hasExplicitConstraints) {
        uniqueCandidates = await saveCollaborativeLineage(cleanInput, isGeneric, uniqueCandidates, {
            make: correctedMake,
            model: correctedModelOrFamily,
        });
    }

    return {
        requires_clarification: false,
        candidates: uniqueCandidates,
        optical_identification_summary: opticalSummary,
        disambiguation_facets: buildDisambiguationFacets(uniqueCandidates),
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
