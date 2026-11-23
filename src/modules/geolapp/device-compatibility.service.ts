import { z } from 'zod';
import { db } from '../../config/firebase';
import { AuditLedger } from '../../core/audit-ledger';
import {
    AISwarmUnavailableError,
    ResilientAIClient,
    Type,
} from '../../core/resilient-ai-client';

export const DEVICE_COMPATIBILITY_COLLECTION = 'device_compatibility_registry';

export type SpatialDeviceTier =
    | 'OPTIMAL_SPATIAL'
    | 'COMPATIBLE_VIO'
    | 'INCOMPATIBLE'
    | 'UNVERIFIED';

export const SpatialDeviceTierSchema = z.enum([
    'OPTIMAL_SPATIAL',
    'COMPATIBLE_VIO',
    'INCOMPATIBLE',
    'UNVERIFIED',
]);

export const DeviceGroundingSourceSchema = z.object({
    title: z.string().trim().min(1).max(240),
    uri: z.string().trim().url().max(1024),
});

export type DeviceGroundingSource = z.infer<typeof DeviceGroundingSourceSchema>;

export const DeviceCompatibilityRecordSchema = z.object({
    id: z.string().trim().min(1).max(160),
    canonicalKey: z.string().trim().min(1).max(160),
    manufacturer: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(200),
    deviceCode: z.string().trim().min(1).max(120).optional(),
    aliases: z.array(z.string().trim().min(1).max(160)).min(1).max(32),
    platform: z.enum(['ANDROID', 'IOS']),
    hasGyroscope: z.boolean().nullable(),
    arSupported: z.boolean().nullable(),
    depthSupported: z.boolean().nullable(),
    lidarSupported: z.boolean().nullable(),
    rugged: z.boolean(),
    ruggedRating: z.string().trim().min(1).max(120).optional(),
    tier: SpatialDeviceTierSchema,
    verdictSummary: z.string().trim().min(1).max(400),
    groundingSources: z.array(DeviceGroundingSourceSchema).min(1).max(16),
    source: z.literal('AI_GROUNDED_VERIFIED'),
    queryCount: z.number().int().positive(),
    createdAt: z.number().int().nonnegative(),
    checkedAt: z.number().int().nonnegative(),
    lastQueriedAt: z.number().int().nonnegative(),
    checkedAtIso: z.string().trim().min(1).max(64),
});

export type DeviceCompatibilityRecord = z.infer<typeof DeviceCompatibilityRecordSchema>;

export const DeviceCompatibilityRegistrySnapshotSchema = z.object({
    updatedAt: z.number().int().nonnegative(),
    updatedAtIso: z.string().trim().min(1).max(64),
    totalCount: z.number().int().nonnegative(),
    optimalCount: z.number().int().nonnegative(),
    vioCount: z.number().int().nonnegative(),
    incompatibleCount: z.number().int().nonnegative(),
    unverifiedCount: z.number().int().nonnegative(),
    devices: z.array(DeviceCompatibilityRecordSchema),
});

export type DeviceCompatibilityRegistrySnapshot = z.infer<
    typeof DeviceCompatibilityRegistrySnapshotSchema
>;

export interface SpatialCatalogActor {
    uid: string;
    email?: string;
    tenantId?: string;
    ipAddress?: string;
}

export interface OnDemandCompatibilityCheckResult {
    device: DeviceCompatibilityRecord;
    cached: boolean;
    registry: DeviceCompatibilityRegistrySnapshot;
}

export class DeviceCompatibilityValidationError extends Error {
    public readonly statusCode: number;
    public readonly code: string;

