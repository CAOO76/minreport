import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleManageClientPlugins } from './clientPluginManagement';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { DecodedIdToken } from 'firebase-admin/auth';

// Mock firebase-admin modules
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(),
}));

import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Define interfaces for fake Firebase Admin SDK objects
interface FakeAuth {
  getUser: ReturnType<typeof vi.fn>;
  setCustomUserClaims: ReturnType<typeof vi.fn>;
  revokeRefreshTokens: ReturnType<typeof vi.fn>;
}

interface FakeDb {
  collection: ReturnType<typeof vi.fn>;
  doc: ReturnType<typeof vi.fn>;
  runTransaction: ReturnType<typeof vi.fn>;
}

// Create fake implementations for the mocked functions
const createFakeAuth = (): FakeAuth => ({
  getUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
  revokeRefreshTokens: vi.fn(),
});

const createFakeDb = (): FakeDb => ({
  collection: vi.fn().mockReturnThis(),
  doc: vi.fn().mockReturnThis(),
  runTransaction: vi.fn(),
});

// Helper function to create a mock CallableRequest
const createMockRequest = (
  data: { accountId: string; pluginId: string; action: 'activate' | 'deactivate' },
  authUid?: string,
  isAdmin: boolean = false
): CallableRequest<typeof data> => ({
  data,
  auth: authUid ? { uid: authUid, token: { admin: isAdmin } as DecodedIdToken } : undefined,
});

