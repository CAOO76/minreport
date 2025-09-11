import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Define el tipo para el valor del contexto
type ThemeContextType = {
  theme: string;
  toggleTheme: () => void;
};

// Crea el contexto con un valor inicial undefined
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Define el hook para usar el contexto de forma segura
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme debe ser usado dentro de un ThemeProvider');
  }
  return context;
};

// Define las props para el proveedor
type ThemeProviderProps = {
  children: ReactNode;
};

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

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
