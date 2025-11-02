# 🛡️ MINREPORT - Estrategia de Desarrollo con Preservación de Datos

## 📌 Principio Fundamental

**Los datos complejos de desarrollo local NUNCA se deben perder.**

Esta estrategia garantiza que usuarios, cuentas y datos complejos necesarios para construir MINREPORT progresivamente se preservan entre sesiones de desarrollo.

---

## 🎯 Objetivos

✅ Preservar datos complejos entre sesiones  
✅ Construir features progresivamente sin perder contexto  
✅ Facilitar testing con datos reales  
✅ Backup automático de cambios importantes  
✅ Recuperación rápida en caso de errores  

---

## 🚀 Quick Start

### Inicio rápido (recomendado)
```bash
# ✅ SEGURO - Preserva TODOS los datos
bash dev-preserve-data.sh

# Resultado:
# 📱 CLIENT en http://localhost:5173
# 👨‍💼 ADMIN en http://localhost:5177
# 🌐 PUBLIC en http://localhost:5175
# 🔥 Firebase Emulators corriendo
```

### Backup preventivo
```bash
# Hazlo antes de cambios importantes
bash backup-dev-data.sh

# Se guarda en: backups/dev-data-backup-TIMESTAMP.tar.gz
```

---

## 📋 Scripts de Desarrollo

### ✅ USAR (Preservan datos)

```bash
# Opción 1: Script seguro (RECOMENDADO)
bash dev-preserve-data.sh

# Opción 2: Comando pnpm alternativo
pnpm dev:persist

# Opción 3: Dev default (si pre-dev.sh no limpia)
pnpm dev
```

### ❌ EVITAR (Borran datos)

```bash
❌ pnpm dev:clean          # Borra firebase-emulators-data
❌ pnpm dev:safe          # Limpia primero
❌ pnpm dev:full          # Limpia todo
❌ bash dev-clean-start.sh # Borra TODOS los datos
```

---

## 🛠️ Workflow Diario

### Inicio de sesión
```bash
# Ejecuta SIEMPRE
bash dev-preserve-data.sh

# ✅ Verifica que dice "Datos locales encontrados"
# ✅ Viste usuarios/cuentas de sesiones anteriores
```

### Durante desarrollo
- Edita código normalmente
- Hot-reload funciona
- Datos se mantienen en Firebase Emulators
- Puedes crear usuarios, cuentas, reportes

### Cierre de sesión
```bash
# SIEMPRE presiona:
CTRL+C

# Resultado:
# ✅ Firebase exporta datos automáticamente
# ✅ Datos guardados en firebase-emulators-data/
# ✅ Listos para próxima sesión
```

---

## 📁 Estructura de Datos

```
firebase-emulators-data/
├── firestore_export/
│   ├── accounts/           ← Cuentas guardadas
│   ├── users/              ← Usuarios guardados
│   ├── reports/            ← Reportes creados
│   ├── subscriptions/      ← Suscripciones
│   └── ...
├── auth_export/            ← Auth data (contraseñas hash, etc)
└── firebase-export-metadata.json
```

**✅ Se preservan entre sesiones**  
**❌ NUNCA borres manualmente**  

---

## 💾 Backup y Recuperación

### Backup automático
```bash
# Antes de cambios importantes
bash backup-dev-data.sh

# Se guarda en: backups/dev-data-backup-YYYYMMDD_HHMMSS.tar.gz
# Se guardan últimos 5 backups automáticamente
```

### Restaurar desde backup
```bash
# Si necesitas rollback
tar -xzf backups/dev-data-backup-YYYYMMDD_HHMMSS.tar.gz

# Luego:
bash dev-preserve-data.sh
```

---

## 🆘 Troubleshooting

### "¿Se perdieron datos?"
```bash
# 1. Revisa la carpeta
ls -la firebase-emulators-data/

# 2. Busca backups
ls -lh backups/

# 3. Si ejecutaste dev:clean:
git status
# Puedes recuperar desde git
```

