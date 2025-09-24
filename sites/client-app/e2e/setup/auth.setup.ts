import { test as setup, expect } from '@playwright/test';

const authFile = 'e2e/auth.json';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'app_dev@minreport.com');
  await page.fill('input[name="password"]', 'password-seguro-local');
  await page.click('button[type="submit"]');
  await page.screenshot({ path: 'login-attempt.png' });

  await expect(page.locator('.user-display-name')).toBeVisible();

  await page.context().storageState({ path: authFile });
});
