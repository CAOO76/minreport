#!/usr/bin/env bash
set -euo pipefail

# Co-desarrollo en vivo: Vite HMR + Android Studio + Samsung Galaxy XCover7 (USB adb reverse)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${WEB_DIR}"

export ANDROID_HOME="$HOME/Library/Android/sdk"
if [ -d "/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" ]; then
    export JAVA_HOME="/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
elif /usr/libexec/java_home -v 17 >/dev/null 2>&1; then
    export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
else
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi
export PATH="$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH:/usr/local/bin"

if [ -d "${WEB_DIR}/node_modules/.bin" ]; then
    export PATH="${WEB_DIR}/node_modules/.bin:$PATH"
fi

echo "[DEV-MOBILE] Preparando entorno Android Studio + Samsung Galaxy XCover7..."

REVERSE_PORTS=(5173 8080 8085 9099 9190 9195 9196 9199 5001)
DEVICE_SERIALS=""

if command -v adb >/dev/null 2>&1; then
    DEVICE_SERIALS="$(adb devices 2>/dev/null | awk 'NR > 1 && $2 == "device" { print $1 }')"
else
    echo "[AVISO] adb no encontrado en $ANDROID_HOME/platform-tools. Verifica la instalacion de Android SDK Platform-Tools."
fi

if [ -n "${DEVICE_SERIALS}" ]; then
    for SERIAL in ${DEVICE_SERIALS}; do
        echo "[DEV-MOBILE] Dispositivo autorizado detectado (${SERIAL}). Configurando tuneles adb reverse..."
        for PORT in "${REVERSE_PORTS[@]}"; do
            adb -s "${SERIAL}" reverse "tcp:${PORT}" "tcp:${PORT}" >/dev/null
        done
        echo "[OK] Tuneles adb reverse activos para puertos: ${REVERSE_PORTS[*]}"
    done
else
    echo "[AVISO] No se detectaron dispositivos autorizados en 'adb devices'."
    echo "[AVISO] Conecta el Samsung Galaxy XCover7 por USB con Depuracion USB activa o inicia un emulador en Android Studio."
    echo "[AVISO] Se sincronizara igualmente CAP_SERVER_URL=http://localhost:5173 antes de abrir Android Studio."
fi

if [ ! -d "${WEB_DIR}/dist" ]; then
    echo "[DEV-MOBILE] Directorio dist/ ausente; ejecutando build inicial para Capacitor..."
    npm run build
fi

echo "[DEV-MOBILE] Sincronizando Capacitor Android con live reload (CAP_SERVER_URL=http://localhost:5173)..."
CAP_SERVER_URL="http://localhost:5173" npx cap sync android

AS_PATH="/Applications/Android Studio.app"
if [ -d "${AS_PATH}" ]; then
    open -a "${AS_PATH}" "${WEB_DIR}/android" &
    echo "[OK] Android Studio abierto sobre ${WEB_DIR}/android"
elif command -v studio.sh >/dev/null 2>&1; then
    studio.sh "${WEB_DIR}/android" &
    echo "[OK] Android Studio abierto (studio.sh)"
elif command -v android-studio >/dev/null 2>&1; then
    android-studio "${WEB_DIR}/android" &
    echo "[OK] Android Studio abierto (android-studio)"
else
    echo "[AVISO] Android Studio no localizado en ${AS_PATH}. Abre manualmente ${WEB_DIR}/android."
fi

echo ""
echo "[DEV-MOBILE] Web App:          http://localhost:5173"
echo "[DEV-MOBILE] GEOLAPP:          http://localhost:5173/geolapp/stockpiles"
echo "[DEV-MOBILE] MINREPORT TEST:   Variante Gradle 'fieldtestDebug' (com.minreport.app.fieldtest.debug)"
echo "[DEV-MOBILE] Web Preview DEV:  http://localhost:5173/?flavor=fieldtest"
echo "[DEV-MOBILE] Portal DEV:       http://localhost:5173/dev"
echo "[DEV-MOBILE] En Android Studio > Build Variants selecciona 'fieldtestDebug' para pruebas DEV exclusivas en Samsung Galaxy XCover7."
echo ""

exec vite --host --clearScreen false
