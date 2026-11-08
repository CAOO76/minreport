import { GroundingSource, ResilientAIClient, Type } from '../../../core/resilient-ai-client';
import { ItemizedSource, SourceCategory } from '../types/vault.types';
import { SOURCE_AUTHORSHIP_PROTOCOL } from './pillarAgents';

/**
 * CLASIFICADOR INTELECTUAL DE AUTORÍA DE FUENTES (Temp 0)
 *
 * Clasifica cada URL real proveniente de `groundingMetadata.groundingChunks`
 * en OEM / EXTERNO / YOUTUBE según la autoría intelectual del documento
 * y devuelve `ItemizedSource[]` compatible con `KnowledgeVaultDashboard.tsx`.
 */

const SOURCE_CLASSIFICATION_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        classified: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    url: { type: Type.STRING },
                    author: { type: Type.STRING },
                    description: { type: Type.STRING },
                    type: { type: Type.STRING },
                },
                required: ['url', 'author', 'description', 'type'],
            },
        },
    },
    required: ['classified'],
};

const CATEGORY_ORDER: Record<SourceCategory, number> = {
    OEM: 0,
    EXTERNO: 1,
    YOUTUBE: 2,
    MANUAL: 3,
};

function extractDomainLabel(uri: string): string {
    try {
        return new URL(uri).hostname.replace(/^www\./, '');
    } catch {
        return 'Fuente Técnica';
    }
}

function heuristicClassify(
    src: GroundingSource,
    makeOficial: string
): { item: ItemizedSource; highConfidence: boolean } {
    const lowerUrl = src.uri.toLowerCase();
    const lowerTitle = (src.title || '').toLowerCase();
    const brandToken = makeOficial
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/\s+/)[0];

    if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
        return {
            item: {
                type: 'YOUTUBE',
                author: src.title || 'YouTube Técnico',
                description: src.title || 'Video técnico de referencia operacional',
                url: src.uri,
            },
            highConfidence: true,
        };
    }

    const isBrandDomainOrTitle =
        Boolean(brandToken) &&
        brandToken.length >= 3 &&
        brandToken !== 'generico' &&
        (lowerUrl.includes(brandToken) ||
            (lowerTitle.includes(brandToken) &&
                /\b(ficha|spec|brochure|manual|catalog|catalogo|official|oficial|oem|data\s*sheet)\b/i.test(
                    lowerTitle
                )));

    const isKnownOemCatalogPattern =
        /\b(om&m|operation and maintenance|parts manual|service manual|specalog|cat\.com|caterpillar|komatsu|epiroc|sandvik|volvoce|volvotrucks|johndeere|liebherr|bobcat|hitachicm|jcb\.com|develon|doosan|xcmg|sany|metso|normet|kaeser|atlascopco|cummins|ford\.com|peugeot|fiat|toyota|mitsubishi|nissan|chevrolet|isuzu|scania|mercedes-benz|iveco)\b/i.test(
            `${lowerUrl} ${lowerTitle}`
        );

    if (isBrandDomainOrTitle || isKnownOemCatalogPattern) {
        return {
            item: {
                type: 'OEM',
                author: makeOficial && makeOficial !== 'GENÉRICO' ? makeOficial : extractDomainLabel(src.uri),
                description: src.title || `Documentación técnica OEM (${makeOficial})`,
                url: src.uri,
            },
            highConfidence: true,
        };
    }

    const isKnownExternalAggregator =
        /\b(lectura-specs|ritchiespecs|machinerytrader|autocosmos|km77|ultimatespecs|automobile-catalog|carfolio|tractorhouse|wikipedia|scribd|slideshare|coursehero|studocu)\b/i.test(
            lowerUrl
        );

    return {
        item: {
            type: 'EXTERNO',
            author: extractDomainLabel(src.uri),
            description: src.title || 'Ficha o referencia técnica externa verificada',
            url: src.uri,
        },
        highConfidence: isKnownExternalAggregator || Boolean(src.title && src.title.trim().length >= 8),
    };
}

export async function classifySourcesByAuthorship(
    rawSources: GroundingSource[],
    makeOficial: string,
    modelOficial: string
): Promise<ItemizedSource[]> {
    if (!rawSources || rawSources.length === 0) return [];

    const uniqueMap = new Map<string, GroundingSource>();
    for (const s of rawSources) {
        if (s?.uri && (s.uri.startsWith('http') || s.uri.startsWith('/')) && !uniqueMap.has(s.uri)) {
            uniqueMap.set(s.uri, s);
        }
    }
    const deduped = Array.from(uniqueMap.values()).slice(0, 15);
    if (deduped.length === 0) return [];

    // 1. Clasificación determinista rápida (0 ms, $0 costo LLM)
    const heuristicEvaluations = deduped.map((s) => ({
        raw: s,
        ...heuristicClassify(s, makeOficial),
    }));

    const ambiguousSources = heuristicEvaluations.filter((e) => !e.highConfidence).map((e) => e.raw);

    // Si todas las fuentes tienen autoría determinista clara, evitamos por completo la 3ª llamada LLM
    if (ambiguousSources.length === 0) {
        return heuristicEvaluations
            .map((e) => e.item)
            .sort((a, b) => CATEGORY_ORDER[a.type] - CATEGORY_ORDER[b.type]);
    }

    try {
        const prompt = `${SOURCE_AUTHORSHIP_PROTOCOL}

Equipo auditado: "${makeOficial} ${modelOficial}"
Clasifica las siguientes fuentes web reales según su AUTORÍA INTELECTUAL en "OEM", "EXTERNO" o "YOUTUBE".
No inventes URLs ni modifiques las URLs entregadas:
${JSON.stringify(ambiguousSources, null, 2)}`;

        const { data } = await ResilientAIClient.generateStructured<{ classified: ItemizedSource[] }>({
            module: 'opermaq',
            preferredTier: 'ANCHOR_HA',
            temperature: 0,
            responseSchema: SOURCE_CLASSIFICATION_SCHEMA,
            prompt,
        });

        const llmByUrl = new Map<string, ItemizedSource>();
        if (Array.isArray(data.classified)) {
            const validUrls = new Set(ambiguousSources.map((d) => d.uri));
            for (const c of data.classified) {
                if (c?.url && validUrls.has(c.url)) {
                    const cat: SourceCategory =
                        c.type === 'OEM' || c.type === 'YOUTUBE' ? c.type : 'EXTERNO';
                    llmByUrl.set(c.url, {
                        type: cat,
                        author: c.author || extractDomainLabel(c.url),
                        description: c.description || c.author || c.url,
                        url: c.url,
                    });
                }
            }
        }

        return heuristicEvaluations
            .map((e) => llmByUrl.get(e.raw.uri) || e.item)
            .sort((a, b) => CATEGORY_ORDER[a.type] - CATEGORY_ORDER[b.type]);
    } catch {
        // Fallback heurístico determinista
        return heuristicEvaluations
            .map((e) => e.item)
            .sort((a, b) => CATEGORY_ORDER[a.type] - CATEGORY_ORDER[b.type]);
    }
}
