#!/bin/bash

# ============================================================
# 💾 MINREPORT - Backup Automático de Datos Locales
# ============================================================
# 
# Este script hace backup de los datos complejos de 
# desarrollo local para poder recuperarlos si algo falla.
#
# Preserva:
# ✅ firebase-emulators-data/
# ✅ Usuarios guardados
# ✅ Cuentas guardadas
# ✅ Estados de Firestore
# ✅ Autenticación
#
# USO:
#   bash backup-dev-data.sh
# ============================================================

set -e

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  💾 BACKUP DE DATOS DE DESARROLLO LOCAL              ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# ============================================================
# CONFIGURACIÓN
# ============================================================

BACKUP_DIR="backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/dev-data-backup-$TIMESTAMP.tar.gz"
SOURCE_DATA="firebase-emulators-data"

# ============================================================
# CREAR DIRECTORIO DE BACKUPS
# ============================================================

if [ ! -d "$BACKUP_DIR" ]; then
    echo "📁 Creando directorio de backups: $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR"
fi

# ============================================================
# VERIFICAR DATOS DISPONIBLES
# ============================================================

if [ ! -d "$SOURCE_DATA" ]; then
    echo "⚠️  No hay datos locales para respaldar"
    echo "   Ejecuta primero: bash dev-preserve-data.sh"
    echo ""
    exit 1
fi

# ============================================================
# MOSTRAR INFORMACIÓN
# ============================================================

DATA_SIZE=$(du -sh "$SOURCE_DATA" | cut -f1)
FILE_COUNT=$(find "$SOURCE_DATA" -type f | wc -l)

echo "📊 Información del Backup:"
echo "   Tamaño: $DATA_SIZE"
echo "   Archivos: $FILE_COUNT"
echo "   Destino: $BACKUP_FILE"
echo ""

# ============================================================
# CREAR BACKUP
# ============================================================

echo "🔄 Creando backup..."
tar -czf "$BACKUP_FILE" "$SOURCE_DATA" 2>/dev/null

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)

echo "✅ Backup completado"
echo "   Archivo: $(basename "$BACKUP_FILE")"
echo "   Tamaño comprimido: $BACKUP_SIZE"
echo ""

# ============================================================
# LIMPIAR BACKUPS ANTIGUOS
# ============================================================

BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/dev-data-backup-*.tar.gz 2>/dev/null | wc -l)

if [ $BACKUP_COUNT -gt 5 ]; then
    echo "🧹 Limpiando backups antiguos (guardando últimos 5)..."
    ls -t "$BACKUP_DIR"/dev-data-backup-*.tar.gz 2>/dev/null | tail -n +6 | while read f; do
        echo "   Eliminando: $(basename "$f")"
        rm "$f"
    done
fi

# ============================================================
# RESUMEN
# ============================================================

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  ✅ BACKUP COMPLETADO                                ║"
echo "╠═══════════════════════════════════════════════════════╣"
echo "║  📁 Ubicación: $BACKUP_FILE"
echo "║  💾 Tamaño: $BACKUP_SIZE"
echo "║                                                       ║"
echo "║  Para restaurar:                                      ║"
echo "║    tar -xzf $BACKUP_FILE"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# ============================================================
# LISTAR BACKUPS DISPONIBLES
# ============================================================

echo "📋 Backups disponibles:"
ls -lh "$BACKUP_DIR"/dev-data-backup-*.tar.gz 2>/dev/null | awk '{print "   " $9 " (" $5 ")"}'
echo ""
