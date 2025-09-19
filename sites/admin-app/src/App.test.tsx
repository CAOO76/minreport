import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import useAuth from '@minreport/core/hooks/useAuth';
import { ThemeProvider } from './contexts/ThemeContext'; // Importa tu ThemeProvider real

// Simula el hook useAuth
vi.mock('@minreport/core/hooks/useAuth');

describe('Admin App', () => {
  it('should render the loading state correctly', () => {
    // Configura la simulación para que devuelva el estado de "cargando"
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: true,
      activePlugins: null,
    });

    render(
      // Envuelve la App con su ThemeProvider, igual que en main.tsx
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );

    // Busca el texto de carga correcto. Tu componente renderiza "Cargando..."
    expect(screen.getByText('Cargando...')).toBeInTheDocument();
  });

  // (Aquí puedes añadir más tests para otros estados)
});