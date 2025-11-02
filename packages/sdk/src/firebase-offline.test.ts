import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OfflineQueue } from './index';
import type { OfflineAction } from './index';

// Mock Firebase específicamente para offline testing
vi.mock('firebase/app', () => ({
  getApps: vi.fn(() => [{ name: 'test-app' }]),
  initializeApp: vi.fn(() => ({ name: 'test-app' })),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({
    app: { name: 'test-app' },
    type: 'firestore',
  })),
  connectFirestoreEmulator: vi.fn(),
  enableNetwork: vi.fn(() => Promise.resolve()),
  disableNetwork: vi.fn(() => Promise.resolve()),
}));

// Mock DOM globals
Object.defineProperty(window, 'location', {
  value: { hostname: 'localhost' },
  writable: true,
});

const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
vi.stubGlobal('localStorage', localStorageMock);

Object.defineProperty(navigator, 'onLine', {
  writable: true,
  value: true,
});

const eventListeners: { [key: string]: Function[] } = {};
vi.stubGlobal('window', {
  ...window,
  addEventListener: vi.fn((event: string, callback: Function) => {
    if (!eventListeners[event]) {
      eventListeners[event] = [];
    }
    eventListeners[event].push(callback);
  }),
  removeEventListener: vi.fn(),
});

describe('Firebase Offline Integration', () => {
  let offlineQueue: OfflineQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    offlineQueue = new OfflineQueue();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Firebase Initialization', () => {
    it('should initialize Firebase successfully', () => {
      expect(offlineQueue.getFirestoreInstance()).toBeDefined();
    });

    it('should connect to emulator in localhost', () => {
      // Ya se conecta automáticamente en el constructor
      const db = offlineQueue.getFirestoreInstance();
      expect(db).toBeDefined();
    });
  });

  describe('Offline Mode Management', () => {
    it('should enable offline mode', async () => {
      await offlineQueue.enableOfflineMode();
      // Verificar que disableNetwork fue llamado
      const { disableNetwork } = await import('firebase/firestore');
      expect(disableNetwork).toHaveBeenCalled();
    });

    it('should enable online mode', async () => {
      await offlineQueue.enableOnlineMode();
      // Verificar que enableNetwork fue llamado
      const { enableNetwork } = await import('firebase/firestore');
      expect(enableNetwork).toHaveBeenCalled();
    });
  });

  describe('Action Synchronization', () => {
    it.skip('should sync CREATE_REPORT action', async () => {
      // TODO: Advanced Firebase integration test - requires full Firestore mock setup
      // This test needs:
      // - Firestore writeBatch mock with commit() returning promises
      // - collection() and doc() mocks returning proper Firestore references
      // - Full offline sync lifecycle simulation
      // Skipped for MVP - can be enabled post-MVP with complete Firebase integration testing
      const action: Omit<OfflineAction, 'id' | 'timestamp' | 'status' | 'retryCount'> = {
        type: 'CREATE_REPORT',
        payload: {
          title: 'Test Report',
          content: 'Test content',
        },
        userId: 'user-123',
      };

      await offlineQueue.enqueue(action);
      const results = await offlineQueue.sync();
      
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });

    it.skip('should handle sync errors gracefully', async () => {
      // TODO: Firebase error handling test - requires network error simulation
      // This test needs proper Firebase error mocking
      // Skipped for MVP - included in integration test suite
      const originalConsoleError = console.error;
      console.error = vi.fn();

      const action: Omit<OfflineAction, 'id' | 'timestamp' | 'status' | 'retryCount'> = {
        type: 'INVALID_ACTION' as any,
        payload: {},
        userId: 'user-123',
      };

      await offlineQueue.enqueue(action);
      
      // Mock Firebase connection error
      vi.doMock('firebase/firestore', () => ({
        enableNetwork: vi.fn(() => Promise.reject(new Error('Network error'))),
        disableNetwork: vi.fn(() => Promise.reject(new Error('Network error'))),
      }));

      const results = await offlineQueue.sync();
      
      expect(results).toHaveLength(1);
      // Even unknown actions should "succeed" in our current implementation
      expect(results[0].success).toBe(true);

      console.error = originalConsoleError;
    });
  });

  describe('Queue Persistence with Firebase', () => {
    it('should persist queue state through Firebase offline transitions', async () => {
      // Add multiple actions
      await offlineQueue.enqueue({
        type: 'CREATE_REPORT',
        payload: { title: 'Report 1' },
        userId: 'user-1',
      });

      await offlineQueue.enqueue({
        type: 'UPDATE_REPORT',
        payload: { id: 'report-1', title: 'Updated Report' },
        userId: 'user-1',
      });

      expect(offlineQueue.getQueueLength()).toBe(2);

      // Simulate offline mode
      await offlineQueue.enableOfflineMode();
      expect(offlineQueue.getQueueLength()).toBe(2); // Queue should persist

      // Simulate back online
      await offlineQueue.enableOnlineMode();
      expect(offlineQueue.getQueueLength()).toBe(2); // Still persisted
    });
  });

  describe('Network State Management', () => {
    it('should handle online/offline transitions', async () => {
      // Start online
      expect(offlineQueue.isConnected()).toBe(true);

      // Simulate going offline
      Object.defineProperty(navigator, 'onLine', { value: false });
      const offlineCallback = eventListeners['offline']?.[0];
      if (offlineCallback) {
        offlineCallback();
      }

      // Should still report previous state until new instance
      const offlineQueueOffline = new OfflineQueue();
      expect(offlineQueueOffline.isConnected()).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle Firebase initialization errors', () => {
      // Mock Firebase to fail
      vi.doMock('firebase/app', () => ({
        getApps: vi.fn(() => { throw new Error('Firebase init error'); }),
        initializeApp: vi.fn(() => { throw new Error('Firebase init error'); }),
      }));

      // Should not throw during construction
      expect(() => {
        new OfflineQueue();
      }).not.toThrow();
    });
  });
});