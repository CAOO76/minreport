import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import functionsTest from 'firebase-functions-test';
import { generatePluginLoadToken } from './tokens';
import type { DecodedIdToken } from 'firebase-admin/auth';

const test = functionsTest();

describe('generatePluginLoadToken', () => {
  let wrapped: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test_secret');
    wrapped = test.wrap(generatePluginLoadToken);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('should generate a token for an authenticated user with access', async () => {
    const request = {
      data: { pluginId: 'test-plugin' },
      auth: { uid: 'user-with-access', token: { adminActivatedPlugins: ['test-plugin'] } as DecodedIdToken },
    };
    const result = await wrapped(request);
    expect(result).toHaveProperty('ticket');
  });

  it('should throw unauthenticated if auth is missing', async () => {
    const request = { data: { pluginId: 'test-plugin' } };
    await expect(wrapped(request)).rejects.toThrow('The function must be called while authenticated.');
  });

  it('should throw invalid-argument if pluginId is missing', async () => {
    const request = {
      data: {},
      auth: { uid: 'user1', token: {} as DecodedIdToken },
    };
    await expect(wrapped(request)).rejects.toThrow(/must be called with a valid "pluginId"/);
  });

  it('should throw permission-denied if user lacks claim', async () => {
    const request = {
      data: { pluginId: 'secret-plugin' },
      auth: { uid: 'user-no-access', token: { adminActivatedPlugins: ['other-plugin'] } as DecodedIdToken },
    };
    await expect(wrapped(request)).rejects.toThrow('You do not have permission to load this plugin.');
  });
});
