import { vi } from 'vitest';

export const firestoreMock = {
  collection: vi.fn().mockReturnThis(),
  doc: vi.fn().mockReturnThis(),
  get: vi.fn(),
  add: vi.fn(),
  orderBy: vi.fn().mockReturnThis(),
};

const authMock = {
  verifyIdToken: vi.fn(),
};

const firebaseAdminMock = {
  initializeApp: vi.fn(),
  firestore: () => firestoreMock,
  auth: () => authMock,
  apps: [], // Mock the apps array to avoid re-initialization issues
};

export default firebaseAdminMock;
