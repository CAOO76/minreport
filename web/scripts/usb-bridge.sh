#!/usr/bin/env bash
set -euo pipefail

# Puente USB adb reverse para pruebas en dispositivo físico contra servidor Express + emuladores Firebase locales.
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB_BIN="${ANDROID_HOME}/platform-tools/adb"
if [ ! -x "${ADB_BIN}" ]; then
    ADB_BIN="$(command -v adb || true)"
fi

if [ -z "${ADB_BIN}" ]; then
    echo "[ERROR] adb no encontrado en ${ANDROID_HOME}/platform-tools ni en PATH."
    exit 1
fi

SERIALS="$("${ADB_BIN}" devices 2>/dev/null | awk 'NR > 1 && $2 == "device" { print $1 }')"
if [ -z "${SERIALS}" ]; then
    echo "[AVISO] No hay dispositivos o emuladores autorizados en 'adb devices'."
    exit 1
fi

PORTS=(5173 8080 8085 9099 9190 9195 9196 9199 5001)
for SERIAL in ${SERIALS}; do
    for PORT in "${PORTS[@]}"; do
        "${ADB_BIN}" -s "${SERIAL}" reverse "tcp:${PORT}" "tcp:${PORT}" >/dev/null
    done
    echo "[OK] Puente USB adb reverse activo en ${SERIAL} para puertos: ${PORTS[*]}"
done
