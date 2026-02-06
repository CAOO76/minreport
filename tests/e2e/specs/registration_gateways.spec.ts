import { test, expect } from '../../fixtures/auth.fixture';
import { RegistrationPage } from '../../pages/RegistrationPage';
import { AdminApprovalsPage } from '../../pages/AdminApprovalsPage';
import { getFirestoreDoc } from '../../utils/helpers';

/**
 * Suite de Pruebas de Registro y Gatekeepers (Grupos 1, 2 y 7)
 * 
 * Basado en el patrón POM para asegurar mantenibilidad.
 */

test.describe('Flujos de Registro y Gatekeepers', () => {

    // ========================================
    // E2E-001: ENTERPRISE Registration
    // ========================================
    test('E2E-001: Debería registrar solicitud ENTERPRISE exitosamente', async ({ page }) => {
        const registrationPage = new RegistrationPage(page);
        await registrationPage.goto();
        await registrationPage.selectType('ENTERPRISE');
        await registrationPage.fillBaseInfo('Juan Pérez', 'admin@minera-test.cl');
        await registrationPage.fillEnterpriseInfo('Minera Test S.A.', '76.999.888-7');
        await registrationPage.submit();
        await registrationPage.expectSuccess();
    });

    // ========================================
    // E2E-002: Edu Happy Path (with API interception)
    // ========================================
    test('E2E-002: Debería registrar solicitud EDU con email institucional y verificar API', async ({ page }) => {
        const registrationPage = new RegistrationPage(page);

        // Interceptar API de validación (suponiendo que existe un endpoint /api/public/validate-edu)
        const validatePromise = page.waitForResponse(response =>
            response.url().includes('/api/auth/register') && response.status() === 200
        );

        await registrationPage.goto();
        await registrationPage.selectType('EDUCATIONAL');

        await registrationPage.fillBaseInfo('Estudiante UChile', 'alumni@uchile.cl');
        await registrationPage.fillEduInfo(
            'ALUMNO',
            '18.999.888-7',
            'Universidad de Chile',
            'Arquitectura',
            '2028-01-01'
        );

        await registrationPage.submit();

        const response = await validatePromise;
        expect(response.ok()).toBeTruthy();

        await registrationPage.expectSuccess();
    });

    // ========================================
    // E2E-003: PERSONAL Registration
    // ========================================
    test('E2E-003: Debería registrar solicitud PERSONAL con auto-aprobación', async ({ page }) => {
        const registrationPage = new RegistrationPage(page);
        await registrationPage.goto();
        await registrationPage.selectType('PERSONAL');
        await registrationPage.fillBaseInfo('Carlos Personal', 'carlos.p@gmail.com');
        await registrationPage.fillPersonalInfo('15.888.777-6', 'PROFESSIONAL');
        await registrationPage.submit();
        await registrationPage.expectPersonalSuccess();
    });

    // ========================================
    // E2E-017 / E2E-016: Edu Rejection (UI Validation)
    // ========================================
    test('E2E-017: Debería rechazar email público (@gmail.com) en registro EDU', async ({ page }) => {
        const registrationPage = new RegistrationPage(page);
        await registrationPage.goto();
        await registrationPage.selectType('EDUCATIONAL');
        await registrationPage.fillBaseInfo('User Fake', 'fake@gmail.com');
        // Al intentar enviar o perder el foco, debería validar
        await registrationPage.submit();
        await registrationPage.expectEmailError();
    });

    // ========================================
    // E2E-004: Admin Approval with Plugins
    // ========================================
    test('E2E-004: Admin debería aprobar cuenta ENTERPRISE y asignar plugins', async ({ superAdmin }) => {
        const adminPage = new AdminApprovalsPage(superAdmin);
        await adminPage.goto();
        await adminPage.selectTab('Empresas (B2B)');

        const companyName = 'Minera ABC S.A.';
        await adminPage.openDetails(companyName);
        await adminPage.assignPlugin('stockpile-control');
        await adminPage.approve();

        await adminPage.expectApprovalToast();
        await adminPage.expectStatus(companyName, 'ACTIVE');

        // Deep Assert en Firestore
        const accountData = await getFirestoreDoc(superAdmin, 'accounts/minera-abc-id');
        expect(accountData).not.toBeNull();
        expect(accountData.enabledPlugins).toContain('stockpile-control');
    });

    // ========================================
    // E2E-005: Admin Rejection
    // ========================================
    test('E2E-005: Admin debería rechazar solicitud con motivo', async ({ superAdmin }) => {
        const adminPage = new AdminApprovalsPage(superAdmin);
        await adminPage.goto();
        await adminPage.selectTab('Educacional');

        const studentName = 'María González'; // Cargada por seeder
        await adminPage.reject('Documentación incompleta');

        await adminPage.expectStatus(studentName, 'REJECTED');
    });

});
