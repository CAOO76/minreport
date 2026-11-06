import { app as coreApp, auth as coreAuth, db as coreDb, storage as coreStorage } from '../../../config/firebase';

/**
 * MINREPORT — Módulo Funcional OPERMAQ: Configuración Unificada de Firebase
 * Subordinada 100% al Host Core MINREPORT (cero initializeApp/initializeAppCheck duplicado).
 */

export const app = coreApp;
export const auth = coreAuth;
export const db = coreDb;
export const storage = coreStorage;

export function setOpermaqActiveAccountId(accountId: string | null): void {
    if (typeof window === 'undefined') return;
    const clean = accountId?.trim() || '';
    if (clean && clean !== 'faena-minreport') {
        (window as unknown as Record<string, unknown>).__MINREPORT_ACTIVE_TENANT_ID__ = clean;
        localStorage.setItem('minreport_active_account_id', clean);
    } else {
        delete (window as unknown as Record<string, unknown>).__MINREPORT_ACTIVE_TENANT_ID__;
        localStorage.removeItem('minreport_active_account_id');
    }
}

export function getOpermaqActiveAccountId(): string | null {
    if (typeof window === 'undefined') return null;
    const winId = (window as unknown as Record<string, unknown>).__MINREPORT_ACTIVE_TENANT_ID__;
    if (typeof winId === 'string' && winId.trim() && winId.trim() !== 'faena-minreport') {
        return winId.trim();
    }
    const stored = localStorage.getItem('minreport_active_account_id')?.trim();
    if (stored === 'faena-minreport') {
        localStorage.removeItem('minreport_active_account_id');
        return null;
    }
    return stored ? stored : null;
}

const rawApiBase: string =
    (import.meta as any).env?.VITE_OPERMAQ_API_URL ||
    (import.meta as any).env?.VITE_API_URL ||
    '/api';

export const API_BASE_URL: string = rawApiBase.endsWith('/api')
    ? rawApiBase
    : `${rawApiBase.replace(/\/+$/, '')}/api`;
