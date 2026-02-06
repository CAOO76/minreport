import { test, expect } from '../fixtures/auth.fixture';

/**
 * E2E Security and Permissions Tests (Group 8)
 * 
 * Covering:
 * - E2E-018: Firestore Security Rules (Cross-account access)
 * - E2E-019: Special Role Permissions (BILLING_ONLY)
 */

test.describe('Security and Permissions', () => {

    // ========================================
    // E2E-018: Firestore Security Rules
    // ========================================
    test('should deny access to other account data in Firestore', async ({ workerUser }) => {
        // Pedro Soto is logged in

        // Attempt to access a different account via browser console / SDK
        const accessDenied = await workerUser.evaluate(async () => {
            try {
                const { getDoc, doc } = await import('firebase/firestore');
                const { db } = await import('../src/config/firebase');
                // Try to read a known other account ID
                await getDoc(doc(db, 'accounts', 'otra-cuenta-id-inexistente-o-ajena'));
                return false;
            } catch (error: any) {
                return error.code === 'permission-denied';
            }
        });

        expect(accessDenied).toBe(true);
    });

    // ========================================
    // E2E-019: BILLING_ONLY Role
    // ========================================
    test('should show limited Billing Dashboard for BILLING_ONLY role', async ({ page }) => {
        // We haven't created a specific fixture for billing only, so we'll mock or use a seeder user
        // Assuming Carlos Muñoz has a BILLING_ONLY role in some account

        // For this test, we skip if user not found, or we could seed one
        await page.goto('/login');
        await fillRut(page, 'input[placeholder*="RUT"]', '15.234.567-8');
        await page.click('button:has-text("Continuar")');

        // Select account where user is BILLING_ONLY
        await page.click('text=Carlos Muñoz');
        await page.fill('input[type="password"]', 'Personal123!');
        await page.click('button:has-text("Acceder")');

        // Verify redirection to BillingManagementDashboard
        await page.waitForURL('**/dashboard');
        await expect(page.locator('text=Gestión de Facturación')).toBeVisible();

        // Should NOT see operational features
        await expect(page.locator('text=Herramientas')).not.toBeVisible();
        await expect(page.locator('text=Mapas')).not.toBeVisible();
    });

});

// Helper for fillRut inside evaluate if needed
async function fillRut(page: any, selector: string, value: string) {
    await page.fill(selector, value);
}
