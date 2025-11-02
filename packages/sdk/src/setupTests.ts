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
