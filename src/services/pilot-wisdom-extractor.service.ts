import { z } from 'zod';
import { ConfidentialityAirlockService } from '../core/privacy/ConfidentialityAirlockService';
import { ResilientAIClient, Type, type InlineMediaPart } from '../core/resilient-ai-client';

/**
 * SERVICIO EXTRACTOR SOBERANO DE SABIDURÍA MINERA (`PilotWisdomExtractorService`)
 *
 * Convierte relatos naturales (orales o escritos en español minero coloquial) de expertos
 * 1º DEV y 3º TEST-PILOT en conocimiento operacional estructurado para `pilot_feedback` e IA:
 *
 * 1. Cumplimiento Ley N° 19.628 / Nueva Ley N° 21.719:
 *    - Purga determinista de PII chilena/multi-país (`ConfidentialityAirlockService.scrubDeterministicPii`)
 *      sobre toda narrativa y contexto ANTES de cualquier inferencia, y re-sanitización de toda salida.
 *    - Procesamiento exclusivo en `southamerica-west1` vía `ResilientAIClient` (CDPA Zero-Training).
 * 2. Cumplimiento `MINREPORT-MEDIA-DIGESTOR-CAS`:
 *    - Audio efímero opcional en memoria (`ephemeralAudio`) jamás se persiste en Firestore ni Cloud Storage.
 * 3. Veracidad Técnica Absoluta (`GEMINI.md` §3.1):
 *    - Jamás inventa valores de ficha; si el texto no menciona un parámetro previo en ficha, devuelve
 *      `'[Información técnica no declarada en ficha]'`.
 */

export const UNDECLARED_FICHA_STATE = '[Información técnica no declarada en ficha]';

