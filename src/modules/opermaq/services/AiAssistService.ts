import { db } from '../../../config/firebase';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { ResilientAIClient, Type } from '../../../core/resilient-ai-client';
import { PillarId, PillarItem, ProposedUpdate } from '../types/vault.types';
import { sanitizePositivePresenceMarkdown } from '../utils/canonicalArchetypeSpecs';
import { verifyAndNormalizeTechnicalUnits } from './NeuroSymbolicVerifier';
import { getPillarEditGovernancePrompt, PILLAR_AGENTS } from './pillarAgents';
import { SegmentedDocumentProcessorService } from './SegmentedDocumentProcessorService';
import { applySurgicalFragmentSplice } from './vaultChatService';
import { VaultPersistenceService } from './VaultPersistenceService';

/**
 * AI ASSIST SERVICE — ETAPA 4 ASISTENCIA QUIRÚRGICA, EVOLUCIÓN Y ORTOGRAFÍA TÉCNICA
 * 100% enrutado por `ResilientAIClient` v2.0 en modo `SOVEREIGN_VAULT_FIRST` (Ley N° 21.719, HITL obligatorio).
 */

const EXPLICIT_EXTERNAL_SEARCH_REQUEST_REGEX =
    /\b(busca(?:r)?\s+en\s+(?:la\s+)?web|investiga(?:r)?\s+en\s+(?:la\s+)?web|google|internet|fuentes?\s+externas?|contrasta(?:r)?\s+en\s+l[ií]nea|buscar?\s+ficha\s+oficial\s+en\s+web)\b/i;

async function retrieveSovereignVaultEvidenceForAssist(
    globalAssetId: string,
    pillarId: PillarId,
    queryText: string
): Promise<{ evidenceBlock: string; totalChars: number }> {
    const snippets: string[] = [];
    const seenTexts = new Set<string>();

    try {
        const semanticChunks = await SegmentedDocumentProcessorService.searchLocalAssetCorpus(
            globalAssetId,
            queryText,
            6
        );
        for (const chunk of semanticChunks) {
            const body = ConfidentialityAirlockService.scrubDeterministicPii(
                String(chunk.markdown || '')
            )
                .scrubbed.replace(/\s+/g, ' ')
                .trim()
                .slice(0, 480);
            if (body && !seenTexts.has(body)) {
                seenTexts.add(body);
                snippets.push(`- [${chunk.sourceFilename || 'Bóveda Soberana'} — ${chunk.title || pillarId}]: ${body}`);
            }
        }
    } catch {
        // Fallback directo sobre Firestore subcollection vault_corpus_chunks
    }

    if (snippets.length < 2) {
        try {
            const snap = await db
                .collection('global_asset_catalog')
                .doc(globalAssetId)
                .collection('vault_corpus_chunks')
                .where('pillar_id', '==', pillarId)
                .limit(8)
                .get();

            for (const docSnap of snap.docs) {
                const d = docSnap.data() || {};
                const title = String(d.chapter_title || 'Fragmento Bóveda').trim();
                const src = String(d.source_filename || 'Bóveda Soberana').trim();
                const body = ConfidentialityAirlockService.scrubDeterministicPii(String(d.markdown_es || ''))
                    .scrubbed.replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 480);
                if (body && !seenTexts.has(body)) {
                    seenTexts.add(body);
                    snippets.push(`- [${src} — ${title}]: ${body}`);
                }
            }
        } catch {
            // Continuar sin bloquear si aún no existen chunks indexados
        }
    }

    const joined = snippets.join('\n');
    return {
        evidenceBlock: joined,
        totalChars: joined.length,
    };
}

export interface AiAssistOptions {
    globalAssetId: string;
    pillarId: PillarId;
    itemId: string;
    userRequest: string;
}

export interface AiAssistResponse {
    success: boolean;
    intent?: 'CORRECTION' | 'RESEARCH' | 'DELETION';
    clarification?: string;
    originalFragment?: string;
    proposedFragment?: string;
    additionalBlock?: string;
    finalContent?: string;
    error?: string;
}

