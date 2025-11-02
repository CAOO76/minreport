#!/bin/bash

# ============================================================
# 🛡️  MINREPORT - DESARROLLO CON PRESERVACIÓN DE DATOS
# ============================================================
# 
# Este script inicia MINREPORT SIN borrar ninguna base de datos
# local de desarrollo. Todos los datos de usuarios, cuentas,
# y configuraciones persistentes se mantienen intactos.
#
# SEGURO PARA:
# ✅ Usuarios guardados
# ✅ Cuentas guardadas
# ✅ Datos complejos de desarrollo
# ✅ Super admin guardado
# ✅ Estados de Firestore/Auth
#
# USO:
#   bash dev-preserve-data.sh
# ============================================================

export PATH="/usr/local/bin:$PATH"

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  🛡️  MINREPORT - MODO PRESERVACIÓN DE DATOS          ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
echo "📌 ADVERTENCIA: Este script PRESERVA todos los datos locales"
echo "   ✅ NO borra firebase-emulators-data"
echo "   ✅ NO limpia ~/.cache/firebase/emulators"
echo "   ✅ NO limpia usuarios ni cuentas"
echo "   ✅ Mantiene datos complejos intactos"
echo ""

# ============================================================
# FUNCIÓN DE LIMPIEZA AL SALIR (SIN borrar datos)
# ============================================================

cleanup() {
    echo ""
    echo "🛑 Deteniendo aplicaciones..."
    
    # Matar procesos
    kill $FIREBASE_PID $CLIENT_PID $ADMIN_PID $PUBLIC_PID 2>/dev/null || true
    pkill -f "firebase emulators|vite" 2>/dev/null || true
    
    echo "✅ Cerrado correctamente. Datos preservados en:"
    echo "   📁 ./firebase-emulators-data/"
    echo ""
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# ============================================================
# VERIFICAR PUERTOS (sin limpiar datos)
# ============================================================

echo "🔍 Verificando puertos..."

# Función para verificar y liberar puerto
check_port() {
    local port=$1
    local name=$2
    
    if lsof -i :$port >/dev/null 2>&1; then
        echo "⚠️  Puerto $port ($name) está en uso"
        echo "   💡 Matando procesos en puerto $port..."
        lsof -ti:$port 2>/dev/null | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

# Verificar puertos sin afectar datos
check_port 5179 "HOME"
check_port 5173 "CLIENT"
check_port 5177 "ADMIN"
check_port 5175 "PUBLIC"
check_port 8085 "Firestore"
check_port 9190 "Auth"
check_port 9195 "Storage"
check_port 9196 "Hub"
check_port 4001 "Proxy"

echo "✅ Puertos libres"
echo ""

# ============================================================
# VERIFICAR FIREBASE-EMULATORS-DATA
# ============================================================

if [ -d "./firebase-emulators-data" ]; then
    echo "✅ Datos locales encontrados:"
    echo "   📊 $(du -sh ./firebase-emulators-data | cut -f1) de datos guardados"
    echo ""
else
    echo "⚠️  No hay datos previos guardados"
    echo "   Los emuladores crearán una base limpia..."
    echo ""
fi

# ============================================================
# INICIAR FIREBASE EMULATORS (importando datos existentes)
# ============================================================

echo "🔥 Iniciando Firebase Emulators (con datos existentes)..."
echo ""

cd "$(dirname "$0")" || exit

# Iniciar emuladores con import/export para persistencia
firebase emulators:start \
    --only auth,functions,firestore,storage \
    --import=./firebase-emulators-data \
    --export-on-exit \
    --project=minreport-dev &
FIREBASE_PID=$!

sleep 5

# ============================================================
# INICIAR APLICACIONES VITE
# ============================================================

echo ""
echo "🎨 Iniciando aplicaciones Vite..."
echo ""

# CLIENT APP (5173)
pnpm dev:client &
CLIENT_PID=$!
echo "   ✅ CLIENT en http://localhost:5173"

# ADMIN APP (5177)
pnpm dev:admin &
ADMIN_PID=$!
echo "   ✅ ADMIN en http://localhost:5177"

# PUBLIC SITE (5175)
pnpm dev:public &
PUBLIC_PID=$!
echo "   ✅ PUBLIC en http://localhost:5175"

# ============================================================
# INFORMACIÓN DE ACCESO
# ============================================================

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  🚀 MINREPORT EN EJECUCIÓN                           ║"
echo "╠═══════════════════════════════════════════════════════╣"
echo "║  📱 CLIENT: http://localhost:5173                    ║"
echo "║  👨‍💼 ADMIN:  http://localhost:5177                    ║"
echo "║  🌐 PUBLIC: http://localhost:5175                    ║"
echo "║                                                       ║"
echo "║  🔥 Firebase Emulators:                              ║"
echo "║     • Firestore: localhost:8085                      ║"
echo "║     • Auth:      localhost:9190                      ║"
echo "║     • Storage:   localhost:9195                      ║"
echo "║     • Hub:       localhost:4000 (UI)                 ║"
echo "║                                                       ║"
echo "║  💾 DATOS: ./firebase-emulators-data/                ║"
echo "║     Se guardan automáticamente al salir              ║"
echo "║                                                       ║"
echo "║  ⏹️  Presiona CTRL+C para detener                     ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# ============================================================
# MANTENER PROCESO ACTIVO
# ============================================================

wait $FIREBASE_PID
