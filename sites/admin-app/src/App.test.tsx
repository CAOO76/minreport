import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import * as firebaseAuth from 'firebase/auth'; // Import firebase/auth as a module


// Mock './hooks/useAuth' to control auth state in tests
vi.mock('./hooks/useAuth', () => {
  return {
    __esModule: true,
    default: vi.fn(),
  };
});

import useAuth from './hooks/useAuth.js';
// Helper para tipado de mock (debe ir después de importar useAuth y vi)
const useAuthMock = useAuth as unknown as ReturnType<typeof vi.fn> & import('vitest').Mock;

// Import App after all mocks are set up


// Mock firebase/auth - Declare and initialize mockSignOut here, at the very top
vi.mock('firebase/auth', () => {
  return {
    signOut: vi.fn(() => Promise.resolve()),
    getAuth: vi.fn(() => ({ currentUser: null })),
    onAuthStateChanged: vi.fn(() => vi.fn()),
    connectAuthEmulator: vi.fn(),
  };
});

// Mock react-router-dom for routing components
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    BrowserRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Routes: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Route: ({ element }: { element: React.ReactElement }) => element,
    useNavigate: vi.fn(),
  };
});

// Mock route components
vi.mock('./pages/Dashboard', () => ({ default: () => (
  <div>
    <h2>Dashboard</h2>
    <p>Bienvenido al panel de administración de MINREPORT.</p>
  </div>
) }));
vi.mock('./pages/Subscriptions', () => ({ default: () => <div>Suscripciones</div> }));
vi.mock('./pages/Accounts', () => ({ default: () => <div>Cuentas</div> }));
vi.mock('./pages/PluginsManagement', () => ({ default: () => (
  <div className="plugins-management-container">
    <header className="plugins-management-header">
      <h1>Gestión de Plugins</h1>
      <button className="add-plugin-btn">Añadir Nuevo Plugin</button>
    </header>
    <div className="plugins-list">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Nombre</th>
            <th>Versión</th>
            <th>URL</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>plugin-externo</td>
            <td>Plugin Externo</td>
            <td>N/A</td>
            <td>http://localhost</td>
            <td><span className="status-badge status-enabled">enabled</span></td>
            <td>
              <button>Editar</button>
              <button className="delete-btn">Desactivar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
) }));
vi.mock('./pages/AccountDetails', () => ({ default: () => <div>Detalles de la Cuenta</div> }));
// Mock ThemeToggleButton y Sidebar para evitar errores de contexto
vi.mock('./components/ThemeToggleButton', () => ({
  ThemeToggleButton: () => <div>Theme Toggle Button</div>,
  __esModule: true,
}));
vi.mock('./components/Sidebar', () => ({
  Sidebar: () => <nav>MINREPORT</nav>,
  __esModule: true,
}));


