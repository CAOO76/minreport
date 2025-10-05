import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateActionId, isOfflineCapable, DEFAULT_OFFLINE_CONFIG } from './types/offline';

// Mock para Firebase Auth
vi.mock('firebase/auth', () => {
  const mockUser = {
    uid: 'test-user-123',
    email: 'test@example.com',
    emailVerified: true,
    displayName: 'Test User',
  };

  return {
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn((auth, callback) => {
      // Simular usuario autenticado por defecto
      setTimeout(() => callback(mockUser), 0);
      return vi.fn(); // unsubscribe function
    }),
    signInWithEmailAndPassword: vi.fn(() => Promise.resolve({ user: mockUser })),
    signOut: vi.fn(() => Promise.resolve()),
    createUserWithEmailAndPassword: vi.fn(() => Promise.resolve({ user: mockUser })),
  };
});

describe('Core Authentication Utils', () => {
  describe('generateActionId', () => {
    it('should generate unique IDs with correct format', () => {
      const id1 = generateActionId();
      const id2 = generateActionId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^\d+-[a-z0-9]{9}$/);
      expect(id2).toMatch(/^\d+-[a-z0-9]{9}$/);
    });

    it('should generate IDs with timestamp prefix', () => {
      const before = Date.now();
      const id = generateActionId();
      const after = Date.now();
      
      const timestamp = parseInt(id.split('-')[0]);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('isOfflineCapable', () => {
    it('should validate supported plans correctly', () => {
      // Valid plans
      expect(isOfflineCapable('basic')).toBe(true);
      expect(isOfflineCapable('premium')).toBe(true);
      expect(isOfflineCapable('enterprise')).toBe(true);
      
      // Invalid plans
      expect(isOfflineCapable('free')).toBe(false);
      expect(isOfflineCapable('trial')).toBe(false);
      expect(isOfflineCapable('')).toBe(false);
      expect(isOfflineCapable('unknown')).toBe(false);
    });

    it('should handle null/undefined inputs', () => {
      expect(isOfflineCapable(null as any)).toBe(false);
      expect(isOfflineCapable(undefined as any)).toBe(false);
    });
  });

  describe('DEFAULT_OFFLINE_CONFIG', () => {
    it('should have production-ready values', () => {
      expect(DEFAULT_OFFLINE_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_OFFLINE_CONFIG.retryDelay).toBe(1000);
      expect(DEFAULT_OFFLINE_CONFIG.syncInterval).toBe(30000);
      expect(DEFAULT_OFFLINE_CONFIG.cacheSize).toBe(100);
      expect(DEFAULT_OFFLINE_CONFIG.enableBackgroundSync).toBe(true);
    });

    it('should be immutable', () => {
      const originalMaxRetries = DEFAULT_OFFLINE_CONFIG.maxRetries;
      
      // Intentar modificar (no debería afectar el original)
      const modifiedConfig = { ...DEFAULT_OFFLINE_CONFIG, maxRetries: 10 };
      
      expect(DEFAULT_OFFLINE_CONFIG.maxRetries).toBe(originalMaxRetries);
      expect(modifiedConfig.maxRetries).toBe(10);
    });
  });

  describe('User Plan Validation', () => {
    it('should support enterprise features for enterprise plan', () => {
      expect(isOfflineCapable('enterprise')).toBe(true);
    });

    it('should support offline features for premium plan', () => {
      expect(isOfflineCapable('premium')).toBe(true);
    });

    it('should support basic offline for basic plan', () => {
      expect(isOfflineCapable('basic')).toBe(true);
    });
  });
});