    constructor(
        message: string,
        statusCode: number = 400,
        code: string = 'DEVICE_COMPATIBILITY_VALIDATION_ERROR'
    ) {
        super(message);
        this.name = 'DeviceCompatibilityValidationError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

const AiDeviceEvaluationSchema = z.object({
    manufacturer: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(200),
    deviceCode: z.string().trim().max(120).nullable().optional(),
    platform: z.enum(['ANDROID', 'IOS']),
    hasGyroscope: z.boolean().nullable(),
    arSupported: z.boolean().nullable(),
    depthSupported: z.boolean().nullable(),
    lidarSupported: z.boolean().nullable(),
    rugged: z.boolean().optional().default(false),
    ruggedRating: z.string().trim().max(120).nullable().optional(),
    verdictSummary: z.string().trim().min(1).max(400),
});

type AiDeviceEvaluation = z.infer<typeof AiDeviceEvaluationSchema>;

const AI_DEVICE_EVALUATION_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        manufacturer: { type: Type.STRING },
        model: { type: Type.STRING },
        deviceCode: { type: Type.STRING, nullable: true },
        platform: { type: Type.STRING, enum: ['ANDROID', 'IOS'] },
        hasGyroscope: { type: Type.BOOLEAN, nullable: true },
        arSupported: { type: Type.BOOLEAN, nullable: true },
        depthSupported: { type: Type.BOOLEAN, nullable: true },
        lidarSupported: { type: Type.BOOLEAN, nullable: true },
        rugged: { type: Type.BOOLEAN },
        ruggedRating: { type: Type.STRING, nullable: true },
        verdictSummary: { type: Type.STRING },
    },
    required: [
        'manufacturer',
        'model',
        'deviceCode',
        'platform',
        'hasGyroscope',
        'arSupported',
        'depthSupported',
        'lidarSupported',
        'rugged',
        'ruggedRating',
        'verdictSummary',
    ],
};

const RETAIL_STORAGE_REGEX = /\b\d{1,2}\s*[+/]\s*\d{2,4}\s*(?:gb|tb)\b|\b(?:16|32|64|128|256|512)\s*gb\b|\b[12]\s*tb\b|\b\d{1,2}\s*gb\s*ram\b|\bram\b/gi;
const RETAIL_COLOR_REGEX = /\b(?:negro|black|blanco|white|azul|blue|verde|green|gris|gray|grey|plata|silver|dorado|gold|rojo|red|morado|violeta|purple|rosado|pink|titanio|titanium|grafito|graphite|celeste|crema|naranja|orange|amarillo|yellow|bronce|bronze|cobre|midnight|starlight|awesome)\b/gi;
const RETAIL_TAG_REGEX = /\b(?:dual\s*sim|single\s*sim|esim|liberado|desbloqueado|unlocked|factory\s*unlocked|sellado|nuevo|global\s*version|version\s*global|entel|movistar|wom|claro|chile)\b/gi;

/**
 * Elimina modificadores comerciales de retail (almacenamiento, color, operador/estado)
 * que no alteran la compatibilidad espacial del modelo base ni el caché en Firestore.
 */
