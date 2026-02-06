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

/**
 * Custom Fixtures for MINREPORT E2E Tests
 * 
 * Provides pre-authenticated contexts for different user roles:
 * - superAdmin: Super Admin (Admin Dashboard)
 * - enterpriseOwner: Owner of ENTERPRISE account
 * - eduStudent: EDUCATIONAL account user
 * - workerUser: OPERATOR in ENTERPRISE account
 * - personalUser: PERSONAL account user
 */

type AuthFixtures = {
    superAdmin: Page;
    enterpriseOwner: Page;
    eduStudent: Page;
    workerUser: Page;
    personalUser: Page;
};

export const test = base.extend<AuthFixtures>({
    // ========================================
    // Super Admin Fixture
    // ========================================
    superAdmin: async ({ browser }, use) => {
        const context = await browser.newContext({
            storageState: 'tests/.auth/super-admin.json',
            baseURL: 'http://localhost:5174'
        });
        const page = await context.newPage();
        await use(page);
        await context.close();
    },

    // ========================================
    // Enterprise Owner Fixture
    // ========================================
    enterpriseOwner: async ({ browser }, use) => {
        // --- 🩺 HEALTH CHECK ---
        try {
            const health = await fetch('http://localhost:8080/health');
            if (!health.ok) throw new Error('Core API is not healthy');
            console.log('[AUTH-FIXTURE] ✅ Core API is ONLINE');
        } catch (e) {
            console.error('[AUTH-FIXTURE] ❌ Core API is OFFLINE. Aborting test.');
            throw new Error('Backend is not responding. Check "npm run dev:server"');
        }

        // --- 🛡️ DEFENSIVE SEEDING ---
        console.log('[AUTH-FIXTURE] 🛡️ Performing Defensive Seeding for Enterprise Owner...');
        const enterpriseRun = '76.123.456-7';
        const normalizedRun = '761234567';
        const accountId = 'minera-abc-id';

        try {
            // 1. Force Account
            await db.collection('accounts').doc(accountId).set({
                id: accountId,
                name: 'Minera ABC S.A.',
                type: 'ENTERPRISE',
                taxId: enterpriseRun,
                ownerId: 'enterprise-owner-uid',
                enabledPlugins: ['stockpile-control', 'fleet-tracking'],
                updatedAt: Date.now()
            }, { merge: true });

            // 2. Force User Directory (Both variants for robustness)
            const dirEntry = {
                run: normalizedRun,
                fullName: 'Juan Pérez (Defensive)',
                accounts: [{
                    accountId: accountId,
                    authEmail: 'admin@minera-abc.cl',
                    role: 'OWNER',
                    type: 'BUSINESS',
                    accountName: 'Minera ABC S.A.'
                }],
                updatedAt: Date.now()
            };

            await db.collection('user_directory').doc(normalizedRun).set(dirEntry, { merge: true });
            await db.collection('user_directory').doc(enterpriseRun).set(dirEntry, { merge: true });

            console.log('[AUTH-FIXTURE] ✅ Defensive Seeding Complete');
        } catch (err) {
            console.error('[AUTH-FIXTURE] ❌ Defensive Seeding Failed:', err);
        }

        // Create fresh context
        const context = await browser.newContext({
            baseURL: 'http://localhost:5173'
        });
        const page = await context.newPage();

        // Login as Enterprise Owner
        await page.goto('/login');

        // Step 1: Identification
        await page.fill('input[placeholder="12.345.678-9"]', enterpriseRun);
        await page.click('button:has-text("Continuar")');

        // --- 🛡️ FAIL FAST CHECK ---
        // Si aparece error de identidad, fallar de inmediato
        const errorMsg = page.locator('text=Error al verificar la identidad');
        const loginForm = page.locator('text=Selecciona tu cuenta');

        await Promise.race([
            errorMsg.waitFor({ state: 'visible', timeout: 7000 }).then(async () => {
                const body = await page.innerText('body');
                console.error('[LOGIN-FAIL] Identity Verification Error detected in UI');
                console.error('[BODY-TEXT]:', body);
                throw new Error(`[LOGIN-FAIL] Login falló por datos no encontrados en Backend para RUT ${enterpriseRun}`);
            }).catch((e) => {
                if (e.message.includes('Login falló')) throw e;
            }),
            loginForm.waitFor({ state: 'visible', timeout: 15000 })
        ]);

        // Step 2: Account Selection
        try {
            await page.waitForSelector('text=Minera ABC S.A.', { timeout: 15000 });
        } catch (err) {
            const bodyText = await page.innerText('body');
            console.error('[AUTH-FIXTURE] Timeout finding Account. Current body text:', bodyText);
            await page.screenshot({ path: 'tests/screenshots/enterprise-account-fail.png' });
            throw err;
        }
        await page.click('text=Minera ABC S.A.');

        // Step 3: Password Challenge
        await page.fill('input[type="password"]', 'MineraABC123!');
        await page.click('button:has-text("Acceder al Entorno")');

        // Wait for dashboard
        await page.waitForURL('**/dashboard', { timeout: 15000 });

        await use(page);
        await context.close();
    },

    // ========================================
    // Educational Student Fixture
    // ========================================
    eduStudent: async ({ browser }, use) => {
        // --- 🩺 HEALTH CHECK ---
        try {
            const health = await fetch('http://localhost:8080/health');
            if (!health.ok) throw new Error('Core API is not healthy');
        } catch (e) {
            throw new Error('Backend is not responding. Check "npm run dev:server"');
        }

        // --- 🛡️ DEFENSIVE SEEDING ---
        console.log('[AUTH-FIXTURE] 🛡️ Performing Defensive Seeding for Student...');
        const eduRun = '18.765.432-1';
        const normalizedRun = '187654321';
        const accountId = 'uchile-student-id';

        try {
            // Force User Directory
            await db.collection('user_directory').doc(normalizedRun).set({
                run: normalizedRun,
                fullName: 'María González (Defensive)',
                accounts: [{
                    accountId: accountId,
                    authEmail: 'estudiante@uchile.cl',
                    role: 'OWNER',
                    type: 'EDUCATIONAL',
                    accountName: 'María González - UChile'
                }],
                updatedAt: Date.now()
            }, { merge: true });
            console.log('[AUTH-FIXTURE] ✅ Student Seeding Complete');
        } catch (err) {
            console.error('[AUTH-FIXTURE] ❌ Student Seeding Failed:', err);
        }

        const context = await browser.newContext({
            baseURL: 'http://localhost:5173'
        });
        const page = await context.newPage();

        // Login as Educational Student
        await page.goto('/login');

        // Step 1: Identification
        await page.fill('input[placeholder="12.345.678-9"]', eduRun);
        await page.click('button:has-text("Continuar")');

        // --- 🛡️ FAIL FAST CHECK ---
        const errorMsg = page.locator('text=Error al verificar la identidad');
        const loginForm = page.locator('text=Selecciona tu cuenta');

        await Promise.race([
            errorMsg.waitFor({ state: 'visible', timeout: 7000 }).then(async () => {
                const body = await page.innerText('body');
                console.error('[LOGIN-FAIL-EDU] Identity Verification Error detected in UI');
                throw new Error(`[LOGIN-FAIL] Login falló por datos no encontrados para RUT ${eduRun}`);
            }).catch((e) => {
                if (e.message.includes('Login falló')) throw e;
            }),
            loginForm.waitFor({ state: 'visible', timeout: 15000 })
        ]);

        // Step 2: Account Selection
        await page.waitForSelector('text=Universidad de Chile', { timeout: 10000 });
        await page.click('text=Universidad de Chile');

        // Step 3: Password Challenge
        await page.fill('input[type="password"]', 'UChile2027!');
        await page.click('button:has-text("Acceder")');

        // Wait for dashboard
        await page.waitForURL('**/dashboard', { timeout: 15000 });

        await use(page);
        await context.close();
    },

    // ========================================
    // Worker User Fixture (OPERATOR)
    // ========================================
    workerUser: async ({ browser }, use) => {
        // --- 🩺 HEALTH CHECK ---
        try {
            await fetch('http://localhost:8080/health');
        } catch (e) {
            throw new Error('Backend is not responding.');
        }

        // --- 🛡️ DEFENSIVE SEEDING ---
        console.log('[AUTH-FIXTURE] 🛡️ Performing Defensive Seeding for Worker...');
        const workerRun = '19.876.543-2';
        const normalizedRun = '198765432';
        const accountId = 'minera-abc-id';

        try {
            // Force User Directory
            await db.collection('user_directory').doc(normalizedRun).set({
                run: normalizedRun,
                fullName: 'Pedro Soto (Defensive)',
                accounts: [{
                    accountId: accountId,
                    authEmail: 'pedro.soto@minera-abc.cl',
                    role: 'OPERATOR',
                    type: 'BUSINESS',
                    accountName: 'Minera ABC S.A.',
                    jobProfileId: 'profile-operador-caex'
                }],
                updatedAt: Date.now()
            }, { merge: true });
            console.log('[AUTH-FIXTURE] ✅ Worker Seeding Complete');
        } catch (err) {
            console.error('[AUTH-FIXTURE] ❌ Worker Seeding Failed:', err);
        }

        const context = await browser.newContext({
            baseURL: 'http://localhost:5173'
        });
        const page = await context.newPage();

        // Login as Worker
        await page.goto('/login');

        // Step 1: Identification
        await page.fill('input[placeholder="12.345.678-9"]', workerRun);
        await page.click('button:has-text("Continuar")');

        // --- 🛡️ FAIL FAST CHECK ---
        const errorMsg = page.locator('text=Error al verificar la identidad');
        const loginForm = page.locator('text=Selecciona tu cuenta');

        await Promise.race([
            errorMsg.waitFor({ state: 'visible', timeout: 7000 }).then(async () => {
                const body = await page.innerText('body');
                console.error('[LOGIN-FAIL-WORKER] Identity Verification Error detected in UI');
                console.error('[BODY-TEXT]:', body);
                throw new Error(`[LOGIN-FAIL] Login falló por datos no encontrados para RUT ${workerRun}`);
            }).catch((e) => {
                if (e.message.includes('Login falló')) throw e;
            }),
            loginForm.waitFor({ state: 'visible', timeout: 15000 })
        ]);

        // Step 2: Account Selection
        try {
            await page.waitForSelector('text=Minera ABC S.A.', { timeout: 15000 });
        } catch (err) {
            const bodyText = await page.innerText('body');
            console.error('[AUTH-FIXTURE-WORKER] Timeout finding Account. Current body text:', bodyText);
            throw err;
        }
        await page.click('text=Minera ABC S.A.');

        // Step 3: Password Challenge
        await page.fill('input[type="password"]', 'Worker123!');
        await page.click('button:has-text("Acceder al Entorno")');

        // Wait for dashboard
        await page.waitForURL('**/dashboard', { timeout: 15000 });

        await use(page);
        await context.close();
    },

    // ========================================
    // Personal User Fixture
    // ========================================
    personalUser: async ({ browser }, use) => {
        // --- 🩺 HEALTH CHECK ---
        try {
            await fetch('http://localhost:8080/health');
        } catch (e) {
            throw new Error('Backend is not responding.');
        }

        // --- 🛡️ DEFENSIVE SEEDING ---
        console.log('[AUTH-FIXTURE] 🛡️ Performing Defensive Seeding for Personal User...');
        const personalRun = '15.234.567-8';
        const normalizedRun = '152345678';
        const accountId = 'carlos-munoz-id';

        try {
            // Force User Directory
            await db.collection('user_directory').doc(normalizedRun).set({
                run: normalizedRun,
                fullName: 'Carlos Muñoz (Defensive)',
                accounts: [{
                    accountId: accountId,
                    authEmail: 'carlos@gmail.com',
                    role: 'OWNER',
                    type: 'PERSONAL',
                    accountName: 'Carlos Muñoz'
                }],
                updatedAt: Date.now()
            }, { merge: true });
            console.log('[AUTH-FIXTURE] ✅ Personal Seeding Complete');
        } catch (err) {
            console.error('[AUTH-FIXTURE] ❌ Personal Seeding Failed:', err);
        }

        const context = await browser.newContext({
            baseURL: 'http://localhost:5173'
        });
        const page = await context.newPage();

        // Login as Personal User
        await page.goto('/login');

        // Step 1: Identification
        await page.fill('input[placeholder="12.345.678-9"]', personalRun);
        await page.click('button:has-text("Continuar")');

        // --- 🛡️ FAIL FAST CHECK ---
        const errorMsg = page.locator('text=Error al verificar la identidad');
        const loginForm = page.locator('text=Selecciona tu cuenta');

        await Promise.race([
            errorMsg.waitFor({ state: 'visible', timeout: 7000 }).then(async () => {
                const body = await page.innerText('body');
                console.error('[LOGIN-FAIL-PERSONAL] Identity Verification Error detected in UI');
                console.error('[BODY-TEXT]:', body);
                throw new Error(`[LOGIN-FAIL] Login falló por datos no encontrados para RUT ${personalRun}`);
            }).catch((e) => {
                if (e.message.includes('Login falló')) throw e;
            }),
            loginForm.waitFor({ state: 'visible', timeout: 15000 })
        ]);

        // Step 2: Account Selection
        await page.waitForSelector('text=Carlos Muñoz', { timeout: 10000 });
        await page.click('text=Carlos Muñoz');

        // Step 3: Password Challenge
        await page.fill('input[type="password"]', 'Personal123!');
        await page.click('button:has-text("Acceder")');

        // Wait for dashboard
        await page.waitForURL('**/dashboard', { timeout: 15000 });

        await use(page);
        await context.close();
    },
});

export { expect } from '@playwright/test';
