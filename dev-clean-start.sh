#!/bin/bash

# MinReport - Development Clean Start Script
# Inicia: Firebase Emulators + Proxy + 3 Apps Vite

echo "🚀 MINREPORT - DESARROLLO CON LIMPIEZA AUTOMÁTICA"
echo ""

# Agregar node a PATH
export PATH="/usr/local/bin:$PATH"

# ============================================
# FUNCIÓN DE LIMPIEZA AL SALIR
# ============================================

cleanup() {
    echo ""
    echo "🛑 Deteniendo todas las aplicaciones..."
    
    # Matar procesos
    kill $FIREBASE_PID $PROXY_PID $CLIENT_PID $ADMIN_PID $PUBLIC_PID 2>/dev/null || true
    pkill -f "firebase\|vite\|proxy" 2>/dev/null || true
    
    # Guardar datos
    sleep 2
    FIREBASE_AUTH_EMULATOR_HOST='localhost:9190' FIRESTORE_EMULATOR_HOST='localhost:8085' /usr/local/bin/node create-super-admin.cjs 2>/dev/null || true
    
    echo "✅ Guardado y cerrado"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# ============================================
# LIMPIAR Y PREPARAR
# ============================================

echo "�� Limpiando caché de Firebase Emulator..."
rm -rf ~/.cache/firebase/emulators 2>/dev/null || true
rm -rf firebase-emulators-data 2>/dev/null || true
rm -rf firebase-export-* 2>/dev/null || true

echo "🧹 Limpiando puertos..."
pkill -f "firebase emulators" 2>/dev/null || true
lsof -ti:3001 -ti:4001 -ti:5175 -ti:5177 -ti:5179 -ti:8085 -ti:9190 -ti:9195 -ti:9196 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 2

# Verificar puerto crítico
if lsof -i :8085 >/dev/null 2>&1; then
    echo "⏳ Puerto 8085 aún ocupado. Esperando..."
    sleep 3
fi

echo "✅ Puertos libres"
echo ""

# ============================================
# CARGAR VARIABLES DE ENTORNO
# ============================================

if [ -f "services/functions/.env.local" ]; then
    echo "📦 Cargando variables de entorno..."
    set -a
    source services/functions/.env.local
    set +a
    echo "✅ Variables de entorno cargadas"
    echo ""
fi

# ============================================
# INICIAR FIREBASE EMULATOR
# ============================================

echo "⚡ Iniciando Firebase Emulator Suite..."
export FIREBASE_FUNCTIONS_REGION=southamerica-west1
./node_modules/.bin/firebase emulators:start --only auth,functions,firestore,storage --import=./firebase-emulators-data --export-on-exit 2>&1 &
FIREBASE_PID=$!
sleep 10

# ============================================
# INICIAR PROXY
# ============================================

echo "🔄 Iniciando Proxy de Funciones..."
(cd services/functions && /usr/local/bin/node proxy.js) &
PROXY_PID=$!
sleep 2

# ============================================
# ESPERAR A QUE FIREBASE ESTÉ LISTO
# ============================================

echo "⏳ Esperando a que Firebase esté listo..."
MAX_ATTEMPTS=30
ATTEMPT=0
while ! curl -s http://localhost:9190 >/dev/null 2>&1; do
    ATTEMPT=$((ATTEMPT+1))
    if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
        echo "❌ Firebase no respondió después de ${MAX_ATTEMPTS} intentos"
        exit 1
    fi
    echo "   ⏳ Intento $ATTEMPT/$MAX_ATTEMPTS..."
    sleep 2
done

echo "✅ Firebase Emulator listo"
echo ""

# ============================================
# CONFIGURAR SUPER ADMIN
# ============================================

echo "🔑 Configurando Super Admin..."
FIREBASE_AUTH_EMULATOR_HOST='localhost:9190' FIRESTORE_EMULATOR_HOST='localhost:8085' /usr/local/bin/node create-super-admin.cjs
echo ""

# ============================================
# INICIAR APPS VITE
# ============================================

echo "⚡ Iniciando Apps Vite..."
echo ""

# Client App - Puerto 5175
echo "   🌐 Client App (5175)..."
(cd sites/client-app && pnpm dev --port 5175) &
CLIENT_PID=$!

# Admin App - Puerto 5177
echo "   👤 Admin App (5177)..."
(cd sites/admin-app && pnpm dev --port 5177) &
ADMIN_PID=$!

# Public Site - Puerto 5179
echo "   🌍 Public Site (5179)..."
(cd sites/public-site && pnpm dev --port 5179) &
PUBLIC_PID=$!

echo ""
sleep 12

# ============================================
# MOSTRAR INFORMACIÓN DE INICIO
# ============================================

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  ✅ ¡¡¡ MINREPORT COMPLETAMENTE INICIADO !!! 🚀       ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📱 APLICACIONES:"
echo "  🌐 Client (Solicitud de acceso): http://localhost:5175"
echo "  👤 Admin Dashboard:              http://localhost:5177"
echo "  🌍 Sitio Público:                http://localhost:5179"
echo ""
echo "🔐 CREDENCIALES DE PRUEBA:"
echo "  Email:    app_dev@minreport.com"
echo "  Password: password-seguro-local"
echo ""
echo "🛠️  HERRAMIENTAS:"
echo "  Firebase Emulator UI: http://127.0.0.1:4002"
echo "  Functions Proxy:      http://localhost:3001"
echo "  Emulator Hub:         http://127.0.0.1:4400"
echo ""
echo "⏹️  Presiona Ctrl+C para detener todo"
echo ""

# ============================================
# MANTENER SCRIPTS CORRIENDO
# ============================================

wait
