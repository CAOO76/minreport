#!/bin/bash

echo "🧪 PRUEBA VALIDACIÓN SIMPLIFICADA"
echo "================================="

# Configurar entorno
source ~/.nvm/nvm.sh
nvm use 20

echo "✅ Node version: $(node --version)"

# Ir al directorio de funciones
cd "/Volumes/CODE/MINREPORT iMac/minreport/services/functions"

echo "🔧 Instalando dependencias..."
npm install

echo "🔄 Compilando funciones..."
npm run build

echo "📋 Verificando funciones exportadas..."
cd lib
echo "Archivos .js en lib:"
ls -la *.js

echo ""
echo "🚀 Iniciando emulador de funciones solo..."
cd ..
firebase emulators:start --only functions --import=../../firebase-emulators-data