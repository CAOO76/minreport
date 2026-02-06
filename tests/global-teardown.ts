import { FullConfig } from '@playwright/test';

/**
 * Global Teardown for Playwright Tests
 * 
 * Responsibilities:
 * 1. Clean up test data (optional)
 * 2. Stop emulators (optional, usually left running for dev)
 */

async function globalTeardown(config: FullConfig) {
  console.log('\n🧹 [Global Teardown] Cleaning up...\n');

  // Note: We typically leave emulators running for faster subsequent test runs
  // Uncomment below to stop emulators after tests

  try {
    const { execSync } = require('child_process');
    console.log('🛑 [Emulators] Stopping emulators...');
    execSync('firebase emulators:stop');
    console.log('✅ [Emulators] Stopped');
  } catch (error) {
    console.error('⚠️  [Emulators] Failed to stop (might already be stopped):');
  }

  console.log('✅ [Global Teardown] Complete\n');
}

export default globalTeardown;
