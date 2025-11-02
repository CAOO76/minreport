import { useEffect, useState } from 'react';
import type { ThemeProviderProps } from './themeConstants';
import { ThemeContext } from './ThemeContextInstance';

// Crea el componente proveedor
export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const [theme, setTheme] = useState(() => {
    // Obtiene el tema de localStorage o usa 'light' por defecto
    return localStorage.getItem('theme') || 'light';
  });

  useEffect(() => {
    // Aplica el tema al elemento <html> y lo guarda en localStorage
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prevTheme) => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
};
