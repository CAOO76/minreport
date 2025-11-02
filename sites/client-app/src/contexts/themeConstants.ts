// Constantes y tipos para ThemeContext
import type { ReactNode } from 'react';

export type ThemeContextType = {
  theme: string;
  toggleTheme: () => void;
};

export type ThemeProviderProps = {
  children: ReactNode;
};
