import { Timestamp } from 'firebase-admin/firestore';

/**
 * Políticas deterministas de Retención Legal (6 años — SII / Código Tributario / Auditoría Minera)
 * y Purga Automática Nativa Firestore TTL (30 días y desafíos efímeros).
 * Región obligatoria: southamerica-west1 (Ley N° 21.719).
 */

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const SIX_YEARS_MIN_MS = 6 * 365 * 24 * 60 * 60 * 1000;

function resolveBaseMillis(fromMs?: number): number {
    if (typeof fromMs === 'number' && Number.isFinite(fromMs) && fromMs > 0) {
        return Math.round(fromMs);
    }
    return Date.now();
}

/**
 * Calcula el Timestamp determinista de retención legal a 6 años calendario UTC
 * (para registros inmutables en `audit_ledger` y `x402_receipts`).
 */
export function computeSixYearRetentionTimestamp(fromMs?: number): Timestamp {
    const baseMs = resolveBaseMillis(fromMs);
    const target = new Date(baseMs);
    target.setUTCFullYear(target.getUTCFullYear() + 6);
    return Timestamp.fromMillis(target.getTime());
}

/**
 * Calcula el Timestamp determinista para política Firestore TTL a 30 días exactos
 * (bajas lógicas `SOFT_DELETE_TENANT`, postulaciones rechazadas y caché `ai_inference_cache`).
 */
export function computeThirtyDayTtlTimestamp(fromMs?: number): Timestamp {
    const baseMs = resolveBaseMillis(fromMs);
    return Timestamp.fromMillis(baseMs + THIRTY_DAYS_MS);
}

/**
 * Calcula un Timestamp Firestore TTL de corta duración (desafíos WebAuthn, DEV_ROOT y tokens de setup).
 * Impone piso mínimo de 1 segundo para evitar Timestamps inválidos por entradas negativas/NaN.
 */
export function computeShortTtlTimestamp(ms: number, fromMs?: number): Timestamp {
    const baseMs = resolveBaseMillis(fromMs);
    const safeDurationMs = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? Math.max(1000, Math.round(ms)) : 60_000;
    return Timestamp.fromMillis(baseMs + safeDurationMs);
}

/**
 * Normaliza un campo de expiración almacenado como epoch ms (`number`) o `Timestamp` de Firestore
 * sin romper lectores legados.
 */
export function toEpochMillis(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (value && typeof (value as Timestamp).toMillis === 'function') {
        return (value as Timestamp).toMillis();
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const asNum = Number(value);
        if (Number.isFinite(asNum)) return asNum;
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}
