import { auth, API_BASE_URL, getOpermaqActiveAccountId } from '../firebase/config';

/**
 * AUTH-FETCH (Subordinado a MINREPORT Core)
 * Inyecta el Firebase ID Token de la sesión centralizada y el encabezado X-Active-Account-Id
 * para que `resolveMinReportSessionScope` resuelva el alcance multi-tenant exacto.
 * En cabina `/dev`, prioriza la identidad `DEV_ROOT` verificada sobre sesiones cliente de otras pestañas.
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const user = auth.currentUser;

    const isInDevGateway =
        typeof window !== 'undefined' && window.location.pathname.startsWith('/dev');

    // Soportar token de sesión DEV en cabina /dev cuando el usuario opera bajo gateway criptográfico
    const devFallbackToken =
        typeof window !== 'undefined'
            ? localStorage.getItem('dev_auth_token') || localStorage.getItem('dev_vault_token')
            : null;

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
    if (isInDevGateway && devFallbackToken && !isFirebaseUserDevRoot) {
        idToken = devFallbackToken;
    } else if (user) {
        idToken = await user.getIdToken();
        if (isInDevGateway && isFirebaseUserDevRoot && idToken) {
            localStorage.setItem('dev_auth_token', idToken);
        }
    } else {
        idToken = devFallbackToken;
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

    const response = await fetch(resolvedUrl, { ...options, headers });

    if (response.status === 401 || response.status === 403) {
        console.warn(`[OPERMAQ-AUTH] HTTP ${response.status} en ${resolvedUrl}`);
    }

    return response;
}
