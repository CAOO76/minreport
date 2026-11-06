import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../../config/firebase';
import { ResilientAIClient } from '../../../core/resilient-ai-client';
import type { ResolvedAssetCandidate } from '../types/vault.types';
import {
    extractHomologousAxisValues,
    MISSING_FULL_TECH_SPEC,
    serializeCanonicalSlotsToSpecsArray,
} from '../utils/canonicalArchetypeSpecs';
import { normalizeCatalogKey } from '../utils/domainGuard';

/**
 * CANONICAL ENTITY RESOLVER v4.0 (Zero-Search Collaborative Commons Gate)
 *
 * Objetivo Soberano MINREPORT:
 * Cuando cualquier usuario registra un equipo (ej. "CAT 242 D"), queda indexado una sola vez
 * en `global_asset_catalog` (`caterpillar_242d`). Cuando otro cliente consulta "cat 242d",
 * "CAT 242 D", "minicargador 242-d" o "Caterpillar 242D", este motor resuelve localmente
 * en < 35 ms con $0 costo IA, 0 búsquedas web redundantes y 0 duplicados.
 *
 * Capas de Resolución Híbrida:
 * - Tier 0 (< 15 ms): Clave determinista `catalog_key` + `search_aliases` + `model_designator` canónico.
 * - Tier 1 (< 35 ms): Fusión Híbrida `RRF` (Léxica `search_tokens` + Vectorial `768d` Matryoshka con
 *   `.findNearest` nativo o coseno en proceso sobre candidatos locales).
 * - Candado Anti-Falso-Positivo: Si la consulta contiene un designador explícito (ej. "246D"),
 *   jamás sustituye por un modelo vecino distinto ("242D"), permitiendo que modelos genuinamente
 *   nuevos pasen a descubrimiento OEM.
 */

