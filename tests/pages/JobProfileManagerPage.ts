import { Page, expect } from '@playwright/test';

export class JobProfileManagerPage {
    constructor(private page: Page) { }

    async goto() {
        console.log('[E2E-POM] Navegando a Perfiles de Cargo (v\xeda Men\xfa Lateral)...');
        // Esperamos a que el layout esté listo buscando el navbar
        await this.page.waitForSelector('aside nav', { timeout: 15000 });

        // Intentamos clic en el acceso directo del sidebar
        const navLink = this.page.locator('aside nav a[title="Job Profiles"]');
        await navLink.click();
        console.log('[E2E-POM] Esperando t\xedtulo Perfiles de Cargo...');
        // Usamos el locatario por rol y el testid, esperando a que esté adjunto al DOM
        const title = this.page.locator('[data-testid="page-title"]');
        await title.waitFor({ state: 'attached', timeout: 30000 });
        console.log('[E2E-POM] ✅ T\xedtulo detectado en el DOM');
    }

    async openNewProfileModal() {
        console.log('[E2E-POM] Abriendo modal de nuevo perfil...');
        await this.page.click('[data-testid="add-profile-btn"]');
    }

    async fillProfileDetails(name: string, description: string) {
        console.log(`[E2E-POM] Completando detalles: ${name}`);
        await this.page.fill('[data-testid="profile-name-input"]', name);
        await this.page.fill('[data-testid="profile-description-textarea"]', description);
    }

    async togglePlugin(pluginId: string) {
        console.log(`[E2E-POM] Activando plugin: ${pluginId}`);
        await this.page.click(`[data-testid="plugin-switch-${pluginId}"]`);
    }

    async saveProfile() {
        console.log('[E2E-POM] Guardando perfil...');
        await this.page.click('[data-testid="save-profile-btn"]');
        // Esperamos a que se guarde y vuelva a la vista de lista (el botón de guardar desaparece del editor si se cierra)
        // O simplemente esperamos a que el botón vuelva a estar habilitado si no se cierra
    }

    async expectProfileInList(name: string) {
        console.log(`[E2E-POM] Verificando perfil en lista: ${name}`);
        const profileItem = this.page.locator(`[data-testid="profile-item"]:has-text("${name}")`).first();
        await profileItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(profileItem).toBeVisible();
    }
}
