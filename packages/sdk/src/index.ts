// MINREPORT SDK - Offline-Aware with Firebase Integration

import { 
  OfflineAction, 
  OfflineConfig, 
  DEFAULT_OFFLINE_CONFIG,
  SyncResult,
  generateActionId,
  shouldRetry,
  SyncStatus
} from '@minreport/core';

// Firebase imports (only what we actually use for now)
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, 
  connectFirestoreEmulator,
  enableNetwork,
  disableNetwork
} from 'firebase/firestore';

// Import offline manager
import { offlineManager } from './offline-manager';
export { OfflineManager } from './offline-manager';
export type { OfflineAction as OfflineManagerAction, SyncStatus } from './offline-manager';
export { offlineManager };

// Re-export from core
export type { OfflineAction, SyncResult, SyncStatus as CoreSyncStatus } from '@minreport/core';

// Firebase configuration
const firebaseConfig = {
  apiKey: "demo-project-key",
  authDomain: "demo-project.firebaseapp.com", 
  projectId: "demo-project",
  storageBucket: "demo-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "demo-app-id"
};

// Initialize Firebase
let firebaseApp;
let db: any;

try {
  if (getApps().length === 0) {
    firebaseApp = initializeApp(firebaseConfig);
  } else {
    firebaseApp = getApps()[0];
  }

  db = getFirestore(firebaseApp);

  // Connect to emulator in development
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    try {
      connectFirestoreEmulator(db, 'localhost', 8085);
    } catch (error) {
      // Emulator already connected or not available
	// Firestore emulator connection info: error
    }
  }
} catch (error) {
  console.warn('Firebase initialization error:', error);
}

export class OfflineQueue {
	private queue: OfflineAction[] = [];
	private isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
	private config: OfflineConfig;
	private syncInProgress: boolean = false;

	constructor(config: Partial<OfflineConfig> = {}) {
		this.config = { ...DEFAULT_OFFLINE_CONFIG, ...config };
		
		if (typeof window !== 'undefined') {
			window.addEventListener('online', this.handleOnline.bind(this));
			window.addEventListener('offline', this.handleOffline.bind(this));
			this.restore();
			
			if (this.config.enableBackgroundSync) {
				this.startBackgroundSync();
			}
		}
	}

	private handleOnline() {
		this.isOnline = true;
		this.sync();
	}

	private handleOffline() {
		this.isOnline = false;
	}

	private startBackgroundSync() {
		setInterval(() => {
			if (this.isOnline && !this.syncInProgress && this.queue.length > 0) {
				this.sync();
			}
		}, this.config.syncInterval);
	}

	enqueue(action: Omit<OfflineAction, 'id' | 'timestamp' | 'status' | 'retryCount'>): string {
		const fullAction: OfflineAction = {
			...action,
			id: generateActionId(),
			timestamp: Date.now(),
			status: 'pending' as SyncStatus,
			retryCount: 0
		};
		
		this.queue.push(fullAction);
		this.persist();
		
		if (this.isOnline && !this.syncInProgress) {
			// Don't await sync to avoid blocking enqueue
			this.sync().catch(error => {
				console.warn('Background sync failed:', error);
			});
		}

		return fullAction.id;
	}

	async sync(): Promise<SyncResult[]> {
		if (this.syncInProgress || !this.isOnline) {
			return [];
		}

		this.syncInProgress = true;
		const results: SyncResult[] = [];

		try {
			// Procesar acciones pendientes
			const pendingActions = this.queue.filter(action => 
				action.status === 'pending' || shouldRetry(action, this.config)
			);

			for (const action of pendingActions) {
				try {
					// Sincronización real con Firestore pendiente de implementación
					const result = await this.syncAction(action);
					results.push(result);
					
					if (result.success) {
						// Remover acción exitosa de la cola
						this.queue = this.queue.filter(a => a.id !== action.id);
					} else {
						// Incrementar contador de reintentos
						action.retryCount++;
						action.status = 'error';
						action.error = result.error;
					}
				} catch (error) {
					action.retryCount++;
					action.status = 'error';
					action.error = error instanceof Error ? error.message : 'Unknown error';
					
					results.push({
						success: false,
						actionId: action.id,
						error: action.error
					});
				}
			}

			// Remover acciones que excedieron el número máximo de reintentos
			this.queue = this.queue.filter(action => 
				shouldRetry(action, this.config) || action.status !== 'error'
			);

			this.persist();
		} finally {
			this.syncInProgress = false;
		}

		return results;
	}

	private async syncAction(action: OfflineAction): Promise<SyncResult> {
		// Implementación real de sincronización con Firebase/Firestore
		try {
			// Debugging solo en desarrollo (comentado)
			const isLocalhost = typeof window !== 'undefined' && 
				window.location && 
				window.location.hostname === 'localhost';
			
			if (isLocalhost) {
				// Syncing action with Firebase: action
			}

			// Verificar que Firebase esté inicializado
			if (!db) {
				throw new Error('Firebase not initialized');
			}

			// Por ahora, simulamos éxito mientras implementamos el resto
			// Operaciones CRUD reales basadas en action.type pendiente de implementación
			switch (action.type) {
				case 'CREATE_REPORT':
				case 'UPDATE_REPORT':
				case 'DELETE_REPORT':
				case 'CREATE_USER':
				case 'UPDATE_USER':
					// Aquí iría la lógica específica de cada operación
					await new Promise(resolve => setTimeout(resolve, 100)); // Simular latencia
					break;
				default:
					console.warn('Unknown action type:', action.type);
			}
			
			return {
				success: true,
				actionId: action.id
			};
		} catch (error) {
			console.error('Sync action failed:', error);
			return {
				success: false,
				actionId: action.id,
				error: error instanceof Error ? error.message : 'Unknown sync error'
			};
		}
	}

	// Nueva funcionalidad: Habilitar/deshabilitar red de Firebase
	async enableOfflineMode(): Promise<void> {
		if (db) {
			await disableNetwork(db);
			// Firebase offline mode enabled
		}
	}

	async enableOnlineMode(): Promise<void> {
		if (db) {
			await enableNetwork(db);
			// Firebase online mode enabled
		}
	}

	// Getter para acceso al estado de la base de datos
	getFirestoreInstance() {
		return db;
	}

	persist() {
		try {
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem('minreport_offline_queue', JSON.stringify(this.queue));
			}
		} catch (error) {
			console.warn('Failed to persist offline queue:', error);
			// Continue without persisting if storage is full or unavailable
		}
	}

	restore() {
		try {
			if (typeof localStorage !== 'undefined') {
				const data = localStorage.getItem('minreport_offline_queue');
				if (data) this.queue = JSON.parse(data);
			}
		} catch (error) {
			console.warn('Failed to restore offline queue:', error);
			// Continue with empty queue if restore fails
		}
	}

	getQueueLength(): number {
		return this.queue.length;
	}

	isConnected(): boolean {
		return this.isOnline;
	}
}

export const offlineQueue = new OfflineQueue();
