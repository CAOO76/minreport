import {
    GroundingSource,
    ResilientAIClient,
    type DecisionQuestion,
} from '../../../core/resilient-ai-client';
import { ItemizedSource, SourceCategory } from '../types/vault.types';
import { SOURCE_AUTHORSHIP_PROTOCOL } from './pillarAgents';

/**
 * CLASIFICADOR INTELECTUAL DE AUTORÍA DE FUENTES (`Decisions API` / Heurístico)
 *
 * Clasifica cada URL real proveniente de `groundingMetadata.groundingChunks`
 * en OEM / EXTERNO / YOUTUBE según la autoría intelectual del documento
 * y devuelve `ItemizedSource[]` compatible con `KnowledgeVaultDashboard.tsx`.
 */

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
        const inputText = [
            SOURCE_AUTHORSHIP_PROTOCOL,
            `Equipo auditado: "${makeOficial} ${modelOficial}"`,
            'Fuentes web reales candidatas a clasificar según su autoría intelectual:',
            ...ambiguousSources.map(
                (src, idx) => `- [src_${idx}] URL: ${src.uri} | Título: ${src.title || 'Sin título'}`
            ),
        ].join('\n');

        const questions: Record<string, DecisionQuestion> = {};
        ambiguousSources.forEach((src, idx) => {
            questions[`src_${idx}`] = {
                type: 'choice',
                instructions: `Clasifica la autoría intelectual de la fuente [src_${idx}] (URL: ${src.uri} | Título: "${src.title || 'Sin título'}") para "${makeOficial} ${modelOficial}".`,
                criteria: {
                    EXTERNO:
                        'Agregador de fichas técnicas, distribuidor independiente, concesionario o portal de terceros distinto del fabricante.',
                    OEM: `Documentación, ficha técnica, folleto o sitio oficial del fabricante "${makeOficial}" o de su casa matriz.`,
                    YOUTUBE: 'Video técnico alojado en YouTube (youtube.com o youtu.be).',
                },
            };
        });

        const decisionRes = await ResilientAIClient.decide({
            module: 'opermaq',
            dataClassification: 'GLOBAL_OEM',
            inputText,
            questions,
        });

        const decidedByUrl = new Map<string, ItemizedSource>();
        ambiguousSources.forEach((src, idx) => {
            const ans = decisionRes.answers[`src_${idx}`];
            if (ans?.type === 'choice' && ans.confidence >= 0.55) {
                const cat: SourceCategory =
                    ans.choice === 'OEM' || ans.choice === 'YOUTUBE' ? ans.choice : 'EXTERNO';
                decidedByUrl.set(src.uri, {
                    type: cat,
                    author:
                        cat === 'OEM' && makeOficial && makeOficial !== 'GENÉRICO'
                            ? makeOficial
                            : extractDomainLabel(src.uri),
                    description:
                        src.title ||
                        (cat === 'OEM'
                            ? `Documentación técnica OEM (${makeOficial})`
                            : cat === 'YOUTUBE'
                              ? 'Video técnico de referencia operacional'
                              : 'Ficha o referencia técnica externa verificada'),
                    url: src.uri,
                });
            }
        });

        return heuristicEvaluations
            .map((e) => decidedByUrl.get(e.raw.uri) || e.item)
            .sort((a, b) => CATEGORY_ORDER[a.type] - CATEGORY_ORDER[b.type]);
    } catch {
        // Fallback heurístico determinista
        return heuristicEvaluations
            .map((e) => e.item)
            .sort((a, b) => CATEGORY_ORDER[a.type] - CATEGORY_ORDER[b.type]);
    }
}
