import { test, expect } from '@playwright/test';
import { onAuthStateChanged } from '../../../__mocks__/firebase/auth'; // Import onAuthStateChanged mock

test.describe('Plugin Loading and Interaction', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.setTimeout(60000); // Set timeout for beforeEach hook to 60 seconds

    // Expose the mock function to the page's context
    await page.exposeFunction('onAuthStateChanged', onAuthStateChanged);

    // Directly simulate a logged-in user by triggering onAuthStateChanged
    await page.evaluate(() => {
      // This code runs in the browser context
      // We need to expose onAuthStateChanged to the browser context
      // This is a hack for testing, normally you wouldn't do this in production
      window.onAuthStateChanged({
        uid: 'mock-user-uid',
        email: 'test@example.com',
        displayName: 'Test User',
        getIdToken: async () => 'mock-id-token',
        getIdTokenResult: async () => ({ claims: { activePlugins: ['test-plugin'] } }),
      });
    });

    // Navigate directly to the dashboard after setting the auth state
    await page.goto('http://localhost:5175/');
    await page.waitForURL('http://localhost:5175/'); // Ensure we are on the dashboard
    await page.waitForSelector('.user-display-name', { timeout: 60000 }); // Wait for user display name to appear
  });
    // Wait for successful login and redirection to dashboard
    await page.waitForURL('http://localhost:5175/');
    await page.waitForSelector('.user-display-name', { timeout: 60000 }); // Wait for user display name to appear
  });

  test('should load the test-plugin within an iframe and display user data', async ({ page }) => {
  test.setTimeout(60000); // Set timeout for this specific test to 60 seconds
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
