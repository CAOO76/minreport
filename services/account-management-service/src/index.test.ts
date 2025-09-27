import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import admin from 'firebase-admin';

// Mock Firebase Admin SDK
const mockUpdate = vi.fn();
const mockGet = vi.fn();
const mockDoc = vi.fn(() => ({
  get: mockGet,
  update: mockUpdate,
}));
const mockCollection = vi.fn(() => ({
  doc: mockDoc,
}));
const mockFirestore = vi.fn(() => ({
  collection: mockCollection,
}));

const mockAuth = vi.fn();

vi.mock('firebase-admin', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    initializeApp: vi.fn(),
    firestore: Object.assign(mockFirestore, { FieldValue: actual.firestore.FieldValue }),
    auth: mockAuth,
  };
});

// Import the app after mocking firebase-admin
const { app } = await import('./index');

describe('Account Management Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations for each test
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockCollection.mockReset();
    mockDoc.mockReset();
    mockFirestore.mockReset();
    mockAuth.mockReset();
  });

  describe('POST /suspend', () => {
    it('should return 400 if accountId is missing', async () => {
      const res = await request(app).post('/suspend').send({});
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ error: 'El ID de la cuenta (accountId) es obligatorio.' });
    });

    it('should return 404 if account does not exist', async () => {
      mockGet.mockResolvedValueOnce({ exists: false });

      const res = await request(app).post('/suspend').send({ accountId: 'nonExistentAccount' });
      expect(res.statusCode).toEqual(404);
      expect(res.body).toEqual({ error: 'Cuenta no encontrada.' });
    });

    it('should suspend an existing account successfully', async () => {
      mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'active' }) });
      mockUpdate.mockResolvedValueOnce(undefined);

      const res = await request(app).post('/suspend').send({ accountId: 'testAccount', reason: 'Test Reason' });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ message: 'Cuenta testAccount ha sido suspendida.' });
      expect(mockCollection).toHaveBeenCalledWith('accounts');
      expect(mockDoc).toHaveBeenCalledWith('testAccount');
      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'suspended',
        suspensionReason: 'Test Reason',
        suspendedAt: expect.any(admin.firestore.FieldValue),
      });
    });

    it('should suspend an account with default reason if none provided', async () => {
      mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'active' }) });
      mockUpdate.mockResolvedValueOnce(undefined);

      const res = await request(app).post('/suspend').send({ accountId: 'testAccount2' });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ message: 'Cuenta testAccount2 ha sido suspendida.' });
      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'suspended',
        suspensionReason: 'No se especificó una razón',
        suspendedAt: expect.any(admin.firestore.FieldValue),
      });
    });

    it('should return 500 if an error occurs during suspension', async () => {
      mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'active' }) });
      mockUpdate.mockRejectedValueOnce(new Error('Firestore error'));

      const res = await request(app).post('/suspend').send({ accountId: 'errorAccount' });
      expect(res.statusCode).toEqual(500);
      expect(res.body).toEqual({ error: 'Ocurrió un error en el servidor.' });
    });
  });
});