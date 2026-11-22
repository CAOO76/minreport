#!/usr/bin/env bash
set -euo pipefail

# Build productivo exclusivo 1º DEV (ACOPIOS + ABASTECIMIENTO) para https://minreport.com y Android fieldtestRelease.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${WEB_DIR}/.." && pwd)"
ROOT_ENV_FILE="${ROOT_DIR}/.env"

BUILD_ANDROID=0
INCLUDE_SUPPLY=0
for arg in "$@"; do
    case "$arg" in
        --android)
            BUILD_ANDROID=1
            ;;
        --with-supply)
            INCLUDE_SUPPLY=1
            ;;
    esac
done

read_env_key_from_file() {
    local key="$1"
    local file="$2"
    if [ ! -f "$file" ]; then
        return 0
    fi
    local line
    line=$(grep -E "^${key}=" "$file" | tail -n 1 || true)
    if [ -z "$line" ]; then
        return 0
    fi
    local val="${line#*=}"
    val="${val%$'\r'}"
    val="${val%\"}"
    val="${val#\"}"
    val="${val%\'}"
    val="${val#\'}"
    printf '%s' "$val"
}

if [ -z "${VITE_FIREBASE_API_KEY:-}" ]; then
    VITE_FIREBASE_API_KEY="$(read_env_key_from_file "VITE_FIREBASE_API_KEY" "${ROOT_ENV_FILE}")"
fi

if [ -z "${VITE_FIREBASE_API_KEY:-}" ] || [ "${VITE_FIREBASE_API_KEY}" = "fake-api-key" ]; then
    echo "[BUILD-PROD-DEV] ERROR: VITE_FIREBASE_API_KEY real requerida (ausente o placeholder)." >&2
    exit 1
fi

export NODE_ENV=production
export VITE_RELEASE_STAGE="${VITE_RELEASE_STAGE:-DEV_PRIVATE}"
if [ "${INCLUDE_SUPPLY}" -eq 1 ]; then
    export VITE_DEV_MODULES="${VITE_DEV_MODULES:-stockpile,supply}"
else
    export VITE_DEV_MODULES="${VITE_DEV_MODULES:-geolapp}"
fi
export VITE_USE_FIREBASE_EMULATOR="false"
export VITE_API_URL="${VITE_API_URL:-https://minreport.com}"
export VITE_CLOUD_API_URL="${VITE_CLOUD_API_URL:-https://minreport.com}"
export VITE_FIREBASE_API_KEY
export VITE_FIREBASE_PROJECT_ID="${VITE_FIREBASE_PROJECT_ID:-minreport-8f2a8}"
export VITE_FIREBASE_AUTH_DOMAIN="${VITE_FIREBASE_AUTH_DOMAIN:-minreport-8f2a8.firebaseapp.com}"
export VITE_FIREBASE_STORAGE_BUCKET="${VITE_FIREBASE_STORAGE_BUCKET:-minreport-8f2a8.firebasestorage.app}"
export VITE_FIREBASE_MESSAGING_SENDER_ID="${VITE_FIREBASE_MESSAGING_SENDER_ID:-493995072778}"
export VITE_FIREBASE_APP_ID="${VITE_FIREBASE_APP_ID:-1:493995072778:web:41a2917f1e81491a7f6ef3}"
unset CAP_SERVER_URL

echo "[BUILD-PROD-DEV] Ejecutando auditorías pre-vuelo (Ley 21.719 + HMI Icons)..."
(cd "${ROOT_DIR}" && npm run audit:privacy && npm run audit:hmi-icons)

cd "${WEB_DIR}"

echo "[BUILD-PROD-DEV] Compilando web/dist (${VITE_RELEASE_STAGE} · modulos=${VITE_DEV_MODULES} · api=${VITE_API_URL})..."
rm -rf "${WEB_DIR}/dist"
npm run build

if grep -REq "fake-api-key" "${WEB_DIR}/dist/assets/" 2>/dev/null; then
    echo "[BUILD-PROD-DEV] ERROR: Se detecto placeholder fake-api-key en dist/assets/." >&2
    exit 1
fi

if ! grep -REq "https://minreport\.com" "${WEB_DIR}/dist/assets/" 2>/dev/null; then
    echo "[BUILD-PROD-DEV] ERROR: No se detecto https://minreport.com en dist/assets/." >&2
    exit 1
fi

echo "[BUILD-PROD-DEV] OK: Bundle web compilado limpio (https://minreport.com, cero fake-api-key)."

if [ "${BUILD_ANDROID}" -eq 1 ]; then
    export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
    if [ -d "/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" ]; then
        export JAVA_HOME="/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
    elif /usr/libexec/java_home -v 17 >/dev/null 2>&1; then
        export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
    else
        export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    fi
    export PATH="${ANDROID_HOME}/platform-tools:${JAVA_HOME}/bin:${PATH}"

    echo "[BUILD-PROD-DEV] Sincronizando Capacitor Android..."
    npx cap sync android

    echo "[BUILD-PROD-DEV] Compilando APK fieldtestRelease..."
    cd "${WEB_DIR}/android"
    ./gradlew assembleFieldtestRelease
    echo "[BUILD-PROD-DEV] Salida APK en: web/android/app/build/outputs/apk/fieldtest/release/"
fi
