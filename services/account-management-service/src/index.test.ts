import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import * as admin from 'firebase-admin';

// 1. Define las funciones "controladoras" que usaremos en los tests
const mockUpdate = vi.fn();
const mockGet = vi.fn();
const mockDoc = vi.fn(() => ({
  get: mockGet,
  update: mockUpdate,
}));
const mockCollection = vi.fn((path: string) => ({
  doc: mockDoc,
}));

// 2. Mockea 'firebase-admin'. La fábrica NO HACE REFERENCIA a las variables de arriba.
// En su lugar, devuelve funciones que las llaman. Esto rompe el problema de hoisting.
vi.mock('firebase-admin', () => {
  const mockFirestore = {
    FieldValue: {
      serverTimestamp: () => 'MOCK_TIMESTAMP',
    },
    collection: (path: string) => mockCollection(path),
  };

  const mockAdmin = {
    initializeApp: vi.fn(),
    firestore: () => mockFirestore,
    apps: [],
  };

  return {
    ...mockAdmin,
    default: mockAdmin,
  };
});

vi.mock('firebase-admin/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getFirestore: vi.fn(() => ({
      collection: (path: string) => mockCollection(path),
    })),
  };
});

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({
    // Mock any methods of Auth that are used in src/index.ts if necessary
    // For now, an empty object might be enough if no methods are called on 'auth'
  })),
}));

// Asignar FieldValue por separado ya que es un objeto estático
(admin.default as any).firestore.FieldValue = {
  serverTimestamp: () => 'MOCK_TIMESTAMP',
};


// 3. Importa la app DESPUÉS de que todos los mocks estén en su lugar.
const { app } = await import('./index.js');

describe('Account Management Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        suspendedAt: expect.any(Object),
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
        suspendedAt: expect.any(Object),
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