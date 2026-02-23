#!/usr/bin/env node
/**
 * sync-sdk-version.js
 * Reads the version from sdk/package.json and patches sdk/metadata.ts
 * to keep SDK_METADATA.version in sync automatically.
 * Called by dev-full.sh before copying the SDK bundle.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SDK_PKG = path.join(ROOT, 'sdk', 'package.json');
const METADATA = path.join(ROOT, 'sdk', 'metadata.ts');

const { version } = JSON.parse(fs.readFileSync(SDK_PKG, 'utf-8'));

let content = fs.readFileSync(METADATA, 'utf-8');

// Replace the version field value (handles single or double quotes)
const updated = content.replace(
    /version:\s*['"][^'"]*['"]/,
    `version: '${version}'`
);

if (content !== updated) {
    fs.writeFileSync(METADATA, updated);
    console.log(`✅ [SDK Sync] sdk/metadata.ts → version patched to '${version}'`);
} else {
    console.log(`🛡️  [SDK Sync] sdk/metadata.ts already at version '${version}'. No changes needed.`);
}
