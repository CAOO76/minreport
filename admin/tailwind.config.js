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
                sans: ['"Atkinson Hyperlegible Next"', '"Atkinson Hyperlegible"', 'sans-serif'],
                mono: ['"Atkinson Hyperlegible Mono"', 'ui-monospace', 'monospace'],
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
                // Paleta Oficial MINREPORT
                antigravity: {
                    light: {
                        bg: '#FAFAFA',
                        surface: '#FFFFFF',
                        text: '#0D0D0D',
                        muted: 'rgba(0, 0, 0, 0.4)',
                        border: 'rgba(0, 0, 0, 0.05)',
                    },
                    dark: {
                        bg: '#000000',
                        surface: '#0D0D0D',
                        text: '#F2F2F2',
                        muted: 'rgba(255, 255, 255, 0.4)',
                        border: 'rgba(255, 255, 255, 0.05)',
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
