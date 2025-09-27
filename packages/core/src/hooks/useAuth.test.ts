import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import useAuth from './useAuth';
import { onAuthStateChanged } from 'firebase/auth';
import type { User, Auth } from 'firebase/auth';

// Mock the entire firebase/auth module to control onAuthStateChanged
vi.mock('firebase/auth', () => {
  const mockUnsubscribe = vi.fn();
  const mockGetIdTokenResult = vi.fn();
  return {
    onAuthStateChanged: vi.fn(() => mockUnsubscribe),
    getIdTokenResult: mockGetIdTokenResult,
  };
});

// Create a minimal mock Auth instance
const mockAuthInstance: Auth = {} as Auth;

// Helper to set up onAuthStateChanged mock
const setupAuthStateChangedMock = (user: User | null) => {
  (onAuthStateChanged as ReturnType<typeof vi.fn>).mockImplementation((auth, callback) => {
    Promise.resolve().then(() => callback(user));
    return vi.fn();
  });
};

// Helper to create a mock User
const createMockUser = (uid: string, claims: Record<string, any>): User => ({
  uid,
  getIdTokenResult: vi.fn().mockResolvedValue({ claims }),
}) as unknown as User;

describe('useAuth Hook', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  it('should initially return a loading state', () => {
    const { result } = renderHook(() => useAuth(mockAuthInstance));
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBe(null);
  });

  it('should return a non-loading state with a null user when not authenticated', async () => {
    setupAuthStateChangedMock(null);

    const { result } = renderHook(() => useAuth(mockAuthInstance));

    // Wait for the async state update
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toBe(null);
  });

  it('should return a user and claims when authenticated', async () => {
    const mockClaims = { role: 'admin', adminActivatedPlugins: ['pluginA', 'pluginB'] };
    const mockUser = createMockUser('user123', mockClaims);

    setupAuthStateChangedMock(mockUser);

    const { result } = renderHook(() => useAuth(mockAuthInstance));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.claims).toEqual(mockClaims);
    expect(result.current.adminActivatedPlugins).toEqual(['pluginA', 'pluginB']);
  });
});