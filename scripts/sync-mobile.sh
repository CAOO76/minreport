#!/bin/zsh

# Script para sincronizar la IP del iMac con el entorno móvil
# ESTRATEGIA PRINCIPAL: ADB Reverse (USB) → localhost:5173
# ESTRATEGIA FALLBACK: WiFi IP directa

echo "🔍 Detectando IP local del iMac..."
IP_ADDRESS=$(ipconfig getifaddr en0 || ipconfig getifaddr en1)

if [ -z "$IP_ADDRESS" ]; then
    echo "⚠️  No se pudo detectar la IP local. Continuando sin actualizar .env..."
else
    echo "✅ IP detectada: $IP_ADDRESS"
fi

# Actualizar .env en la carpeta web
ENV_FILE="web/.env"
if [ -f "$ENV_FILE" ] && [ ! -z "$IP_ADDRESS" ]; then
    echo "📝 Actualizando IP en $ENV_FILE..."
    sed -i '' "s|VITE_API_URL=.*|VITE_API_URL=http://$IP_ADDRESS:8080|g" "$ENV_FILE"
    echo "🚀 VITE_API_URL -> http://$IP_ADDRESS:8080"
fi

# ADB Reverse (Método preferido: dispositivo USB conectado)
ADB_PATH=""
if [ -f "$HOME/Library/Android/sdk/platform-tools/adb" ]; then
    ADB_PATH="$HOME/Library/Android/sdk/platform-tools/adb"
elif [ -f "/usr/local/bin/adb" ]; then
    ADB_PATH="/usr/local/bin/adb"
elif command -v adb &> /dev/null; then
    ADB_PATH="adb"
fi

if [ ! -z "$ADB_PATH" ]; then
    DEVICES=$($ADB_PATH devices | grep -v "List of devices" | grep "device$" | wc -l | tr -d ' ')
    if [ "$DEVICES" -gt "0" ]; then
        echo "📱 Dispositivo USB detectado. Configurando ADB Reverse (localhost)..."
        $ADB_PATH reverse tcp:5173 tcp:5173
        $ADB_PATH reverse tcp:8080 tcp:8080
        $ADB_PATH reverse tcp:8085 tcp:8085
        echo "✅ ADB Reverse activo: localhost:5173 → Vite | localhost:8080 → API"

        # Asegurar que capacitor apunta a localhost (ADB reverse)
        CAP_JSON="web/capacitor.config.json"
        CAP_TS="web/capacitor.config.ts"
        if [ -f "$CAP_JSON" ]; then
            sed -i '' 's|"url": "http://.*:[0-9]*"|"url": "http://localhost:5173"|g' "$CAP_JSON"
            echo "📝 capacitor.config.json → url: http://localhost:5173"
        fi
        if [ -f "$CAP_TS" ]; then
            sed -i '' "s|url: 'http://.*:[0-9]*'|url: 'http://localhost:5173'|g" "$CAP_TS"
            echo "📝 capacitor.config.ts  → url: http://localhost:5173"
        fi
    else
        echo "⚠️  Sin dispositivo USB. Usando WiFi: $IP_ADDRESS:5173"
        # Fallback: IP directa por WiFi
        CAP_JSON="web/capacitor.config.json"
        if [ -f "$CAP_JSON" ] && [ ! -z "$IP_ADDRESS" ]; then
            sed -i '' "s|\"url\": \"http://.*:[0-9]*\"|\"url\": \"http://$IP_ADDRESS:5173\"|g" "$CAP_JSON"
            echo "📝 capacitor.config.json → url: http://$IP_ADDRESS:5173"
        fi
    fi
else
    echo "⚠️ ADB no encontrado, saltando reverse proxy."
fi

# Sincronizar con Capacitor
echo "🔄 Sincronizando assets nativos con Capacitor..."
/usr/local/bin/node web/node_modules/.bin/cap sync android --project web

echo "✨ Proceso completado. Presiona Run (▶️) en Android Studio."
