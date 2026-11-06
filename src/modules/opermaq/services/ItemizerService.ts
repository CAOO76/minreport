import { db } from '../../../config/firebase';
import { ResilientAIClient, Type } from '../../../core/resilient-ai-client';
import { ItemizedSource, PillarDocument, PillarId, PillarItem } from '../types/vault.types';
import { validateCatalogProfileGate } from './CatalogUpsertService';
import { createEmptyKnowledgeVault, PILLAR_AGENTS } from './pillarAgents';
import { classifySourcesByAuthorship } from './SourceClassifierService';

/**
 * ITEMIZER SERVICE — ETAPA 2 ON-DEMAND POR PILAR INDIVIDUAL
 *
 * Construye únicamente el índice estructural (`content: null`, `content_status: 'PENDIENTE'`)
 * del pilar solicitado por el usuario, consultando manuales en español, inglés y portugués
 * mediante Google Search Grounding. Los otros 4 pilares NO se tocan.
 */

function slugifyItemId(pillarId: PillarId, title: string, index: number): string {
    const clean = title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
    return `${pillarId}_${clean || 'item'}_${index + 1}`;
}

export async function itemizeSinglePillar(
    globalAssetId: string,
    pillarId: PillarId
): Promise<{
    pillar: PillarDocument;
    items: PillarItem[];
    classified_sources: ItemizedSource[];
    totalItems: number;
}> {
    const agent = PILLAR_AGENTS[pillarId];
    if (!agent) {
        throw new Error(`Pilar inválido: ${pillarId}`);
    }

    const assetRef = db.collection('global_asset_catalog').doc(globalAssetId);
    const assetSnap = await assetRef.get();
    if (!assetSnap.exists) {
        throw new Error(`Activo ${globalAssetId} no encontrado en global_asset_catalog.`);
    }

    const assetData = assetSnap.data()!;
    if (assetData.isSealed === true || assetData.is_sealed === true || assetData.knowledge_vault?.is_sealed === true) {
        const err: any = new Error('La bóveda maestra está sellada (HTTP 403). Desbloquéela antes de itemizar.');
        err.statusCode = 403;
        throw err;
    }

    const profileCheck = validateCatalogProfileGate(assetData);
    if (!profileCheck.valid) {
        const err: any = new Error(
            `Perfil técnico base incompleto para itemizar (${profileCheck.missingFields.join(', ')}).`
        );
        err.statusCode = 422;
        err.missingFields = profileCheck.missingFields;
        throw err;
    }

    const makeOficial = String(assetData.make_oficial || assetData.make || 'GENÉRICO');
    const modelOficial = String(assetData.model_oficial || assetData.model || globalAssetId);
    const makeModel = assetData.make_model || `${makeOficial} ${modelOficial}`;
    const [minItems, maxItems] = agent.itemRange;

    // Marcar inicio de itemización del pilar
    const vaultInit = assetData.knowledge_vault || createEmptyKnowledgeVault(makeModel);
    vaultInit[pillarId] = {
        ...vaultInit[pillarId],
        pillar_id: pillarId,
        itemize_status: 'GENERATING',
        started_at: new Date().toISOString(),
        itemize_error: null,
    };
    await assetRef.update({
        knowledge_vault: vaultInit,
        updatedAt: Date.now(),
    });

    const profileSummary = [
        `- Marca / Modelo: ${makeModel}`,
        `- Denominación Técnica: ${assetData.tipo_equipo}`,
        `- Categoría: ${assetData.categoria_equipo}`,
        `- Ambientes Operativos: ${(assetData.ambiente_operativo || []).join(', ')}`,
        `- Contexto Operativo: ${(assetData.contexto_operativo || []).join(', ')}`,
        `- Características Duras: ${(assetData.caracteristicas_principales || []).join(' | ')}`,
    ].join('\n');

    const pass1ResearchPrompt = `${agent.taskItemize(makeModel, profileSummary)}

PROTOCOLO DE INVESTIGACIÓN WEB MULTILINGÜE OBLIGATORIO (GOOGLE SEARCH):
Usa Google Search para buscar el índice real de contenidos (Table of Contents), manual de operación/propietario, pautas de servicio y hojas técnicas oficiales de "${makeModel}" en español, inglés ("${makeModel} owner manual", "${makeModel} operation and maintenance manual", "${makeModel} specifications") y portugués.
Redacta en texto técnico estructurado (entre ${minItems} y ${maxItems} capítulos específicos para "${makeModel}") el título técnico en español de cada capítulo, su sección funcional padre, el alcance exacto verificado y su prioridad operativa (CRÍTICO, IMPORTANTE o COMPLEMENTARIO).`;

    try {
        const aiResponse = await ResilientAIClient.generate({
            module: 'opermaq',
            preferredTier: 'SECONDARY',
            systemInstruction: agent.systemPrompt,
            temperature: 0.1,
            maxOutputTokens: 8192,
            useGoogleSearch: true,
            requireGroundedEvidence: true,
            prompt: pass1ResearchPrompt,
        });

        const { data: parsed } = await ResilientAIClient.generateStructured<{
            items: Array<{
                title: string;
                section: string;
                rationale: string;
                priority: string;
            }>;
        }>({
            module: 'opermaq',
            preferredTier: 'SECONDARY',
            temperature: 0,
            topP: 1,
            topK: 1,
            maxOutputTokens: 8192,
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    items: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                title: { type: Type.STRING },
                                section: { type: Type.STRING },
                                rationale: { type: Type.STRING },
                                priority: { type: Type.STRING },
                            },
                            required: ['title', 'section', 'rationale', 'priority'],
                        },
                    },
                },
                required: ['items'],
            },
            prompt: `Extrae determinísticamente entre ${minItems} y ${maxItems} capítulos técnicos para "${makeModel}" exclusivamente desde el siguiente informe fundamentado en manuales y fichas reales:\n\n"""\n${aiResponse.text.slice(0, 18000)}\n"""`,
        });

        const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

        if (rawItems.length === 0) {
            throw new Error(`El agente especialista de ${pillarId} no devolvió capítulos válidos.`);
        }

        const classifiedSources = await classifySourcesByAuthorship(
            aiResponse.groundingSources,
            makeOficial,
            modelOficial
        );

        const freshSnap = await assetRef.get();
        const freshData = freshSnap.data() || assetData;
        const vault = freshData.knowledge_vault || createEmptyKnowledgeVault(makeModel);
        const existingItems: PillarItem[] = Array.isArray(vault[pillarId]?.items) ? vault[pillarId].items : [];

        const preservedItems = existingItems.filter(
            (it) => it.is_human_locked || it.estado_aprobacion === 'APROBADO_HUMANO'
        );
        const preservedTitles = new Set(preservedItems.map((it) => it.title.trim().toLowerCase()));

        const nowIso = new Date().toISOString();
        const generatedItems: PillarItem[] = rawItems
            .slice(0, maxItems)
            .filter((r) => r?.title && !preservedTitles.has(r.title.trim().toLowerCase()))
            .map((r, index) => {
                const rawPrio = String(r.priority || 'IMPORTANTE').toUpperCase();
                const priority: 'CRÍTICO' | 'IMPORTANTE' | 'COMPLEMENTARIO' =
                    rawPrio === 'CRÍTICO' || rawPrio === 'CRITICO'
                        ? 'CRÍTICO'
                        : rawPrio === 'COMPLEMENTARIO'
                            ? 'COMPLEMENTARIO'
                            : 'IMPORTANTE';
                return {
                    item_id: slugifyItemId(pillarId, String(r.title), preservedItems.length + index),
                    order: preservedItems.length + index + 1,
                    title: String(r.title).trim(),
                    section: String(r.section || 'GENERAL').trim().toUpperCase(),
                    rationale: String(r.rationale || 'Especificación técnica del equipo').trim(),
                    priority,
                    content: null,
                    content_status: 'PENDIENTE',
                    created_at: nowIso,
                    item_sources: classifiedSources,
                    is_discarded: false,
                    estado_aprobacion: 'GENERADO_IA',
                    is_human_locked: false,
                    historial_cambios: [],
                    pending_conflicts: [],
                    authorized_delta_buffer: [],
                    symbology_refs: [],
                };
            });

        const finalPillar: PillarDocument = {
            ...(vault[pillarId] || createEmptyKnowledgeVault(makeModel)[pillarId]),
            pillar_id: pillarId,
            status: 'COMPLETED',
            make_model: makeModel,
            itemize_status: 'COMPLETED',
            itemized_at: nowIso,
            itemize_error: null,
            items: [...preservedItems, ...generatedItems],
            classified_sources_itemized: classifiedSources,
            suggested_items_pending: vault[pillarId]?.suggested_items_pending || [],
            updated_at: nowIso,
        };

        vault[pillarId] = finalPillar;

        await assetRef.update({
            knowledge_vault: vault,
            updatedAt: Date.now(),
        });

        return {
            pillar: finalPillar,
            items: finalPillar.items,
            classified_sources: classifiedSources,
            totalItems: finalPillar.items.length,
        };
    } catch (err: any) {
        await assetRef
            .update({
                [`knowledge_vault.${pillarId}.itemize_status`]: 'ERROR',
                [`knowledge_vault.${pillarId}.itemize_error`]: err?.message || 'Error en itemización.',
                updatedAt: Date.now(),
            })
            .catch(() => { });
        throw err;
    }
}

