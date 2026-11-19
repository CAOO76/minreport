import { auth } from '../../config/firebase';
import { getApiUrl } from '../../utils/network';
import {
    clearDevTokensFromStorage,
    evictExpiredDevTokensFromStorage,
    isClientCachedJwtFresh,
} from '../../utils/jwtFreshness';

function isCurrentUserDevRoot(): boolean {
    const current = auth.currentUser;
    if (!current) return false;
    return (
        current.uid === 'dev-master-root-uid' ||
        current.email?.toLowerCase() === 'dev@minreport.com'
    );
}

/**
 * Resuelve el token Bearer activo para llamadas HTTP hacia Core API.
 * En `/dev` sin impersonación activa prioriza un ID Token vivo de Firebase si `DEV_ROOT`
 * está autenticado y solo usa `dev_auth_token` si pasa validación de expiración cliente.
 */
export async function resolveCoreAuthToken(): Promise<string | null> {
    evictExpiredDevTokensFromStorage();

    const hasWindow = typeof window !== 'undefined';
    const isDevRoute = hasWindow && window.location.pathname.startsWith('/dev');
    const isImpersonating = hasWindow && localStorage.getItem('dev_is_impersonating') === 'true';

    if (typeof auth.authStateReady === 'function') {
        try {
            await auth.authStateReady();
        } catch {
            // Continuar con resolución actual de credenciales
        }
    }

    const storedDevAuthToken = hasWindow ? localStorage.getItem('dev_auth_token') : null;
    const storedDevVaultToken = hasWindow ? localStorage.getItem('dev_vault_token') : null;
    const freshDevAuthToken = isClientCachedJwtFresh(storedDevAuthToken) ? storedDevAuthToken : null;
    const freshDevVaultToken = isClientCachedJwtFresh(storedDevVaultToken) ? storedDevVaultToken : null;

    if (isDevRoute && !isImpersonating) {
        if (isCurrentUserDevRoot() && auth.currentUser) {
            try {
                const idToken = await auth.currentUser.getIdToken();
                if (idToken) {
                    if (hasWindow) {
                        localStorage.setItem('dev_auth_token', idToken);
                    }
                    return idToken;
                }
            } catch {
                // Continuar con token DEV en caché si sigue fresco
            }
        }
        if (freshDevAuthToken) {
            return freshDevAuthToken;
        }
    }

    if (auth.currentUser) {
        try {
            const idToken = await auth.currentUser.getIdToken();
            if (idToken) return idToken;
        } catch {
            // Fallback a token DEV local si getIdToken falla
        }
    }

    return freshDevAuthToken || freshDevVaultToken || null;
}

/**
 * Cliente HTTP transversal autenticado para MINREPORT Core y módulos integrados.
 * Resuelve rutas relativas `/api/...` mediante `getApiUrl` e inyecta
 * `Authorization: Bearer ...` y `X-Active-Account-Id` si no fueron provistos.
 */
export async function coreAuthFetch(
    endpointOrUrl: string,
    init: RequestInit = {}
): Promise<Response> {
    const resolvedUrl = /^https?:\/\//i.test(endpointOrUrl)
        ? endpointOrUrl
        : getApiUrl(endpointOrUrl);

    const headers = new Headers(init.headers);
    const callerProvidedAuth = headers.has('Authorization');

    if (!callerProvidedAuth) {
        const token = await resolveCoreAuthToken();
        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }
    }

    if (!headers.has('X-Active-Account-Id') && typeof window !== 'undefined') {
        const activeAccountId = localStorage.getItem('minreport_active_account_id')?.trim();
        if (activeAccountId) {
            headers.set('X-Active-Account-Id', activeAccountId);
        }
    }

    let response = await fetch(resolvedUrl, {
        ...init,
        headers,
    });

    if (response.status === 401 && !callerProvidedAuth) {
        if (auth.currentUser) {
            try {
                const refreshedToken = await auth.currentUser.getIdToken(true);
                if (refreshedToken) {
                    if (
                        typeof window !== 'undefined' &&
                        window.location.pathname.startsWith('/dev') &&
                        localStorage.getItem('dev_is_impersonating') !== 'true' &&
                        isCurrentUserDevRoot()
                    ) {
                        localStorage.setItem('dev_auth_token', refreshedToken);
                    }
                    headers.set('Authorization', `Bearer ${refreshedToken}`);
                    response = await fetch(resolvedUrl, {
                        ...init,
                        headers,
                    });
                }
            } catch {
                // Mantener respuesta 401 si la renovación falla
            }
        }

        if (
            response.status === 401 &&
            typeof window !== 'undefined' &&
            window.location.pathname.startsWith('/dev') &&
            !isCurrentUserDevRoot()
        ) {
            clearDevTokensFromStorage();
        }
    }

    return response;
}
