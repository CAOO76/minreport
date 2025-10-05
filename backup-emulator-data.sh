#!/bin/bash
# backup-emulator-data.sh
# Crea una copia de seguridad de los datos de emuladores con timestamp

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="./firebase-emulators-data-backup-$TIMESTAMP"

if [ -d "./firebase-emulators-data" ]; then
  echo "📁 Creando backup de datos de emuladores..."
  cp -r "./firebase-emulators-data" "$BACKUP_DIR"
  echo "✅ Backup creado: $BACKUP_DIR"
  echo "🔒 Datos originales preservados en: ./firebase-emulators-data"
else
  echo "⚠️  No se encontró ./firebase-emulators-data/ para hacer backup"
fi