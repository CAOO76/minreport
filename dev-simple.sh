#!/bin/bash

# DESARROLLO SIMPLE - Persistencia con archivo JSON local
echo "🚀 DESARROLLO CON PERSISTENCIA SIMPLE"

cleanup() {
    echo "💾 Guardando datos..."
    FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190' FIRESTORE_EMULATOR_HOST='127.0.0.1:8085' node simple-persist.cjs save 2>/dev/null || true
    pkill -f "firebase\|vite\|pnpm" 2>/dev/null || true
    echo "🔒 Datos guardados en persistent-data.json"
    exit 0
}

trap cleanup SIGINT SIGTERM

echo "⚡ Iniciando servicios..."
pnpm dev:persist &
sleep 8

echo "🔄 Cargando datos..."
FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190' FIRESTORE_EMULATOR_HOST='127.0.0.1:8085' node simple-persist.cjs load

if [ ! -f "./persistent-data.json" ]; then
    echo "🆕 Creando super admin..."
    FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190' FIRESTORE_EMULATOR_HOST='127.0.0.1:8085' node create-super-admin.cjs
fi

echo "✅ LISTO! 🌐 http://localhost:5177"
echo "🔑 app_dev@minreport.com / password-seguro-local"
echo "💡 Ctrl+C guarda automáticamente"

wait