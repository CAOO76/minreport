import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import AccountDetails from './AccountDetails';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

// Mock Firebase Firestore and Functions
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal() as object;
  const mockFirestoreInstance = {
    _delegate: {}, // Mimic the structure connectFirestoreEmulator might expect
  };
  return {
    ...actual,
    doc: vi.fn(),
    getDoc: vi.fn(),
    getFirestore: vi.fn(() => mockFirestoreInstance),
    connectFirestoreEmulator: vi.fn(),
  };
});

vi.mock('firebase/functions', async (importOriginal) => {
  const actual = await importOriginal() as object;
  return {
    ...actual,
    getFunctions: vi.fn(() => ({})), // Mock getFunctions to return a mock functions instance
    httpsCallable: vi.fn(() => vi.fn()), // Mock httpsCallable to return a mock callable function
    connectFunctionsEmulator: vi.fn(), // Add connectFunctionsEmulator to the mock
  };
});

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useParams: vi.fn(),
  useNavigate: vi.fn(),
}));

// Mock the M3Switch web component
// This is a simplified mock. In a real scenario, you might want to mock its internal behavior more accurately.
customElements.define('md-switch', class extends HTMLElement {
  _selected = false; // Internal state

  connectedCallback() {
    this.onclick = () => {
      this.selected = !this.selected; // Toggle internal state
      // Simulate change event
      const event = new Event('change', { bubbles: true });
      Object.defineProperty(event, 'target', { value: this, writable: true });
      this.dispatchEvent(event);
    };
  }

  set selected(value: boolean) {
    this._selected = value;
    if (value) {
      this.setAttribute('selected', 'true'); // Explicitly set to 'true'
    } else {
      this.setAttribute('selected', 'false'); // Explicitly set to 'false'
    }
  }

  get selected() {
    return this._selected;
  }
});

