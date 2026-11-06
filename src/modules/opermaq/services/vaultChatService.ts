import { db } from '../../../config/firebase';
import { ResilientAIClient, Type } from '../../../core/resilient-ai-client';
import { ChatMessage, PillarId, PillarItem, ProposedUpdate } from '../types/vault.types';
import { PILLAR_AGENTS } from './pillarAgents';

/**
 * VAULT CHAT SERVICE — ASISTENTE CONVERSACIONAL CONTEXTUAL DE ÍTEM (Etapa 4)
 *
 * Intenciones soportadas:
 * - CHAT: Dudas técnicas acotadas estrictamente al ítem.
 * - EDIT_PROPOSAL: Propuesta de redacción en `draftContent` (requiere aprobación humana en UI).
 * - RESEARCH_WEB: Búsqueda en vivo con `useGoogleSearch: true` e inyección automática de `ProposedUpdate[]` en `pending_conflicts`.
 * - SEARCH_IMAGE: Generación de prompt técnico optimizado en `promptImage`.
 */

export interface VaultChatOptions {
    globalAssetId: string;
    pillarId: PillarId;
    itemId: string;
    userRequest: string;
    history: ChatMessage[];
    selectedFragment?: string;
    userEmail: string;
}

export interface VaultChatResponse {
    success: boolean;
    message: string;
    intent: 'CHAT' | 'EDIT_PROPOSAL' | 'RESEARCH_WEB' | 'SEARCH_IMAGE';
    highlightText?: string;
    draftContent?: string;
    promptImage?: string;
    error?: string;
}

const PROPOSALS_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        proposals: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    estado_fusion: { type: Type.STRING },
                    valor_actual: { type: Type.STRING },
                    valor_nuevo: { type: Type.STRING },
                    synthesis: { type: Type.STRING },
                    source_url: { type: Type.STRING },
                },
                required: ['estado_fusion', 'valor_nuevo', 'synthesis'],
            },
        },
    },
    required: ['proposals'],
};

