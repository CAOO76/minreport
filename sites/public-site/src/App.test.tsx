import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import { ThemeProvider } from './contexts/ThemeContext';

// Mock ThemeToggleButton
vi.mock('./components/ThemeToggleButton', () => ({
  ThemeToggleButton: () => <div>Theme Toggle Button</div>,
}));

describe('Public Site', () => {
  it('should render the App component with correct content and client access link', () => {
    // Mock environment variable
    vi.stubEnv('VITE_CLIENT_APP_URL', 'https://mock-client-app.web.app');

    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );

    expect(screen.getByText('MINREPORT')).toBeInTheDocument();
    expect(screen.getByText('La plataforma integral para la gestión y reportabilidad de proyectos mineros.')).toBeInTheDocument();
    expect(screen.getByText('Theme Toggle Button')).toBeInTheDocument();

    const accessButton = screen.getByRole('link', { name: /Acceso Clientes/i });
    expect(accessButton).toBeInTheDocument();
    expect(accessButton).toHaveAttribute('href', 'https://mock-client-app.web.app');

    vi.unstubAllEnvs();
  });
});