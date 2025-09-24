import { vi } from 'vitest';

export const getFunctions = vi.fn(() => ({}));
export const httpsCallable = vi.fn(() => vi.fn(() => Promise.resolve({ data: { ticket: 'mock-ticket' } })));