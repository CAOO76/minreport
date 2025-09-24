import { describe, it, expect, beforeEach, vi } from 'vitest';
import functionsTest from 'firebase-functions-test';
const test = functionsTest();
// Mock the entire firebase-admin module
vi.mock('firebase-admin', () => {
    // Define and initialize the mock objects *inside* the factory
    const mockAuth = {
        getUser: vi.fn(),
        setCustomUserClaims: vi.fn(),
        revokeRefreshTokens: vi.fn(),
    }; // Cast to Auth
    const mockFirestore = {
        collection: vi.fn(() => mockFirestore),
        doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ adminActivatedPlugins: [] }) }),
            update: vi.fn().mockResolvedValue(true),
        })),
        runTransaction: vi.fn((callback) => callback(mockFirestore)),
    }; // Cast to Firestore
    return {
        initializeApp: vi.fn(),
        auth: vi.fn(() => mockAuth),
        firestore: vi.fn(() => mockFirestore),
        apps: [],
    };
});
// Import the module *after* vi.mock has been called
import * as admin from 'firebase-admin';
import { manageClientPluginsCallable } from './clientPluginManagement.js'; // Added .js extension
// Get references to the mocked admin.auth() and admin.firestore()
// These will now correctly point to the mock instances returned by the vi.mock factory
const mockedAuth = vi.mocked(admin.auth());
const mockedFirestore = vi.mocked(admin.firestore());
describe('manageClientPluginsCallable', () => {
    let wrapped;
    beforeEach(() => {
        // Clear all mocks on the *mocked instances*
        vi.clearAllMocks();
        // Set up the mock behaviors directly on the mocked instances
        mockedAuth.getUser.mockResolvedValue({
            uid: 'test-uid',
            email: 'test@example.com',
            emailVerified: true,
            displayName: 'Test User',
            photoURL: '',
            phoneNumber: undefined, // Changed from null to undefined to match string | undefined
            disabled: false,
            metadata: {},
            providerData: [],
            customClaims: { admin: true },
            tenantId: null,
            toJSON: () => ({}),
        });
        mockedAuth.setCustomUserClaims.mockResolvedValue(undefined);
        mockedAuth.revokeRefreshTokens.mockResolvedValue(undefined);
        // Wrap the callable function
        wrapped = test.wrap(manageClientPluginsCallable);
    });
    it('should be a valid test suite', () => {
        expect(true).toBe(true);
    });
    it('should allow admin to manage client plugins', async () => {
        const request = {
            data: { accountId: 'acc1', pluginId: 'pluginA', isActive: true },
            auth: { uid: 'admin-uid', token: { admin: true } },
            rawRequest: {}, // Added for CallableRequest
            context: {}, // Added for CallableRequest
        };
        await wrapped(request);
        expect(mockedAuth.getUser).toHaveBeenCalledWith('acc1');
        expect(mockedFirestore.runTransaction).toHaveBeenCalled();
    });
});
//# sourceMappingURL=clientPluginManagement.test.js.map