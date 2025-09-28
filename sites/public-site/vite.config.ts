import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 5179,
    strictPort: true, // Force Vite to use this port or fail
  },
  plugins: [react()],
  test: { // Add Vitest configuration
    globals: true, // Make expect, it, etc. global
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts', // Path to setup file
  },
});