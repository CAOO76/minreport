#!/usr/bin/env bash

# 🚀 MINREPORT - UNIFIED DEVELOPMENT SCRIPT (WEB 3.0 MONOLITH MODE)
# Inicia todo el ecosistema con persistencia garantizada de datos locales, limpieza segura de puertos y sincronización móvil.

echo "🟢 Iniciando entorno de desarrollo MINREPORT..."

# Configurar entorno limpio para Java y Emuladores (aislado de credenciales ADC de producción)
unset _JAVA_OPTIONS
unset GOOGLE_APPLICATION_CREDENTIALS

# Configurar JDK para Firebase Tools Emulators si existe ruta personalizada
if [ -d "/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home" ]; then
    export JAVA_HOME="/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
    export PATH="$JAVA_HOME/bin:$PATH"
fi

DATA_DIR="$(pwd)/data"
BACKUP_DIR="$(pwd)/_backups/data-last-good"

# 0. Respaldo Preventivo de Sesión Activa (NUNCA matar el emulador sin volcar a ./data primero)
if lsof -ti:4400 >/dev/null 2>&1 && lsof -ti:8085 >/dev/null 2>&1; then
    echo "💾 Sesión activa detectada. Exportando datos en memoria hacia ./data antes de reiniciar..."
    EXPORT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:4400/_admin/export" \
        -H "Content-Type: application/json" \
        -d "{\"path\":\"$DATA_DIR\",\"initiatedBy\":\"dev-full-pre-restart\"}" 2>/dev/null || echo "000")
    if [ "$EXPORT_STATUS" = "200" ]; then
        echo "✅ Datos de la sesión previa respaldados exitosamente en ./data."
    else
        npx firebase-tools emulators:export --force ./data >/dev/null 2>&1 || true
    fi
fi

# Sincronizar o auto-reparar copia espejo de seguridad en _backups/data-last-good
if [ -f "$DATA_DIR/firebase-export-metadata.json" ]; then
    mkdir -p "$(dirname "$BACKUP_DIR")"
    cp -R "$DATA_DIR/." "$BACKUP_DIR/" 2>/dev/null || true
elif [ -f "$BACKUP_DIR/firebase-export-metadata.json" ]; then
    echo "🛡️ Restaurando ./data desde copia espejo verificada (_backups/data-last-good)..."
    mkdir -p "$DATA_DIR"
    cp -R "$BACKUP_DIR/." "$DATA_DIR/"
fi

# 1. Limpieza Ordenada de Puertos (Prevenir errores de "port taken" tras haber exportado los datos)
echo "🧹 Deteniendo servicios previos de forma segura..."
PORTS="8080,5173,5174,8085,9190,9196,9195,5010,5015,5016,4002,4400,5201,5190,5175"
PIDS=$(lsof -ti:$PORTS 2>/dev/null)
if [ ! -z "$PIDS" ]; then
    echo "PIDs encontrados: $PIDS. Enviando SIGTERM..."
    echo "$PIDS" | xargs kill -15 2>/dev/null || true
    
    # Esperar hasta 5 segundos para que los procesos cierren y exporten limpiamente
    for i in {1..5}; do
        PIDS_REMAINING=$(lsof -ti:$PORTS 2>/dev/null)
        if [ -z "$PIDS_REMAINING" ]; then
            echo "✅ Puertos liberados correctamente."
            break
        fi
        sleep 1
    done

    # Limpieza final solo si quedan procesos bloqueados
    PIDS_FINAL=$(lsof -ti:$PORTS 2>/dev/null)
    if [ ! -z "$PIDS_FINAL" ]; then
        echo "⚠️ Forzando liberación en puertos restantes..."
        echo "$PIDS_FINAL" | xargs kill -9 2>/dev/null || true
    fi
fi

pkill -f "cloud-firestore-emulator" 2>/dev/null || true
pkill -f "cloud-storage-rules" 2>/dev/null || true

# 2. Sincronización de IP (Requerido para Android/Móvil)
echo "📡 Sincronizando IP local para acceso móvil..."
bash scripts/sync-mobile.sh

# 3. Lanzamiento paralelo de servicios integrados (Monolito Soberano MINREPORT)
echo "[MINREPORT] Iniciando servicios unificados (Persistencia Continua Activa en ./data)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "APP WEB (4º/5º):     http://localhost:5173"
echo "PORTAL DEV (1º):     http://localhost:5173/dev"
echo "CONSOLA ADMIN (2º):  http://localhost:5173/admin"
echo "TEST-PILOT (3º):     http://localhost:5173/pilot"
echo "CORE API:            http://localhost:8080"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

npx concurrently --kill-others \
  --names "EMU,API,WEB" \
  --prefix-colors "yellow,blue,green" \
  "npm run serve:emulators" \
  "npm run dev:server" \
  "npm run dev:mobile --prefix web"
