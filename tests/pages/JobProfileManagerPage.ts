import { Page, expect } from '@playwright/test';

export class JobProfileManagerPage {
    constructor(private page: Page) { }

    async goto() {
        await this.page.goto('/dashboard');
        // Asumimos que hay un link en el sidebar o una ruta directa
        await this.page.click('nav >> text=Job Profiles');
    }

    async openNewProfileModal() {
        await this.page.click('button:has-text("Nuevo Perfil")');
    }

    async fillBasicInfo(name: string, description: string) {
        await this.page.fill('input[name="name"]', name);
        await this.page.fill('textarea[name="description"]', description);
    }

    async isPluginVisible(pluginName: string): Promise<boolean> {
        const pluginCheckbox = this.page.locator(`label:has-text("${pluginName}")`);
        return await pluginCheckbox.isVisible();
    }

    async selectPlugin(pluginName: string) {
        await this.page.check(`label:has-text("${pluginName}") >> input[type="checkbox"]`);
    }

    async save() {
        await this.page.click('button:has-text("Guardar")');
    }

    async expectProfileInList(name: string) {
        await expect(this.page.locator(`text=${name}`)).toBeVisible();
    }
}
