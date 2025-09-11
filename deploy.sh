#!/bin/bash

echo "--- Instalando dependencias ---"
pnpm install || { echo "Error en pnpm install"; exit 1; }

echo "--- Construyendo todos los proyectos ---"
pnpm -r build || { echo "Error en pnpm -r build"; exit 1; }

echo "--- Desplegando a Firebase ---"
firebase deploy || { echo "Error en firebase deploy"; exit 1; }

echo "--- Despliegue completado ---"
