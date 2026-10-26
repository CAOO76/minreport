import { auth as coreAuth, db as coreDb, storage as coreStorage } from '../../../config/firebase';
import type { FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider, getToken, CustomProvider, type AppCheck } from 'firebase/app-check';

/**
 * MINREPORT — Módulo OPERMAQ: Configuración Unificada de Firebase
 * Conectado exclusivamente al Core Host MINREPORT (minreport-8f2a8) y sus emuladores en southamerica-west1.
 * Cero duplicidad de instancias y cero desalineación de puertos.
 */

export const auth = coreAuth;
export const db = coreDb;
export const storage = coreStorage;

// Referencia segura a la app centralizada de MINREPORT
const app = (coreAuth as any).app as FirebaseApp;

// APP-CHECK: Seguridad de endpoints (anti-abuse) adaptada a entorno unificado
export const appCheck: AppCheck | null = typeof window !== 'undefined' ? (() => {
  const isLocal = 
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '::1' ||
    window.location.hostname.startsWith('192.168.') || 
    window.location.hostname.startsWith('10.') || 
    window.location.hostname.startsWith('172.') ||
    (window as unknown as Record<string, unknown>).Capacitor;

  const siteKey = (import.meta as any).env?.VITE_RECAPTCHA_SITE_KEY as string;

  if (isLocal) {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_MODE = true;
  }

  try {
    const provider = isLocal || !siteKey
      ? new CustomProvider({
          getToken: async () => ({
            token: 'debug-token',
            expireTimeMillis: Date.now() + 3600 * 1000
          })
        })
      : new ReCaptchaV3Provider(siteKey);

    return initializeAppCheck(app, {
      provider,
      isTokenAutoRefreshEnabled: true
    });
  } catch (_e) {
    return null;
  }
})() : null;

export const getAppCheckToken = async (): Promise<string | null> => {
  if (!appCheck) return null;
  try {
    const result = await getToken(appCheck);
    return result.token;
  } catch (_e) {
    return null;
  }
};

// 4. Configuración de API (Motor OPERMAQ)
// Centralizado en el proyecto MINREPORT (minreport-8f2a8) y su backend unificado en southamerica-west1.
export const API_BASE_URL: string = (import.meta as any).env?.VITE_OPERMAQ_API_URL ||
  (import.meta as any).env?.VITE_API_URL ||
  (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8080/api'
    : '/api');
