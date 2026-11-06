import { createHash } from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import { db } from '../config/firebase';
import {
    resolveActiveGeminiKeyProfile,
    resolveGeminiApiKey,
    type GeminiKeyProfile,
} from '../config/secrets';

export { Type };

/**
 * ENJAMBRE GEMINI AI v2.0 — CLIENTE RESILIENTE CENTRALIZADO (Capa 4 MINREPORT)
 *
 * Cumplimiento estricto GEMINI.md:
 * 1. Prohibidas respuestas simuladas o datos inventados (Fail-Closed).
 * 2. Enjambre jerárquico vigente (Gemini 3.x):
 *    - Primario (Pro): gemini-3.1-pro-preview
 *    - Secundario (Flash): gemini-3.8-flash
 *    - Ancla HA (Flash-Lite): gemini-3.5-flash-lite
 * 3. Retroceso exponencial invariante con jitter:
 *    D(n) = min(32s, 2.0s * 2^n) + jitter(0, 1s)
 * 4. Soporte nativo de Grounding Web (googleSearch, urlContext, codeExecution),
 *    Salidas Estructuradas (responseSchema + Zod), Multimodalidad (fileData GCS / inlineData)
 *    y Generación Vectorial/Técnica (Imagen 4.0 / 3.0).
 * 5. Inyección continua de entrenamiento curado en `pilot_feedback` (APPLIED_TO_AI).
 */

export type ThinkingLevel = 'none' | 'low' | 'medium' | 'high';
export type SwarmTier = 'PRIMARY' | 'SECONDARY' | 'ANCHOR_HA';
export type AIModuleScope = 'opermaq' | 'stockpile' | 'core' | 'test-pilot';

export interface GroundingSource {
    title: string;
    uri: string;
}

export interface InlineMediaPart {
    mimeType: string;
    dataBase64: string;
}

export interface FileUriPart {
    fileUri: string;
    mimeType: string;
}

export interface AIInferenceRequest {
    prompt: string;
    systemInstruction?: string;
    module: AIModuleScope;
    tenantId?: string;
    thinkingLevel?: ThinkingLevel;
    thinkingBudget?: number;
    preferredTier?: SwarmTier;
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    requireHITL?: boolean;
    bypassCache?: boolean;
    useGoogleSearch?: boolean;
    /** Compuerta Fail-Closed: exige al menos 1 fuente web verificable (`groundingSources.length > 0`), abortando en lugar de responder de memoria */
    requireGroundedEvidence?: boolean;
    useUrlContext?: boolean;
    useCodeExecution?: boolean;
    responseMimeType?: string;
    responseSchema?: any;
    media?: InlineMediaPart[];
    fileParts?: FileUriPart[];
    cachedContent?: string;
}

export type EmbeddingTaskType =
    | 'RETRIEVAL_DOCUMENT'
    | 'RETRIEVAL_QUERY'
    | 'SEMANTIC_SIMILARITY'
    | 'CLASSIFICATION'
    | 'CLUSTERING';

export interface EmbeddingOptions {
    taskType?: EmbeddingTaskType;
    outputDimensionality?: number;
    title?: string;
    bypassCache?: boolean;
}

export interface AIInferenceResponse {
    text: string;
    model: string;
    tierUsed: SwarmTier;
    latencyMs: number;
    requiresHumanApproval: boolean;
    cached?: boolean;
    groundingSources: GroundingSource[];
    webSearchQueries: string[];
    rawCandidate?: any;
}

export interface TechnicalImageRequest {
    prompt: string;
    aspectRatio?: '1:1' | '4:3' | '16:9' | '3:4' | '9:16';
    outputMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface TechnicalImageResponse {
    base64Data: string;
    mimeType: string;
    modelUsed: string;
    latencyMs: number;
}

export class AISwarmUnavailableError extends Error {
    public readonly statusCode: number = 503;
    public readonly code: string;

    constructor(message: string, code: string = 'AI_SWARM_UNAVAILABLE') {
        super(message);
        this.name = 'AISwarmUnavailableError';
        this.code = code;
    }
}

export class UngroundedEvidenceError extends Error {
    public readonly statusCode: number = 422;
    public readonly code: string = 'UNGROUNDED_EVIDENCE_REJECTED';

    constructor(
        message: string = '[FAIL-CLOSED GROUNDING] El enjambre IA no devolvió fuentes técnicas verificables para respaldar los datos solicitados.'
    ) {
        super(message);
        this.name = 'UngroundedEvidenceError';
    }
}

export interface SwarmTierTelemetry {
    model: string;
    calls: number;
    errors: number;
    avgLatencyMs: number | null;
    lastLatencyMs: number | null;
    lastUsedAt: string | null;
}

export interface SwarmTelemetrySnapshot {
    totalCalls: number;
    cacheHits: number;
    l1MemoryCacheHits: number;
    totalErrors: number;
    gatewayConfigured: boolean;
    activeKeyProfile: GeminiKeyProfile;
    region: string;
    updatedAt: string;
    tiers: Record<SwarmTier, SwarmTierTelemetry>;
}

export const SWARM_MODELS: Record<SwarmTier, string> = {
    PRIMARY: process.env.PREMIUM_GEMINI_MODEL || process.env.GEMINI_PRO_MODEL || 'gemini-4-argon',
    SECONDARY: process.env.FALLBACK_GEMINI_MODEL || process.env.GEMINI_FLASH_MODEL || 'gemini-3.8-flash',
    ANCHOR_HA: process.env.LITE_GEMINI_MODEL || process.env.GEMINI_FLASH_LITE_MODEL || 'gemini-3.5-flash-lite',
};

const SWARM_TIER_FALLBACK_CANDIDATES: Record<SwarmTier, string[]> = {
    PRIMARY: ['gemini-3.1-pro-preview', 'gemini-2.5-pro'],
    SECONDARY: ['gemini-3-flash-preview', 'gemini-2.5-flash'],
    ANCHOR_HA: ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite'],
};

const IMAGE_GEN_MODELS = [
    process.env.IMAGEN_PRIMARY_MODEL || 'gemini-3-pro-image',
    process.env.NANO_BANANA_PRO_MODEL || 'gemini-nano-banana-2.1',
    'imagen-4.0-generate-001',
    process.env.IMAGEN_FALLBACK_MODEL || 'imagen-3.0-generate-002',
];

const EMBEDDING_MODELS = [
    process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
    'gemini-embedding-2',
    'text-embedding-004',
];

const memoryEmbeddingCache = new Map<string, number[]>();
const MAX_MEMORY_EMBEDDINGS = 1500;

const memoryTechnicalImageCache = new Map<string, TechnicalImageResponse>();
const MAX_MEMORY_TECHNICAL_IMAGES = 60;

interface CachedInferenceL1Entry {
    text: string;
    model: string;
    tierUsed: SwarmTier;
    groundingSources: GroundingSource[];
    webSearchQueries: string[];
    expiresAt: number;
}

const memoryInferenceCache = new Map<string, CachedInferenceL1Entry>();
const MAX_MEMORY_INFERENCE_ENTRIES = 400;
const MEMORY_INFERENCE_TTL_MS = 30 * 60 * 1000;

interface InternalTierStats {
    calls: number;
    errors: number;
    totalLatencyMs: number;
    lastLatencyMs: number | null;
    lastUsedAt: string | null;
}

const runtimeTelemetry: {
    totalCalls: number;
    cacheHits: number;
    l1MemoryCacheHits: number;
    totalErrors: number;
    tiers: Record<SwarmTier, InternalTierStats>;
} = {
    totalCalls: 0,
    cacheHits: 0,
    l1MemoryCacheHits: 0,
    totalErrors: 0,
    tiers: {
        PRIMARY: { calls: 0, errors: 0, totalLatencyMs: 0, lastLatencyMs: null, lastUsedAt: null },
        SECONDARY: { calls: 0, errors: 0, totalLatencyMs: 0, lastLatencyMs: null, lastUsedAt: null },
        ANCHOR_HA: { calls: 0, errors: 0, totalLatencyMs: 0, lastLatencyMs: null, lastUsedAt: null },
    },
};

const TELEMETRY_FLUSH_INTERVAL_MS = 60_000;
const TELEMETRY_FLUSH_BATCH_SIZE = 20;
let pendingTelemetryOps = 0;
let lastTelemetryFlushAt = 0;
let telemetryFlushTimer: NodeJS.Timeout | null = null;

let cachedGenAIClient: { key: string; client: GoogleGenAI } | null = null;
const pilotRulesCache = new Map<string, { expiresAt: number; rulesBlock: string }>();
const PILOT_RULES_TTL_MS = 60_000;

export class ResilientAIClient {
    private static readonly MAX_RETRIES_PER_TIER = 2;
    private static readonly CACHE_COLLECTION = 'ai_inference_cache';
    private static readonly TELEMETRY_COLLECTION = 'ai_telemetry';

