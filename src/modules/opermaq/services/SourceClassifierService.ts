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

function heuristicClassify(src: GroundingSource, makeOficial: string): ItemizedSource {
    const lowerUrl = src.uri.toLowerCase();
    const lowerTitle = (src.title || '').toLowerCase();
    const brandToken = makeOficial.toLowerCase().split(/\s+/)[0];

    if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
        return {
            type: 'YOUTUBE',
            author: src.title || 'YouTube Técnico',
            description: src.title || 'Video técnico de referencia operacional',
            url: src.uri,
        };
    }

    if (
        (brandToken &&
            brandToken !== 'generico' &&
            brandToken !== 'genérico' &&
            (lowerUrl.includes(brandToken) || (lowerTitle.includes('manual') && lowerTitle.includes(brandToken)))) ||
        /\b(om&m|operation and maintenance|parts manual|service manual|cat\.com|komatsu|epiroc|sandvik|volvoce|johndeere|liebherr|bobcat)\b/.test(
            `${lowerUrl} ${lowerTitle}`
        )
    ) {
        return {
            type: 'OEM',
            author: makeOficial !== 'GENÉRICO' ? makeOficial : extractDomainLabel(src.uri),
            description: src.title || `Documentación técnica OEM (${makeOficial})`,
            url: src.uri,
        };
    }

    return {
        type: 'EXTERNO',
        author: extractDomainLabel(src.uri),
        description: src.title || 'Ficha o referencia técnica externa verificada',
        url: src.uri,
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
        if (s?.uri && s.uri.startsWith('http') && !uniqueMap.has(s.uri)) {
            uniqueMap.set(s.uri, s);
        }
    }
    const deduped = Array.from(uniqueMap.values()).slice(0, 15);
    if (deduped.length === 0) return [];

    try {
        const prompt = `${SOURCE_AUTHORSHIP_PROTOCOL}

Equipo auditado: "${makeOficial} ${modelOficial}"
Clasifica las siguientes fuentes web reales según su AUTORÍA INTELECTUAL en "OEM", "EXTERNO" o "YOUTUBE".
No inventes URLs ni modifiques las URLs entregadas:
${JSON.stringify(deduped, null, 2)}`;

        const { data } = await ResilientAIClient.generateStructured<{ classified: ItemizedSource[] }>({
            module: 'opermaq',
            preferredTier: 'ANCHOR_HA',
            temperature: 0,
            responseSchema: SOURCE_CLASSIFICATION_SCHEMA,
            prompt,
        });

        if (Array.isArray(data.classified) && data.classified.length > 0) {
            const validUrls = new Set(deduped.map((d) => d.uri));
            const normalized = data.classified
                .filter((c) => validUrls.has(c.url))
                .map((c): ItemizedSource => {
                    const cat: SourceCategory =
                        c.type === 'OEM' || c.type === 'YOUTUBE' ? c.type : 'EXTERNO';
                    return {
                        type: cat,
                        author: c.author || extractDomainLabel(c.url),
                        description: c.description || c.author || c.url,
                        url: c.url,
                    };
                });

            if (normalized.length > 0) {
                return normalized.sort((a, b) => CATEGORY_ORDER[a.type] - CATEGORY_ORDER[b.type]);
            }
        }
    } catch {
        // Fallback heurístico determinista
    }

    return deduped
        .map((s) => heuristicClassify(s, makeOficial))
        .sort((a, b) => CATEGORY_ORDER[a.type] - CATEGORY_ORDER[b.type]);
}
