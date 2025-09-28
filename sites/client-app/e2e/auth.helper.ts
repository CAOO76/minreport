import { Page } from '@playwright/test';
import { onAuthStateChanged } from './playwright-auth-mock'; // Import onAuthStateChanged mock

export async function setupAuthenticatedUser(
  page: Page,
  uid: string,
  email: string,
  displayName: string,
  activePlugins: string[] = []
) {
  await page.exposeFunction('onAuthStateChanged', onAuthStateChanged);

  await page.evaluate((userProps) => {
    window.onAuthStateChanged({
      uid: userProps.uid,
      email: userProps.email,
      displayName: userProps.displayName,
      getIdToken: async () => 'mock-id-token',
      getIdTokenResult: async () => ({ claims: { activePlugins: userProps.activePlugins } }),
    });
  }, { uid, email, displayName, activePlugins });

  await page.goto('http://localhost:5175/');
  await page.waitForURL('http://localhost:5175/');
  await page.waitForSelector('.user-display-name', { timeout: 60000 });
}
