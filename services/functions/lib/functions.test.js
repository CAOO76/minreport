"use strict";
/*
describe('Cloud Functions', () => {
  let test: any;

  beforeAll(() => {
    vi.clearAllMocks();
    test = functionsTest();
  });

  afterAll(() => {
    test.cleanup();
    vi.restoreAllMocks();
  });

  describe('generatePluginLoadToken', () => {
    it('should generate a token for an authenticated user with access', async () => {
      const wrapped = test.wrap(generatePluginLoadToken);
      const context = { auth: { uid: 'user-with-access', token: { activePlugins: ['test-plugin'] } } };
      const data = { pluginId: 'test-plugin' };

      const result = await wrapped(data, context);

      expect(result).toHaveProperty('token');
      expect(typeof result.token).toBe('string');
    });

    it('should throw unauthenticated error if user is not authenticated', async () => {
      const wrapped = test.wrap(generatePluginLoadToken);
      const context = { auth: null };
      const data = { pluginId: 'test-plugin' };

      await expect(wrapped(data, context)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw invalid-argument error if pluginId is missing', async () => {
      const wrapped = test.wrap(generatePluginLoadToken);
      const context = { auth: { uid: 'user-with-access', token: { activePlugins: ['test-plugin'] } } };
      const data = {};

      await expect(wrapped(data, context)).rejects.toThrow('The function must be called with a valid "pluginId".');
    });

    it('should throw permission-denied error if user does not have access', async () => {
      const wrapped = test.wrap(generatePluginLoadToken);
      const context = { auth: { uid: 'user-without-access', token: { activePlugins: [] } } };
      const data = { pluginId: 'test-plugin' };

      await expect(wrapped(data, context)).rejects.toThrow('You do not have permission to access this plugin.');
    });
  });

  describe('savePluginData', () => {
    it('should save data for an authenticated user with access', async () => {
      const wrapped = test.wrap(savePluginData);
      const context = { auth: { uid: 'user-with-access', token: { activePlugins: ['test-plugin'] } } };
      const data = { pluginId: 'test-plugin', data: { message: 'hello' } };

      const result = await wrapped(data, context);

      expect(result).toEqual({ success: true, message: 'Data saved successfully.' });
      expect(mockFirestore.doc).toHaveBeenCalledWith(`plugin_data/${context.auth.uid}/${data.pluginId}/user_data`);
      expect(mockFirestore.set).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'hello' }),
        { merge: true }
      );
    });

    it('should throw unauthenticated error if user is not authenticated', async () => {
      const wrapped = test.wrap(savePluginData);
      const context = { auth: null };
      const data = { pluginId: 'test-plugin', data: { message: 'hello' } };

      await expect(wrapped(data, context)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw invalid-argument error if pluginId is missing', async () => {
      const wrapped = test.wrap(savePluginData);
      const context = { auth: { uid: 'user-with-access', token: { activePlugins: ['test-plugin'] } } };
      const data = { data: { message: 'hello' } };

      await expect(wrapped(data, context)).rejects.toThrow('The function must be called with a valid "pluginId".');
    });

    it('should throw permission-denied error if user does not have access', async () => {
      const wrapped = test.wrap(savePluginData);
      const context = { auth: { uid: 'user-without-access', token: { activePlugins: [] } } };
      const data = { pluginId: 'test-plugin', data: { message: 'hello' } };

      await expect(wrapped(data, context)).rejects.toThrow('You do not have permission to call this function for the specified plugin.');
    });
  });
});
*/ 
//# sourceMappingURL=functions.test.js.map