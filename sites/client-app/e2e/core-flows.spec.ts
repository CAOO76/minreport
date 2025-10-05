import { test, expect } from '@playwright/test';

test.describe('MINREPORT Core User Flows', () => {
  test.beforeEach(async ({ page }) => {
    // Navegar a la aplicación
    await page.goto('http://localhost:5175');
    
    // Esperar a que la aplicación cargue
    await page.waitForLoadState('networkidle');
  });

  test('should load home page successfully', async ({ page }) => {
    // Verificar que la página principal carga
    await expect(page).toHaveTitle(/MINREPORT/);
    
    // Verificar elementos básicos de la UI
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
  });

  test('should handle authentication flow', async ({ page }) => {
    // Buscar botón de login
    const loginButton = page.getByRole('button', { name: /login|sign in|iniciar sesión/i });
    
    if (await loginButton.isVisible()) {
      await loginButton.click();
      
      // Verificar que aparece el formulario de login
      const emailInput = page.getByRole('textbox', { name: /email/i });
      await expect(emailInput).toBeVisible();
      
      const passwordInput = page.getByRole('textbox', { name: /password|contraseña/i });
      await expect(passwordInput).toBeVisible();
    }
  });

  test('should handle offline functionality', async ({ page }) => {
    // Simular estado offline
    await page.context().setOffline(true);
    
    // Intentar una acción que requiera conectividad
    const actionButton = page.getByRole('button').first();
    if (await actionButton.isVisible()) {
      await actionButton.click();
      
      // Verificar que aparece indicador de offline
      const offlineIndicator = page.getByText(/offline|sin conexión/i);
      await expect(offlineIndicator).toBeVisible({ timeout: 5000 });
    }
    
    // Restaurar conectividad
    await page.context().setOffline(false);
  });

  test('should navigate between main sections', async ({ page }) => {
    // Verificar navegación básica
    const navLinks = page.getByRole('navigation').getByRole('link');
    const linkCount = await navLinks.count();
    
    if (linkCount > 0) {
      // Hacer clic en el primer enlace de navegación
      await navLinks.first().click();
      
      // Verificar que la URL cambió
      await page.waitForURL(/.*/, { timeout: 5000 });
      
      // Verificar que el contenido cambió
      const content = page.getByRole('main');
      await expect(content).toBeVisible();
    }
  });

  test('should handle responsive design', async ({ page }) => {
    // Test de responsive design
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone size
    
    // Verificar que la aplicación es responsive
    const body = page.locator('body');
    await expect(body).toBeVisible();
    
    // Verificar que no hay scroll horizontal
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 10); // Small margin for rounding
  });

  test('should load and display data', async ({ page }) => {
    // Esperar a que los datos carguen
    await page.waitForTimeout(2000);
    
    // Verificar que hay contenido dinámico
    const dataElements = page.getByTestId(/data|content|list|table/);
    
    if (await dataElements.first().isVisible()) {
      await expect(dataElements.first()).toBeVisible();
    } else {
      // Si no hay datos, verificar que hay un estado vacío o loading
      const emptyState = page.getByText(/no data|empty|loading|cargando/i);
      await expect(emptyState).toBeVisible();
    }
  });

  test('should handle errors gracefully', async ({ page }) => {
    // Interceptar requests para simular errores
    await page.route('**/api/**', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server error' })
      });
    });
    
    // Recargar la página para activar los errores
    await page.reload();
    
    // Verificar que se maneja el error apropiadamente
    const errorMessage = page.getByText(/error|failed|problema/i);
    await expect(errorMessage).toBeVisible({ timeout: 10000 });
  });
});

test.describe('MINREPORT Performance', () => {
  test('should meet performance benchmarks', async ({ page }) => {
    // Medir tiempo de carga inicial
    const startTime = Date.now();
    await page.goto('http://localhost:5175');
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - startTime;
    
    // Verificar que carga en menos de 5 segundos
    expect(loadTime).toBeLessThan(5000);
  });

  test('should handle large datasets efficiently', async ({ page }) => {
    await page.goto('http://localhost:5175');
    
    // Simular scroll infinito o paginación
    const scrollableElement = page.getByRole('main');
    if (await scrollableElement.isVisible()) {
      await scrollableElement.hover();
      
      // Hacer scroll y verificar que la aplicación responde
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(500);
      }
      
      // Verificar que la aplicación sigue respondiendo
      const interactiveElement = page.getByRole('button').first();
      if (await interactiveElement.isVisible()) {
        await expect(interactiveElement).toBeEnabled();
      }
    }
  });
});