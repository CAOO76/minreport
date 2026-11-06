import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for MINREPORT E2E Tests
 * Arquitectura unificada sobre web/ (5 Cuentas Soberanas: /dev, /admin, /pilot, B2B, EDU)
 */
export default defineConfig({
    testDir: './tests',
    timeout: 60 * 1000,
    expect: {
        timeout: 10000
    },
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: [
        ['html', { outputFolder: 'playwright-report' }],
        ['list'],
        ['json', { outputFile: 'test-results.json' }]
    ],
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        actionTimeout: 30000,
        navigationTimeout: 60000,
    },
    webServer: [
        {
            command: 'cd web && PATH=$PATH:/usr/local/bin npm run dev',
            url: 'http://127.0.0.1:5173',
            reuseExistingServer: !process.env.CI,
            timeout: 120 * 1000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
        {
            command: 'PATH=$PATH:/usr/local/bin npm run dev:server',
            url: 'http://127.0.0.1:8080/health',
            reuseExistingServer: !process.env.CI,
            timeout: 120 * 1000,
            stdout: 'pipe',
            stderr: 'pipe',
        }
    ],
    projects: [
        {
            name: 'Desktop Chrome',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1920, height: 1080 },
            },
        },
        {
            name: 'Desktop Firefox',
            use: {
                ...devices['Desktop Firefox'],
                viewport: { width: 1920, height: 1080 }
            },
        },
        {
            name: 'Desktop Safari',
            use: {
                ...devices['Desktop Safari'],
                viewport: { width: 1920, height: 1080 }
            },
        },
        {
            name: 'Mobile Pixel 5',
            use: {
                ...devices['Pixel 5'],
            },
        },
        {
            name: 'Mobile iPhone 12',
            use: {
                ...devices['iPhone 12'],
            },
        },
        {
            name: 'Admin Console Unified',
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:5173',
                viewport: { width: 1920, height: 1080 },
            },
            testMatch: /.*admin.*\.spec\.ts/,
        },
    ],
});
