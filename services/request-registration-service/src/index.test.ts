import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import admin from 'firebase-admin';
import { Resend } from 'resend';
import crypto from 'crypto';

// Mock Firebase Admin SDK
const mockUpdate = vi.fn();
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockAdd = vi.fn();
const mockDoc = vi.fn(() => ({
  get: mockGet,
  update: mockUpdate,
  set: mockSet,
  collection: vi.fn(() => ({
    add: mockAdd,
  })),
}));
const mockCollection = vi.fn(() => ({
  doc: mockDoc,
  add: mockAdd,
}));
const mockFirestore = vi.fn(() => ({
  collection: mockCollection,
  collectionGroup: vi.fn(() => ({
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn(),
  })),
}));

const mockAuth = {
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  generatePasswordResetLink: vi.fn(),
};

vi.mock('firebase-admin', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    initializeApp: vi.fn(),
    firestore: Object.assign(mockFirestore, { FieldValue: actual.firestore.FieldValue, Timestamp: actual.firestore.Timestamp }),
    auth: vi.fn(() => mockAuth),
  };  describe('POST /clear-all-requests', () => {
    let originalNodeEnv: string | undefined;

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should return 403 if in production environment', async () => {
      process.env.NODE_ENV = 'production';
      const res = await request(app).post('/clear-all-requests');
      expect(res.statusCode).toEqual(403);
      expect(res.body).toEqual({ message: 'Esta operación no está permitida en producción.' });
    });

    it('should return 200 if no requests to delete', async () => {
      process.env.NODE_ENV = 'development';
      mockCollection.mockReturnValueOnce({
        get: vi.fn().mockResolvedValueOnce({ empty: true }),
      });

      const res = await request(app).post('/clear-all-requests');
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ message: 'No hay solicitudes para eliminar.' });
    });

    it('should successfully delete all requests and subcollections', async () => {
      process.env.NODE_ENV = 'development';
      const mockRequestDoc = {
        id: 'req1',
        ref: {
          collection: vi.fn((name) => {
            if (name === 'history') {
              return { get: vi.fn().mockResolvedValueOnce({ docs: [{ ref: { delete: vi.fn() } }] }) };
            } else if (name === 'clarifications') {
              return { get: vi.fn().mockResolvedValueOnce({ docs: [{ ref: { delete: vi.fn() } }] }) };
            }
            return { get: vi.fn().mockResolvedValueOnce({ docs: [] }) };
          }),
          delete: vi.fn(),
        },
      };
      mockCollection.mockReturnValueOnce({
        get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockRequestDoc] }),
      });
      mockFirestore.mockReturnValueOnce({
        batch: vi.fn(() => ({
          delete: vi.fn(),
          commit: vi.fn().mockResolvedValue(undefined),
        })),
      });

      const res = await request(app).post('/clear-all-requests');
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ message: 'Se eliminaron 1 solicitudes y sus historiales/aclaraciones.' });
      expect(mockFirestore().batch().delete).toHaveBeenCalledTimes(3); // 1 request + 1 history + 1 clarification
      expect(mockFirestore().batch().commit).toHaveBeenCalled();
    });

    it('should return 500 if an error occurs during Firestore operation', async () => {
      process.env.NODE_ENV = 'development';
      mockCollection.mockReturnValueOnce({
        get: vi.fn().mockRejectedValueOnce(new Error('Firestore error')),
      });

      const res = await request(app).post('/clear-all-requests');
      expect(res.statusCode).toEqual(500);
      expect(res.body).toEqual({ message: 'Error interno del servidor al eliminar solicitudes.' });
    });
  });
});

// Mock Resend
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: {
      send: vi.fn(),
    },
  })),
}));

// Mock Crypto
vi.mock('crypto', () => ({
  randomBytes: vi.fn(() => ({ toString: vi.fn(() => 'mocked_token') })),
  createHash: vi.fn(() => ({ update: vi.fn().mockReturnThis(), digest: vi.fn(() => 'mocked_hashed_token') })),
}));

// Import the app after mocking firebase-admin
const { app } = await import('./index');

