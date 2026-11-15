import { auth } from '../../config/firebase';
import { getApiUrl } from '../../utils/network';

/**
 * Resuelve el token Bearer activo para llamadas HTTP hacia Core API.
 * En `/dev` sin impersonación activa prioriza `dev_auth_token`; en el resto
 * utiliza `auth.currentUser?.getIdToken()` con respaldo en tokens locales DEV.
 */
export async function resolveCoreAuthToken(): Promise<string | null> {
    const hasWindow = typeof window !== 'undefined';
    const isDevRoute = hasWindow && window.location.pathname.startsWith('/dev');
    const isImpersonating = hasWindow && localStorage.getItem('dev_is_impersonating') === 'true';
    const storedDevAuthToken = hasWindow ? localStorage.getItem('dev_auth_token') : null;
    const storedDevVaultToken = hasWindow ? localStorage.getItem('dev_vault_token') : null;

    if (isDevRoute && !isImpersonating && storedDevAuthToken) {
        return storedDevAuthToken;
    }

    if (typeof auth.authStateReady === 'function') {
        try {
            await auth.authStateReady();
        } catch {
            // Continuar con resolución actual de credenciales
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

    return storedDevAuthToken || storedDevVaultToken || null;
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

    if (!headers.has('Authorization')) {
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

    return fetch(resolvedUrl, {
        ...init,
        headers,
    });
}
