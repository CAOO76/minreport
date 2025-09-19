import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useAuth from './useAuth';
import { getAuth, signOut, onAuthStateChanged, __simulateAuthStateChanged } from 'firebase/auth';

describe('useAuth', () => {
  const mockOnAuthStateChanged = onAuthStateChanged as vi.Mock;
  const mockSignOut = signOut as vi.Mock;
  const mockGetAuth = getAuth as vi.Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return loading true initially', () => {
    const { result } = renderHook(() => useAuth(mockGetAuth()));
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
  });

  it('should update user when auth state changes', async () => {
    const fakeUser = { 
      uid: '123', 
      email: 'test@example.com',
      getIdTokenResult: () => Promise.resolve({ claims: { admin: false, activePlugins: [] } })
    };

    const { result } = renderHook(() => useAuth(mockGetAuth()));

    await act(async () => {
      __simulateAuthStateChanged(fakeUser);
    });

    expect(result.current.user?.uid).toBe('123');
    expect(result.current.loading).toBe(false);
  });

  it('should set user to null on logout', async () => {
    const { result } = renderHook(() => useAuth(mockGetAuth()));

    await act(async () => {
      __simulateAuthStateChanged(null);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});