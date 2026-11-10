import { db } from '../../../config/firebase';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { ResilientAIClient, Type } from '../../../core/resilient-ai-client';
import { ChatMessage, PillarDocument, PillarId, PillarItem, ProposedUpdate, SEQUENTIAL_PILLAR_ORDER } from '../types/vault.types';
import { computeFactFingerprint, verifyAndNormalizeTechnicalUnits } from './NeuroSymbolicVerifier';
import { getPillarEditGovernancePrompt, PILLAR_AGENTS } from './pillarAgents';
import { extractConfirmedSpecsSummaryFromMarkdown } from './TextSimilarityUtils';
import { VaultPersistenceService } from './VaultPersistenceService';

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
 * - Conecta cada intervención con el Agente Especialista e Invariantes Tabulares del Pilar (`01..05`)
 *   y soporta Reemplazo Quirúrgico Determinista de Fragmentos (`applySurgicalFragmentSplice`).
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
    selectedFragmentTarget?: string;
    promptImage?: string;
    error?: string;
}

/**
 * Ensambla de forma quirúrgica y determinista (`0% deriva fuera de foco`) el reemplazo de un
 * fragmento seleccionado (`selectedFragment`) sobre el documento original (`currentContent`),
 * preservando byte a byte el resto del capítulo y normalizando tablas/unidades SI.
 */
export function applySurgicalFragmentSplice(params: {
    currentContent: string | null | undefined;
    selectedFragment?: string;
    fragmentReplacement?: string;
    fallbackFullDraft?: string;
}): string | undefined {
    const baseContent = String(params.currentContent || '');
    const targetFrag = String(params.selectedFragment || '').trim();
    const replacementFrag = String(params.fragmentReplacement || '').trim();
    const fullDraft = String(params.fallbackFullDraft || '').trim();

    if (targetFrag && replacementFrag && baseContent) {
        if (baseContent.includes(targetFrag)) {
            const spliced = baseContent.replace(targetFrag, replacementFrag);
            return verifyAndNormalizeTechnicalUnits(spliced).normalizedMarkdown;
        }
        const trimmedTarget = targetFrag.replace(/\r\n/g, '\n');
        const normalizedBase = baseContent.replace(/\r\n/g, '\n');
        if (normalizedBase.includes(trimmedTarget)) {
            const spliced = normalizedBase.replace(trimmedTarget, replacementFrag);
            return verifyAndNormalizeTechnicalUnits(spliced).normalizedMarkdown;
        }
    }

    if (fullDraft) {
        return verifyAndNormalizeTechnicalUnits(fullDraft).normalizedMarkdown;
    }

    if (replacementFrag && !baseContent.trim()) {
        return verifyAndNormalizeTechnicalUnits(replacementFrag).normalizedMarkdown;
    }

    return undefined;
}

const VAULT_CHAT_STRUCTURED_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        intent: {
            type: Type.STRING,
            description: 'CHAT | EDIT_PROPOSAL | RESEARCH_WEB | SEARCH_IMAGE',
        },
        message: {
            type: Type.STRING,
            description: 'Explicación técnica concisa y quirúrgica para el operador.',
        },
        highlightText: {
            type: Type.STRING,
            description: 'Cita literal breve del contenido actual sobre la que aplica la respuesta (opcional).',
        },
        fragmentReplacement: {
            type: Type.STRING,
            description:
                'Si hay un fragmento seleccionado y intent=EDIT_PROPOSAL, coloca aquí ÚNICAMENTE el texto Markdown que reemplaza al fragmento seleccionado.',
        },
        draftContent: {
            type: Type.STRING,
            description:
                'Si intent=EDIT_PROPOSAL y la edición abarca el capítulo completo (o no hay fragmento seleccionado), coloca aquí el Markdown completo actualizado.',
        },
        promptImage: {
            type: Type.STRING,
            description: 'Si intent=SEARCH_IMAGE, prompt técnico en inglés para diagrama/ilustración.',
        },
    },
    required: ['intent', 'message'],
};

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