export async function assistItemEdit(options: AiAssistOptions): Promise<AiAssistResponse> {
    const { globalAssetId, pillarId, itemId, userRequest } = options;

    try {
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

        const safeUserRequest = ConfidentialityAirlockService.scrubDeterministicPii(userRequest || '').scrubbed;
        const sovereignVault = await retrieveSovereignVaultEvidenceForAssist(
            globalAssetId,
            pillarId,
            `${item.section || ''} ${item.title} ${safeUserRequest}`
        );

        const prompt = `Actúa como el Especialista Técnico del pilar "${agent.title}" (${agent.rolePersona}) asistiendo a un curador experto.

ACTIVO:
- Marca / Modelo: ${make} ${model}
- Denominación OEM: ${tipoEquipo}
- Características: ${caracteristicas}
- Ambientes: ${ambientes} | Contexto: ${contextos}

ÍTEM BAJO EDICIÓN:
- Título: "${item.title}" (Sección: ${item.section})
${sovereignVault.evidenceBlock ? `\nEVIDENCIA SOBERANA EN BÓVEDA (vault_corpus_chunks — southamerica-west1):\n${sovereignVault.evidenceBlock}\n` : ''}
CONTENIDO ACTUAL:
---
${item.content || '(Vacío)'}
---

SOLICITUD DEL EXPERTO HUMANO:
"${safeUserRequest}"

INSTRUCCIONES:
1. Clasifica "intent" en "CORRECTION", "RESEARCH" o "DELETION".
2. En "clarification" explica de forma técnica y concisa qué ajuste propones.
3. Si es CORRECTION o DELETION: indica "originalFragment" (exacto) y "proposedFragment" (o "[SEGMENTO ELIMINADO]").
4. Si es RESEARCH: respalda cada dato en la bóveda soberana o búsqueda verificada y redacta el bloque técnico en "additionalBlock".
5. En "finalContent" entrega el Markdown completo resultante listo para revisión HITL (sin HTML).

Responde estrictamente en JSON válido:
{
  "intent": "CORRECTION",
  "clarification": "...",
  "originalFragment": "",
  "proposedFragment": "",
  "additionalBlock": "",
  "finalContent": "..."
}`;

        const requiresExternalWebResearch = EXPLICIT_EXTERNAL_SEARCH_REQUEST_REGEX.test(safeUserRequest);

        const aiRes = await ResilientAIClient.generate({
            module: 'opermaq',
            preferredTier: 'SECONDARY',
            systemInstruction: agent.systemPrompt,
            temperature: 0.1,
            useGoogleSearch: requiresExternalWebResearch,
            requireGroundedEvidence: requiresExternalWebResearch,
            prompt,
        });

        const parsed = JSON.parse(ResilientAIClient.extractJsonString(aiRes.text));
        const safeFinal = parsed.finalContent
            ? sanitizePositivePresenceMarkdown(
                  verifyAndNormalizeTechnicalUnits(String(parsed.finalContent)).normalizedMarkdown,
                  { pillarId }
              )
            : undefined;

        return {
            success: true,
            intent: parsed.intent || 'CORRECTION',
            clarification: parsed.clarification,
            originalFragment: parsed.originalFragment,
            proposedFragment: parsed.proposedFragment,
            additionalBlock: parsed.additionalBlock,
            finalContent: safeFinal,
        };
    } catch (err: any) {
        console.error('[AiAssistService] Error en assistItemEdit:', err);
        return { success: false, error: err?.message || 'Error en asistente de edición IA.' };
    }
}

