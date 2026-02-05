#!/bin/bash
# Pre-build script to copy SDK to admin/src for proper bundling

echo "Copying SDK to admin/src..."
rm -rf src/sdk-bundle
mkdir -p src/sdk-bundle
rsync -av --exclude='tsconfig.json' --exclude='package.json' --exclude='node_modules' ../sdk/ src/sdk-bundle/
echo "SDK copied to Admin successfully"