### "Puerto ocupado"
```bash
# NO limpies datos, solo mata el proceso
lsof -ti:8085 | xargs kill -9

# Luego reinicia
bash dev-preserve-data.sh
```

### "Firebase no inicia"
```bash
# Verifica que hay espacio y permisos
du -sh firebase-emulators-data/

# Si tiene >500MB, considera backup e inicio limpio
bash backup-dev-data.sh
# Y luego comunica para limpieza controlada
```

---

## ⚠️ Importante

### Nunca hagas esto
```bash
❌ rm -rf firebase-emulators-data
❌ rm -rf ~/.cache/firebase/emulators
❌ pnpm run clean
❌ bash dev-clean-start.sh
```

### Siempre haz esto
```bash
✅ bash dev-preserve-data.sh
✅ Presiona CTRL+C para salir
✅ Revisa que datos se actualizaron: ls -lh firebase-export-*
✅ Commit cambios de código en git
```

---

## 📊 Monitoreo

### Ver tamaño de datos
```bash
du -sh firebase-emulators-data/
# Typical: 10-50MB para desarrollo activo
```

### Ver última exportación
```bash
ls -lh firebase-export-*
# Debe mostrar timestamp reciente
```

### Ver backups disponibles
```bash
ls -lh backups/
# Lista de backups para recuperación
```

---

## 🎓 Ejemplo Realista

### Semana 1: Setup Base
```bash
# Lunes
bash dev-preserve-data.sh
# Crear cuentas de prueba
# Crear usuarios de prueba
# CTRL+C → Datos guardados ✅

# Martes
bash dev-preserve-data.sh  # Datos de ayer aquí ✅
# Agregar reportes
# Probar funcionalidades
# CTRL+C → Datos guardados ✅

# Miércoles
bash dev-preserve-data.sh  # Datos acumulados ✅
# Agregar suscripciones
# CTRL+C → Datos guardados ✅
```

### Semana 2: Desarrollo Progressive
```bash
# Lunes siguiente
bash dev-preserve-data.sh  # Todos los datos de semana 1 ✅
# Construir features nuevas
# Usa usuarios/cuentas existentes para testing

# Durante la semana:
bash backup-dev-data.sh  # Backup antes de cambios importantes
# Continuación de features
```

---

## 🔐 Protección Extra

Para máxima seguridad en desarrollo:

```bash
# Cada viernes
bash backup-dev-data.sh

# Resultado: backups/dev-data-backup-YYYY0101_170000.tar.gz
# Guardado en git: git add backups/ && git commit -m "weekly backup"
```

---

## 📞 Resumen Ejecutivo

| Aspecto | Recomendación |
|--------|---|
| Script a usar | `bash dev-preserve-data.sh` |
| Frecuencia | Al iniciar cada sesión |
| Al cerrar | Presiona CTRL+C (no mata procesos) |
| Backup | `bash backup-dev-data.sh` antes de cambios importantes |
| Recuperación | `tar -xzf backups/dev-data-backup-XXX.tar.gz` |
| Puertos | Nunca limpies datos para liberar puerto |
| Git | Haz commit del código, los datos se preservan en firebase-emulators-data/ |

---

## ✅ Checklist Pre-Cierre de Sesión

Antes de cerrar VS Code:

- [ ] Estoy usando `bash dev-preserve-data.sh` (no otro script)
- [ ] Trabajé al menos 1 hora
- [ ] Presionaré CTRL+C para salir (no mata procesos)
- [ ] Datos están en `firebase-emulators-data/`
- [ ] Cambios de código en git están committeados
- [ ] Timestamp en `firebase-export-*` es reciente

✅ Listo para próxima sesión

---

## 🎯 Conclusión

Con esta estrategia:
- ✅ **Nunca pierdes datos complejos**
- ✅ **Construyes progresivamente**
- ✅ **Tienes backups de seguridad**
- ✅ **Recuperación rápida si algo falla**
- ✅ **Desarrollo sin interrupciones**

**Desarrolla con confianza. Tus datos están seguros.** 🛡️

