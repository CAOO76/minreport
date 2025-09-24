import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // Cloud Functions run in Node.js environment
    globals: true,
    setupFiles: [], // Add setup files if needed
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'lib'],
  },
});
