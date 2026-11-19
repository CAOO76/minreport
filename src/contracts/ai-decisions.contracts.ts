import { z } from 'zod';

/**
 * CONTRATOS CANÓNICOS GEMINI DECISIONS API (`gemini-decision-1` — Capa 4 MINREPORT)
 *
 * Alineado con la especificación oficial de `POST /v1beta/decisions`:
 * - Preguntas aisladas en paralelo (`noul`, `choice`, `score`), 1 a 1.000 por llamada.
 * - Salida de probabilidades calibradas y `confidence` con `0` tokens de generación.
 * - Validación estricta de claves, MIME types y URIs permitidas.
 */

export const DECISION_QUESTION_KEY_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;
const NON_ASCII_SPACE_REGEX = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/;

const SUPPORTED_DECISION_MIME_TYPES = new Set<string>([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/gif',
    'image/bmp',
    'image/tiff',
    'audio/wav',
    'audio/mp3',
    'audio/mpeg',
    'audio/aiff',
    'audio/aac',
    'audio/ogg',
    'audio/flac',
    'audio/m4a',
    'audio/opus',
    'audio/webm',
    'audio/l16',
    'audio/alaw',
    'audio/mulaw',
    'video/mp4',
    'video/mpeg',
    'video/mov',
    'video/quicktime',
    'video/avi',
    'video/webm',
    'video/wmv',
    'video/x-flv',
    'video/3gpp',
]);

export function isValidDecisionOptionKey(key: string): boolean {
    if (typeof key !== 'string') return false;
    if (key.length < 1 || key.length > 128) return false;
    if (key !== key.trim()) return false;
    if (Buffer.byteLength(key, 'utf8') > 512) return false;
    if (CONTROL_CHARS_REGEX.test(key)) return false;
    if (NON_ASCII_SPACE_REGEX.test(key)) return false;
    return true;
}

export const NoulQuestionSchema = z.object({
    type: z.literal('noul'),
    instructions: z.string().trim().min(1).max(8000),
    criteria: z
        .object({
            true_description: z.string().trim().min(1).max(2000),
            false_description: z.string().trim().min(1).max(2000),
        })
        .optional(),
});

export const ChoiceQuestionSchema = z.object({
    type: z.literal('choice'),
    instructions: z.string().trim().min(1).max(8000),
    criteria: z
        .record(
            z
                .string()
                .refine(isValidDecisionOptionKey, 'Clave de opción inválida para Decisions API (1..128 chars, sin espacios extremos ni caracteres de control).'),
            z.string().max(2000)
        )
        .refine(
            (obj) => {
                const count = Object.keys(obj).length;
                return count >= 2 && count <= 255;
            },
            'Choice requiere entre 2 y 255 opciones.'
        ),
});

export const ScoreQuestionSchema = z.object({
    type: z.literal('score'),
    instructions: z.string().trim().min(1).max(8000),
    criteria: z.array(z.string().trim().min(1).max(2000)).min(2).max(255),
});

export const DecisionQuestionSchema = z.discriminatedUnion('type', [
    NoulQuestionSchema,
    ChoiceQuestionSchema,
    ScoreQuestionSchema,
]);

export type DecisionQuestion = z.infer<typeof DecisionQuestionSchema>;

export const DecisionMediaResolutionSchema = z.enum(['low', 'medium', 'high', 'ultra_high']);
export type DecisionMediaResolution = z.infer<typeof DecisionMediaResolutionSchema>;

