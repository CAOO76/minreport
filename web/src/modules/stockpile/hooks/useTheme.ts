import { useState, useEffect } from "react";

/**
 * Hook to manage and detect the current theme (light or dark).
 * It listens for changes in the "dark" class on the document root or body.
 */
export function useTheme() {
    const isEmbedded = typeof window !== "undefined" && (
        !!(window as any)._firebase_initialized || 
        !!(window as any).minreport
    );

    const [isDark, setIsDark] = useState(() => 
        (typeof document !== "undefined" && (
            document.documentElement.classList.contains("dark") || 
            document.body.classList.contains("dark")
        )) ||
        (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
    );

    useEffect(() => {
        if (typeof document === "undefined") return;

        // Observer to detect class changes on <html> or <body>
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === "attributes" && mutation.attributeName === "class") {
                    const hasDark = document.documentElement.classList.contains("dark") || 
                                   document.body.classList.contains("dark");
                    setIsDark(hasDark);
                }
            });
        });

        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

        return () => {
            observer.disconnect();
        };
    }, []);

    const toggleTheme = () => {
        if (isEmbedded) return; // Gobernanza centralizada en MINREPORT
        const newDark = !isDark;
        if (newDark) {
            document.documentElement.classList.add("dark");
            document.body.classList.add("dark");
        } else {
            document.documentElement.classList.remove("dark");
            document.body.classList.remove("dark");
        }
        setIsDark(newDark);
    };

    // Detect if running standalone (dev) or inside MINREPORT host
    const isDev = !isEmbedded && !(window as any).minreport;

    return { isDark, theme: isDark ? "dark" : "light", toggleTheme, isDev };
}
