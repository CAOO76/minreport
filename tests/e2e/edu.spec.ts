import { test, expect } from '@playwright/test';
import { waitForFirestore, waitForLoading } from '../utils/helpers';

/**
 * E2E Educational Validation Tests (Group 7)
 * 
 * Covering:
 * - E2E-016: Automated Domain Validation (Gatekeeper Layer 1)
 * - E2E-017: Deep EDU validation findings in Admin Dashboard
 */

test.describe('Educational Gatekeeper Flow', () => {

    test('should perform automated domain validation on new EDU request', async ({ page, superAdmin }) => {
        // 1. Create EDU Request (Web)
        await page.goto('/register');
        await page.click('button:has-text("EDUCATIONAL")');
        await page.fill('input[placeholder="Tu nombre"]', 'Test Student');
        await page.fill('input[type="email"]', 'valido@uchile.cl');
        await page.selectOption('select', 'CL');
        await page.selectOption('select:near(label:has-text("Perfil Académico"))', 'ALUMNO');
        await page.fill('input[placeholder*="RUN"]', '12.345.678-9');
        await page.fill('input[placeholder="Universidad o Instituto"]', 'Universidad de Chile');
        await page.fill('input[placeholder="Carrera / Programa"]', 'Testing');
        await page.fill('input[type="date"]', '2027-01-01');

        await page.click('button:has-text("Solicitar Acceso Seguro")');
        await waitForLoading(page);

        // 2. Check Admin Dashboard for Gatekeeper Findings
        await superAdmin.goto('/admin');
        await superAdmin.click('button:has-text("Educacional")');

        const row = superAdmin.locator('tr:has-text("Test Student")');
        await expect(row).toBeVisible();

        // 3. Open Details to see Gatekeeper Layer 1 results
        await row.locator('button[aria-label*="Details"]').click();

        // 4. Verify Domain findings
        await expect(superAdmin.locator('text=Dominio Institucional: Válido')).toBeVisible();
        await expect(superAdmin.locator('text=Gatekeeper Status: VERIFIED')).toBeVisible();
    });

});