export const AIDecisionMediaPartSchema = z
    .object({
        mimeType: z.string().trim().min(3).max(128),
        dataBase64: z.string().min(4).optional(),
        uri: z.string().trim().url().optional(),
        resolution: DecisionMediaResolutionSchema.optional(),
    })
    .superRefine((part, ctx) => {
        const hasData = typeof part.dataBase64 === 'string' && part.dataBase64.trim().length > 0;
        const hasUri = typeof part.uri === 'string' && part.uri.trim().length > 0;

        if (!hasData && !hasUri) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Cada adjunto multimedia de Decisions API requiere `dataBase64` o `uri`.',
                path: ['dataBase64'],
            });
        } else if (hasData && hasUri) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Especifique únicamente `dataBase64` o `uri` por adjunto, no ambos simultáneamente.',
                path: ['uri'],
            });
        }

        const baseMime = part.mimeType.split(';')[0].trim().toLowerCase();
        if (baseMime === 'application/octet-stream' || baseMime === 'image/svg+xml') {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `MIME type "${baseMime}" no permitido en Gemini Decisions API.`,
                path: ['mimeType'],
            });
        } else if (!SUPPORTED_DECISION_MIME_TYPES.has(baseMime)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `MIME type "${baseMime}" no soportado por Gemini Decisions API.`,
                path: ['mimeType'],
            });
        }

        if (hasUri && part.uri) {
            const rawUri = part.uri.trim();
            if (/^gs:\/\//i.test(rawUri)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Decisions API no soporta URIs directos de Cloud Storage (`gs://`); utilice `dataBase64` o URL HTTPS firmada.',
                    path: ['uri'],
                });
                return;
            }
            try {
                const parsed = new URL(rawUri);
                if (parsed.protocol !== 'https:') {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: 'La URI externa para Decisions API debe utilizar protocolo `https://`.',
                        path: ['uri'],
                    });
                }
                const host = parsed.hostname.toLowerCase();
                if (
                    host === 'youtube.com' ||
                    host.endsWith('.youtube.com') ||
                    host === 'youtu.be'
                ) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: 'Decisions API no soporta URLs de YouTube.',
                        path: ['uri'],
                    });
                }
            } catch {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'URI inválida para Decisions API.',
                    path: ['uri'],
                });
            }
        }
    });

export type AIDecisionMediaPart = z.infer<typeof AIDecisionMediaPartSchema>;

export const AIDecisionDataClassificationSchema = z.enum(['GLOBAL_OEM', 'TENANT_PRIVATE']);
export type AIDecisionDataClassification = z.infer<typeof AIDecisionDataClassificationSchema>;

export const AIDecisionModuleScopeSchema = z.enum([
    'opermaq',
    'stockpile',
    'geolapp',
    'core',
    'test-pilot',
]);

export const AIDecisionRequestSchema = z
    .object({
        module: AIDecisionModuleScopeSchema,
        tenantId: z.string().trim().min(1).max(128).optional(),
        dataClassification: AIDecisionDataClassificationSchema.optional(),
        isEduSandbox: z.boolean().optional(),
        countryCode: z.string().trim().max(8).optional(),
        inputText: z.string().max(500_000).optional(),
        media: z.array(AIDecisionMediaPartSchema).max(16).optional(),
        questions: z
            .record(
                z
                    .string()
                    .regex(
                        DECISION_QUESTION_KEY_REGEX,
                        'Clave de pregunta inválida: use 1..64 caracteres `[A-Za-z0-9_-]+`.'
                    ),
                DecisionQuestionSchema
            )
            .refine(
                (qMap) => {
                    const count = Object.keys(qMap).length;
                    return count >= 1 && count <= 1000;
                },
                'Decisions API requiere entre 1 y 1.000 preguntas por solicitud.'
            ),
        bypassCache: z.boolean().optional(),
    })
    .superRefine((req, ctx) => {
        const hasText = typeof req.inputText === 'string' && req.inputText.trim().length > 0;
        const hasMedia = Array.isArray(req.media) && req.media.length > 0;
        if (!hasText && !hasMedia) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'La entrada de Decisions API no puede estar vacía: incluya `inputText` o al menos un elemento en `media`.',
                path: ['inputText'],
            });
        }
    });

export type AIDecisionRequest = z.infer<typeof AIDecisionRequestSchema>;

export interface NoulDecisionAnswer {
    type: 'noul';
    noul: number;
    confidence: number;
}

export interface ChoiceDecisionAnswer {
    type: 'choice';
    choice: string;
    probabilities: Record<string, number>;
    confidence: number;
}

export interface ScoreDecisionAnswer {
    type: 'score';
    score: number;
    legend: Record<string, string>;
    probabilities: Record<string, number>;
    confidence: number;
}

export type AIDecisionAnswer =
    | NoulDecisionAnswer
    | ChoiceDecisionAnswer
    | ScoreDecisionAnswer;

export interface AIDecisionUsage {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
}

export interface AIDecisionResponse {
    answers: Record<string, AIDecisionAnswer>;
    model: string;
    engineUsed: 'DECISIONS_API_V1BETA' | 'SWARM_ANCHOR_FALLBACK';
    latencyMs: number;
    cached: boolean;
    usage: AIDecisionUsage;
}
