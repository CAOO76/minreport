/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: {
    port: 5177, // ADMIN APP
    host: 'localhost',
    strictPort: true,
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@minreport/core': path.resolve(dirname, '../../packages/core/src'),
    },
  },
});
