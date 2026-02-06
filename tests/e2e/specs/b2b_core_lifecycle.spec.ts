import { test, expect } from '../../fixtures/auth.fixture';
import { JobProfileManagerPage } from '../../pages/JobProfileManagerPage';
import { StaffOnboardingPage } from '../../pages/StaffOnboardingPage';
import { OperationalDashboardPage } from '../../pages/OperationalDashboardPage';
import { getFirestoreDoc } from '../../utils/helpers';

/**
 * Suite de Pruebas: Ciclo de Vida B2B y Gestión de Plugins (Grupos 3, 4 y 5)
 * 
 * Valida la herencia de permisos desde la asignación del Admin 
 * hasta la visualización final del Trabajador.
 */

test.describe('Ciclo de Vida B2B y Gestión Interna', () => {

    // ========================================
    // E2E-007: Herencia y Restricción de Plugins
    // ========================================
    test('E2E-007: Dueño no debería poder asignar plugins no habilitados para la cuenta', async ({ enterpriseOwner }) => {
        const jobProfilePage = new JobProfileManagerPage(enterpriseOwner);

        await jobProfilePage.goto();
        await jobProfilePage.openNewProfileModal();

        // El seeder habilita 'stockpile-control' y 'fleet-tracking' para esta cuenta (Minera ABC)
        // No habilita 'safety-reports'

        expect(await jobProfilePage.isPluginVisible('Stockpile Control')).toBeTruthy();
        expect(await jobProfilePage.isPluginVisible('Fleet Tracking')).toBeTruthy();

        // Assert: Plugin NO habilitado por el Admin Global no debe aparecer
        expect(await jobProfilePage.isPluginVisible('Safety Reports')).toBeFalsy();

        // Crear un perfil válido
        await jobProfilePage.fillBasicInfo('Operador Terreno', 'Operador de acopios');
        await jobProfilePage.selectPlugin('Stockpile Control');
        await jobProfilePage.save();

        await jobProfilePage.expectProfileInList('Operador Terreno');
    });

    // ========================================
    // E2E-008: Onboarding de Staff ("El Trabajador")
    // ========================================
    test('E2E-008: Debería vincular un nuevo trabajador y verificar user_directory', async ({ enterpriseOwner }) => {
        const staffPage = new StaffOnboardingPage(enterpriseOwner);
        const workerRun = '19.111.222-3';
        const workerRunNormalized = '191112223';

        await staffPage.goto();
        await staffPage.openOnboardingForm();

        await staffPage.fillWorkerData(workerRun, 'Roberto Gómez', 'roberto.g@minera-abc.cl');
        await staffPage.selectJobProfile('Operador CAEX'); // Perfil del seeder

        await staffPage.submit();
        await staffPage.expectSuccess();

        // Deep Assert: Verificar entrada en user_directory vía Firestore
        const directoryEntry = await getFirestoreDoc(enterpriseOwner, `user_directory/${workerRunNormalized}`);
        expect(directoryEntry).not.toBeNull();
        expect(directoryEntry.run).toBe(workerRunNormalized);
        expect(directoryEntry.accounts[0].jobProfileId).toBe('profile-operador-caex');
    });

    // ========================================
    // E2E-011: Visibilidad y Restricciones del Trabajador
    // ========================================
    test('E2E-011: Trabajador debería ver solo sus plugins y no opciones de admin', async ({ workerUser }) => {
        const dashboard = new OperationalDashboardPage(workerUser);

        await dashboard.goto();

        // Pedro Soto (workerUser) tiene perfil 'Operador CAEX'
        // El perfil 'Operador CAEX' solo permite 'Fleet Tracking' (según seeder)

        // Assert: Ve su plugin asignado
        await dashboard.expectPluginVisible('Fleet Tracking');

        // Assert: NO ve un plugin de la cuenta que NO está en su perfil
        await dashboard.expectPluginNotVisible('Stockpile Control');

        // Assert: NO ve opciones de administración corporativa
        await dashboard.expectAdminSettingsNotVisible();

        // Abrir plugin funcionalmente
        await dashboard.openPlugin('Fleet Tracking');
    });

});
