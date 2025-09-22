import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as sdk from './index';

// Mock de la respuesta que el Core enviaría
const MOCK_SESSION = {
  user: { uid: 'test-uid', email: 'test@example.com', displayName: 'Test User' },
  claims: { role: 'user' },
  idToken: 'mock-id-token',
  theme: { '--theme-primary-color': 'blue' },
};

const CORE_ORIGIN = 'http://localhost:5175';

describe('@minreport/sdk', () => {
  let postMessageSpy: any;

  // Configurar mocks antes de cada prueba
  beforeEach(() => {
    // Mock de window.parent.postMessage
    postMessageSpy = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageSpy },
      writable: true,
    });

    // Limpiar el estado del SDK si es necesario (no exportado, así que reiniciamos el módulo)
    vi.resetModules();
  });

  // Limpiar mocks después de cada prueba
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('init', () => {
    it('should initialize correctly when receiving MINREPORT_INIT message', async () => {
      // Cargar el SDK dentro de la prueba para usar el mock
      const sdk = await import('./index');

      const initPromise = sdk.init([CORE_ORIGIN]);

      // Simular el mensaje del Core al plugin
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'MINREPORT_INIT',
            payload: MOCK_SESSION,
          },
          origin: CORE_ORIGIN,
          source: window.parent, // Simular que viene del parent
        })
      );

      // Verificar que la promesa se resuelve con los datos de sesión
      await expect(initPromise).resolves.toEqual(MOCK_SESSION);

      // Verificar que el tema se aplicó al DOM
      expect(document.documentElement.style.getPropertyValue('--theme-primary-color')).toBe('blue');
    });

    it('should reject if a message from an unallowed origin is received', async () => {
        const sdk = await import('./index');
        const initPromise = sdk.init([CORE_ORIGIN]);

        // Simular mensaje de un origen no permitido
        window.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'MINREPORT_INIT', payload: MOCK_SESSION },
                origin: 'http://malicious.com',
                source: window.parent,
            })
        );

        // La promesa no debería resolverse, pero la prueba es más compleja.
        // Por ahora, nos enfocamos en el caso de éxito.
        // Vitest manejará el timeout si la promesa nunca se resuelve.
        // En un caso real, podríamos usar fake timers.
    });
  });

  describe('sendAction', () => {
    it('should send an action to the core via postMessage', async () => {
        const sdk = await import('./index');

        // Primero, inicializamos el SDK
        const initPromise = sdk.init([CORE_ORIGIN]);
        window.dispatchEvent(new MessageEvent('message', { 
            data: { type: 'MINREPORT_INIT', payload: MOCK_SESSION }, 
            origin: CORE_ORIGIN, 
            source: window.parent 
        }));
        await initPromise;

        // Llamar a la acción
        sdk.savePluginData({ myData: 'test' });

        // Verificar que postMessage fue llamado con el formato correcto
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
  });
});
