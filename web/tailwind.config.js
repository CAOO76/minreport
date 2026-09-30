/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Atkinson Hyperlegible"', '"Google Sans"', 'system-ui', '-apple-system', 'sans-serif'],
                google: ['"Google Sans"', '"Google Sans Text"', 'sans-serif'],
                mono: ['"Google Sans Text"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
                atkinson: ['"Atkinson Hyperlegible"', 'sans-serif'],
            },
            spacing: {
                'fib-8': '8px',
                'fib-13': '13px',
                'fib-21': '21px',
                'fib-34': '34px',
                'fib-55': '55px',
                'fib-89': '89px',
            },
            colors: {
                // Acentos Funcionales Industriales (Estándar CABISEG)
                industrial: {
                    copper: '#C68346', // Acento Oficial MINREPORT Cobre
                    yellow: '#FFCD00',
                    cyan: '#00AEEF',   // Cian Tecnológico
                    darkBase: '#000000',
                    darkElevated: '#030406',
                    darkPanel: '#07090D',
                    darkBorder: '#12151C',
                    lightBase: '#FFFFFF',
                    lightElevated: '#F8FAFC',
                    lightBorder: '#E2E8F0',
                },
                // Paleta antigravity adaptada
                antigravity: {
                    light: {
                        bg: '#FFFFFF',
                        surface: '#F8FAFC',
                        text: '#0F172A',
                        muted: '#64748B',
                        border: '#E2E8F0',
                    },
                    dark: {
                        bg: '#000000',
                        surface: '#07090D',
                        text: '#F3F4F6',
                        muted: '#8A93A6',
                        border: '#12151C',
                    },
                    accent: '#C68346',
                },
            },
            boxShadow: {
                DEFAULT: 'none',
                'none': 'none',
            },
            borderRadius: {
                'none': '0',
                DEFAULT: '0',
            }
        },
    },
    plugins: [],
}
