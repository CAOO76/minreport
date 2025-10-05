#!/bin/bash
# start-persist.sh - Desarrollo con datos que REALMENTE persisten

export PATH="/Users/wortogbase/.nvm/versions/node/v20.19.5/bin:$PATH"

echo "🔧 Configurando entorno Node.js..."
echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"
echo "pnpm version: $(npx pnpm --version)"
echo ""

echo "🚀 Iniciando MINREPORT con PERSISTENCIA REAL..."
echo "   📱 HOME: Puerto 5179"
echo "   👤 CLIENT: Puerto 5173" 
echo "   👨‍💼 ADMIN: Puerto 5177"
echo "   🔥 Firebase Emulators (SIN import/export automático)"
echo ""

echo "🔒 MODO PERSISTENCIA: Los datos se mantienen automáticamente"
echo "   ✅ NO se ejecuta clean:emulators"
echo "   ✅ NO se usa --import/--export que falla"
echo "   ✅ Los emuladores mantienen datos en memoria/disco"
echo ""

npx pnpm dev:persist