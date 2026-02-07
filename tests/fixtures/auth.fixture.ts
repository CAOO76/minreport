import { test as base, Page } from '@playwright/test';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin for Defensive Seeding in Fixtures
if (!admin.apps.length) {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9190';
    admin.initializeApp({
        projectId: 'minreport-8f2a8'
    });
}
const db = admin.firestore();

type AuthFixtures = {
    superAdmin: Page;
    enterpriseOwner: Page;
    eduStudent: Page;
    workerUser: Page;
    personalUser: Page;
};

// Common dummy hash that we will allow to bypass in test mode if necessary
// Original hash for 'Admin123!', 'Worker123!', etc.
const TEST_PASSWORD_HASH = '7e232e0c909e7c3e3e3e3e3e3e3e3e3e:e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3';

export const test = base.extend<AuthFixtures>({
    superAdmin: async ({ browser }, use) => {
        const context = await browser.newContext({
            storageState: 'tests/.auth/super-admin.json',
            baseURL: 'http://localhost:5174'
        });
        const page = await context.newPage();
        await use(page);
        await context.close();
    },

    enterpriseOwner: async ({ browser }, use) => {
        const enterpriseRun = '76.123.456-7';
        const normalizedRun = '761234567';
        const accountId = 'minera-abc-id';

        try {
            await db.collection('accounts').doc(accountId).set({
                id: accountId, name: 'Minera ABC S.A.', type: 'ENTERPRISE', taxId: enterpriseRun, ownerId: 'enterprise-owner-uid', updatedAt: Date.now()
            }, { merge: true });

            const dirEntry = {
                run: normalizedRun, fullName: 'Juan Pérez (Defensive)', updatedAt: Date.now(),
                accounts: [{ accountId, authEmail: 'admin@minera-abc.cl', role: 'OWNER', type: 'BUSINESS', accountName: 'Minera ABC S.A.' }]
            };
            await db.collection('user_directory').doc(normalizedRun).set(dirEntry, { merge: true });
            await db.collection('user_directory').doc(enterpriseRun).set(dirEntry, { merge: true });
            await db.collection('user_directory').doc('76123456-7').set(dirEntry, { merge: true });

            await db.collection('users').doc('enterprise-owner-uid').set({
                uid: 'enterprise-owner-uid', email: 'admin@minera-abc.cl', displayName: 'Juan Pérez', role: 'OWNER',
                memberships: [{ accountId, role: 'OWNER', type: 'BUSINESS', passwordHash: TEST_PASSWORD_HASH, email: 'admin@minera-abc.cl', accountName: 'Minera ABC S.A.' }]
            }, { merge: true });

            // Ensure Auth user exists with EXACT UID
            try {
                await admin.auth().deleteUser('enterprise-owner-uid');
            } catch (e) { }

            try {
                await admin.auth().createUser({
                    uid: 'enterprise-owner-uid',
                    email: 'admin@minera-abc.cl',
                    password: 'Admin123!',
                    displayName: 'Juan Pérez'
                });
            } catch (e: any) {
                console.error('[AUTH-FIXTURE] Auth Creation Error:', e);
            }

            // Wait for emulator propagation with verification
            let exists = false;
            for (let i = 0; i < 15; i++) {
                const userSnap = await db.collection('users').doc('enterprise-owner-uid').get();
                const accountSnap = await db.collection('accounts').doc(accountId).get();

                if (userSnap.exists && accountSnap.exists) {
                    exists = true;
                    console.log(`[AUTH-FIXTURE] ✅ User and Account documents verified (attempt ${i + 1})`);
                    break;
                }
                if (!userSnap.exists) console.log(`[AUTH-FIXTURE] ⏳ Waiting for User doc...`);
                if (!accountSnap.exists) console.log(`[AUTH-FIXTURE] ⏳ Waiting for Account doc (${accountId})...`);

                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            if (!exists) throw new Error("User/Account documentation failed to persist in Emulator");

            console.log('[AUTH-FIXTURE] ✅ Enterprise Owner Seeding Complete');
        } catch (err) { console.error('[AUTH-FIXTURE] ❌ Seeding Failed:', err); }

        const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
        const page = await context.newPage();

        // Browser Telemetry
        page.on('console', msg => console.log(`[BROWSER-LOG] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => console.error(`[BROWSER-ERROR] ${err.message}`));

        console.log(`[AUTH-FIXTURE] Navigating to /login...`);
        await page.goto('/login', { waitUntil: 'load' });

        // Use intelligent locators (resilient to re-renders)
        const idInput = page.getByPlaceholder('12.345.678-9');
        try {
            await idInput.waitFor({ state: 'visible', timeout: 30000 });
        } catch (e) {
            console.error(`[AUTH-FIXTURE] ❌ Timeout waiting for RUT input. URL: ${page.url()}`);
            const html = await page.content();
            console.error(`[AUTH-FIXTURE] HTML Snapshot (excerpt):`, html.substring(0, 1000));
            throw e;
        }

        await idInput.fill(enterpriseRun);
        await page.getByRole('button', { name: 'Continuar' }).click();

        await page.getByText('Minera ABC S.A.').waitFor({ state: 'visible', timeout: 30000 });
        await page.getByText('Minera ABC S.A.').click();

        const pwdInput = page.locator('input[type="password"]');
        await pwdInput.waitFor({ state: 'visible', timeout: 30000 });
        await pwdInput.fill('Admin123!');
        await page.getByRole('button', { name: 'Acceder' }).click();
        console.log('[AUTH-FIXTURE] Botón Acceder clickeado, esperando redirección...');

        await page.waitForURL(url => url.pathname === '/' || url.pathname.includes('dashboard'), { timeout: 30000 });
        console.log('[AUTH-FIXTURE] Redirección detectada a:', page.url());

        // CRÍTICO: Verificar que Firebase Auth esté inicializado y el usuario autenticado
        console.log('[AUTH-FIXTURE] Esperando disponibilidad de window.auth...');
        const isAuthenticated = await page.evaluate(async () => {
            // Reintento interno para esperar a que el bundle cargue y exponga window.auth
            for (let i = 0; i < 20; i++) {
                // @ts-ignore
                const auth = window.auth;
                if (auth) {
                    console.log(`[AUTH-FIXTURE] window.auth detectado (intento ${i + 1})`);
                    // Esperar a que el usuario esté autenticado (ignorar null inicial si ocurre)
                    return new Promise((resolve) => {
                        let resolved = false;
                        const timeout = setTimeout(() => {
                            if (!resolved) {
                                console.error('[AUTH-FIXTURE] Timeout esperando usuario no nulo');
                                resolve(false);
                            }
                        }, 5000);

                        const unsubscribe = auth.onAuthStateChanged((user: any) => {
                            console.log('[AUTH-FIXTURE] onAuthStateChanged trigger:', user?.email || 'null');
                            if (user) {
                                resolved = true;
                                clearTimeout(timeout);
                                unsubscribe();
                                resolve(true);
                            }
                        });
                    });
                }
                await new Promise(r => setTimeout(r, 500));
            }
            console.error('[AUTH-FIXTURE] Firebase Auth NO se detectó en window tras 10s');
            return false;
        });

        if (!isAuthenticated) {
            throw new Error('[AUTH-FIXTURE] Usuario no autenticado después del login');
        }

        console.log('[AUTH-FIXTURE] ✅ Sesión de Firebase Auth verificada');
        await use(page);
        await context.close();
    },

    eduStudent: async ({ browser }, use) => {
        const eduRun = '18.765.432-1';
        const normalizedRun = '187654321';
        const accountId = 'uchile-student-id';
        try {
            const dirEntry = {
                run: normalizedRun, fullName: 'María González (Defensive)', updatedAt: Date.now(),
                accounts: [{ accountId, authEmail: 'estudiante@uchile.cl', role: 'OWNER', type: 'EDUCATIONAL', accountName: 'María González - UChile' }]
            };
            await db.collection('user_directory').doc(normalizedRun).set(dirEntry, { merge: true });
            await db.collection('user_directory').doc(eduRun).set(dirEntry, { merge: true });
            await db.collection('users').doc('edu-student-uid').set({
                uid: 'edu-student-uid', email: 'estudiante@uchile.cl',
                memberships: [{ accountId, role: 'OWNER', type: 'EDUCATIONAL', passwordHash: TEST_PASSWORD_HASH, email: 'estudiante@uchile.cl' }]
            }, { merge: true });

            // Ensure Auth user exists with EXACT UID
            try {
                await admin.auth().deleteUser('edu-student-uid');
            } catch (e) { }

            try {
                await admin.auth().createUser({
                    uid: 'edu-student-uid',
                    email: 'estudiante@uchile.cl',
                    password: 'UChile2027!',
                    displayName: 'María González'
                });
            } catch (e: any) {
                console.error('[AUTH-FIXTURE] Edu Auth Error:', e);
            }

            // Wait for emulator propagation with verification
            let exists = false;
            for (let i = 0; i < 10; i++) {
                const snap = await db.collection('users').doc('edu-student-uid').get();
                if (snap.exists) {
                    exists = true;
                    console.log(`[AUTH-FIXTURE] ✅ Edu User verified (attempt ${i + 1})`);
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            if (!exists) throw new Error("Edu User document failed to persist");
        } catch (e) { }
        const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
        const page = await context.newPage();

        // Browser Telemetry
        page.on('console', msg => console.log(`[BROWSER-LOG] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => console.error(`[BROWSER-ERROR] ${err.message}`));

        await page.goto('/login', { waitUntil: 'load' });

        const idInput = page.getByPlaceholder('12.345.678-9');
        await idInput.waitFor({ state: 'visible', timeout: 30000 });
        await idInput.fill(eduRun);
        await page.getByRole('button', { name: 'Continuar' }).click();

        await page.getByText('Universidad de Chile').waitFor({ state: 'visible', timeout: 30000 });
        await page.getByText('Universidad de Chile').click();

        const pwdInput = page.locator('input[type="password"]');
        await pwdInput.waitFor({ state: 'visible', timeout: 30000 });
        await pwdInput.fill('UChile2027!');
        await page.getByRole('button', { name: 'Acceder' }).click();

        await page.waitForURL(url => url.pathname === '/' || url.pathname.includes('dashboard'), { timeout: 30000 });
        await use(page);
        await context.close();
    },

    workerUser: async ({ browser }, use) => {
        const workerRun = '19.876.543-2';
        const normalizedRun = '198765432';
        const accountId = 'minera-abc-id';
        try {
            const dirEntry = {
                run: normalizedRun, fullName: 'Pedro Soto (Defensive)', updatedAt: Date.now(),
                accounts: [{ accountId, authEmail: 'pedro.soto@minera-abc.cl', role: 'OPERATOR', type: 'BUSINESS', accountName: 'Minera ABC S.A.' }]
            };
            await db.collection('user_directory').doc(normalizedRun).set(dirEntry, { merge: true });
            await db.collection('user_directory').doc(workerRun).set(dirEntry, { merge: true });
            await db.collection('users').doc('worker-user-uid').set({
                uid: 'worker-user-uid', email: 'pedro.soto@minera-abc.cl',
                memberships: [{ accountId, role: 'OPERATOR', type: 'BUSINESS', passwordHash: TEST_PASSWORD_HASH, email: 'pedro.soto@minera-abc.cl' }]
            }, { merge: true });

            // Ensure Auth user exists with EXACT UID
            try {
                await admin.auth().deleteUser('worker-user-uid');
            } catch (e) { }

            try {
                await admin.auth().createUser({
                    uid: 'worker-user-uid',
                    email: 'pedro.soto@minera-abc.cl',
                    password: 'Worker123!',
                    displayName: 'Pedro Soto'
                });
            } catch (e: any) {
                console.error('[AUTH-FIXTURE] Worker Auth Error:', e);
            }
            // Wait for emulator propagation with verification
            let exists = false;
            for (let i = 0; i < 10; i++) {
                const snap = await db.collection('users').doc('worker-user-uid').get();
                if (snap.exists) {
                    exists = true;
                    console.log(`[AUTH-FIXTURE] ✅ Worker User verified (attempt ${i + 1})`);
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            if (!exists) throw new Error("Worker User document failed to persist");
        } catch (e) { }
        const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
        const page = await context.newPage();

        // Browser Telemetry
        page.on('console', msg => console.log(`[BROWSER-LOG] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => console.error(`[BROWSER-ERROR] ${err.message}`));

        await page.goto('/login', { waitUntil: 'load' });

        const idInput = page.getByPlaceholder('12.345.678-9');
        await idInput.waitFor({ state: 'visible', timeout: 30000 });
        await idInput.fill(workerRun);
        await page.getByRole('button', { name: 'Continuar' }).click();

        await page.getByText('Minera ABC S.A.').waitFor({ state: 'visible', timeout: 30000 });
        await page.getByText('Minera ABC S.A.').click();

        const pwdInput = page.locator('input[type="password"]');
        await pwdInput.waitFor({ state: 'visible', timeout: 30000 });
        await pwdInput.fill('Worker123!');
        await page.getByRole('button', { name: 'Acceder' }).click();

        await page.waitForURL(url => url.pathname === '/' || url.pathname.includes('dashboard'), { timeout: 30000 });
        await use(page);
        await context.close();
    },

    personalUser: async ({ browser }, use) => {
        const personalRun = '15.234.567-8';
        const normalizedRun = '152345678';
        const accountId = 'carlos-munoz-id';
        try {
            const dirEntry = {
                run: normalizedRun, fullName: 'Carlos Muñoz (Defensive)', updatedAt: Date.now(),
                accounts: [{ accountId, authEmail: 'carlos@gmail.com', role: 'OWNER', type: 'PERSONAL', accountName: 'Carlos Muñoz' }]
            };
            await db.collection('user_directory').doc(normalizedRun).set(dirEntry, { merge: true });
            await db.collection('user_directory').doc(personalRun).set(dirEntry, { merge: true });
            await db.collection('users').doc('personal-user-uid').set({
                uid: 'personal-user-uid', email: 'carlos@gmail.com',
                memberships: [{ accountId, role: 'OWNER', type: 'PERSONAL', passwordHash: TEST_PASSWORD_HASH, email: 'carlos@gmail.com' }]
            }, { merge: true });

            // Ensure Auth user exists with EXACT UID
            try {
                await admin.auth().deleteUser('personal-user-uid');
            } catch (e) { }

            try {
                await admin.auth().createUser({
                    uid: 'personal-user-uid',
                    email: 'carlos@gmail.com',
                    password: 'Personal123!',
                    displayName: 'Carlos Muñoz'
                });
            } catch (e: any) {
                console.error('[AUTH-FIXTURE] Personal Auth Error:', e);
            }
            // Wait for emulator propagation with verification
            let exists = false;
            for (let i = 0; i < 10; i++) {
                const snap = await db.collection('users').doc('personal-user-uid').get();
                if (snap.exists) {
                    exists = true;
                    console.log(`[AUTH-FIXTURE] ✅ Personal User verified (attempt ${i + 1})`);
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            if (!exists) throw new Error("Personal User document failed to persist");
        } catch (e) { }
        const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
        const page = await context.newPage();

        // Browser Telemetry
        page.on('console', msg => console.log(`[BROWSER-LOG] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => console.error(`[BROWSER-ERROR] ${err.message}`));

        await page.goto('/login', { waitUntil: 'load' });

        const idInput = page.getByPlaceholder('12.345.678-9');
        await idInput.waitFor({ state: 'visible', timeout: 30000 });
        await idInput.fill(personalRun);
        await page.getByRole('button', { name: 'Continuar' }).click();

        await page.getByText('Carlos Muñoz').waitFor({ state: 'visible', timeout: 30000 });
        await page.getByText('Carlos Muñoz').click();

        const pwdInput = page.locator('input[type="password"]');
        await pwdInput.waitFor({ state: 'visible', timeout: 30000 });
        await pwdInput.fill('Personal123!');
        await page.getByRole('button', { name: 'Acceder' }).click();

        await page.waitForURL(url => url.pathname === '/' || url.pathname.includes('dashboard'), { timeout: 30000 });
        await use(page);
        await context.close();
    },
});

export { expect } from '@playwright/test';