export async function suggestComplementaryPillarItems(
    globalAssetId: string,
    pillarId: PillarId
): Promise<Array<{ title: string; rationale: string; section: string; source?: ItemizedSource }>> {
    const agent = PILLAR_AGENTS[pillarId];
    if (!agent) throw new Error(`Pilar inválido: ${pillarId}`);

    const assetRef = db.collection('global_asset_catalog').doc(globalAssetId);
    const snap = await assetRef.get();
    if (!snap.exists) throw new Error(`Activo ${globalAssetId} no encontrado.`);

    const assetData = snap.data()!;
    const makeOficial = String(assetData.make_oficial || assetData.make || 'GENÉRICO');
    const modelOficial = String(assetData.model_oficial || assetData.model || globalAssetId);
    const makeModel = assetData.make_model || `${makeOficial} ${modelOficial}`;

    const vault = assetData.knowledge_vault || createEmptyKnowledgeVault(makeModel);
    const currentItems: PillarItem[] = vault[pillarId]?.items || [];
    const currentPending = vault[pillarId]?.suggested_items_pending || [];

    const existingList = [
        ...currentItems.map((i) => ({
            title: i.title,
            rationale: i.rationale,
            status: i.is_discarded ? 'DESCARTADO' : 'ACTIVO',
        })),
        ...currentPending.map((p: any) => ({
            title: p.title,
            rationale: p.rationale,
            status: 'SUGERENCIA_PENDIENTE',
        })),
    ];

    const prompt = `Audita como "${agent.rolePersona}" el índice actual del pilar "${agent.title}" para el equipo "${makeModel}" (${assetData.tipo_equipo}).
Ítems actuales (NO repetir ni solapar):
${JSON.stringify(existingList, null, 2)}

Usa Google Search para contrastar contra el manual oficial OEM y normativas vigentes. Sugiere entre 1 y 3 ítems complementarios específicos con su fuente real.
Responde ESTRICTAMENTE en JSON puro:
{
  "suggestions": [
    {
      "title": "Título técnico específico del capítulo faltante",
      "rationale": "Descripción técnica y justificación para este modelo",
      "section": "GENERAL",
      "source": {
        "type": "OEM",
        "author": "Fabricante u organismo técnico",
        "description": "Documento o ficha técnica encontrada",
        "url": "https://..."
      }
    }
  ]
}`;

    const aiResponse = await ResilientAIClient.generate({
        module: 'opermaq',
        preferredTier: 'SECONDARY',
        systemInstruction: agent.systemPrompt,
        temperature: 0.15,
        useGoogleSearch: true,
        prompt,
    });

    const parsed = JSON.parse(ResilientAIClient.extractJsonString(aiResponse.text));
    const groundedUrl = aiResponse.groundingSources[0]?.uri || '';

    const rawSuggestions: any[] = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    const updatedPending = [...currentPending];

    for (const s of rawSuggestions.slice(0, 4)) {
        const title = String(s.title || '').trim();
        if (!title) continue;
        const lower = title.toLowerCase();
        const exists =
            updatedPending.some((p) => p.title.toLowerCase().trim() === lower) ||
            currentItems.some((p) => p.title.toLowerCase().trim() === lower);
        if (!exists) {
            updatedPending.push({
                title,
                rationale: String(s.rationale || s.description || '').trim(),
                section: String(s.section || 'GENERAL').trim().toUpperCase(),
                source: s.source
                    ? {
                        type:
                            s.source.type === 'OEM' || s.source.type === 'YOUTUBE'
                                ? s.source.type
                                : 'EXTERNO',
                        author: String(s.source.author || makeOficial),
                        description: String(s.source.description || title),
                        url: String(s.source.url || groundedUrl),
                    }
                    : groundedUrl
                        ? {
                            type: 'EXTERNO',
                            author: makeOficial,
                            description: title,
                            url: groundedUrl,
                        }
                        : undefined,
            });
        }
    }

    await assetRef.update({
        [`knowledge_vault.${pillarId}.suggested_items_pending`]: updatedPending,
        updatedAt: Date.now(),
    });

    return updatedPending;
}
