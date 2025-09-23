import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Custom Rollup plugin to ignore __mocks__ imports
const ignoreMocksPlugin = () => {
  return {
    name: 'ignore-mocks',
    resolveId(source, importer) {
      // If the import is from __mocks__ directory, return false to ignore it
      if (source.includes('__mocks__')) {
        return { id: source, external: true }; // Mark as external to prevent bundling
      }
      return null; // Let other plugins handle it
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), ignoreMocksPlugin()], // Add the custom plugin here
  server: {
    port: 5174,
    fs: {
      allow: [
        '../..', // Allow serving files from the project root (where __mocks__ is)
      ],
      deny: ['../../__mocks__'], // Deny access to the __mocks__ directory
    },
  },
  resolve: {
    alias: {
      '@minreport/core': path.resolve(__dirname, '../../packages/core/src'),
    },
  },
  optimizeDeps: {
    include: [
      'firebase/app',
      'firebase/firestore',
      'firebase/functions' 
    ],
    exclude: ['vitest'],
  },
  build: {
    rollupOptions: {
      external: ['vitest'], // Mark vitest as external
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});