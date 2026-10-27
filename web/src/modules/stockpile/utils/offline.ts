/**
 * Utilidades para manejo de estado offline
 * Detecta conectividad y coordina sincronización con DataService y SyncQueueEngine
 */

import { dataService } from '../services/DataService';

export interface ConnectivityState {
    online: boolean;
    lastOnline: Date | null;
    lastOffline: Date | null;
}

class ConnectivityMonitor {
    private state: ConnectivityState = {
        online: navigator.onLine,
        lastOnline: navigator.onLine ? new Date() : null,
        lastOffline: !navigator.onLine ? new Date() : null,
    };

    private listeners: Set<(state: ConnectivityState) => void> = new Set();

    constructor() {
        this.setupListeners();
    }

    private setupListeners() {
        window.addEventListener('online', this.handleOnline);
        window.addEventListener('offline', this.handleOffline);
    }

    private handleOnline = async () => {
        console.log('[Connectivity] Conexión restaurada');
        this.state = {
            ...this.state,
            online: true,
            lastOnline: new Date(),
        };

        this.notifyListeners();

        try {
            await dataService.syncWithMinReport();
            console.log('[Connectivity] Datos sincronizados con MINREPORT');
        } catch (error) {
            console.error('[Connectivity] Error sincronizando datos:', error);
        }
    };

    private handleOffline = () => {
        console.log('[Connectivity] Conexión perdida - modo autónomo');
        this.state = {
            ...this.state,
            online: false,
            lastOffline: new Date(),
        };

        this.notifyListeners();
    };

    private notifyListeners() {
        this.listeners.forEach((listener) => listener(this.state));
    }

    subscribe(listener: (state: ConnectivityState) => void): () => void {
        this.listeners.add(listener);
        listener(this.state);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getState(): ConnectivityState {
        return { ...this.state };
    }

    isOnline(): boolean {
        return this.state.online;
    }

    destroy() {
        window.removeEventListener('online', this.handleOnline);
        window.removeEventListener('offline', this.handleOffline);
        this.listeners.clear();
    }
}

export const connectivityMonitor = new ConnectivityMonitor();

export const useConnectivity = () => {
    return connectivityMonitor.getState();
};

export class OfflineQueue {
    private queue: Array<() => Promise<void>> = [];
    private processing = false;

    constructor() {
        connectivityMonitor.subscribe((state) => {
            if (state.online && this.queue.length > 0) {
                this.processQueue();
            }
        });
    }

    async enqueue(action: () => Promise<void>): Promise<void> {
        if (connectivityMonitor.isOnline()) {
            return action();
        } else {
            this.queue.push(action);
            console.log(`[OfflineQueue] Acción agregada a cola offline (${this.queue.length} pendientes)`);
        }
    }

    private async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        console.log(`[OfflineQueue] Procesando cola offline (${this.queue.length} acciones)`);

        while (this.queue.length > 0) {
            const action = this.queue.shift();
            if (action) {
                try {
                    await action();
                } catch (error) {
                    console.error('[OfflineQueue] Error procesando acción de cola:', error);
                }
            }
        }

        this.processing = false;
        console.log('[OfflineQueue] Cola offline procesada');
    }

    getPendingCount(): number {
        return this.queue.length;
    }
}

export const offlineQueue = new OfflineQueue();