    public static async getTelemetrySnapshot(): Promise<SwarmTelemetrySnapshot> {
        let persistedTotalCalls = 0;
        let persistedCacheHits = 0;
        let persistedErrors = 0;

        try {
            const snap = await db.collection(this.TELEMETRY_COLLECTION).doc('swarm_aggregate').get();
            if (snap.exists) {
                const d = snap.data() || {};
                persistedTotalCalls = typeof d.totalCalls === 'number' ? d.totalCalls : 0;
                persistedCacheHits = typeof d.cacheHits === 'number' ? d.cacheHits : 0;
                persistedErrors = typeof d.totalErrors === 'number' ? d.totalErrors : 0;
            }
        } catch {
            // Usar contadores en memoria si el documento aún no existe o el emulador inicia
        }

        const activeKeyProfile = await resolveActiveGeminiKeyProfile();

        const formatTier = (tier: SwarmTier): SwarmTierTelemetry => {
            const s = runtimeTelemetry.tiers[tier];
            return {
                model: SWARM_MODELS[tier],
                calls: s.calls,
                errors: s.errors,
                avgLatencyMs: s.calls > 0 ? Math.round(s.totalLatencyMs / s.calls) : null,
                lastLatencyMs: s.lastLatencyMs,
                lastUsedAt: s.lastUsedAt,
            };
        };

        return {
            totalCalls: Math.max(runtimeTelemetry.totalCalls, persistedTotalCalls),
            cacheHits: Math.max(runtimeTelemetry.cacheHits, persistedCacheHits),
            l1MemoryCacheHits: runtimeTelemetry.l1MemoryCacheHits,
            totalErrors: Math.max(runtimeTelemetry.totalErrors, persistedErrors),
            gatewayConfigured: Boolean(process.env.AI_GATEWAY_BASE_URL),
            activeKeyProfile,
            region: process.env.VERTEX_AI_LOCATION || process.env.GCP_LOCATION || 'southamerica-west1',
            updatedAt: new Date().toISOString(),
            tiers: {
                PRIMARY: formatTier('PRIMARY'),
                SECONDARY: formatTier('SECONDARY'),
                ANCHOR_HA: formatTier('ANCHOR_HA'),
            },
        };
    }

    private static flushTelemetryToFirestore(): void {
        if (pendingTelemetryOps === 0) return;
        pendingTelemetryOps = 0;
        lastTelemetryFlushAt = Date.now();
        if (telemetryFlushTimer) {
            clearTimeout(telemetryFlushTimer);
            telemetryFlushTimer = null;
        }

        db.collection(this.TELEMETRY_COLLECTION)
            .doc('swarm_aggregate')
            .set(
                {
                    totalCalls: runtimeTelemetry.totalCalls,
                    cacheHits: runtimeTelemetry.cacheHits,
                    l1MemoryCacheHits: runtimeTelemetry.l1MemoryCacheHits,
                    totalErrors: runtimeTelemetry.totalErrors,
                    region: process.env.VERTEX_AI_LOCATION || process.env.GCP_LOCATION || 'southamerica-west1',
                    updatedAt: new Date().toISOString(),
                },
                { merge: true }
            )
            .catch(() => { });
    }

    private static recordTelemetryEvent(params: {
        tier: SwarmTier;
        model: string;
        module: AIModuleScope;
        latencyMs: number;
        cached: boolean;
        l1MemoryHit?: boolean;
        success: boolean;
        errorMsg?: string;
    }): void {
        const nowIso = new Date().toISOString();
        if (params.cached) {
            runtimeTelemetry.cacheHits += 1;
            if (params.l1MemoryHit) {
                runtimeTelemetry.l1MemoryCacheHits += 1;
            }
            runtimeTelemetry.totalCalls += 1;
        } else if (params.success) {
            runtimeTelemetry.totalCalls += 1;
            const t = runtimeTelemetry.tiers[params.tier];
            t.calls += 1;
            t.totalLatencyMs += params.latencyMs;
            t.lastLatencyMs = params.latencyMs;
            t.lastUsedAt = nowIso;
        } else {
            runtimeTelemetry.totalErrors += 1;
            runtimeTelemetry.tiers[params.tier].errors += 1;
        }

        // Batching de escrituras en Firestore (-95% escrituras en ai_telemetry/swarm_aggregate):
        // solo persiste cada 20 operaciones o tras 60 segundos desde el último flush.
        pendingTelemetryOps += 1;
        const elapsedSinceLastFlush = Date.now() - lastTelemetryFlushAt;
        if (pendingTelemetryOps >= TELEMETRY_FLUSH_BATCH_SIZE || elapsedSinceLastFlush >= TELEMETRY_FLUSH_INTERVAL_MS) {
            this.flushTelemetryToFirestore();
        } else if (!telemetryFlushTimer) {
            telemetryFlushTimer = setTimeout(() => {
                telemetryFlushTimer = null;
                this.flushTelemetryToFirestore();
            }, 15_000);
            if (typeof telemetryFlushTimer.unref === 'function') {
                telemetryFlushTimer.unref();
            }
        }
    }