export const BRAND_SYNONYM_TO_OFFICIAL: Record<string, string> = {
    CAT: 'CATERPILLAR',
    CATERPILAR: 'CATERPILLAR',
    CATERPILLAR: 'CATERPILLAR',
    KOMATSU: 'KOMATSU',
    KOMATZU: 'KOMATSU',
    JD: 'JOHN DEERE',
    DEERE: 'JOHN DEERE',
    'JOHN DEERE': 'JOHN DEERE',
    MB: 'MERCEDES-BENZ',
    MERCEDES: 'MERCEDES-BENZ',
    'MERCEDES BENZ': 'MERCEDES-BENZ',
    'MERCEDES-BENZ': 'MERCEDES-BENZ',
    VW: 'VOLKSWAGEN',
    VOLKSWAGEN: 'VOLKSWAGEN',
    VOLKSWAGUEN: 'VOLKSWAGEN',
    VOLVO: 'VOLVO',
    EPIROC: 'EPIROC',
    EPIROK: 'EPIROC',
    SANDVIK: 'SANDVIK',
    ATLAS: 'ATLAS COPCO',
    'ATLAS COPCO': 'ATLAS COPCO',
    BOBCAT: 'BOBCAT',
    LIEBHERR: 'LIEBHERR',
    JCB: 'JCB',
    CASE: 'CASE',
    'NEW HOLLAND': 'NEW HOLLAND',
    DOOSAN: 'DEVELON',
    DEVELON: 'DEVELON',
    HYUNDAI: 'HYUNDAI',
    HYUNDAY: 'HYUNDAI',
    HITACHI: 'HITACHI',
    TOYOTA: 'TOYOTA',
    TOYOYA: 'TOYOTA',
    MITSUBISHI: 'MITSUBISHI',
    MITSUBICHI: 'MITSUBISHI',
    NISSAN: 'NISSAN',
    FORD: 'FORD',
    CHEVROLET: 'CHEVROLET',
    CHEBROLET: 'CHEVROLET',
    CHEVY: 'CHEVROLET',
    PEUGEOT: 'PEUGEOT',
    PEUGUEOT: 'PEUGEOT',
    PEUGOT: 'PEUGEOT',
    CITROEN: 'CITROËN',
    'CITROËN': 'CITROËN',
    RENAULT: 'RENAULT',
    FIAT: 'FIAT',
    RAM: 'RAM',
    DODGE: 'DODGE',
    JEEP: 'JEEP',
    MAZDA: 'MAZDA',
    SUBARU: 'SUBARU',
    SUZUKI: 'SUZUKI',
    KIA: 'KIA',
    SSANGYONG: 'KGM',
    KGM: 'KGM',
    MAXUS: 'MAXUS',
    GWM: 'GREAT WALL',
    'GREAT WALL': 'GREAT WALL',
    CHANGAN: 'CHANGAN',
    JAC: 'JAC',
    FOTON: 'FOTON',
    DFSK: 'DFSK',
    DONGFENG: 'DONGFENG',
    JMC: 'JMC',
    MAHINDRA: 'MAHINDRA',
    CHERY: 'CHERY',
    GEELY: 'GEELY',
    BYD: 'BYD',
    TESLA: 'TESLA',
    BMW: 'BMW',
    AUDI: 'AUDI',
    PORSCHE: 'PORSCHE',
    'LAND ROVER': 'LAND ROVER',
    OPEL: 'OPEL',
    SKODA: 'SKODA',
    SEAT: 'SEAT',
    ISUZU: 'ISUZU',
    HINO: 'HINO',
    FUSO: 'FUSO',
    SCANIA: 'SCANIA',
    MAN: 'MAN',
    DAF: 'DAF',
    IVECO: 'IVECO',
    MACK: 'MACK',
    KENWORTH: 'KENWORTH',
    FREIGHTLINER: 'FREIGHTLINER',
    PETERBILT: 'PETERBILT',
    INTERNATIONAL: 'INTERNATIONAL',
    SINOTRUK: 'SINOTRUK',
    HOWO: 'SINOTRUK',
    SHACMAN: 'SHACMAN',
    FAW: 'FAW',
    MANITOU: 'MANITOU',
    GENIE: 'GENIE',
    JLG: 'JLG',
    HAULOTTE: 'HAULOTTE',
    SKYJACK: 'SKYJACK',
    WACKER: 'WACKER NEUSON',
    'WACKER NEUSON': 'WACKER NEUSON',
    BOMAG: 'BOMAG',
    HAMM: 'HAMM',
    DYNAPAC: 'DYNAPAC',
    WIRTGEN: 'WIRTGEN',
    VOGELE: 'VOGELE',
    SANY: 'SANY',
    XCMG: 'XCMG',
    ZOOMLION: 'ZOOMLION',
    LIUGONG: 'LIUGONG',
    LONKING: 'LONKING',
    SDLG: 'SDLG',
    SHANTUI: 'SHANTUI',
    TAKEUCHI: 'TAKEUCHI',
    KUBOTA: 'KUBOTA',
    YANMAR: 'YANMAR',
    'MASSEY FERGUSON': 'MASSEY FERGUSON',
    VALTRA: 'VALTRA',
    CLAAS: 'CLAAS',
    FENDT: 'FENDT',
    TEREX: 'TEREX',
    VERMEER: 'VERMEER',
    TADANO: 'TADANO',
    GROVE: 'GROVE',
    PALFINGER: 'PALFINGER',
    HIAB: 'HIAB',
    HYSTER: 'HYSTER',
    YALE: 'YALE',
    LINDE: 'LINDE',
    JUNGHEINRICH: 'JUNGHEINRICH',
    KALMAR: 'KALMAR',
    METSO: 'METSO',
    FLSMIDTH: 'FLSMIDTH',
    WEIR: 'WEIR MINERALS',
    NORMET: 'NORMET',
    PAUS: 'PAUS',
    RESEMIN: 'RESEMIN',
    MACLEAN: 'MACLEAN',
    KAESER: 'KAESER',
    SULLAIR: 'SULLAIR',
    INGERSOLL: 'INGERSOLL RAND',
    'INGERSOLL RAND': 'INGERSOLL RAND',
    CUMMINS: 'CUMMINS',
    PERKINS: 'PERKINS',
    HONDA: 'HONDA',
    YAMAHA: 'YAMAHA',
    KAWASAKI: 'KAWASAKI',
    KTM: 'KTM',
    POLARIS: 'POLARIS',
    'CAN-AM': 'CAN-AM',
    CFMOTO: 'CFMOTO',
    MAKITA: 'MAKITA',
    BOSCH: 'BOSCH',
    DEWALT: 'DEWALT',
    MILWAUKEE: 'MILWAUKEE',
    HILTI: 'HILTI',
    STIHL: 'STIHL',
    HUSQVARNA: 'HUSQVARNA',
    LINCOLN: 'LINCOLN ELECTRIC',
    MILLER: 'MILLER',
    ESAB: 'ESAB',
    FLUKE: 'FLUKE',
    LEICA: 'LEICA GEOSYSTEMS',
    TRIMBLE: 'TRIMBLE',
};

const OFFICIAL_TO_SHORT_ALIASES: Record<string, string[]> = {
    CATERPILLAR: ['cat', 'caterpillar'],
    'JOHN DEERE': ['jd', 'deere', 'john deere'],
    'MERCEDES-BENZ': ['mb', 'mercedes', 'mercedes benz'],
    VOLKSWAGEN: ['vw', 'volkswagen'],
    'ATLAS COPCO': ['atlas', 'atlas copco'],
    DEVELON: ['doosan', 'develon'],
    'INGERSOLL RAND': ['ingersoll', 'ingersoll rand'],
    'WACKER NEUSON': ['wacker', 'wacker neuson'],
    PEUGEOT: ['peugeot', 'peugueot'],
    'CITROËN': ['citroen'],
    'GREAT WALL': ['gwm', 'great wall'],
    KGM: ['ssangyong', 'kgm'],
    SINOTRUK: ['howo', 'sinotruk'],
};

