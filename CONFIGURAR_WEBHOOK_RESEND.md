# 🔧 CONFIGURACIÓN MANUAL DEL WEBHOOK DE RESEND

## ¡IMPORTANTE! - Configura esto AHORA para que funcione la validación de emails

### PASO 1: Ir al Dashboard de Resend
1. Ve a: **https://resend.com/webhooks**
2. Inicia sesión con tu cuenta de Resend

### PASO 2: Crear Nuevo Webhook
1. Haz clic en **"Add webhook"** o **"Create webhook"**
2. En **"Endpoint URL"** pega exactamente esto:
   ```
   https://southamerica-west1-minreport-8f2a8.cloudfunctions.net/resendWebhook
   ```

### PASO 3: Seleccionar Eventos
Marca **TODAS** estas casillas:
- ✅ **email.bounced** (emails que rebotan - FALSOS)
- ✅ **email.delivered** (emails entregados - VÁLIDOS)  
- ✅ **email.delivery_delayed** (retrasados temporalmente)
- ✅ **email.complained** (marcados como spam)

### PASO 4: Configuración Adicional
- **Name**: `MINREPORT Email Validation`
- **Description**: `Webhook para validar emails automáticamente`
- **Active**: ✅ Activado

### PASO 5: Guardar
1. Haz clic en **"Create webhook"** o **"Save"**
2. ¡Listo! El webhook está configurado

## 🎯 ¿Qué hace esto?

### Cuando un email rebota (falso):
- `pluto@cabiseg.com` → Se envía pero rebota después
- Webhook recibe `email.bounced` 
- Automáticamente marca la solicitud como `email_invalid`
- El usuario es rechazado automáticamente

### Cuando un email llega (válido):
- `info@cabiseg.com` → Se envía y llega correctamente
- Webhook recibe `email.delivered`
- Marca la solicitud como `email_valid`
- El proceso continúa normalmente

## ✅ VERIFICAR QUE FUNCIONA

Después de configurar, prueba con:
1. Un email válido: `test@gmail.com`
2. Un email falso: `noexiste@gmail.com`

El sistema detectará automáticamente cuáles son reales y cuáles falsos.

---

**⚠️ SIN ESTE WEBHOOK, LOS EMAILS FALSOS NO SE DETECTAN AUTOMÁTICAMENTE**