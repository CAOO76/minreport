module.exports = defineConfig({
  testDir: './e2e', // Specify the directory where test files are located
  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'pnpm dev:client', // Start only the client-app
    url: 'http://localhost:5175', // URL of the client-app
    timeout: 240 * 1000, // Increased timeout to 240 seconds
    reuseExistingServer: !process.env.CI, // Let Playwright manage
    stdout: 'pipe', // Capture stdout
    stderr: 'pipe', // Capture stderr
  },
  use: {
    baseURL: 'http://localhost:5175', // Base URL for the client-app
    ignoreHTTPSErrors: true, // Ignore HTTPS errors for local dev
  },
});
