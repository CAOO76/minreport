#!/bin/bash

# MINREPORT - Script de Limpieza y Optimización

echo "🧹 Iniciando limpieza y optimización de MINREPORT..."

# Función para imprimir con colores
print_status() {
    echo -e "\033[1;32m✅ $1\033[0m"
}

print_warning() {
    echo -e "\033[1;33m⚠️  $1\033[0m"
}

print_error() {
    echo -e "\033[1;31m❌ $1\033[0m"
}

# 1. Limpiar directorios build
echo "🗑️  Limpiando directorios de build..."
find . -name "lib" -type d -not -path "./node_modules/*" -exec rm -rf {} + 2>/dev/null || true
find . -name "dist" -type d -not -path "./node_modules/*" -exec rm -rf {} + 2>/dev/null || true
print_status "Directorios de build limpiados"

# 2. Limpiar archivos temporales
echo "🗑️  Limpiando archivos temporales..."
find . -name "*.tsbuildinfo" -not -path "./node_modules/*" -delete 2>/dev/null || true
find . -name ".DS_Store" -delete 2>/dev/null || true
print_status "Archivos temporales eliminados"

# 3. Limpiar exports de Firebase antiguos
echo "🗑️  Limpiando exports de Firebase antiguos..."
firebase_exports=$(ls -d firebase-export-* 2>/dev/null | wc -l)
if [ "$firebase_exports" -gt 5 ]; then
    ls -dt firebase-export-* | tail -n +6 | xargs rm -rf
    print_status "Exports antiguos de Firebase eliminados (mantenidos los 5 más recientes)"
else
    print_status "No hay exports antiguos de Firebase para limpiar"
fi

# 4. Verificar dependencias no utilizadas
echo "🔍 Buscando imports no utilizados..."
if command -v npx >/dev/null 2>&1; then
    echo "Ejecutar manualmente: npx depcheck para verificar dependencias no utilizadas"
else
    print_warning "npx no disponible, saltar verificación de dependencias"
fi

# 5. Verificar problemas de TypeScript
echo "🔍 Verificando problemas de TypeScript..."
if [ -f "tsconfig.json" ]; then
    # Solo verificar sin emitir archivos
    if tsc --noEmit --skipLibCheck; then
        print_status "No hay errores de TypeScript"
    else
        print_error "Errores de TypeScript encontrados"
    fi
else
    print_warning "No se encontró tsconfig.json en el directorio raíz"
fi

# 6. Reinstalar dependencias limpias
echo "📦 Reinstalando dependencias..."
rm -rf node_modules
rm -f pnpm-lock.yaml
if pnpm install; then
    print_status "Dependencias reinstaladas correctamente"
else
    print_error "Error al reinstalar dependencias"
    exit 1
fi

# 7. Build final
echo "🏗️  Ejecutando build final..."
if pnpm -r build; then
    print_status "Build completado exitosamente"
else
    print_error "Errores en el build"
    exit 1
fi

echo ""
echo "🎉 ¡Limpieza y optimización completadas!"
echo "📊 Resumen:"
echo "   ✅ Directorios de build limpiados"
echo "   ✅ Archivos temporales eliminados"
echo "   ✅ Exports antiguos de Firebase limpiados"
echo "   ✅ Dependencias reinstaladas"
echo "   ✅ Build verificado"
echo ""
echo "🚀 El proyecto está listo para desarrollo optimizado!"