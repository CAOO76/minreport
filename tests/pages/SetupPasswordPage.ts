import { Page, expect } from '@playwright/test';

export class SetupPasswordPage {
    constructor(public page: Page) { }

    async goto(link: string) {
        await this.page.goto(link);
        await expect(this.page.locator('text=Activar Acceso Seguro')).toBeVisible();
    }

    async fillPassword(password: string) {
        await this.page.fill('[data-testid="setup-password-input"]', password);
        await this.page.fill('[data-testid="setup-confirm-input"]', password);
    }

    async submit() {
        await this.page.click('[data-testid="setup-submit-button"]');
    }

    async expectSuccess() {
        await expect(this.page.locator('[data-testid="setup-success-title"]')).toBeVisible();
    }
}
