import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 5179, // PUBLIC SITE - landing page
    host: 'localhost',
    strictPort: true,
  },
  plugins: [react()],
});