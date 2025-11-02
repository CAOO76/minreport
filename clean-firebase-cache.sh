#!/bin/bash

echo "🧹 Limpiando caché de Firebase Emulator..."

# Detener todos los procesos node y firebase
killall node pnpm firebase 2>/dev/null
sleep 2

# Limpiar la caché del emulador
echo "📦 Removiendo directorios de cache..."
rm -rf ~/.cache/firebase/emulators 2>/dev/null
rm -rf .firebase/cache 2>/dev/null
rm -rf firebase-emulators-data 2>/dev/null

# Limpiar datos exportados
rm -rf firebase-export-* 2>/dev/null

# Recompilar functions
echo "🔨 Recompilando Cloud Functions..."
cd services/functions
rm -rf lib dist .eslintrc.js 2>/dev/null
npm run build 2>/dev/null || true
cd ../..

echo "✅ Cache limpiado. Ejecuta: pnpm run dev:clean"
