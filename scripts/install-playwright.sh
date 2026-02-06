#!/bin/bash

# Script de instalación de Playwright para MINREPORT E2E Tests
# Este script instala Playwright y sus navegadores

echo "🎭 Instalando Playwright para MINREPORT..."
echo ""

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo "❌ Error: Este script debe ejecutarse desde la raíz del proyecto"
    exit 1
fi

# Instalar Playwright
echo "📦 Instalando @playwright/test..."
npm install --save-dev @playwright/test

if [ $? -ne 0 ]; then
    echo "❌ Error al instalar @playwright/test"
    exit 1
fi

# Instalar navegadores
echo ""
echo "🌐 Instalando navegadores de Playwright..."
npx playwright install

if [ $? -ne 0 ]; then
    echo "❌ Error al instalar navegadores"
    exit 1
fi

# Instalar dependencias del sistema (si es necesario)
echo ""
echo "📚 Instalando dependencias del sistema..."
npx playwright install-deps

echo ""
echo "✅ Instalación completa!"
echo ""
echo "📝 Próximos pasos:"
echo "   1. Asegúrate de que los emuladores de Firebase estén corriendo:"
echo "      firebase emulators:start"
echo ""
echo "   2. Pobla la base de datos con datos de prueba:"
echo "      npm run test:seed"
echo ""
echo "   3. Ejecuta las pruebas E2E:"
echo "      npm run test:e2e"
echo ""
echo "   4. O ejecuta en modo UI interactivo:"
echo "      npm run test:e2e:ui"
echo ""
