import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import functionsTest from 'firebase-functions-test';
import { generatePluginLoadToken } from './tokens.js';
import { savePluginData } from './pluginApi.js';
import * as admin from 'firebase-admin'; // Import admin for type inference and direct mocking
// Mock firebase-admin as a whole
const mockAuth = {
    getUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
    revokeRefreshTokens: vi.fn(),
};
const mockFirestore = {
    doc: vi.fn(() => mockFirestore), // Self-referential for chaining
    set: vi.fn(),
    get: vi.fn(),
};
vi.mock('firebase-admin', () => ({
    initializeApp: vi.fn(),
    auth: () => mockAuth,
    firestore: () => mockFirestore,
    apps: [], // Ensure apps is an empty array initially
}));
const test = functionsTest();
describe('Cloud Functions', () => {
    let wrappedGeneratePluginLoadToken;
    let wrappedSavePluginData;
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('JWT_SECRET', 'test_secret');
        // Ensure Firebase Admin is initialized for each test
        admin.apps.length = 0; // Reset apps array before initializing
        admin.initializeApp();
        wrappedGeneratePluginLoadToken = test.wrap(generatePluginLoadToken);
        wrappedSavePluginData = test.wrap(savePluginData);
    });
    afterAll(() => {
        vi.unstubAllEnvs();
    });
    describe('generatePluginLoadToken', () => {
        it('should generate a token for an authenticated user with access', async () => {
            const request = {
                data: { pluginId: 'test-plugin' },
                auth: { uid: 'user-with-access', token: { adminActivatedPlugins: ['test-plugin'] } },
            };
            const result = await wrappedGeneratePluginLoadToken(request);
            expect(result).toHaveProperty('ticket');
        });
        it('should throw unauthenticated if auth is missing', async () => {
            const request = { data: { pluginId: 'test-plugin' } };
            await expect(wrappedGeneratePluginLoadToken(request)).rejects.toThrow('The function must be called while authenticated.');
        });
        it('should throw invalid-argument if pluginId is missing', async () => {
            const request = {
                data: {},
                auth: { uid: 'user1', token: {} },
            };
            // Use a substring match for robustness
            await expect(wrappedGeneratePluginLoadToken(request)).rejects.toThrow(/must be called with a valid "pluginId"/);
        });
        it('should throw permission-denied if user lacks claim', async () => {
            const request = {
                data: { pluginId: 'secret-plugin' },
                auth: { uid: 'user-no-access', token: { adminActivatedPlugins: ['other-plugin'] } },
            };
            await expect(wrappedGeneratePluginLoadToken(request)).rejects.toThrow('You do not have permission to load this plugin.');
        });
    });
    describe('savePluginData', () => {
        it('should save data for an authenticated user', async () => {
            const request = {
                data: { pluginId: 'test-plugin', data: { message: 'hello' } },
                auth: { uid: 'user-with-access', token: { adminActivatedPlugins: ['test-plugin'] } },
            };
            const result = await wrappedSavePluginData(request);
            expect(result).toEqual({ success: true, message: 'Data saved successfully.' });
        });
    });
});
//# sourceMappingURL=functions.test.js.map