import { Request, Response, NextFunction } from 'express';

/**
 * RATE LIMITER EN MEMORIA CON HIGIENE PERIÓDICA (Capa 3 — Seguridad Bancaria ISO 27001)
 *
 * Controla ráfagas por `ip + routeKey` sin dependencias externas bloqueantes,
 * respondiendo `HTTP 429 Too Many Requests` con cabecera estándar `Retry-After`.
 */

interface RateBucket {
    count: number;
    resetAtMs: number;
}

export interface RateLimiterConfig {
    routeKey: string;
    windowMs: number;
    maxRequests: number;
    message?: string;
}

const buckets = new Map<string, RateBucket>();
const MAX_BUCKETS_IN_MEMORY = 50_000;
const CLEANUP_INTERVAL_MS = 60_000;

const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
        if (bucket.resetAtMs <= now) {
            buckets.delete(key);
        }
    }
    if (buckets.size > MAX_BUCKETS_IN_MEMORY) {
        const overflow = buckets.size - MAX_BUCKETS_IN_MEMORY;
        let removed = 0;
        for (const key of buckets.keys()) {
            buckets.delete(key);
            removed++;
            if (removed >= overflow) break;
        }
    }
}, CLEANUP_INTERVAL_MS);

cleanupTimer.unref();

export function extractClientIp(req: Request): string {
    const rawIp = req.ip || req.socket?.remoteAddress || 'unknown';
    return String(rawIp)
        .replace(/^::ffff:/i, '')
        .trim()
        .slice(0, 64) || 'unknown';
}

export function createRateLimiter(config: RateLimiterConfig) {
    const { routeKey, windowMs, maxRequests, message } = config;

    return (req: Request, res: Response, next: NextFunction) => {
        const now = Date.now();
        const ip = extractClientIp(req);
        const key = `${routeKey}:${ip}`;

        let bucket = buckets.get(key);
        if (!bucket || bucket.resetAtMs <= now) {
            bucket = {
                count: 1,
                resetAtMs: now + windowMs,
            };
            buckets.set(key, bucket);
        } else {
            bucket.count += 1;
        }

        const remaining = Math.max(0, maxRequests - bucket.count);
        const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAtMs - now) / 1000));

        res.setHeader('RateLimit-Limit', String(maxRequests));
        res.setHeader('RateLimit-Remaining', String(remaining));
        res.setHeader('RateLimit-Reset', String(retryAfterSec));

        if (bucket.count > maxRequests) {
            res.setHeader('Retry-After', String(retryAfterSec));
            return res.status(429).json({
                error: 'TOO_MANY_REQUESTS',
                message:
                    message ||
                    'Límite de solicitudes excedido temporalmente. Intente nuevamente tras el periodo indicado en Retry-After.',
                retryAfterSeconds: retryAfterSec,
            });
        }

        return next();
    };
}

/**
 * Preset de Autenticación / Desafíos / Passkeys / Setup: 20 req / 15 min por IP.
 */
export const authRateLimiter = createRateLimiter({
    routeKey: 'auth',
    windowMs: 15 * 60 * 1000,
    maxRequests: 20,
    message: 'Demasiados intentos de autenticación. Espere antes de reintentar.',
});

/**
 * Preset de Inferencia IA / Enjambre Gemini: 30 req / min por IP.
 */
export const aiRateLimiter = createRateLimiter({
    routeKey: 'ai',
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: 'Cuota por minuto de inferencia IA alcanzada. Reintente en unos segundos.',
});

/**
 * Preset de Mutaciones Transaccionales y Administrativas: 60 req / min por IP.
 */
export const mutationRateLimiter = createRateLimiter({
    routeKey: 'mutation',
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: 'Demasiadas operaciones de escritura consecutivas. Reintente en unos segundos.',
});
