import { test, expect } from '@playwright/test';

test.describe('Plugin Loading and Interaction', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the client app's login page
    await page.goto('http://localhost:5175/login');
    await page.waitForURL('http://localhost:5175/login'); // Ensure we are on the login page
    await page.waitForLoadState('networkidle'); // Wait for the page to be fully loaded
    await page.waitForTimeout(5000); // Add a brute-force wait to ensure app is ready

    // Simulate user login (assuming a seeded user in Firebase Emulator)
    await page.waitForSelector('input[type="email"]', { timeout: 10000 }); // Increase timeout for selector
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button:has-text("Iniciar Sesión")');
    await page.screenshot({ path: 'test-results/login-after-click.png' }); // Take screenshot

    // Wait for Firebase login API response
    await page.waitForResponse(response => response.url().includes('identitytoolkit.googleapis.com/v1/accounts:signInWithPassword') && response.status() === 200);

    // Wait for successful login and redirection to dashboard
    await page.waitForURL('http://localhost:5175/');
  });

  test('should load the test-plugin within an iframe and display user data', async ({ page }) => {
    // Navigate to the plugin page
    await page.goto('http://localhost:5175/plugins/test-plugin');

    // Wait for the iframe to load
    const iframe = page.frameLocator('iframe[title="Plugin: test-plugin"]');
    await expect(iframe.locator('h1')).toHaveText('🔌 Plugin de Prueba (SDK v2)');

    // Verify that the plugin displays the user's email from the SDK context
    await expect(iframe.locator('text=Connected as test@example.com')).toBeVisible();
    await expect(iframe.locator('pre')).toContainText('"email": "test@example.com"');

    // Interact with the DataForm inside the plugin
    await iframe.locator('input[placeholder="Escribe algo..."]').fill('Hello from Playwright!');
    await iframe.locator('button:has-text("Guardar en MINREPORT")').click();

    // Verify feedback from the plugin
    await expect(iframe.locator('text=Estado: Data saved successfully.')).toBeVisible();
  });
});
