# CREDENCIALES DE SUPER ADMIN - DESARROLLO LOCAL

## 🔐 **CUENTA PERMANENTE DE SUPER ADMIN**

Esta cuenta se crea automáticamente en código y debe existir siempre en el sistema de desarrollo:

- **📧 Email:** `app_dev@minreport.com`
- **🔐 Contraseña:** `password-seguro-local`
- **👑 Rol:** Super Admin (claim: `admin: true`)
- **🌐 URL Acceso:** http://localhost:5177/

## 🚀 **CÓMO CREAR LA CUENTA**

### Opción 1: Script automático (recomendado)
```bash
pnpm create:superadmin
```

### Opción 2: Script de siembra completo
```bash
pnpm db:seed
```

### Opción 3: Manual
```bash
FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190' node create-super-admin.cjs
```

## ⚠️  **IMPORTANTE**

- Esta cuenta SOLO existe en desarrollo local
- Se crea automáticamente en el código fuente
- NO se debe usar en producción
- Los datos se preservan en `firebase-emulators-data/`

## 🔄 **PERSISTENCIA**

Los datos de esta cuenta se guardan automáticamente en:
- `firebase-emulators-data/auth_export/`
- Se mantienen entre reinicios del emulador
- Se exportan automáticamente al cerrar con `Ctrl+C`