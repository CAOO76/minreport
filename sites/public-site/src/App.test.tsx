import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import { ThemeProvider } from './contexts/ThemeContext'; // Asumiendo que la ruta es correcta

describe('Public Site', () => {
  it('should render the App component', () => {
    // Envuelve el componente App con el ThemeProvider
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );

    // Ajusta el texto que buscas al contenido real de tu App
    // Por ejemplo, si tu App muestra un título "Bienvenido", úsalo aquí.
    expect(screen.getByText('MINREPORT')).toBeInTheDocument(); 
  });
});