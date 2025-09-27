import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleSavePluginData, handleUpdateUserPluginClaims, handleGetUserPluginClaims } from './pluginApi';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { DecodedIdToken } from 'firebase-admin/auth';

// Mock firebase-admin modules
vi.mock('firebase-admin/firestore');
vi.mock('firebase-admin/auth');

import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Define interfaces for fake Firebase Admin SDK objects
interface FakeAuth {
  getUser: ReturnType<typeof vi.fn>;
  setCustomUserClaims: ReturnType<typeof vi.fn>;
  revokeRefreshTokens: ReturnType<typeof vi.fn>;
}

interface FakeDb {
  doc: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}

// Create fake implementations for the mocked functions
const createFakeAuth = (): FakeAuth => ({
  getUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
  revokeRefreshTokens: vi.fn(),
});

const createFakeDb = (): FakeDb => ({
  doc: vi.fn().mockReturnThis(),
  set: vi.fn(),
});

// Helper function to create a mock CallableRequest
const createMockRequest = <T>(data: T, authUid?: string, isAdmin: boolean = false, customClaims?: Record<string, any>): CallableRequest<T> => ({
  data,
  auth: authUid ? { uid: authUid, token: { admin: isAdmin, ...customClaims } as DecodedIdToken } : undefined,
});


describe('pluginApi Handlers', () => {
  let fakeAuth: any;
  let fakeDb: any;

  beforeEach(() => {
    fakeAuth = createFakeAuth();
    fakeDb = createFakeDb();
    vi.clearAllMocks();
    getFirestore.mockReturnValue(fakeDb);
    getAuth.mockReturnValue(fakeAuth);
  });

  describe('handleSavePluginData', () => {
    it('should save data for an authenticated user', async () => {
      const request = createMockRequest({ pluginId: 'pluginA', data: { setting: 'value' } }, 'user1');

      fakeDb.set.mockResolvedValue(undefined);

      await handleSavePluginData(request);
      expect(fakeDb.doc).toHaveBeenCalledWith('plugin_data/user1/pluginA/user_data');
      expect(fakeDb.set).toHaveBeenCalledWith(expect.objectContaining({ setting: 'value' }), { merge: true });
    });

    it('should throw if not authenticated', async () => {
        const request = createMockRequest({ pluginId: 'pluginA', data: {} });
        await expect(handleSavePluginData(request)).rejects.toThrow(/La función debe ser llamada con autenticación./);
    });
  });

  describe('handleUpdateUserPluginClaims', () => {
    it('should be denied if caller is not admin', async () => {
      const request = createMockRequest({ userId: 'user1', pluginId: 'pluginB', isActive: true }, 'not-admin-uid', false);

      await expect(handleUpdateUserPluginClaims(request)).rejects.toThrow(/Solo los administradores pueden realizar esta acción./);
    });

    it('should allow admin to activate a plugin', async () => {
        fakeAuth.getUser.mockResolvedValue({ customClaims: { adminActivatedPlugins: [] } });
        const request = createMockRequest({ userId: 'user-no-claims', pluginId: 'pluginB', isActive: true }, 'admin-uid', true);

        await handleUpdateUserPluginClaims(request);
        expect(fakeAuth.setCustomUserClaims).toHaveBeenCalledWith('user-no-claims', { adminActivatedPlugins: ['pluginB'] });
    });

    it('should allow admin to deactivate a plugin', async () => {
        fakeAuth.getUser.mockResolvedValue({ customClaims: { adminActivatedPlugins: ['pluginA', 'pluginC'] } });
        const request = createMockRequest({ userId: 'user1', pluginId: 'pluginA', isActive: false }, 'admin-uid', true, { adminActivatedPlugins: ['pluginA', 'pluginC'] });

        await handleUpdateUserPluginClaims(request);
        expect(fakeAuth.setCustomUserClaims).toHaveBeenCalledWith('user1', { adminActivatedPlugins: ['pluginC'] });
    });
  });

  describe('handleGetUserPluginClaims', () => {
    it('should be denied if caller is not admin', async () => {
        const request = createMockRequest({ userId: 'user1' }, 'not-admin-uid', false);
        await expect(handleGetUserPluginClaims(request)).rejects.toThrow(/Solo los administradores pueden realizar esta acción./);
    });

    it('should return plugins for a user', async () => {
        fakeAuth.getUser.mockResolvedValue({ customClaims: { adminActivatedPlugins: ['pluginA', 'pluginC'] } });
        const request = createMockRequest({ userId: 'user1' }, 'admin-uid', true);

        const result = await handleGetUserPluginClaims(request);
        expect(result).toEqual({ adminActivatedPlugins: ['pluginA', 'pluginC'] });
    });
  });
});
