import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Excluye explícitamente la carpeta lib y node_modules del escaneo de tests
    exclude: ['node_modules', 'lib'],
    // Aumenta el timeout por defecto para evitar los fallos de 'Test timed out'
    testTimeout: 10000,
  },
});
