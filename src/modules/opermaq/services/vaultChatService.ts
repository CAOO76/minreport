import { db } from '../../../config/firebase';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { ResilientAIClient, Type } from '../../../core/resilient-ai-client';
import { ChatMessage, PillarId, PillarItem, ProposedUpdate } from '../types/vault.types';
import { PILLAR_AGENTS } from './pillarAgents';

/**
 * VAULT CHAT SERVICE — MOTOR SOBERANO SÍMIL NOTEBOOKLM (Ley N° 19.628 / Ley N° 21.719 Chile)
 *
 * Opera en modo `SOVEREIGN_VAULT_FIRST` (`useGoogleSearch: false` por defecto):
 * - Las consultas e intervenciones sobre fuentes de información privada del ítem se resuelven
 *   100% dentro del perímetro soberano de MINREPORT (`southamerica-west1`) sin exponer fragmentos
 *   a buscadores externos.
 * - Solo cuando el operador solicita explícitamente contrastar o investigar en la web OEM pública
 *   (`allowExternalWebSearch: true` o intención explícita de búsqueda web), se ejecuta una consulta
 *   sanitizada previamente por `ConfidentialityAirlockService.scrubDeterministicPii()`.
 *
 * Intenciones soportadas:
 * - CHAT: Dudas técnicas acotadas estrictamente al ítem y sus fuentes privadas en la Bóveda.
 * - EDIT_PROPOSAL: Propuesta de redacción en `draftContent` (requiere aprobación humana en UI).
 * - RESEARCH_WEB: Búsqueda en vivo con `useGoogleSearch: true` (previa sanitización Ley 21.719) e inyección automática de `ProposedUpdate[]` en `pending_conflicts`.
 * - SEARCH_IMAGE: Generación de prompt técnico optimizado en `promptImage`.
 */

const EXPLICIT_WEB_RESEARCH_REGEX =
    /\b(busca(?:r)?\s+en\s+(?:la\s+)?web|investiga(?:r)?\s+en\s+(?:la\s+)?web|internet|google|fuentes?\s+externas?|contrasta(?:r)?\s+en\s+línea|buscar?\s+ficha\s+oficial\s+en\s+web)\b/i;

export interface VaultChatOptions {
    globalAssetId: string;
    pillarId: PillarId;
    itemId: string;
    userRequest: string;
    history: ChatMessage[];
    selectedFragment?: string;
    userEmail: string;
    allowExternalWebSearch?: boolean;
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
    const {
        globalAssetId,
        pillarId,
        itemId,
        userRequest,
        history,
        selectedFragment,
        allowExternalWebSearch,
    } = options;

    try {
        // Esclusa Ley N° 19.628 / Ley N° 21.719: sanitización determinista de PII chilena y datos de faena
        const safeUserRequest = ConfidentialityAirlockService.scrubDeterministicPii(userRequest || '').scrubbed;
        const safeSelectedFragment = selectedFragment
            ? ConfidentialityAirlockService.scrubDeterministicPii(selectedFragment).scrubbed
            : undefined;
        // Modo SOVEREIGN_VAULT_FIRST: useGoogleSearch es false por defecto para proteger las fuentes privadas de la Bóveda
        const shouldUseExternalSearch =
            Boolean(allowExternalWebSearch) || EXPLICIT_WEB_RESEARCH_REGEX.test(safeUserRequest);

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
                      .map((msg) => {
                          const cleanMsg = ConfidentialityAirlockService.scrubDeterministicPii(msg.content || '').scrubbed;
                          return `${msg.role === 'user' ? 'HUMANO' : 'ASISTENTE'}: ${cleanMsg}`;
                      })
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
    safeSelectedFragment
        ? `FRAGMENTO SELECCIONADO POR EL HUMANO PARA INTERVENIR:\n"${safeSelectedFragment}"\n`
        : ''
}
HISTORIAL RECIENTE:
${conversationHistoryText}

INSTRUCCIÓN ACTUAL DEL OPERADOR HUMANO:
"${safeUserRequest}"

REGLAS ESTRICTAS DE INTENCIÓN (MODO SOBERANO LEY 21.719):
1. Limita tu respuesta EXCLUSIVAMENTE a "${item.title}" de "${make} ${model}" basándote en el contenido privado de la Bóveda. Si piden temas ajenos, usa "intent": "CHAT" e indícalo concisamente.
2. Si solicitan editar, corregir o eliminar partes del texto, usa "intent": "EDIT_PROPOSAL", coloca el Markdown completo resultante en "draftContent" e indica en "message" el cambio proyectado.
3. Solo si el usuario solicitó explícitamente investigar en la web datos complementarios o contrastar valores OEM (${shouldUseExternalSearch ? 'HABILITADO' : 'DESHABILITADO — RESPONDER SOLO CON FUENTES INTERNAS DE LA BÓVEDA'}), usa "intent": "RESEARCH_WEB" y resume los hallazgos verificados en "message".
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
            preferredTier: shouldUseExternalSearch ? 'SECONDARY' : 'ANCHOR_HA',
            systemInstruction: agent.systemPrompt,
            temperature: 0.1,
            useGoogleSearch: shouldUseExternalSearch,
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

