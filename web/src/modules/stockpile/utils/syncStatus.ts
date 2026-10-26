import { useState, useEffect } from 'react';

export type SyncStatus = 'idle' | 'uploading' | 'syncing' | 'success' | 'error' | 'offline';

interface SyncState {
    status: SyncStatus;
    lastSync: Date | null;
    message?: string;
}

let currentState: SyncState = {
    status: 'idle',
    lastSync: null
};

const listeners = new Set<(state: SyncState) => void>();

export const setSyncStatus = (status: SyncStatus, message?: string) => {
    currentState = {
        ...currentState,
        status,
        message,
        lastSync: status === 'success' ? new Date() : currentState.lastSync
    };
    listeners.forEach(l => l(currentState));
};

export const getSyncStatus = () => currentState;

export const useSyncStatus = () => {
    const [state, setState] = useState(currentState);

    useEffect(() => {
        const listener = (newState: SyncState) => setState(newState);
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, []);

    return state;
};