export async function assistRejection(options: {
    globalAssetId: string;
    pillarId: PillarId;
    itemId: string;
    rejectionNote: string;
}): Promise<AiAssistResponse> {
    const { globalAssetId, pillarId, itemId, rejectionNote } = options;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
        if (!hydrated.exists || !hydrated.data) throw new Error(`Catálogo no encontrado: ${globalAssetId}`);

        const catalogProfile = hydrated.data;
        const items: PillarItem[] = catalogProfile?.knowledge_vault?.[pillarId]?.items ?? [];
        const item = items.find((it) => it.item_id === itemId);
        if (!item) throw new Error(`Ítem "${itemId}" no encontrado.`);

        const make = String(catalogProfile.make_oficial || catalogProfile.make || 'GENÉRICO').trim();
        const model = String(catalogProfile.model_oficial || catalogProfile.model || globalAssetId).trim();
        const agent = PILLAR_AGENTS[pillarId];

        const safeRejectionNote = ConfidentialityAirlockService.scrubDeterministicPii(
            rejectionNote || ''
        ).scrubbed;

        // Modo SOVEREIGN_VAULT_FIRST (Ley N° 21.719): consultar primero `vault_corpus_chunks` del equipo en southamerica-west1
        const sovereignVault = await retrieveSovereignVaultEvidenceForAssist(
            globalAssetId,
            pillarId,
            `${item.section || ''} ${item.title} ${safeRejectionNote}`
        );
        const hasSufficientSovereignEvidence = sovereignVault.totalChars >= 120;
        const explicitCuratorWebRequest = EXPLICIT_EXTERNAL_SEARCH_REQUEST_REGEX.test(safeRejectionNote);
        const shouldUseExternalSearch = explicitCuratorWebRequest || !hasSufficientSovereignEvidence;

        const prompt = `Un revisor humano rechazó el ítem "${item.title}" del equipo "${make} ${model}" en el pilar "${agent.title}".

OBSERVACIÓN DE RECHAZO HUMANO:
"${safeRejectionNote}"
${sovereignVault.evidenceBlock
                ? `\nEVIDENCIA SOBERANA LOCAL EN BÓVEDA (vault_corpus_chunks — southamerica-west1, PRIORIDAD PRIMARIA):\n${sovereignVault.evidenceBlock}\n`
                : '\n(Sin fragmentos suficientes en vault_corpus_chunks locales para este capítulo)\n'
            }
CONTENIDO RECHAZADO:
---
${item.content || '(Vacío)'}
---

Genera una propuesta técnica corregida priorizando estrictamente la evidencia soberana local de la bóveda${shouldUseExternalSearch ? ' y respaldando con fuentes web OEM verificadas los datos faltantes' : ' (sin recurrir a fuentes externas)'}.
Responde estrictamente en JSON puro:
{
  "clarification": "Explicación concisa de la corrección aplicada",
  "finalContent": "Contenido Markdown completo corregido (sin HTML)"
}`;

        const aiRes = await ResilientAIClient.generate({
            module: 'opermaq',
            preferredTier: 'SECONDARY',
            systemInstruction: agent.systemPrompt,
            temperature: 0.1,
            useGoogleSearch: shouldUseExternalSearch,
            requireGroundedEvidence: shouldUseExternalSearch,
            prompt,
        });

        const parsed = JSON.parse(ResilientAIClient.extractJsonString(aiRes.text));
        const safeFinal = parsed.finalContent
            ? sanitizePositivePresenceMarkdown(
                  verifyAndNormalizeTechnicalUnits(String(parsed.finalContent)).normalizedMarkdown,
                  { pillarId }
              )
            : undefined;

        return {
            success: true,
            intent: 'CORRECTION',
            clarification: parsed.clarification,
            finalContent: safeFinal,
        };
    } catch (err: any) {
        console.error('[AiAssistService] Error en assistRejection:', err);
        return { success: false, error: err?.message || 'Error en asistente de rechazo IA.' };
    }
}

/**
 * Fusión determinista de propuestas HITL (`NUEVO` y `CONFLICTO`) sobre el Markdown del ítem.
 * Garantiza actualización inmediata y 0 pérdida de estructura tabular cuando existe coincidencia
 * quirúrgica de `valor_actual` o como respaldo determinista infalible ante latencia/fallo del LLM.
 */
