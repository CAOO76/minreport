import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from './index';

// 1. DEFINE ALL MOCK CONTROLLERS FIRST
const mockResendSend = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockGet = vi.fn();
const mockAdd = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockGet, update: mockUpdate, set: mockSet, collection: vi.fn(() => ({ add: mockAdd })) }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));
const mockCollectionGroup = vi.fn(() => ({ where: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: mockGet }));
const mockBatchDelete = vi.fn();
const mockBatchCommit = vi.fn();
const mockBatch = () => ({ delete: mockBatchDelete, commit: mockBatchCommit });
const mockAuth = { getUserByEmail: vi.fn(), createUser: vi.fn(), generatePasswordResetLink: vi.fn() };

// 2. MOCK ALL MODULES SECOND, USING THE CONTROLLERS
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: mockResendSend } })) }));
vi.mock('crypto', () => ({
  default: {
    randomBytes: vi.fn(() => ({ toString: vi.fn(() => 'mocked_token') })),
    createHash: vi.fn(() => ({ update: vi.fn().mockReturnThis(), digest: vi.fn(() => 'mocked_hashed_token') })),
  },
}));
vi.mock('firebase-admin', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    initializeApp: vi.fn(),
    firestore: vi.fn(() => ({
      collection: mockCollection,
      collectionGroup: mockCollectionGroup,
      batch: mockBatch,
    })),
    auth: vi.fn(() => mockAuth),
  };
});

// 3. DESCRIBE TESTS THIRD
describe('Request Registration Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /requestAccess', () => {
    it('should successfully submit a request', async () => {
      mockSet.mockResolvedValue(undefined);
      mockAdd.mockResolvedValue(undefined);
      const requestData = { applicantName: 'Test User', applicantEmail: 'test@example.com', accountType: 'EMPRESARIAL', country: 'Chile', entityType: 'juridica', rut: '12345678-9', institutionName: 'Test Company' };

      const res = await request(app).post('/requestAccess').send(requestData);

      expect(res.statusCode).toEqual(200);
      expect(mockCollection).toHaveBeenCalledWith('requests');
      expect(mockDoc).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending_review' }));
      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ action: 'request_submitted' }));
    });

    it('should return 400 if required parameters are missing', async () => {
      const res = await request(app).post('/requestAccess').send({});
      expect(res.statusCode).toEqual(400);
    });

    it('should return 500 if firestore fails', async () => {
      mockSet.mockRejectedValue(new Error('Firestore error'));
      const requestData = { applicantName: 'Test User', applicantEmail: 'test@example.com', accountType: 'EMPRESARIAL', country: 'Chile', entityType: 'juridica', rut: '12345678-9', institutionName: 'Test Company' };
      const res = await request(app).post('/requestAccess').send(requestData);
      expect(res.statusCode).toEqual(500);
    });
  });

  describe('POST /processInitialDecision', () => {
    it('should approve a request and send an email', async () => {
      mockGet.mockResolvedValue({ exists: true, data: () => ({ applicantEmail: 'test@example.com' }) });
      mockUpdate.mockResolvedValue(undefined);
      mockAdd.mockResolvedValue(undefined);
      mockResendSend.mockResolvedValue({ data: {}, error: null });

      const res = await request(app).post('/processInitialDecision').send({ requestId: 'req1', adminId: 'admin1', decision: 'approved' });

      expect(res.statusCode).toEqual(200);
      expect(mockGet).toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending_additional_data' }));
      expect(mockResendSend).toHaveBeenCalled();
    });

    it('should return 404 if request not found', async () => {
      mockGet.mockResolvedValue({ exists: false });
      const res = await request(app).post('/processInitialDecision').send({ requestId: 'req1', adminId: 'admin1', decision: 'approved' });
      expect(res.statusCode).toEqual(404);
    });
  });
});
