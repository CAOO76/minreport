#!/bin/bash
# start-dev-safe.sh - Script para desarrollo que preserva datos de Firebase

export PATH="/Users/wortogbase/.nvm/versions/node/v20.19.5/bin:$PATH"

echo "🔧 Configurando entorno Node.js..."
echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"
echo "pnpm version: $(npx pnpm --version)"
echo ""

echo "🚀 Iniciando arquitectura MINREPORT (modo seguro)..."
echo "   📱 HOME: Puerto 5179"
echo "   👤 CLIENT: Puerto 5173" 
echo "   👨‍💼 ADMIN: Puerto 5177"
echo "   🔥 Firebase Emulators (datos preservados)"
echo ""

npx pnpm dev:safe