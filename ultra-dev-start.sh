#!/bin/bash

#############################################
# MinReport - Desarrollo Unificado
# 
# Script único para desarrollo local
# Maneja todos los casos: normal, fresh, prod
#############################################

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Variables
MODE="${1:-normal}"
PORT="${PORT:-5173}"
FIREBASE_PROJECT="minreport-8f2a8"
SUPER_ADMIN_EMAIL="app_dev@minreport.com"
SUPER_ADMIN_PASSWORD="password-seguro-local"

# Funciones
print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_step() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

cleanup() {
    echo -e "\n${YELLOW}💾 Guardando estado...${NC}"
    
    # Guardar datos de Firebase emulators
    if command -v firebase &> /dev/null; then
        FIREBASE_AUTH_EMULATOR_HOST='localhost:9190' \
        FIRESTORE_EMULATOR_HOST='localhost:8085' \
        firebase emulators:export ./firebase-emulators-data --force 2>/dev/null || true
    fi
    
    # Matar procesos
    pkill -f "firebase\|vite\|pnpm\|node" 2>/dev/null || true
    
    echo -e "${GREEN}✓${NC} Estado guardado"
    exit 0
}

# Configurar trap para cleanup
trap cleanup SIGINT SIGTERM

print_header "🚀 MinReport - Desarrollo Unificado"
echo -e "Modo: ${BLUE}$MODE${NC}"
echo ""

# ============================================
# MODO: Limpieza
# ============================================
if [ "$MODE" = "fresh" ]; then
    print_header "🗑️  Limpiando datos previos"
    
    print_warning "Esto eliminará todos los datos locales"
    read -p "¿Estás seguro? (si/no): " CONFIRM
    
    if [ "$CONFIRM" = "si" ]; then
        print_step "Eliminando firebase-emulators-data..."
        rm -rf ./firebase-emulators-data
        print_step "Eliminando persistent-data.json..."
        rm -f ./persistent-data.json
        print_step "Limpieza completada"
    else
        print_warning "Limpieza cancelada"
    fi
    echo ""
fi

# ============================================
# MODO: Producción Simulada
# ============================================
if [ "$MODE" = "prod" ]; then
    print_header "🏭 Modo Producción Simulado"
    export NODE_ENV=production
    export VITE_MODE=production
    print_step "NODE_ENV=production"
    echo ""
fi

# ============================================
# 1. Verificar dependencias
# ============================================
print_header "📦 Verificando dependencias"

if ! command -v node &> /dev/null; then
    print_error "Node.js no está instalado"
    exit 1
fi
print_step "Node.js $(node --version)"

if ! command -v pnpm &> /dev/null; then
    print_error "pnpm no está instalado"
    exit 1
fi
print_step "pnpm $(pnpm --version)"

if ! command -v firebase &> /dev/null; then
    print_warning "Firebase CLI no está instalado, intentando con npx..."
    FIREBASE_CMD="npx firebase"
else
    FIREBASE_CMD="firebase"
    print_step "Firebase CLI $(firebase --version)"
fi

echo ""

# ============================================
# 2. Instalar dependencias si es necesario
# ============================================
if [ ! -d "node_modules" ]; then
    print_header "📥 Instalando dependencias"
    pnpm install
    echo ""
fi

# ============================================
# 3. Iniciar Firebase Emulators
# ============================================
print_header "🔥 Iniciando Firebase Emulators"

# Obtener puertos del firebase.json
EMULATORS_RUNNING=0
for port in 9190 8085 9196 9195; do
    if nc -z localhost $port 2>/dev/null; then
        EMULATORS_RUNNING=$((EMULATORS_RUNNING + 1))
    fi
done

if [ $EMULATORS_RUNNING -eq 0 ]; then
    print_step "Iniciando emuladores..."
    
    # Exportar variables de entorno para emuladores
    export FIREBASE_AUTH_EMULATOR_HOST='localhost:9190'
    export FIRESTORE_EMULATOR_HOST='localhost:8085'
    
    $FIREBASE_CMD emulators:start \
        --only auth,firestore,functions,storage,hosting \
        --import=./firebase-emulators-data \
        --export-on-exit \
        > /tmp/firebase-emulators.log 2>&1 &
    
    FIREBASE_PID=$!
    print_step "Emuladores iniciados (PID: $FIREBASE_PID)"
    
    # Esperar a que los emuladores estén listos
    print_warning "Esperando emuladores..."
    for i in {1..30}; do
        if curl -s http://localhost:9190 >/dev/null 2>&1; then
            print_step "Emuladores listos"
            break
        fi
        sleep 1
    done
else
    print_warning "Emuladores ya están ejecutándose"
fi

echo ""

# ============================================
# 4. Crear Super Admin si es necesario
# ============================================
print_header "🔑 Verificando Super Admin"

export FIREBASE_AUTH_EMULATOR_HOST='localhost:9190'
export FIRESTORE_EMULATOR_HOST='localhost:8085'

if [ -f "./create-super-admin.cjs" ]; then
    print_step "Creando Super Admin..."
    node ./create-super-admin.cjs 2>/dev/null || true
else
    print_warning "create-super-admin.cjs no encontrado"
fi

echo ""

# ============================================
# 5. Iniciar aplicaciones
# ============================================
print_header "🌐 Iniciando aplicaciones"

echo -e "${BLUE}Puertos:${NC}"
echo "  • Client App:    http://localhost:5173"
echo "  • Admin App:     http://localhost:5177"
echo "  • Public Site:   http://localhost:5179"
echo "  • Firebase UI:   http://localhost:4002"
echo ""

echo -e "${BLUE}Credenciales (Desarrollo):${NC}"
echo "  • Email:    $SUPER_ADMIN_EMAIL"
echo "  • Password: $SUPER_ADMIN_PASSWORD"
echo ""

print_step "Iniciando Dev Server..."

# Ejecutar con pnpm
pnpm dev:all

# Si llegamos aquí, esperar
wait
