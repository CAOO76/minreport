import { Page, expect } from '@playwright/test';
import { expectToast } from '../utils/helpers';

export class AdminApprovalsPage {
    constructor(private page: Page) { }

    async goto() {
        await this.page.goto('http://localhost:5174/admin');
    }

    async selectTab(tab: 'Empresas (B2B)' | 'Educacional' | 'Personal') {
        await this.page.click(`button:has-text("${tab}")`);
    }

    async findTenantRow(name: string) {
        return this.page.locator(`tr:has-text("${name}")`);
    }

    async openDetails(name: string) {
        const row = await this.findTenantRow(name);
        await row.locator('button[aria-label*="Details"], button[aria-label*="Ver"]').click();
    }

    async assignPlugin(pluginId: string) {
        await this.page.check(`input[name="${pluginId}"]`);
    }

    async approve() {
        await this.page.click('button:has-text("Aprobar")');
    }

    async reject(reason: string) {
        await this.page.click('button[aria-label*="Reject"], button[aria-label*="Rechazar"]');
        await this.page.fill('textarea[placeholder*="motivo"]', reason);
        await this.page.click('button:has-text("Confirmar Rechazo")');
    }

    async expectStatus(name: string, status: string) {
        const row = await this.findTenantRow(name);
        await expect(row.locator(`text=${status}`)).toBeVisible();
    }

    async expectApprovalToast() {
        await expectToast(this.page, 'Cuenta aprobada');
    }
}