describe('AccountDetails', () => {
  const mockAccountId = 'testAccountId123';
  const mockNavigate = vi.fn();
  const mockManageClientPluginsCallable = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useParams as vi.Mock).mockReturnValue({ accountId: mockAccountId });
    (useNavigate as vi.Mock).mockReturnValue(mockNavigate);
    (httpsCallable as vi.Mock).mockReturnValue(mockManageClientPluginsCallable);
  });

  const mockAccountData = {
    id: mockAccountId,
    status: 'active',
    createdAt: { toDate: () => new Date('2023-01-01') },
    institutionName: 'Test Institution',
    accountType: 'EMPRESARIAL',
    designatedAdminEmail: 'admin@test.com',
    adminName: 'Admin Test',
    adminActivatedPlugins: ['metrics-v1'], // Initially active plugin
  };

  it('renders loading state initially', () => {
    (getDoc as vi.Mock).mockReturnValueOnce(new Promise(() => {})); // Never resolve to keep loading
    render(<AccountDetails />);
    expect(screen.getByText('Cargando detalles de la cuenta...')).toBeInTheDocument();
  });

  it('renders error state if account not found', async () => {
    (getDoc as vi.Mock).mockResolvedValueOnce({ exists: () => false });
    render(<AccountDetails />);
    await waitFor(() => {
      expect(screen.getByText('Cuenta no encontrada.')).toBeInTheDocument();
    });
  });

  it('renders account details correctly', async () => {
    (getDoc as vi.Mock).mockResolvedValueOnce({
      exists: () => true,
      data: () => mockAccountData,
    });
    render(<AccountDetails />);

    await waitFor(async () => {
      await screen.findByText(`Detalles de la Cuenta: ${mockAccountData.institutionName}`);

      // For ID
      const idParagraph = screen.getByText((content, element) => {
        return element?.tagName.toLowerCase() === 'p' && element.textContent?.includes('ID:');
      });
      const idText = idParagraph.textContent?.replace('ID:', '').trim();
      expect(idText).toBe('testAccountId123');

      // For Email Administrador
      const emailParagraph = screen.getByText((content, element) => {
        return element?.tagName.toLowerCase() === 'p' && element.textContent?.includes('Email Administrador:');
      });
      const emailText = emailParagraph.textContent?.replace('Email Administrador:', '').trim();
      expect(emailText).toBe('admin@test.com');

      // Keep other assertions as they are
      // For Tipo de Cuenta
      const accountTypeParagraph = screen.getByText((content, element) => {
        return element?.tagName.toLowerCase() === 'p' && element.textContent?.includes('Tipo de Cuenta:');
      });
      const accountTypeText = accountTypeParagraph.textContent?.replace('Tipo de Cuenta:', '').trim();
      expect(accountTypeText).toBe(mockAccountData.accountType);

      // For Estado
      const statusParagraph = screen.getByText((content, element) => {
        return element?.tagName.toLowerCase() === 'p' && element.textContent?.includes('Estado:');
      });
      const statusText = statusParagraph.textContent?.replace('Estado:', '').trim();
      expect(statusText).toBe(mockAccountData.status);

      // For Fecha de Creación
      const createdAtParagraph = screen.getByText((content, element) => {
        return element?.tagName.toLowerCase() === 'p' && element.textContent?.includes('Fecha de Creación:');
      });
      const createdAtText = createdAtParagraph.textContent?.replace('Fecha de Creación:', '').trim();
      expect(createdAtText).toBe(new Date('2023-01-01').toLocaleDateString());
    });
  });

  describe('Plugin Management', () => {
    const ALL_AVAILABLE_PLUGINS = [
      { id: 'test-plugin', name: 'Plugin de Prueba Interno' },
      { id: 'metrics-v1', name: 'Dashboard de Métricas v1' },
      { id: 'reports-basic', name: 'Generador de Reportes Básico' },
    ];

    beforeEach(() => {
      (getDoc as vi.Mock).mockResolvedValue({
        exists: () => true,
        data: () => ({ ...mockAccountData, adminActivatedPlugins: ['metrics-v1'] }),
      });
    });

    it('renders all available plugins with correct initial switch states', async () => {
      render(<AccountDetails />);

      await waitFor(() => {
        expect(screen.getByText('Gestión de Plugins')).toBeInTheDocument();
      });

      ALL_AVAILABLE_PLUGINS.forEach(plugin => {
        expect(screen.getByText(plugin.name)).toBeInTheDocument();
        const switchElement = screen.getByText(plugin.name).closest('.plugin-item')?.querySelector('md-switch');
        expect(switchElement).toBeInTheDocument();
        if (switchElement) {
          if (mockAccountData.adminActivatedPlugins.includes(plugin.id)) {
            expect(switchElement).toHaveAttribute('selected', 'true');
          } else {
            expect(switchElement).toHaveAttribute('selected', 'false');
          }
        }
      });
    });

    it('calls manageClientPluginsCallable to activate a plugin', async () => {
      mockManageClientPluginsCallable.mockResolvedValueOnce({ data: { status: 'success' } });
      (getDoc as vi.Mock)
        .mockResolvedValueOnce({ exists: () => true, data: () => ({ ...mockAccountData, adminActivatedPlugins: ['metrics-v1'] }) })
        .mockResolvedValueOnce({ exists: () => true, data: () => ({ ...mockAccountData, adminActivatedPlugins: ['metrics-v1', 'test-plugin'] }) }); // Mock refresh

      render(<AccountDetails />);

      await waitFor(() => {
        expect(screen.getByText('Gestión de Plugins')).toBeInTheDocument();
      });

      const testPluginSwitch = screen.getByText('Plugin de Prueba Interno').closest('.plugin-item')?.querySelector('md-switch');
      expect(testPluginSwitch).toBeInTheDocument();
      expect(testPluginSwitch).toHaveAttribute('selected', 'false'); // Initially inactive

      fireEvent.click(testPluginSwitch!);

      await waitFor(() => {
        expect(mockManageClientPluginsCallable).toHaveBeenCalledWith({
          accountId: mockAccountId,
          pluginId: 'test-plugin',
          action: 'activate',
        });
      });

      // Verify UI updates after refresh
      await waitFor(() => {
        expect(testPluginSwitch).toHaveAttribute('selected', 'true');
      });
    });

    it('calls manageClientPluginsCallable to deactivate a plugin', async () => {
      mockManageClientPluginsCallable.mockResolvedValueOnce({ data: { status: 'success' } });
      (getDoc as vi.Mock)
        .mockResolvedValueOnce({ exists: () => true, data: () => ({ ...mockAccountData, adminActivatedPlugins: ['metrics-v1'] }) })
        .mockResolvedValueOnce({ exists: () => true, data: () => ({ ...mockAccountData, adminActivatedPlugins: [] }) }); // Mock refresh

      render(<AccountDetails />);

      await waitFor(() => {
        expect(screen.getByText('Gestión de Plugins')).toBeInTheDocument();
      });

      const metricsPluginSwitch = screen.getByText('Dashboard de Métricas v1').closest('.plugin-item')?.querySelector('md-switch');
      expect(metricsPluginSwitch).toBeInTheDocument();
      expect(metricsPluginSwitch).toHaveAttribute('selected', 'true'); // Initially active

      fireEvent.click(metricsPluginSwitch!);

      await waitFor(() => {
        expect(mockManageClientPluginsCallable).toHaveBeenCalledWith({
          accountId: mockAccountId,
          pluginId: 'metrics-v1',
          action: 'deactivate',
        });
      });

      // Verify UI updates after refresh
      await waitFor(() => {
        const updatedMetricsPluginSwitch = screen.getByText('Dashboard de Métricas v1').closest('.plugin-item')?.querySelector('md-switch');
        expect(updatedMetricsPluginSwitch).toHaveAttribute('selected', 'false');
      });
    });

    it('shows an error message if plugin toggle fails', async () => {
      const errorMessage = 'Failed to toggle plugin';
      mockManageClientPluginsCallable.mockRejectedValueOnce(new Error(errorMessage));
      (getDoc as vi.Mock).mockResolvedValue({ exists: () => true, data: () => mockAccountData });

      render(<AccountDetails />);

      await waitFor(() => {
        expect(screen.getByText('Gestión de Plugins')).toBeInTheDocument();
      });

      const testPluginSwitch = screen.getByText('Plugin de Prueba Interno').closest('.plugin-item')?.querySelector('md-switch');
      fireEvent.click(testPluginSwitch!);

      await waitFor(() => {
        expect(screen.getByText(`Error al cambiar estado del plugin test-plugin: ${errorMessage}`)).toBeInTheDocument();
      });
    });
  });
});