    /**
     * Algoritmo Invariante de Retroceso con Jitter:
     * D(n) = min(32s, 2.0s * 2^n) + jitter(0, 1s)
     */
    public static computeBackoffMs(attempt: number): number {
        const baseDelayMs = Math.min(32000, 2000 * Math.pow(2, attempt));
        const jitterMs = Math.random() * 1000;
        return Math.round(baseDelayMs + jitterMs);
    }

    private static sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private static async getSDKClient(): Promise<GoogleGenAI> {
        const apiKey = await resolveGeminiApiKey();
        if (apiKey) {
            if (!cachedGenAIClient || cachedGenAIClient.key !== apiKey) {
                cachedGenAIClient = {
                    key: apiKey,
                    client: new GoogleGenAI({ apiKey }),
                };
            }
            return cachedGenAIClient.client;
        }

        if (process.env.USE_VERTEX_AI === 'true') {
            const project = process.env.GCP_PROJECT_ID || 'minreport-8f2a8';
            const location = process.env.VERTEX_AI_LOCATION || process.env.GCP_LOCATION || 'southamerica-west1';
            const vertexKey = `vertex:${project}:${location}`;
            if (!cachedGenAIClient || cachedGenAIClient.key !== vertexKey) {
                cachedGenAIClient = {
                    key: vertexKey,
                    client: new GoogleGenAI({ vertexai: true, project, location }),
                };
            }
            return cachedGenAIClient.client;
        }

        throw new AISwarmUnavailableError(
            'Credencial GEMINI_API_KEY no configurada en Cloud Secret Manager ni en variables de entorno locales.',
            'GEMINI_API_KEY_MISSING'
        );
    }

    /**
     * Inyecta directivas de entrenamiento curadas por TEST-PILOTS (`status == 'APPLIED_TO_AI'`)
     */
    private static async enrichSystemInstructionWithPilotFeedback(
        module: AIModuleScope,
        baseInstruction?: string
    ): Promise<string | undefined> {
        const now = Date.now();
        const cached = pilotRulesCache.get(module);
        let rulesBlock = '';

        if (cached && cached.expiresAt > now) {
            rulesBlock = cached.rulesBlock;
        } else {
            try {
                const snap = await db
                    .collection('pilot_feedback')
                    .where('module', '==', module)
                    .where('status', '==', 'APPLIED_TO_AI')
                    .limit(15)
                    .get();

                if (!snap.empty) {
                    const rules = snap.docs
                        .map((d) => {
                            const data = d.data();
                            return data.expectedAiBehavior || data.observation || '';
                        })
                        .filter((txt: string) => txt.trim().length > 0);

                    if (rules.length > 0) {
                        rulesBlock = `\n\n[DIRECTIVAS CURADAS POR EXPERTOS TEST-PILOT MINREPORT]:\n${rules
                            .map((r, i) => `${i + 1}. ${r}`)
                            .join('\n')}`;
                    }
                }
            } catch {
                // No bloquear inferencia si el emulador aún no tiene índice compuesto
            }
            pilotRulesCache.set(module, { expiresAt: now + PILOT_RULES_TTL_MS, rulesBlock });
        }

        if (!baseInstruction && !rulesBlock) return undefined;
        return `${baseInstruction || ''}${rulesBlock}`.trim();
    }

    private static resolveEffectiveTier(req: AIInferenceRequest): SwarmTier {
        if (req.preferredTier) return req.preferredTier;
        // Optimización de costos: extracciones estructuradas deterministas (Temp <= 0.1) sin búsqueda web
        // ni mutación HITL crítica se enrutan por defecto a SECONDARY (Flash) ahorrando ~80% de tokens frente a Pro.
        const isDeterministicSchemaExtraction =
            Boolean(req.responseSchema) &&
            !req.useGoogleSearch &&
            !req.useUrlContext &&
            !req.useCodeExecution &&
            (!req.media || req.media.length === 0) &&
            (!req.fileParts || req.fileParts.length === 0) &&
            (req.temperature ?? 0.2) <= 0.1 &&
            !req.requireHITL;
        return isDeterministicSchemaExtraction ? 'SECONDARY' : 'PRIMARY';
    }

    private static computeCacheKey(req: AIInferenceRequest, effectiveSys?: string): string {
        const schemaSig = req.responseSchema ? JSON.stringify(req.responseSchema) : '';
        const targetTier = this.resolveEffectiveTier(req);
        const normalizedPrompt = req.prompt.replace(/\s+/g, ' ').trim();
        // Consultas Grounded de catálogo maestro en OPERMAQ comparten caché global cross-tenant
        const effectiveScope =
            req.module === 'opermaq' && (req.useGoogleSearch || req.requireGroundedEvidence) && !req.tenantId
                ? 'GLOBAL'
                : req.tenantId || 'GLOBAL';
        const normalized = JSON.stringify({
            v: '4.0-fail-closed-grounded',
            tenantId: effectiveScope,
            module: req.module,
            tier: targetTier,
            model: SWARM_MODELS[targetTier],
            prompt: normalizedPrompt,
            sys: (effectiveSys || '').replace(/\s+/g, ' ').trim(),
            temp: req.temperature ?? 0.2,
            search: Boolean(req.useGoogleSearch),
            reqGrounded: Boolean(req.requireGroundedEvidence),
            urlCtx: Boolean(req.useUrlContext),
            codeExec: Boolean(req.useCodeExecution),
            mime: req.responseMimeType || 'text/plain',
            schema: schemaSig,
        });
        return createHash('sha256').update(normalized).digest('hex');
    }

    private static buildTierOrder(preferred?: SwarmTier): SwarmTier[] {
        if (preferred === 'ANCHOR_HA') return ['ANCHOR_HA', 'SECONDARY'];
        if (preferred === 'SECONDARY') return ['SECONDARY', 'ANCHOR_HA', 'PRIMARY'];
        return ['PRIMARY', 'SECONDARY', 'ANCHOR_HA'];
    }

