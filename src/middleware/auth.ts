import { Request, Response, NextFunction } from 'express';
import { auth } from '../config/firebase';
import { isDevPrivateReleaseStage } from '../config/env';

export interface AuthRequest extends Request {
    user?: any;
}

export function isDecodedDevRootToken(decoded: Record<string, any> | null | undefined): boolean {
    if (!decoded) return false;
    const uid = String(decoded.uid || '').trim();
    const emailLower = String(decoded.email || '').trim().toLowerCase();
    const emailVerifiedOk = decoded.email_verified !== false;
    const roleUpper = String(decoded.role || '').trim().toUpperCase();
    return Boolean(
        decoded.isMasterDev === true ||
            roleUpper === 'DEV_ROOT' ||
            uid === 'dev-master-root-uid' ||
            (emailVerifiedOk && emailLower === 'dev@minreport.com')
    );
}

const AUTH_LOG_WINDOW_MS = 5_000;
const AUTH_LOG_MAX_KEYS = 200;
const authFailureLogState = new Map<string, { windowStartMs: number; suppressedCount: number }>();

/**
 * Registra fallos de verificación JWT en una sola línea deduplicada por ventana (5s)
 * para evitar inundar la terminal con stack traces repetitivos ante ráfagas HTTP 401.
 */
export function logThrottledAuthFailure(scope: string, req: Request, error: unknown): void {
    const errObj = error as { code?: unknown; errorInfo?: { code?: unknown }; message?: unknown } | null;
    const rawCode = errObj?.code ?? errObj?.errorInfo?.code;
    const code = typeof rawCode === 'string' && rawCode.trim() ? rawCode.trim() : 'auth/invalid-token';

    const rawMsg =
        error instanceof Error
            ? error.message
            : typeof errObj?.message === 'string'
              ? errObj.message
              : typeof error === 'string'
                ? error
                : 'Token inválido o expirado';
    const singleLineMsg = rawMsg.split(/\r?\n/)[0].trim().slice(0, 180) || 'Token inválido o expirado';

    const routePath = `${req.baseUrl || ''}${req.path || ''}` || req.url || '/';
    const key = `${scope}:${code}:${req.method}:${routePath}`;
    const now = Date.now();
    const existing = authFailureLogState.get(key);

    if (existing && now - existing.windowStartMs < AUTH_LOG_WINDOW_MS) {
        existing.suppressedCount += 1;
        return;
    }

    const prevSuppressed = existing?.suppressedCount ?? 0;
    if (!existing && authFailureLogState.size >= AUTH_LOG_MAX_KEYS) {
        const oldestKey = authFailureLogState.keys().next().value;
        if (oldestKey) authFailureLogState.delete(oldestKey);
    }
    authFailureLogState.set(key, { windowStartMs: now, suppressedCount: 0 });

    const suppressedNote =
        prevSuppressed > 0 ? ` (+${prevSuppressed} repetidos suprimidos)` : '';
    console.warn(`[${scope}] ${req.method} ${routePath} -> ${code}: ${singleLineMsg}${suppressedNote}`);
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: No token provided' });
        }

        const token = authHeader.slice(7).trim();
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized: Empty token' });
        }

        // Verificación criptográfica estricta (soporta Auth Emulator cuando FIREBASE_AUTH_EMULATOR_HOST está activo)
        const decodedToken = await auth.verifyIdToken(token);

        if (isDevPrivateReleaseStage() && !isDecodedDevRootToken(decodedToken)) {
            return res.status(403).json({
                error: 'RELEASE_STAGE_DEV_ONLY: Acceso restringido exclusivamente a 1º DEV.',
                code: 'RELEASE_STAGE_DEV_ONLY',
            });
        }

        req.user = decodedToken;
        return next();
    } catch (error) {
        logThrottledAuthFailure('SECURITY', req, error);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};