export const EphemeralAudioSchema = z.object({
    mimeType: z.enum(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg']),
    /** Máximo ~2 MB base64 (~1.5 MB audio comprimido) en memoria efímera */
    dataBase64: z.string().min(16).max(2_800_000),
});

export const ExtractWisdomInputSchema = z.object({
    rawNarrative: z.string().max(6000).default(''),
    module: z.enum(['core', 'opermaq', 'stockpile', 'geolapp', 'supply']).default('core'),
    contextPath: z.string().min(1).max(256).default('/'),
    assetOrSurveyId: z.string().max(128).optional(),
    currentItemContext: z.string().max(1000).optional(),
    countryCode: z.string().max(8).optional(),
    preferredLang: z.enum(['es', 'en', 'pt']).default('es'),
    ephemeralAudio: EphemeralAudioSchema.optional(),
});

export type ExtractWisdomInput = z.infer<typeof ExtractWisdomInputSchema>;

export const ExtractedWisdomOutputSchema = z.object({
    category: z.enum(['FIELD_SIMULATION', 'AI_KNOWLEDGE_TRAINING', 'CHANGE_REQUEST', 'BUG_CORRECTION']),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    cleanObservation: z.string().min(3).max(4000),
    currentFichaState: z.string().min(3).max(500),
    proposedMaestroWisdom: z.string().min(3).max(1000),
    expectedAiBehavior: z.string().min(3).max(2000),
    suggestedAssetOrSurveyId: z.string().max(128).optional(),
});

export type ExtractedWisdomOutput = z.infer<typeof ExtractedWisdomOutputSchema>;

export interface ExtractWisdomResult extends ExtractedWisdomOutput {
    redactedCategories: string[];
    engineMode: 'GEMINI_SWARM' | 'DETERMINISTIC_FALLBACK';
}

export class PilotWisdomExtractorService {
    private static classifyDeterministic(
        scrubbedNarrative: string,
        scrubbedItemContext: string
    ): ExtractedWisdomOutput {
        const lower = scrubbedNarrative.toLowerCase();

        let category: ExtractedWisdomOutput['category'] = 'AI_KNOWLEDGE_TRAINING';
        if (/\b(error|falla|no carga|no funciona|roto|bug|trabado|cuelga|calcula mal)\b/i.test(lower)) {
            category = 'BUG_CORRECTION';
        } else if (/\b(botón|letra|pantalla|agrandar|cambiar|menú|agregar campo|interfaz)\b/i.test(lower)) {
            category = 'CHANGE_REQUEST';
        } else if (/\b(simul|prueba|terreno|acopio|cubica|turno|pila)\b/i.test(lower)) {
            category = 'FIELD_SIMULATION';
        }

        let priority: ExtractedWisdomOutput['priority'] = 'MEDIUM';
        if (/\b(fatal|urgente|detenci[oó]n|incendio|freno|corte|colapso|evacuaci[oó]n|peligro|cr[ií]tic[oa]|ds\s*132)\b/i.test(lower)) {
            priority = 'CRITICAL';
        } else if (/\b(riesgo|alerta|altura|sobrecarga|cavitaci[oó]n|temperatura|presi[oó]n|desgaste)\b/i.test(lower)) {
            priority = 'HIGH';
        }

        const trimmedContext = scrubbedItemContext.trim();
        const currentFichaState = trimmedContext.length >= 3 ? trimmedContext : UNDECLARED_FICHA_STATE;

        const cleanObservation = scrubbedNarrative.trim() || UNDECLARED_FICHA_STATE;
        const proposedMaestroWisdom =
            cleanObservation.length > 260 ? `${cleanObservation.slice(0, 257).trim()}...` : cleanObservation;

        const expectedAiBehavior =
            category === 'BUG_CORRECTION'
                ? `Corregir validación técnica en terreno según observación reportada: ${proposedMaestroWisdom}`
                : category === 'CHANGE_REQUEST'
                  ? `Evaluar ajuste operativo/ergonómico solicitado por especialista senior: ${proposedMaestroWisdom}`
                  : `Incorporar criterio experto operacional en bóveda técnica MINREPORT: ${proposedMaestroWisdom}`;

        return {
            category,
            priority,
            cleanObservation,
            currentFichaState,
            proposedMaestroWisdom,
            expectedAiBehavior,
        };
    }

    public static async extractWisdom(
        rawInput: ExtractWisdomInput,
        options?: { forceDeterministicFallback?: boolean }
    ): Promise<ExtractWisdomResult> {
        const input = ExtractWisdomInputSchema.parse(rawInput);

        if (!input.rawNarrative.trim() && !input.ephemeralAudio) {
            throw new Error('Debe dictar o escribir una observación antes de estructurar el aporte.');
        }

        const redactedSet = new Set<string>();

        const narrativeScrub = ConfidentialityAirlockService.scrubDeterministicPii(
            input.rawNarrative,
            input.countryCode
        );
        narrativeScrub.redactedCategories.forEach((c) => redactedSet.add(c));

        const itemContextScrub = ConfidentialityAirlockService.scrubDeterministicPii(
            input.currentItemContext || '',
            input.countryCode
        );
        itemContextScrub.redactedCategories.forEach((c) => redactedSet.add(c));

        const sanitizedAssetId = input.assetOrSurveyId
            ? ConfidentialityAirlockService.scrubDeterministicPii(input.assetOrSurveyId, input.countryCode).scrubbed
            : undefined;

        const deterministicFallback = this.classifyDeterministic(
            narrativeScrub.scrubbed || (input.ephemeralAudio ? '[AUDIO_MAESTRO_SIN_TEXTO]' : ''),
            itemContextScrub.scrubbed
        );

        if (options?.forceDeterministicFallback) {
            return {
                ...deterministicFallback,
                suggestedAssetOrSurveyId: sanitizedAssetId,
                redactedCategories: Array.from(redactedSet),
                engineMode: 'DETERMINISTIC_FALLBACK',
            };
        }

        const langName =
            input.preferredLang === 'en' ? 'English' : input.preferredLang === 'pt' ? 'Portuguese' : 'Spanish';

        const promptParts = [
            `Eres el asistente de transcripción técnica soberana de MINREPORT.`,
            `Un maestro experto minero (que no domina jerga informática) relató un aporte operacional en lenguaje natural.`,
            `Módulo activo: ${input.module}`,
            `Sección de pantalla: ${input.contextPath}`,
            `Identificador activo/pilha si existe: ${sanitizedAssetId || UNDECLARED_FICHA_STATE}`,
            `Referencia actual en pantalla: ${itemContextScrub.scrubbed || UNDECLARED_FICHA_STATE}`,
            `Relato escrito o dictado del especialista: ${narrativeScrub.scrubbed || '[Ver audio adjunto]'}`,
            ``,
            `REGLAS ESTRICTAS DE VERACIDAD:`,
            `1. Responde estrictamente en formato JSON con las claves solicitadas, redactadas en ${langName} claro, llano y respetuoso (apto para pantalla de lectura simple).`,
            `2. Si no consta qué decía antes la ficha en la referencia actual, pon EXACTAMENTE "${UNDECLARED_FICHA_STATE}" en currentFichaState. Prohibido inventar cifras o normativas.`,
            `3. Deduce automáticamente category (FIELD_SIMULATION, AI_KNOWLEDGE_TRAINING, CHANGE_REQUEST, BUG_CORRECTION) y priority (LOW, MEDIUM, HIGH, CRITICAL) según impacto operacional/seguridad DS 132.`,
            `4. Jamás incluyas datos personales (RUT, correos, teléfonos, patentes PPU ni coordenadas GPS).`,
        ].join('\n');

        const mediaParts: InlineMediaPart[] | undefined = input.ephemeralAudio
            ? [
                  {
                      mimeType: input.ephemeralAudio.mimeType,
                      dataBase64: input.ephemeralAudio.dataBase64,
                  },
              ]
            : undefined;

        try {
            const aiRes = await ResilientAIClient.generate({
                module: input.module === 'core' ? 'test-pilot' : input.module,
                countryCode: input.countryCode,
                preferredTier: 'SECONDARY',
                thinkingLevel: 'low',
                temperature: 0.1,
                bypassCache: true,
                prompt: promptParts,
                media: mediaParts,
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        category: {
                            type: Type.STRING,
                            enum: ['FIELD_SIMULATION', 'AI_KNOWLEDGE_TRAINING', 'CHANGE_REQUEST', 'BUG_CORRECTION'],
                        },
                        priority: {
                            type: Type.STRING,
                            enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
                        },
                        cleanObservation: { type: Type.STRING },
                        currentFichaState: { type: Type.STRING },
                        proposedMaestroWisdom: { type: Type.STRING },
                        expectedAiBehavior: { type: Type.STRING },
                        suggestedAssetOrSurveyId: { type: Type.STRING },
                    },
                    required: [
                        'category',
                        'priority',
                        'cleanObservation',
                        'currentFichaState',
                        'proposedMaestroWisdom',
                        'expectedAiBehavior',
                    ],
                },
            });

            const parsedJson = JSON.parse(aiRes.text || '{}');
            const validated = ExtractedWisdomOutputSchema.parse(parsedJson);

            // Re-sanitización determinista obligatoria post-IA / post-audio (Ley N° 21.719)
            const obsPost = ConfidentialityAirlockService.scrubDeterministicPii(
                validated.cleanObservation,
                input.countryCode
            );
            const curPost = ConfidentialityAirlockService.scrubDeterministicPii(
                validated.currentFichaState,
                input.countryCode
            );
            const propPost = ConfidentialityAirlockService.scrubDeterministicPii(
                validated.proposedMaestroWisdom,
                input.countryCode
            );
            const expPost = ConfidentialityAirlockService.scrubDeterministicPii(
                validated.expectedAiBehavior,
                input.countryCode
            );

            [
                ...obsPost.redactedCategories,
                ...curPost.redactedCategories,
                ...propPost.redactedCategories,
                ...expPost.redactedCategories,
            ].forEach((c) => redactedSet.add(c));

            return {
                category: validated.category,
                priority: validated.priority,
                cleanObservation: obsPost.scrubbed,
                currentFichaState: curPost.scrubbed || UNDECLARED_FICHA_STATE,
                proposedMaestroWisdom: propPost.scrubbed,
                expectedAiBehavior: expPost.scrubbed,
                suggestedAssetOrSurveyId: sanitizedAssetId || validated.suggestedAssetOrSurveyId,
                redactedCategories: Array.from(redactedSet),
                engineMode: 'GEMINI_SWARM',
            };
        } catch {
            // Resiliencia garantizada: si el enjambre no está disponible, clasificamos determinísticamente
            return {
                ...deterministicFallback,
                suggestedAssetOrSurveyId: sanitizedAssetId,
                redactedCategories: Array.from(redactedSet),
                engineMode: 'DETERMINISTIC_FALLBACK',
            };
        }
    }
}
