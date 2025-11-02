import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './contexts/ThemeContext';

describe('Public Site', () => {
  it('should render the App component with correct content and client access link', () => {
    // Mock environment variable
    vi.stubEnv('VITE_CLIENT_APP_URL', 'https://mock-client-app.web.app');

    render(
      <MemoryRouter>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('MINREPORT')).toBeInTheDocument();
    expect(screen.getByText('La plataforma integral para la gestión y reportabilidad de proyectos mineros.')).toBeInTheDocument();
    
    // Check for theme toggle button by aria-label
    const themeToggleButton = screen.getByLabelText('Cambiar tema');
    expect(themeToggleButton).toBeInTheDocument();
    
    const accessButton = screen.getByRole('button', { name: /Portal Clientes/i });
    expect(accessButton).toBeInTheDocument();

    vi.unstubAllEnvs();
  });
});
