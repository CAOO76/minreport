import { signInWithCustomToken, UserCredential } from 'firebase/auth';
import { auth } from '../config/firebase';
import { getApiUrl } from '../utils/network';

/**
 * Cliente W3C WebAuthn / FIDO2 para autenticacion biométrica sin contraseñas (Capa 3 MINREPORT).
 */
export function isPasskeySupported(): boolean {
    return typeof window !== 'undefined' && Boolean(window.PublicKeyCredential);
}

export function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
    const normalized = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLength);
    const binary = window.atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

export function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window
        .btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

export interface PasskeyRegisterResult {
    success: boolean;
    credentialId: string;
}

export async function registerPasskey(idToken: string, deviceLabel?: string): Promise<PasskeyRegisterResult> {
    if (!isPasskeySupported()) {
        throw new Error('Este navegador o terminal no soporta autenticacion FIDO2 / WebAuthn.');
    }

    const optionsRes = await fetch(getApiUrl('/api/auth/passkey/register-options'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ deviceLabel: deviceLabel || 'Terminal MINREPORT' }),
    });

    const optionsPayload = await optionsRes.json().catch(() => ({}));
    if (!optionsRes.ok) {
        throw new Error(optionsPayload.error || `Error al obtener desafio FIDO2 (${optionsRes.status})`);
    }

    const rawOptions = optionsPayload.options || optionsPayload.publicKey || optionsPayload;
    if (!rawOptions?.challenge || !rawOptions?.user?.id) {
        throw new Error('Respuesta invalida del servidor al generar opciones Passkey.');
    }

    const publicKey: PublicKeyCredentialCreationOptions = {
        rp: rawOptions.rp,
        challenge: base64UrlToArrayBuffer(rawOptions.challenge),
        user: {
            id: base64UrlToArrayBuffer(rawOptions.user.id),
            name: String(rawOptions.user.name || ''),
            displayName: String(rawOptions.user.displayName || rawOptions.user.name || ''),
        },
        pubKeyCredParams: rawOptions.pubKeyCredParams || [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
        ],
        timeout: rawOptions.timeout ?? 60000,
        attestation: rawOptions.attestation ?? 'none',
        authenticatorSelection: rawOptions.authenticatorSelection,
        excludeCredentials: Array.isArray(rawOptions.excludeCredentials)
            ? rawOptions.excludeCredentials.map((cred: any) => ({
                type: 'public-key' as const,
                id: base64UrlToArrayBuffer(cred.id),
                transports: cred.transports,
            }))
            : undefined,
    };

    const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
    if (!credential) {
        throw new Error('Creacion de Passkey cancelada por el usuario o el autenticador.');
    }

    const response = credential.response as AuthenticatorAttestationResponse;
    const spkiBuffer = typeof response.getPublicKey === 'function' ? response.getPublicKey() : null;
    const publicKeySpkiBase64 = spkiBuffer ? arrayBufferToBase64(spkiBuffer) : undefined;
    const publicKeyAlgorithm = typeof response.getPublicKeyAlgorithm === 'function'
        ? response.getPublicKeyAlgorithm()
        : undefined;
    const authDataBuffer = typeof response.getAuthenticatorData === 'function'
        ? response.getAuthenticatorData()
        : null;
    const authenticatorData = authDataBuffer ? arrayBufferToBase64Url(authDataBuffer) : undefined;
    const transports = typeof response.getTransports === 'function'
        ? response.getTransports()
        : undefined;

    const attestationObject = arrayBufferToBase64Url(response.attestationObject);
    const clientDataJSON = arrayBufferToBase64Url(response.clientDataJSON);
    const rawId = arrayBufferToBase64Url(credential.rawId);

    const verifyRes = await fetch(getApiUrl('/api/auth/passkey/register-verify'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
            id: credential.id,
            credentialId: credential.id,
            rawId,
            type: credential.type,
            challengeId: optionsPayload.challengeId || rawOptions.challengeId,
            deviceLabel: deviceLabel || 'Terminal MINREPORT',
            publicKeySpkiBase64,
            publicKeyAlgorithm,
            attestationObject,
            clientDataJSON,
            authenticatorData,
            transports,
            response: {
                attestationObject,
                clientDataJSON,
                authenticatorData,
                publicKey: publicKeySpkiBase64,
                publicKeyAlgorithm,
                transports,
            },
        }),
    });

    const verifyData = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok) {
        throw new Error(verifyData.error || `Fallo en verificacion de Passkey (${verifyRes.status})`);
    }

    return {
        success: true,
        credentialId: credential.id,
    };
}

export async function authenticateWithPasskey(identifier?: string): Promise<UserCredential> {
    if (!isPasskeySupported()) {
        throw new Error('Este navegador o terminal no soporta autenticacion FIDO2 / WebAuthn.');
    }

    const cleanIdentifier = identifier?.trim() || undefined;
    const optionsRes = await fetch(getApiUrl('/api/auth/passkey/login-options'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            identifier: cleanIdentifier,
            email: cleanIdentifier && cleanIdentifier.includes('@') ? cleanIdentifier.toLowerCase() : undefined,
        }),
    });

    const optionsPayload = await optionsRes.json().catch(() => ({}));
    if (!optionsRes.ok) {
        throw new Error(optionsPayload.error || `No se pudo iniciar desafio Passkey (${optionsRes.status})`);
    }

    const rawOptions = optionsPayload.options || optionsPayload.publicKey || optionsPayload;
    if (!rawOptions?.challenge) {
        throw new Error('Desafio criptografico Passkey ausente en la respuesta del servidor.');
    }

    const publicKey: PublicKeyCredentialRequestOptions = {
        challenge: base64UrlToArrayBuffer(rawOptions.challenge),
        rpId: rawOptions.rpId,
        timeout: rawOptions.timeout ?? 60000,
        userVerification: rawOptions.userVerification ?? 'preferred',
        allowCredentials: Array.isArray(rawOptions.allowCredentials)
            ? rawOptions.allowCredentials.map((cred: any) => ({
                type: 'public-key' as const,
                id: base64UrlToArrayBuffer(cred.id),
                transports: cred.transports,
            }))
            : undefined,
    };

    const assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
    if (!assertion) {
        throw new Error('Autenticacion Passkey cancelada.');
    }

    const response = assertion.response as AuthenticatorAssertionResponse;
    const authenticatorData = arrayBufferToBase64Url(response.authenticatorData);
    const clientDataJSON = arrayBufferToBase64Url(response.clientDataJSON);
    const signature = arrayBufferToBase64Url(response.signature);
    const userHandle = response.userHandle ? arrayBufferToBase64Url(response.userHandle) : null;
    const rawId = arrayBufferToBase64Url(assertion.rawId);

    const verifyRes = await fetch(getApiUrl('/api/auth/passkey/login-verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: assertion.id,
            credentialId: assertion.id,
            rawId,
            type: assertion.type,
            challengeId: optionsPayload.challengeId || rawOptions.challengeId,
            identifier: cleanIdentifier,
            authenticatorData,
            clientDataJSON,
            signature,
            userHandle,
            response: {
                authenticatorData,
                clientDataJSON,
                signature,
                userHandle,
            },
        }),
    });

    const verifyData = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok || !verifyData.customToken) {
        throw new Error(verifyData.error || 'No se pudo verificar la firma criptografica Passkey.');
    }

    return signInWithCustomToken(auth, verifyData.customToken);
}
