import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for MINREPORT E2E Tests
 * 
 * Covers:
 * - Desktop (Chrome, Firefox, Safari)
 * - Mobile (Pixel 5, iPhone 12)
 * - Firebase Emulators Integration
 */

export default defineConfig({
    testDir: './tests',

    // Timeout Configuration
    timeout: 60 * 1000, // 60 seconds per test
    expect: {
        timeout: 10000 // 10 seconds for assertions
    },

    // Test Execution
    fullyParallel: false, // Sequential to avoid Firestore conflicts
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1, // Single worker to avoid CPU overload with emulators

    // Reporter
    reporter: [
        ['html', { outputFolder: 'playwright-report' }],
        ['list'],
        ['json', { outputFile: 'test-results.json' }]
    ],

    // Global Setup/Teardown
    globalSetup: require.resolve('./tests/global-setup.ts'),
    globalTeardown: require.resolve('./tests/global-teardown.ts'),

    use: {
        // Base URL
        baseURL: 'http://localhost:5173',

        // Trace on first retry
        trace: 'on-first-retry',

        // Screenshot on failure
        screenshot: 'only-on-failure',

        // Video on failure
        video: 'retain-on-failure',

        // Action timeout
        actionTimeout: 15000,

        // Navigation timeout
        navigationTimeout: 30000,
    },

    // Web Server (Frontend)
    webServer: [
        {
            command: 'cd web && npm run dev',
            url: 'http://localhost:5173',
            reuseExistingServer: !process.env.CI,
            timeout: 120 * 1000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
        {
            command: 'cd admin && npm run dev',
            url: 'http://localhost:5174',
            reuseExistingServer: !process.env.CI,
            timeout: 120 * 1000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
        {
            command: 'npm run dev',
            url: 'http://localhost:8080/health',
            reuseExistingServer: !process.env.CI,
            timeout: 120 * 1000,
            stdout: 'pipe',
            stderr: 'pipe',
        }
    ],

    // Projects (Desktop + Mobile)
    projects: [
        // ========================================
        // DESKTOP BROWSERS
        // ========================================
        {
            name: 'Desktop Chrome',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1920, height: 1080 },
                launchOptions: {
                    args: ['--disable-web-security'] // For CORS in emulators
                }
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

        // ========================================
        // MOBILE DEVICES
        // ========================================
        {
            name: 'Mobile Pixel 5',
            use: {
                ...devices['Pixel 5'],
                // Mobile viewport already defined in device
            },
        },

        {
            name: 'Mobile iPhone 12',
            use: {
                ...devices['iPhone 12'],
                // Mobile viewport already defined in device
            },
        },

        // ========================================
        // ADMIN DASHBOARD (Desktop Only)
        // ========================================
        {
            name: 'Admin Dashboard',
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:5174',
                viewport: { width: 1920, height: 1080 },
            },
            testMatch: /.*admin.*\.spec\.ts/,
        },
    ],
});
