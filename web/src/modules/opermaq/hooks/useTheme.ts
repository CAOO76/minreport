import { useThemeContext } from '../providers/ThemeProvider';

/**
 * useTheme: Alias for useThemeContext to maintain backward compatibility
 * Centralized theme management for OPERMAQ
 */
export function useTheme() {
  return useThemeContext();
}
