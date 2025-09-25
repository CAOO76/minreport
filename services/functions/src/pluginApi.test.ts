import { describe, it, expect, beforeEach, vi } from 'vitest';
import functionsTest from 'firebase-functions-test';
import { savePluginData, updateUserPluginClaims, getUserPluginClaims } from './pluginApi.js';
import { adminMock, mockSetCustomUserClaims } from '../vitest.setup';

















const test = functionsTest();

describe('pluginApi Cloud Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure Firebase Admin is initialized for each test
    // The mock in __mocks__/firebase-admin.ts handles initializeApp and apps
    // We just need to ensure the mock is reset
    adminMock.initializeApp(); // Call initializeApp on the mocked admin

    // Mock specific user claims for testing getUserPluginClaims
    vi.mocked(adminMock.auth()).getUser.mockImplementation(async (uid: string) => {
      if (uid === 'user1') {
        return {
          uid: 'user1',
          email: 'user1@example.com',
          customClaims: { adminActivatedPlugins: ['pluginA', 'pluginC'] },
        } as any;
      } else if (uid === 'user-no-claims') {
        return {
          uid: 'user-no-claims',
          email: 'user-no-claims@example.com',
          customClaims: {},
        } as any;
      }
      return {
        uid: uid,
        email: `${uid}@example.com`,
        customClaims: {},
      } as any;
    });
  });

  describe('savePluginData', () => {
    const wrapped = test.wrap(savePluginData);

    it('should save data for an authorized user', async () => {
      const request = {
        data: { pluginId: 'pluginA', data: { setting: 'value' } },
        auth: { uid: 'user1', token: { uid: 'user1', adminActivatedPlugins: ['pluginA'], aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } as DecodedIdToken }, // Token now uses adminActivatedPlugins
        rawRequest: {} as any, // Added for CallableRequest
        context: {} as any, // Added for CallableRequest
        acceptsStreaming: false, // Added for CallableRequest
      };
      const result = await wrapped(request);
      expect(result).toEqual({ success: true, message: 'Data saved successfully.' });
    });

    // The test 'should be denied for an unauthorized plugin' is removed as savePluginData no longer checks for plugin authorization.
  });

  describe('updateUserPluginClaims', () => {
    const wrapped = test.wrap(updateUserPluginClaims);

    it('should be denied if caller is not admin', async () => {
      const request = {
        data: { userId: 'user1', pluginId: 'pluginB', isActive: true },
        auth: { uid: 'not-admin-uid', token: { uid: 'not-admin-uid', admin: false, aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } as DecodedIdToken },
        rawRequest: {} as any, // Added for CallableRequest
        context: {} as any, // Added for CallableRequest
        acceptsStreaming: false, // Added for CallableRequest
      };
      await expect(wrapped(request)).rejects.toThrow('Only administrators can perform this action.');
    });

    it('should allow admin to activate a plugin for a user', async () => {
      const request = {
        data: { userId: 'user-no-claims', pluginId: 'pluginB', isActive: true },
        auth: { uid: 'admin-uid', token: { uid: 'admin-uid', admin: true, aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } as DecodedIdToken },
        rawRequest: {} as any, // Added for CallableRequest
        context: {} as any, // Added for CallableRequest
        acceptsStreaming: false, // Added for CallableRequest
      };
      await wrapped(request);
      expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user-no-claims', { adminActivatedPlugins: ['pluginB'] });
    });

    it('should allow admin to deactivate a plugin for a user', async () => {
      const request = {
        data: { userId: 'user1', pluginId: 'pluginA', isActive: false },
        auth: { uid: 'admin-uid', token: { uid: 'admin-uid', admin: true, aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } as DecodedIdToken },
        rawRequest: {} as any, // Added for CallableRequest
        context: {} as any, // Added for CallableRequest
        acceptsStreaming: false, // Added for CallableRequest
      };
      await wrapped(request);
      expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { adminActivatedPlugins: ['pluginC'] }); // user1 initially has ['pluginA', 'pluginC']
    });
  });

  describe('getUserPluginClaims', () => {
    const wrapped = test.wrap(getUserPluginClaims);

    it('should be denied if caller is not admin', async () => {
      const request = {
        data: { userId: 'user1', pluginId: 'pluginB', isActive: true },
        auth: { uid: 'not-admin-uid', token: { uid: 'not-admin-uid', admin: false, aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } as DecodedIdToken },
        rawRequest: {} as any, // Added for CallableRequest
        context: {} as any, // Added for CallableRequest
        acceptsStreaming: false, // Added for CallableRequest
      };
      await expect(wrapped(request)).rejects.toThrow('Only administrators can perform this action.');
    });

    it('should return adminActivatedPlugins for a user when called by an admin', async () => {
      const request = {
        data: { userId: 'user1' },
        auth: { uid: 'admin-uid', token: { uid: 'admin-uid', admin: true, aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } as DecodedIdToken },
        rawRequest: {} as any, // Added for CallableRequest
        context: {} as any, // Added for CallableRequest
        acceptsStreaming: false, // Added for CallableRequest
      };
      const result = await wrapped(request);
      expect(result).toEqual({ adminActivatedPlugins: ['pluginA', 'pluginC'] });
    });

    it('should return empty array if user has no adminActivatedPlugins', async () => {
      const request = {
        data: { userId: 'user-no-claims' },
        auth: { uid: 'admin-uid', token: { uid: 'admin-uid', admin: true, aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } as DecodedIdToken },
        rawRequest: {} as any, // Added for CallableRequest
        context: {} as any, // Added for CallableRequest
        acceptsStreaming: false, // Added for CallableRequest
      };
      const result = await wrapped(request);
      expect(result).toEqual({ adminActivatedPlugins: [] });
    });
  });
});