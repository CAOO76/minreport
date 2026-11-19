import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { isNativeMobileRuntime } from '../i18n';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function readSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const nativeDark = (window as unknown as { __MINREPORT_NATIVE_DARK__?: boolean }).__MINREPORT_NATIVE_DARK__;
  if (isNativeMobileRuntime() && typeof nativeDark === 'boolean') {
    return nativeDark ? 'dark' : 'light';
  }
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const isNative = isNativeMobileRuntime();

  const [theme, setTheme] = useState<Theme>(() => {
    if (isNative) {
      try {
        localStorage.removeItem('theme');
      } catch {
        // Ignorar en entornos restringidos
      }
      return readSystemTheme();
    }
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme === 'dark' || storedTheme === 'light') return storedTheme;
    return readSystemTheme();
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    document.documentElement.style.colorScheme = theme;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', theme === 'dark' ? '#000000' : '#FFFFFF');
    }
  }, [theme]);

  useEffect(() => {
    const mediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    const handleChange = (e: MediaQueryListEvent) => {
      if (isNative || !localStorage.getItem('theme')) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };

    const handleOsConfigChange = (e: Event) => {
      if (!isNative) return;
      const custom = e as CustomEvent<{ isDark?: boolean }>;
      if (typeof custom.detail?.isDark === 'boolean') {
        setTheme(custom.detail.isDark ? 'dark' : 'light');
      } else {
        setTheme(readSystemTheme());
      }
    };

    mediaQuery?.addEventListener('change', handleChange);
    window.addEventListener('minreport:os-config-change', handleOsConfigChange);
    return () => {
      mediaQuery?.removeEventListener('change', handleChange);
      window.removeEventListener('minreport:os-config-change', handleOsConfigChange);
    };
  }, [isNative]);

  const toggleTheme = () => {
    const newTheme: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    if (!isNative) {
      localStorage.setItem('theme', newTheme);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const useOptionalTheme = () => {
  return useContext(ThemeContext);
};
