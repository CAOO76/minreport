import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { PluginViewer } from '../index'; // Importar el componente PluginViewer
import React from 'react';

// Mock the entire plugin-loader module
vi.mock('../utils/plugin-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/plugin-loader')>();
  return {
    ...actual, // Keep original exports if any
    getSecurePluginUrl: vi.fn(), // Mock this specific function
  };
});

// Import the mocked function
import { getSecurePluginUrl } from '../utils/plugin-loader';

// Mock of external or simulated functions
const mockOnActionProxy = vi.fn();

// Mock of window.parent.postMessage
const mockPostMessage = vi.fn();

// Datos de sesión de ejemplo
const MOCK_USER = { uid: 'user123', email: 'test@example.com', displayName: 'Test User' };
const MOCK_CLAIMS = { role: 'user' };
const MOCK_ID_TOKEN = 'mock-firebase-id-token';
const MOCK_THEME = { '--theme-primary-color': '#ff0000' };

describe('PluginViewer', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks(); // Clears all mocks, including getSecurePluginUrl
    mockOnActionProxy.mockClear();
    mockPostMessage.mockClear();

    // Mock window.parent.postMessage
    Object.defineProperty(window, 'parent', {
      value: { postMessage: mockPostMessage },
      writable: true,
    });

    // Reset modules to ensure a clean state for each test
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render an iframe and call getSecurePluginUrl on mount', async () => {
    // Set the mock implementation for this test
    (getSecurePluginUrl as ReturnType<typeof vi.fn>).mockResolvedValue('http://mock-plugin.com/plugin?ticket=abc');

    render(
      <PluginViewer
        pluginId="test-plugin"
        user={MOCK_USER}
        claims={MOCK_CLAIMS}
        idToken={MOCK_ID_TOKEN}
        theme={MOCK_THEME}
        onActionProxy={mockOnActionProxy}
      />
    );

    // Verify that the iframe is rendered
    // Wait for the loading state to clear and the iframe to appear
    await waitFor(() => {
      const iframe = screen.getByTitle('Plugin: test-plugin');
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute('src', 'http://mock-plugin.com/plugin?ticket=abc');
    });

    // Verify that getSecurePluginUrl was called
    expect(getSecurePluginUrl).toHaveBeenCalledWith('test-plugin', MOCK_ID_TOKEN);
  });

  it('should send MINREPORT_INIT message to iframe on load', async () => {
    const pluginUrl = 'http://mock-plugin.com/plugin?ticket=abc';
    (getSecurePluginUrl as ReturnType<typeof vi.fn>).mockResolvedValue(pluginUrl);

    render(
      <PluginViewer
        pluginId="test-plugin"
        user={MOCK_USER}
        claims={MOCK_CLAIMS}
        idToken={MOCK_ID_TOKEN}
        theme={MOCK_THEME}
        onActionProxy={mockOnActionProxy}
      />
    );

    const iframe = await waitFor(() => screen.getByTitle('Plugin: test-plugin')) as HTMLIFrameElement;

    // Simular el evento de carga del iframe
    await waitFor(() => {
      // Mock contentWindow.postMessage of the iframe
      Object.defineProperty(iframe, 'contentWindow', {
        value: { postMessage: mockPostMessage },
        writable: true,
      });
      iframe.dispatchEvent(new Event('load'));
    });

    // Verificar que postMessage fue llamado con el mensaje MINREPORT_INIT
    expect(mockPostMessage).toHaveBeenCalledWith(
      {
        type: 'MINREPORT_INIT',
        payload: { user: MOCK_USER, claims: MOCK_CLAIMS, idToken: MOCK_ID_TOKEN, theme: MOCK_THEME },
      },
      'http://mock-plugin.com'
    );
  });

  it('should handle MINREPORT_ACTION messages from iframe', async () => {
    const pluginUrl = 'http://mock-plugin.com/plugin?ticket=abc';
    (getSecurePluginUrl as ReturnType<typeof vi.fn>).mockResolvedValue(pluginUrl);
    mockOnActionProxy.mockResolvedValue({ status: 'success' });

    render(
      <PluginViewer
        pluginId="test-plugin"
        user={MOCK_USER}
        claims={MOCK_CLAIMS}
        idToken={MOCK_ID_TOKEN}
        theme={MOCK_THEME}
        onActionProxy={mockOnActionProxy}
      />
    );

    // Wait for the iframe to load and be ready, and for MINREPORT_INIT to be sent
    await waitFor(() => {
      const iframe = screen.getByTitle('Plugin: test-plugin') as HTMLIFrameElement;
      Object.defineProperty(iframe, 'contentWindow', {
        value: { postMessage: mockPostMessage },
        writable: true,
      });
      iframe.dispatchEvent(new Event('load')); // Ensure the load event has fired to set up the listener
      // Ensure MINREPORT_INIT has been sent, indicating the iframe is ready to receive messages
      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          type: 'MINREPORT_INIT',
          payload: { user: MOCK_USER, claims: MOCK_CLAIMS, idToken: MOCK_ID_TOKEN, theme: MOCK_THEME },
        },
        'http://mock-plugin.com'
      );
    });

    mockPostMessage.mockClear(); // Clear calls from MINREPORT_INIT

    // Simular que el iframe envía un mensaje MINREPORT_ACTION
    // No necesitamos un waitFor aquí porque ya esperamos la inicialización
    const iframe = screen.getByTitle('Plugin: test-plugin') as HTMLIFrameElement;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'MINREPORT_ACTION',
            payload: { action: 'saveData', data: { key: 'value' }, correlationId: '123' },
          },
          origin: 'http://mock-plugin.com',
          source: iframe.contentWindow, // Simular que viene del iframe
        })
      );
    });

    // Verificar que onActionProxy fue llamado
    expect(mockOnActionProxy).toHaveBeenCalledWith('saveData', { key: 'value' });

    // Verificar que se envió una respuesta al iframe
    expect(mockPostMessage).toHaveBeenCalledWith(
      {
        type: 'MINREPORT_RESPONSE',
        payload: { result: { status: 'success' }, correlationId: '123' },
      },
      'http://mock-plugin.com'
    );
  });
});