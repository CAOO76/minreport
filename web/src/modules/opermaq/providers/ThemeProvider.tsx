import React, { createContext, useContext, useState, useEffect } from "react";

interface ThemeContextType {
  isDark: boolean;
  setIsDark: React.Dispatch<React.SetStateAction<boolean>>;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export interface ThemeProviderProps {
  children: React.ReactNode;
  embedded?: boolean;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, embedded }) => {
  const isEmbedded = embedded || (typeof window !== "undefined" && !!(window as any)._firebase_initialized);

  const [isDark, setIsDark] = useState(() => {
    if (typeof document !== "undefined") {
      if (document.documentElement.classList.contains("dark")) return true;
    }
    if (!isEmbedded) {
      const saved = typeof localStorage !== "undefined" ? localStorage.getItem("opermaq_theme") : null;
      if (saved) return saved === "dark";
      if (typeof window !== "undefined" && window.matchMedia) {
        return window.matchMedia("(prefers-color-scheme: dark)").matches;
      }
    }
    return false;
  });

  useEffect(() => {
    // Si corre embebido en MINREPORT, observamos pasivamente document.documentElement sin pisar las clases
    if (isEmbedded) {
      const checkDark = () => {
        const hasDark = document.documentElement.classList.contains("dark");
        setIsDark(hasDark);
      };
      checkDark();

      const observer = new MutationObserver(() => {
        checkDark();
      });

      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => observer.disconnect();
    }

    // Modo independiente (standalone DEV)
    const html = document.documentElement;
    if (isDark) {
      html.classList.add("dark");
      document.body.classList.add("dark");
      localStorage.setItem("opermaq_theme", "dark");
    } else {
      html.classList.remove("dark");
      document.body.classList.remove("dark");
      localStorage.setItem("opermaq_theme", "light");
    }
  }, [isDark, isEmbedded]);

  const toggleTheme = () => {
    if (isEmbedded) return; // Gobernanza centralizada en MINREPORT
    setIsDark(prev => !prev);
  };

  return (
    <ThemeContext.Provider value={{ isDark, setIsDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

/* eslint-disable react-refresh/only-export-components */
export function useThemeContext() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    const isDark = typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true;
    return {
      isDark,
      setIsDark: () => {},
      toggleTheme: () => {}
    };
  }
  return context;
}