async function loadSovereignContextForItemChat(
    globalAssetId: string,
    pillarId: PillarId,
    catalogProfile: Record<string, any>
): Promise<string> {
    const sections: string[] = [];

    // 1. Herencia verificada de pilares previos (`01 ➔ 02..05`) para impedir contradicciones entre editores
    const targetIdx = SEQUENTIAL_PILLAR_ORDER.indexOf(pillarId);
    if (targetIdx > 0) {
        const fichaItems: PillarItem[] = Array.isArray(catalogProfile?.knowledge_vault?.ficha_tecnica?.items)
            ? catalogProfile.knowledge_vault.ficha_tecnica.items.filter((it: any) => !it?.is_discarded && it?.content)
            : [];
        if (fichaItems.length > 0) {
            const fichaCombined = fichaItems
                .map((it) => `### ${it.title}\n${extractConfirmedSpecsSummaryFromMarkdown(it.content || '', 650)}`)
                .join('\n')
                .slice(0, 2600);
            if (fichaCombined.trim()) {
                sections.push(`CIFRAS BASE VERIFICADAS EN PILAR 01 (FICHA TÉCNICA OEM — PROHIBIDO CONTRADECIR):\n${fichaCombined}`);
            }
        }
    }

    // 2. Fragmentos soberanos en `vault_corpus_chunks` (`southamerica-west1`)
    try {
        const chunksSnap = await db
            .collection('global_asset_catalog')
            .doc(globalAssetId)
            .collection('vault_corpus_chunks')
            .where('pillar_id', '==', pillarId)
            .limit(8)
            .get();

        if (!chunksSnap.empty) {
            const lines = chunksSnap.docs
                .map((d) => {
                    const data = d.data();
                    const title = String(data?.chapter_title || 'Fragmento Bóveda').trim();
                    const body = String(data?.markdown_es || '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 380);
                    return body ? `- [${title}]: ${body}` : '';
                })
                .filter(Boolean);
            if (lines.length > 0) {
                sections.push(`EVIDENCIA SOBERANA LOCAL EN BÓVEDA (southamerica-west1):\n${lines.join('\n')}`);
            }
        }
    } catch {
        // Continuar sin bloquear si la subcolección aún no posee fragmentos
    }

    return sections.join('\n\n');
}

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

        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
        if (!hydrated.exists || !hydrated.data) throw new Error(`Catálogo no encontrado: ${globalAssetId}`);

        const catalogProfile = hydrated.data;
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

        const pillarGovernance = getPillarEditGovernancePrompt(pillarId);
        const sovereignContext = await loadSovereignContextForItemChat(globalAssetId, pillarId, catalogProfile);

        const conversationHistoryText =
            history.length > 0
                ? history
                    .slice(-8)
                    .map((msg) => {
                        const cleanMsg = ConfidentialityAirlockService.scrubDeterministicPii(msg.content || '').scrubbed;
                        return `${msg.role === 'user' ? 'HUMANO' : 'ASISTENTE'}: ${cleanMsg}`;
                    })
                    .join('\n')
                : '(Sin mensajes previos en esta sesión)';

        const assistPrompt = `Actúa como "${agent.rolePersona}" del pilar "${agent.title}" exclusivo para el capítulo "${item.title}" (Sección: ${item.section}) del activo "${make} ${model}" (${tipoEquipo}).

${pillarGovernance}

CONTENIDO ACTUAL DEL ÍTEM:
"""
${item.content || '(Vacío)'}
"""

CONTEXTO DEL ACTIVO:
- Características: ${caracteristicas}
- Ambiente: ${ambientes} | Contexto: ${contextos}
${sovereignContext ? `\n${sovereignContext}\n` : ''}
${safeSelectedFragment
                ? `MODO CONFINAMIENTO QUIRÚRGICO DE FRAGMENTO ACTIVO:
El operador seleccionó explícitamente este fragmento del capítulo para intervenir:
"""
${safeSelectedFragment}
"""
Si tu respuesta es una edición ("intent": "EDIT_PROPOSAL"), entrega en "fragmentReplacement" ÚNICAMENTE el bloque Markdown reemplazante para ese fragmento seleccionado (conservando el formato tabular de la sección), sin necesidad de repetir el resto del capítulo.`
                : ''
            }
HISTORIAL RECIENTE:
${conversationHistoryText}

INSTRUCCIÓN ACTUAL DEL OPERADOR HUMANO:
"${safeUserRequest}"

REGLAS ESTRICTAS DE INTENCIÓN (MODO SOBERANO LEY 21.719):
1. Limita tu respuesta EXCLUSIVAMENTE a "${item.title}" de "${make} ${model}" respetando las invariantes tabulares de "${agent.title}". Si piden temas ajenos, usa "intent": "CHAT" e indícalo concisamente.
2. Si solicitan editar, corregir, agregar o eliminar partes del texto, usa "intent": "EDIT_PROPOSAL":
   - Si hay fragmento seleccionado, escribe el bloque reemplazante en "fragmentReplacement".
   - Si la edición es sobre todo el capítulo, escribe el Markdown completo resultante en "draftContent".
   - Cada fila de tabla Markdown (\`| ... |\`) DEBE ir en una sola línea continua sin etiquetas HTML (\`<br>\`).
3. Solo si el usuario solicitó explícitamente investigar en la web datos complementarios o contrastar valores OEM (${shouldUseExternalSearch ? 'HABILITADO' : 'DESHABILITADO — RESPONDER SOLO CON FUENTES INTERNAS DE LA BÓVEDA'}), usa "intent": "RESEARCH_WEB" y resume los hallazgos verificados en "message".
4. Si solicitan generar una ilustración o diagrama técnico para el ítem, usa "intent": "SEARCH_IMAGE" y entrega el prompt técnico en inglés en "promptImage".`;

        let parsed: {
            intent?: string;
            message?: string;
            highlightText?: string;
            fragmentReplacement?: string;
            draftContent?: string;
            promptImage?: string;
        } = {};
        let groundingSources: Array<{ uri: string; title: string }> = [];

        if (!shouldUseExternalSearch) {
            const { data } = await ResilientAIClient.generateStructured<typeof parsed>({
                module: 'opermaq',
                preferredTier: 'ANCHOR_HA',
                systemInstruction: `${agent.systemPrompt}\n${pillarGovernance}`,
                temperature: 0.1,
                responseSchema: VAULT_CHAT_STRUCTURED_SCHEMA,
                prompt: assistPrompt,
            });
            parsed = data || {};
        } else {
            const aiRes = await ResilientAIClient.generate({
                module: 'opermaq',
                preferredTier: 'SECONDARY',
                systemInstruction: `${agent.systemPrompt}\n${pillarGovernance}`,
                temperature: 0.1,
                useGoogleSearch: shouldUseExternalSearch,
                prompt: `${assistPrompt}\n\nResponde estrictamente en JSON puro:\n{\n  "intent": "CHAT",\n  "message": "Respuesta técnica concisa",\n  "highlightText": "",\n  "fragmentReplacement": "",\n  "draftContent": "",\n  "promptImage": ""\n}`,
            });
            parsed = JSON.parse(ResilientAIClient.extractJsonString(aiRes.text));
            groundingSources = aiRes.groundingSources || [];
        }

        const validIntents = new Set(['CHAT', 'EDIT_PROPOSAL', 'RESEARCH_WEB', 'SEARCH_IMAGE']);
        const resolvedIntent = validIntents.has(String(parsed.intent || ''))
            ? (parsed.intent as VaultChatResponse['intent'])
            : 'CHAT';

        const assembledDraft =
            resolvedIntent === 'EDIT_PROPOSAL'
                ? applySurgicalFragmentSplice({
                    currentContent: item.content,
                    selectedFragment: safeSelectedFragment,
                    fragmentReplacement: parsed.fragmentReplacement,
                    fallbackFullDraft: parsed.draftContent,
                })
                : undefined;

        const finalResponse: VaultChatResponse = {
            success: true,
            message: String(parsed.message || 'Procesado.').trim(),
            intent: resolvedIntent,
            highlightText: parsed.highlightText || undefined,
            draftContent: assembledDraft || undefined,
            ...(safeSelectedFragment && assembledDraft ? { selectedFragmentTarget: safeSelectedFragment } : {}),
            promptImage: parsed.promptImage || undefined,
        };

        if (finalResponse.intent === 'RESEARCH_WEB') {
            const groundedList = groundingSources.map((g) => `- ${g.title}: ${g.uri}`).join('\n');
            const extractionPrompt = `A partir de la búsqueda web recién realizada para "${safeUserRequest}" sobre "${make} ${model}" — "${item.title}":
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

            const fallbackUrl = groundingSources[0]?.uri || '';
            const brandLower = make.toLowerCase().split(/\s+/)[0];
            const nowIso = new Date().toISOString();

            const newProposals: ProposedUpdate[] = (extracted.proposals || [])
                .filter((p) => p?.valor_nuevo && p.valor_nuevo.trim().length > 0)
                .map((prop, idx) => {
                    const srcUrl =
                        prop.source_url && prop.source_url.startsWith('http') ? prop.source_url : fallbackUrl;
                    const normalizedNewVal = verifyAndNormalizeTechnicalUnits(prop.valor_nuevo).normalizedMarkdown;
                    const fp = computeFactFingerprint(normalizedNewVal, `${itemId}:${prop.synthesis || ''}`);
                    return {
                        proposal_id: `prop_${itemId}_${Date.now()}_${idx}`,
                        estado_fusion: prop.estado_fusion === 'CONFLICTO' ? 'CONFLICTO' : 'NUEVO',
                        zona: pillarId,
                        componente: itemId,
                        tipo_input: 'text_block',
                        is_oem: Boolean(brandLower && srcUrl.toLowerCase().includes(brandLower)),
                        valor_actual: prop.valor_actual || '',
                        valor_nuevo: normalizedNewVal,
                        condicion_esperada: normalizedNewVal,
                        detected_at: nowIso,
                        synthesis: prop.synthesis || 'Hallazgo técnico obtenido mediante búsqueda web.',
                        source_url: srcUrl,
                        human_decision: null,
                        fact_fingerprint: fp,
                    };
                });

            if (newProposals.length > 0) {
                const freshHydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
                const freshData = freshHydrated.data || {};
                const freshPillar = freshData?.knowledge_vault?.[pillarId] || {};
                const freshItems: PillarItem[] = [...(freshPillar?.items ?? [])];
                const freshIdx = freshItems.findIndex((it) => it.item_id === itemId);

                if (freshIdx !== -1 && !freshItems[freshIdx].is_human_locked) {
                    const existingConflicts = freshItems[freshIdx].pending_conflicts || [];
                    const existingFps = new Set<string>([
                        ...(freshItems[freshIdx].fact_fingerprints || []),
                        ...existingConflicts.map((c) => c.fact_fingerprint || '').filter(Boolean),
                    ]);
                    const dedupedNewProposals = newProposals.filter((p) => {
                        if (!p.fact_fingerprint) return true;
                        if (existingFps.has(p.fact_fingerprint)) return false;
                        existingFps.add(p.fact_fingerprint);
                        return true;
                    });

                    if (dedupedNewProposals.length > 0) {
                        freshItems[freshIdx] = {
                            ...freshItems[freshIdx],
                            pending_conflicts: [...existingConflicts, ...dedupedNewProposals],
                            fact_fingerprints: Array.from(existingFps),
                        };
                        await VaultPersistenceService.savePillarDocument({
                            globalAssetId,
                            pillarId,
                            pillarDoc: {
                                ...freshPillar,
                                pillar_id: pillarId,
                                items: freshItems,
                                updated_at: new Date().toISOString(),
                            } as PillarDocument,
                        });

                        const listSummary = dedupedNewProposals
                            .map((p) => `- [${p.estado_fusion}] ${p.synthesis}${p.source_url ? ` (${p.source_url})` : ''}`)
                            .join('\n');
                        finalResponse.message = `Búsqueda web completada. Se registraron ${dedupedNewProposals.length} propuesta(s) en la bandeja HITL del ítem para su revisión:\n\n${listSummary}`;
                    }
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
