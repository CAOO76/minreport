import { test, expect, devices } from '@playwright/test';
import { fillRut, waitForLoading, waitForAuth } from '../utils/helpers';

/**
 * E2E Mobile Access Tests (Group 6)
 * 
 * Covering:
 * - E2E-013: Mobile Login ID-Centric
 * - E2E-014: Plugins in Mobile Tools
 * - E2E-015: Mobile Access Restriction for Owner
 */

// Use Mobile Pixel 5 for these tests
test.use({ ...devices['Pixel 5'] });

test.describe('Mobile App Experience', () => {

    // ========================================
    // E2E-013: Mobile Login
    // ========================================
    test('should login successfully on mobile using RUT and Password', async ({ page }) => {
        await page.goto('/mobile/login');

        // 1. Identification
        await fillRut(page, 'input[placeholder*="RUT"]', '19.876.543-2');
        await page.click('button:has-text("Continuar")');

        // 2. Account Selection
        await expect(page.locator('text=Selecciona Cuenta')).toBeVisible();
        await page.click('text=Minera ABC S.A.');

        // 3. Challenge
        await page.fill('input[type="password"]', 'Worker123!');
        await page.click('button:has-text("Acceder")');

        // 4. Verify Dashboard
        await page.waitForURL('**/mobile/dashboard');
        await expect(page.locator('text=Hola, Pedro Soto')).toBeVisible();
    });

    // ========================================
    // E2E-014: Mobile Plugins
    // ========================================
    test('should load plugins in Mobile Tools tab', async ({ page }) => {
        // We can use a direct goto if we have the auth state, but let's assume session persists
        await page.goto('/mobile/dashboard');

        // 1. Navigate to Tools
        await page.click('button[aria-label*="Herramientas"], text=Herramientas');

        // 2. Verify Plugins list
        await expect(page.locator('text=Fleet Tracking')).toBeVisible();

        // 3. Open Plugin
        await page.click('text=Fleet Tracking');

        // 4. Verify Plugin Loader
        await expect(page.locator('id=plugin-canvas')).toBeVisible();

        // 5. Back button
        await page.click('button:has(span:has-text("arrow_back"))');
        await expect(page.locator('text=Herramientas')).toBeVisible();
    });

    // ========================================
    // E2E-015: Mobile Restriction
    // ========================================
    test('should restrict mobile access for OWNER role', async ({ page }) => {
        await page.goto('/mobile/login');

        // 1. Identification (Enterprise Owner)
        await fillRut(page, 'input[placeholder*="RUT"]', '76.123.456-7');
        await page.click('button:has-text("Continuar")');

        // 2. Account Selection
        await page.click('text=Minera ABC S.A.');

        // 3. Challenge
        await page.fill('input[type="password"]', 'MineraABC123!');
        await page.click('button:has-text("Acceder")');

        // 4. Verify Restriction Error
        await expect(page.locator('text=Acceso móvil restringido para administradores')).toBeVisible();

        // Should stay on login
        await expect(page.url()).toContain('/mobile/login');
    });

});