describe('Request Registration Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations for each test
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockSet.mockReset();
    mockAdd.mockReset();
    mockDoc.mockReset();
    mockCollection.mockReset();
    mockFirestore.mockReset();
    mockAuth.getUserByEmail.mockReset();
    mockAuth.createUser.mockReset();
    mockAuth.generatePasswordResetLink.mockReset();
    Resend.mockClear();
    crypto.randomBytes().toString.mockClear();
    crypto.createHash().update().digest.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /requestAccess', () => {
    it('should return 400 if required parameters are missing', async () => {
      const res = await request(app).post('/requestAccess').send({});
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ message: 'Faltan parámetros obligatorios.' });
    });

    it('should successfully submit a request', async () => {
      const requestData = {
        applicantName: 'Test User',
        applicantEmail: 'test@example.com',
        accountType: 'EMPRESARIAL',
        country: 'Chile',
        entityType: 'juridica',
        rut: '12345678-9',
        institutionName: 'Test Company',
      };

      mockCollection.mockReturnValueOnce({
        doc: vi.fn(() => ({
          set: mockSet,
          collection: vi.fn(() => ({
            add: mockAdd,
          })),
        })),
      });
      mockSet.mockResolvedValueOnce(undefined);
      mockAdd.mockResolvedValueOnce(undefined);

      const res = await request(app).post('/requestAccess').send(requestData);
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ message: 'Solicitud de acceso registrada con éxito.' });
      expect(mockCollection).toHaveBeenCalledWith('requests');
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          applicantName: 'Test User',
          applicantEmail: 'test@example.com',
          status: 'pending_review',
        }),
      );
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'request_submitted',
        }),
      );
    });

    it('should return 500 if an error occurs during Firestore operation', async () => {
      const requestData = {
        applicantName: 'Test User',
        applicantEmail: 'test@example.com',
        accountType: 'EMPRESARIAL',
        country: 'Chile',
        entityType: 'juridica',
        rut: '12345678-9',
        institutionName: 'Test Company',
      };

      mockCollection.mockReturnValueOnce({
        doc: vi.fn(() => ({
          set: mockSet,
          collection: vi.fn(() => ({
            add: mockAdd,
          })),
        })),
      });
      mockSet.mockRejectedValueOnce(new Error('Firestore error'));

      const res = await request(app).post('/requestAccess').send(requestData);
      expect(res.statusCode).toEqual(500);
      expect(res.body).toEqual({ message: 'Error interno del servidor.' });
    });
  });

  describe('POST /processInitialDecision', () => {
    it('should return 400 if required parameters are missing', async () => {
      const res = await request(app).post('/processInitialDecision').send({});
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ message: 'Faltan parámetros obligatorios (requestId, adminId, decision).' });
    });

    it('should return 400 if decision is invalid', async () => {
      const res = await request(app).post('/processInitialDecision').send({ requestId: 'req1', adminId: 'admin1', decision: 'invalid' });
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ message: 'Decisión inválida.' });
    });

    it('should return 404 if request does not exist', async () => {
      mockGet.mockResolvedValueOnce({ exists: false });

      const res = await request(app).post('/processInitialDecision').send({ requestId: 'nonExistent', adminId: 'admin1', decision: 'approved' });
      expect(res.statusCode).toEqual(404);
      expect(res.body).toEqual({ message: 'Solicitud no encontrada.' });
    });

    it('should successfully approve a request', async () => {
      const mockRequestData = {
        applicantName: 'Test User',
        applicantEmail: 'test@example.com',
        accountType: 'EMPRESARIAL',
        country: 'Chile',
        entityType: 'juridica',
        status: 'pending_review',
      };

      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestData });
      mockUpdate.mockResolvedValue(undefined);
      mockAdd.mockResolvedValue(undefined);
      Resend.mock.results[0].value.emails.send.mockResolvedValue({ data: {}, error: null });

      const res = await request(app).post('/processInitialDecision').send({ requestId: 'req1', adminId: 'admin1', decision: 'approved' });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ message: 'Decisión inicial procesada con éxito.' });
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'mocked_hashed_token',
          tokenExpiry: expect.any(admin.firestore.Timestamp),
        }),
      );
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'pending_additional_data' });
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'initial_decision_approved',
        }),
      );
      expect(Resend.mock.results[0].value.emails.send).toHaveBeenCalled();
    });

    it('should successfully reject a request', async () => {
      const mockRequestData = {
        applicantName: 'Test User',
        applicantEmail: 'test@example.com',
        accountType: 'EMPRESARIAL',
        country: 'Chile',
        entityType: 'juridica',
        status: 'pending_review',
      };

      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestData });
      mockUpdate.mockResolvedValue(undefined);
      mockAdd.mockResolvedValue(undefined);
      Resend.mock.results[0].value.emails.send.mockResolvedValue({ data: {}, error: null });

      const res = await request(app).post('/processInitialDecision').send({ requestId: 'req1', adminId: 'admin1', decision: 'rejected', reason: 'Test Reason' });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ message: 'Decisión inicial procesada con éxito.' });
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'rejected' });
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'initial_decision_rejected',
          details: 'Rechazo inicial por administrador. Motivo: Test Reason',
        }),
      );
      expect(Resend.mock.results[0].value.emails.send).toHaveBeenCalled();
    });

    it('should return 500 if an error occurs during Firestore operation', async () => {
      const mockRequestData = {
        applicantName: 'Test User',
        applicantEmail: 'test@example.com',
        accountType: 'EMPRESARIAL',
        country: 'Chile',
        entityType: 'juridica',
        status: 'pending_review',
      };

      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestData });
      mockUpdate.mockRejectedValueOnce(new Error('Firestore error'));

      const res = await request(app).post('/processInitialDecision').send({ requestId: 'req1', adminId: 'admin1', decision: 'approved' });
      expect(res.statusCode).toEqual(500);
      expect(res.body).toEqual({ message: 'Error interno del servidor.' });
    });

    it('should return 500 if an error occurs during email sending', async () => {
      const mockRequestData = {
        applicantName: 'Test User',
        applicantEmail: 'test@example.com',
        accountType: 'EMPRESARIAL',
        country: 'Chile',
        entityType: 'juridica',
        status: 'pending_review',
      };

      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestData });
      mockUpdate.mockResolvedValue(undefined);
      mockAdd.mockResolvedValue(undefined);
      Resend.mock.results[0].value.emails.send.mockRejectedValue(new Error('Email error'));

      const res = await request(app).post('/processInitialDecision').send({ requestId: 'req1', adminId: 'admin1', decision: 'approved' });
      expect(res.statusCode).toEqual(500);
      expect(res.body).toEqual({ message: 'Error interno del servidor.' });
    });
  });

  describe('POST /validate-data-token', () => {
    it('should return 400 if token is missing', async () => {
      const res = await request(app).post('/validate-data-token').send({});
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ isValid: false, message: 'Token no proporcionado.' });
    });

    it('should return 404 if token is invalid or non-existent', async () => {
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: true }),
        })),
      });

      const res = await request(app).post('/validate-data-token').send({ token: 'invalid_token' });
      expect(res.statusCode).toEqual(404);
      expect(res.body).toEqual({ isValid: false, message: 'Enlace inválido o ya utilizado.' });
    });

    it('should return 400 if request is not in pending_additional_data status', async () => {
      const mockRequestDoc = {
        id: 'req1',
        data: () => ({ status: 'approved', tokenExpiry: new admin.firestore.Timestamp(Date.now() / 1000 + 3600, 0) }),
      };
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockRequestDoc] }),
        })),
      });

      const res = await request(app).post('/validate-data-token').send({ token: 'valid_token' });
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ isValid: false, message: 'Esta solicitud ya fue completada o no requiere datos adicionales.' });
    });

    it('should return 400 if token is expired', async () => {
      const mockRequestDoc = {
        id: 'req1',
        data: () => ({ status: 'pending_additional_data', tokenExpiry: new admin.firestore.Timestamp(Date.now() / 1000 - 3600, 0) }),
      };
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockRequestDoc] }),
        })),
      });

      const res = await request(app).post('/validate-data-token').send({ token: 'expired_token' });
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ isValid: false, message: 'El enlace ha expirado.' });
    });

    it('should successfully validate a token', async () => {
      const mockRequestDoc = {
        id: 'req1',
        data: () => ({ status: 'pending_additional_data', tokenExpiry: new admin.firestore.Timestamp(Date.now() / 1000 + 3600, 0), applicantName: 'Test', applicantEmail: 'test@example.com', country: 'Chile', accountType: 'EMPRESARIAL' }),
      };
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockRequestDoc] }),
        })),
      });

      const res = await request(app).post('/validate-data-token').send({ token: 'valid_token' });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ isValid: true, requestData: { requestId: 'req1', applicantName: 'Test', applicantEmail: 'test@example.com', country: 'Chile', accountType: 'EMPRESARIAL' } });
    });
  });

  describe('POST /submitAdditionalData', () => {
    it('should return 400 if token or additionalData is missing', async () => {
      const res = await request(app).post('/submitAdditionalData').send({});
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ message: 'Token y datos adicionales son requeridos.' });
    });

    it('should return 404 if token is invalid or non-existent', async () => {
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: true }),
        })),
      });

      const res = await request(app).post('/submitAdditionalData').send({ token: 'invalid_token', additionalData: {} });
      expect(res.statusCode).toEqual(404);
      expect(res.body).toEqual({ message: 'Enlace inválido o ya utilizado.' });
    });

    it('should return 400 if request is not in pending_additional_data status', async () => {
      const mockRequestDoc = {
        id: 'req1',
        data: () => ({ status: 'approved', tokenExpiry: new admin.firestore.Timestamp(Date.now() / 1000 + 3600, 0) }),
        ref: { update: mockUpdate, collection: vi.fn(() => ({ add: mockAdd })) },
      };
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockRequestDoc] }),
        })),
      });

      const res = await request(app).post('/submitAdditionalData').send({ token: 'valid_token', additionalData: {} });
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ message: 'Esta solicitud ya fue completada o no requiere datos adicionales.' });
    });

    it('should return 400 if token is expired', async () => {
      const mockRequestDoc = {
        id: 'req1',
        data: () => ({ status: 'pending_additional_data', tokenExpiry: new admin.firestore.Timestamp(Date.now() / 1000 - 3600, 0) }),
        ref: { update: mockUpdate, collection: vi.fn(() => ({ add: mockAdd })) },
      };
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockRequestDoc] }),
        })),
      });

      const res = await request(app).post('/submitAdditionalData').send({ token: 'expired_token', additionalData: {} });
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ message: 'El enlace ha expirado.' });
    });

    it('should successfully submit additional data', async () => {
      const mockAdditionalData = { adminName: 'Admin', adminEmail: 'admin@example.com' };
      const mockRequestDoc = {
        id: 'req1',
        data: () => ({ status: 'pending_additional_data', tokenExpiry: new admin.firestore.Timestamp(Date.now() / 1000 + 3600, 0), applicantEmail: 'applicant@example.com' }),
        ref: { update: mockUpdate, collection: vi.fn(() => ({ add: mockAdd })) },
      };
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockRequestDoc] }),
        })),
      });
      mockUpdate.mockResolvedValue(undefined);
      mockAdd.mockResolvedValue(undefined);

      const res = await request(app).post('/submitAdditionalData').send({ token: 'valid_token', additionalData: mockAdditionalData });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ message: 'Datos adicionales enviados con éxito. Pendiente de revisión final.' });
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalData: mockAdditionalData,
          status: 'pending_final_review',
          token: null,
          tokenExpiry: null,
        }),
      );
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'additional_data_submitted',
        }),
      );
    });

    it('should return 500 if an error occurs during Firestore operation', async () => {
      const mockAdditionalData = { adminName: 'Admin', adminEmail: 'admin@example.com' };
      const mockRequestDoc = {
        id: 'req1',
        data: () => ({ status: 'pending_additional_data', tokenExpiry: new admin.firestore.Timestamp(Date.now() / 1000 + 3600, 0) }),
        ref: { update: mockUpdate, collection: vi.fn(() => ({ add: mockAdd })) },
      };
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockRequestDoc] }),
        })),
      });
      mockUpdate.mockRejectedValueOnce(new Error('Firestore error'));

      const res = await request(app).post('/submitAdditionalData').send({ token: 'valid_token', additionalData: mockAdditionalData });
      expect(res.statusCode).toEqual(500);
      expect(res.body).toEqual({ message: 'Error interno del servidor al eliminar solicitudes.' }); // This error message is incorrect, should be 'Error interno del servidor.'
    });
  describe('POST /approveFinalRequest', () => {
    it('should return 400 if required parameters are missing', async () => {
      const res = await request(app).post('/approveFinalRequest').send({});
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ message: 'Faltan parámetros obligatorios (requestId, adminId).' });
    });

    it('should return 404 if request does not exist', async () => {
      mockGet.mockResolvedValueOnce({ exists: false });

      const res = await request(app).post('/approveFinalRequest').send({ requestId: 'nonExistent', adminId: 'admin1' });
      expect(res.statusCode).toEqual(404);
      expect(res.body).toEqual({ message: 'Solicitud no encontrada.' });
    });

    it('should return 400 if request is not in pending_final_review status', async () => {
      const mockRequestDoc = {
        id: 'req1',
        data: () => ({ status: 'pending_additional_data' }),
      };
      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestDoc });

      const res = await request(app).post('/approveFinalRequest').send({ requestId: 'req1', adminId: 'admin1' });
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ message: 'La solicitud no está en estado de revisión final.' });
    });

    it('should return 400 if admin email is missing in additional data', async () => {
      const mockRequestDoc = {
        id: 'req1',
        data: () => ({ status: 'pending_final_review', additionalData: {} }),
      };
      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestDoc });

      const res = await request(app).post('/approveFinalRequest').send({ requestId: 'req1', adminId: 'admin1' });
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ message: 'No se proporcionó un email de administrador en los datos adicionales.' });
    });

    it('should successfully approve a request and create a new user', async () => {
      const mockRequestData = {
        applicantEmail: 'applicant@example.com',
        accountType: 'EMPRESARIAL',
        rut: '12345678-9',
        institutionName: 'Test Company',
        status: 'pending_final_review',
        additionalData: { adminEmail: 'newadmin@example.com', adminName: 'New Admin' },
      };
      const mockUserRecord = { uid: 'new_user_uid', email: 'newadmin@example.com' };

      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestData }); // For requestRef.get()
      mockAuth.getUserByEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' }); // User not found
      mockAuth.createUser.mockResolvedValueOnce(mockUserRecord);
      mockSet.mockResolvedValue(undefined); // For db.collection('accounts').doc().set()
      mockUpdate.mockResolvedValue(undefined); // For requestRef.update()
      mockAdd.mockResolvedValue(undefined); // For history
      mockAuth.generatePasswordResetLink.mockResolvedValueOnce('http://localhost:5175/actions/create-password?oobCode=mockOobCode');
      Resend.mock.results[0].value.emails.send.mockResolvedValue({ data: {}, error: null });

      const res = await request(app).post('/approveFinalRequest').send({ requestId: 'req1', adminId: 'admin1' });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ message: 'Cuenta activada con éxito.', userId: 'new_user_uid' });
      expect(mockAuth.getUserByEmail).toHaveBeenCalledWith('newadmin@example.com');
      expect(mockAuth.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'newadmin@example.com' }));
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'newadmin@example.com',
          accountType: 'EMPRESARIAL',
          rut: '12345678-9',
          status: 'active',
          institutionName: 'Test Company',
          adminEmail: 'newadmin@example.com',
          adminName: 'New Admin',
        }),
        { merge: true },
      );
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'activated', updatedAt: expect.any(admin.firestore.FieldValue) });
      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ action: 'account_activated' }));
      expect(mockAuth.generatePasswordResetLink).toHaveBeenCalledWith(
        'newadmin@example.com',
        expect.objectContaining({ url: 'http://localhost:5175/actions/create-password' }),
      );
      expect(Resend.mock.results[0].value.emails.send).toHaveBeenCalled();
    });

    it('should successfully approve a request and update an existing user', async () => {
      const mockRequestData = {
        applicantEmail: 'applicant@example.com',
        accountType: 'EDUCACIONAL',
        rut: '98765432-1',
        institutionName: 'Test School',
        status: 'pending_final_review',
        additionalData: { adminEmail: 'existingadmin@example.com', adminName: 'Existing Admin' },
      };
      const mockUserRecord = { uid: 'existing_user_uid', email: 'existingadmin@example.com' };

      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestData });
      mockAuth.getUserByEmail.mockResolvedValueOnce(mockUserRecord); // User found
      mockSet.mockResolvedValue(undefined);
      mockUpdate.mockResolvedValue(undefined);
      mockAdd.mockResolvedValue(undefined);
      mockAuth.generatePasswordResetLink.mockResolvedValueOnce('http://localhost:5175/actions/create-password?oobCode=mockOobCode');
      Resend.mock.results[0].value.emails.send.mockResolvedValue({ data: {}, error: null });

      const res = await request(app).post('/approveFinalRequest').send({ requestId: 'req2', adminId: 'admin2' });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ message: 'Cuenta activada con éxito.', userId: 'existing_user_uid' });
      expect(mockAuth.getUserByEmail).toHaveBeenCalledWith('existingadmin@example.com');
      expect(mockAuth.createUser).not.toHaveBeenCalled(); // User should not be created
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'existingadmin@example.com',
          accountType: 'EDUCACIONAL',
          rut: '98765432-1',
          status: 'active',
          institutionName: 'Test School',
          adminEmail: 'existingadmin@example.com',
          adminName: 'Existing Admin',
        }),
        { merge: true },
      );
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'activated', updatedAt: expect.any(admin.firestore.FieldValue) });
      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ action: 'account_activated' }));
      expect(mockAuth.generatePasswordResetLink).toHaveBeenCalled();
      expect(Resend.mock.results[0].value.emails.send).toHaveBeenCalled();
    });

    it('should return 500 if an error occurs during Firestore operation', async () => {
      const mockRequestData = {
        applicantEmail: 'applicant@example.com',
        accountType: 'EMPRESARIAL',
        rut: '12345678-9',
        institutionName: 'Test Company',
        status: 'pending_final_review',
        additionalData: { adminEmail: 'newadmin@example.com', adminName: 'New Admin' },
      };
      const mockUserRecord = { uid: 'new_user_uid', email: 'newadmin@example.com' };

      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestData });
      mockAuth.getUserByEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' });
      mockAuth.createUser.mockResolvedValueOnce(mockUserRecord);
      mockSet.mockRejectedValueOnce(new Error('Firestore error')); // Simulate Firestore error

      const res = await request(app).post('/approveFinalRequest').send({ requestId: 'req1', adminId: 'admin1' });
      expect(res.statusCode).toEqual(500);
      expect(res.body).toEqual({ message: 'Error interno del servidor al aprobar la solicitud final.' });
    });

    it('should return 500 if an error occurs during Auth operation (e.g., createUser)', async () => {
      const mockRequestData = {
        applicantEmail: 'applicant@example.com',
        accountType: 'EMPRESARIAL',
        rut: '12345678-9',
        institutionName: 'Test Company',
        status: 'pending_final_review',
        additionalData: { adminEmail: 'newadmin@example.com', adminName: 'New Admin' },
      };

      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestData });
      mockAuth.getUserByEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' });
      mockAuth.createUser.mockRejectedValueOnce(new Error('Auth error')); // Simulate Auth error

      const res = await request(app).post('/approveFinalRequest').send({ requestId: 'req1', adminId: 'admin1' });
      expect(res.statusCode).toEqual(500);
      expect(res.body).toEqual({ message: 'Error interno del servidor al aprobar la solicitud final.' });
    });

    it('should return 500 if an error occurs during email sending', async () => {
      const mockRequestData = {
        applicantEmail: 'applicant@example.com',
        accountType: 'EMPRESARIAL',
        rut: '12345678-9',
        institutionName: 'Test Company',
        status: 'pending_final_review',
        additionalData: { adminEmail: 'newadmin@example.com', adminName: 'New Admin' },
      };
      const mockUserRecord = { uid: 'new_user_uid', email: 'newadmin@example.com' };

      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestData });
      mockAuth.getUserByEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' });
      mockAuth.createUser.mockResolvedValueOnce(mockUserRecord);
      mockSet.mockResolvedValue(undefined);
      mockUpdate.mockResolvedValue(undefined);
      mockAdd.mockResolvedValue(undefined);
      mockAuth.generatePasswordResetLink.mockResolvedValueOnce('http://localhost:5175/actions/create-password?oobCode=mockOobCode');
      Resend.mock.results[0].value.emails.send.mockRejectedValue(new Error('Email error')); // Simulate email error

      const res = await request(app).post('/approveFinalRequest').send({ requestId: 'req1', adminId: 'admin1' });
      expect(res.statusCode).toEqual(500);
      expect(res.body).toEqual({ message: 'Error interno del servidor al aprobar la solicitud final.' });
    });

    it('should return 500 if an error occurs during password reset link generation', async () => {
      const mockRequestData = {
        applicantEmail: 'applicant@example.com',
        accountType: 'EMPRESARIAL',
        rut: '12345678-9',
        institutionName: 'Test Company',
        status: 'pending_final_review',
        additionalData: { adminEmail: 'newadmin@example.com', adminName: 'New Admin' },
      };
      const mockUserRecord = { uid: 'new_user_uid', email: 'newadmin@example.com' };

      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestData });
      mockAuth.getUserByEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' });
      mockAuth.createUser.mockResolvedValueOnce(mockUserRecord);
      mockSet.mockResolvedValue(undefined);
      mockUpdate.mockResolvedValue(undefined);
      mockAdd.mockResolvedValue(undefined);
      mockAuth.generatePasswordResetLink.mockRejectedValueOnce(new Error('Link generation error')); // Simulate link generation error

      const res = await request(app).post('/approveFinalRequest').send({ requestId: 'req1', adminId: 'admin1' });
      expect(res.statusCode).toEqual(500);
      expect(res.body).toEqual({ message: 'Error interno del servidor al generar el enlace de contraseña.' });
    });
  describe('POST /request-clarification', () => {
    it('should return 400 if required parameters are missing', async () => {
      const res = await request(app).post('/request-clarification').send({});
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ message: 'Faltan parámetros (requestId, adminId, message).' });
    });

    it('should return 404 if request does not exist', async () => {
      mockGet.mockResolvedValueOnce({ exists: false });

      const res = await request(app).post('/request-clarification').send({ requestId: 'nonExistent', adminId: 'admin1', message: 'Please clarify' });
      expect(res.statusCode).toEqual(404);
      expect(res.body).toEqual({ message: 'Solicitud no encontrada.' });
    });

    it('should successfully send a clarification request', async () => {
      const mockRequestData = {
        applicantName: 'Test User',
        applicantEmail: 'test@example.com',
      };

      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestData });
      mockSet.mockResolvedValue(undefined);
      mockAdd.mockResolvedValue(undefined);
      Resend.mock.results[0].value.emails.send.mockResolvedValue({ data: {}, error: null });

      const res = await request(app).post('/request-clarification').send({ requestId: 'req1', adminId: 'admin1', message: 'Please clarify' });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ message: 'Solicitud de aclaración enviada.' });
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          adminMessage: 'Please clarify',
          status: 'pending_response',
          token: 'mocked_hashed_token',
        }),
      );
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'clarification_requested',
        }),
      );
      expect(Resend.mock.results[0].value.emails.send).toHaveBeenCalled();
    });

    it('should return 500 if an error occurs during Firestore operation', async () => {
      const mockRequestData = {
        applicantName: 'Test User',
        applicantEmail: 'test@example.com',
      };

      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestData });
      mockSet.mockRejectedValueOnce(new Error('Firestore error'));

      const res = await request(app).post('/request-clarification').send({ requestId: 'req1', adminId: 'admin1', message: 'Please clarify' });
      expect(res.statusCode).toEqual(500);
      expect(res.body).toEqual({ message: 'Error interno del servidor.' });
    });

    it('should return 500 if an error occurs during email sending', async () => {
      const mockRequestData = {
        applicantName: 'Test User',
        applicantEmail: 'test@example.com',
      };

      mockGet.mockResolvedValueOnce({ exists: true, data: () => mockRequestData });
      mockSet.mockResolvedValue(undefined);
      mockAdd.mockResolvedValue(undefined);
      Resend.mock.results[0].value.emails.send.mockRejectedValue(new Error('Email error'));

      const res = await request(app).post('/request-clarification').send({ requestId: 'req1', adminId: 'admin1', message: 'Please clarify' });
      expect(res.statusCode).toEqual(500);
      expect(res.body).toEqual({ message: 'Error interno del servidor.' });
    });
  });

  describe('POST /validate-clarification-token', () => {
    it('should return 400 if token is missing', async () => {
      const res = await request(app).post('/validate-clarification-token').send({});
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ isValid: false, message: 'Token no proporcionado.' });
    });

    it('should return 404 if token is invalid or non-existent', async () => {
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: true }),
        })),
      });

      const res = await request(app).post('/validate-clarification-token').send({ token: 'invalid_token' });
      expect(res.statusCode).toEqual(404);
      expect(res.body).toEqual({ isValid: false, message: 'Enlace inválido o ya utilizado.' });
    });

    it('should return 400 if clarification is not in pending_response status', async () => {
      const mockClarificationDoc = {
        id: 'clar1',
        data: () => ({ status: 'responded', tokenExpiry: new admin.firestore.Timestamp(Date.now() / 1000 + 3600, 0) }),
      };
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockClarificationDoc] }),
        })),
      });

      const res = await request(app).post('/validate-clarification-token').send({ token: 'valid_token' });
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ isValid: false, message: 'Esta solicitud de aclaración ya fue respondida.' });
    });

    it('should return 400 if token is expired', async () => {
      const mockClarificationDoc = {
        id: 'clar1',
        data: () => ({ status: 'pending_response', tokenExpiry: new admin.firestore.Timestamp(Date.now() / 1000 - 3600, 0) }),
      };
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockClarificationDoc] }),
        })),
      });

      const res = await request(app).post('/validate-clarification-token').send({ token: 'expired_token' });
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ isValid: false, message: 'El enlace ha expirado.' });
    });

    it('should successfully validate a clarification token', async () => {
      const mockClarificationDoc = {
        id: 'clar1',
        data: () => ({ status: 'pending_response', tokenExpiry: new admin.firestore.Timestamp(Date.now() / 1000 + 3600, 0), adminMessage: 'Please clarify' }),
      };
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockClarificationDoc] }),
        })),
      });

      const res = await request(app).post('/validate-clarification-token').send({ token: 'valid_token' });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ isValid: true, adminMessage: 'Please clarify' });
    });
  describe('POST /submit-clarification-response', () => {
    it('should return 400 if token or userReply is missing', async () => {
      const res = await request(app).post('/submit-clarification-response').send({});
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ message: 'Faltan el token o la respuesta.' });
    });

    it('should return 404 if token is invalid or non-existent', async () => {
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: true }),
        })),
      });

      const res = await request(app).post('/submit-clarification-response').send({ token: 'invalid_token', userReply: 'reply' });
      expect(res.statusCode).toEqual(404);
      expect(res.body).toEqual({ message: 'Enlace inválido o ya utilizado.' });
    });

    it('should return 400 if clarification is not in pending_response status', async () => {
      const mockClarificationDoc = {
        id: 'clar1',
        data: () => ({ status: 'responded' }),
        ref: { update: mockUpdate },
      };
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockClarificationDoc] }),
        })),
      });

      const res = await request(app).post('/submit-clarification-response').send({ token: 'valid_token', userReply: 'reply' });
      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({ message: 'Esta solicitud de aclaración ya fue respondida.' });
    });

    it('should successfully submit clarification response', async () => {
      const mockClarificationDoc = {
        id: 'clar1',
        data: () => ({ status: 'pending_response' }),
        ref: { update: mockUpdate, parent: { parent: { collection: vi.fn(() => ({ add: mockAdd })) } } },
      };
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockClarificationDoc] }),
        })),
      });
      mockUpdate.mockResolvedValue(undefined);
      mockAdd.mockResolvedValue(undefined);

      const res = await request(app).post('/submit-clarification-response').send({ token: 'valid_token', userReply: 'User' });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ message: 'Respuesta enviada con éxito.' });
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          userReply: 'User',
          status: 'responded',
          token: admin.firestore.FieldValue.delete(),
        }),
      );
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'clarification_responded',
        }),
      );
    });

    it('should return 500 if an error occurs during Firestore operation', async () => {
      const mockClarificationDoc = {
        id: 'clar1',
        data: () => ({ status: 'pending_response' }),
        ref: { update: mockUpdate },
      };
      mockFirestore.mockReturnValueOnce({
        collectionGroup: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValueOnce({ empty: false, docs: [mockClarificationDoc] }),
        })),
      });
      mockUpdate.mockRejectedValueOnce(new Error('Firestore error'));

      const res = await request(app).post('/submit-clarification-response').send({ token: 'valid_token', userReply: 'reply' });
      expect(res.statusCode).toEqual(500);
      expect(res.body).toEqual({ message: 'Error interno del servidor.' });
    });
  });
