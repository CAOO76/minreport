import { chromium, FullConfig } from '@playwright/test';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Global Setup for Playwright Tests
 * 
 * Responsibilities:
 * 1. Start Firebase Emulators (if not running)
 * 2. Seed initial data (plugins, super admin)
 * 3. Create authentication states for fixtures
 */

async function globalSetup(config: FullConfig) {
    console.log('\n🚀 [Global Setup] Starting...\n');

    // ========================================
    // 1. Check/Start Firebase Emulators
    // ========================================
    console.log('📦 [Emulators] Checking Firebase Emulators...');

    try {
        // Check if emulators are already running and responding
        const response = await fetch('http://127.0.0.1:4002');
        if (response.ok) {
            console.log('✅ [Emulators] Already running and healthy');
        } else {
            throw new Error('Emulators responding but not OK');
        }
    } catch (error) {
        console.log('⚠️  [Emulators] Not running or unhealthy, cleaning up and starting...');

        // Aggressive cleanup before starting
        try {
            const { execSync } = require('child_process');
            console.log('🧹 [Emulators] Force killing processes on Firebase ports...');
            const portsToKill = [4002, 8085, 9190, 9196, 5010, 9195];
            portsToKill.forEach(port => {
                try {
                    // kills process on port if exists
                    execSync(`lsof -t -i:${port} | xargs kill -9`, { stdio: 'ignore' });
                    console.log(`  - Port ${port} liberated`);
                } catch (e) {
                    // port was likely already free
                }
            });

            // Still try the official stop as a backup
            execSync('npx firebase emulators:stop', { stdio: 'ignore' });
        } catch (e) {
            // Ignore failure to stop
        }

        // Start emulators in background
        console.log('🚀 [Emulators] Starting emulators with npx firebase...');
        const emulatorProcess = exec('npx firebase emulators:start --project minreport-8f2a8', (error, stdout, stderr) => {
            if (error) {
                console.error('❌ [Emulators] Failed to start process:', error);
                console.error('STDOUT:', stdout);
                console.error('STDERR:', stderr);
            }
        });

        // Wait for emulators to be ready (Check both Hub and Auth)
        let attempts = 0;
        const maxAttempts = 30;

        while (attempts < maxAttempts) {
            try {
                const hubResponse = await fetch('http://127.0.0.1:4002');
                // Also check a specific emulator to be sure (e.g., Auth)
                const authResponse = await fetch('http://127.0.0.1:9190').catch(() => null);

                if (hubResponse.ok && authResponse) {
                    console.log('✅ [Emulators] Started successfully and Auth is ready');
                    break;
                }
            } catch (e) {
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        if (attempts === maxAttempts) {
            throw new Error('Timeout waiting for Firebase Emulators to be fully ready');
        }

        // Extra stability delay
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // ========================================
    // 2. Seed Initial Data
    // ========================================
    console.log('\n🌱 [Seeding] Populating test data...');

    try {
        await execAsync('npx ts-node tests/utils/db-seeder.ts');
        console.log('✅ [Seeding] Test data populated');

        // --- 🛡️ CRITICAL ID PERSISTENCE (FALLBACK) ---
        // Ensure the identification RUT exists even if seeder had a minor issue
        console.log('🛡️ [Setup] Verifying critical ID persistence...');
        const { execSync } = require('child_process');
        const checkIDCommand = `npx ts-node -e "
            const admin = require('firebase-admin');
            process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
            if (!admin.apps.length) admin.initializeApp({ projectId: 'minreport-8f2a8' });
            const db = admin.firestore();
            async function forceID() {
                await db.collection('user_directory').doc('761234567').set({
                    run: '761234567',
                    fullName: 'Minera ABC S.A. (Setup Force)',
                    accounts: [{
                        accountId: 'minera-abc-id',
                        authEmail: 'admin@minera-abc.cl',
                        role: 'OWNER',
                        type: 'BUSINESS',
                        accountName: 'Minera ABC S.A.'
                    }],
                    updatedAt: Date.now()
                }, { merge: true });
                console.log('  ✅ ID 761234567 verified/forced');
            }
            forceID();
        "`;
        execSync(checkIDCommand);
    } catch (error) {
        console.error('❌ [Seeding] Failed:', error);
        throw error;
    }

    // ========================================
    // 3. Create Authentication States
    // ========================================
    console.log('\n🔐 [Auth] Creating authentication states...');

    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Super Admin State
    try {
        console.log('  → Creating Super Admin state...');
        await page.goto('http://localhost:5174/login');

        // Login as super admin
        await page.waitForSelector('input[type="email"]', { timeout: 10000 });
        await page.fill('input[type="email"]', 'admin@minreport.com');
        await page.fill('input[type="password"]', 'SuperAdmin123!');
        await page.click('button[type="submit"]');

        // Esperar a que la URL cambie al dashboard o al root (que redirige)
        console.log('[GLOBAL-SETUP] Esperando redirección post-login...');
        try {
            // Esperar a que desaparezca el formulario de login
            await page.waitForSelector('input[type="email"]', { state: 'hidden', timeout: 45000 });

            // Esperar un poco más para que la redirección se complete
            await page.waitForTimeout(2000);

            console.log('[GLOBAL-SETUP] ✅ Redirección exitosa detectada:', page.url());
        } catch (err) {
            console.error('[GLOBAL-SETUP] ❌ Error de navegación post-login. Capturando pantalla...');
            await page.screenshot({ path: 'tests/screenshots/admin-login-fail.png' });
            throw err;
        }

        // Save auth state
        await context.storageState({ path: 'tests/.auth/super-admin.json' });
        console.log('  ✅ Super Admin state saved');
    } catch (error) {
        console.error('  ❌ Failed to create Super Admin state:', error);
    }

    await browser.close();

    console.log('\n✅ [Global Setup] Complete\n');
}

export default globalSetup;
