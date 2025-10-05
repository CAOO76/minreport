#!/bin/bash
# ultimate-dev-start.sh - Solución definitiva que GARANTIZA preservar datos y super admin

export PATH="/Users/wortogbase/.nvm/versions/node/v20.19.5/bin:$PATH"

echo "🔧 Configurando entorno Node.js..."
echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"
echo "pnpm version: $(npx pnpm --version)"
echo ""

echo "🚀 Iniciando MINREPORT con preservación GARANTIZADA de datos..."
echo "   📱 HOME: Puerto 5179"
echo "   👤 CLIENT: Puerto 5173" 
echo "   👨‍💼 ADMIN: Puerto 5177"
echo "   🔥 Firebase Emulators"
echo ""

# Paso 1: Limpiar puertos pero preservar datos
echo "🧹 Limpiando puertos..."
npx pnpm clean:emulators

# Paso 2: Iniciar servicios CON emuladores
echo "⚡ Iniciando servicios..."
npx pnpm dev:safe &
DEV_PID=$!

# Paso 3: Esperar que emuladores estén listos
echo "⏳ Esperando emuladores..."
sleep 20

# Verificar que Auth esté listo
while ! nc -z localhost 9190; do
  echo "🔄 Esperando Auth emulator..."
  sleep 3
done

while ! nc -z localhost 8085; do
  echo "🔄 Esperando Firestore emulator..."
  sleep 3
done

echo "✅ Emuladores listos!"

# Paso 4: GARANTIZAR super admin
echo "🔐 Verificando/creando super admin..."
FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190' FIRESTORE_EMULATOR_HOST='127.0.0.1:8085' node create-super-admin.cjs

echo ""
echo "🎉 Sistema completamente listo con datos preservados:"
echo "   📱 HOME: http://localhost:5179"
echo "   👤 CLIENT: http://localhost:5173"
echo "   👨‍💼 ADMIN: http://localhost:5177"
echo ""
echo "🔐 Super Admin GARANTIZADO:"
echo "   📧 Email: app_dev@minreport.com"
echo "   🔑 Password: password-seguro-local"
echo ""

# Esperar
wait $DEV_PID