    private static setMemoryInferenceCache(cacheKey: string, entry: CachedInferenceL1Entry): void {
        if (memoryInferenceCache.size >= MAX_MEMORY_INFERENCE_ENTRIES) {
            const oldestKey = memoryInferenceCache.keys().next().value;
            if (oldestKey) memoryInferenceCache.delete(oldestKey);
        }
        memoryInferenceCache.set(cacheKey, entry);
    }

    private static buildThinkingConfig(
        model: string,
        level?: ThinkingLevel,
        explicitBudget?: number
    ): Record<string, any> | undefined {
        const isPro = model.includes('pro') || model.includes('argon');
        const isGemini3Plus = model.includes('gemini-3') || model.includes('gemini-4');

        if (isGemini3Plus) {
            if (!level && typeof explicitBudget !== 'number') return undefined;
            const resolvedLevel =
                level ||
                (explicitBudget === 0
                    ? 'none'
                    : (explicitBudget || 0) <= 512
                        ? 'low'
                        : (explicitBudget || 0) <= 2048
                            ? 'medium'
                            : 'high');

            const levelMap: Record<ThinkingLevel, string> = {
                none: 'LOW',
                low: 'LOW',
                medium: 'MEDIUM',
                high: 'HIGH',
            };
            return { thinkingLevel: levelMap[resolvedLevel] };
        }

        if (typeof explicitBudget === 'number') {
            if (isPro && explicitBudget < 128) return { thinkingBudget: 128 };
            return { thinkingBudget: explicitBudget };
        }
        if (!level) return undefined;

        const budgetMap: Record<ThinkingLevel, number> = {
            none: isPro ? 128 : 0,
            low: 512,
            medium: 2048,
            high: 8192,
        };
        return { thinkingBudget: budgetMap[level] };
    }

    private static extractGroundingData(candidate: any): {
        sources: GroundingSource[];
        queries: string[];
    } {
        const seen = new Set<string>();
        const sources: GroundingSource[] = [];

        const chunks = candidate?.groundingMetadata?.groundingChunks;
        if (Array.isArray(chunks)) {
            for (const chunk of chunks) {
                const uri =
                    chunk?.web?.uri ||
                    chunk?.retrievedContext?.uri ||
                    chunk?.image?.sourceUri ||
                    chunk?.maps?.uri;
                const title =
                    chunk?.web?.title ||
                    chunk?.retrievedContext?.title ||
                    chunk?.image?.title ||
                    chunk?.maps?.title;
                if (typeof uri === 'string' && uri.startsWith('http') && !seen.has(uri)) {
                    seen.add(uri);
                    sources.push({
                        uri,
                        title: typeof title === 'string' && title.trim() ? title.trim() : uri,
                    });
                }
            }
        }

        const urlMeta = candidate?.urlContextMetadata?.urlMetadata;
        if (Array.isArray(urlMeta)) {
            for (const meta of urlMeta) {
                const uri = meta?.retrievedUrl;
                if (typeof uri === 'string' && uri.startsWith('http') && !seen.has(uri)) {
                    seen.add(uri);
                    sources.push({ uri, title: uri });
                }
            }
        }

        const queries: string[] = Array.isArray(candidate?.groundingMetadata?.webSearchQueries)
            ? candidate.groundingMetadata.webSearchQueries.filter((q: unknown) => typeof q === 'string')
            : [];

        return { sources, queries };
    }

    /**
     * Extrae JSON limpio desde salidas Markdown o texto mixto (especialmente cuando googleSearch está activo)
     */
    public static extractJsonString(rawText: string): string {
        let cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

        const firstObj = cleaned.indexOf('{');
        const firstArr = cleaned.indexOf('[');
        let start = -1;
        let isArray = false;

        if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
            start = firstObj;
            isArray = false;
        } else if (firstArr !== -1) {
            start = firstArr;
            isArray = true;
        }

        if (start !== -1) {
            const end = cleaned.lastIndexOf(isArray ? ']' : '}');
            if (end > start) {
                cleaned = cleaned.substring(start, end + 1);
            } else {
                cleaned = cleaned.substring(start);
            }
        }

        return this.repairTruncatedJson(cleaned);
    }

    /**
     * Repara estructuras JSON truncadas por límite de tokens cerrando llaves/corchetes abiertos
     */
    public static repairTruncatedJson(raw: string): string {
        const trimmed = raw.trim();
        try {
            JSON.parse(trimmed);
            return trimmed;
        } catch {
            // Intentar cierre balanceado conservador
            let candidate = trimmed.replace(/,\s*$/, '');
            const stack: string[] = [];
            let inString = false;
            let escaped = false;

            for (let i = 0; i < candidate.length; i++) {
                const ch = candidate[i];
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (ch === '\\') {
                    escaped = true;
                    continue;
                }
                if (ch === '"') {
                    inString = !inString;
                    continue;
                }
                if (inString) continue;
                if (ch === '{') stack.push('}');
                else if (ch === '[') stack.push(']');
                else if (ch === '}' || ch === ']') stack.pop();
            }

            if (inString) candidate += '"';
            while (stack.length > 0) {
                candidate += stack.pop();
            }
            return candidate;
        }
    }

