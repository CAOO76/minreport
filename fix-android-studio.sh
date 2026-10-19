#!/usr/bin/env bash

# Script para abrir Android Studio con las variables de entorno de la terminal actual

echo "🚀 Configurando entorno para Android Studio..."

# Asegurar que Node y NPM estén en el PATH
export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

AS_PATH="/Applications/Android Studio.app"

if [ -d "$AS_PATH" ]; then
    echo "✅ Android Studio detectado en macOS. Iniciando..."
    open "$AS_PATH"
elif command -v studio.sh &>/dev/null; then
    echo "✅ Android Studio detectado en Linux. Iniciando..."
    studio.sh &
elif command -v android-studio &>/dev/null; then
    echo "✅ Android Studio detectado en Linux. Iniciando..."
    android-studio &
else
    echo "ℹ️ Android Studio no encontrado automáticamente. Iniciarlo manualmente."
fi
