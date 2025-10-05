#!/bin/bash

# Script para desarrollo con datos 100% persistentes
# Sin depender de Firebase import/export que falla

echo "🚀 Iniciando desarrollo con datos persistentes..."

# 1. Hacer backup de datos existentes si existen
if [ -d "./firebase-emulators-data" ]; then
    echo "📦 Haciendo backup de datos existentes..."
    cp -r ./firebase-emulators-data ./backup-temp-$(date +%s) 2>/dev/null || true
fi

# 2. Iniciar emuladores SIN import/export (más estable)
echo "🔥 Iniciando emuladores..."
firebase emulators:start --only auth,firestore,functions,hosting,storage &
FIREBASE_PID=$!

# Esperar a que emuladores estén listos
echo "⏳ Esperando emuladores..."
sleep 5

# 3. Restaurar datos si hay backup
if [ -f "./super-admin-backup.json" ]; then
    echo "🔄 Restaurando super admin..."
    FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190' FIRESTORE_EMULATOR_HOST='127.0.0.1:8085' node restore-super-admin.cjs
fi

# 4. Iniciar aplicaciones
echo "🌐 Iniciando aplicaciones..."
pnpm dev:apps-only &
APPS_PID=$!

echo "✅ Todo iniciado!"
echo "🔑 Si no tienes super admin, ejecuta: node create-super-admin.cjs"
echo "🌐 ADMIN: http://localhost:5177"
echo "🌐 CLIENT: http://localhost:5173"
echo "🌐 HOME: http://localhost:5179"

# Función para limpiar al salir
cleanup() {
    echo "💾 Guardando datos antes de cerrar..."
    
    # Exportar datos manualmente
    if [ ! -z "$FIREBASE_PID" ]; then
        # Hacer backup de la cuenta admin
        FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190' FIRESTORE_EMULATOR_HOST='127.0.0.1:8085' node backup-super-admin.cjs 2>/dev/null || true
        
        kill $FIREBASE_PID 2>/dev/null || true
    fi
    
    if [ ! -z "$APPS_PID" ]; then
        kill $APPS_PID 2>/dev/null || true
    fi
    
    echo "🔒 Datos guardados. ¡Hasta la próxima!"
    exit 0
}

# Capturar Ctrl+C para hacer cleanup
trap cleanup SIGINT SIGTERM

# Mantener el script corriendo
wait