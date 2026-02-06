import { Page, expect } from '@playwright/test';
import { fillRut } from '../utils/helpers';

export class RegistrationPage {
    constructor(private page: Page) { }

    async goto() {
        await this.page.goto('/register');
    }

    async selectType(type: 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL') {
        await this.page.click(`button:has-text("${type}")`);
    }

    async fillBaseInfo(name: string, email: string, country: string = 'CL') {
        await this.page.fill('input[placeholder*="nombre"]', name);
        await this.page.fill('input[type="email"]', email);
        await this.page.selectOption('select', country);
    }

    async fillEnterpriseInfo(companyName: string, rut: string, industry: string = 'Mining') {
        await this.page.fill('input[placeholder="Nombre de la empresa"]', companyName);
        await fillRut(this.page, 'input[placeholder*="RUT Empresa"]', rut);
        await this.page.locator('select').nth(1).selectOption(industry);
    }

    async fillEduInfo(profile: string, run: string, institution: string, program: string, gradDate: string) {
        await this.page.selectOption('select:near(label:has-text("Perfil Académico"))', profile);
        await fillRut(this.page, 'input[placeholder*="RUN"]', run);
        await this.page.fill('input[placeholder="Universidad o Instituto"]', institution);
        await this.page.fill('input[placeholder="Carrera / Programa"]', program);
        await this.page.fill('input[type="date"]', gradDate);
    }

    async fillPersonalInfo(run: string, usageProfile: string) {
        await fillRut(this.page, 'input[placeholder*="RUN"]', run);
        await this.page.selectOption('select:near(label:has-text("Perfil de Uso"))', usageProfile);
    }

    async submit() {
        await this.page.click('button:has-text("Solicitar Acceso Seguro")');
    }

    async expectSuccess() {
        await expect(this.page.locator('text=Solicitud recibida')).toBeVisible({ timeout: 10000 });
    }

    async expectPersonalSuccess() {
        await expect(this.page.locator('text=Cuenta creada')).toBeVisible({ timeout: 10000 });
    }

    async expectEmailError(message: string = 'Email institucional requerido') {
        await expect(this.page.locator(`text=${message}`)).toBeVisible();
    }
}
