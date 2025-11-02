import { vi } from 'vitest';

// Mock IndexedDB
const mockIndexedDB = {
  open: vi.fn((dbName: string, version: number) => ({
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    result: {
      createObjectStore: vi.fn(),
      transaction: vi.fn(),
    },
  })),
  deleteDatabase: vi.fn(),
};

Object.defineProperty(window, 'indexedDB', {
  writable: true,
  value: mockIndexedDB,
});

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

// Mock Firebase/Firestore BEFORE any other imports
const mockDb = { _isFirebaseDatabase: true };

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ 
    name: 'test-app',
    automaticDataCollectionEnabled: false,
  })),
  getApps: vi.fn(() => []),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => mockDb),
  connectFirestoreEmulator: vi.fn(),
  enableNetwork: vi.fn(() => Promise.resolve()),
  disableNetwork: vi.fn(() => Promise.resolve()),
  writeBatch: vi.fn((db: any) => {
    const batch: any = {
      set: vi.fn(function(this: any) { return this; }),
      update: vi.fn(function(this: any) { return this; }),
      delete: vi.fn(function(this: any) { return this; }),
      commit: vi.fn(() => Promise.resolve()),
    };
    return batch;
  }),
  collection: vi.fn(() => ({ 
    doc: vi.fn(() => ({})) 
  })),
  doc: vi.fn(() => ({})),
  addDoc: vi.fn(() => Promise.resolve({ id: 'doc-123' })),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));
