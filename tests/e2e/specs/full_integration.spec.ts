import { test, expect } from '../../fixtures/auth.fixture';
import { devices } from '@playwright/test';
import { JobProfileManagerPage } from '../../pages/JobProfileManagerPage';
import { StaffOnboardingPage } from '../../pages/StaffOnboardingPage';
import { SetupPasswordPage } from '../../pages/SetupPasswordPage';
import { MobileLoginPage } from '../../pages/MobileLoginPage';
import { OperationalDashboardPage } from '../../pages/OperationalDashboardPage';
import { getLatestEmailLink, deleteFirestoreUser } from '../../utils/helpers';

/**
 * E2E-020: La Historia Completa (Integración de Todo el Ciclo B2B)
 */

test.describe('E2E-020: Ciclo de Vida Completo (Story Driven)', () => {

    const workerEmail = 'miguel.integracion@abc.cl';
    const workerRun = '20.555.666-4';
    const workerPass = 'IntegrationTest2026!';

    test('Debería completar todo el flujo desde configuración de owner hasta dashboard de trabajador', async ({ browser, enterpriseOwner, browserName, isMobile }) => {
        // --- GUARDS DE COMPATIBILIDAD ---
        // 1. Firefox no soporta emulación móvil (isMobile en newContext)
        test.skip(browserName === 'firefox', 'Firefox no soporta la emulación móvil requerida en el Acto 4.');

        // 2. Este test integral orquestado requiere un host Desktop para el Acto 1 (Administración).
        // Si el proyecto de Playwright ya es móvil, el layout romperá los selectores de escritorio.
        test.skip(isMobile, 'Este test integral requiere un host Desktop para la fase administrativa inicial.');

        // --- ACTO 1: El Dueño Configura el Terreno ---
        const jobProfilePage = new JobProfileManagerPage(enterpriseOwner);
        await jobProfilePage.goto();
        await jobProfilePage.openNewProfileModal();
        await jobProfilePage.fillProfileDetails('Super Operador', 'Perfil con acceso total a terreno');
        await jobProfilePage.togglePlugin('stockpile-control');
        await jobProfilePage.saveProfile();
        await jobProfilePage.expectProfileInList('Super Operador');

        // --- ACTO 2: La Contratación ---
        const staffPage = new StaffOnboardingPage(enterpriseOwner);
        await staffPage.goto();
        await staffPage.openOnboardingForm();
        await staffPage.fillWorkerData(workerRun, 'Miguel Integración', workerEmail);
        await staffPage.selectJobProfile('Super Operador');
        await staffPage.submit();
        await staffPage.expectSuccess();

        // --- ACTO 3: El Trabajador (Setup de Contraseña vía Mailbox Mock) ---
        // Usamos un nuevo contexto para simular al trabajador
        const workerAuthContext = await browser.newContext();
        const setupPage = new SetupPasswordPage(await workerAuthContext.newPage());

        // Esperar un momento para que el mock guarde el email
        await setupPage.page.waitForTimeout(2000);

        // Leer el link del "Mailbox Mock" en Firestore
        const activationLink = await getLatestEmailLink(enterpriseOwner, workerEmail); // Usamos la pág del owner para leer DB
        expect(activationLink).not.toBeNull();

        await setupPage.goto(activationLink!);
        await setupPage.fillPassword(workerPass);
        await setupPage.submit();
        await setupPage.expectSuccess();
        await workerAuthContext.close();

        // --- ACTO 4: El Trabajador en Terreno (Móvil) ---
        const mobileBrowser = await browser.newContext({ ...devices['Pixel 5'] });
        const mobilePage = await mobileBrowser.newPage();

        // Depuración: Capturar logs de la página móvil
        mobilePage.on('console', msg => console.log(`[MOBILE-LOG] ${msg.type()}: ${msg.text()}`));
        mobilePage.on('pageerror', err => console.error(`[MOBILE-ERROR] ${err.message}`));

        const loginPage = new MobileLoginPage(mobilePage);
        const dashboard = new OperationalDashboardPage(mobilePage);

        await loginPage.goto();
        await loginPage.identify(workerRun);
        await loginPage.selectAccount('Minera ABC S.A.');
        await loginPage.login(workerPass);
        await loginPage.expectDashboard();

        // CLÍMAX: Verificar visibilidad de plugin heredado
        await dashboard.expectPluginVisible('Stockpile Control');
        await dashboard.openPlugin('Stockpile Control');

        await mobileBrowser.close();
    });

    test.afterAll(async ({ enterpriseOwner }) => {
        // --- ACTO 5: Limpieza ---
        // Eliminar el trabajador de user_directory y Firebase Auth para repetibilidad
        const runClean = '205556664';
        await enterpriseOwner.evaluate(async (run) => {
            // @ts-ignore
            const { doc, deleteDoc } = window.firestore;
            // @ts-ignore
            await deleteDoc(doc(window.db, 'user_directory', run));
        }, runClean);

        // Nota: La limpieza de Firebase Auth requiere privilegios de admin, suele hacerse en globalTeardown
        // o enviando una señal a un endpoint de test interno.
    });
});
