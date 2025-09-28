import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import * as admin from 'firebase-admin';
import { Resend } from 'resend';
const mockResendSend = vi.fn();
// 1. Define Mocks
const mockUpdate = vi.fn();
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockAdd = vi.fn();
const mockDoc = vi.fn(() => ({
    get: mockGet,
    update: mockUpdate,
    set: mockSet,
    collection: vi.fn(() => ({ add: mockAdd })),
    ref: { update: mockUpdate, collection: vi.fn(() => ({ add: mockAdd })), parent: { parent: { collection: vi.fn(() => ({ add: mockAdd })) } } },
}));
const mockCollection = vi.fn(() => ({ get: vi.fn(), doc: mockDoc, add: mockAdd }));
const mockCollectionGroup = vi.fn(() => ({
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn(),
}));
const mockBatch = {
    delete: vi.fn(),
    commit: vi.fn(),
};
const mockFirestore = () => ({
    collection: mockCollection,
    collectionGroup: mockCollectionGroup,
    batch: () => mockBatch,
});
const mockAuth = {
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
    generatePasswordResetLink: vi.fn(),
};
// 2. Mock Modules
vi.mock('firebase-admin', () => ({
    initializeApp: vi.fn(),
    firestore: () => ({
        collection: mockCollection,
        collectionGroup: mockCollectionGroup,
        batch: () => mockBatch,
    }),
    auth: () => mockAuth,
}));
vi.mock('resend', () => ({
    Resend: vi.fn(() => ({
        emails: {
            send: mockResendSend,
        },
    })),
}));
vi.mock('crypto', () => ({
    default: {
        randomBytes: vi.fn(() => ({ toString: vi.fn(() => 'mocked_token') })),
        createHash: vi.fn(() => ({ update: vi.fn().mockReturnThis(), digest: vi.fn(() => 'mocked_hashed_token') })),
    }
}));
// Assign static properties after mocking
admin.firestore.FieldValue = {
    serverTimestamp: () => 'MOCK_TIMESTAMP',
    delete: () => 'MOCK_DELETE',
};
admin.firestore.Timestamp = {
    now: () => ({ toDate: () => new Date() }),
    fromDate: (date) => ({ toDate: () => date }),
};
describe('Request Registration Service', () => {
    let app; // Declare app here
    beforeEach(async () => {
        vi.clearAllMocks();
        // Reset mocks that need specific default behavior for multiple tests
        mockBatch.commit.mockResolvedValue(undefined);
        // Dynamically import the app INSIDE beforeEach
        // This ensures a fresh app instance with fresh mocks for every test
        const module = await import('./index.js');
        app = module.app;
    });
    describe('POST /requestAccess', () => {
        it('should return 400 if required parameters are missing', async () => {
            const res = await request(app).post('/requestAccess').send({});
            expect(res.statusCode).toEqual(400);
            expect(res.body).toEqual({ message: 'Faltan parámetros obligatorios.' });
        });
        it('should successfully submit a request', async () => {
            const requestData = { applicantName: 'Test User', applicantEmail: 'test@example.com', accountType: 'EMPRESARIAL', country: 'Chile', entityType: 'juridica', rut: '12345678-9', institutionName: 'Test Company' };
            mockSet.mockResolvedValue(undefined);
            mockAdd.mockResolvedValue(undefined);
            const res = await request(app).post('/requestAccess').send(requestData);
            expect(res.statusCode).toEqual(200);
            expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ applicantName: 'Test User', status: 'pending_review' }));
            expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ action: 'request_submitted' }));
        });
        it('should return 500 if an error occurs', async () => {
            const requestData = { applicantName: 'Test User', applicantEmail: 'test@example.com', accountType: 'EMPRESARIAL', country: 'Chile', entityType: 'juridica', rut: '12345678-9', institutionName: 'Test Company' };
            mockSet.mockRejectedValue(new Error('Firestore error'));
            const res = await request(app).post('/requestAccess').send(requestData);
            expect(res.statusCode).toEqual(500);
        });
    });
    describe('POST /processInitialDecision', () => {
        it('should successfully approve a request', async () => {
            process.env.RESEND_API_KEY = 'mock_key'; // Set env var for this test
            const mockRequestData = { applicantEmail: 'test@example.com' };
            mockGet.mockResolvedValue({ exists: true, data: () => mockRequestData });
            mockUpdate.mockResolvedValue(undefined);
            mockAdd.mockResolvedValue(undefined);
            mockResendSend.mockResolvedValue({ data: {}, error: null }); // Use the controller
            const res = await request(app).post('/processInitialDecision').send({ requestId: 'req1', adminId: 'admin1', decision: 'approved' });
            expect(res.statusCode).toEqual(200);
            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending_additional_data' }));
            expect(mockResendSend).toHaveBeenCalled(); // Assert against the controller
        });
    });
    describe('POST /validate-data-token', () => {
        it('should successfully validate a token', async () => {
            const mockRequestDoc = { data: () => ({ status: 'pending_additional_data', tokenExpiry: { toDate: () => new Date(Date.now() + 3600 * 1000) } }) };
            const getMock = vi.fn().mockResolvedValue({ empty: false, docs: [mockRequestDoc] });
            mockCollectionGroup.mockReturnValue({
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                get: getMock,
            });
            const res = await request(app).post('/validate-data-token').send({ token: 'valid_token' });
            expect(res.statusCode).toEqual(200);
            expect(res.body.isValid).toBe(true);
        });
    });
    describe('POST /submitAdditionalData', () => {
        it('should successfully submit additional data', async () => {
            const mockRequestDoc = { data: () => ({ status: 'pending_additional_data', tokenExpiry: { toDate: () => new Date(Date.now() + 3600 * 1000) } }), ref: { update: mockUpdate, collection: () => ({ add: mockAdd }) } };
            const getMock = vi.fn().mockResolvedValue({ empty: false, docs: [mockRequestDoc] });
            mockCollectionGroup.mockReturnValue({
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                get: getMock,
            });
            mockUpdate.mockResolvedValue(undefined);
            mockAdd.mockResolvedValue(undefined);
            const res = await request(app).post('/submitAdditionalData').send({ token: 'valid_token', additionalData: { adminName: 'Admin' } });
            expect(res.statusCode).toEqual(200);
            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending_final_review' }));
        });
    });
    describe('POST /approveFinalRequest', () => {
        it('should successfully approve a request and create a new user', async () => {
            const mockRequestData = { status: 'pending_final_review', additionalData: { adminEmail: 'newadmin@example.com' } };
            mockGet.mockResolvedValue({ exists: true, data: () => mockRequestData });
            mockAuth.getUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' });
            mockAuth.createUser.mockResolvedValue({ uid: 'new_user_uid' });
            mockSet.mockResolvedValue(undefined);
            mockUpdate.mockResolvedValue(undefined);
            mockAdd.mockResolvedValue(undefined);
            mockAuth.generatePasswordResetLink.mockResolvedValue('http://password.reset/link?oobCode=mockOobCode');
            new Resend().emails.send.mockResolvedValue({ data: {}, error: null });
            const res = await request(app).post('/approveFinalRequest').send({ requestId: 'req1', adminId: 'admin1' });
            expect(res.statusCode).toEqual(200);
            expect(mockAuth.createUser).toHaveBeenCalled();
        });
    });
    describe('POST /clear-all-requests', () => {
        it('should return 403 if in production environment', async () => {
            process.env.NODE_ENV = 'production';
            const res = await request(app).post('/clear-all-requests');
            expect(res.statusCode).toEqual(403);
            process.env.NODE_ENV = 'test'; // Reset env for other tests
        });
        it('should successfully delete requests in development', async () => {
            process.env.NODE_ENV = 'development';
            const mockRequestDoc = { ref: { delete: vi.fn() } };
            const getMock = vi.fn().mockResolvedValue({ empty: false, docs: [mockRequestDoc, mockRequestDoc] });
            mockCollection.mockReturnValue({
                get: getMock,
                doc: mockDoc, add: mockAdd, // Ensure the outer mock also has add
            });
            const res = await request(app).post('/clear-all-requests');
            expect(res.statusCode).toEqual(200);
            expect(mockBatch.delete).toHaveBeenCalledTimes(2);
            expect(mockBatch.commit).toHaveBeenCalled();
            process.env.NODE_ENV = 'test'; // Reset env for other tests
        });
    });
});
