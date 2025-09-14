#!/bin/bash

PROJECT_ID="minreport-8f2a8"
REGION="southamerica-west1"

# Services to deploy
REVIEW_SERVICE_NAME="review-request-service"
REVIEW_SERVICE_DIR="./services/review-request-service"

REQUEST_SERVICE_NAME="request-registration-service"
REQUEST_SERVICE_DIR="./services/request-registration-service"

echo "--- Instalando dependencias ---"
pnpm install || { echo "Error en pnpm install"; exit 1; }

echo "--- Construyendo todos los proyectos ---"
pnpm -r build || { echo "Error en pnpm -r build"; exit 1; }

echo "--- Desplegando a Firebase ---"
firebase deploy || { echo "Error en firebase deploy"; exit 1; }

echo "--- Desplegando Cloud Run Service: $REVIEW_SERVICE_NAME ---"
(cd $REVIEW_SERVICE_DIR && \
 gcloud builds submit . \
  --tag $REGION-docker.pkg.dev/$PROJECT_ID/minreport-repo/$REVIEW_SERVICE_NAME \
  --project $PROJECT_ID \
  --timeout=15m \
  --machine-type=e2-highcpu-8) || { echo "Error en gcloud builds submit $REVIEW_SERVICE_NAME"; exit 1; }

gcloud run deploy $REVIEW_SERVICE_NAME \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/minreport-repo/$REVIEW_SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --project $PROJECT_ID || { echo "Error en gcloud run deploy $REVIEW_SERVICE_NAME"; exit 1; }

echo "--- Desplegando Cloud Run Service: $REQUEST_SERVICE_NAME ---"
(cd $REQUEST_SERVICE_DIR && \
 gcloud builds submit . \
  --tag $REGION-docker.pkg.dev/$PROJECT_ID/minreport-repo/$REQUEST_SERVICE_NAME \
  --project $PROJECT_ID \
  --timeout=15m \
  --machine-type=e2-highcpu-8) || { echo "Error en gcloud builds submit $REQUEST_SERVICE_NAME"; exit 1; }

gcloud run deploy $REQUEST_SERVICE_NAME \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/minreport-repo/$REQUEST_SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --project $PROJECT_ID || { echo "Error en gcloud run deploy $REQUEST_SERVICE_NAME"; exit 1; }

echo "--- Despliegue completado ---"