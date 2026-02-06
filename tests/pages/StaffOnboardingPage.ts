import { Page, expect } from '@playwright/test';
import { fillRut, waitForLoading } from '../utils/helpers';

export class StaffOnboardingPage {
    constructor(private page: Page) { }

    async goto() {
        await this.page.goto('/dashboard');
        await this.page.click('nav >> text=Trabajadores');
    }

    async openOnboardingForm() {
        await this.page.click('button:has-text("Vincular Trabajador")');
    }

    async fillWorkerData(run: string, name: string, email: string) {
        await fillRut(this.page, 'input[placeholder*="RUN"]', run);
        await this.page.fill('input[placeholder="Nombre completo"]', name);
        await this.page.fill('input[type="email"]', email);
    }

    async selectJobProfile(profileName: string) {
        // En StaffOnboarding.tsx los perfiles se muestran como tarjetas clicables
        await this.page.click(`div[role="button"]:has-text("${profileName}")`);
    }

    async submit() {
        await this.page.click('button:has-text("Vincular")');
    }

    async expectSuccess() {
        await waitForLoading(this.page);
        await expect(this.page.locator('text=Trabajador vinculado exitosamente')).toBeVisible();
    }
}
