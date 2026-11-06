import { chromium, FullConfig } from '@playwright/test';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Global Setup for Playwright Tests (MINREPORT)
 * Cumple GEMINI.md §1: Cero eliminación de datos de emuladores ni procesos activos; consola /admin unificada en puerto 5173.
 */
async function globalSetup(_config: FullConfig) {
    console.log('[Global Setup] Verificando entorno de emuladores Firebase...');

    const hubResponse = await fetch('http://127.0.0.1:4002').catch(() => null);
    if (!hubResponse || !hubResponse.ok) {
        throw new Error(
            '[Global Setup] Los emuladores de Firebase no estan activos en 127.0.0.1:4002. Inicielos con "npm run serve:emulators" antes de ejecutar E2E.'
        );
    }

    console.log('[Global Setup] Ejecutando aprovisionamiento idempotente (sin borrado de colecciones)...');
    await execAsync('npx ts-node tests/utils/db-seeder.ts');

    const superAdminPassword = process.env.E2E_SUPER_ADMIN_PASSWORD;
    if (!superAdminPassword) {
        console.log('[Global Setup] Variable E2E_SUPER_ADMIN_PASSWORD no declarada; se omite captura de sesion pre-autenticada.');
        return;
    }

    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await page.goto('http://localhost:5173/login');
        await page.waitForSelector('input[type="email"]', { timeout: 10000 });
        await page.fill('input[type="email"]', 'admin@minreport.com');
        await page.fill('input[type="password"]', superAdminPassword);
        await page.click('button[type="submit"]');
        await page.waitForSelector('input[type="email"]', { state: 'hidden', timeout: 30000 });
        await context.storageState({ path: 'tests/.auth/super-admin.json' });
        console.log('[Global Setup] Estado de sesion SUPER_ADMIN almacenado.');
    } finally {
        await browser.close();
    }
}

export default globalSetup;
