import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import useAuth from './useAuth';
import { onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';

// Mock the entire firebase/auth module to control onAuthStateChanged
const mockUnsubscribe = vi.fn();
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => mockUnsubscribe), // By default, return a mock unsubscribe function
  getIdTokenResult: vi.fn(),
}));

describe('useAuth Hook', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  it('should initially return a loading state', () => {
    const { result } = renderHook(() => useAuth({} as any));
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBe(null);
  });

  it('should return a non-loading state with a null user when not authenticated', async () => {
    // Setup mock for this specific test
    (onAuthStateChanged as ReturnType<typeof vi.fn>).mockImplementation((auth, callback) => {
      // Simulate Firebase calling the callback asynchronously with a null user
      Promise.resolve().then(() => callback(null));
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useAuth({} as any));

    // Wait for the async state update
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toBe(null);
  });

  it('should return a user and claims when authenticated', async () => {
    const mockUser = { uid: 'user123', getIdTokenResult: vi.fn() } as unknown as User;
    const mockClaims = { claims: { role: 'admin', adminActivatedPlugins: ['pluginA', 'pluginB'] } };

    // Mock the user object and its token result
    (mockUser.getIdTokenResult as ReturnType<typeof vi.fn>).mockResolvedValue(mockClaims as any);

    // Setup mock for this specific test
    (onAuthStateChanged as ReturnType<typeof vi.fn>).mockImplementation((auth, callback) => {
      Promise.resolve().then(() => callback(mockUser));
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useAuth({} as any));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.claims).toEqual(mockClaims.claims);
    expect(result.current.adminActivatedPlugins).toEqual(['pluginA', 'pluginB']);
  });
});