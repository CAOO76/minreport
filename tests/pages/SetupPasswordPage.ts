import { Page, expect } from '@playwright/test';

export class SetupPasswordPage {
    constructor(public page: Page) { }

    async goto(link: string) {
        await this.page.goto(link);
        await expect(this.page.locator('text=Activar Acceso Seguro')).toBeVisible();
    }

    async fillPassword(password: string) {
        await this.page.fill('input[placeholder="Mínimo 8 caracteres"]', password);
        await this.page.fill('input[placeholder="Repite la contraseña"]', password);
    }

    async submit() {
        await this.page.click('button:has-text("Activar Clave Exclusiva")');
    }

    async expectSuccess() {
        await expect(this.page.locator('text=¡Seguridad Activada!')).toBeVisible();
    }
}
