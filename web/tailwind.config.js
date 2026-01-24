/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class', // Fundamental para que el botón de Sol/Luna funcione
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Atkinson Hyperlegible"', 'sans-serif'],
            },
            colors: {
                // Paleta personalizada "Antigravity / Modern"
                antigravity: {
                    light: {
                        bg: '#f3f3f3',       // Fondo de escritorio (Gris muy suave)
                        surface: '#ffffff',  // Fondo de Barras y Tarjetas (Blanco puro)
                        text: '#1f2937',     // Texto principal (Casi negro)
                        muted: '#6b7280',    // Texto secundario (Gris)
                        border: '#e5e7eb',   // Color de líneas divisorias
                    },
                    dark: {
                        bg: '#1f1f1f',       // Fondo de escritorio (Dark Modern original)
                        surface: '#181818',  // Fondo de Barras (Un tono más oscuro para contraste)
                        text: '#e6edf3',     // Texto principal (Blanco suave)
                        muted: '#8b949e',    // Texto secundario (Gris metalizado)
                        border: '#30363d',   // Color de líneas divisorias oscuras
                    },
                    // Color de Acento (Azul VS Code / Modern Blue)
                    accent: '#007fd4',
                }
            },
            boxShadow: {
                // Mantenemos tu preferencia de diseño plano (sin sombras difusas)
                DEFAULT: 'none',
            }
        },
    },
    plugins: [],
}