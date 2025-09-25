import { vi } from 'vitest';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

// Local mocks for firebase-admin
export const mockSetCustomUserClaims = vi.fn();
export const mockGetUser = vi.fn();
export const mockRevokeRefreshTokens = vi.fn();

export const mockAuth = {
  getUser: mockGetUser.mockResolvedValue({
    uid: 'mock-uid',
    email: 'mock@example.com',
    emailVerified: true,
    displayName: 'Mock User',
    photoURL: '',
    phoneNumber: undefined,
    disabled: false,
    metadata: {} as any,
    providerData: [],
    customClaims: {},
    tenantId: null,
    toJSON: () => ({}),
  }),
  setCustomUserClaims: mockSetCustomUserClaims,
  revokeRefreshTokens: mockRevokeRefreshTokens,
} as unknown as Auth;

export const mockFirestore = {
  collection: vi.fn(() => mockFirestore),
  doc: vi.fn(() => mockFirestore),
  get: vi.fn(),
  set: vi.fn().mockResolvedValue(undefined),
  add: vi.fn(),
  orderBy: vi.fn(() => mockFirestore),
  runTransaction: vi.fn((callback: (transaction: any) => Promise<any>) => {
    const mockTransaction = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ adminActivatedPlugins: [] }) }),
      update: vi.fn().mockResolvedValue(true),
    };
    return callback(mockTransaction);
  }),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'MOCKED_TIMESTAMP'),
  },
} as unknown as Firestore;

export const adminMock = {
  initializeApp: vi.fn(),
  auth: vi.fn(() => mockAuth),
  firestore: Object.assign(vi.fn(() => mockFirestore), {
    FieldValue: mockFirestore.FieldValue,
  }),
  apps: [],
};

vi.mock('firebase-admin', () => {
  return {
    default: adminMock,
    ...adminMock,
  };
});