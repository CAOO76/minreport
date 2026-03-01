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
                atkinson: ['"Atkinson Hyperlegible"', 'sans-serif'],
            },
            colors: {
                // Paleta personalizada "Antigravity / Modern"
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
                '3xl': '0 35px 60px -15px rgba(0, 0, 0, 0.3)',
            },
            borderRadius: {
                'none': '0',
                DEFAULT: '0',
            }
        },
    },
    plugins: [],
}