export function stripRetailNoiseFromDeviceQuery(rawQuery: string): string {
    const collapsed = String(rawQuery || '').trim().replace(/\s+/g, ' ');
    if (!collapsed) return '';
    const stripped = collapsed
        .replace(RETAIL_STORAGE_REGEX, ' ')
        .replace(RETAIL_COLOR_REGEX, ' ')
        .replace(RETAIL_TAG_REGEX, ' ')
        .replace(/[()[\]|/+,-]+\s*$/g, ' ')
        .replace(/^\s*[()[\]|/+,-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return stripped.length >= 2 ? stripped : collapsed;
}

function tryParseAiEvaluation(rawText: string): AiDeviceEvaluation | null {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) return null;
    try {
        const extracted = ResilientAIClient.extractJsonString(trimmed);
        if (!extracted.startsWith('{')) return null;
        const parsedJson = JSON.parse(extracted);
        const parsed = AiDeviceEvaluationSchema.safeParse(parsedJson);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

const inFlightChecks = new Map<string, Promise<OnDemandCompatibilityCheckResult>>();

export function normalizeDeviceQueryKey(rawQuery: string): string {
    return rawQuery
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
}

function compactAlnumKey(raw: string): string {
    return normalizeDeviceQueryKey(raw).replace(/-/g, '');
}

export function computeDeterministicDeviceTier(caps: {
    hasGyroscope: boolean | null;
    arSupported: boolean | null;
    depthSupported: boolean | null;
    lidarSupported: boolean | null;
}): SpatialDeviceTier {
    if (caps.arSupported === false || caps.hasGyroscope === false) {
        return 'INCOMPATIBLE';
    }
    if (caps.arSupported === true && (caps.depthSupported === true || caps.lidarSupported === true)) {
        return 'OPTIMAL_SPATIAL';
    }
    if (caps.arSupported === true) {
        return 'COMPATIBLE_VIO';
    }
    return 'UNVERIFIED';
}

function sanitizeOptionalText(value: string | null | undefined, maxLen: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed || /^(null|undefined|n\/a|none|unknown|--)$/i.test(trimmed)) {
        return undefined;
    }
    return trimmed.slice(0, maxLen);
}

function buildRegistrySnapshot(devices: DeviceCompatibilityRecord[]): DeviceCompatibilityRegistrySnapshot {
    const sorted = [...devices].sort((a, b) => b.lastQueriedAt - a.lastQueriedAt);
    const now = sorted[0]?.lastQueriedAt || 0;
    return DeviceCompatibilityRegistrySnapshotSchema.parse({
        updatedAt: now,
        updatedAtIso: new Date(now).toISOString(),
        totalCount: sorted.length,
        optimalCount: sorted.filter((d) => d.tier === 'OPTIMAL_SPATIAL').length,
        vioCount: sorted.filter((d) => d.tier === 'COMPATIBLE_VIO').length,
        incompatibleCount: sorted.filter((d) => d.tier === 'INCOMPATIBLE').length,
        unverifiedCount: sorted.filter((d) => d.tier === 'UNVERIFIED').length,
        devices: sorted,
    });
}

async function readAllRegisteredRecords(): Promise<DeviceCompatibilityRecord[]> {
    try {
        const snap = await db.collection(DEVICE_COMPATIBILITY_COLLECTION).get();
        if (!snap || snap.empty || !Array.isArray(snap.docs)) {
            return [];
        }
        const records: DeviceCompatibilityRecord[] = [];
        for (const docSnap of snap.docs) {
            const raw = typeof docSnap.data === 'function' ? docSnap.data() : undefined;
            if (!raw) continue;
            const parsed = DeviceCompatibilityRecordSchema.safeParse(raw);
            if (parsed.success) {
                records.push(parsed.data);
            }
        }
        return records;
    } catch {
        return [];
    }
}

function findMatchingRegisteredRecord(
    records: DeviceCompatibilityRecord[],
    queryKey: string,
    compactQuery: string
): DeviceCompatibilityRecord | null {
    for (const rec of records) {
        if (rec.canonicalKey === queryKey || rec.id === queryKey) {
            return rec;
        }
        if (rec.aliases.some((alias) => alias === queryKey || compactAlnumKey(alias) === compactQuery)) {
            return rec;
        }
        const fullLabelCompact = compactAlnumKey(`${rec.manufacturer} ${rec.model}`);
        const modelOnlyCompact = compactAlnumKey(rec.model);
        const codeCompact = rec.deviceCode ? compactAlnumKey(rec.deviceCode) : '';
        if (
            compactQuery &&
            (fullLabelCompact === compactQuery ||
                modelOnlyCompact === compactQuery ||
                (codeCompact && codeCompact === compactQuery))
        ) {
            return rec;
        }
    }
    return null;
}

/**
 * Lista únicamente los dispositivos móviles evaluados on-demand y registrados en Firestore
 * (`device_compatibility_registry` en `southamerica-west1`). Cero listados predefinidos.
 */
export async function listRegisteredDeviceCompatibility(): Promise<DeviceCompatibilityRegistrySnapshot> {
    const records = await readAllRegisteredRecords();
    return buildRegistrySnapshot(records);
}

/**
 * Motor On-Demand de Compatibilidad Espacial (Cache-First -> Gemini Grounded -> Registro Persistente):
 * 1. Busca coincidencia previa en `device_compatibility_registry` (sin repetir búsquedas si ya existe).
 * 2. Si no existe (o `forceRefresh: true`), consulta fuentes web reales vía `ResilientAIClient`
 *    (`useGoogleSearch: true`, `requireGroundedEvidence: true`, `tenantId: 'GLOBAL'`).
 * 3. Valida salida con Zod, calcula el veredicto determinísticamente en servidor, persiste en Firestore
 *    y registra trazabilidad en `AuditLedger`.
 */
export async function checkDeviceCompatibilityOnDemand(params: {
    query: string;
    forceRefresh?: boolean;
    actor: SpatialCatalogActor;
}): Promise<OnDemandCompatibilityCheckResult> {
    const cleanQuery = String(params.query || '').trim().replace(/\s+/g, ' ');
    if (cleanQuery.length < 2 || cleanQuery.length > 120) {
        throw new DeviceCompatibilityValidationError(
            'Ingrese un modelo de dispositivo válido (entre 2 y 120 caracteres).',
            400,
            'INVALID_DEVICE_QUERY'
        );
    }

    const searchQuery = stripRetailNoiseFromDeviceQuery(cleanQuery);
    const rawQueryKey = normalizeDeviceQueryKey(cleanQuery);
    const searchQueryKey = normalizeDeviceQueryKey(searchQuery) || rawQueryKey;
    const compactSearchQuery = compactAlnumKey(searchQuery);
    const compactRawQuery = compactAlnumKey(cleanQuery);
    if (!rawQueryKey || rawQueryKey.length < 2 || !searchQueryKey || searchQueryKey.length < 2) {
        throw new DeviceCompatibilityValidationError(
            'El modelo ingresado debe contener caracteres alfanuméricos válidos.',
            400,
            'INVALID_DEVICE_QUERY'
        );
    }

    const dedupKey = `${searchQueryKey}:${Boolean(params.forceRefresh)}`;
    const existingFlight = inFlightChecks.get(dedupKey);
    if (existingFlight) {
        return existingFlight;
    }

    const task = (async (): Promise<OnDemandCompatibilityCheckResult> => {
        const records = await readAllRegisteredRecords();
        const cachedMatch = !params.forceRefresh
            ? findMatchingRegisteredRecord(records, searchQueryKey, compactSearchQuery) ||
            (rawQueryKey !== searchQueryKey
                ? findMatchingRegisteredRecord(records, rawQueryKey, compactRawQuery)
                : null)
            : null;

        if (cachedMatch) {
            const now = Date.now();
            const mergedAliases = Array.from(
                new Set([...cachedMatch.aliases, searchQueryKey, rawQueryKey])
            ).slice(0, 32);
            const updatedRecord: DeviceCompatibilityRecord = {
                ...cachedMatch,
                aliases: mergedAliases,
                queryCount: cachedMatch.queryCount + 1,
                lastQueriedAt: now,
            };
            await db
                .collection(DEVICE_COMPATIBILITY_COLLECTION)
                .doc(cachedMatch.canonicalKey)
                .set(
                    {
                        aliases: mergedAliases,
                        queryCount: updatedRecord.queryCount,
                        lastQueriedAt: now,
                    },
                    { merge: true }
                );

            const refreshed = await readAllRegisteredRecords();
            return {
                device: updatedRecord,
                cached: true,
                registry: buildRegistrySnapshot(refreshed.length > 0 ? refreshed : [updatedRecord]),
            };
        }

        // Pasada 1: Investigación web grounded en prosa técnica natural (maximiza invocación de googleSearch)
        const pass1Prompt = [
            `Investiga en Google Search la compatibilidad espacial del dispositivo móvil "${searchQuery}" ejecutando obligatoriamente estas consultas focalizadas:`,
            `1) site:developers.google.com/ar/devices "${searchQuery}" (verifica si figura en la tabla oficial de Google Play Services for AR / ARCore y si indica "Supports Depth API") o documentación oficial Apple ARKit si es iPhone/iPad.`,
            `2) Especificaciones técnicas oficiales del fabricante / GSMArena para "${searchQuery}" (código OEM, SoC/chipset, giroscopio hardware físico, LiDAR, clasificación IP/MIL-STD-810H).`,
            `Responde en español técnico conciso (texto/viñetas claras, SIN formato JSON) cubriendo obligatoriamente:`,
            `- Fabricante oficial y nombre de modelo base comercial (sin almacenamiento GB ni color).`,
            `- Código de modelo OEM (ej. SM-S928B, A3296) si figura en las fuentes.`,
            `- Plataforma (ANDROID o IOS) y SoC / chipset.`,
            `- Giroscopio físico por hardware (Sí / No / No verificado).`,
            `- Listado oficialmente en developers.google.com/ar/devices (ARCore) o Apple ARKit (Sí / No / No verificado; cita el texto exacto de la tabla si aparece).`,
            `- Soporte oficial de ARCore Depth API o escáner LiDAR (Sí / No / No verificado; nota: OIS sin ToF/LiDAR solo cuenta como Depth API si figura expresamente como "Supports Depth API" en la documentación oficial).`,
            `- Certificación rugerizada / IP / MIL-STD-810H si aplica.`,
            `- Resumen técnico de 1 oración en español (máx. 280 caracteres) citando el SoC o sensor clave verificado.`,
            `Regla crítica: si tras ejecutar las búsquedas anteriores un dato no consta de forma concluyente, indica explícitamente "No verificado".`,
        ].join('\n');

        const pass1Res = await ResilientAIClient.generate({
            module: 'stockpile',
            tenantId: 'GLOBAL',
            dataClassification: 'GLOBAL_OEM',
            preferredTier: 'SECONDARY',
            useGoogleSearch: true,
            requireGroundedEvidence: true,
            bypassCache: Boolean(params.forceRefresh),
            temperature: 0.2,
            thinkingLevel: 'low',
            maxOutputTokens: 2048,
            attemptTimeoutMs: 22_000,
            maxTotalBudgetMs: 36_000,
            systemInstruction:
                'Eres un ingeniero especialista en hardware móvil industrial y ARCore/ARKit para MINREPORT. Debes ejecutar Google Search obligatoriamente consultando developers.google.com/ar/devices y fichas OEM, y reportar únicamente capacidades verificadas en fuentes web reales.',
            prompt: pass1Prompt,
        });

        const validSources: DeviceGroundingSource[] = (pass1Res.groundingSources || [])
            .map((src) => ({
                title: String(src?.title || src?.uri || 'Fuente web').trim().slice(0, 240),
                uri: String(src?.uri || '').trim().slice(0, 1024),
            }))
            .filter((src) => src.title.length > 0 && /^https?:\/\//i.test(src.uri))
            .slice(0, 16);

        if (validSources.length === 0) {
            throw new DeviceCompatibilityValidationError(
                'No se obtuvieron fuentes web verificables para respaldar el dispositivo.',
                422,
                'UNGROUNDED_DEVICE_EVALUATION'
            );
        }

        // Pasada 2: Extracción estructurada determinista con responseSchema + Zod
        let evalData = tryParseAiEvaluation(pass1Res.text);
        let modelUsed = pass1Res.model;

        if (!evalData) {
            const sourcesContext = validSources
                .map((src, idx) => `[${idx + 1}] ${src.title} -> ${src.uri}`)
                .join('\n');
            const pass2Prompt = [
                `Extrae en formato JSON estricto la ficha técnica de compatibilidad espacial del dispositivo "${searchQuery}" usando EXCLUSIVAMENTE la evidencia recuperada en Pasada 1:`,
                `EVIDENCIA PASADA 1:`,
                `"""`,
                pass1Res.text.slice(0, 8000),
                `"""`,
                `FUENTES CONSULTADAS:`,
                sourcesContext,
                `Reglas estrictas de mapeo:`,
                `- "model" debe contener únicamente el nombre de modelo base comercial limpio (sin almacenamiento GB/TB ni color).`,
                `- Si la evidencia indica "No verificado" o no confirma de forma concluyente "hasGyroscope", "arSupported", "depthSupported" o "lidarSupported", asigna null en ese campo booleano (nunca adivines).`,
                `- "verdictSummary" debe ser una sola oración técnica concisa en español (máx. 280 caracteres) citando el SoC o sensor clave verificado.`,
            ].join('\n');

            try {
                const pass2Res = await ResilientAIClient.generateStructured<AiDeviceEvaluation>(
                    {
                        module: 'stockpile',
                        tenantId: 'GLOBAL',
                        dataClassification: 'GLOBAL_OEM',
                        preferredTier: 'SECONDARY',
                        useGoogleSearch: false,
                        bypassCache: Boolean(params.forceRefresh),
                        temperature: 0,
                        thinkingLevel: 'none',
                        maxOutputTokens: 1024,
                        attemptTimeoutMs: 12_000,
                        maxTotalBudgetMs: 15_000,
                        responseSchema: AI_DEVICE_EVALUATION_RESPONSE_SCHEMA,
                        systemInstruction:
                            'Extractor determinista de fichas técnicas ARCore/ARKit para MINREPORT. Prohibido inferir o inventar capacidades ausentes en la evidencia.',
                        prompt: pass2Prompt,
                    },
                    AiDeviceEvaluationSchema
                );
                evalData = pass2Res.data;
                modelUsed = pass2Res.meta?.model || pass1Res.model;
            } catch (err: unknown) {
                if (err instanceof AISwarmUnavailableError) {
                    throw err;
                }
                if (err instanceof SyntaxError) {
                    throw new DeviceCompatibilityValidationError(
                        'La evaluación IA no devolvió una ficha técnica JSON estructurada válida.',
                        422,
                        'INVALID_AI_EVALUATION_JSON'
                    );
                }
                throw new DeviceCompatibilityValidationError(
                    'La evaluación de hardware no superó la validación de esquema técnico.',
                    422,
                    'INVALID_AI_EVALUATION_SCHEMA'
                );
            }
        }

        const deviceCode = sanitizeOptionalText(evalData.deviceCode, 120);
        const ruggedRating = evalData.rugged
            ? sanitizeOptionalText(evalData.ruggedRating, 120)
            : undefined;
        const lidarSupported =
            evalData.platform === 'IOS' ? evalData.lidarSupported : false;
        const tier = computeDeterministicDeviceTier({
            hasGyroscope: evalData.hasGyroscope,
            arSupported: evalData.arSupported,
            depthSupported: evalData.depthSupported,
            lidarSupported,
        });

        const baseCanonical = normalizeDeviceQueryKey(
            evalData.model.toLowerCase().startsWith(evalData.manufacturer.toLowerCase())
                ? evalData.model
                : `${evalData.manufacturer} ${evalData.model}`
        );
        const canonicalKey = baseCanonical || searchQueryKey;

        const existingCanonical = records.find((r) => r.canonicalKey === canonicalKey);
        const aliasCandidates = [
            canonicalKey,
            searchQueryKey,
            rawQueryKey,
            normalizeDeviceQueryKey(evalData.model),
            ...(deviceCode ? [normalizeDeviceQueryKey(deviceCode)] : []),
            ...(existingCanonical?.aliases || []),
        ].filter((a) => a.length >= 2);
        const aliases = Array.from(new Set(aliasCandidates)).slice(0, 32);

        const now = Date.now();
        const record: DeviceCompatibilityRecord = DeviceCompatibilityRecordSchema.parse({
            id: canonicalKey,
            canonicalKey,
            manufacturer: evalData.manufacturer,
            model: evalData.model,
            ...(deviceCode ? { deviceCode } : {}),
            aliases,
            platform: evalData.platform,
            hasGyroscope: evalData.hasGyroscope,
            arSupported: evalData.arSupported,
            depthSupported: evalData.depthSupported,
            lidarSupported,
            rugged: Boolean(evalData.rugged),
            ...(ruggedRating ? { ruggedRating } : {}),
            tier,
            verdictSummary: evalData.verdictSummary,
            groundingSources: validSources,
            source: 'AI_GROUNDED_VERIFIED',
            queryCount: (existingCanonical?.queryCount ?? 0) + 1,
            createdAt: existingCanonical?.createdAt ?? now,
            checkedAt: now,
            lastQueriedAt: now,
            checkedAtIso: new Date(now).toISOString(),
        });

        await db
            .collection(DEVICE_COMPATIBILITY_COLLECTION)
            .doc(canonicalKey)
            .set(record, { merge: true });

        await AuditLedger.record({
            tenantId: params.actor.tenantId || 'global',
            actorUid: params.actor.uid,
            actorEmail: params.actor.email || params.actor.uid,
            action: 'DEVICE_COMPATIBILITY_EVALUATED',
            module: 'stockpile',
            targetEntity: `${DEVICE_COMPATIBILITY_COLLECTION}/${canonicalKey}`,
            details: {
                query: cleanQuery,
                searchQuery,
                canonicalKey,
                tier: record.tier,
                platform: record.platform,
                hasGyroscope: record.hasGyroscope,
                arSupported: record.arSupported,
                depthSupported: record.depthSupported,
                lidarSupported: record.lidarSupported,
                sourcesCount: record.groundingSources.length,
                modelUsed,
                forceRefresh: Boolean(params.forceRefresh),
            },
            ipAddress: params.actor.ipAddress,
        }).catch(() => { });

        const refreshed = await readAllRegisteredRecords();
        const snapshotDevices =
            refreshed.some((d) => d.canonicalKey === record.canonicalKey)
                ? refreshed
                : [record, ...refreshed];

        return {
            device: record,
            cached: false,
            registry: buildRegistrySnapshot(snapshotDevices),
        };
    })();

    inFlightChecks.set(dedupKey, task);
    try {
        return await task;
    } finally {
        inFlightChecks.delete(dedupKey);
    }
}
