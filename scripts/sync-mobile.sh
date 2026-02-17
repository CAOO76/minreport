#!/bin/zsh

# Script para sincronizar la IP del iMac con el entorno móvil

echo "🔍 Detectando IP local del iMac..."

# Intentar obtener la IP de en0 (WiFi) o en1 (Ethernet)
IP_ADDRESS=$(ipconfig getifaddr en0 || ipconfig getifaddr en1)

if [ -z "$IP_ADDRESS" ]; then
    echo "❌ No se pudo detectar la IP local. Verifica tu conexión a red."
    exit 1
fi

echo "✅ IP detectada: $IP_ADDRESS"

# Actualizar .env en la carpeta web
ENV_FILE="web/.env"
CAP_JSON="web/capacitor.config.json"
CAP_TS="web/capacitor.config.ts"

if [ -f "$ENV_FILE" ]; then
    echo "📝 Actualizando IP en $ENV_FILE..."
    sed -i '' "s|VITE_API_URL=.*|VITE_API_URL=http://$IP_ADDRESS:8080|g" "$ENV_FILE"
    echo "🚀 VITE_API_URL -> http://$IP_ADDRESS:8080"
fi

if [ -f "$CAP_JSON" ]; then
    echo "📝 Actualizando IP en $CAP_JSON..."
    sed -i '' "s|\"192.168.1.*\"|\"$IP_ADDRESS\"|g" "$CAP_JSON"
    sed -i '' "s|http://192.168.1.*:5173|http://$IP_ADDRESS:5173|g" "$CAP_JSON"
fi

if [ -f "$CAP_TS" ]; then
    echo "📝 Actualizando IP en $CAP_TS..."
    sed -i '' "s|url: 'http://192.168.1.*:5173'|url: 'http://$IP_ADDRESS:5173'|g" "$CAP_TS"
fi

# ADB Reverse (Para asegurar conexión en dispositivos conectados por USB/Emuladores)
ADB_PATH=""
if [ -f "$HOME/Library/Android/sdk/platform-tools/adb" ]; then
    ADB_PATH="$HOME/Library/Android/sdk/platform-tools/adb"
elif [ -f "/usr/local/bin/adb" ]; then
    ADB_PATH="/usr/local/bin/adb"
elif command -v adb &> /dev/null; then
    ADB_PATH="adb"
fi

if [ ! -z "$ADB_PATH" ]; then
    echo "🔗 Configurando ADB Reverse tcp:5173 y tcp:8080..."
    $ADB_PATH reverse tcp:5173 tcp:5173
    $ADB_PATH reverse tcp:8080 tcp:8080
    
    # TRUCO MAESTRO: Reverse para la IP antigua (.85) si es posible (solo funciona si el dispositivo lo permite)
    # Esto es un intento de "cache busting" a nivel de red
    # $ADB_PATH reverse tcp:5173 tcp:5173
else
    echo "⚠️ ADB no encontrado, saltando reverse proxy."
fi

# Sincronizar con Capacitor
echo "🔄 Compilando y sincronizando assets nativos con Capacitor..."
cd web && /usr/local/bin/node ./node_modules/.bin/cap sync android

echo "✨ Proceso completado. Reinicia la app en Android Studio."
