#!/bin/bash
# Pre-build script to copy SDK to web/src for proper bundling

# Ensure we are in the web directory regardless of where the script is called from
cd "$(dirname "$0")/.."

echo "Copying SDK to web/src..."
rm -rf src/sdk-bundle
mkdir -p src/sdk-bundle

# Now paths are relative to web/
rsync -av --exclude='tsconfig.json' --exclude='package.json' --exclude='node_modules' ../sdk/ src/sdk-bundle/
echo "SDK copied successfully"
