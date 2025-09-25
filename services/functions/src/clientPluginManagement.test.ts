import { describe, it, expect, beforeEach, vi } from 'vitest';
import functionsTest from 'firebase-functions-test';
import { mockAuth, mockFirestore, mockSetCustomUserClaims, adminMock } from '../vitest.setup';


const test = functionsTest();



// Import the module *after* vi.mock has been called
import * as admin from 'firebase-admin';
import { manageClientPluginsCallable } from './clientPluginManagement.js'; // Added .js extension



describe('manageClientPluginsCallable', () => {
  let wrapped: any;

  beforeEach(() => {
    // Clear all mocks on the *mocked instances*
    vi.clearAllMocks();
    adminMock.initializeApp(); // Call initializeApp on the mocked admin



    // Set up the mock behaviors directly on the mocked instances
    mockAuth.getUser.mockResolvedValue({
      uid: 'test-uid',
      email: 'test@example.com',
      emailVerified: true,
      displayName: 'Test User',
      photoURL: '',
      phoneNumber: undefined, // Changed from null to undefined to match string | undefined
      disabled: false,
      metadata: {} as any,
      providerData: [],
      customClaims: { admin: true },
      tenantId: null,
      toJSON: () => ({}),
    });
    mockAuth.setCustomUserClaims.mockResolvedValue(undefined);
    mockAuth.revokeRefreshTokens.mockResolvedValue(undefined);

    // Wrap the callable function
    wrapped = test.wrap(manageClientPluginsCallable);
  });

  it('should be a valid test suite', () => {
    expect(true).toBe(true);
  });

  it('should allow admin to manage client plugins', async () => {
    const request = {
      data: { accountId: 'acc1', pluginId: 'pluginA', action: 'activate' },
      auth: { uid: 'admin-uid', token: { admin: true } },
      rawRequest: {} as any, // Added for CallableRequest
      context: {} as any, // Added for CallableRequest
    };
    await wrapped(request);
    expect(mockAuth.getUser).toHaveBeenCalledWith('admin-uid');
    expect(mockFirestore.runTransaction).toHaveBeenCalled();
  });
});
