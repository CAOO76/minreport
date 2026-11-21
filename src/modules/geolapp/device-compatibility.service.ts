import { z } from 'zod';
import { db } from '../../config/firebase';
import { AuditLedger } from '../../core/audit-ledger';
import { ResilientAIClient } from '../../core/resilient-ai-client';

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

    const queryKey = normalizeDeviceQueryKey(cleanQuery);
    const compactQuery = compactAlnumKey(cleanQuery);
    if (!queryKey || queryKey.length < 2) {
        throw new DeviceCompatibilityValidationError(
            'El modelo ingresado debe contener caracteres alfanuméricos válidos.',
            400,
            'INVALID_DEVICE_QUERY'
        );
    }

    const dedupKey = `${queryKey}:${Boolean(params.forceRefresh)}`;
    const existingFlight = inFlightChecks.get(dedupKey);
    if (existingFlight) {
        return existingFlight;
    }

    const task = (async (): Promise<OnDemandCompatibilityCheckResult> => {
        const records = await readAllRegisteredRecords();
        const cachedMatch = !params.forceRefresh
            ? findMatchingRegisteredRecord(records, queryKey, compactQuery)
            : null;

        if (cachedMatch) {
            const now = Date.now();
            const mergedAliases = Array.from(new Set([...cachedMatch.aliases, queryKey])).slice(0, 32);
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

        const prompt = [
            `Evalúa técnicamente la compatibilidad espacial del dispositivo móvil consultado para fotogrametría AR / escaneo 3D de terreno (MINREPORT · ACOPIOS):`,
            `Dispositivo consultado: "${cleanQuery}"`,
            `Consulta en la web especificaciones oficiales verificables (lista oficial Google Play Services for AR / ARCore devices, Apple ARKit, presencia de giroscopio hardware, soporte ARCore Depth API o LiDAR, código de modelo OEM y certificación industrial IP68/MIL-STD-810H si aplica).`,
            `Reglas estrictas de veracidad:`,
            `- No adivines capacidades: si no existe evidencia concluyente sobre ARCore, Depth API o giroscopio, devuelve null en ese booleano.`,
            `- Una cámara OIS sin hardware ToF/LiDAR puede usar Depth API monocular por software si y solo si el equipo figura con soporte ARCore Depth API en la documentación verificada.`,
            `- "verdictSummary" debe ser técnico, conciso (1 oración, español, máx 280 chars) citando el SoC o sensor clave verificado.`,
            `Responde ÚNICAMENTE con un objeto JSON válido (sin texto adicional) con exactamente estas llaves:`,
            `{`,
            `  "manufacturer": string,`,
            `  "model": string,`,
            `  "deviceCode": string | null,`,
            `  "platform": "ANDROID" | "IOS",`,
            `  "hasGyroscope": boolean | null,`,
            `  "arSupported": boolean | null,`,
            `  "depthSupported": boolean | null,`,
            `  "lidarSupported": boolean | null,`,
            `  "rugged": boolean,`,
            `  "ruggedRating": string | null,`,
            `  "verdictSummary": string`,
            `}`,
        ].join('\n');

        const aiRes = await ResilientAIClient.generate({
            module: 'stockpile',
            tenantId: 'GLOBAL',
            preferredTier: 'SECONDARY',
            useGoogleSearch: true,
            requireGroundedEvidence: true,
            bypassCache: Boolean(params.forceRefresh),
            temperature: 0.1,
            thinkingLevel: 'low',
            maxOutputTokens: 900,
            systemInstruction:
                'Eres un ingeniero especialista en hardware móvil industrial y ARCore/ARKit para MINREPORT. Solo reportas capacidades técnicas verificadas con búsqueda web.',
            prompt,
        });

        const extractedJson = ResilientAIClient.extractJsonString(aiRes.text);
        let rawObj: unknown;
        try {
            rawObj = JSON.parse(extractedJson);
        } catch {
            throw new DeviceCompatibilityValidationError(
                'La evaluación IA no devolvió una ficha técnica JSON estructurada válida.',
                422,
                'INVALID_AI_EVALUATION_JSON'
            );
        }

        const parsedAi = AiDeviceEvaluationSchema.safeParse(rawObj);
        if (!parsedAi.success) {
            throw new DeviceCompatibilityValidationError(
                'La evaluación de hardware no superó la validación de esquema técnico.',
                422,
                'INVALID_AI_EVALUATION_SCHEMA'
            );
        }

        const evalData = parsedAi.data;
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
        const canonicalKey = baseCanonical || queryKey;

        const existingCanonical = records.find((r) => r.canonicalKey === canonicalKey);
        const aliasCandidates = [
            canonicalKey,
            queryKey,
            normalizeDeviceQueryKey(evalData.model),
            ...(deviceCode ? [normalizeDeviceQueryKey(deviceCode)] : []),
            ...(existingCanonical?.aliases || []),
        ].filter((a) => a.length >= 2);
        const aliases = Array.from(new Set(aliasCandidates)).slice(0, 32);

        const validSources: DeviceGroundingSource[] = (aiRes.groundingSources || [])
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
                canonicalKey,
                tier: record.tier,
                platform: record.platform,
                hasGyroscope: record.hasGyroscope,
                arSupported: record.arSupported,
                depthSupported: record.depthSupported,
                lidarSupported: record.lidarSupported,
                sourcesCount: record.groundingSources.length,
                modelUsed: aiRes.model,
                forceRefresh: Boolean(params.forceRefresh),
            },
            ipAddress: params.actor.ipAddress,
        }).catch(() => {});

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
