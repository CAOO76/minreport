#!/bin/zsh

# 🚀 MINREPORT - UNIFIED DEVELOPMENT SCRIPT (LIVE MODE)
# Inicia todo el ecosistema con limpieza de puertos, sincronización móvil y Android Studio.

echo "🟢 Iniciando entorno de desarrollo MINREPORT (Modo Live)..."

# 1. Limpieza de Puertos (Prevenir errores de "port taken")
echo "🧹 Deteniendo servicios previos de forma segura..."
PORTS="8080,5173,5174,8085,9190,9196,9195,5010,5015,5016,4002,4400"
PIDS=$(lsof -ti:$PORTS 2>/dev/null)
if [ ! -z "$PIDS" ]; then
    echo "$PIDS" | xargs kill -15 2>/dev/null || true
    sleep 3
    # Limpieza final para procesos rebeldes
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
fi

# 2. Sincronización de IP (Requerido para Android/Móvil)
echo "📡 Sincronizando IP local para acceso móvil..."
bash scripts/sync-mobile.sh

# 3. Distribución de SDK (Asegurar versión 2.0.0 en todas las interfaces)
echo "📦 Distribuyendo última versión del SDK..."
bash web/scripts/copy-sdk.sh
bash admin/scripts/copy-sdk.sh

# 4. Lanzamiento paralelo de todos los servicios
echo "🔥 Iniciando servicios en paralelo..."

npx concurrently --kill-others \
  --names "EMU,API,WEB,ADM,SDK" \
  --prefix-colors "yellow,blue,green,magenta,cyan" \
  "npm run serve:emulators" \
  "npm run dev:server" \
  "npm run dev:mobile --prefix web" \
  "npm run dev --prefix admin" \
  "npm run watch:sdk"