    /**
     * Esclusa Determinista Pre-Vuelo (Ley N° 19.628 y Nueva Ley N° 21.719 de Protección de Datos Personales de Chile):
     * Purga identificadores sensibles chilenos (RUT, patentes PPU, teléfonos +56, correos, coordenadas GPS de faena
     * y referencias contractuales OC/PO) antes de transmitir prompts de clientes o consultas de búsqueda externa.
     */
    public static sanitizePromptForLey21719(rawText: string): string {
        let s = rawText || '';
        s = s.replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, '[RUT_RESERVADO]');
        s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_RESERVADO]');
        s = s.replace(/(?:\+?56\s*)?(?:9\s*\d{4}\s*\d{4}|2\s*\d{4}\s*\d{4})\b/g, '[TEL_RESERVADO]');
        s = s.replace(/[-+]?\d{1,2}\.\d{4,}\s*,\s*[-+]?\d{1,3}\.\d{4,}/g, '[COORD_FAENA_RESERVADA]');
        s = s.replace(/\b(?:OC|PO|CONTRATO|LICITACI[OÓ]N)\s*[-#:]?\s*[A-Z0-9-]{3,20}\b/gi, '[REF_CONTRACTUAL_RESERVADA]');
        s = s.replace(/\b(?:patente|ppu)\s*[:#-]?\s*[A-Z]{2,4}[-\s]?\d{2,4}\b/gi, '[PATENTE_RESERVADA]');
        return s;
    }

    /**
     * Ejecución central resiliente con fallback Pro -> Flash -> Flash-Lite
     */
    public static async generate(rawReq: AIInferenceRequest): Promise<AIInferenceResponse> {
        const startTime = Date.now();
        const shouldScrubLey21719 =
            Boolean(rawReq.tenantId && rawReq.tenantId !== 'GLOBAL') || Boolean(rawReq.useGoogleSearch);
        const req: AIInferenceRequest = shouldScrubLey21719
            ? {
                  ...rawReq,
                  prompt: this.sanitizePromptForLey21719(rawReq.prompt),
              }
            : rawReq;

        const ai = await this.getSDKClient();
        const effectiveSystemInstruction = await this.enrichSystemInstructionWithPilotFeedback(
            req.module,
            req.systemInstruction
        );

        const isCacheable =
            !req.bypassCache &&
            (req.temperature ?? 0.2) <= 0.3 &&
            (!req.media || req.media.length === 0) &&
            (!req.fileParts || req.fileParts.length === 0);

        const cacheKey = isCacheable ? this.computeCacheKey(req, effectiveSystemInstruction) : '';

        if (isCacheable && cacheKey) {
            // 1. Nivel L1 RAM (< 1 ms, 0 lecturas Firestore, $0 tokens)
            const l1Hit = memoryInferenceCache.get(cacheKey);
            if (l1Hit && l1Hit.expiresAt > Date.now()) {
                const violatesGroundingGate =
                    (req.useGoogleSearch || req.requireGroundedEvidence) && l1Hit.groundingSources.length === 0;
                if (!violatesGroundingGate && l1Hit.text.trim().length > 0) {
                    const hitLatency = Date.now() - startTime;
                    this.recordTelemetryEvent({
                        tier: l1Hit.tierUsed,
                        model: l1Hit.model,
                        module: req.module,
                        latencyMs: hitLatency,
                        cached: true,
                        l1MemoryHit: true,
                        success: true,
                    });
                    return {
                        text: l1Hit.text,
                        model: l1Hit.model,
                        tierUsed: l1Hit.tierUsed,
                        latencyMs: hitLatency,
                        requiresHumanApproval: Boolean(req.requireHITL),
                        cached: true,
                        groundingSources: l1Hit.groundingSources,
                        webSearchQueries: l1Hit.webSearchQueries,
                    };
                }
            }

            // 2. Nivel L2 Firestore (ai_inference_cache)
            try {
                const cachedSnap = await db.collection(this.CACHE_COLLECTION).doc(cacheKey).get();
                if (cachedSnap.exists) {
                    const cachedData = cachedSnap.data()!;
                    const cachedSources = Array.isArray(cachedData.groundingSources)
                        ? cachedData.groundingSources
                        : [];
                    const violatesGroundingGate =
                        (req.useGoogleSearch || req.requireGroundedEvidence) && cachedSources.length === 0;
                    if (
                        !violatesGroundingGate &&
                        typeof cachedData.text === 'string' &&
                        cachedData.text.trim().length > 0
                    ) {
                        const hitTier = (cachedData.tierUsed as SwarmTier) || 'PRIMARY';
                        const hitModel = cachedData.model || SWARM_MODELS[hitTier];
                        const hitQueries = Array.isArray(cachedData.webSearchQueries) ? cachedData.webSearchQueries : [];
                        this.setMemoryInferenceCache(cacheKey, {
                            text: cachedData.text,
                            model: hitModel,
                            tierUsed: hitTier,
                            groundingSources: cachedSources,
                            webSearchQueries: hitQueries,
                            expiresAt: Date.now() + MEMORY_INFERENCE_TTL_MS,
                        });
                        const hitLatency = Date.now() - startTime;
                        this.recordTelemetryEvent({
                            tier: hitTier,
                            model: hitModel,
                            module: req.module,
                            latencyMs: hitLatency,
                            cached: true,
                            success: true,
                        });
                        return {
                            text: cachedData.text,
                            model: hitModel,
                            tierUsed: hitTier,
                            latencyMs: hitLatency,
                            requiresHumanApproval: Boolean(req.requireHITL),
                            cached: true,
                            groundingSources: cachedSources,
                            webSearchQueries: hitQueries,
                        };
                    }
                }
            } catch {
                // Continuar en vivo si falla lectura de caché
            }
        }

        const tiers = this.buildTierOrder(this.resolveEffectiveTier(req));
        let lastError: Error | null = null;
        let hadUngroundedAttempt = false;

        for (const tier of tiers) {
            let modelName = SWARM_MODELS[tier];
            const triedModelsInTier = new Set<string>([modelName]);

            for (let attempt = 0; attempt <= this.MAX_RETRIES_PER_TIER; attempt++) {
                try {
                    const parts: any[] = [];

                    if (req.fileParts && req.fileParts.length > 0) {
                        for (const fp of req.fileParts) {
                            parts.push({
                                fileData: {
                                    fileUri: fp.fileUri,
                                    mimeType: fp.mimeType,
                                },
                            });
                        }
                    }

                    if (req.media && req.media.length > 0) {
                        for (const m of req.media) {
                            parts.push({
                                inlineData: {
                                    mimeType: m.mimeType,
                                    data: m.dataBase64,
                                },
                            });
                        }
                    }

                    const effectivePromptText =
                        hadUngroundedAttempt && (req.useGoogleSearch || req.requireGroundedEvidence)
                            ? `DIRECTIVA OBLIGATORIA DE HERRAMIENTA: Ejecuta inmediatamente consultas en googleSearch sobre el activo/tema solicitado, verifica fuentes web reales y respalda cada dato técnico en los resultados recuperados antes de emitir la respuesta solicitada. Está prohibido responder sin invocar googleSearch.\n\n${req.prompt}`
                            : req.prompt;

                    parts.push({ text: effectivePromptText });

                    const tools: any[] = [];
                    if (req.useGoogleSearch) tools.push({ googleSearch: {} });
                    if (req.useUrlContext) tools.push({ urlContext: {} });
                    if (req.useCodeExecution) tools.push({ codeExecution: {} });

                    const hasGroundingTools = tools.length > 0;

                    const effectiveTemperature =
                        hadUngroundedAttempt && req.requireGroundedEvidence
                            ? Math.max(req.temperature ?? 0.2, 0.2)
                            : (req.temperature ?? 0.2);

                    const config: Record<string, any> = {
                        temperature: effectiveTemperature,
                    };

                    if (typeof req.topP === 'number') config.topP = req.topP;
                    if (typeof req.topK === 'number') config.topK = req.topK;
                    if (typeof req.maxOutputTokens === 'number') config.maxOutputTokens = req.maxOutputTokens;
                    if (req.cachedContent) {
                        config.cachedContent = req.cachedContent;
                    } else if (effectiveSystemInstruction) {
                        config.systemInstruction = effectiveSystemInstruction;
                    }

                    // La API Gemini no permite combinar tools de búsqueda con responseMimeType JSON
                    if (hasGroundingTools) {
                        config.tools = tools;
                    } else {
                        if (req.responseMimeType) config.responseMimeType = req.responseMimeType;
                        if (req.responseSchema) config.responseSchema = req.responseSchema;
                    }

                    // En llamadas con googleSearch usar 'low' por defecto para evitar la latencia de 'HIGH' en Gemini 3.x;
                    // en extracciones deterministas sin herramientas (temp <= 0.1) usar 'none' (MINIMAL) por defecto.
                    const effectiveThinkingLevel: ThinkingLevel | undefined = hasGroundingTools
                        ? hadUngroundedAttempt
                            ? 'medium'
                            : req.thinkingLevel === 'none'
                            ? 'low'
                            : req.thinkingLevel || 'low'
                        : req.thinkingLevel || ((req.temperature ?? 0.2) <= 0.1 ? 'none' : undefined);

                    const thinkingCfg = this.buildThinkingConfig(modelName, effectiveThinkingLevel, req.thinkingBudget);
                    if (thinkingCfg) {
                        config.thinkingConfig = thinkingCfg;
                    }

                    const response = await ai.models.generateContent({
                        model: modelName,
                        contents: [{ role: 'user', parts }],
                        config,
                    });

                    const text = (response.text || '').trim();
                    if (!text) {
                        throw new Error(`Respuesta vacía desde ${modelName}`);
                    }

                    const candidate = response.candidates?.[0];
                    const { sources, queries } = this.extractGroundingData(candidate);

                    // Compuerta Fail-Closed: prohibido aceptar respuestas de memoria cuando se exige evidencia verificada
                    if (req.requireGroundedEvidence && sources.length === 0) {
                        throw new UngroundedEvidenceError(
                            `[FAIL-CLOSED GROUNDING] ${modelName} respondió sin consultar fuentes web verificables (groundingSources = 0).`
                        );
                    }

                    const latencyMs = Date.now() - startTime;

                    this.recordTelemetryEvent({
                        tier,
                        model: modelName,
                        module: req.module,
                        latencyMs,
                        cached: false,
                        success: true,
                    });

                    // Prohibido contaminar `ai_inference_cache` con respuestas sin fuentes cuando `useGoogleSearch` estaba activo
                    const canPersistCache =
                        isCacheable && cacheKey && !(req.useGoogleSearch && sources.length === 0);

                    if (canPersistCache) {
                        this.setMemoryInferenceCache(cacheKey, {
                            text,
                            model: modelName,
                            tierUsed: tier,
                            groundingSources: sources,
                            webSearchQueries: queries,
                            expiresAt: Date.now() + MEMORY_INFERENCE_TTL_MS,
                        });
                        db.collection(this.CACHE_COLLECTION)
                            .doc(cacheKey)
                            .set({
                                cacheKey,
                                module: req.module,
                                model: modelName,
                                tierUsed: tier,
                                text,
                                groundingSources: sources,
                                webSearchQueries: queries,
                                createdAt: new Date().toISOString(),
                            })
                            .catch(() => { });
                    }

                    return {
                        text,
                        model: modelName,
                        tierUsed: tier,
                        latencyMs,
                        requiresHumanApproval: Boolean(req.requireHITL),
                        cached: false,
                        groundingSources: sources,
                        webSearchQueries: queries,
                        rawCandidate: candidate,
                    };
                } catch (err: any) {
                    lastError = err instanceof Error ? err : new Error(String(err));
                    const msg = lastError.message || '';
                    this.recordTelemetryEvent({
                        tier,
                        model: modelName,
                        module: req.module,
                        latencyMs: Date.now() - startTime,
                        cached: false,
                        success: false,
                        errorMsg: msg,
                    });
                    console.warn(
                        `[SWARM-IA] Fallo en ${tier} (${modelName}) [Intento ${attempt + 1}/${this.MAX_RETRIES_PER_TIER + 1}]: ${msg}`
                    );

                    // Si la API key en sí es inválida, no reintentar inútilmente
                    if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
                        throw new AISwarmUnavailableError(
                            `Credencial GEMINI_API_KEY rechazada por Google AI: ${msg}`,
                            'GEMINI_API_KEY_INVALID'
                        );
                    }

                    // Si la cuenta de Google AI Studio tiene los créditos de prepago agotados (HTTP 402), abortar de inmediato
                    if (msg.includes('prepayment credits are depleted') || msg.includes('"code":402')) {
                        throw new AISwarmUnavailableError(
                            'Créditos de prepago agotados en Google AI Studio para la GEMINI_API_KEY configurada (HTTP 402). Recargue saldo o vincule facturación activa (Pay-As-You-Go) en https://ai.studio/projects sobre minreport-8f2a8.',
                            'GEMINI_BILLING_DEPLETED'
                        );
                    }

                    // Autocuración Evergreen: si la API de Google indica un slug de reemplazo directo ("use models/<nuevo>"), adoptarlo en caliente
                    const suggestedModelMatch = msg.match(/use models\/([a-zA-Z0-9._-]+)/i);
                    if (
                        (msg.includes('NOT_FOUND') || msg.includes('no longer available')) &&
                        suggestedModelMatch &&
                        suggestedModelMatch[1] &&
                        suggestedModelMatch[1] !== modelName
                    ) {
                        const replacementModel = suggestedModelMatch[1].trim();
                        console.info(
                            `[SWARM-IA] Autocuración Evergreen en ${tier}: actualizando ${modelName} -> ${replacementModel}`
                        );
                        SWARM_MODELS[tier] = replacementModel;
                        modelName = replacementModel;
                        continue;
                    }

                    // Si el modelo puntual no está habilitado, no existe o agotó cuota puntual (429), probar candidato hermano del mismo tier o saltar al siguiente nivel
                    if (
                        msg.includes('PERMISSION_DENIED') ||
                        msg.includes('NOT_FOUND') ||
                        msg.includes('is not found') ||
                        msg.includes('RESOURCE_EXHAUSTED') ||
                        msg.includes('"code":429')
                    ) {
                        const fallbacks = SWARM_TIER_FALLBACK_CANDIDATES[tier] || [];
                        const nextCandidate = fallbacks.find((cand) => !triedModelsInTier.has(cand));
                        if (nextCandidate && attempt < this.MAX_RETRIES_PER_TIER) {
                            console.info(
                                `[SWARM-IA] Conmutando dentro de ${tier}: ${modelName} -> ${nextCandidate}`
                            );
                            if (msg.includes('NOT_FOUND') || msg.includes('is not found')) {
                                SWARM_MODELS[tier] = nextCandidate;
                            }
                            modelName = nextCandidate;
                            triedModelsInTier.add(nextCandidate);
                            continue;
                        }
                        break;
                    }

                    if (err instanceof UngroundedEvidenceError) {
                        hadUngroundedAttempt = true;
                        if (attempt >= 1) {
                            // Tras un reintento con directiva reforzada en este tier, saltar sin demora al siguiente modelo del enjambre
                            break;
                        }
                        await this.sleep(250 + Math.round(Math.random() * 250));
                        continue;
                    }

                    if (attempt < this.MAX_RETRIES_PER_TIER) {
                        const waitMs = this.computeBackoffMs(attempt);
                        await this.sleep(waitMs);
                    }
                }
            }
        }

        if (lastError instanceof UngroundedEvidenceError) {
            throw lastError;
        }

        throw new AISwarmUnavailableError(
            `Enjambre Gemini agotó todos los niveles sin éxito. Último error: ${lastError?.message || 'Desconocido'}`,
            'AI_SWARM_EXHAUSTED'
        );
    }

    /**
     * Ejecución estructurada con validación tipada Zod
     */
    public static async generateStructured<T>(
        req: AIInferenceRequest,
        zodSchema?: z.ZodType<T>
    ): Promise<{ data: T; meta: AIInferenceResponse }> {
        const effectiveReq: AIInferenceRequest = {
            ...req,
            responseMimeType: req.useGoogleSearch || req.useUrlContext ? undefined : req.responseMimeType || 'application/json',
        };

        const response = await this.generate(effectiveReq);
        const jsonStr = this.extractJsonString(response.text);
        const parsed = JSON.parse(jsonStr);
        const validated = zodSchema ? zodSchema.parse(parsed) : (parsed as T);

        return {
            data: validated,
            meta: response,
        };
    }

    /**
     * Generación de iconografía ISO 7000 y diagramas técnicos limpios (Nano Banana Pro gemini-3-pro-image -> Imagen 4.0 -> 3.0)
     * Incluye caché determinista SHA-256 en memoria L1 y Firestore L2 (`ai_inference_cache`) para evitar facturación duplicada.
     */
    public static async generateTechnicalImage(req: TechnicalImageRequest): Promise<TechnicalImageResponse> {
        const startTime = Date.now();
        const sanitizedPrompt = this.sanitizePromptForLey21719(req.prompt || '').trim();
        const outputMimeType = req.outputMimeType || 'image/png';
        const aspectRatio = req.aspectRatio || '1:1';
        const cacheKey = `img_${createHash('sha256')
            .update(`${aspectRatio}|${outputMimeType}|${sanitizedPrompt}`)
            .digest('hex')}`;

        const memHit = memoryTechnicalImageCache.get(cacheKey);
        if (memHit && memHit.base64Data) {
            return {
                ...memHit,
                latencyMs: Date.now() - startTime,
            };
        }

        try {
            const snap = await db.collection(this.CACHE_COLLECTION).doc(cacheKey).get();
            if (snap.exists) {
                const d = snap.data() || {};
                if (typeof d.base64Data === 'string' && d.base64Data.length > 0) {
                    const hit: TechnicalImageResponse = {
                        base64Data: d.base64Data,
                        mimeType: d.mimeType || outputMimeType,
                        modelUsed: d.modelUsed || IMAGE_GEN_MODELS[0],
                        latencyMs: Date.now() - startTime,
                    };
                    if (memoryTechnicalImageCache.size >= MAX_MEMORY_TECHNICAL_IMAGES) {
                        const oldest = memoryTechnicalImageCache.keys().next().value;
                        if (oldest) memoryTechnicalImageCache.delete(oldest);
                    }
                    memoryTechnicalImageCache.set(cacheKey, hit);
                    return hit;
                }
            }
        } catch {
            // Continuar hacia generación en vivo si la caché no responde
        }

        const ai = await this.getSDKClient();
        let lastErr: Error | null = null;

        const persistGeneratedImage = (res: TechnicalImageResponse) => {
            if (memoryTechnicalImageCache.size >= MAX_MEMORY_TECHNICAL_IMAGES) {
                const oldest = memoryTechnicalImageCache.keys().next().value;
                if (oldest) memoryTechnicalImageCache.delete(oldest);
            }
            memoryTechnicalImageCache.set(cacheKey, res);
            db.collection(this.CACHE_COLLECTION)
                .doc(cacheKey)
                .set({
                    cacheKey,
                    module: 'opermaq',
                    modelUsed: res.modelUsed,
                    mimeType: res.mimeType,
                    aspectRatio,
                    base64Data: res.base64Data,
                    createdAt: new Date().toISOString(),
                })
                .catch(() => { });
        };

        for (const modelName of IMAGE_GEN_MODELS) {
            try {
                if (modelName.startsWith('gemini-')) {
                    const response = await ai.models.generateContent({
                        model: modelName,
                        contents: [{ role: 'user', parts: [{ text: sanitizedPrompt }] }],
                        config: {
                            responseModalities: ['IMAGE'],
                            imageConfig: {
                                aspectRatio,
                            },
                        },
                    });
                    const imgPart = response.candidates?.[0]?.content?.parts?.find(
                        (p: any) => p?.inlineData?.data
                    );
                    if (!imgPart?.inlineData?.data) {
                        throw new Error(`Sin bytes de imagen desde ${modelName}`);
                    }
                    const result: TechnicalImageResponse = {
                        base64Data: imgPart.inlineData.data,
                        mimeType: imgPart.inlineData.mimeType || outputMimeType,
                        modelUsed: modelName,
                        latencyMs: Date.now() - startTime,
                    };
                    persistGeneratedImage(result);
                    return result;
                }

                const response = await ai.models.generateImages({
                    model: modelName,
                    prompt: sanitizedPrompt,
                    config: {
                        numberOfImages: 1,
                        outputMimeType,
                        aspectRatio,
                    },
                });

                const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
                if (!imageBytes) {
                    throw new Error(`Sin bytes de imagen desde ${modelName}`);
                }

                const result: TechnicalImageResponse = {
                    base64Data: imageBytes,
                    mimeType: outputMimeType,
                    modelUsed: modelName,
                    latencyMs: Date.now() - startTime,
                };
                persistGeneratedImage(result);
                return result;
            } catch (err: any) {
                lastErr = err instanceof Error ? err : new Error(String(err));
                console.warn(`[SWARM-IMAGEN] Fallo en ${modelName}: ${lastErr.message}`);
            }
        }

        throw new AISwarmUnavailableError(
            `Generación gráfica técnica Gemini Image no disponible: ${lastErr?.message || 'Error desconocido'}`,
            'IMAGEN_UNAVAILABLE'
        );
    }

    /**
     * Normalización L2 obligatoria para embeddings truncados Matryoshka (768d)
     */
    public static normalizeL2(vec: number[]): number[] {
        let normSq = 0;
        for (let i = 0; i < vec.length; i++) {
            normSq += vec[i] * vec[i];
        }
        const norm = Math.sqrt(normSq);
        if (norm <= 1e-12) return vec;
        return vec.map((v) => Number((v / norm).toFixed(7)));
    }

    /**
     * Similitud coseno determinista entre dos vectores de igual dimensión
     */
    public static cosineSimilarity(a: number[], b: number[]): number {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
            return 0;
        }
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom > 1e-12 ? dot / denom : 0;
    }

    /**
     * Generación de Embeddings Matryoshka (`gemini-embedding-001` @ 768 dimensiones por defecto)
     * Incluye caché en memoria LRU + Firestore `ai_inference_cache` para latencia < 2ms en términos repetidos.
     */
    public static async embedText(text: string, options: EmbeddingOptions = {}): Promise<number[]> {
        const clean = text.trim().slice(0, 16000);
        const dim = options.outputDimensionality || 768;
        if (!clean) {
            return new Array(dim).fill(0);
        }

        const taskType = options.taskType || 'SEMANTIC_SIMILARITY';
        const cacheKey = `emb_${dim}_${createHash('sha256')
            .update(`${taskType}|${options.title || ''}|${clean}`)
            .digest('hex')}`;

        if (!options.bypassCache) {
            const inMem = memoryEmbeddingCache.get(cacheKey);
            if (inMem && inMem.length === dim) {
                return inMem;
            }
            try {
                const snap = await db.collection(this.CACHE_COLLECTION).doc(cacheKey).get();
                if (snap.exists) {
                    const values = snap.data()?.embedding;
                    if (Array.isArray(values) && values.length === dim) {
                        if (memoryEmbeddingCache.size >= MAX_MEMORY_EMBEDDINGS) {
                            const oldest = memoryEmbeddingCache.keys().next().value;
                            if (oldest) memoryEmbeddingCache.delete(oldest);
                        }
                        memoryEmbeddingCache.set(cacheKey, values);
                        return values;
                    }
                }
            } catch {
                // Continuar hacia la API en vivo
            }
        }

        const ai = await this.getSDKClient();
        let lastErr: Error | null = null;

        for (const modelName of EMBEDDING_MODELS) {
            try {
                const config: Record<string, any> = {
                    taskType,
                    outputDimensionality: dim,
                };
                if (options.title && taskType === 'RETRIEVAL_DOCUMENT') {
                    config.title = options.title.slice(0, 200);
                }

                const resp = await ai.models.embedContent({
                    model: modelName,
                    contents: clean,
                    config,
                });

                const rawValues = resp.embeddings?.[0]?.values;
                if (!Array.isArray(rawValues) || rawValues.length === 0) {
                    throw new Error(`Vector vacío desde ${modelName}`);
                }

                const sliced = rawValues.length > dim ? rawValues.slice(0, dim) : rawValues;
                const normalized = this.normalizeL2(sliced);

                if (memoryEmbeddingCache.size >= MAX_MEMORY_EMBEDDINGS) {
                    const oldest = memoryEmbeddingCache.keys().next().value;
                    if (oldest) memoryEmbeddingCache.delete(oldest);
                }
                memoryEmbeddingCache.set(cacheKey, normalized);

                db.collection(this.CACHE_COLLECTION)
                    .doc(cacheKey)
                    .set({
                        cacheKey,
                        module: 'core',
                        model: modelName,
                        taskType,
                        dim,
                        embedding: normalized,
                        createdAt: new Date().toISOString(),
                    })
                    .catch(() => { });

                return normalized;
            } catch (err: any) {
                lastErr = err instanceof Error ? err : new Error(String(err));
                console.warn(`[SWARM-EMBED] Fallo en ${modelName}: ${lastErr.message}`);
            }
        }

        throw new AISwarmUnavailableError(
            `Servicio de embeddings Gemini no disponible: ${lastErr?.message || 'Error desconocido'}`,
            'EMBEDDING_UNAVAILABLE'
        );
    }

    /**
     * Embeddings en lote respetando caché individual
     */
    public static async embedBatch(texts: string[], options: EmbeddingOptions = {}): Promise<number[][]> {
        const results: number[][] = [];
        for (const txt of texts) {
            results.push(await this.embedText(txt, options));
        }
        return results;
    }

    /**
     * Creación opcional de Context Cache explícito en Gemini para manuales extensos (>32k tokens)
     * Retorna `name` del recurso cacheado o `null` si el documento es menor al umbral mínimo.
     */
    public static async createContextCache(params: {
        displayName: string;
        systemInstruction?: string;
        contentsText?: string;
        fileParts?: FileUriPart[];
        ttlSeconds?: number;
        tier?: SwarmTier;
    }): Promise<string | null> {
        try {
            const ai = await this.getSDKClient();
            const modelName = SWARM_MODELS[params.tier || 'SECONDARY'];
            const parts: any[] = [];
            if (params.fileParts) {
                for (const fp of params.fileParts) {
                    parts.push({ fileData: { fileUri: fp.fileUri, mimeType: fp.mimeType } });
                }
            }
            if (params.contentsText) {
                parts.push({ text: params.contentsText });
            }
            if (parts.length === 0) return null;

            const cache = await (ai as any).caches?.create?.({
                model: modelName,
                config: {
                    displayName: params.displayName.slice(0, 120),
                    systemInstruction: params.systemInstruction,
                    contents: [{ role: 'user', parts }],
                    ttl: `${Math.max(300, params.ttlSeconds || 1800)}s`,
                },
            });

            return typeof cache?.name === 'string' ? cache.name : null;
        } catch {
            // Context caching es una optimización transparente; nunca bloquea el flujo principal
            return null;
        }
    }
}
