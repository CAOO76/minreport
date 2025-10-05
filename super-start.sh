#!/bin/bash

# DESARROLLO DEFINITIVO - Auto-restore de super admin
# Soluciona el problema de Firebase export que falla

echo "🚀 MINREPORT - Desarrollo con super admin auto-restore"

# Limpiar al salir
cleanup() {
    echo "🛑 Cerrando y guardando datos..."
    FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190' FIRESTORE_EMULATOR_HOST='127.0.0.1:8085' node backup-super-admin.cjs 2>/dev/null &
    sleep 2
    pkill -f "firebase emulators" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    echo "🔒 Datos guardados para próxima sesión."
    exit 0
}

trap cleanup SIGINT SIGTERM

# 2. Iniciar todo con persistencia
echo "🔥 Iniciando servicios..."
pnpm dev:persist &

# 3. Esperar y restaurar si es necesario
echo "⏳ Esperando que emuladores estén completamente listos..."
sleep 15

# Verificar que Auth esté disponible
echo "🔍 Verificando conexión a emuladores..."
while ! curl -s http://localhost:9190 >/dev/null 2>&1; do
    echo "⏳ Esperando Auth emulator..."
    sleep 3
done

while ! curl -s http://localhost:8085 >/dev/null 2>&1; do
    echo "⏳ Esperando Firestore emulator..."
    sleep 3
done

echo "✅ Emuladores listos!"

echo "🔑 Configurando super admin..."
if [ -f "./super-admin-backup.json" ]; then
    echo "🔄 Restaurando..."
    FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190' FIRESTORE_EMULATOR_HOST='127.0.0.1:8085' node restore-super-admin.cjs
else
    echo "🆕 Creando nuevo..."
    FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190' FIRESTORE_EMULATOR_HOST='127.0.0.1:8085' node create-super-admin.cjs
fi

echo ""
echo "✅ LISTO! 🌐 http://localhost:5177"
echo "🔑 app_dev@minreport.com / password-seguro-local"
echo "💡 Ctrl+C para cerrar y guardar"

wait