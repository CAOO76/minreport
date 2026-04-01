#!/bin/zsh

# 🚀 MINREPORT - UNIFIED DEVELOPMENT SCRIPT (LIVE MODE)
# Inicia todo el ecosistema con limpieza de puertos, sincronización móvil y Android Studio.

echo "🟢 Iniciando entorno de desarrollo MINREPORT (Modo Live)..."

# 1. Limpieza de Puertos (Prevenir errores de "port taken")
echo "🧹 Deteniendo servicios previos de forma segura..."
PORTS="8080,5173,5174,8085,9190,9196,9195,5010,5015,5016,4002,4400"
PIDS=$(lsof -ti:$PORTS 2>/dev/null)
if [ ! -z "$PIDS" ]; then
    echo "PIDs encontrados: $PIDS. Enviando SIGTERM..."
    echo "$PIDS" | xargs kill -15 2>/dev/null || true
    
    # Esperar hasta 20 segundos para que los emuladores exporten datos
    echo "⏳ Esperando exportación de datos de emuladores (max 20s)..."
    for i in {1..20}; do
        PIDS_REMAINING=$(lsof -ti:$PORTS 2>/dev/null)
        if [ -z "$PIDS_REMAINING" ]; then
            echo "✅ Todos los procesos terminaron correctamente."
            break
        fi
        sleep 1
    done

    # Limpieza final solo si quedan procesos
    PIDS_FINAL=$(lsof -ti:$PORTS 2>/dev/null)
    if [ ! -z "$PIDS_FINAL" ]; then
        echo "⚠️ Algunos procesos no cerraron a tiempo. Forzando kill -9..."
        echo "$PIDS_FINAL" | xargs kill -9 2>/dev/null || true
    fi
fi

# 2. Sincronización de IP (Requerido para Android/Móvil)
echo "📡 Sincronizando IP local para acceso móvil..."
bash scripts/sync-mobile.sh

# 3. Sincronización de versión SDK (Fuente de verdad: sdk/package.json → sdk/metadata.ts)
echo "🔢 Sincronizando versión SDK desde sdk/package.json..."
node scripts/sync-sdk-version.js

# 4. Distribución de SDK (Asegurar versión actualizada en todas las interfaces)
echo "📦 Distribuyendo última versión del SDK..."
bash web/scripts/copy-sdk.sh
bash admin/scripts/copy-sdk.sh

# 4.5 Registro en Base de Datos (Auto-Discovery preventivo)
echo "🗄️ Registrando versión en Base de Datos (en background esperando emuladores)..."
(sleep 15 && FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 node scripts/auto-register-sdk.js) &


# 5. Lanzamiento paralelo de todos los servicios
echo "🔥 Iniciando servicios en paralelo..."

npx concurrently --kill-others \
  --names "EMU,API,WEB,ADM,SDK" \
  --prefix-colors "yellow,blue,green,magenta,cyan" \
  "npm run serve:emulators" \
  "npm run dev:server" \
  "npm run dev:mobile --prefix web" \
  "npm run dev --prefix admin" \
  "npm run watch:sdk"
