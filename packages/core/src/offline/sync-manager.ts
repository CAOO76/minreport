/**
 * Offline Synchronization Manager
 * Handles data synchronization between local and cloud
 */

import type { OfflineDataRecord, SyncQueue } from './offline-database';

export interface SyncManager {
  // Synchronization
  syncWithCloud(): Promise<boolean>;
  isSyncing(): boolean;
  getLastSyncTime(): number | null;
  getSyncStatus(): 'idle' | 'syncing' | 'error';
  
  // Queue management
  getQueuedOperations(): Promise<OfflineDataRecord[]>;
  clearFailedOperations(): Promise<void>;
  retryFailedOperations(): Promise<void>;
  
  // Connection monitoring
  isOnline(): boolean;
  onOnline(callback: () => void): void;
  onOffline(callback: () => void): void;
  onSync(callback: (status: 'success' | 'error', message?: string) => void): void;
}

/**
 * Cloud Sync implementation
 */
export class CloudSyncManager implements SyncManager {
  private syncing = false;
  private lastSyncTime: number | null = null;
  private syncStatus: 'idle' | 'syncing' | 'error' = 'idle';
  private onlineCallbacks: Array<() => void> = [];
  private offlineCallbacks: Array<() => void> = [];
  private syncCallbacks: Array<(status: 'success' | 'error', message?: string) => void> = [];
  private syncInterval: NodeJS.Timeout | null = null;

  constructor(private offlineDb: any) {
    this.setupConnectionMonitoring();
  }

  private setupConnectionMonitoring(): void {
    // Monitor online/offline events
    window.addEventListener('online', () => {
      this.onOnlineHandler();
    });

    window.addEventListener('offline', () => {
      this.onOfflineHandler();
    });

    // Initial status
    if (!navigator.onLine) {
      this.onOfflineHandler();
    }
  }

  private onOnlineHandler(): void {
    console.log('🟢 Application is online - initiating sync');
    this.onlineCallbacks.forEach(cb => cb());
    this.syncWithCloud().catch(err => {
      console.error('Sync failed after going online:', err);
    });
  }

  private onOfflineHandler(): void {
    console.log('🔴 Application is offline - operations queued');
    this.offlineCallbacks.forEach(cb => cb());
  }

  async syncWithCloud(): Promise<boolean> {
    if (this.syncing || !navigator.onLine) {
      return false;
    }

    this.syncing = true;
    this.syncStatus = 'syncing';

    try {
      const queue = await this.offlineDb.getSyncQueue();

      if (queue.length === 0) {
        this.syncStatus = 'idle';
        this.lastSyncTime = Date.now();
        return true;
      }

      console.log(`📤 Syncing ${queue.length} operations with cloud`);

      let successCount = 0;
      let errorCount = 0;

      for (const item of queue) {
        try {
          await this.syncOperation(item);
          await this.offlineDb.removeSyncQueueItem(item.id);
          successCount++;
        } catch (error) {
          console.error(`Failed to sync operation ${item.id}:`, error);
          errorCount++;
          
          // Increment retry counter
          item.operation.retries++;
          if (item.operation.retries > 3) {
            await this.offlineDb.removeSyncQueueItem(item.id);
          }
        }
      }

      this.syncStatus = 'idle';
      this.lastSyncTime = Date.now();

      const message = `Synced ${successCount} operations${errorCount > 0 ? `, ${errorCount} failed` : ''}`;
      this.syncCallbacks.forEach(cb => cb(errorCount === 0 ? 'success' : 'error', message));

      return errorCount === 0;
    } catch (error) {
      console.error('Sync failed:', error);
      this.syncStatus = 'error';
      this.syncCallbacks.forEach(cb => cb('error', String(error)));
      return false;
    } finally {
      this.syncing = false;
    }
  }

  private async syncOperation(item: SyncQueue): Promise<void> {
    const { operation } = item;

    // Implement actual sync logic based on operation type
    switch (operation.operation) {
      case 'create':
        // POST to cloud
        await this.uploadCreate(operation);
        break;
      case 'update':
        // PUT to cloud
        await this.uploadUpdate(operation);
        break;
      case 'delete':
        // DELETE to cloud
        await this.uploadDelete(operation);
        break;
    }
  }

  private async uploadCreate(record: OfflineDataRecord): Promise<void> {
    // This would be implemented with actual API calls
    // For now, simulating the operation
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(`✅ Created ${record.collection}:${record.id}`);
  }

  private async uploadUpdate(record: OfflineDataRecord): Promise<void> {
    // This would be implemented with actual API calls
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(`✅ Updated ${record.collection}:${record.id}`);
  }

  private async uploadDelete(record: OfflineDataRecord): Promise<void> {
    // This would be implemented with actual API calls
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(`✅ Deleted ${record.collection}:${record.id}`);
  }

  isSyncing(): boolean {
    return this.syncing;
  }

  getLastSyncTime(): number | null {
    return this.lastSyncTime;
  }

  getSyncStatus(): 'idle' | 'syncing' | 'error' {
    return this.syncStatus;
  }

  async getQueuedOperations(): Promise<OfflineDataRecord[]> {
    const queue = await this.offlineDb.getSyncQueue();
    return queue.map((item: SyncQueue) => item.operation);
  }

  async clearFailedOperations(): Promise<void> {
    const queue = await this.offlineDb.getSyncQueue();
    for (const item of queue) {
      if (item.status === 'failed' || item.operation.retries > 3) {
        await this.offlineDb.removeSyncQueueItem(item.id);
      }
    }
  }

  async retryFailedOperations(): Promise<void> {
    await this.syncWithCloud();
  }

  isOnline(): boolean {
    return navigator.onLine;
  }

  onOnline(callback: () => void): void {
    this.onlineCallbacks.push(callback);
  }

  onOffline(callback: () => void): void {
    this.offlineCallbacks.push(callback);
  }

  onSync(callback: (status: 'success' | 'error', message?: string) => void): void {
    this.syncCallbacks.push(callback);
  }

  /**
   * Start automatic sync at intervals
   */
  startAutoSync(intervalMs: number = 30000): void {
    if (this.syncInterval) return;

    this.syncInterval = setInterval(() => {
      if (navigator.onLine && !this.syncing) {
        this.syncWithCloud().catch(err => {
          console.error('Auto-sync failed:', err);
        });
      }
    }, intervalMs);

    console.log(`⏱️ Auto-sync started (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop automatic sync
   */
  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('⏹️ Auto-sync stopped');
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.stopAutoSync();
    this.onlineCallbacks = [];
    this.offlineCallbacks = [];
    this.syncCallbacks = [];
  }
}
