# SOLUCIÓN PERSISTENCIA - MÉTODO MANUAL FUNCIONAL

## ❌ PROBLEMA CONFIRMADO:
```
Export failed: Failed to make request to http://localhost:8085/emulator/v1/projects/minreport-8f2a8:export
Automatic export to "./firebase-emulators-data" failed
```

## ✅ SOLUCIÓN QUE SÍ FUNCIONA:

### 🚀 Desarrollo:
```bash
pnpm dev:persist
```

### 🔑 Crear super admin:
```bash
source ~/.zshrc
FIREBASE_AUTH_EMULATOR_HOST='localhost:9190' FIRESTORE_EMULATOR_HOST='localhost:8085' node create-super-admin.cjs
```

### 💾 Backup MANUAL (antes de cerrar):
```bash
FIREBASE_AUTH_EMULATOR_HOST='localhost:9190' FIRESTORE_EMULATOR_HOST='localhost:8085' node backup-super-admin.cjs
```

### 🔄 Restaurar (al reiniciar):
```bash
FIREBASE_AUTH_EMULATOR_HOST='localhost:9190' FIRESTORE_EMULATOR_HOST='localhost:8085' node restore-super-admin.cjs
```

## 🎯 CREDENCIALES:
- **Email:** app_dev@minreport.com
- **Password:** password-seguro-local
- **Admin Panel:** http://localhost:5173

## 💡 WORKFLOW:
1. Desarrollo → Crear admin → **Backup manual** → Cerrar
2. Reiniciar → **Restaurar** → Continuar desarrollo