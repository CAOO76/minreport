#!/bin/bash

# Configurar PATH con node y npm
export PATH="/Users/wortogbase/.nvm/versions/node/v20.19.5/bin:$PATH"

# SCRIPT FINAL - Limpia puertos automáticamente
echo "🚀 DESARROLLO CON LIMPIEZA AUTOMÁTICA"

# Limpiar puertos
echo "🧹 Limpiando puertos..."
pkill -f "firebase emulators" 2>/dev/null || true
lsof -ti:8085 -ti:9190 -ti:5001 -ti:9195 -ti:9196 | xargs kill -9 2>/dev/null || true
sleep 2

# Verificar puertos libres
if lsof -i :8085 >/dev/null 2>&1; then
    echo "❌ Puerto 8085 ocupado:"
    lsof -i :8085
    exit 1
fi

echo "✅ Puertos libres"

# Limpiar al salir
cleanup() {
    echo "🛑 Cerrando..."
    FIREBASE_AUTH_EMULATOR_HOST='localhost:9190' FIRESTORE_EMULATOR_HOST='localhost:8085' node backup-super-admin.cjs 2>/dev/null || true
    pkill -f "firebase\|vite\|pnpm" 2>/dev/null || true
    echo "🔒 Guardado"
    exit 0
}

trap cleanup SIGINT SIGTERM

echo "⚡ Iniciando servicios..."
pnpm dev:persist &
sleep 15

# Verificar conexión
while ! curl -s http://localhost:9190 >/dev/null 2>&1; do
    echo "⏳ Esperando Auth..."
    sleep 3
done

echo "🔑 Configurando super admin..."
FIREBASE_AUTH_EMULATOR_HOST='localhost:9190' FIRESTORE_EMULATOR_HOST='localhost:8085' node create-super-admin.cjs

echo "✅ LISTO! 🌐 http://localhost:5173"
echo "🔑 app_dev@minreport.com / password-seguro-local"

wait