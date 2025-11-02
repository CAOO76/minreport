#!/bin/bash
# setup-admin.sh - Script para iniciar emuladores y crear super admin automáticamente

export PATH="/Users/wortogbase/.nvm/versions/node/v20.19.5/bin:$PATH"

echo "🔧 Configurando entorno Node.js..."
echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"
echo "pnpm version: $(npx pnpm --version)"
echo ""

echo "🧹 Limpiando puertos..."
npx pnpm clean:emulators
./pre-dev.sh
echo ""

echo "🔥 Iniciando emuladores Firebase en segundo plano..."
npx pnpm emulators:start &
EMULATOR_PID=$!

echo "⏳ Esperando que los emuladores estén listos (30 segundos)..."
sleep 30

echo "🔐 Creando cuenta super admin..."
FIREBASE_AUTH_EMULATOR_HOST='localhost:9190' FIRESTORE_EMULATOR_HOST='localhost:8085' node create-super-admin.cjs

echo ""
echo "✅ ¡Proceso completado!"
echo "📧 Email: app_dev@minreport.com"
echo "🔐 Contraseña: password-seguro-local"
echo "🌐 URL Admin: http://localhost:5173/"
echo ""
echo "Los emuladores siguen ejecutándose en segundo plano (PID: $EMULATOR_PID)"
echo "Para detenerlos: kill $EMULATOR_PID"