import { Page, expect } from '@playwright/test';
import { fillRut, waitForLoading } from '../utils/helpers';

export class StaffOnboardingPage {
    constructor(private page: Page) { }

    async goto() {
        console.log('[E2E-POM] Navegando a Staff (vía Menú Lateral)...');
        // El sidebar usa title="Staff" y tiene un sr-only con "Staff"
        await this.page.click('nav >> [title="Staff"]');
    }

    async openOnboardingForm() {
        console.log('[E2E-POM] Accediendo al formulario de Staff (ya visible)...');
        // El formulario es directo en este componente, no requiere clic previo.
        // Solo verificamos que el contenedor sea visible.
        await expect(this.page.locator('form')).toBeVisible();
    }

    async fillWorkerData(run: string, name: string, email: string) {
        console.log(`[E2E-POM] Completando datos del trabajador: ${name}`);
        await fillRut(this.page, '[data-testid="worker-run-input"]', run);
        await this.page.fill('[data-testid="worker-name-input"]', name);
        await this.page.fill('[data-testid="worker-email-input"]', email);
    }

    async selectJobProfile(profileName: string) {
        console.log(`[E2E-POM] Seleccionando perfil: ${profileName}`);
        const testId = `profile-card-${profileName.replace(/\s+/g, '-').toLowerCase()}`;
        await this.page.click(`[data-testid="${testId}"]`);
    }

    async submit() {
        console.log('[E2E-POM] Haciendo clic en Vincular Trabajador...');
        await this.page.click('button:has-text("Vincular Trabajador")');
    }

    async expectSuccess() {
        await waitForLoading(this.page);
        await expect(this.page.locator('text=Trabajador vinculado exitosamente')).toBeVisible();
    }
}
