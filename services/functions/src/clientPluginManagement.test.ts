import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleManageClientPlugins } from './clientPluginManagement';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { DecodedIdToken } from 'firebase-admin/auth';

// Create fake dependencies
const createFakeAuth = () => ({
  getUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
  revokeRefreshTokens: vi.fn(),
});

const createFakeDb = () => ({
  collection: vi.fn().mockReturnThis(),
  doc: vi.fn().mockReturnThis(),
  runTransaction: vi.fn(),
});

describe('handleManageClientPlugins', () => {
  let fakeAuth: any;
  let fakeDb: any;

  beforeEach(() => {
    fakeAuth = createFakeAuth();
    fakeDb = createFakeDb();
    vi.clearAllMocks();
  });

  it('should throw permission-denied if user is not an admin', async () => {
    fakeAuth.getUser.mockResolvedValue({ customClaims: { admin: false } });
    const request = {
      data: { accountId: 'acc1', pluginId: 'pluginA', action: 'activate' },
      auth: { uid: 'non-admin-uid' },
    } as CallableRequest<{ accountId: string; pluginId: string; action: 'activate' | 'deactivate' }>;

    await expect(handleManageClientPlugins(fakeDb, fakeAuth, request)).rejects.toThrow(/Solo los administradores pueden realizar esta acción/);
  });

  it('should activate a plugin', async () => {
    fakeAuth.getUser.mockResolvedValue({ customClaims: { admin: true } });
    fakeDb.runTransaction.mockImplementation(async (updateFunction: any) => {
      const mockTransaction = {
        get: vi.fn().mockResolvedValue({ 
          exists: true, 
          data: () => ({ adminActivatedPlugins: [] }),
        }),
        update: vi.fn(),
      };
      await updateFunction(mockTransaction);
    });

    const request = {
      auth: { uid: 'admin-uid' },
      data: { accountId: 'acc1', pluginId: 'pluginA', action: 'activate' },
    } as CallableRequest<{ accountId: string; pluginId: string; action: 'activate' | 'deactivate' }>;

    await handleManageClientPlugins(fakeDb, fakeAuth, request);

    expect(fakeAuth.setCustomUserClaims).toHaveBeenCalledWith('acc1', { adminActivatedPlugins: ['pluginA'] });
    expect(fakeAuth.revokeRefreshTokens).toHaveBeenCalledWith('acc1');
  });

  it('should deactivate a plugin', async () => {
    fakeAuth.getUser.mockResolvedValue({ customClaims: { admin: true } });
    fakeDb.runTransaction.mockImplementation(async (updateFunction: any) => {
      const mockTransaction = {
        get: vi.fn().mockResolvedValue({ 
          exists: true, 
          data: () => ({ adminActivatedPlugins: ['pluginA', 'pluginB'] }),
        }),
        update: vi.fn(),
      };
      await updateFunction(mockTransaction);
    });

    const request = {
      auth: { uid: 'admin-uid' },
      data: { accountId: 'acc1', pluginId: 'pluginA', action: 'deactivate' },
    } as CallableRequest<{ accountId: string; pluginId: string; action: 'activate' | 'deactivate' }>;

    await handleManageClientPlugins(fakeDb, fakeAuth, request);

    expect(fakeAuth.setCustomUserClaims).toHaveBeenCalledWith('acc1', { adminActivatedPlugins: ['pluginB'] });
  });
});