import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'], // Apunta al nuevo archivo
    resolve: {
      alias: {
        '@minreport/core/utils': './src/utils',
      },
    },
  },
});