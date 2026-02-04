#!/bin/zsh

# Script para generar APK de pruebas para dispositivos reales
# El APK se conectará a los emuladores de Firebase en tu iMac (192.168.1.87)

echo "📱 Generando APK para dispositivos reales..."
echo ""
echo "⚠️  IMPORTANTE: Tu móvil debe estar en la misma red WiFi que tu iMac"
echo "   IP del iMac: 192.168.1.87"
echo ""

# 1. Build del proyecto web
echo "🔨 Compilando proyecto web..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Error al compilar el proyecto web"
    exit 1
fi

# 2. Copiar archivos usando configuración de producción
echo "📋 Copiando archivos a Android (configuración de producción)..."
cp capacitor.config.production.ts capacitor.config.temp.ts
cp capacitor.config.ts capacitor.config.dev.backup.ts
cp capacitor.config.production.ts capacitor.config.ts

npx cap sync android

# 3. Restaurar configuración de desarrollo
cp capacitor.config.dev.backup.ts capacitor.config.ts
rm capacitor.config.dev.backup.ts
rm capacitor.config.temp.ts

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Proyecto sincronizado con configuración de producción"
echo ""
echo "📱 Ahora en Android Studio:"
echo "   1. Build → Generate Signed Bundle / APK"
echo "   2. Selecciona 'APK'"
echo "   3. Elige tu keystore (o crea uno nuevo)"
echo "   4. Selecciona 'debug' o 'release'"
echo "   5. El APK se generará en: android/app/build/outputs/apk/"
echo ""
echo "🔧 Para desarrollo local, sigue usando: npm run dev:mobile"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
