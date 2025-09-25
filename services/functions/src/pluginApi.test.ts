import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleSavePluginData, handleUpdateUserPluginClaims, handleGetUserPluginClaims } from './pluginApi';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { DecodedIdToken } from 'firebase-admin/auth';

// Create fake dependencies
const createFakeAuth = () => ({
  getUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
  revokeRefreshTokens: vi.fn(),
});

const createFakeDb = () => ({
  doc: vi.fn().mockReturnThis(),
  set: vi.fn(),
});


describe('pluginApi Handlers', () => {
  let fakeAuth: any;
  let fakeDb: any;

  beforeEach(() => {
    fakeAuth = createFakeAuth();
    fakeDb = createFakeDb();
    vi.clearAllMocks();
  });

  describe('handleSavePluginData', () => {
    it('should save data for an authenticated user', async () => {
      const request = {
        data: { pluginId: 'pluginA', data: { setting: 'value' } },
        auth: { uid: 'user1' },
      } as CallableRequest<{ pluginId: string; data: any; }>;

      fakeDb.set.mockResolvedValue(undefined);

      await handleSavePluginData(fakeDb as any, request);
      expect(fakeDb.doc).toHaveBeenCalledWith('plugin_data/user1/pluginA/user_data');
      expect(fakeDb.set).toHaveBeenCalledWith(expect.objectContaining({ setting: 'value' }), { merge: true });
    });

    it('should throw if not authenticated', async () => {
        const request = { data: { pluginId: 'pluginA', data: {} } } as CallableRequest<{ pluginId: string; data: any; }>;
        await expect(handleSavePluginData(fakeDb as any, request)).rejects.toThrow(/must be called while authenticated/);
    });
  });

  describe('handleUpdateUserPluginClaims', () => {
    it('should be denied if caller is not admin', async () => {
      const request = {
        data: { userId: 'user1', pluginId: 'pluginB', isActive: true },
        auth: { uid: 'not-admin-uid', token: { admin: false } as DecodedIdToken },
      } as CallableRequest<{ userId: string; pluginId: string; isActive: boolean; }>;

      await expect(handleUpdateUserPluginClaims(fakeAuth as any, request)).rejects.toThrow(/Only administrators can perform this action/);
    });

    it('should allow admin to activate a plugin', async () => {
        fakeAuth.getUser.mockResolvedValue({ customClaims: { adminActivatedPlugins: [] } });
        const request = {
            data: { userId: 'user-no-claims', pluginId: 'pluginB', isActive: true },
            auth: { uid: 'admin-uid', token: { admin: true } as DecodedIdToken },
        } as CallableRequest<{ userId: string; pluginId: string; isActive: boolean; }>;

        await handleUpdateUserPluginClaims(fakeAuth as any, request);
        expect(fakeAuth.setCustomUserClaims).toHaveBeenCalledWith('user-no-claims', { adminActivatedPlugins: ['pluginB'] });
    });

    it('should allow admin to deactivate a plugin', async () => {
        fakeAuth.getUser.mockResolvedValue({ customClaims: { adminActivatedPlugins: ['pluginA', 'pluginC'] } });
        const request = {
            data: { userId: 'user1', pluginId: 'pluginA', isActive: false },
            auth: { uid: 'admin-uid', token: { admin: true } as DecodedIdToken },
        } as CallableRequest<{ userId: string; pluginId: string; isActive: boolean; }>;

        await handleUpdateUserPluginClaims(fakeAuth as any, request);
        expect(fakeAuth.setCustomUserClaims).toHaveBeenCalledWith('user1', { adminActivatedPlugins: ['pluginC'] });
    });
  });

  describe('handleGetUserPluginClaims', () => {
    it('should be denied if caller is not admin', async () => {
        const request = {
            data: { userId: 'user1' },
            auth: { uid: 'not-admin-uid', token: { admin: false } as DecodedIdToken },
        } as CallableRequest<{ userId: string; }>;
        await expect(handleGetUserPluginClaims(fakeAuth as any, request)).rejects.toThrow(/Only administrators can perform this action/);
    });

    it('should return plugins for a user', async () => {
        fakeAuth.getUser.mockResolvedValue({ customClaims: { adminActivatedPlugins: ['pluginA', 'pluginC'] } });
        const request = {
            data: { userId: 'user1' },
            auth: { uid: 'admin-uid', token: { admin: true } as DecodedIdToken },
        } as CallableRequest<{ userId: string; }>;

        const result = await handleGetUserPluginClaims(fakeAuth as any, request);
        expect(result).toEqual({ adminActivatedPlugins: ['pluginA', 'pluginC'] });
    });
  });
});
