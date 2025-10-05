#!/bin/bash

# MINREPORT Testing Strategy Script
# Ejecuta todas las pruebas en el orden correcto para validar el núcleo

echo "🚀 MINREPORT Testing Strategy"
echo "=============================="

# FASE 1: Tests Unitarios (Core)
echo "📦 FASE 1: Core Package Tests"
cd packages/core
echo "Running Core package tests..."
pnpm test

# FASE 2: Tests del SDK  
echo "📦 FASE 2: SDK Package Tests"
cd ../sdk
echo "Running SDK package tests..."
pnpm test

# FASE 3: Tests de Servicios
echo "⚙️ FASE 3: Services Tests"
cd ../../services

for service in functions transactions-service user-management-service account-management-service; do
  if [ -d "$service" ]; then
    echo "Testing $service..."
    cd "$service"
    pnpm test || echo "❌ $service tests failed"
    cd ..
  fi
done

# FASE 4: Tests de Integración (Componentes)
echo "🧩 FASE 4: Component Integration Tests"
cd ../sites

for site in client-app admin-app public-site; do
  if [ -d "$site" ]; then
    echo "Testing $site components..."
    cd "$site"
    pnpm test || echo "❌ $site tests failed"
    cd ..
  fi
done

# FASE 5: E2E Tests (Solo si todo anterior pasa)
echo "🎭 FASE 5: E2E Tests"
cd client-app
echo "Running Playwright E2E tests..."
pnpm test:e2e || echo "❌ E2E tests failed"

echo "✅ Testing strategy completed!"