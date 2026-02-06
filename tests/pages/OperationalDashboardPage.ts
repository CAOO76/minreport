import { Page, expect } from '@playwright/test';

export class OperationalDashboardPage {
    constructor(private page: Page) { }

    async goto() {
        await this.page.goto('/dashboard');
    }

    async expectPluginVisible(pluginName: string) {
        // Los plugins aparecen como cards en el grid principal del dashboard operativo
        await expect(this.page.locator(`text=${pluginName}`)).toBeVisible();
    }

    async expectPluginNotVisible(pluginName: string) {
        await expect(this.page.locator(`text=${pluginName}`)).not.toBeVisible();
    }

    async expectAdminSettingsNotVisible() {
        // Verificamos que no exista acceso a configuración de admin global/cuenta en el sidebar
        await expect(this.page.locator('nav >> text=Admin Settings')).not.toBeVisible();
        await expect(this.page.locator('nav >> text=Configuración')).not.toBeVisible();
    }

    async openPlugin(pluginName: string) {
        await this.page.click(`text=${pluginName}`);
        // Verificar que se carga el PluginLoader (canvas)
        await expect(this.page.locator('id=plugin-canvas')).toBeVisible({ timeout: 15000 });
    }
}
