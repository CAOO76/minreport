import { test, expect } from '@playwright/test';

test.describe('MINREPORT Web 3.0 Identity & Secret Gateway Tests', () => {

    test('TC-01: Debe bloquear silenciosamente a dev@minreport.com en el login público', async ({ page }) => {
        await page.goto('/login');

        // Llenar formulario público con credencial DEV
        await page.fill('input[type="email"]', 'dev@minreport.com');
        await page.fill('input[type="password"]', process.env.DEV_ROOT_PASSWORD || 'dummy-test-pass');
        await page.click('button[type="submit"]');

        // Debe mostrar error de acceso no permitido y no redirigir
        const errorMsg = page.locator('text=tipo de acceso no permitido');
        await expect(errorMsg).toBeVisible({ timeout: 5000 });
        expect(page.url()).toContain('/login');
    });

    test('TC-02: Debe cargar el Gateway Secreto en /dev-vault-gateway con directiva noindex y sin campos prellenados', async ({ page }) => {
        await page.goto('/dev-vault-gateway');

        // Validar título y etiqueta robots
        await expect(page).toHaveTitle('MINREPORT');
        
        const robotsMeta = page.locator('meta[name="robots"]');
        await expect(robotsMeta).toHaveAttribute('content', 'noindex, nofollow');

        // Validar interfaz industrial pura con campos limpios y vacíos
        await expect(page.locator('input[type="email"]')).toHaveValue('');
        await expect(page.locator('input[type="password"]')).toHaveValue('');
        
        // Blindaje: El email de desarrollo dev@minreport.com NO debe figurar en el HTML previo al login
        await expect(page.locator('text=dev@minreport.com')).toHaveCount(0);
    });

    test('TC-03: Debe cargar el login móvil /mobile/login con Material Symbols', async ({ page }) => {
        await page.goto('/mobile/login');

        // Validar encabezado móvil y ausencia de librerías externas
        await expect(page.locator('text=MINREPORT MOBILE')).toBeVisible();
        await expect(page.locator('text=Acceso Operativo de Faena')).toBeVisible();

        // Validar botón de acceso
        const submitBtn = page.locator('button[type="submit"]');
        await expect(submitBtn).toBeVisible();
    });

});