const GENERIC_EQUIPMENT_STOPWORDS = new Set([
    'de',
    'del',
    'la',
    'el',
    'los',
    'las',
    'con',
    'sin',
    'para',
    'por',
    'en',
    'y',
    'o',
    'serie',
    'series',
    'modelo',
    'marca',
]);

export interface ParsedIndustrialQuery {
    rawInput: string;
    collapsedInput: string;
    canonicalMake: string | null;
    canonicalDesignator: string | null;
    compactDesignator: string | null;
    candidateCatalogKeys: string[];
    normalizedAlias: string;
    tokens: string[];
}

export interface LocalCatalogHitResult {
    matched: boolean;
    tier: 'TIER_0_EXACT' | 'TIER_1_HYBRID_RRF' | 'NONE';
    latencyMs: number;
    candidates: ResolvedAssetCandidate[];
}

/**
 * Unifica designadores partidos por espacio o guion:
 * - "CAT 242 D"  -> "CAT 242D"
 * - "242 - D3"   -> "242D3"
 * - "PC 200 - 8" -> "PC200-8"
 * - "YT 27"      -> "YT27"
 * - "D8 T"       -> "D8T"
 */
export function collapseSpacedModelDesignators(input: string): string {
    let s = input
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Prefijo corto + espacio + dígitos: "YT 27" -> "YT27", "PC 200" -> "PC200", "WA 380" -> "WA380"
    // Evita fusionar marcas conocidas como "CAT 242" o "JCB 3CX" o "MAN 440"
    s = s.replace(/\b([A-Za-z]{1,3})\s+(\d{2,4}[A-Za-z0-9-]*)\b/g, (full, prefix: string, numPart: string) => {
        const up = prefix.toUpperCase();
        if (BRAND_SYNONYM_TO_OFFICIAL[up]) return full;
        return `${up}${numPart.toUpperCase()}`;
    });

    // Dígitos + espacio/guion + sufijo de serie corto: "242 D" -> "242D", "242 - D3" -> "242D3", "320 GC" -> "320GC"
    s = s.replace(/\b(\d{2,5})\s*[- ]\s*([A-Za-z]{1,3}\d{0,2})\b/g, (full, digits: string, suffix: string) => {
        const upSuffix = suffix.toUpperCase();
        // No fusionar unidades métricas comunes (ej. "200 KW", "150 HP", "500 KG", "220 V")
        if (/^(KW|HP|CV|KG|TON|MM|CM|PSI|BAR|KVA|RPM|LTS|LT|VOLT|HZ)$/.test(upSuffix)) {
            return full;
        }
        return `${digits}${upSuffix}`;
    });

    // Bulldozers / Tractores tipo "D 8 T" o "D8 T" -> "D8T"
    s = s.replace(/\b([Dd]\d{1,2})\s+([A-Za-z]{1,2}\d?)\b/g, (_full, base: string, suf: string) => {
        return `${base.toUpperCase()}${suf.toUpperCase()}`;
    });

    return s;
}

