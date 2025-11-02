#!/bin/bash

# Agregar node a PATH
export PATH="/usr/local/bin:$PATH"
export NODE_PATH="/usr/local/lib/node_modules"

echo "🚀 INICIANDO APPS VITE"

cleanup() {
    echo "🛑 Cerrando apps..."
    pkill -f vite
    exit 0
}

trap cleanup SIGINT SIGTERM

# Iniciar las 3 apps en paralelo
echo "🌐 Iniciando client-app en puerto 5175..."
(cd sites/client-app && /usr/local/bin/node ../../node_modules/.bin/vite --port 5175) &
CLIENT_PID=$!

echo "🌐 Iniciando admin-app en puerto 5177..."
(cd sites/admin-app && /usr/local/bin/node ../../node_modules/.bin/vite --port 5177) &
ADMIN_PID=$!

echo "🌐 Iniciando public-site en puerto 5179..."
(cd sites/public-site && /usr/local/bin/node ../../node_modules/.bin/vite --port 5179) &
PUBLIC_PID=$!

echo "✅ Apps iniciadas!"
echo "  📱 Client:  http://localhost:5175"
echo "  👤 Admin:   http://localhost:5177"
echo "  🌍 Public:  http://localhost:5179"

wait
