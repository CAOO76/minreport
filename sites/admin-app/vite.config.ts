import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@minreport/core': path.resolve(__dirname, '../../packages/core/src'),
    },
    preserveSymlinks: false,
  },
  optimizeDeps: {
    include: [
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
      'firebase/functions',
    ],
    exclude: ['vitest'],
  },
  build: {
    rollupOptions: {
      external: ['vitest'],
    },
  },
});