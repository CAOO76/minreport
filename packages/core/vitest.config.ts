import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true, // Enable Vitest globals (expect, describe, it, etc.)
    setupFiles: ['./setupTests.ts'], // Setup file for @testing-library/jest-dom
  },
  resolve: {
    alias: {
      'firebase/auth': path.resolve(__dirname, '../../__mocks__/firebase/auth.ts'),
    },
  },
});
