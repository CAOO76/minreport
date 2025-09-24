import { test, expect } from '@playwright/test';
import { onAuthStateChanged } from '../../../__mocks__/firebase/auth'; // Import onAuthStateChanged mock

test.describe('Plugin Loading and Interaction', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.setTimeout(60000); // Set timeout for beforeEach hook to 60 seconds

    // Expose the mock function to the page's context
    await page.exposeFunction('onAuthStateChanged', onAuthStateChanged);

    // Navigate directly to the dashboard after setting the auth state
    await page.goto('http://localhost:5175/');
    await page.waitForURL('http://localhost:5175/'); // Ensure we are on the dashboard
    await page.waitForSelector('.user-display-name', { timeout: 60000 }); // Wait for user display name to appear
  });

  test('should load the test-plugin within an iframe and display user data', async ({ page }) => {
    test.setTimeout(60000); // Set timeout for this specific test to 60 seconds

    // Directly simulate a logged-in user with active plugin
    await page.evaluate(() => {
      window.onAuthStateChanged({
        uid: 'mock-user-uid',
        email: 'test@example.com',
        displayName: 'Test User',
        getIdToken: async () => 'mock-id-token',
        getIdTokenResult: async () => ({ claims: { activePlugins: ['test-plugin'] } }),
      });
    });

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

  test('should not load the test-plugin if not active for the user', async ({ page }) => {
    test.setTimeout(60000); // Set timeout for this specific test to 60 seconds

    // Directly simulate a logged-in user WITHOUT active plugin
    await page.evaluate(() => {
      window.onAuthStateChanged({
        uid: 'mock-user-uid',
        email: 'test@example.com',
        displayName: 'Test User',
        getIdToken: async () => 'mock-id-token',
        getIdTokenResult: async () => ({ claims: { activePlugins: [] } }), // No active plugins
      });
    });

    // Navigate to the plugin page
    await page.goto('http://localhost:5175/plugins/test-plugin');

    // Expect the iframe not to be visible, or an error message
    await expect(page.locator('iframe[title="Plugin: test-plugin"]')).not.toBeVisible();
    // Depending on the UI, you might expect a specific error message
    await expect(page.getByText('Error al cargar el plugin: No se pudo obtener la URL segura para el plugin.')).toBeVisible();
  });
});