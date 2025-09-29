import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import functionsTest from 'firebase-functions-test';
import * as jwt from 'jsonwebtoken';
import { generatePluginLoadToken } from './tokens.js';

const test = functionsTest();

vi.mock('jsonwebtoken', () => ({
  sign: vi.fn((payload, secret, options) => `mocked_jwt_${payload.uid}_${payload.pluginId}`),
}));

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
      data: { pluginId: 'pluginA' },
      auth: { uid: 'user1', token: { adminActivatedPlugins: ['pluginA'] } },
    };
    const result = await wrapped(request);
    expect(result).toHaveProperty('ticket');
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user1', pluginId: 'pluginA' }),
      'test_secret',
      expect.any(Object)
    );
  });

  it('should throw permission-denied if user lacks claim', async () => {
    const request = {
      data: { pluginId: 'pluginA' },
      auth: { uid: 'user2', token: { adminActivatedPlugins: ['pluginB'] } },
    };
    await expect(wrapped(request)).rejects.toThrow('You do not have permission to load this plugin.');
  });

  it('should throw unauthenticated if user is not authenticated', async () => {
    const request = {
      data: { pluginId: 'pluginA' },
      auth: undefined, // No authentication context
    };
    await expect(wrapped(request)).rejects.toThrow('The function must be called while authenticated.');
  });

  it('should throw invalid-argument if pluginId is missing', async () => {
    const request = {
      data: {}, // Missing pluginId
      auth: { uid: 'user1', token: { adminActivatedPlugins: ['pluginA'] } },
    };
    await expect(wrapped(request)).rejects.toThrow('The function must be called with a valid "pluginId".');
  });

  it('should throw invalid-argument if pluginId is not a string', async () => {
    const request = {
      data: { pluginId: 123 }, // Invalid pluginId type
      auth: { uid: 'user1', token: { adminActivatedPlugins: ['pluginA'] } },
    };
    await expect(wrapped(request)).rejects.toThrow('The function must be called with a valid "pluginId".');
  });

  it('should throw internal error if JWT_SECRET is not configured', async () => {
    vi.unstubAllEnvs(); // Unstub to simulate missing JWT_SECRET
    const request = {
      data: { pluginId: 'pluginA' },
      auth: { uid: 'user1', token: { adminActivatedPlugins: ['pluginA'] } },
    };
    await expect(wrapped(request)).rejects.toThrow('JWT_SECRET is not configured.');
  });
});
