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
                    DEFAULT: '#005F73', // Petrol Blue
                    hover: '#004C5C',
                },
                surface: {
                    light: '#F5F5F5',
                    dark: '#121212',
                    card: {
                        light: '#FFFFFF',
                        dark: '#1E1E1E'
                    }
                }
            },
            boxShadow: {
                // Forbidden diffuse shadows, replaced with none or harsh if needed (but prefer borders)
                DEFAULT: 'none',
            }
        },
    },
    plugins: [],
}
