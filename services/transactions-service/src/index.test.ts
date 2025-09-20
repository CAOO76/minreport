import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import http from 'http';
import { createApp } from './index';

// --- Creación de Dependencias Falsas (Mocks) ---
const mockAuth = {
  verifyIdToken: vi.fn(),
};

const mockDb = {
  collection: vi.fn(() => ({
    doc: vi.fn(() => ({
      get: vi.fn(),
      set: vi.fn(),
    })),
    add: vi.fn(),
    orderBy: vi.fn(() => ({
      get: vi.fn(),
    })),
  })),
};

// Inyectamos nuestros "actores falsos" al crear la app de prueba
const app = createApp(mockAuth as any, mockDb as any);
const server = http.createServer(app);
// --- Fin de la Preparación ---

describe('Transactions Service API', () => {

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    mockAuth.verifyIdToken.mockReset();
    // Resetear mocks de Firestore
    mockDb.collection.mockReset();
  });

  describe('Security Middleware', () => {
    it('should return 401 Unauthorized if no Authorization header is provided', async () => {
      const response = await request(server).post('/projects/test-project/transactions').send({});
      expect(response.status).toBe(401);
    });

    it('should return 403 Forbidden if the token is invalid', async () => {
      // Configuramos el mock para que simule un token inválido
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
      mockDb.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn((docId: string) => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: ['user-xyz'] }) })),
            })),
          };
        }
        return {};
      });

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

      mockDb.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn((docId: string) => ({
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
                return {};
              }),
            })),
          };
        }
        return {};
      });

      const response = await request(server)
        .get(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockTransactions);
    });

    it('should return 200 OK and an empty array if no transactions are found', async () => {
      mockDb.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn((docId: string) => ({
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
                return {};
              }),
            })),
          };
        }
        return {};
      });

      const response = await request(server)
        .get(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return 500 Internal Server Error if Firestore operation fails', async () => {
      mockDb.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn((docId: string) => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
              collection: vi.fn((subCollectionPath: string) => {
                if (subCollectionPath === 'transactions') {
                  return {
                    orderBy: vi.fn(() => ({
                      get: vi.fn(() => Promise.reject(new Error('Firestore error'))),
                    })),
                  };
                }
                return {};
              }),
            })),
          };
        }
        return {};
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
      mockDb.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn((docId: string) => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: ['user-xyz'] }) })),
            })),
          };
        }
        return {};
      });

      const response = await request(server)
        .post(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`)
        .send(newTransaction);

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Prohibido: No es miembro del proyecto o el proyecto no existe.');
    });

    it('should return 201 Created if user is authorized and data is valid', async () => {
      const mockDocRef = { id: 'new-txn-id' };
      let addMock: any; // Declare addMock here

      mockDb.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn((docId: string) => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
              collection: vi.fn((subCollectionPath: string) => {
                if (subCollectionPath === 'transactions') {
                  addMock = vi.fn(() => Promise.resolve(mockDocRef)); // Assign to addMock
                  return {
                    add: addMock,
                  };
                }
                return {};
              }),
            })),
          };
        }
        return {};
      });

      const response = await request(server)
        .post(`/projects/${projectId}/transactions`)
        .set('Authorization', `Bearer ${validToken}`)
        .send(newTransaction);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: mockDocRef.id, ...newTransaction, createdAt: expect.any(String) });
      expect(addMock).toHaveBeenCalledWith({ // Assert on captured addMock
        ...newTransaction,
        createdAt: expect.any(Object), // admin.firestore.FieldValue.serverTimestamp() is an object
      });
    });

    it.each(['type', 'description'])('should return 400 Bad Request if %s is missing', async (field) => {
      mockDb.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn((docId: string) => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
            })),
          };
        }
        return {};
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
      mockDb.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn((docId: string) => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
            })),
          };
        }
        return {};
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
      mockDb.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn((docId: string) => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
            })),
          };
        }
        return {};
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
      mockDb.collection.mockImplementation((path: string) => {
        if (path === 'projects') {
          return {
            doc: vi.fn((docId: string) => ({
              get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
              collection: vi.fn((subCollectionPath: string) => {
                if (subCollectionPath === 'transactions') {
                  return {
                    add: vi.fn(() => Promise.reject(new Error('Firestore error'))),
                  };
                }
                return {};
              }),
            })),
          };
        }
        return {};
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
