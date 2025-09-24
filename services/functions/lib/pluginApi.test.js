import { describe, it, expect, beforeEach, vi } from 'vitest';
import functionsTest from 'firebase-functions-test';
import { savePluginData, updateUserPluginClaims, getUserPluginClaims } from './pluginApi.js';
import * as admin from 'firebase-admin'; // Import admin
// Mock firebase-admin/auth
const mockSetCustomUserClaims = vi.fn().mockResolvedValue(undefined);
const mockGetUser = vi.fn().mockImplementation(async (uid) => {
    const baseUserRecord = {
        uid: uid,
        email: `${uid}@example.com`,
        emailVerified: true,
        displayName: `User ${uid}`,
        photoURL: '',
        phoneNumber: undefined,
        disabled: false,
        metadata: {},
        providerData: [],
        toJSON: () => ({}),
    };
    if (uid === 'admin-uid')
        return Object.assign(Object.assign({}, baseUserRecord), { customClaims: { admin: true } });
    if (uid === 'user-no-claims')
        return Object.assign(Object.assign({}, baseUserRecord), { customClaims: {} });
    if (uid === 'user1')
        return Object.assign(Object.assign({}, baseUserRecord), { customClaims: { adminActivatedPlugins: ['pluginA', 'pluginC'] } });
    return Object.assign(Object.assign({}, baseUserRecord), { customClaims: {} });
});
const mockRevokeRefreshTokens = vi.fn().mockResolvedValue(undefined);
vi.mock('firebase-admin/auth', () => ({
    getAuth: () => ({
        setCustomUserClaims: mockSetCustomUserClaims,
        getUser: mockGetUser,
        revokeRefreshTokens: mockRevokeRefreshTokens,
    }),
}));
// Mock firebase-admin/firestore
const mockFirestoreDoc = vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
}));
vi.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        doc: mockFirestoreDoc,
    }),
}));
// Mock firebase-admin/app (for initializeApp and apps)
vi.mock('firebase-admin/app', () => ({
    initializeApp: vi.fn(),
    getApps: () => ([{}]), // Simulate an initialized app
}));
const test = functionsTest();
describe('pluginApi Cloud Functions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Ensure Firebase Admin is initialized for each test
        if (!admin.apps.length) {
            admin.initializeApp();
        }
    });
    describe('savePluginData', () => {
        const wrapped = test.wrap(savePluginData);
        it('should save data for an authorized user', async () => {
            const request = {
                data: { pluginId: 'pluginA', data: { setting: 'value' } },
                auth: { uid: 'user1', token: { uid: 'user1', adminActivatedPlugins: ['pluginA'], aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } }, // Token now uses adminActivatedPlugins
                rawRequest: {}, // Added for CallableRequest
                context: {}, // Added for CallableRequest
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
                auth: { uid: 'not-admin-uid', token: { uid: 'not-admin-uid', admin: false, aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } },
                rawRequest: {}, // Added for CallableRequest
                context: {}, // Added for CallableRequest
                acceptsStreaming: false, // Added for CallableRequest
            };
            await expect(wrapped(request)).rejects.toThrow('Only administrators can perform this action.');
        });
        it('should allow admin to activate a plugin for a user', async () => {
            const request = {
                data: { userId: 'user-no-claims', pluginId: 'pluginB', isActive: true },
                auth: { uid: 'admin-uid', token: { uid: 'admin-uid', admin: true, aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } },
                rawRequest: {}, // Added for CallableRequest
                context: {}, // Added for CallableRequest
                acceptsStreaming: false, // Added for CallableRequest
            };
            await wrapped(request);
            expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user-no-claims', { adminActivatedPlugins: ['pluginB'] });
        });
        it('should allow admin to deactivate a plugin for a user', async () => {
            const request = {
                data: { userId: 'user1', pluginId: 'pluginA', isActive: false },
                auth: { uid: 'admin-uid', token: { uid: 'admin-uid', admin: true, aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } },
                rawRequest: {}, // Added for CallableRequest
                context: {}, // Added for CallableRequest
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
                auth: { uid: 'not-admin-uid', token: { uid: 'not-admin-uid', admin: false, aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } },
                rawRequest: {}, // Added for CallableRequest
                context: {}, // Added for CallableRequest
                acceptsStreaming: false, // Added for CallableRequest
            };
            await expect(wrapped(request)).rejects.toThrow('Only administrators can perform this action.');
        });
        it('should return adminActivatedPlugins for a user when called by an admin', async () => {
            const request = {
                data: { userId: 'user1' },
                auth: { uid: 'admin-uid', token: { uid: 'admin-uid', admin: true, aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } },
                rawRequest: {}, // Added for CallableRequest
                context: {}, // Added for CallableRequest
                acceptsStreaming: false, // Added for CallableRequest
            };
            const result = await wrapped(request);
            expect(result).toEqual({ adminActivatedPlugins: ['pluginA', 'pluginC'] });
        });
        it('should return empty array if user has no adminActivatedPlugins', async () => {
            const request = {
                data: { userId: 'user-no-claims' },
                auth: { uid: 'admin-uid', token: { uid: 'admin-uid', admin: true, aud: 'test', auth_time: 123, exp: 123, firebase: { identities: {}, sign_in_provider: 'custom' }, iat: 123, iss: 'test', sub: 'test' } },
                rawRequest: {}, // Added for CallableRequest
                context: {}, // Added for CallableRequest
                acceptsStreaming: false, // Added for CallableRequest
            };
            const result = await wrapped(request);
            expect(result).toEqual({ adminActivatedPlugins: [] });
        });
    });
});
//# sourceMappingURL=pluginApi.test.js.map