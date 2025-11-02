import { createContext } from 'react';
import type { ThemeContextType } from './themeConstants';

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
