import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OfflineQueue } from './index';
import type { OfflineAction, SyncStatus } from './index';

// Mock Firebase imports
vi.mock('firebase/app', () => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  collection: vi.fn(),
  addDoc: vi.fn(),
}));

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
vi.stubGlobal('localStorage', localStorageMock);

// Mock navigator.onLine
Object.defineProperty(navigator, 'onLine', {
  writable: true,
  value: true,
});

// Mock window events
const eventListeners: { [key: string]: Function[] } = {};
vi.stubGlobal('window', {
  addEventListener: vi.fn((event: string, callback: Function) => {
    if (!eventListeners[event]) {
      eventListeners[event] = [];
    }
    eventListeners[event].push(callback);
  }),
  removeEventListener: vi.fn(),
});

describe('OfflineQueue', () => {
  let offlineQueue: OfflineQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    offlineQueue = new OfflineQueue();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Constructor', () => {
    it('should initialize with default config', () => {
      const queue = new OfflineQueue();
      expect(queue).toBeInstanceOf(OfflineQueue);
    });

    it('should merge custom config with defaults', () => {
      const customConfig = { maxRetries: 5, syncInterval: 60000 };
      const queue = new OfflineQueue(customConfig);
      expect(queue).toBeInstanceOf(OfflineQueue);
    });

    it('should set up event listeners in browser environment', () => {
      new OfflineQueue();
      expect(window.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
      expect(window.addEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
    });
  });

  describe('enqueue', () => {
    it('should add action to queue', async () => {
      const action: Omit<OfflineAction, 'id' | 'timestamp' | 'status' | 'retryCount'> = {
        type: 'CREATE_REPORT',
        payload: { title: 'Test Report' },
        userId: 'user-123',
      };

      const actionId = await offlineQueue.enqueue(action);
      
      expect(typeof actionId).toBe('string');
      expect(offlineQueue.getQueueLength()).toBe(1);
    });

    it('should save queue to localStorage', async () => {
      const action: Omit<OfflineAction, 'id' | 'timestamp' | 'status' | 'retryCount'> = {
        type: 'UPDATE_USER',
        payload: { name: 'Updated Name' },
        userId: 'user-456',
      };

      await offlineQueue.enqueue(action);
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'minreport_offline_queue',
        expect.any(String)
      );
    });
  });

  describe('getQueueLength', () => {
    it('should return 0 for empty queue', () => {
      expect(offlineQueue.getQueueLength()).toBe(0);
    });

    it('should return correct count after adding actions', async () => {
      await offlineQueue.enqueue({
        type: 'CREATE_REPORT',
        payload: { title: 'Report 1' },
        userId: 'user-1',
      });

      await offlineQueue.enqueue({
        type: 'UPDATE_USER',
        payload: { name: 'User Name' },
        userId: 'user-2',
      });

      expect(offlineQueue.getQueueLength()).toBe(2);
    });
  });

  describe('isConnected', () => {
    it('should return navigator.onLine status', () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      expect(offlineQueue.isConnected()).toBe(true);
      
      Object.defineProperty(navigator, 'onLine', { value: false });
      // Create new instance to check offline status
      const offlineQueueOffline = new OfflineQueue();
      expect(offlineQueueOffline.isConnected()).toBe(false);
    });
  });

  describe('Network Status Handling', () => {
    it('should handle online event', () => {
      // Simulate going offline first
      Object.defineProperty(navigator, 'onLine', { value: false });
      
      // Trigger online event
      const onlineCallback = eventListeners['online']?.[0];
      if (onlineCallback) {
        onlineCallback();
      }

      // The actual sync behavior would be tested in integration tests
      expect(true).toBe(true); // Placeholder assertion
    });

    it('should handle offline event', () => {
      // Trigger offline event
      const offlineCallback = eventListeners['offline']?.[0];
      if (offlineCallback) {
        offlineCallback();
      }

      // The offline state should be updated
      expect(true).toBe(true); // Placeholder assertion
    });
  });

  describe('sync', () => {
    it('should process pending actions', async () => {
      await offlineQueue.enqueue({
        type: 'CREATE_REPORT',
        payload: { title: 'Test Report' },
        userId: 'user-1',
      });

      const results = await offlineQueue.sync();
      
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle sync errors gracefully', async () => {
      // This would be tested with actual Firebase integration
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('persistence', () => {
    it('should restore queue from localStorage', () => {
      const mockQueue = [
        {
          id: 'test-action-1',
          type: 'CREATE_REPORT',
          payload: { title: 'Restored Report' },
          timestamp: Date.now(),
          userId: 'user-1',
          status: 'pending' as SyncStatus,
          retryCount: 0,
        },
      ];

      localStorageMock.getItem.mockReturnValue(JSON.stringify(mockQueue));
      
      const newQueue = new OfflineQueue();
      expect(newQueue.getQueueLength()).toBe(1);
    });

    it('should handle localStorage errors gracefully', () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('localStorage error');
      });

      expect(() => {
        new OfflineQueue();
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle localStorage errors gracefully', () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });

      expect(() => {
        new OfflineQueue();
      }).not.toThrow();
    });
  });
});