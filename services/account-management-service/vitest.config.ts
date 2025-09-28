import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'], // Only include .ts files in src/
    exclude: ['lib/**/*.test.js'], // Explicitly exclude .js files in lib/
  },
});