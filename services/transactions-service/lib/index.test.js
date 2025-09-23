"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const http_1 = __importDefault(require("http"));
const index_1 = require("./index");
// --- Creación de Dependencias Falsas (Mocks) ---
const mockAuth = {
    verifyIdToken: vitest_1.vi.fn(),
};
const mockDb = {
    collection: vitest_1.vi.fn(() => ({
        doc: vitest_1.vi.fn(() => ({
            get: vitest_1.vi.fn(),
            set: vitest_1.vi.fn(),
        })),
        add: vitest_1.vi.fn(),
        orderBy: vitest_1.vi.fn(() => ({
            get: vitest_1.vi.fn(),
        })),
    })),
};
// Inyectamos nuestros "actores falsos" al crear la app de prueba
const app = (0, index_1.createApp)(mockAuth, mockDb);
const server = http_1.default.createServer(app);
// --- Fin de la Preparación ---
(0, vitest_1.describe)('Transactions Service API', () => {
    (0, vitest_1.afterAll)((done) => {
        server.close(done);
    });
    (0, vitest_1.beforeEach)(() => {
        mockAuth.verifyIdToken.mockReset();
        // Resetear mocks de Firestore
        mockDb.collection.mockReset();
    });
    (0, vitest_1.describe)('Security Middleware', () => {
        (0, vitest_1.it)('should return 401 Unauthorized if no Authorization header is provided', async () => {
            const response = await (0, supertest_1.default)(server).post('/projects/test-project/transactions').send({});
            (0, vitest_1.expect)(response.status).toBe(401);
        });
        (0, vitest_1.it)('should return 403 Forbidden if the token is invalid', async () => {
            // Configuramos el mock para que simule un token inválido
            mockAuth.verifyIdToken.mockRejectedValue(new Error('Token inválido!'));
            const response = await (0, supertest_1.default)(server)
                .post('/projects/test-project/transactions')
                .set('Authorization', 'Bearer invalid-token')
                .send({});
            (0, vitest_1.expect)(response.status).toBe(403);
        });
    });
    (0, vitest_1.describe)('GET /projects/:projectId/transactions', () => {
        const validToken = 'valid-token';
        const validUser = { uid: 'user-abc' };
        const projectId = 'project-123';
        (0, vitest_1.beforeEach)(() => {
            mockAuth.verifyIdToken.mockResolvedValue(validUser);
        });
        (0, vitest_1.it)('should return 403 Forbidden if user is not a member of the project', async () => {
            mockDb.collection.mockImplementation((path) => {
                if (path === 'projects') {
                    return {
                        doc: vitest_1.vi.fn((docId) => ({
                            get: vitest_1.vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: ['user-xyz'] }) })),
                        })),
                    };
                }
                return {};
            });
            const response = await (0, supertest_1.default)(server)
                .get(`/projects/${projectId}/transactions`)
                .set('Authorization', `Bearer ${validToken}`);
            (0, vitest_1.expect)(response.status).toBe(403);
            (0, vitest_1.expect)(response.body.message).toBe('Prohibido: No es miembro del proyecto o el proyecto no existe.');
        });
        (0, vitest_1.it)('should return 200 OK and a list of transactions if user is authorized', async () => {
            const mockTransactions = [
                { id: 'txn-1', type: 'income', amount: 100, description: 'Salary', createdAt: new Date().toISOString() },
                { id: 'txn-2', type: 'expense', amount: 50, description: 'Groceries', createdAt: new Date().toISOString() },
            ];
            mockDb.collection.mockImplementation((path) => {
                if (path === 'projects') {
                    return {
                        doc: vitest_1.vi.fn((docId) => ({
                            get: vitest_1.vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
                            collection: vitest_1.vi.fn((subCollectionPath) => {
                                if (subCollectionPath === 'transactions') {
                                    return {
                                        orderBy: vitest_1.vi.fn(() => ({
                                            get: vitest_1.vi.fn(() => Promise.resolve({
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
            const response = await (0, supertest_1.default)(server)
                .get(`/projects/${projectId}/transactions`)
                .set('Authorization', `Bearer ${validToken}`);
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(response.body).toEqual(mockTransactions);
        });
        (0, vitest_1.it)('should return 200 OK and an empty array if no transactions are found', async () => {
            mockDb.collection.mockImplementation((path) => {
                if (path === 'projects') {
                    return {
                        doc: vitest_1.vi.fn((docId) => ({
                            get: vitest_1.vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
                            collection: vitest_1.vi.fn((subCollectionPath) => {
                                if (subCollectionPath === 'transactions') {
                                    return {
                                        orderBy: vitest_1.vi.fn(() => ({
                                            get: vitest_1.vi.fn(() => Promise.resolve({
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
            const response = await (0, supertest_1.default)(server)
                .get(`/projects/${projectId}/transactions`)
                .set('Authorization', `Bearer ${validToken}`);
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(response.body).toEqual([]);
        });
        (0, vitest_1.it)('should return 500 Internal Server Error if Firestore operation fails', async () => {
            mockDb.collection.mockImplementation((path) => {
                if (path === 'projects') {
                    return {
                        doc: vitest_1.vi.fn((docId) => ({
                            get: vitest_1.vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
                            collection: vitest_1.vi.fn((subCollectionPath) => {
                                if (subCollectionPath === 'transactions') {
                                    return {
                                        orderBy: vitest_1.vi.fn(() => ({
                                            get: vitest_1.vi.fn(() => Promise.reject(new Error('Firestore error'))),
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
            const response = await (0, supertest_1.default)(server)
                .get(`/projects/${projectId}/transactions`)
                .set('Authorization', `Bearer ${validToken}`);
            (0, vitest_1.expect)(response.status).toBe(500);
            (0, vitest_1.expect)(response.body.message).toBe('Error al obtener transacciones.');
        });
    });
    (0, vitest_1.describe)('POST /projects/:projectId/transactions', () => {
        const validToken = 'valid-token';
        const validUser = { uid: 'user-abc' };
        const projectId = 'project-123';
        const newTransaction = { type: 'expense', amount: 50, description: 'Test Expense' };
        (0, vitest_1.beforeEach)(() => {
            mockAuth.verifyIdToken.mockResolvedValue(validUser);
        });
        (0, vitest_1.it)('should return 403 Forbidden if user is not a member of the project', async () => {
            mockDb.collection.mockImplementation((path) => {
                if (path === 'projects') {
                    return {
                        doc: vitest_1.vi.fn((docId) => ({
                            get: vitest_1.vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: ['user-xyz'] }) })),
                        })),
                    };
                }
                return {};
            });
            const response = await (0, supertest_1.default)(server)
                .post(`/projects/${projectId}/transactions`)
                .set('Authorization', `Bearer ${validToken}`)
                .send(newTransaction);
            (0, vitest_1.expect)(response.status).toBe(403);
            (0, vitest_1.expect)(response.body.message).toBe('Prohibido: No es miembro del proyecto o el proyecto no existe.');
        });
        (0, vitest_1.it)('should return 201 Created if user is authorized and data is valid', async () => {
            const mockDocRef = { id: 'new-txn-id' };
            let addMock; // Declare addMock here
            mockDb.collection.mockImplementation((path) => {
                if (path === 'projects') {
                    return {
                        doc: vitest_1.vi.fn((docId) => ({
                            get: vitest_1.vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
                            collection: vitest_1.vi.fn((subCollectionPath) => {
                                if (subCollectionPath === 'transactions') {
                                    addMock = vitest_1.vi.fn(() => Promise.resolve(mockDocRef)); // Assign to addMock
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
            const response = await (0, supertest_1.default)(server)
                .post(`/projects/${projectId}/transactions`)
                .set('Authorization', `Bearer ${validToken}`)
                .send(newTransaction);
            (0, vitest_1.expect)(response.status).toBe(201);
            (0, vitest_1.expect)(response.body).toEqual({ id: mockDocRef.id, ...newTransaction, createdAt: vitest_1.expect.any(String) });
            (0, vitest_1.expect)(addMock).toHaveBeenCalledWith({
                ...newTransaction,
                createdAt: vitest_1.expect.any(Object), // admin.firestore.FieldValue.serverTimestamp() is an object
            });
        });
        vitest_1.it.each(['type', 'description'])('should return 400 Bad Request if %s is missing', async (field) => {
            mockDb.collection.mockImplementation((path) => {
                if (path === 'projects') {
                    return {
                        doc: vitest_1.vi.fn((docId) => ({
                            get: vitest_1.vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
                        })),
                    };
                }
                return {};
            });
            const invalidTransaction = { ...newTransaction };
            delete invalidTransaction[field];
            const response = await (0, supertest_1.default)(server)
                .post(`/projects/${projectId}/transactions`)
                .set('Authorization', `Bearer ${validToken}`)
                .send(invalidTransaction);
            (0, vitest_1.expect)(response.status).toBe(400);
            (0, vitest_1.expect)(response.body.message).toContain('Faltan campos requeridos');
        });
        (0, vitest_1.it)('should return 400 Bad Request if amount is missing', async () => {
            mockDb.collection.mockImplementation((path) => {
                if (path === 'projects') {
                    return {
                        doc: vitest_1.vi.fn((docId) => ({
                            get: vitest_1.vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
                        })),
                    };
                }
                return {};
            });
            const invalidTransaction = { ...newTransaction };
            delete invalidTransaction.amount;
            const response = await (0, supertest_1.default)(server)
                .post(`/projects/${projectId}/transactions`)
                .set('Authorization', `Bearer ${validToken}`)
                .send(invalidTransaction);
            (0, vitest_1.expect)(response.status).toBe(400);
            (0, vitest_1.expect)(response.body.message).toContain('Faltan campos requeridos');
        });
        vitest_1.it.each([0, -10, 'not-a-number'])('should return 400 Bad Request for invalid amount: %s', async (invalidAmount) => {
            mockDb.collection.mockImplementation((path) => {
                if (path === 'projects') {
                    return {
                        doc: vitest_1.vi.fn((docId) => ({
                            get: vitest_1.vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
                        })),
                    };
                }
                return {};
            });
            const invalidTransaction = { ...newTransaction, amount: invalidAmount };
            const response = await (0, supertest_1.default)(server)
                .post(`/projects/${projectId}/transactions`)
                .set('Authorization', `Bearer ${validToken}`)
                .send(invalidTransaction);
            (0, vitest_1.expect)(response.status).toBe(400);
            (0, vitest_1.expect)(response.body.message).toContain('El campo amount debe ser un número positivo.');
        });
        (0, vitest_1.it)('should return 500 Internal Server Error if Firestore operation fails', async () => {
            mockDb.collection.mockImplementation((path) => {
                if (path === 'projects') {
                    return {
                        doc: vitest_1.vi.fn((docId) => ({
                            get: vitest_1.vi.fn(() => Promise.resolve({ exists: true, data: () => ({ members: [validUser.uid] }) })),
                            collection: vitest_1.vi.fn((subCollectionPath) => {
                                if (subCollectionPath === 'transactions') {
                                    return {
                                        add: vitest_1.vi.fn(() => Promise.reject(new Error('Firestore error'))),
                                    };
                                }
                                return {};
                            }),
                        })),
                    };
                }
                return {};
            });
            const response = await (0, supertest_1.default)(server)
                .post(`/projects/${projectId}/transactions`)
                .set('Authorization', `Bearer ${validToken}`)
                .send(newTransaction);
            (0, vitest_1.expect)(response.status).toBe(500);
            (0, vitest_1.expect)(response.body.message).toBe('Error al crear transacción.');
        });
    });
});
