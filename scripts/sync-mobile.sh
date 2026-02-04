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

if [ -f "$ENV_FILE" ]; then
    echo "📝 Actualizando VITE_API_URL en $ENV_FILE..."
    # Usar sed para reemplazar la línea VITE_API_URL
    if grep -q "VITE_API_URL=" "$ENV_FILE"; then
        # Mac sed requiere una extensión para -i, o usar una cadena vacía
        sed -i '' "s|VITE_API_URL=.*|VITE_API_URL=http://$IP_ADDRESS:8080|g" "$ENV_FILE"
    else
        echo "VITE_API_URL=http://$IP_ADDRESS:8080" >> "$ENV_FILE"
    fi
    echo "🚀 VITE_API_URL configurado a http://$IP_ADDRESS:8080"
else
    echo "❌ No se encontró el archivo $ENV_FILE"
    exit 1
fi

# Sincronizar con Capacitor
echo "🔄 Compilando y sincronizando assets nativos con Capacitor..."
cd web && export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin && npm run build && npx cap sync android

echo "✨ Proceso completado. Reinicia la app en Android Studio."
