#!/usr/bin/env bash

# Script para desarrollo paralelo: Web + Android
# Inicia Vite en modo host y abre Android Studio automáticamente

echo "🚀 Iniciando desarrollo paralelo Web + Android..."

# Asegurar que Node y NPM estén en el PATH
export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

# Abrir Android Studio en segundo plano si existe
echo "📱 Verificando Android Studio..."
AS_PATH="/Applications/Android Studio.app"
if [ -d "$AS_PATH" ]; then
    open "$AS_PATH" &
    echo "✅ Android Studio iniciado (macOS)"
elif command -v studio.sh &>/dev/null; then
    studio.sh &
    echo "✅ Android Studio iniciado (Linux)"
elif command -v android-studio &>/dev/null; then
    android-studio &
    echo "✅ Android Studio iniciado (Linux)"
else
    echo "ℹ️ Android Studio no encontrado automáticamente."
fi

# Iniciar Vite en modo host (foreground)
echo "🌐 Iniciando Vite en modo host..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📱 Después de que Vite inicie, presiona Run (▶️) en Android Studio"
echo "🔥 Hot Reload estará activo - los cambios se reflejarán automáticamente"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

vite --host --clearScreen false
