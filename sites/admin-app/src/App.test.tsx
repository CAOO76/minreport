import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import { MemoryRouter } from 'react-router-dom';
import * as firebaseAuth from 'firebase/auth'; // Import firebase/auth as a module
import useAuth from './hooks/useAuth';

// Mock firebase/auth - Declare and initialize mockSignOut here, at the very top


vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    signOut: vi.fn(), // Provide a default mock function
    getAuth: vi.fn(() => ({ currentUser: null })),
    onAuthStateChanged: vi.fn(() => vi.fn()),
    connectAuthEmulator: vi.fn(),
  };
});

// Mock the local useAuth hook
vi.mock('./hooks/useAuth', () => ({
  default: vi.fn(),
}));

// Mock ThemeToggleButton from its actual location
vi.mock('./components/ThemeToggleButton', () => ({
  ThemeToggleButton: () => null,
}));



// Mock route components
vi.mock('./pages/Dashboard', () => ({ default: () => <div>Dashboard Page</div> }));
vi.mock('./pages/Subscriptions', () => ({ default: () => <div>Subscriptions Page</div> }));
vi.mock('./pages/Accounts', () => ({ default: () => <div>Accounts Page</div> }));
vi.mock('./pages/PluginsManagement', () => ({ default: () => <div>Plugins Management Page</div> }));
vi.mock('./pages/AccountDetails', () => ({ default: () => <div>Account Details Page</div> }));
vi.mock('./pages/PluginSandbox', () => ({ default: () => <div>Plugin Sandbox Page</div> }));

// Mock child components for simpler App testing
vi.mock('./components/Login', () => ({ default: () => <div>Login Component</div> }));
vi.mock('./components/Sidebar', () => ({ Sidebar: () => <div>Sidebar Component</div> }));

describe('Admin App Component', () => {
  let signOutSpy: vi.SpyInstance; // Declare the spy instance
  beforeEach(() => {
    vi.clearAllMocks();
    signOutSpy = vi.spyOn(firebaseAuth, 'signOut').mockImplementation(() => Promise.resolve());
  });

  describe('Authentication States', () => {
    it('renders loading state initially', () => {
      (useAuth as vi.Mock).mockReturnValue({ user: null, isAdmin: false, loading: true, adminActivatedPlugins: [] });
      render(<App />);
      expect(screen.getByText('Cargando...')).toBeInTheDocument();
    });

    it('renders Login component when not authenticated', () => {
      (useAuth as vi.Mock).mockReturnValue({ user: null, isAdmin: false, loading: false, adminActivatedPlugins: [] });
      render(<App />);
      expect(screen.getByText('Login Component')).toBeInTheDocument();
    });

    it('renders Login component when authenticated but not admin', () => {
      (useAuth as vi.Mock).mockReturnValue({ user: { uid: '123' }, isAdmin: false, loading: false, adminActivatedPlugins: [] });
      render(<App />);
      expect(screen.getByText('Login Component')).toBeInTheDocument();
    });

    it('renders main app layout when authenticated as admin', () => {
      (useAuth as vi.Mock).mockReturnValue({ user: { uid: '123' }, isAdmin: true, loading: false, adminActivatedPlugins: [] });
      render(
        <MemoryRouter>
          <App />
        </MemoryRouter>
      );
      expect(screen.getByText('Panel de Administración')).toBeInTheDocument();
      expect(screen.getByText('Sidebar Component')).toBeInTheDocument();
    });
  });

  describe('Navigation and Routing', () => {
    beforeEach(() => {
      (useAuth as vi.Mock).mockReturnValue({ user: { uid: '123' }, isAdmin: true, loading: false });
    });

    it('renders Dashboard for / route', () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      );
      expect(screen.getByText('Dashboard Page')).toBeInTheDocument();
    });

    it('renders Accounts for /accounts route', () => {
      render(
        <MemoryRouter initialEntries={['/accounts']}>
          <App />
        </MemoryRouter>
      );
      expect(screen.getByText('Accounts Page')).toBeInTheDocument();
    });

    it('renders AccountDetails for /accounts/:accountId route', () => {
      render(
        <MemoryRouter initialEntries={['/accounts/some-id']}>
          <App />
        </MemoryRouter>
      );
      expect(screen.getByText('Account Details Page')).toBeInTheDocument();
    });

    it('renders PluginsManagement for /plugins route', () => {
      render(
        <MemoryRouter initialEntries={['/plugins']}>
          <App />
        </MemoryRouter>
      );
      expect(screen.getByText('Plugins Management Page')).toBeInTheDocument();
    });

    it('renders PluginSandbox for /plugin-sandbox route', () => {
      render(
        <MemoryRouter initialEntries={['/plugin-sandbox']}>
          <App />
        </MemoryRouter>
      );
      expect(screen.getByText('Plugin Sandbox Page')).toBeInTheDocument();
    });
  });

  describe('Logout Functionality', () => {
    beforeEach(() => {
      (useAuth as vi.Mock).mockReturnValue({ user: { uid: '123' }, isAdmin: true, loading: false });
      signOutSpy.mockClear();
      signOutSpy.mockImplementation(() => Promise.resolve());
    });

    it('calls signOut when logout button is clicked', async () => {
      render(
        <MemoryRouter>
          <App />
        </MemoryRouter>
      );

      const logoutButton = screen.getByLabelText('Cerrar Sesión');
      fireEvent.click(logoutButton);

      await waitFor(() => {
        expect(signOutSpy).toHaveBeenCalled();
      });
    });

    it('shows an alert if signOut fails', async () => {
      signOutSpy.mockImplementation(() => Promise.reject(new Error('Logout failed'))); // Set specific implementation for this test
      const mockAlert = vi.spyOn(window, 'alert').mockImplementation(() => {});

      render(
        <MemoryRouter>
          <App />
        </MemoryRouter>
      );

      const logoutButton = screen.getByLabelText('Cerrar Sesión');
      fireEvent.click(logoutButton);

      await waitFor(() => {
        expect(signOutSpy).toHaveBeenCalled();
        expect(mockAlert).toHaveBeenCalledWith('Error al cerrar sesión. Por favor, inténtalo de nuevo.');
      });
      mockAlert.mockRestore();
    });
  });
});