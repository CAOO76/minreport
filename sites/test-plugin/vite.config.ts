import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true, // Force Vite to use this port or fail
  },
  optimizeDeps: {
    exclude: [path.resolve(__dirname, '../../__mocks__/*')], // Exclude all files in __mocks__
  },
  resolve: {
    alias: {
      'vitest': path.resolve(__dirname, '../../__mocks__/vitest.js'), // Add this line
    },
  },
});