describe('Admin App Component', () => {
  // Removed signOutSpy declaration


  beforeEach(async () => { // Make beforeEach async
    vi.resetModules();
    vi.clearAllMocks();
  useAuthMock.mockImplementation(() => ({
      user: null,
      isAdmin: false,
      loading: true,
      adminActivatedPlugins: [],
    }));
    // Removed signOutSpy assignment
  });

  describe('Authentication States', () => {
    it('renders loading state initially', async () => {
  useAuthMock.mockReturnValue({ user: null, isAdmin: false, loading: true, adminActivatedPlugins: [] });
  const { default: App } = await import('./App.js');
      render(<App />);
      expect(screen.getByText('Cargando...')).toBeInTheDocument();
    });

    it('renders Login UI when not authenticated', async () => {
  useAuthMock.mockReturnValue({ user: null, isAdmin: false, loading: false, adminActivatedPlugins: [] });
  const { default: App } = await import('./App.js');
      render(<App />);
      expect(screen.getByText('Iniciar Sesión - Panel de Administración')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Iniciar Sesión/i })).toBeInTheDocument();
    });

    it('renders Login UI when authenticated but not admin', async () => {
  useAuthMock.mockReturnValue({ user: { uid: '123' }, isAdmin: false, loading: false, adminActivatedPlugins: [] });
  const { default: App } = await import('./App.js');
      render(<App />);
      expect(screen.getByText('Iniciar Sesión - Panel de Administración')).toBeInTheDocument();
    });

    it('renders main app layout when authenticated as admin', async () => {
  useAuthMock.mockReturnValue({ user: { uid: '123' }, isAdmin: true, loading: false, adminActivatedPlugins: [] });
  const { default: App } = await import('./App.js');
      render(<App />);
      expect(screen.getByText('Panel de Administración')).toBeInTheDocument();
      expect(screen.getByText('MINREPORT')).toBeInTheDocument(); // Sidebar header
    });
  });

  describe('Navigation and Routing', () => {
      beforeEach(() => {
  useAuthMock.mockReturnValue({ user: { uid: '123' }, isAdmin: true, loading: false, adminActivatedPlugins: [] });
      });

    it('renders Dashboard for / route', async () => {
  const { default: App } = await import('./App.js');
      render(
        <BrowserRouter>
          <App />
        </BrowserRouter>
      );
  expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Bienvenido al panel de administración de MINREPORT.')).toBeInTheDocument();
    });

    it('renders Accounts for /accounts route', async () => {
  const { default: App } = await import('./App.js');
      render(
        <BrowserRouter>
          <App />
        </BrowserRouter>
      );
      expect(screen.getByText('Cuentas')).toBeInTheDocument();
    });

    it('renders AccountDetails for /accounts/:accountId route', async () => {
  const { default: App } = await import('./App.js');
      render(
        <BrowserRouter>
          <App />
        </BrowserRouter>
      );
      expect(screen.getByText(/Detalles de la Cuenta/i)).toBeInTheDocument();
    });

    it('renders PluginsManagement for /plugins route', async () => {
  const { default: App } = await import('./App.js');
      render(
        <BrowserRouter>
          <App />
        </BrowserRouter>
      );
  expect(screen.getByText('Gestión de Plugins')).toBeInTheDocument();
    });


// Isolated block to guarantee Firestore mock is picked up
describe('PluginSandbox integration', () => {
  it('renders PluginSandbox for /plugin-sandbox route with external plugin', async () => {
    vi.resetModules();
    const mockUnsubscribe = vi.fn();
    vi.doMock('firebase/firestore', async () => {
      const actual = await vi.importActual('firebase/firestore');
      return {
        ...actual,
        onSnapshot: (_colRef: any, onNext: any) => {
          onNext({
            docs: [
              {
                id: 'plugin-externo',
                data: () => ({ name: 'Plugin Externo', url: 'http://localhost', status: 'enabled' })
              }
            ]
          });
          return mockUnsubscribe;
        }
      };
    });
  const { default: App } = await import('./App.js');
    render(
      <MemoryRouter initialEntries={['/plugin-sandbox']}>
        <App />
      </MemoryRouter>
    );
    const heading = await screen.findByRole('heading', { level: 1, name: /Sandbox de Plugins/i });
    expect(heading).toBeInTheDocument();
  expect(screen.getAllByText('plugin-externo').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Plugin Externo').length).toBeGreaterThan(0);
  expect(screen.getAllByText('http://localhost').length).toBeGreaterThan(0);
  expect(screen.getAllByText('enabled').length).toBeGreaterThan(0);
    vi.resetModules();
  });
});
  });

// Eliminado expect redundante fuera de la suite de test
    beforeEach(() => {
  useAuthMock.mockImplementation(() => ({ user: { uid: '123' }, isAdmin: true, loading: false, adminActivatedPlugins: [] }));
      (firebaseAuth.signOut as any).mockClear();
      (firebaseAuth.signOut as any).mockImplementation(() => Promise.resolve());
    });

    it('calls signOut when logout button is clicked', async () => {
  const { default: App } = await import('./App.js');
      render(
        <BrowserRouter>
          <App />
        </BrowserRouter>
      );
      const logoutButton = screen.getByLabelText('Cerrar Sesión');
      fireEvent.click(logoutButton);
      await waitFor(() => {
        expect((firebaseAuth.signOut as any)).toHaveBeenCalled();
      });
    });

    it('shows an alert if signOut fails', async () => {
      (firebaseAuth.signOut as any).mockImplementation(() => Promise.reject(new Error('Logout failed')));
      const mockAlert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const { default: App } = await import('./App.js');
      render(
        <BrowserRouter>
          <App />
        </BrowserRouter>
      );
      const logoutButton = screen.getByLabelText('Cerrar Sesión');
      fireEvent.click(logoutButton);
      await waitFor(() => {
        expect((firebaseAuth.signOut as any)).toHaveBeenCalled();
        expect(mockAlert).toHaveBeenCalledWith('Error al cerrar sesión. Por favor, inténtalo de nuevo.');
      });
      mockAlert.mockRestore();
    });
  });