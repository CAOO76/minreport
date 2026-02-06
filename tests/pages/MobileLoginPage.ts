import { Page, expect } from '@playwright/test';
import { fillRut } from '../utils/helpers';

export class MobileLoginPage {
    constructor(private page: Page) { }

    async goto() {
        await this.page.goto('/mobile/login');
    }

    async identify(run: string) {
        await fillRut(this.page, 'input[placeholder="12.345.678-9"]', run);
        await this.page.click('button:has-text("Continuar")');
    }

    async selectAccount(accountName: string) {
        await this.page.click(`text=${accountName}`);
    }

    async login(password: string) {
        await this.page.fill('input[type="password"]', password);
        await this.page.click('button:has-text("Acceder al Entorno")');
    }

    async expectRestrictionError() {
        await expect(this.page.locator('text=Acceso móvil restringido para administradores')).toBeVisible();
    }

    async expectDashboard() {
        await this.page.waitForURL('**/mobile/dashboard');
        // Buscamos un texto estático del dashboard móvil
        await expect(this.page.locator('text=Actividad Reciente')).toBeVisible();
    }
}
