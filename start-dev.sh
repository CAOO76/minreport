#!/bin/bash
# start-dev.sh - Script para iniciar el entorno de desarrollo con Node.js configurado

export PATH="/Users/wortogbase/.nvm/versions/node/v20.19.5/bin:$PATH"

echo "🔧 Configurando entorno Node.js..."
echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"
echo "pnpm version: $(npx pnpm --version)"
echo ""

echo "🚀 Iniciando arquitectura MINREPORT completa..."
echo "   📱 HOME: Puerto 5179"
echo "   👤 CLIENT: Puerto 5175" 
echo "   👨‍💼 ADMIN: Puerto 5177"
echo "   🔥 Firebase Emulators"
echo ""

npx pnpm dev