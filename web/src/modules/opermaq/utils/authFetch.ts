import { getAuth } from 'firebase/auth';
import { getAppCheckToken } from '../firebase/config';


/**
 * AUTH-FETCH: Wrapper autenticado sobre fetch.
 * Inyecta el token Firebase en el header estándar Authorization: Bearer.
 * También inyecta el token de App Check para securizar el endpoint.
 */
export async function authFetch(url: string, options: RequestInit = {}) {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
        throw new Error('Usuario no autenticado');
    }

    // Obtener tokens
    const [idToken, appCheckToken] = await Promise.all([
        user.getIdToken(),
        getAppCheckToken().catch(() => null)
    ]);

    const headers: Record<string, string> = {
        ...((options.headers as Record<string, string>) || {}),
    };

    if (idToken) {
        headers['Authorization'] = `Bearer ${idToken}`;
    }

    if (appCheckToken) {
        headers['X-Firebase-AppCheck'] = appCheckToken;
    }

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401 || response.status === 403) {
        console.warn(`[AUTH-WARN] ${response.status} en ${url}`);
    }

    return response;
}
