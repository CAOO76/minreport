import { auth, API_BASE_URL, getOpermaqActiveAccountId } from '../firebase/config';
import {
    clearDevTokensFromStorage,
    evictExpiredDevTokensFromStorage,
    isClientCachedJwtFresh,
} from '../../../utils/jwtFreshness';

const AUTH_WARN_COOLDOWN_MS = 5_000;
const AUTH_WARN_CACHE_MAX = 100;
const lastAuthWarnAt = new Map<string, number>();

function logThrottledClientAuthWarn(status: number, resolvedUrl: string): void {
    const key = `${status}:${resolvedUrl}`;
    const now = Date.now();
    const prev = lastAuthWarnAt.get(key) ?? 0;
    if (now - prev < AUTH_WARN_COOLDOWN_MS) {
        return;
    }
    if (lastAuthWarnAt.size >= AUTH_WARN_CACHE_MAX) {
        const oldestKey = lastAuthWarnAt.keys().next().value;
        if (oldestKey) lastAuthWarnAt.delete(oldestKey);
    }
    lastAuthWarnAt.set(key, now);
    console.warn(`[OPERMAQ-AUTH] HTTP ${status} en ${resolvedUrl}`);
}

/**
 * AUTH-FETCH (Subordinado a MINREPORT Core)
 * Inyecta el Firebase ID Token de la sesión centralizada y el encabezado X-Active-Account-Id
 * para que `resolveMinReportSessionScope` resuelva el alcance multi-tenant exacto.
 * En cabina `/dev`, prioriza la identidad `DEV_ROOT` verificada sobre sesiones cliente de otras pestañas.
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    evictExpiredDevTokensFromStorage();

    if (!auth.currentUser && typeof auth.authStateReady === 'function') {
        try {
            await auth.authStateReady();
        } catch {
            // Continuar con respaldo local si authStateReady falla
        }
    }

    const user = auth.currentUser;

    const isInDevGateway =
        typeof window !== 'undefined' && window.location.pathname.startsWith('/dev');

    // Soportar token de sesión DEV en cabina /dev solo si conserva vigencia cliente
    const rawDevToken =
        typeof window !== 'undefined'
            ? localStorage.getItem('dev_auth_token') || localStorage.getItem('dev_vault_token')
            : null;
    const devFallbackToken = isClientCachedJwtFresh(rawDevToken) ? rawDevToken : null;

    if (!user && !devFallbackToken) {
        throw new Error('Sesión no iniciada en MINREPORT');
    }

    const resolvedUrl = url.startsWith('/api/')
        ? `${API_BASE_URL}${url.slice(4)}`
        : url.startsWith('/')
        ? `${API_BASE_URL}${url}`
        : url;

    const isFirebaseUserDevRoot =
        Boolean(user) &&
        (user!.uid === 'dev-master-root-uid' ||
            user!.email?.toLowerCase() === 'dev@minreport.com');

    let idToken: string | null = null;
    let usedDevFallbackToken = false;

    if (isInDevGateway && devFallbackToken && !isFirebaseUserDevRoot) {
        idToken = devFallbackToken;
        usedDevFallbackToken = true;
    } else if (user) {
        idToken = await user.getIdToken();
        if (isInDevGateway && isFirebaseUserDevRoot && idToken) {
            localStorage.setItem('dev_auth_token', idToken);
        }
    } else if (devFallbackToken) {
        idToken = devFallbackToken;
        usedDevFallbackToken = true;
    }

    const activeAccountId = getOpermaqActiveAccountId();

    const headers: Record<string, string> = {
        ...((options.headers as Record<string, string>) || {}),
    };

    if (idToken) {
        headers['Authorization'] = `Bearer ${idToken}`;
    }

    if (activeAccountId && !headers['X-Active-Account-Id']) {
        headers['X-Active-Account-Id'] = activeAccountId;
    }

    let response = await fetch(resolvedUrl, { ...options, headers });

    if (response.status === 401) {
        if (user) {
            try {
                const refreshedToken = await user.getIdToken(true);
                if (refreshedToken) {
                    if (isInDevGateway && isFirebaseUserDevRoot) {
                        localStorage.setItem('dev_auth_token', refreshedToken);
                    }
                    headers['Authorization'] = `Bearer ${refreshedToken}`;
                    response = await fetch(resolvedUrl, { ...options, headers });
                    usedDevFallbackToken = false;
                }
            } catch {
                // Conservar respuesta 401 si no fue posible renovar token
            }
        }

        if (response.status === 401 && usedDevFallbackToken && !isFirebaseUserDevRoot) {
            clearDevTokensFromStorage();
        }
    }

    if (response.status === 401 || response.status === 403) {
        logThrottledClientAuthWarn(response.status, resolvedUrl);
    }

    return response;
}
