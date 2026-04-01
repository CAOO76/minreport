#!/bin/zsh

# Script para desarrollo paralelo: Web + Android
# Inicia Vite en modo host y abre Android Studio automáticamente

echo "🚀 Iniciando desarrollo paralelo Web + Android..."

# Asegurar que Node y NPM estén en el PATH
export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

# Copiar SDK
echo "📦 Copiando SDK..."
bash scripts/copy-sdk.sh

# Abrir Android Studio en segundo plano
echo "📱 Abriendo Android Studio..."
AS_PATH="/Applications/Android Studio.app"
if [ -d "$AS_PATH" ]; then
    open "$AS_PATH" &
    echo "✅ Android Studio iniciado"
else
    echo "⚠️  Android Studio no encontrado en /Applications"
fi

# Iniciar Vite en modo host (foreground)
echo "🌐 Iniciando Vite en modo host..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📱 Después de que Vite inicie, presiona Run (▶️) en Android Studio"
echo "🔥 Hot Reload estará activo - los cambios se reflejarán automáticamente"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

vite --host --clearScreen false
