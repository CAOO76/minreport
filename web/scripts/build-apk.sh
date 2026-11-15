#!/usr/bin/env bash
set -euo pipefail

# Build limpio de APK Android (MINREPORT · GEOLAPP) bajo Secure Context HTTPS.
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
export PATH="$HOME/Library/Android/sdk/platform-tools:$JAVA_HOME/bin:$PATH"

# Garantiza que capacitor.config.ts cargue el bundle local dist/ (https, cleartext: false)
unset CAP_SERVER_URL

echo "[BUILD-APK] Compilando bundle web MINREPORT · GEOLAPP..."
npm run build

echo "[BUILD-APK] Sincronizando proyecto Android Capacitor (sin sobrescribir capacitor.config.ts)..."
npx cap sync android

echo ""
echo "[OK] Proyecto Android sincronizado en modo standalone HTTPS (cleartext: false)."
echo "[INFO] Siguiente paso en Android Studio:"
echo "       1. Build -> Generate Signed Bundle / APK"
echo "       2. Seleccionar APK (release o debug)"
echo "       3. Salida esperada en: android/app/build/outputs/apk/"
