import { test, expect } from '../fixtures/auth.fixture';
import { waitForFirestore, expectToast, waitForLoading } from '../utils/helpers';

/**
 * E2E Admin and Plugin Tests (Groups 2 & 3)
 * 
 * Covering:
 * - E2E-004: Approve ENTERPRISE Account with Plugins
 * - E2E-005: Reject EDUCATIONAL Account
 * - E2E-006: Modify Plugins of Active Account
 * - E2E-007: Validate Plugin inheritance in Job Profiles
 */

test.describe('Admin Dashboard Operations', () => {

    // ========================================
    // E2E-004: Approve ENTERPRISE Account
    // ========================================
    test('should approve a pending ENTERPRISE account and assign plugins', async ({ superAdmin }) => {
        await superAdmin.goto('/admin');

        // 1. Go to B2B Tab
        await superAdmin.click('button:has-text("Empresas (B2B)")');

        // 2. Find pending request (should be created by seeder or previous test)
        // For this test, we assume 'Minera ABC S.A.' is PENDING_APPROVAL
        const row = superAdmin.locator('tr:has-text("Minera ABC S.A.")');
        await expect(row).toBeVisible();

        // 3. Click Approve/Details
        await row.locator('button[aria-label*="Details"], button[aria-label*="Ver"]').click();

        // 4. In Modal, check plugins
        await superAdmin.check('input[name="stockpile-control"]');
        await superAdmin.check('input[name="inventory-management"]');

        // 5. Approve
        await superAdmin.click('button:has-text("Aprobar")');

        // 6. Verify
        await expectToast(superAdmin, 'Cuenta aprobada');
        await expect(row.locator('text=ACTIVE')).toBeVisible();
    });

    // ========================================
    // E2E-005: Reject EDUCATIONAL Account
    // ========================================
    test('should reject a pending EDUCATIONAL account with reason', async ({ superAdmin }) => {
        await superAdmin.goto('/admin');

        // 1. Go to Educational Tab
        await superAdmin.click('button:has-text("Educacional")');

        // 2. Find request
        const row = superAdmin.locator('tr:has-text("María González")');
        await expect(row).toBeVisible();

        // 3. Click Reject
        await row.locator('button[aria-label*="Reject"], button[aria-label*="Rechazar"]').click();

        // 4. Provide reason
        await superAdmin.fill('textarea[placeholder*="motivo"]', 'Documento de matrícula no válido');
        await superAdmin.click('button:has-text("Confirmar Rechazo")');

        // 5. Verify
        await expectToast(superAdmin, 'Solicitud rechazada');
        await expect(row.locator('text=REJECTED')).toBeVisible();
    });

    // ========================================
    // E2E-006: Modify Plugins
    // ========================================
    test('should modify enabled plugins for an active account', async ({ superAdmin }) => {
        await superAdmin.goto('/admin');
        await superAdmin.click('button:has-text("Empresas (B2B)")');

        const row = superAdmin.locator('tr:has-text("Minera ABC S.A.")');
        await row.locator('button[aria-label*="Settings"], button[aria-label*="Administrar"]').click();

        // Uncheck one, check another
        await superAdmin.uncheck('input[name="inventory-management"]');
        await superAdmin.check('input[name="fleet-tracking"]');

        await superAdmin.click('button:has-text("Guardar Cambios")');

        await expectToast(superAdmin, 'Configuración actualizada');
    });

});

test.describe('Owner Plugin Management', () => {

    // ========================================
    // E2E-007: Job Profile Plugin Inheritance
    // ========================================
    test('should only show enabled account plugins when creating Job Profile', async ({ enterpriseOwner }) => {
        await enterpriseOwner.goto('/dashboard');

        // 1. Navigate to Job Profiles
        await enterpriseOwner.click('text=Job Profiles'); // Or use sidebar link

        // 2. Start creating new profile
        await enterpriseOwner.click('button:has-text("Nuevo Perfil")');

        // 3. Check visibility of plugins
        // Based on E2E-006, should have stockpile-control and fleet-tracking
        await expect(enterpriseOwner.locator('text=Stockpile Control')).toBeVisible();
        await expect(enterpriseOwner.locator('text=Fleet Tracking')).toBeVisible();

        // Inventory Management should NOT be visible if disabled by admin
        await expect(enterpriseOwner.locator('text=Inventory Management')).not.toBeVisible();

        // 4. Fill and Save
        await enterpriseOwner.fill('input[name="name"]', 'Operador Junior');
        await enterpriseOwner.check('input[value="fleet-tracking"]');
        await enterpriseOwner.click('button:has-text("Guardar")');

        await expect(enterpriseOwner.locator('text=Operador Junior')).toBeVisible();
    });

});
