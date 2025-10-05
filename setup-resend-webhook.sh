#!/bin/bash

# Script para configurar el webhook de Resend automáticamente
# Esto se ejecutará una vez que el deploy de Firebase termine

RESEND_API_KEY="re_4BXETdT2_65Sj3y21hcvA3WiSVycCgfAr"
WEBHOOK_URL="https://southamerica-west1-minreport-8f2a8.cloudfunctions.net/resendWebhook"

echo "🔧 Configurando webhook de Resend para filtrar emails falsos..."

# Crear webhook usando la API de Resend
curl -X POST "https://api.resend.com/webhooks" \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "'$WEBHOOK_URL'",
    "events": [
      "email.bounced",
      "email.delivered", 
      "email.delivery_delayed",
      "email.complained"
    ]
  }'

echo "✅ Webhook configurado exitosamente!"
echo "🎯 URL del webhook: $WEBHOOK_URL"
echo "📧 Eventos monitoreados:"
echo "   - email.bounced (emails que rebotan = falsos)"
echo "   - email.delivered (emails entregados = válidos)"
echo "   - email.delivery_delayed (retrasados temporalmente)"
echo "   - email.complained (marcados como spam)"