describe('handleManageClientPlugins', () => {
  let fakeAuth: any;
  let fakeDb: any;

  beforeEach(() => {
    fakeAuth = createFakeAuth();
    fakeDb = createFakeDb();
    vi.clearAllMocks();
    getFirestore.mockReturnValue(fakeDb);
    getAuth.mockReturnValue(fakeAuth);
  });

  it('should throw permission-denied if user is not an admin', async () => {
    fakeAuth.getUser.mockResolvedValue({ customClaims: { admin: false } });
    const request = createMockRequest({ accountId: 'acc1', pluginId: 'pluginA', action: 'activate' }, 'non-admin-uid', false);

    await expect(handleManageClientPlugins(request)).rejects.toThrow(/Solo los administradores pueden realizar esta acción/);
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
    
        const request = createMockRequest({ accountId: 'acc1', pluginId: 'pluginA', action: 'activate' }, 'admin-uid', true);
    await handleManageClientPlugins(request);

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

    const request = createMockRequest({ accountId: 'acc1', pluginId: 'pluginA', action: 'deactivate' }, 'admin-uid', true);

    await handleManageClientPlugins(request);

    expect(fakeAuth.setCustomUserClaims).toHaveBeenCalledWith('acc1', { adminActivatedPlugins: ['pluginB'] });
  });

  it('should throw unauthenticated if not authenticated', async () => {
    const request = createMockRequest({ accountId: 'acc1', pluginId: 'pluginA', action: 'activate' });

    await expect(handleManageClientPlugins(request)).rejects.toThrow(/La solicitud debe estar autenticada./);
  });

  it('should throw invalid-argument for missing accountId', async () => {
    fakeAuth.getUser.mockResolvedValue({ customClaims: { admin: true } });
    const request = createMockRequest({ accountId: '', pluginId: 'pluginA', action: 'activate' }, 'admin-uid', true);

    await expect(handleManageClientPlugins(request)).rejects.toThrow(/Argumentos inválidos./);
  });

  it('should throw not-found if account does not exist', async () => {
    fakeAuth.getUser.mockResolvedValue({ customClaims: { admin: true } });
    fakeDb.runTransaction.mockImplementation(async (updateFunction: any) => {
      const mockTransaction = {
        get: vi.fn().mockResolvedValue({ exists: false }),
        update: vi.fn(),
      };
      await updateFunction(mockTransaction);
    });

    const request = createMockRequest({ accountId: 'non-existent-acc', pluginId: 'pluginA', action: 'activate' }, 'admin-uid', true);

    await expect(handleManageClientPlugins(request)).rejects.toThrow(/La cuenta especificada no existe./);
  });

  it('should not update if activating an already active plugin', async () => {
    fakeAuth.getUser.mockResolvedValue({ customClaims: { admin: true } });
    fakeDb.runTransaction.mockImplementation(async (updateFunction: any) => {
      const mockTransaction = {
        get: vi.fn().mockResolvedValue({ 
          exists: true, 
          data: () => ({ adminActivatedPlugins: ['pluginA'] }),
        }),
        update: vi.fn(),
      };
      await updateFunction(mockTransaction);
    });

    const request = createMockRequest({ accountId: 'acc1', pluginId: 'pluginA', action: 'activate' }, 'admin-uid', true);

    await handleManageClientPlugins(request);

    expect(fakeDb.runTransaction).toHaveBeenCalled();
    expect(fakeAuth.setCustomUserClaims).not.toHaveBeenCalled(); // No change, so no update
    expect(fakeAuth.revokeRefreshTokens).not.toHaveBeenCalled(); // No change, so no update
  });

  it('should not update if deactivating an inactive plugin', async () => {
    fakeAuth.getUser.mockResolvedValue({ customClaims: { admin: true } });
    fakeDb.runTransaction.mockImplementation(async (updateFunction: any) => {
      const mockTransaction = {
        get: vi.fn().mockResolvedValue({ 
          exists: true, 
          data: () => ({ adminActivatedPlugins: ['pluginB'] }),
        }),
        update: vi.fn(),
      };
      await updateFunction(mockTransaction);
    });

    const request = createMockRequest({ accountId: 'acc1', pluginId: 'pluginA', action: 'deactivate' }, 'admin-uid', true);

    await handleManageClientPlugins(request);

    expect(fakeDb.runTransaction).toHaveBeenCalled();
    expect(fakeAuth.setCustomUserClaims).not.toHaveBeenCalled(); // No change, so no update
    expect(fakeAuth.revokeRefreshTokens).not.toHaveBeenCalled(); // No change, so no update
  });

  it('should throw invalid-argument for invalid pluginId', async () => {
    fakeAuth.getUser.mockResolvedValue({ customClaims: { admin: true } });
    const request = createMockRequest({ accountId: 'acc1', pluginId: '', action: 'activate' }, 'admin-uid', true);

    await expect(handleManageClientPlugins(request)).rejects.toThrow(/Argumentos inválidos./);
  });

  it('should throw invalid-argument for invalid action', async () => {
    fakeAuth.getUser.mockResolvedValue({ customClaims: { admin: true } });
    const request = createMockRequest({ accountId: 'acc1', pluginId: 'pluginA', action: 'invalid-action' as any }, 'admin-uid', true);

    await expect(handleManageClientPlugins(request)).rejects.toThrow(/Argumentos inválidos./);
  });

  it('should throw internal error if Firestore transaction fails', async () => {
    fakeAuth.getUser.mockResolvedValue({ customClaims: { admin: true } });
    fakeDb.runTransaction.mockRejectedValue(new Error('Firestore transaction error'));

    const request = createMockRequest({ accountId: 'acc1', pluginId: 'pluginA', action: 'activate' }, 'admin-uid', true);

    await expect(handleManageClientPlugins(request)).rejects.toThrow(/Error al gestionar el plugin del cliente./);
  });

  it('should throw internal error if auth.getUser(callerUid) fails', async () => {
    fakeAuth.getUser.mockRejectedValue(new Error('Caller user not found'));

    const request = createMockRequest({ accountId: 'acc1', pluginId: 'pluginA', action: 'activate' }, 'admin-uid', true);

    await expect(handleManageClientPlugins(request)).rejects.toThrow('Caller user not found');
  });

  it('should throw internal error if setCustomUserClaims fails', async () => {
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
    fakeAuth.setCustomUserClaims.mockRejectedValue(new Error('Claims update failed'));

    const request = createMockRequest({ accountId: 'acc1', pluginId: 'pluginA', action: 'activate' }, 'admin-uid', true);

    await expect(handleManageClientPlugins(request)).rejects.toThrow(/Error al gestionar el plugin del cliente./);
  });

  it('should throw internal error if revokeRefreshTokens fails', async () => {
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
    fakeAuth.revokeRefreshTokens.mockRejectedValue(new Error('Revoke tokens failed'));

    const request = createMockRequest({ accountId: 'acc1', pluginId: 'pluginA', action: 'activate' }, 'admin-uid', true);

    await expect(handleManageClientPlugins(request)).rejects.toThrow(/Error al gestionar el plugin del cliente./);
  });
});