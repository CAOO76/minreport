import { test, expect } from '../fixtures/auth.fixture';
import { fillRut, waitForLoading, expectToast, waitForNavigationWithRetry } from '../utils/helpers';

/**
 * E2E Staff Onboarding and Desktop Access Tests (Groups 4 & 5)
 * 
 * Covering:
 * - E2E-008: Staff Onboarding with Job Profile
 * - E2E-009: Worker Password Setup (Partial - Mocking email click)
 * - E2E-010: Desktop Login with Account Selector
 * - E2E-011: Operational Dashboard Visibility
 * - E2E-012: Corporate Dashboard Visibility (Owner)
 */

test.describe('Staff Onboarding Flow', () => {

    // ========================================
    // E2E-008: Staff Onboarding
    // ========================================
    test('should onboard a new worker with specific job profile', async ({ enterpriseOwner }) => {
        await enterpriseOwner.goto('/dashboard');

        // 1. Open Onboarding Component
        await enterpriseOwner.click('text=Trabajadores'); // Assuming link in sidebar
        await enterpriseOwner.click('button:has-text("Vincular Trabajador")');

        // 2. Fill Form
        await fillRut(enterpriseOwner, 'input[placeholder*="RUN"]', '19.876.543-2');
        await enterpriseOwner.fill('input[placeholder="Nombre completo"]', 'Pedro Soto');
        await enterpriseOwner.fill('input[type="email"]', 'pedro.soto@minera-abc.cl');

        // 3. Select Job Profile
        // Using the card selector from StaffOnboarding.tsx
        await enterpriseOwner.click('text=Operador CAEX');

        // 4. Submit
        await enterpriseOwner.click('button:has-text("Vincular")');

        // 5. Verify
        await waitForLoading(enterpriseOwner);
        await expectToast(enterpriseOwner, 'Trabajador vinculado exitosamente');
    });

});

test.describe('Desktop Access and Dashboards', () => {

    // ========================================
    // E2E-010: Login with Account Selector
    // ========================================
    test('should show account selector during login for user with multiple roles', async ({ page }) => {
        await page.goto('/login');

        // 1. Identification (Personal User Carlos Muñoz)
        // Carlos has both PERSONAL and (mocked) EDUCATIONAL or BUSINESS roles if setup
        await fillRut(page, 'input[placeholder*="RUT"]', '15.234.567-8');
        await page.click('button:has-text("Continuar")');

        // 2. Verify Selector
        // Carlos Muñoz - Personal Account
        await expect(page.locator('text=Carlos Muñoz')).toBeVisible();

        // 3. Select and Challenge
        await page.click('text=Carlos Muñoz');
        await page.fill('input[type="password"]', 'Personal123!');
        await page.click('button:has-text("Acceder")');

        // 4. Verify Dashboard
        await page.waitForURL('**/dashboard');
        await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible();
    });

    // ========================================
    // E2E-011: Operational Dashboard Visibility
    // ========================================
    test('should show only allowed plugins in Operational Dashboard for Worker', async ({ workerUser }) => {
        await workerUser.goto('/dashboard');

        // Pedro Soto (Worker) has 'Operador CAEX' profile
        // Profile only allows 'Fleet Tracking'

        // 1. Verify Plugins
        await expect(workerUser.locator('text=Fleet Tracking')).toBeVisible();
        await expect(workerUser.locator('text=Stockpile Control')).not.toBeVisible();

        // 2. Open Plugin
        await workerUser.click('text=Fleet Tracking');

        // 3. Verify Plugin Loader
        await expect(workerUser.locator('id=plugin-canvas')).toBeVisible();
    });

    // ========================================
    // E2E-012: Corporate Dashboard Visibility
    // ========================================
    test('should show Corporate Dashboard features for Owner', async ({ enterpriseOwner }) => {
        await enterpriseOwner.goto('/dashboard');

        // Owner of Enterprise account should see management metrics
        await expect(enterpriseOwner.locator('text=Métricas de Uso')).toBeVisible();
        await expect(enterpriseOwner.locator('text=Facturación')).toBeVisible();
        await expect(enterpriseOwner.locator('text=Delegación de Mando')).toBeVisible();

        // Should NOT see maps/operational plugins directly in dashboard (Management view)
        await expect(enterpriseOwner.locator('.operational-map')).not.toBeVisible();
    });

});