export function normalizeModelCode(model: string): string {
    return collapseSpacedModelDesignators(model)
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export function compactAlphanumericCode(code: string): string {
    return code
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

/**
 * Descarta tokens técnicos transversales que NUNCA constituyen por sí solos el código de modelo de un equipo/vehículo
 * (ej. tracciones 4X4/6X4/AWD, años 1900-2099, configuraciones de cilindros V6/V8, voltajes 12V/24V/220V, normas EURO5/TIER4).
 */
export const NON_MODEL_ATTRIBUTE_TOKENS_REGEX =
    /^(?:[2468]X[2468]|[24]WD|AWD|FWD|RWD|V(?:4|6|8|10|12)|(?:8|12|16|20|24|32)V|(?:12|24|48|110|220|380|400|440)V|EURO[3456]|STAGE[1-5]|TIER[1-4]|(?:19|20)\d{2}|(?:AT|MT)\d?|(?:4|5|6|7|8|9|10)(?:AT|MT)|TDI|HDI|CDI|CRDI|THP|VVT|DOHC|SOHC)$/i;

export function isNonModelAttributeToken(token: string): boolean {
    const clean = token.trim().toUpperCase();
    if (!clean) return true;
    if (/^(19|20)\d{2}$/.test(clean)) return true;
    return NON_MODEL_ATTRIBUTE_TOKENS_REGEX.test(clean);
}

export function extractCanonicalDesignator(collapsedInput: string): string | null {
    // Remover marcas conocidas primero para no capturar partes de marca (ej. JCB, MAN, BMW, JAC)
    let stripped = ` ${collapsedInput.toUpperCase()} `;
    for (const syn of Object.keys(BRAND_SYNONYM_TO_OFFICIAL).sort((a, b) => b.length - a.length)) {
        const escaped = syn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        stripped = stripped.replace(new RegExp(`\\b${escaped}\\b`, 'g'), ' ');
    }

    // Patrones de designador industrial/vehicular (ej. 242D, 242D3, 320GC, D8, D8T, F-150, BT-50, L200, YT27, PC200-8, 3CX, S650)
    const regex =
        /\b([A-Z]{0,4}\d{1,5}[A-Z]{1,4}\d{0,3}|[A-Z]{1,4}-?\d{1,5}[A-Z0-9-]{0,6}|\d{3,5}[A-Z0-9-]{0,5})\b/g;

    for (const match of stripped.matchAll(regex)) {
        const candidate = match[1].trim().toUpperCase();
        if (isNonModelAttributeToken(candidate)) continue;
        return candidate;
    }
    return null;
}

export function detectCanonicalMake(input: string): string | null {
    const upper = input
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();

    const sortedKeys = Object.keys(BRAND_SYNONYM_TO_OFFICIAL).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\b${escaped}\\b`).test(upper)) {
            return BRAND_SYNONYM_TO_OFFICIAL[key];
        }
    }
    return null;
}

export function parseIndustrialSearchQuery(rawInput: string, isGeneric: boolean = false): ParsedIndustrialQuery {
    const collapsed = collapseSpacedModelDesignators(rawInput);
    const canonicalMake = isGeneric ? 'GENÉRICO' : detectCanonicalMake(collapsed);
    const canonicalDesignator = extractCanonicalDesignator(collapsed);
    const compactDesignator = canonicalDesignator ? compactAlphanumericCode(canonicalDesignator) : null;

    const candidateCatalogKeys = new Set<string>();
    if (canonicalMake && canonicalDesignator) {
        candidateCatalogKeys.add(normalizeCatalogKey(canonicalMake, canonicalDesignator));
        if (compactDesignator && compactDesignator !== canonicalDesignator) {
            candidateCatalogKeys.add(normalizeCatalogKey(canonicalMake, compactDesignator));
        }
    }
    if (canonicalDesignator) {
        candidateCatalogKeys.add(normalizeCatalogKey('GENÉRICO', canonicalDesignator));
    }

    const normalizedAlias = collapsed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const rawTokens = normalizedAlias
        .split(/\s+/)
        .filter((t) => t.length >= 2 && !GENERIC_EQUIPMENT_STOPWORDS.has(t));

    const tokenSet = new Set<string>(rawTokens);
    if (canonicalMake) {
        tokenSet.add(canonicalMake.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
        const shorts = OFFICIAL_TO_SHORT_ALIASES[canonicalMake] || [];
        shorts.forEach((s) => tokenSet.add(s.replace(/\s+/g, '_')));
    }
    if (compactDesignator) {
        tokenSet.add(compactDesignator.toLowerCase());
    }

    return {
        rawInput,
        collapsedInput: collapsed,
        canonicalMake,
        canonicalDesignator,
        compactDesignator,
        candidateCatalogKeys: Array.from(candidateCatalogKeys),
        normalizedAlias,
        tokens: Array.from(tokenSet).slice(0, 10),
    };
}

/**
 * Construye los campos de indexación léxica y alias para un documento de `global_asset_catalog`
 */
export function buildCatalogSearchMetadata(params: {
    make_oficial: string;
    model_oficial: string;
    tipo_equipo?: string;
    categoria_equipo?: string;
    original_jargon?: string;
    existingAliases?: string[];
}): {
    canonicalMake: string;
    canonicalModel: string;
    model_designator: string;
    search_aliases: string[];
    search_tokens: string[];
    embeddingSourceText: string;
} {
    const cleanMakeUpper = (params.make_oficial || 'GENÉRICO').trim().toUpperCase();
    const canonicalMake = BRAND_SYNONYM_TO_OFFICIAL[cleanMakeUpper] || cleanMakeUpper;
    const canonicalModel = normalizeModelCode(params.model_oficial);
    const compactModel = compactAlphanumericCode(canonicalModel);

    const aliases = new Set<string>();
    const pushAlias = (val?: string) => {
        if (!val) return;
        const collapsed = collapseSpacedModelDesignators(val)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        if (collapsed.length >= 2) aliases.add(collapsed);
        const rawNorm = val
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        if (rawNorm.length >= 2) aliases.add(rawNorm);
    };

    pushAlias(`${canonicalMake} ${canonicalModel}`);
    pushAlias(`${canonicalMake} ${compactModel}`);
    pushAlias(canonicalModel);
    pushAlias(compactModel);
    pushAlias(params.original_jargon);
    (params.existingAliases || []).forEach(pushAlias);

    const brandShorts = OFFICIAL_TO_SHORT_ALIASES[canonicalMake] || [];
    for (const shortBrand of brandShorts) {
        pushAlias(`${shortBrand} ${canonicalModel}`);
        pushAlias(`${shortBrand} ${compactModel}`);
        // Variante con espacio antes de sufijo de letra (ej. "cat 242 d")
        const spacedModel = compactModel.replace(/^(\d{2,5})([A-Z]\d{0,2})$/, '$1 $2');
        if (spacedModel !== compactModel) {
            pushAlias(`${shortBrand} ${spacedModel}`);
            pushAlias(`${canonicalMake} ${spacedModel}`);
        }
    }

    const tokenSource = [
        canonicalMake,
        ...brandShorts,
        canonicalModel,
        compactModel,
        params.tipo_equipo || '',
        params.categoria_equipo || '',
        params.original_jargon || '',
    ]
        .join(' ')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const tokens = Array.from(
        new Set(
            tokenSource
                .split(/\s+/)
                .filter((t) => t.length >= 2 && !GENERIC_EQUIPMENT_STOPWORDS.has(t))
        )
    ).slice(0, 35);

    const embeddingSourceText = [
        `Fabricante: ${canonicalMake}`,
        `Modelo: ${canonicalModel} (${compactModel})`,
        `Tipo: ${params.tipo_equipo || ''}`,
        `Categoría: ${params.categoria_equipo || ''}`,
        `Alias: ${Array.from(aliases).slice(0, 8).join(', ')}`,
    ].join(' | ');

    return {
        canonicalMake,
        canonicalModel,
        model_designator: compactModel,
        search_aliases: Array.from(aliases).slice(0, 40),
        search_tokens: tokens,
        embeddingSourceText,
    };
}

function mapDocToResolvedCandidate(id: string, data: Record<string, any>): ResolvedAssetCandidate {
    const versions =
        Array.isArray(data.chassis_versions) && data.chassis_versions.length > 0
            ? data.chassis_versions
            : Array.isArray(data.versions) && data.versions.length > 0
            ? data.versions
            : ['ESTÁNDAR'];

    const homologous = extractHomologousAxisValues(data);

    return {
        global_asset_id: id,
        existing_catalog_id: id,
        catalog_key: data.catalog_key || id,
        make_oficial: data.make_oficial || data.make || 'GENÉRICO',
        model_oficial: data.model_oficial || data.model || id.toUpperCase(),
        equipment_type_key: data.equipment_type_key ? String(data.equipment_type_key) : undefined,
        archetype_id: homologous.archetype.id,
        tipo_equipo: data.tipo_equipo || MISSING_FULL_TECH_SPEC,
        categoria_equipo: data.categoria_equipo || 'EQUIPAMIENTO INDUSTRIAL',
        canonical_specs: homologous.slots,
        ambiente_operativo: Array.isArray(data.ambiente_operativo) ? data.ambiente_operativo : ['Superficie'],
        contexto_operativo: Array.isArray(data.contexto_operativo)
            ? data.contexto_operativo
            : ['Operación Industrial'],
        caracteristicas_principales: serializeCanonicalSlotsToSpecsArray(homologous.slots),
        versions,
        chassis_versions: versions,
        official_url: data.official_url || '',
        isNew: false,
        is_pertinent: true,
    };
}

function matchesRequestedDesignatorAndMake(
    parsed: ParsedIndustrialQuery,
    docData: Record<string, any>,
    isGeneric: boolean
): boolean {
    const docMake = String(docData.make_oficial || docData.make || 'GENÉRICO').toUpperCase();
    const docModel = String(docData.model_oficial || docData.model || '').toUpperCase();
    const docDesignator = String(docData.model_designator || compactAlphanumericCode(docModel)).toUpperCase();

    if (isGeneric && docMake !== 'GENÉRICO') {
        return false;
    }
    if (!isGeneric && parsed.canonicalMake && docMake !== parsed.canonicalMake) {
        return false;
    }

    if (parsed.compactDesignator) {
        // Si el usuario pidió "242D", aceptamos "242D" o sub-variantes directas de la misma familia ("242D2", "242D3"),
        // pero NUNCA aceptamos "246D" ni "320D".
        const reqDes = parsed.compactDesignator;
        if (docDesignator !== reqDes && !docDesignator.startsWith(reqDes)) {
            return false;
        }
    }

    return true;
}

/**
 * Indexa de forma asíncrona (o en caliente) los metadatos canónicos y el vector `768d` de un activo
 */
export async function ensureAssetCanonicalIndex(
    docId: string,
    data: Record<string, any>,
    extraAlias?: string
): Promise<void> {
    try {
        const meta = buildCatalogSearchMetadata({
            make_oficial: data.make_oficial || data.make || 'GENÉRICO',
            model_oficial: data.model_oficial || data.model || docId,
            tipo_equipo: data.tipo_equipo,
            categoria_equipo: data.categoria_equipo,
            original_jargon: extraAlias || data.original_jargon,
            existingAliases: [
                ...(Array.isArray(data.alias_detectados) ? data.alias_detectados : []),
                ...(Array.isArray(data.search_aliases) ? data.search_aliases : []),
            ],
        });

        const updatePayload: Record<string, any> = {
            model_designator: meta.model_designator,
            search_aliases: meta.search_aliases,
            search_tokens: meta.search_tokens,
        };

        if (!data.embedding_768_raw) {
            try {
                const vec = await ResilientAIClient.embedText(meta.embeddingSourceText, {
                    taskType: 'RETRIEVAL_DOCUMENT',
                    outputDimensionality: 768,
                    title: `${meta.canonicalMake} ${meta.canonicalModel}`,
                });
                updatePayload.embedding_768_raw = vec;
                if (typeof (FieldValue as any).vector === 'function') {
                    updatePayload.embedding_768 = (FieldValue as any).vector(vec);
                }
            } catch {
                // No bloquear indexación léxica si no hay red en entorno desconectado
            }
        }

        await db.collection('global_asset_catalog').doc(docId).set(updatePayload, { merge: true });
    } catch (err: any) {
        console.warn('[CANONICAL-RESOLVER] No se pudo actualizar índice canónico:', err?.message);
    }
}

/**
 * Compuerta Local Zero-Search (< 35 ms):
 * Resuelve cualquier equipo previamente registrado en MINREPORT sin llamar a Google Search ni duplicar fichas.
 */
export async function resolveFromLocalCommonsCatalog(
    rawQuery: string,
    isGeneric: boolean = false
): Promise<LocalCatalogHitResult> {
    const start = Date.now();
    const parsed = parseIndustrialSearchQuery(rawQuery, isGeneric);

    // ── TIER 0: Claves deterministas exactas, `model_designator` y `search_aliases` (< 15 ms) ──
    const tier0Docs = new Map<string, Record<string, any>>();

    // 0.1 Búsqueda directa por ID de documento (`caterpillar_242d`)
    if (parsed.candidateCatalogKeys.length > 0) {
        const directReads = await Promise.all(
            parsed.candidateCatalogKeys.map((key) => db.collection('global_asset_catalog').doc(key).get())
        );
        for (const snap of directReads) {
            if (snap.exists) {
                const data = snap.data()!;
                if (matchesRequestedDesignatorAndMake(parsed, data, isGeneric)) {
                    tier0Docs.set(snap.id, data);
                }
            }
        }
    }

    // 0.2 Búsqueda sin restricción de cantidad por `search_aliases` y rango de `model_designator`
    const parallelTier0Queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
    if (parsed.normalizedAlias.length >= 2) {
        parallelTier0Queries.push(
            db
                .collection('global_asset_catalog')
                .where('search_aliases', 'array-contains', parsed.normalizedAlias)
                .get()
        );
    }
    if (parsed.compactDesignator) {
        parallelTier0Queries.push(
            db
                .collection('global_asset_catalog')
                .where('model_designator', '>=', parsed.compactDesignator)
                .where('model_designator', '<=', `${parsed.compactDesignator}\uf8ff`)
                .get()
        );
    }

    if (parallelTier0Queries.length > 0) {
        const querySnaps = await Promise.all(parallelTier0Queries);
        for (const qs of querySnaps) {
            for (const docSnap of qs.docs) {
                const data = docSnap.data();
                if (matchesRequestedDesignatorAndMake(parsed, data, isGeneric)) {
                    tier0Docs.set(docSnap.id, data);
                }
            }
        }
    }

    // 0.3 Compatibilidad retroactiva con documentos antiguos aún no indexados con `search_aliases`
    if (tier0Docs.size === 0 && parsed.compactDesignator) {
        const legacySnap = await db.collection('global_asset_catalog').get();
        for (const docSnap of legacySnap.docs) {
            const data = docSnap.data();
            if (matchesRequestedDesignatorAndMake(parsed, data, isGeneric)) {
                const docCompact = compactAlphanumericCode(String(data.model_oficial || data.model || ''));
                if (docCompact === parsed.compactDesignator || docCompact.startsWith(parsed.compactDesignator)) {
                    tier0Docs.set(docSnap.id, data);
                    // Backfill asíncrono transparente para que la próxima lectura sea O(1)
                    void ensureAssetCanonicalIndex(docSnap.id, data, rawQuery);
                }
            }
        }
    }

    if (tier0Docs.size > 0) {
        const candidates = Array.from(tier0Docs.entries()).map(([id, data]) =>
            mapDocToResolvedCandidate(id, data)
        );
        return {
            matched: true,
            tier: 'TIER_0_EXACT',
            latencyMs: Date.now() - start,
            candidates,
        };
    }

    // Si el usuario ingresó un designador explícito (ej. "CAT 246D") y no existe en Tier 0 ni legacy scan,
    // NO debemos forzar similitud semántica difusa contra otro modelo vecino: debe pasar a caza OEM real.
    if (parsed.compactDesignator) {
        return {
            matched: false,
            tier: 'NONE',
            latencyMs: Date.now() - start,
            candidates: [],
        };
    }

    // ── TIER 1: Búsqueda descriptiva sin código (Híbrida RRF Léxica + Vectorial 768d) ──
    if (parsed.tokens.length === 0) {
        return {
            matched: false,
            tier: 'NONE',
            latencyMs: Date.now() - start,
            candidates: [],
        };
    }

    const lexicalDocs = new Map<string, { data: Record<string, any>; lexRank: number }>();
    const lexSnap = await db
        .collection('global_asset_catalog')
        .where('search_tokens', 'array-contains-any', parsed.tokens.slice(0, 10))
        .get();

    const scoredLex = lexSnap.docs
        .map((d) => {
            const data = d.data();
            const docTokens: string[] = Array.isArray(data.search_tokens) ? data.search_tokens : [];
            const overlap = parsed.tokens.filter((t) => docTokens.includes(t)).length;
            return { id: d.id, data, overlap };
        })
        .filter((item) => matchesRequestedDesignatorAndMake(parsed, item.data, isGeneric) && item.overlap >= 2)
        .sort((a, b) => b.overlap - a.overlap);

    scoredLex.forEach((item, idx) => {
        lexicalDocs.set(item.id, { data: item.data, lexRank: idx + 1 });
    });

    if (lexicalDocs.size === 0) {
        return {
            matched: false,
            tier: 'NONE',
            latencyMs: Date.now() - start,
            candidates: [],
        };
    }

    // Ranking Vectorial 768d (nativo Firestore `.findNearest` o coseno sobre candidatos léxicos)
    const vectorRanks = new Map<string, { sim: number; vecRank: number }>();
    try {
        const queryVec = await ResilientAIClient.embedText(parsed.collapsedInput, {
            taskType: 'RETRIEVAL_QUERY',
            outputDimensionality: 768,
        });

        let usedNativeVector = false;
        const collAny = db.collection('global_asset_catalog') as any;
        if (typeof collAny.findNearest === 'function' && typeof (FieldValue as any).vector === 'function') {
            try {
                const vecSnap = await collAny
                    .findNearest('embedding_768', (FieldValue as any).vector(queryVec), {
                        limit: 250,
                        distanceMeasure: 'COSINE',
                    })
                    .get();
                if (!vecSnap.empty) {
                    usedNativeVector = true;
                    vecSnap.docs.forEach((d: FirebaseFirestore.QueryDocumentSnapshot, i: number) => {
                        const rawVec = d.data().embedding_768_raw;
                        const sim = Array.isArray(rawVec)
                            ? ResilientAIClient.cosineSimilarity(queryVec, rawVec)
                            : 0.88;
                        vectorRanks.set(d.id, { sim, vecRank: i + 1 });
                        if (!lexicalDocs.has(d.id) && matchesRequestedDesignatorAndMake(parsed, d.data(), isGeneric)) {
                            lexicalDocs.set(d.id, { data: d.data(), lexRank: 50 });
                        }
                    });
                }
            } catch {
                usedNativeVector = false;
            }
        }

        if (!usedNativeVector) {
            const cosineScored = Array.from(lexicalDocs.entries())
                .map(([id, entry]) => {
                    const docVec = entry.data.embedding_768_raw;
                    const sim = Array.isArray(docVec)
                        ? ResilientAIClient.cosineSimilarity(queryVec, docVec)
                        : 0;
                    return { id, sim };
                })
                .filter((x) => x.sim >= 0.82)
                .sort((a, b) => b.sim - a.sim);

            cosineScored.forEach((x, idx) => {
                vectorRanks.set(x.id, { sim: x.sim, vecRank: idx + 1 });
            });
        }
    } catch {
        // Si falla embedding en red aislada, operar solo con intersección léxica estricta
    }

    // Reciprocal Rank Fusion: RRF(d) = sum(1 / (60 + rank_r(d)))
    const rrfScored = Array.from(lexicalDocs.entries())
        .map(([id, lexEntry]) => {
            const vecEntry = vectorRanks.get(id);
            const rrf =
                1 / (60 + lexEntry.lexRank) + (vecEntry ? 1 / (60 + vecEntry.vecRank) : 0);
            const sim = vecEntry?.sim ?? 0;
            return { id, data: lexEntry.data, rrf, sim, lexRank: lexEntry.lexRank };
        })
        .filter((entry) => entry.sim >= 0.85 || (entry.lexRank === 1 && parsed.tokens.length >= 3))
        .sort((a, b) => b.rrf - a.rrf);

    if (rrfScored.length === 0) {
        return {
            matched: false,
            tier: 'NONE',
            latencyMs: Date.now() - start,
            candidates: [],
        };
    }

    return {
        matched: true,
        tier: 'TIER_1_HYBRID_RRF',
        latencyMs: Date.now() - start,
        candidates: rrfScored.map((e) => mapDocToResolvedCandidate(e.id, e.data)),
    };
}

const LINEAGE_COLLECTION = 'global_asset_lineages';
const LINEAGE_SCHEMA_VERSION = 'v4_dynamic_type_ontology';

export function buildCollaborativeLineageKey(rawQuery: string, isGeneric: boolean): string {
    const parsed = parseIndustrialSearchQuery(rawQuery, isGeneric);
    const scopePrefix = isGeneric ? 'gen' : 'oem';
    if (parsed.canonicalMake && parsed.compactDesignator) {
        return `${scopePrefix}__${normalizeCatalogKey(parsed.canonicalMake, parsed.compactDesignator)}`;
    }
    if (parsed.compactDesignator && parsed.tokens.length <= 1) {
        return `${scopePrefix}__des_${parsed.compactDesignator.toLowerCase()}`;
    }
    const cleanSlug = parsed.normalizedAlias.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return `${scopePrefix}__${cleanSlug || 'query'}`;
}

/**
 * Lee el manifiesto colaborativo completo de un linaje/familia (todas sus generaciones históricas y vigentes)
 * y lo cruza en vivo contra `global_asset_catalog` para marcar `EN CATÁLOGO` (`isNew: false`) las versiones
 * ya registradas sin ocultar jamás las versiones hermanas pendientes de registro (`isNew: true`).
 */
export async function readCollaborativeLineage(
    rawQuery: string,
    isGeneric: boolean = false
): Promise<{ matched: boolean; latencyMs: number; candidates: ResolvedAssetCandidate[] }> {
    const start = Date.now();
    try {
        const lineageKey = buildCollaborativeLineageKey(rawQuery, isGeneric);
        const snap = await db.collection(LINEAGE_COLLECTION).doc(lineageKey).get();
        if (!snap.exists) {
            return { matched: false, latencyMs: Date.now() - start, candidates: [] };
        }

        const data = snap.data() || {};
        if (data.schema_version !== LINEAGE_SCHEMA_VERSION) {
            return { matched: false, latencyMs: Date.now() - start, candidates: [] };
        }
        const storedCandidates: ResolvedAssetCandidate[] = Array.isArray(data.candidates) ? data.candidates : [];
        if (storedCandidates.length === 0) {
            return { matched: false, latencyMs: Date.now() - start, candidates: [] };
        }

        // Hidratar estado en tiempo real contra `global_asset_catalog` para cada versión del linaje
        const hydrated = await Promise.all(
            storedCandidates.map(async (cand): Promise<ResolvedAssetCandidate> => {
                const catalogKey =
                    cand.catalog_key || normalizeCatalogKey(cand.make_oficial, cand.model_oficial);
                const directSnap = await db.collection('global_asset_catalog').doc(catalogKey).get();
                if (directSnap.exists) {
                    const liveDoc = mapDocToResolvedCandidate(directSnap.id, directSnap.data()!);
                    const mergedVersions = Array.from(
                        new Set([
                            ...(liveDoc.chassis_versions || []),
                            ...(cand.chassis_versions || []),
                            ...(cand.versions || []),
                        ])
                    ).filter(Boolean);
                    return {
                        ...cand,
                        ...liveDoc,
                        versions: mergedVersions.length > 0 ? mergedVersions : ['ESTÁNDAR'],
                        chassis_versions: mergedVersions.length > 0 ? mergedVersions : ['ESTÁNDAR'],
                        isNew: false,
                    };
                }
                return {
                    ...cand,
                    catalog_key: catalogKey,
                    isNew: true,
                    is_pertinent: true,
                };
            })
        );

        // Incorporar también cualquier variante adicional registrada después manualmente en `global_asset_catalog`
        const localCommons = await resolveFromLocalCommonsCatalog(rawQuery, isGeneric);
        const seenKeys = new Set(hydrated.map((c) => c.catalog_key || normalizeCatalogKey(c.make_oficial, c.model_oficial)));
        for (const extra of localCommons.candidates) {
            const key = extra.catalog_key || normalizeCatalogKey(extra.make_oficial, extra.model_oficial);
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                hydrated.push(extra);
            }
        }

        return {
            matched: hydrated.length > 0,
            latencyMs: Date.now() - start,
            candidates: hydrated,
        };
    } catch (err: any) {
        console.warn('[CANONICAL-RESOLVER] Lectura de linaje colaborativo omitida:', err?.message);
        return { matched: false, latencyMs: Date.now() - start, candidates: [] };
    }
}

export async function saveCollaborativeLineage(
    rawQuery: string,
    isGeneric: boolean,
    candidates: ResolvedAssetCandidate[]
): Promise<void> {
    if (!Array.isArray(candidates) || candidates.length === 0) return;
    try {
        const lineageKey = buildCollaborativeLineageKey(rawQuery, isGeneric);
        await db
            .collection(LINEAGE_COLLECTION)
            .doc(lineageKey)
            .set(
                {
                    lineage_key: lineageKey,
                    schema_version: LINEAGE_SCHEMA_VERSION,
                    raw_query_sample: rawQuery.trim(),
                    is_generic: isGeneric,
                    total_candidates: candidates.length,
                    candidates,
                    updated_at: new Date().toISOString(),
                },
                { merge: true }
            );
    } catch (err: any) {
        console.warn('[CANONICAL-RESOLVER] No se pudo persistir linaje colaborativo:', err?.message);
    }
}

