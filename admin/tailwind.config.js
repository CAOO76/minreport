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
                sans: ['"Atkinson Hyperlegible"', 'sans-serif'],
            },
            colors: {
                primary: {
                    DEFAULT: '#4F46E5', // Indigo for Admin
                    dark: '#4338CA',
                },
                surface: {
                    light: '#F8FAFC',
                    dark: '#0F172A',
                    card: {
                        light: '#FFFFFF',
                        dark: '#1E293B',
                    }
                }
            },
            boxShadow: {
                'none': 'none',
            }
        },
    },
    plugins: [],
}
