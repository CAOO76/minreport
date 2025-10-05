#!/bin/bash
# setup-complete-dev.sh - Script completo para desarrollo con super admin automático

export PATH="/Users/wortogbase/.nvm/versions/node/v20.19.5/bin:$PATH"

echo "🔧 Configurando entorno Node.js..."
echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"
echo "pnpm version: $(npx pnpm --version)"
echo ""

echo "🚀 Iniciando arquitectura MINREPORT completa..."
echo "   📱 HOME: Puerto 5179"
echo "   👤 CLIENT: Puerto 5173" 
echo "   👨‍💼 ADMIN: Puerto 5177"
echo "   🔥 Firebase Emulators"
echo ""

# Iniciar servicios en background
npx pnpm dev &
DEV_PID=$!

echo "⏳ Esperando que los emuladores estén listos..."
sleep 15

# Verificar que los emuladores estén corriendo
while ! nc -z localhost 9190; do
  echo "🔄 Esperando emulador de Auth..."
  sleep 2
done

while ! nc -z localhost 8085; do
  echo "🔄 Esperando emulador de Firestore..."
  sleep 2
done

echo "✅ Emuladores listos. Creando super admin..."

# Crear super admin
FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190' FIRESTORE_EMULATOR_HOST='127.0.0.1:8085' node create-super-admin.cjs

echo ""
echo "🎉 Sistema completamente listo:"
echo "   📱 HOME: http://localhost:5179"
echo "   👤 CLIENT: http://localhost:5173"
echo "   👨‍💼 ADMIN: http://localhost:5177"
echo ""
echo "🔐 Credenciales Super Admin:"
echo "   📧 Email: app_dev@minreport.com"
echo "   🔑 Password: password-seguro-local"
echo ""
echo "⚠️  Para detener: Ctrl+C"

# Esperar que termine el proceso principal
wait $DEV_PID