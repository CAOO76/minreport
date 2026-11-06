import { FullConfig } from '@playwright/test';

/**
 * Global Teardown for Playwright Tests
 * Regla Soberana GEMINI.md §1: Prohibido detener emuladores activos o eliminar datos locales.
 */
async function globalTeardown(_config: FullConfig) {
    console.log('[Global Teardown] Finalizado preservando integridad de emuladores y datos locales.');
}

export default globalTeardown;
