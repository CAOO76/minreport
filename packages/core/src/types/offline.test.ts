import { describe, it, expect } from 'vitest';
import { 
  OfflineError, 
  SyncConflictError, 
  generateActionId, 
  isOfflineCapable,
  shouldRetry,
  DEFAULT_OFFLINE_CONFIG,
  type OfflineAction,
  type SyncStatus
} from './offline';

describe('Offline Types', () => {
  describe('OfflineError', () => {
    it('should create OfflineError with correct properties', () => {
      const error = new OfflineError('Network failed', 'NETWORK_ERROR', 'action-123');
      
      expect(error.message).toBe('Network failed');
      expect(error.name).toBe('OfflineError');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.actionId).toBe('action-123');
      expect(error instanceof Error).toBe(true);
    });

    it('should work without actionId', () => {
      const error = new OfflineError('Connection timeout', 'TIMEOUT');
      
      expect(error.message).toBe('Connection timeout');
      expect(error.code).toBe('TIMEOUT');
      expect(error.actionId).toBeUndefined();
      expect(error.stack).toBeDefined();
    });
  });

  describe('SyncConflictError', () => {
    it('should create SyncConflictError with conflict data', () => {
      const serverData = { id: '1', name: 'Server Version', version: 2 };
      const clientData = { id: '1', name: 'Client Version', version: 1 };
      
      const error = new SyncConflictError('Sync conflict detected', serverData, clientData, 'action-456');
      
      expect(error.message).toBe('Sync conflict detected');
      expect(error.name).toBe('SyncConflictError');
      expect(error.code).toBe('SYNC_CONFLICT');
      expect(error.serverData).toEqual(serverData);
      expect(error.clientData).toEqual(clientData);
      expect(error.actionId).toBe('action-456');
      expect(error instanceof OfflineError).toBe(true);
    });

    it('should work without actionId', () => {
      const serverData = { id: '2', status: 'active' };
      const clientData = { id: '2', status: 'inactive' };
      
      const error = new SyncConflictError('Version conflict', serverData, clientData);
      
      expect(error.serverData).toEqual(serverData);
      expect(error.clientData).toEqual(clientData);
      expect(error.actionId).toBeUndefined();
    });
  });

  describe('Utility Functions', () => {
    describe('generateActionId', () => {
      it('should generate unique action IDs', () => {
        const id1 = generateActionId();
        const id2 = generateActionId();
        
        expect(id1).not.toBe(id2);
        expect(typeof id1).toBe('string');
        expect(id1.length).toBeGreaterThan(10);
      });
    });

    describe('isOfflineCapable', () => {
      it('should return true for supported plans', () => {
        expect(isOfflineCapable('basic')).toBe(true);
        expect(isOfflineCapable('premium')).toBe(true);
        expect(isOfflineCapable('enterprise')).toBe(true);
      });

      it('should return false for unsupported plans', () => {
        expect(isOfflineCapable('free')).toBe(false);
        expect(isOfflineCapable('trial')).toBe(false);
        expect(isOfflineCapable('')).toBe(false);
      });
    });

    describe('shouldRetry', () => {
      it('should return true when retries are available and status is error', () => {
        const action: OfflineAction = {
          id: 'test-action',
          type: 'CREATE',
          payload: {},
          timestamp: Date.now(),
          userId: 'user-123',
          status: 'error' as SyncStatus,
          retryCount: 1
        };

        expect(shouldRetry(action, DEFAULT_OFFLINE_CONFIG)).toBe(true);
      });

      it('should return false when max retries reached', () => {
        const action: OfflineAction = {
          id: 'test-action',
          type: 'UPDATE',
          payload: {},
          timestamp: Date.now(),
          userId: 'user-123',
          status: 'error' as SyncStatus,
          retryCount: 3
        };

        expect(shouldRetry(action, DEFAULT_OFFLINE_CONFIG)).toBe(false);
      });

      it('should return false when status is not error', () => {
        const action: OfflineAction = {
          id: 'test-action',
          type: 'DELETE',
          payload: {},
          timestamp: Date.now(),
          userId: 'user-123',
          status: 'synced' as SyncStatus,
          retryCount: 0
        };

        expect(shouldRetry(action, DEFAULT_OFFLINE_CONFIG)).toBe(false);
      });
    });
  });

  describe('DEFAULT_OFFLINE_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_OFFLINE_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_OFFLINE_CONFIG.retryDelay).toBe(1000);
      expect(DEFAULT_OFFLINE_CONFIG.syncInterval).toBe(30000);
      expect(DEFAULT_OFFLINE_CONFIG.cacheSize).toBe(100);
      expect(DEFAULT_OFFLINE_CONFIG.enableBackgroundSync).toBe(true);
    });
  });
});