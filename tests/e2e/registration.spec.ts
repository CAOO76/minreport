import { test, expect } from '@playwright/test';
import { fillRut, waitForLoading, expectToast } from '../utils/helpers';

/**
 * E2E Registration Tests (Group 1)
 * 
 * Covering:
 * - E2E-001: ENTERPRISE Registration
 * - E2E-002: EDUCATIONAL Registration
 * - E2E-003: PERSONAL Registration
 */

test.describe('Account Registration Flow', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/register');
    });

    // ========================================
    // E2E-001: ENTERPRISE Registration
    // ========================================
    test('should register a new ENTERPRISE account', async ({ page }) => {
        // 1. Select ENTERPRISE tab
        await page.click('button:has-text("ENTERPRISE")');

        // 2. Fill Form
        await page.fill('input[placeholder="Tu nombre"]', 'Juan Pérez');
        await page.fill('input[type="email"]', 'admin@minera-abc.cl');
        await page.selectOption('select', 'CL'); // Country: Chile

        await page.fill('input[placeholder="Nombre de la empresa"]', 'Minera ABC S.A.');
        await fillRut(page, 'input[placeholder="RUT Empresa (12.345.678-9)"]', '76.123.456-7');

        // Scroll to industry
        await page.locator('select').nth(1).selectOption('Mining'); // Industry

        // 3. Submit
        await page.click('button:has-text("Solicitar Acceso Seguro")');

        // 4. Verify
        await waitForLoading(page);
        await expect(page.locator('text=Solicitud recibida')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('text=Nuestro equipo revisará tu información')).toBeVisible();
    });

    // ========================================
    // E2E-002: EDUCATIONAL Registration
    // ========================================
    test('should register a new EDUCATIONAL account', async ({ page }) => {
        // 1. Select EDUCATIONAL tab
        await page.click('button:has-text("EDUCATIONAL")');

        // 2. Fill Base Info
        await page.fill('input[placeholder="Tu nombre"]', 'María González');
        await page.fill('input[type="email"]', 'estudiante@uchile.cl');
        await page.selectOption('select', 'CL');

        // 3. Fill Edu Profile
        await page.selectOption('select:near(label:has-text("Perfil Académico"))', 'ALUMNO');
        await fillRut(page, 'input[placeholder="RUN (12.345.678-9)"]', '18.765.432-1');
        await page.fill('input[placeholder="Universidad o Instituto"]', 'Universidad de Chile');
        await page.fill('input[placeholder="Carrera / Programa"]', 'Ingeniería Civil');

        // Graduation Date
        await page.fill('input[type="date"]', '2027-12-31');

        // 4. Submit
        await page.click('button:has-text("Solicitar Acceso Seguro")');

        // 5. Verify
        await waitForLoading(page);
        await expect(page.locator('text=Solicitud recibida')).toBeVisible({ timeout: 10000 });
    });

    // ========================================
    // E2E-003: PERSONAL Registration
    // ========================================
    test('should register a new PERSONAL account', async ({ page }) => {
        // 1. Select PERSONAL tab
        await page.click('button:has-text("PERSONAL")');

        // 2. Fill Form
        await page.fill('input[placeholder="Tu nombre"]', 'Carlos Muñoz');
        await page.fill('input[type="email"]', 'carlos@gmail.com');
        await page.selectOption('select', 'CL');

        await fillRut(page, 'input[placeholder="RUN (12.345.678-9)"]', '15.234.567-8');
        await page.selectOption('select:near(label:has-text("Perfil de Uso"))', 'PROFESSIONAL');

        // 3. Submit
        await page.click('button:has-text("Solicitar Acceso Seguro")');

        // 4. Verify (Auto-approval flow typically ends with login or a direct dashboard link)
        await waitForLoading(page);
        // Personal accounts might have a different success screen or auto-redirect
        await expect(page.locator('text=Cuenta creada')).toBeVisible({ timeout: 10000 });
    });

    // ========================================
    // Validation Tests (Layer 1 EDU)
    // ========================================
    test('should reject public email for EDUCATIONAL account', async ({ page }) => {
        await page.click('button:has-text("EDUCATIONAL")');
        await page.fill('input[type="email"]', 'test@gmail.com');

        // Force validation by bluring or clicking submit
        await page.click('button:has-text("Solicitar Acceso Seguro")');

        await expect(page.locator('text=Email institucional requerido')).toBeVisible();
    });

    test('should validate RUT/RUN format', async ({ page }) => {
        await page.click('button:has-text("PERSONAL")');
        await page.fill('input[placeholder="RUN (12.345.678-9)"]', '12345678'); // Missing check digit or bad format

        await page.click('button:has-text("Solicitar Acceso Seguro")');

        // Should show error from Zod or native validation
        await expect(page.locator('text=Invalid ID Document')).toBeVisible();
    });

});
