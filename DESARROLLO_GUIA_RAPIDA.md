# MINREPORT - Guía de Inicio Rápido para Desarrollo

## ✅ Proceso Probado que FUNCIONA:

### 1. Iniciar Sistema:
```bash
pnpm dev:safe
```

### 2. Crear Super Admin (en terminal separada):
```bash
cd "/Volumes/CODE/MINREPORT iMac/minreport" && FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190' FIRESTORE_EMULATOR_HOST='127.0.0.1:8085' /Users/wortogbase/.nvm/versions/node/v20.19.5/bin/node create-super-admin.cjs
```

### 3. Credenciales Super Admin:
- **Email**: app_dev@minreport.com
- **Password**: password-seguro-local

### 4. URLs del Sistema:
- **CLIENT**: http://localhost:5173/
- **ADMIN**: http://localhost:5177/
- **HOME**: http://localhost:5179/

## 🔧 Solución a Procesos Zombi:

Si `pnpm dev:safe` falla con "port taken":
```bash
lsof -i :8085 -i :9190 -i :9099
kill -9 [PID_DEL_PROCESO_JAVA]
```

## 💾 Preservación de Datos:

- `pnpm dev:safe` usa `clean:emulators` que preserva `./firebase-emulators-data/`
- Los datos se reimportan automáticamente
- El super admin se debe crear manualmente después del inicio

## 🚀 Para desarrollo diario:

1. `pnpm dev:safe`
2. Esperar que inicie completamente
3. Crear super admin si no existe
4. ¡Listo para desarrollar!