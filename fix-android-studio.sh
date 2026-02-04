#!/bin/zsh

# Script para abrir Android Studio con las variables de entorno de la terminal actual
# Esto soluciona el error "Failed to load environment from /bin/zsh"

echo "🚀 Configurando entorno para Android Studio..."

# Asegurar que Node y NPM estén en el PATH
export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

# Ruta por defecto de Android Studio en macOS
AS_PATH="/Applications/Android Studio.app"

if [ -d "$AS_PATH" ]; then
    echo "✅ Android Studio detectado. Iniciando..."
    open "$AS_PATH"
else
    echo "❌ No se encontró Android Studio en /Applications."
    echo "Intenta abrirlo manualmente desde una terminal con: open /Applications/Android\ Studio.app"
fi
