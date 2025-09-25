import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import http from 'http';
import { createApp } from './index';
import * as admin from 'firebase-admin';

// Mock Firebase Admin SDK
const mockAuth = {
  verifyIdToken: vi.fn(),
  getUser: vi.fn(), // Add this line
};

const mockFirestore = {
  collection: vi.fn(() => mockFirestore),
  doc: vi.fn(() => mockFirestore),
  get: vi.fn(),
  set: vi.fn(),
  add: vi.fn(),
  orderBy: vi.fn(() => mockFirestore),
  // Mock for transaction
  runTransaction: vi.fn((callback) => callback(mockFirestore)),
};

vi.mock('firebase-admin', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    initializeApp: vi.fn(),
    auth: vi.fn(() => mockAuth),
    firestore: Object.assign(vi.fn(() => mockFirestore), {
      FieldValue: {
        serverTimestamp: vi.fn(() => 'MOCKED_TIMESTAMP'),
      },
    }),
  };
});

// Inyectamos nuestros "actores falsos" al crear la app de prueba
// createApp now expects admin.auth() and admin.firestore()
const app = createApp(admin.auth() as any, admin.firestore() as any, admin, admin.firestore.FieldValue);
const server = http.createServer(app);

describe('Transactions Service API', () => {

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    vi.clearAllMocks(); // Clear all mocks before each test

    // Reset mock implementations for Firestore and Auth
    mockAuth.verifyIdToken.mockResolvedValue({ uid: 'user-abc' }); // Default valid user

    // Add mock for admin.auth().getUser
    mockAuth.getUser.mockResolvedValue({
      uid: 'user-abc',
      customClaims: { admin: true }, // Add customClaims
    } as any);

    // Default Firestore mocks
    mockFirestore.collection.mockReturnThis();
    mockFirestore.doc.mockReturnThis();
    mockFirestore.get.mockResolvedValue({ exists: true, data: () => ({ members: ['user-abc'] }) }); // Default project member
    mockFirestore.set.mockResolvedValue(true);
    mockFirestore.add.mockResolvedValue({ id: 'new-txn-id' });
    mockFirestore.orderBy.mockReturnThis();
    mockFirestore.runTransaction.mockImplementation((callback) => callback(mockFirestore));

    // Mock for docs in get calls
    mockFirestore.get.mockImplementation(function() {
      if (this.__isCollection) {
        // If it's a collection get, return docs array
        return Promise.resolve({ docs: [] });
      } else {
        // If it's a doc get, return single doc
        return Promise.resolve({ exists: true, data: () => ({ members: ['user-abc'] }) });
      }
    });
  });

  describe('Security Middleware', () => {
    it('should return 401 Unauthorized if no Authorization header is provided', async () => {
      const response = await request(server).post('/projects/test-project/transactions').send({});
      expect(response.status).toBe(401);
    });

    it('should return 403 Forbidden if the token is invalid', async () => {
      mockAuth.verifyIdToken.mockRejectedValue(new Error('Token inválido!'));

      const response = await request(server)
        .post('/projects/test-project/transactions')
        .set('Authorization', 'Bearer invalid-token')
        .send({});
      
      expect(response.status).toBe(403);
    });
  });

  describe('GET /projects/:projectId/transactions', () => {
    const validToken = 'valid-token';
    const validUser = { uid: 'user-abc' };
    const projectId = 'project-123';

    beforeEach(() => {
      mockAuth.verifyIdToken.mockResolvedValue(validUser);
    });

    it('should return 403 Forbidden if user is not a member of the project', async () => {
      mockFirestore.get.mockResolvedValueOnce({ exists: true, data: () => ({ members: ['user-xyz'] }) }); // Project exists, but user not member

      const response = await request(server)
        .get(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Prohibido: No es miembro del proyecto o el proyecto no existe.');
    });

    it('should return 200 OK and a list of transactions if user is authorized', async () => {
      const mockTransactions = [
        { id: 'txn-1', type: 'income', amount: 100, description: 'Salary', createdAt: new Date().toISOString() },
        { id: 'txn-2', type: 'expense', amount: 50, description: 'Groceries', createdAt: new Date().toISOString() },
      ];

      // Mock project member check
      mockFirestore.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
              collection: vi.fn((subCollectionPath: string) => {
                if (subCollectionPath === 'transactions') {
                  return {
                    orderBy: vi.fn(() => ({
                      get: vi.fn(() => Promise.resolve({
                        docs: mockTransactions.map(txn => ({
                          id: txn.id,
                          data: () => txn,
                        })),
                      })),
                    })),
                  };
                }
                return mockFirestore; // Return mockFirestore for other collections
              }),
            })),
          };
        }
        return mockFirestore; // Return mockFirestore for other collections
      });

      const response = await request(server)
        .get(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockTransactions);
    });

    it('should return 200 OK and an empty array if no transactions are found', async () => {
      // Mock project member check
      mockFirestore.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
              collection: vi.fn((subCollectionPath: string) => {
                if (subCollectionPath === 'transactions') {
                  return {
                    orderBy: vi.fn(() => ({
                      get: vi.fn(() => Promise.resolve({
                        docs: [],
                      })),
                    })),
                  };
                }
                return mockFirestore; // Return mockFirestore for other collections
              }),
            })),
          };
        }
        return mockFirestore; // Return mockFirestore for other collections
      });

      const response = await request(server)
        .get(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return 500 Internal Server Error if Firestore operation fails', async () => {
      // Mock project member check
      mockFirestore.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
              collection: vi.fn((subCollectionPath: string) => {
                if (subCollectionPath === 'transactions') {
                  return {
                    orderBy: vi.fn(() => ({
                      get: vi.fn(() => Promise.reject(new Error('Firestore error'))),
                    })),
                  };
                }
                return mockFirestore; // Return mockFirestore for other collections
              }),
            })),
          };
        }
        return mockFirestore; // Return mockFirestore for other collections
      });

      const response = await request(server)
        .get(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(500);
      expect(response.body.message).toBe('Error al obtener transacciones.');
    });
  });

  describe('POST /projects/:projectId/transactions', () => {
    const validToken = 'valid-token';
    const validUser = { uid: 'user-abc' };
    const projectId = 'project-123';
    const newTransaction = { type: 'expense', amount: 50, description: 'Test Expense' };

    beforeEach(() => {
      mockAuth.verifyIdToken.mockResolvedValue(validUser);
    });

    it('should return 403 Forbidden if user is not a member of the project', async () => {
      mockFirestore.get.mockResolvedValueOnce({ exists: true, data: () => ({ members: ['user-xyz'] }) }); // Project exists, but user not member

      const response = await request(server)
        .post(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`)
        .send(newTransaction);

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Prohibido: No es miembro del proyecto o el proyecto no existe.');
    });

    it('should return 201 Created if user is authorized and data is valid', async () => {
      // Mock project member check
      mockFirestore.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
              collection: vi.fn((subCollectionPath: string) => {
                if (subCollectionPath === 'transactions') {
                  return mockFirestore; // Return the global mockFirestore for transactions collection
                }
                return mockFirestore; // Return mockFirestore for other collections
              }),
            })),
          };
        }
        return mockFirestore; // Return mockFirestore for other collections
      });

      const response = await request(server)
        .post(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`)
        .send(newTransaction);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: 'new-txn-id', ...newTransaction, createdAt: expect.any(String) });
      expect(mockFirestore.add).toHaveBeenCalledWith({
        ...newTransaction,
        createdAt: 'MOCKED_TIMESTAMP',
      });
    });

    it.each(['type', 'description'])('should return 400 Bad Request if %s is missing', async (field) => {
      // Mock project member check
      mockFirestore.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
            })),
          };
        }
        return mockFirestore; // Return mockFirestore for other collections
      });

      const invalidTransaction = { ...newTransaction };
      delete invalidTransaction[field as keyof typeof invalidTransaction];

      const response = await request(server)
        .post(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`)
        .send(invalidTransaction);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Faltan campos requeridos');
    });

    it('should return 400 Bad Request if amount is missing', async () => {
      // Mock project member check
      mockFirestore.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
            })),
          };
        }
        return mockFirestore; // Return mockFirestore for other collections
      });

      const invalidTransaction = { ...newTransaction };
      delete invalidTransaction.amount;

      const response = await request(server)
        .post(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`)
        .send(invalidTransaction);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Faltan campos requeridos');
    });

    it.each([0, -10, 'not-a-number'])('should return 400 Bad Request for invalid amount: %s', async (invalidAmount) => {
      // Mock project member check
      mockFirestore.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
            })),
          };
        }
        return mockFirestore; // Return mockFirestore for other collections
      });

      const invalidTransaction = { ...newTransaction, amount: invalidAmount };

      const response = await request(server)
        .post(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`)
        .send(invalidTransaction);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('El campo amount debe ser un número positivo.');
    });

    it('should return 500 Internal Server Error if Firestore operation fails', async () => {
      // Mock project member check
      mockFirestore.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
              collection: vi.fn((subCollectionPath: string) => {
                if (subCollectionPath === 'transactions') {
                  return {
                    add: vi.fn(() => Promise.reject(new Error('Firestore error'))),
                  };
                }
                return mockFirestore; // Return mockFirestore for other collections
              }),
            })),
          };
        }
        return mockFirestore; // Return mockFirestore for other collections
      });

      const response = await request(server)
        .post(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`)
        .send(newTransaction);

      expect(response.status).toBe(500);
      expect(response.body.message).toBe('Error al crear transacción.');
    });
  });
});