export function applyDeterministicProposalFallback(
    currentContent: string,
    deltas: ProposedUpdate[],
    pillarId: PillarId
): string {
    let nextContent = String(currentContent || '').trim();

    for (const delta of deltas) {
        const rawNew = String(delta.valor_nuevo || delta.condicion_esperada || '').trim();
        if (!rawNew) continue;
        const normalizedNew = verifyAndNormalizeTechnicalUnits(rawNew).normalizedMarkdown.trim();

        // 1. Si es CONFLICTO (o incluye valor_actual) y coincide con un fragmento del documento, reemplazo quirúrgico 1:1
        if (delta.valor_actual && delta.valor_actual.trim().length > 0 && nextContent) {
            const spliced = applySurgicalFragmentSplice({
                currentContent: nextContent,
                selectedFragment: delta.valor_actual.trim(),
                fragmentReplacement: normalizedNew,
                pillarId,
            });
            if (spliced && spliced !== nextContent) {
                nextContent = spliced;
                continue;
            }
        }

        // 2. Si el bloque ya está contenido literalmente, no duplicar
        if (nextContent.toLowerCase().includes(normalizedNew.toLowerCase())) {
            continue;
        }

        // 3. Integración estructurada según formato del hallazgo y pilar
        const isMarkdownTableOrSection =
            normalizedNew.startsWith('|') ||
            normalizedNew.startsWith('#') ||
            normalizedNew.includes('\n|');

        if (!nextContent) {
            if (isMarkdownTableOrSection) {
                nextContent = normalizedNew;
            } else if (pillarId === 'ficha_tecnica') {
                nextContent = [
                    `### ${delta.zona || delta.componente || 'Especificaciones Técnicas Verificadas'}`,
                    '| Parámetro / Especificación | Valor OEM Verificado (SI + Imperial) | Norma / Condición de Medición |',
                    '| :--- | :--- | :--- |',
                    `| ${delta.componente || 'Parámetro técnico'} | ${normalizedNew.replace(/\|/g, '/')} | ${delta.synthesis || delta.condicion_esperada || 'Fuente verificada'} |`,
                ].join('\n');
            } else {
                nextContent = `### ${delta.componente || delta.zona || 'Actualización Técnica'}\n\n${normalizedNew}`;
            }
            continue;
        }

        // Si el hallazgo es una fila de tabla (`| ... |`) y el documento ya tiene una tabla con el mismo número de columnas
        if (normalizedNew.startsWith('|') && !normalizedNew.includes('\n| :---') && nextContent.includes('|')) {
            const lines = nextContent.split('\n');
            let lastTableLineIdx = -1;
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].trim().startsWith('|')) {
                    lastTableLineIdx = i;
                    break;
                }
            }
            if (lastTableLineIdx !== -1) {
                lines.splice(lastTableLineIdx + 1, 0, normalizedNew);
                nextContent = lines.join('\n');
                continue;
            }
        }

        // Si estamos en Pilar 01 (Ficha Técnica) y el hallazgo es un dato puntual de texto plano, insertarlo como fila en la tabla existente
        if (!isMarkdownTableOrSection && pillarId === 'ficha_tecnica' && nextContent.includes('|')) {
            const lines = nextContent.split('\n');
            let lastTableLineIdx = -1;
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].trim().startsWith('|')) {
                    lastTableLineIdx = i;
                    break;
                }
            }
            if (lastTableLineIdx !== -1) {
                const paramLabel = (delta.componente || delta.zona || 'Parámetro OEM').replace(/\|/g, '/').trim();
                const cleanVal = normalizedNew.replace(/\r?\n/g, ' — ').replace(/\|/g, '/').trim();
                const cleanCond = String(delta.synthesis || delta.condicion_esperada || 'Verificado HITL')
                    .replace(/\r?\n/g, ' ')
                    .replace(/\|/g, '/')
                    .slice(0, 120)
                    .trim();
                lines.splice(lastTableLineIdx + 1, 0, `| ${paramLabel} | ${cleanVal} | ${cleanCond} |`);
                nextContent = lines.join('\n');
                continue;
            }
        }

        // Caso general: anexar bloque técnico estructurado al final del documento
        const heading = delta.componente || delta.zona || 'Actualización Técnica Verificada';
        const blockToAppend = isMarkdownTableOrSection
            ? `\n\n${normalizedNew}`
            : `\n\n### ${heading}\n${normalizedNew}`;
        nextContent = `${nextContent}${blockToAppend}`.trim();
    }

    return sanitizePositivePresenceMarkdown(
        verifyAndNormalizeTechnicalUnits(nextContent).normalizedMarkdown,
        { pillarId }
    );
}

