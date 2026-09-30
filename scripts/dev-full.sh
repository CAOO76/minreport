#!/bin/zsh

# 🚀 MINREPORT - UNIFIED DEVELOPMENT SCRIPT (WEB 3.0 MONOLITH MODE)
# Inicia todo el ecosistema con limpieza de puertos, sincronización móvil y Android Studio.

echo "🟢 Iniciando entorno de desarrollo MINREPORT..."

# Configurar JDK 21 para Firebase Tools Emulators
if [ -d "/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home" ]; then
    export JAVA_HOME="/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
    export PATH="$JAVA_HOME/bin:$PATH"
fi

# 1. Limpieza de Puertos (Prevenir errores de "port taken")
echo "🧹 Deteniendo servicios previos de forma segura..."
PORTS="8080,5173,5174,8085,9190,9196,9195,5010,5015,5016,4002,4400"
PIDS=$(lsof -ti:$PORTS 2>/dev/null)
if [ ! -z "$PIDS" ]; then
    echo "PIDs encontrados: $PIDS. Enviando SIGTERM..."
    echo "$PIDS" | xargs kill -15 2>/dev/null || true
    
    # Esperar hasta 5 segundos para que los procesos liberen puertos
    for i in {1..5}; do
        PIDS_REMAINING=$(lsof -ti:$PORTS 2>/dev/null)
        if [ -z "$PIDS_REMAINING" ]; then
            echo "✅ Puertos liberados correctamente."
            break
        fi
        sleep 1
    done

    # Limpieza final solo si quedan procesos
    PIDS_FINAL=$(lsof -ti:$PORTS 2>/dev/null)
    if [ ! -z "$PIDS_FINAL" ]; then
        echo "⚠️ Forzando kill -9 en puertos restantes..."
        echo "$PIDS_FINAL" | xargs kill -9 2>/dev/null || true
    fi
fi

# 2. Sincronización de IP (Requerido para Android/Móvil)
echo "📡 Sincronizando IP local para acceso móvil..."
bash scripts/sync-mobile.sh

# 3. Lanzamiento paralelo de servicios esenciales
echo "🔥 Iniciando servicios de MINREPORT..."

npx concurrently --kill-others \
  --names "EMU,API,WEB,ADM" \
  --prefix-colors "yellow,blue,green,magenta" \
  "npm run serve:emulators" \
  "npm run dev:server" \
  "npm run dev:mobile --prefix web" \
  "npm run dev --prefix admin"
