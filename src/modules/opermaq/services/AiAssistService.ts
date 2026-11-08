import { db } from '../../../config/firebase';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { ResilientAIClient, Type } from '../../../core/resilient-ai-client';
import { PillarId, PillarItem, ProposedUpdate } from '../types/vault.types';
import { verifyAndNormalizeTechnicalUnits } from './NeuroSymbolicVerifier';
import { PILLAR_AGENTS } from './pillarAgents';

/**
 * AI ASSIST SERVICE — ETAPA 4 ASISTENCIA QUIRÚRGICA, EVOLUCIÓN Y ORTOGRAFÍA TÉCNICA
 * 100% enrutado por `ResilientAIClient` v2.0 (Cero simulación, HITL obligatorio antes de persistir).
 */

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
        const snap = await db.collection('global_asset_catalog').doc(globalAssetId).get();
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

        const prompt = `Actúa como el Especialista Técnico del pilar "${agent.title}" (${agent.rolePersona}) asistiendo a un curador experto.

ACTIVO:
- Marca / Modelo: ${make} ${model}
- Denominación OEM: ${tipoEquipo}
- Características: ${caracteristicas}
- Ambientes: ${ambientes} | Contexto: ${contextos}

ÍTEM BAJO EDICIÓN:
- Título: "${item.title}" (Sección: ${item.section})

CONTENIDO ACTUAL:
---
${item.content || '(Vacío)'}
---

SOLICITUD DEL EXPERTO HUMANO:
"${userRequest}"

INSTRUCCIONES:
1. Clasifica "intent" en "CORRECTION", "RESEARCH" o "DELETION".
2. En "clarification" explica de forma técnica y concisa qué ajuste propones.
3. Si es CORRECTION o DELETION: indica "originalFragment" (exacto) y "proposedFragment" (o "[SEGMENTO ELIMINADO]").
4. Si es RESEARCH: usa Google Search y redacta el bloque técnico verificado en "additionalBlock".
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

        const aiRes = await ResilientAIClient.generate({
            module: 'opermaq',
            preferredTier: 'SECONDARY',
            systemInstruction: agent.systemPrompt,
            temperature: 0.1,
            useGoogleSearch: true,
            prompt,
        });

        const parsed = JSON.parse(ResilientAIClient.extractJsonString(aiRes.text));
        const safeFinal = parsed.finalContent
            ? verifyAndNormalizeTechnicalUnits(String(parsed.finalContent)).normalizedMarkdown
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
        const snap = await db.collection('global_asset_catalog').doc(globalAssetId).get();
        if (!snap.exists) throw new Error(`Catálogo no encontrado: ${globalAssetId}`);

        const catalogProfile = snap.data() || {};
        const items: PillarItem[] = catalogProfile?.knowledge_vault?.[pillarId]?.items ?? [];
        const item = items.find((it) => it.item_id === itemId);
        if (!item) throw new Error(`Ítem "${itemId}" no encontrado.`);

        const make = String(catalogProfile.make_oficial || catalogProfile.make || 'GENÉRICO').trim();
        const model = String(catalogProfile.model_oficial || catalogProfile.model || globalAssetId).trim();
        const agent = PILLAR_AGENTS[pillarId];

        const prompt = `Un revisor humano rechazó el ítem "${item.title}" del equipo "${make} ${model}" en el pilar "${agent.title}".

OBSERVACIÓN DE RECHAZO HUMANO:
"${rejectionNote}"

CONTENIDO RECHAZADO:
---
${item.content || '(Vacío)'}
---

Genera una propuesta técnica corregida (puedes verificar con Google Search si hay dudas de cifras OEM).
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
            useGoogleSearch: true,
            prompt,
        });

        const parsed = JSON.parse(ResilientAIClient.extractJsonString(aiRes.text));
        const safeFinal = parsed.finalContent
            ? verifyAndNormalizeTechnicalUnits(String(parsed.finalContent)).normalizedMarkdown
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

export async function evolveItemContent(params: {
    makeModel: string;
    itemTitle: string;
    currentContent: string;
    deltas: ProposedUpdate[];
    pillarId: PillarId;
}): Promise<string> {
    const { makeModel, itemTitle, currentContent, deltas, pillarId } = params;
    const agent = PILLAR_AGENTS[pillarId];

    const prompt = `Eres el Especialista Técnico del pilar "${agent.title}" para el equipo "${makeModel}".
Debes integrar de forma NO DESTRUCTIVA los siguientes hallazgos autorizados por un humano en el ítem "${itemTitle}".

CONTENIDO ACTUAL DEL ÍTEM:
"""
${currentContent || '(Vacío)'}
"""

HALLAZGOS AUTORIZADOS POR EXPERTO HUMANO:
${JSON.stringify(deltas, null, 2)}

REGLAS ESTRICTAS:
1. Integra toda la información nueva de los hallazgos autorizados.
2. Conserva íntegramente el resto de información técnica existente que no esté en contradicción directa con los hallazgos aprobados (incluidos los marcadores [SÍMBOLO: concept_id]).
3. Si un hallazgo CONFLICTO reemplaza una cifra o instrucción previa, actualiza el dato exacto.
4. Devuelve ÚNICAMENTE el contenido Markdown técnico limpio resultante (cero HTML, cero saludos o preámbulos).`;

    const aiRes = await ResilientAIClient.generate({
        module: 'opermaq',
        preferredTier: 'PRIMARY',
        systemInstruction: agent.systemPrompt,
        temperature: 0.1,
        maxOutputTokens: 8192,
        prompt,
    });

    const text = verifyAndNormalizeTechnicalUnits(aiRes.text.trim()).normalizedMarkdown;
    if (!text) {
        throw new Error('La síntesis evolutiva devolvió texto vacío.');
    }
    return text;
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

