#!/bin/bash
# backup-emulator-data.sh - Fuerza el backup manual de datos de emuladores

echo "🔒 Forzando backup de datos de emuladores..."

# Crear directorio de backup si no existe
mkdir -p "./firebase-emulators-data-backup"

# Hacer backup usando Firebase CLI
firebase emulators:export "./firebase-emulators-data-backup" --force

if [ $? -eq 0 ]; then
    echo "✅ Backup exitoso en ./firebase-emulators-data-backup/"
    # Reemplazar el directorio principal
    rm -rf "./firebase-emulators-data"
    mv "./firebase-emulators-data-backup" "./firebase-emulators-data"
    echo "🔄 Datos actualizados en ./firebase-emulators-data/"
else
    echo "❌ Error en backup"
fi