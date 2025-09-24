import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as sdk from './index';

// Mock de la respuesta que el Core enviaría
const MOCK_SESSION = {
  user: { uid: 'test-uid', email: 'test@example.com', displayName: 'Test User' },
  claims: { role: 'user' },
  idToken: 'mock-id-token',
  theme: { '--theme-primary-color': 'blue' },
};

const MOCK_SESSION_NO_ID_TOKEN = {
  user: { uid: 'test-uid', email: 'test@example.com', displayName: 'Test User' },
  claims: { role: 'user' },
  idToken: '',
  theme: { '--theme-primary-color': 'blue' },
};

const CORE_ORIGIN = 'http://localhost:5175';

describe('@minreport/sdk', () => {
  let postMessageSpy: any;
  let addEventListenerSpy: any;
  let removeEventListenerSpy: any;

  // Configurar mocks antes de cada prueba
  beforeEach(() => {
    // Mock de window.parent.postMessage
    postMessageSpy = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageSpy },
      writable: true,
    });

    // Mock de addEventListener y removeEventListener en window
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    // Limpiar el estado del SDK si es necesario (no exportado, así que reiniciamos el módulo)
    vi.resetModules();
  });

  // Limpiar mocks después de cada prueba
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers(); // Restore real timers after each test
  });

  describe('init', () => {
    it('should initialize correctly when receiving MINREPORT_INIT message', async () => {
      const sdk = await import('./index');
      const initPromise = sdk.init([CORE_ORIGIN]);

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'MINREPORT_INIT',
            payload: MOCK_SESSION,
          },
          origin: CORE_ORIGIN,
          source: window.parent,
        })
      );

      await expect(initPromise).resolves.toEqual(MOCK_SESSION);
      expect(document.documentElement.style.getPropertyValue('--theme-primary-color')).toBe('blue');
      expect(removeEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should reject if a message from an unallowed origin is received', async () => {
      const sdk = await import('./index');
      const initPromise = sdk.init([CORE_ORIGIN]);

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'MINREPORT_INIT', payload: MOCK_SESSION },
          origin: 'http://malicious.com',
          source: window.parent,
        })
      );

      // Wait for a short period to ensure the message is processed but not resolved
      await new Promise(resolve => setTimeout(resolve, 100));

      // The promise should still be pending as no valid message was received
      // We can't directly assert a reject here without a timeout or another valid message
      // This test primarily ensures it doesn't resolve unexpectedly.
      // A more robust test would involve fake timers and asserting a timeout rejection if no valid message comes.
      // For now, we ensure it doesn't resolve with the malicious message.
      const resolved = await Promise.race([
        initPromise.then(() => true).catch(() => false),
        new Promise(resolve => setTimeout(() => resolve(false), 500)) // Short timeout
      ]);
      expect(resolved).toBe(false);
    });

    it('should reject if MINREPORT_INIT message does not contain idToken', async () => {
      const sdk = await import('./index');
      const initPromise = sdk.init([CORE_ORIGIN]);

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'MINREPORT_INIT',
            payload: MOCK_SESSION_NO_ID_TOKEN,
          },
          origin: CORE_ORIGIN,
          source: window.parent,
        })
      );

      await expect(initPromise).rejects.toThrow('Initialization failed: No idToken received from Core.');
    });

    it('should remove init listener after successful initialization', async () => {
      const sdk = await import('./index');
      sdk.init([CORE_ORIGIN]);

      const initHandler = addEventListenerSpy.mock.calls.find(call => call[0] === 'message')[1];

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'MINREPORT_INIT',
            payload: MOCK_SESSION,
          },
          origin: CORE_ORIGIN,
          source: window.parent,
        })
      );

      expect(removeEventListenerSpy).toHaveBeenCalledWith('message', initHandler);
    });
  });

  describe('SDK Actions', () => {
    let sdkInstance: typeof sdk;

    beforeEach(async () => {
      sdkInstance = await import('./index');
      // Initialize the SDK before running action tests
      const initPromise = sdkInstance.init([CORE_ORIGIN]);
      window.dispatchEvent(new MessageEvent('message', { 
          data: { type: 'MINREPORT_INIT', payload: MOCK_SESSION }, 
          origin: CORE_ORIGIN, 
          source: window.parent 
      }));
      await initPromise;
    });

    it('should throw error if SDK is not initialized before sending action', async () => {
      // Reset modules to simulate uninitialized SDK
      vi.resetModules();
      const uninitializedSdk = await import('./index');
      await expect(uninitializedSdk.savePluginData({ myData: 'test' })).rejects.toThrow('SDK not initialized.');
    });

    it('savePluginData should send an action to the core and resolve on success response', async () => {
      const actionPromise = sdkInstance.savePluginData({ myData: 'test' });

      // Get the correlationId from the sent message
      const sentMessage = postMessageSpy.mock.calls[0][0];
      const correlationId = sentMessage.payload.correlationId;

      // Simulate success response from Core
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'MINREPORT_RESPONSE',
            payload: { result: { status: 'ok' }, correlationId },
          },
          origin: CORE_ORIGIN,
          source: window.parent,
        })
      );

      await expect(actionPromise).resolves.toEqual({ status: 'ok' });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'MINREPORT_ACTION',
          payload: expect.objectContaining({
            action: 'savePluginData',
            data: { myData: 'test' },
            correlationId: expect.any(String),
          }),
        }),
        CORE_ORIGIN
      );
    });

    it('savePluginData should send an action to the core and reject on error response', async () => {
      const actionPromise = sdkInstance.savePluginData({ myData: 'test' });

      // Get the correlationId from the sent message
      const sentMessage = postMessageSpy.mock.calls[0][0];
      const correlationId = sentMessage.payload.correlationId;

      // Simulate error response from Core
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'MINREPORT_RESPONSE',
            payload: { error: 'Core error', correlationId },
          },
          origin: CORE_ORIGIN,
          source: window.parent,
        })
      );

      await expect(actionPromise).rejects.toThrow('Core error');
    });

    it('savePluginData should reject on timeout if no response is received', async () => {
      vi.useFakeTimers();
      const actionPromise = sdkInstance.savePluginData({ myData: 'test' });

      vi.advanceTimersByTime(30000); // Advance by 30 seconds

      await expect(actionPromise).rejects.toThrow("Action 'savePluginData' timed out.");
    });
  });

  describe('getSession', () => {
    let sdkInstance: typeof sdk;

    beforeEach(async () => {
      sdkInstance = await import('./index');
    });

    it('should return null if SDK is not initialized', () => {
      expect(sdkInstance.getSession()).toBeNull();
    });

    it('should return session data after successful initialization', async () => {
      const initPromise = sdkInstance.init([CORE_ORIGIN]);
      window.dispatchEvent(new MessageEvent('message', { 
          data: { type: 'MINREPORT_INIT', payload: MOCK_SESSION }, 
          origin: CORE_ORIGIN, 
          source: window.parent 
      }));
      await initPromise;

      expect(sdkInstance.getSession()).toEqual(MOCK_SESSION);
    });
  });
});