export async function evolveItemContent(params: {
    makeModel: string;
    itemTitle: string;
    currentContent: string;
    deltas: ProposedUpdate[];
    pillarId: PillarId;
}): Promise<string> {
    const { makeModel, itemTitle, currentContent, deltas, pillarId } = params;
    const agent = PILLAR_AGENTS[pillarId];
    const pillarGovernance = getPillarEditGovernancePrompt(pillarId);

    // Si todos los deltas son CONFLICTO con coincidencia quirúrgica exacta en currentContent, aplicar en 0ms sin deriva LLM
    if (
        currentContent &&
        deltas.length > 0 &&
        deltas.every((d) => d.valor_actual && d.valor_actual.trim().length > 0 && currentContent.includes(d.valor_actual.trim()))
    ) {
        const directSpliced = applyDeterministicProposalFallback(currentContent, deltas, pillarId);
        if (directSpliced && directSpliced !== currentContent.trim()) {
            return directSpliced;
        }
    }

    const prompt = `Eres "${agent.rolePersona}" del pilar "${agent.title}" para el equipo "${makeModel}".
Debes integrar de forma NO DESTRUCTIVA los siguientes hallazgos autorizados por un humano en el ítem "${itemTitle}".

${pillarGovernance}

CONTENIDO ACTUAL DEL ÍTEM:
"""
${currentContent || '(Vacío)'}
"""

HALLAZGOS AUTORIZADOS POR EXPERTO HUMANO:
${JSON.stringify(deltas, null, 2)}

REGLAS ESTRICTAS:
1. Integra toda la información nueva de los hallazgos autorizados respetando estrictamente las tablas del pilar "${agent.title}".
2. Conserva íntegramente el resto de información técnica existente que no esté en contradicción directa con los hallazgos aprobados (incluidos los marcadores [SÍMBOLO: concept_id]).
3. Si un hallazgo CONFLICTO reemplaza una cifra o instrucción previa, actualiza el dato exacto en la celda correspondiente.
4. Devuelve ÚNICAMENTE el contenido Markdown técnico limpio resultante (cero HTML, cero saludos o preámbulos).`;

    try {
        const aiRes = await ResilientAIClient.generate({
            module: 'opermaq',
            preferredTier: 'SECONDARY',
            systemInstruction: `${agent.systemPrompt}\n${pillarGovernance}`,
            temperature: 0.1,
            maxOutputTokens: 8192,
            prompt,
        });

        const text = sanitizePositivePresenceMarkdown(
            verifyAndNormalizeTechnicalUnits(aiRes.text.trim()).normalizedMarkdown,
            { pillarId }
        );
        if (text && text.trim().length > 0) {
            return text;
        }
    } catch (err) {
        console.warn('[AiAssistService] Fallback determinista activado en evolveItemContent:', err);
    }

    return applyDeterministicProposalFallback(currentContent, deltas, pillarId);
}

export async function correctManualItemText(
    title: string,
    rationale: string,
    context?: { makeModel?: string; tipoEquipo?: string; pillarId?: PillarId }
): Promise<{ title: string; rationale: string; section: string }> {
    const cleanTitle = ConfidentialityAirlockService.scrubDeterministicPii(String(title || '')).scrubbed.trim();
    const cleanRationale = ConfidentialityAirlockService.scrubDeterministicPii(String(rationale || '')).scrubbed.trim();

    const schema = {
        type: Type.OBJECT,
        properties: {
            title: { type: Type.STRING },
            rationale: { type: Type.STRING },
            section: { type: Type.STRING },
        },
        required: ['title', 'rationale', 'section'],
    };

    const assetCtx = context?.makeModel
        ? `Equipo: "${context.makeModel}" (${context.tipoEquipo || 'Equipamiento Técnico'}) | Pilar: "${context.pillarId || 'ficha_tecnica'}".\n`
        : '';

    try {
        const { data } = await ResilientAIClient.generateStructured<{
            title: string;
            rationale: string;
            section: string;
        }>({
            module: 'opermaq',
            preferredTier: 'ANCHOR_HA',
            temperature: 0,
            responseSchema: schema,
            prompt: `${assetCtx}Corrige únicamente errores ortográficos, de digitación y puntuación en el siguiente título y descripción de ítem técnico de maquinaria industrial, sin alterar su sentido ni agregar adornos. Además asigna en "section" una sección técnica corta en MAYÚSCULAS acorde al subsistema (ej. "PLANTA MOTRIZ", "TREN DE POTENCIA", "HIDRÁULICA E IMPLEMENTOS", "CHASIS Y RODADO", "GEOMETRÍA Y MASAS", "SERVICIO Y ELECTRICIDAD", "SEGURIDAD Y CONTROL"):
- Título original: "${cleanTitle}"
- Descripción original: "${cleanRationale}"`,
        });

        return {
            title: data.title?.trim() || cleanTitle,
            rationale: data.rationale?.trim() || cleanRationale,
            section: (data.section?.trim() || 'ESPECIFICACIÓN TÉCNICA').toUpperCase(),
        };
    } catch {
        return {
            title: cleanTitle,
            rationale: cleanRationale,
            section: 'ESPECIFICACIÓN TÉCNICA',
        };
    }
}

