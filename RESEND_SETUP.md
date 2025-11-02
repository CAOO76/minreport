# 📧 Configuración de Resend para MinReport

## Estado Actual

✅ **Resend está integrado en el código**
- Cloud Function: `validateEmailAndStartProcess` (southamerica-west1)
- Fallback a mock mode si API key no es válida
- Soporte para sandbox (desarrollo) y producción

## 🚀 Pasos para Configurar (2 minutos)

### 1. Crear Cuenta en Resend (si no tienes)
- Ve a: https://resend.com
- Haz clic en "Sign Up"
- Completa email y contraseña
- Verifica tu email

### 2. Obtener API Key
- Una vez logueado, ve a: https://resend.com/api-keys
- Haz clic en "Create API Key"
- Dale un nombre (ej: "MinReport Dev")
- Copia la API key (comienza con `re_`)

### 3. Configurar en MinReport
Abre `/services/functions/.env.local` y reemplaza:

```env
# ANTES (Testing):
RESEND_API_KEY=re_test_1234567890abcdefghijklmnop

# DESPUÉS (Tu API Key Real):
RESEND_API_KEY=re_XXXXXXXXXXXXXXXXXXXXXXX
```

### 4. Reiniciar
```bash
# Mata los procesos:
pkill -9 node

# Reinicia:
cd /Volumes/CODE/MINREPORT\ iMac/minreport
bash ./dev-clean-start.sh
```

## 📬 Probando Resend

1. Ve a: http://localhost:5175/request-access
2. Llena el formulario con:
   - Tipo: Cualquiera
   - Nombre: Tu nombre
   - Email: **Tu email real** (el que usaste en Resend)
3. Envía
4. **Deberías recibir un email en segundos** ⚡

## 🔍 Verificar Envíos

En la consola de Firebase Functions verás:

```
✅ [CLOUD FUNCTION] Email sent successfully!
✅ [CLOUD FUNCTION] Email ID: 123abc...
```

O en Resend dashboard: https://resend.com/emails

## 🛠️ Troubleshooting

### "Email error: Invalid API token"
- ✅ Solución: Usa la API key COMPLETA (incluye todo después de `re_`)

### "Email error: Invalid from address"
- ✅ En testing: Resend requiere `onboarding@resend.dev` como remitente
- ✅ En producción: Configura tu dominio en Resend

### Email no llega
- ✅ Revisa spam/promotions
- ✅ Verifica que usaste el email correcto en el formulario
- ✅ Confirma que la API key es válida en: https://resend.com/api-keys

## 📝 Configuración por Ambiente

**Desarrollo (NODE_ENV=development)**:
- De: `onboarding@resend.dev` (sandbox Resend)
- Para: Tu email de prueba
- Link: `http://localhost:5175/complete-form?token=...`

**Producción (NODE_ENV=production)**:
- De: `noreply@minreport.com` (tu dominio)
- Para: Email del usuario
- Link: `https://minreport.com/complete-form?token=...`

## 🎯 Próximos Pasos

Después de configurar Resend:

1. ✅ Prueba el flujo completo (RequestAccess → Email → CompleteForm)
2. ⏳ Valida datos en Firestore
3. ⏳ Integra webhooks (opcional)

---

**¿Preguntas?** Revisa la documentación de Resend: https://resend.com/docs
