#!/bin/zsh

# Script para limpiar y reiniciar la app de Android automáticamente
# Desinstala la app del emulador y la vuelve a instalar con configuración fresca

echo "🧹 Limpiando instalación de MINREPORT en Android..."

# Buscar ADB en ubicaciones comunes
ADB_PATH=""
if [ -f "$HOME/Library/Android/sdk/platform-tools/adb" ]; then
    ADB_PATH="$HOME/Library/Android/sdk/platform-tools/adb"
elif [ -f "/usr/local/bin/adb" ]; then
    ADB_PATH="/usr/local/bin/adb"
elif command -v adb &> /dev/null; then
    ADB_PATH="adb"
else
    echo "❌ No se encontró ADB. Asegúrate de que Android SDK esté instalado."
    echo "💡 Puedes desinstalar la app manualmente desde el emulador."
    exit 1
fi

echo "✅ ADB encontrado: $ADB_PATH"

# Verificar que hay dispositivos conectados
DEVICES=$($ADB_PATH devices | grep -v "List" | grep "device$" | wc -l)
if [ $DEVICES -eq 0 ]; then
    echo "⚠️  No hay emuladores o dispositivos conectados."
    echo "💡 Inicia el emulador desde Android Studio primero."
    exit 1
fi

echo "📱 Dispositivo detectado"

# Desinstalar la app
echo "🗑️  Desinstalando com.minreport.app..."
$ADB_PATH uninstall com.minreport.app 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ App desinstalada correctamente"
else
    echo "ℹ️  La app no estaba instalada o ya fue desinstalada"
fi

# Copiar configuración actualizada
echo "📋 Copiando configuración actualizada..."
cd /Volumes/CODE/MINREPORT\ iMac/minreport/web
npx cap copy android

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Limpieza completada"
echo "📱 Ahora presiona Run (▶️) en Android Studio"
echo "🔥 La app cargará con la configuración actualizada"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
