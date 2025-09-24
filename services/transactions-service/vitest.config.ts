import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // Or 'jsdom' if testing DOM-related code
    globals: true,
    setupFiles: [], // Add setup files if needed
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'lib'],
  },
});