export async function processVaultChat(options: VaultChatOptions): Promise<VaultChatResponse> {
    const { globalAssetId, pillarId, itemId, userRequest, history, selectedFragment } = options;

    try {
        const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const snap = await docRef.get();
        if (!snap.exists) throw new Error(`Catálogo no encontrado: ${globalAssetId}`);

        const catalogProfile = snap.data() || {};
        const items: PillarItem[] = catalogProfile?.knowledge_vault?.[pillarId]?.items ?? [];
        const item = items.find((it) => it.item_id === itemId);
        if (!item) throw new Error(`Ítem "${itemId}" no encontrado.`);

        const make = String(catalogProfile.make_oficial || catalogProfile.make || 'GENÉRICO').trim();
        const model = String(catalogProfile.model_oficial || catalogProfile.model || globalAssetId).trim();
        const tipoEquipo = String(catalogProfile.tipo_equipo || 'Equipo industrial').trim();
        const ambientes = (catalogProfile.ambiente_operativo || []).join(', ') || 'Estándar';
        const contextos = (catalogProfile.contexto_operativo || []).join(', ') || 'Uso industrial';
        const caracteristicas = (catalogProfile.caracteristicas_principales || []).join(' | ') || 'Sin datos adicionales';

        const agent = PILLAR_AGENTS[pillarId];
        if (!agent) throw new Error(`Pilar inválido: ${pillarId}`);

        const conversationHistoryText =
            history.length > 0
                ? history
                      .slice(-10)
                      .map((msg) => `${msg.role === 'user' ? 'HUMANO' : 'ASISTENTE'}: ${msg.content}`)
                      .join('\n')
                : '(Sin mensajes previos en esta sesión)';

        const assistPrompt = `Actúa como el Asistente Técnico IA del pilar "${agent.title}" exclusivo para el ítem "${item.title}" (Sección: ${item.section}) del activo "${make} ${model}" (${tipoEquipo}).

CONTENIDO ACTUAL DEL ÍTEM:
"""
${item.content || '(Vacío)'}
"""

CONTEXTO DEL ACTIVO:
- Características: ${caracteristicas}
- Ambiente: ${ambientes} | Contexto: ${contextos}

${
    selectedFragment
        ? `FRAGMENTO SELECCIONADO POR EL HUMANO PARA INTERVENIR:\n"${selectedFragment}"\n`
        : ''
}
HISTORIAL RECIENTE:
${conversationHistoryText}

INSTRUCCIÓN ACTUAL DEL OPERADOR HUMANO:
"${userRequest}"

REGLAS ESTRICTAS DE INTENCIÓN:
1. Limita tu respuesta EXCLUSIVAMENTE a "${item.title}" de "${make} ${model}". Si piden temas ajenos, usa "intent": "CHAT" e indícalo concisamente.
2. Si solicitan editar, corregir o eliminar partes del texto, usa "intent": "EDIT_PROPOSAL", coloca el Markdown completo resultante en "draftContent" e indica en "message" el cambio proyectado.
3. Si solicitan investigar en la web datos complementarios o contrastar valores OEM, usa "intent": "RESEARCH_WEB" (ejecutando Google Search) y resume los hallazgos verificados en "message".
4. Si solicitan generar una ilustración o diagrama técnico para el ítem, usa "intent": "SEARCH_IMAGE" y entrega el prompt técnico en inglés en "promptImage".

Responde estrictamente en JSON puro:
{
  "intent": "CHAT",
  "message": "Respuesta técnica concisa",
  "highlightText": "",
  "draftContent": "",
  "promptImage": ""
}`;

        const aiRes = await ResilientAIClient.generate({
            module: 'opermaq',
            preferredTier: 'SECONDARY',
            systemInstruction: agent.systemPrompt,
            temperature: 0.1,
            useGoogleSearch: true,
            prompt: assistPrompt,
        });

        const parsed = JSON.parse(ResilientAIClient.extractJsonString(aiRes.text));
        const validIntents = new Set(['CHAT', 'EDIT_PROPOSAL', 'RESEARCH_WEB', 'SEARCH_IMAGE']);
        const resolvedIntent = validIntents.has(parsed.intent) ? parsed.intent : 'CHAT';

        const finalResponse: VaultChatResponse = {
            success: true,
            message: String(parsed.message || 'Procesado.').trim(),
            intent: resolvedIntent,
            highlightText: parsed.highlightText || undefined,
            draftContent: parsed.draftContent || undefined,
            promptImage: parsed.promptImage || undefined,
        };

        if (finalResponse.intent === 'RESEARCH_WEB') {
            const groundedList = aiRes.groundingSources.map((g) => `- ${g.title}: ${g.uri}`).join('\n');
            const extractionPrompt = `A partir de la búsqueda web recién realizada para "${userRequest}" sobre "${make} ${model}" — "${item.title}":
Hallazgos IA:
${finalResponse.message}

Fuentes web verificadas:
${groundedList || '(Sin URLs externas)'}

Contenido vigente del ítem:
"""
${item.content || '(Vacío)'}
"""

Extrae propuestas técnicas puntuales ("NUEVO" si agrega datos ausentes, "CONFLICTO" si contradice un valor actual) respaldadas por fuentes reales.`;

            const { data: extracted } = await ResilientAIClient.generateStructured<{
                proposals: Array<{
                    estado_fusion: string;
                    valor_actual?: string;
                    valor_nuevo: string;
                    synthesis: string;
                    source_url?: string;
                }>;
            }>({
                module: 'opermaq',
                preferredTier: 'ANCHOR_HA',
                temperature: 0.1,
                responseSchema: PROPOSALS_SCHEMA,
                prompt: extractionPrompt,
            });

            const fallbackUrl = aiRes.groundingSources[0]?.uri || '';
            const brandLower = make.toLowerCase().split(/\s+/)[0];
            const nowIso = new Date().toISOString();

            const newProposals: ProposedUpdate[] = (extracted.proposals || [])
                .filter((p) => p?.valor_nuevo && p.valor_nuevo.trim().length > 0)
                .map((prop, idx) => {
                    const srcUrl =
                        prop.source_url && prop.source_url.startsWith('http') ? prop.source_url : fallbackUrl;
                    return {
                        proposal_id: `prop_${itemId}_${Date.now()}_${idx}`,
                        estado_fusion: prop.estado_fusion === 'CONFLICTO' ? 'CONFLICTO' : 'NUEVO',
                        zona: pillarId,
                        componente: itemId,
                        tipo_input: 'text_block',
                        is_oem: Boolean(brandLower && srcUrl.toLowerCase().includes(brandLower)),
                        valor_actual: prop.valor_actual || '',
                        valor_nuevo: prop.valor_nuevo,
                        condicion_esperada: prop.valor_nuevo,
                        detected_at: nowIso,
                        synthesis: prop.synthesis || 'Hallazgo técnico obtenido mediante búsqueda web.',
                        source_url: srcUrl,
                        human_decision: null,
                    };
                });

            if (newProposals.length > 0) {
                const freshSnap = await docRef.get();
                const freshData = freshSnap.data() || {};
                const freshItems: PillarItem[] = [...(freshData?.knowledge_vault?.[pillarId]?.items ?? [])];
                const freshIdx = freshItems.findIndex((it) => it.item_id === itemId);

                if (freshIdx !== -1 && !freshItems[freshIdx].is_human_locked) {
                    const existingConflicts = freshItems[freshIdx].pending_conflicts || [];
                    freshItems[freshIdx] = {
                        ...freshItems[freshIdx],
                        pending_conflicts: [...existingConflicts, ...newProposals],
                    };
                    await docRef.update({
                        [`knowledge_vault.${pillarId}.items`]: freshItems,
                    });

                    const listSummary = newProposals
                        .map((p) => `- [${p.estado_fusion}] ${p.synthesis}${p.source_url ? ` (${p.source_url})` : ''}`)
                        .join('\n');
                    finalResponse.message = `Búsqueda web completada. Se registraron ${newProposals.length} propuesta(s) en la bandeja HITL del ítem para su revisión:\n\n${listSummary}`;
                }
            }
        }

        return finalResponse;
    } catch (err: any) {
        console.error('[VaultChatService] Error:', err);
        return {
            success: false,
            message: 'No fue posible procesar la solicitud en el asistente técnico.',
            intent: 'CHAT',
            error: err?.message || 'Error en VaultChatService',
        };
    }
}

