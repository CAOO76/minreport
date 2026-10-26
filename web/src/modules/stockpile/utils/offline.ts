/**
 * Utilidades para manejo de estado offline
 * Detecta conectividad y maneja cola de sincronización
 */

import { dataService } from '../services/DataService';

/**
 * Estado de conectividad
 */
export interface ConnectivityState {
    online: boolean;
    lastOnline: Date | null;
    lastOffline: Date | null;
}

/**
 * Monitor de conectividad
 */
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

    /**
     * Configurar listeners de eventos de conectividad
     */
    private setupListeners() {
        window.addEventListener('online', this.handleOnline);
        window.addEventListener('offline', this.handleOffline);
    }

    /**
     * Manejar evento de conexión
     */
    private handleOnline = async () => {
        console.log('🟢 Conexión restaurada');
        this.state = {
            ...this.state,
            online: true,
            lastOnline: new Date(),
        };

        this.notifyListeners();

        // Intentar sincronizar datos pendientes
        try {
            await dataService.syncWithMinReport();
            console.log('✅ Datos sincronizados con MINREPORT');
        } catch (error) {
            console.error('❌ Error sincronizando datos:', error);
        }
    };

    /**
     * Manejar evento de desconexión
     */
    private handleOffline = () => {
        console.log('🔴 Conexión perdida - modo offline');
        this.state = {
            ...this.state,
            online: false,
            lastOffline: new Date(),
        };

        this.notifyListeners();
    };

    /**
     * Notificar a todos los listeners
     */
    private notifyListeners() {
        this.listeners.forEach((listener) => listener(this.state));
    }

    /**
     * Suscribirse a cambios de conectividad
     * 
     * @param listener - Función callback
     * @returns Función para desuscribirse
     */
    subscribe(listener: (state: ConnectivityState) => void): () => void {
        this.listeners.add(listener);

        // Notificar estado actual inmediatamente
        listener(this.state);

        // Retornar función de limpieza
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Obtener estado actual
     */
    getState(): ConnectivityState {
        return { ...this.state };
    }

    /**
     * Verificar si está online
     */
    isOnline(): boolean {
        return this.state.online;
    }

    /**
     * Limpiar listeners
     */
    destroy() {
        window.removeEventListener('online', this.handleOnline);
        window.removeEventListener('offline', this.handleOffline);
        this.listeners.clear();
    }
}

// Exportar instancia única
export const connectivityMonitor = new ConnectivityMonitor();

/**
 * Hook personalizado para React (uso futuro)
 */
export const useConnectivity = () => {
    return connectivityMonitor.getState();
};

/**
 * Utilidad para ejecutar una acción solo cuando hay conexión
 * Si no hay conexión, la acción se guarda y se ejecuta cuando se recupere
 */
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

    /**
     * Agregar acción a la cola
     */
    async enqueue(action: () => Promise<void>): Promise<void> {
        if (connectivityMonitor.isOnline()) {
            // Si hay conexión, ejecutar inmediatamente
            return action();
        } else {
            // Sin conexión, agregar a la cola
            this.queue.push(action);
            console.log(`📥 Acción agregada a cola offline (${this.queue.length} pendientes)`);
        }
    }

    /**
     * Procesar cola de acciones pendientes
     */
    private async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        console.log(`⚙️ Procesando cola offline (${this.queue.length} acciones)`);

        while (this.queue.length > 0) {
            const action = this.queue.shift();
            if (action) {
                try {
                    await action();
                } catch (error) {
                    console.error('❌ Error procesando acción de cola:', error);
                }
            }
        }

        this.processing = false;
        console.log('✅ Cola offline procesada');
    }

    /**
     * Obtener número de acciones pendientes
     */
    getPendingCount(): number {
        return this.queue.length;
    }
}

// Exportar instancia única
export const offlineQueue = new OfflineQueue();
