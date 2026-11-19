import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import type { MinReportSession } from '../../context/MinReportSessionContext';
import { offlineStorage } from './OfflineStorage';

const SESSION_SNAPSHOT_KEY = 'minreport_offline_session_v1';
const CAPTURE_DRAFT_PREFIX = 'minreport_capture_draft_v1_';

/**
 * Bóveda de Sesión Persistente Offline-First (Sin bloqueos por turno ni PIN).
 * Redundancia multi-capa: `@capacitor/preferences` (SharedPreferences nativo Android) +
 * `localStorage` + `IndexedDB` (`offlineStorage`) para garantizar ingreso en < 150 ms
 * tras reiniciar o suspender la app bajo tierra o en rajo abierto con 0% señal.
 */
export async function saveOfflineSessionSnapshot(session: MinReportSession): Promise<void> {
    if (!session || !session.uid) return;
    const serialized = JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        session,
    });

    if (typeof window !== 'undefined') {
        try {
            window.localStorage.setItem(SESSION_SNAPSHOT_KEY, serialized);
        } catch {
            // Almacenamiento local restringido
        }
    }

    try {
        await offlineStorage.putOfflineMetadata(SESSION_SNAPSHOT_KEY, serialized);
    } catch {
        // Entorno sin IndexedDB
    }

    if (Capacitor.isNativePlatform()) {
        try {
            await Preferences.set({
                key: SESSION_SNAPSHOT_KEY,
                value: serialized,
            });
        } catch {
            // Fallback a localStorage/IndexedDB ya persistido
        }
    }

    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('minreport:offline-session-updated', { detail: { session } })
        );
    }
}

function parseSerializedSnapshot(raw: string | null | undefined): MinReportSession | null {
    if (!raw || typeof raw !== 'string') return null;
    try {
        const parsed = JSON.parse(raw) as {
            version?: number;
            session?: MinReportSession;
        };
        if (parsed?.session && typeof parsed.session.uid === 'string' && parsed.session.uid) {
            return parsed.session;
        }
    } catch {
        // Snapshot corrupto ignorado
    }
    return null;
}

export async function loadOfflineSessionSnapshot(): Promise<MinReportSession | null> {
    if (Capacitor.isNativePlatform()) {
        try {
            const pref = await Preferences.get({ key: SESSION_SNAPSHOT_KEY });
            const fromPref = parseSerializedSnapshot(pref.value);
            if (fromPref) return fromPref;
        } catch {
            // Fallback a localStorage / IndexedDB
        }
    }

    if (typeof window !== 'undefined') {
        try {
            const fromLs = parseSerializedSnapshot(window.localStorage.getItem(SESSION_SNAPSHOT_KEY));
            if (fromLs) return fromLs;
        } catch {
            // Ignorar
        }
    }

    try {
        const fromIdb = await offlineStorage.getOfflineMetadata<string>(SESSION_SNAPSHOT_KEY);
        return parseSerializedSnapshot(fromIdb);
    } catch {
        return null;
    }
}

export async function clearOfflineSessionSnapshot(): Promise<void> {
    if (typeof window !== 'undefined') {
        try {
            window.localStorage.removeItem(SESSION_SNAPSHOT_KEY);
        } catch {
            // Ignorar
        }
    }

    try {
        await offlineStorage.putOfflineMetadata(SESSION_SNAPSHOT_KEY, null);
    } catch {
        // Ignorar
    }

    if (Capacitor.isNativePlatform()) {
        try {
            await Preferences.remove({ key: SESSION_SNAPSHOT_KEY });
        } catch {
            // Ignorar
        }
    }

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('minreport:offline-session-cleared'));
    }
}

export function saveCaptureDraft<T>(draftKey: string, value: T): void {
    if (typeof window === 'undefined' || !draftKey) return;
    try {
        window.localStorage.setItem(
            `${CAPTURE_DRAFT_PREFIX}${draftKey}`,
            JSON.stringify({ updatedAt: Date.now(), value })
        );
    } catch {
        // Quota o entorno restringido
    }
}

export function loadCaptureDraft<T>(draftKey: string): T | null {
    if (typeof window === 'undefined' || !draftKey) return null;
    try {
        const raw = window.localStorage.getItem(`${CAPTURE_DRAFT_PREFIX}${draftKey}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { value?: T };
        return parsed?.value ?? null;
    } catch {
        return null;
    }
}

export function clearCaptureDraft(draftKey: string): void {
    if (typeof window === 'undefined' || !draftKey) return;
    try {
        window.localStorage.removeItem(`${CAPTURE_DRAFT_PREFIX}${draftKey}`);
    } catch {
        // Ignorar
    }
}
