#!/bin/bash
# Pre-build script to copy SDK to web/src for proper bundling

<<<<<<< Updated upstream
# Ensure we are in the web directory regardless of where the script is called from
cd "$(dirname "$0")/.."
=======
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."
>>>>>>> Stashed changes

echo "Copying SDK to web/src..."
rm -rf src/sdk-bundle
mkdir -p src/sdk-bundle

# Now paths are relative to web/
rsync -av --exclude='tsconfig.json' --exclude='package.json' --exclude='node_modules' ../sdk/ src/sdk-bundle/
echo "SDK copied successfully"
