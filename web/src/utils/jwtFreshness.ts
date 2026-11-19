const DEV_TOKEN_STORAGE_KEYS = ['dev_auth_token', 'dev_vault_token'] as const;

function decodeBase64UrlSegment(segment: string): string | null {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLength);

    if (typeof atob === 'function') {
        try {
            return atob(padded);
        } catch {
            return null;
        }
    }

    const globalBuffer = (
        globalThis as {
            Buffer?: { from(input: string, encoding: string): { toString(enc: string): string } };
        }
    ).Buffer;
    if (globalBuffer) {
        try {
            return globalBuffer.from(padded, 'base64').toString('utf8');
        } catch {
            return null;
        }
    }

    return null;
}

/**
 * Comprueba en cliente si un JWT almacenado en `localStorage` aún no expira según `payload.exp`.
 * Uso exclusivo para higiene de caché cliente; la autorización real ocurre en backend (`auth.verifyIdToken`).
 */
export function isClientCachedJwtFresh(
    token: string | null | undefined,
    skewSeconds = 30
): boolean {
    if (typeof token !== 'string') return false;
    const trimmed = token.trim();
    if (!trimmed) return false;

    const parts = trimmed.split('.');
    if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
        return false;
    }

    const decodedJson = decodeBase64UrlSegment(parts[1]);
    if (!decodedJson) return false;

    try {
        const payload = JSON.parse(decodedJson) as { exp?: unknown };
        if (typeof payload?.exp !== 'number' || !Number.isFinite(payload.exp)) {
            return false;
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        return payload.exp > nowSeconds + skewSeconds;
    } catch {
        return false;
    }
}

/**
 * Descarta de `localStorage` los tokens DEV expirados o malformados antes de enviarlos a Core API.
 */
export function evictExpiredDevTokensFromStorage(): void {
    if (typeof window === 'undefined') return;
    try {
        for (const key of DEV_TOKEN_STORAGE_KEYS) {
            const raw = window.localStorage.getItem(key);
            if (raw && !isClientCachedJwtFresh(raw)) {
                window.localStorage.removeItem(key);
            }
        }
    } catch {
        // Ignorar restricciones de almacenamiento en contextos privados
    }
}

/**
 * Elimina completamente los tokens DEV en caché local cuando el servidor rechaza la sesión.
 */
export function clearDevTokensFromStorage(): void {
    if (typeof window === 'undefined') return;
    try {
        for (const key of DEV_TOKEN_STORAGE_KEYS) {
            window.localStorage.removeItem(key);
        }
    } catch {
        // Ignorar restricciones de almacenamiento
    }
}
