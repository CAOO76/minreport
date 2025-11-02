# 🛡️ GUÍA: Preservación de Datos Locales de Desarrollo

## ⚠️ IMPORTANTE

**NUNCA uses scripts que LIMPIEN datos locales de Firebase Emulators cuando trabajas con datos complejos en desarrollo.**

Este documento establece las reglas para preservar:
- ✅ Usuarios guardados
- ✅ Cuentas guardadas  
- ✅ Datos complejos necesarios para construir MINREPORT
- ✅ Estados de Firestore
- ✅ Autenticación

---

## 📋 Scripts de Desarrollo

### ❌ EVITAR (Estos borran datos)

| Script | Efecto | Usar si |
|--------|--------|---------|
| `pnpm dev:clean` | Borra `firebase-emulators-data` | Necesitas empezar de cero (RARO) |
| `pnpm dev:safe` | Ejecuta `clean:emulators` primero | Testing limpio (RARO) |
| `pnpm dev:full` | Limpia todo | Setup inicial en CI/CD |
| `bash dev-clean-start.sh` | Limpia TODOS los datos | NUNCA en desarrollo activo |

### ✅ USAR (Estos preservan datos)

| Script | Efecto | Cuándo usar |
|--------|--------|------------|
| `bash dev-preserve-data.sh` | **PRESERVA todo** | 🟢 USO DIARIO RECOMENDADO |
| `pnpm dev:persist` | Importa y exporta datos | ✅ Alternativa principal |
| `pnpm dev` | Usa pre-dev.sh + emulators | ✅ Bueno si pre-dev no limpia |

---

## 🚀 Flujo Recomendado

### 1️⃣ Inicio del día
```bash
# ✅ SEGURO - Preserva todos los datos
bash dev-preserve-data.sh
```

**Resultado:**
- ✅ Datos previos cargados
- ✅ Firebase Emulators iniciado
- ✅ 3 apps Vite corriendo
- ✅ Listo para desarrollar

### 2️⃣ Durante el desarrollo
- Edita código normalmente
- Los cambios se reciben en hot-reload
- Los datos se mantienen en Firebase Emulators en memoria

### 3️⃣ Al salir (CTRL+C)
- Firebase exporta datos: `firebase-emulators-data/`
- Los datos se preservan para el próximo inicio
- ✅ Todo listo para mañana

---

## 📁 Estructura de Datos Preservados

```
firebase-emulators-data/
├── firebase-export-metadata.json     # Metadata de exportación
├── firestore_export/
│   ├── all_namespaces/
│   │   ├── accounts/                 # Cuentas guardadas
│   │   ├── users/                    # Usuarios guardados
│   │   ├── reports/                  # Reportes creados
│   │   ├── subscriptions/            # Suscripciones
│   │   └── ...
│   └── firestore_export_metadata
└── auth_export/
    ├── accounts.json                 # Auth data
    └── metadata.json
```

**NUNCA borres esta carpeta manualmente a menos que sepas exactamente por qué.**

---

## 🎯 Flujo de Trabajo Típico

### Sesión 1 (Jueves)
```bash
bash dev-preserve-data.sh
# Trabajar toda la sesión
# Al salir: CTRL+C → datos guardados
```

### Sesión 2 (Viernes)
```bash
bash dev-preserve-data.sh
# ✅ Datos de ayer están aquí
# Continuar construyendo con usuarios/cuentas anteriores
```

### Sesión 3 (Lunes)
```bash
bash dev-preserve-data.sh
# ✅ Todos los datos de la semana anterior disponibles
# Puedes crear reportes usando las cuentas ya creadas
```

---

## 🆘 Recuperación de Errores

### Si accidentalmente ejecutaste `dev:clean`
```bash
# ⚠️ Los datos se perdieron
# Solución:
# 1. Git tiene backup del proyecto
# 2. Si hay exportaciones antiguas:
ls -la firebase-export-*

# 3. Usa git restore si es necesario
git status
```

### Si el puerto está ocupado pero NO quieres limpiar datos
```bash
# Mata solo el proceso, no los datos:
lsof -ti:8085 | xargs kill -9

# Luego reinicia:
bash dev-preserve-data.sh
```

### Si necesitas limpiar solo un puerto específico
```bash
# Firebase Firestore (8085)
lsof -ti:8085 | xargs kill -9

# No borres firebase-emulators-data, solo mata el proceso
```

---

## 📊 Monitoreo de Datos

### Ver tamaño actual
```bash
du -sh firebase-emulators-data/
# Ejemplo: 24M de datos
```

### Ver últimos cambios
```bash
ls -lh firebase-export-*
# Muestra cuándo fue la última exportación
```

### Verificar qué datos existen
```bash
# En Firestore Emulator UI (http://localhost:4000)
# O via script Firebase CLI
```

---

## ✅ Checklist Diario

Antes de cerrar VS Code:

- [ ] Ejecutaste `bash dev-preserve-data.sh` (no otros scripts)
- [ ] Trabajaste al menos una sesión de desarrollo
- [ ] Presionaste CTRL+C para salir (no mataste procesos)
- [ ] Verificaste que `firebase-emulators-data/` se actualizó:
  ```bash
  ls -lh firebase-export-*
  # Debe mostrar un timestamp reciente
  ```
- [ ] Hiciste commit en git de tus cambios de código
- [ ] Los datos complejos de desarrollo se preservaron ✅

---

## 🔒 Protección de Datos

### NO HAGAS
```bash
❌ rm -rf firebase-emulators-data
❌ pnpm clean:emulators
❌ pnpm dev:clean
❌ bash dev-clean-start.sh
```

### SÍ HAZ
```bash
✅ bash dev-preserve-data.sh
✅ pnpm dev:persist
✅ CTRL+C para salir limpiamente
```

---

## 🎓 Ejemplo de Workflow Completo

### Día 1: Crear estructura base
```bash
bash dev-preserve-data.sh

# Crear cuentas de prueba
# Crear usuarios de prueba
# Generar datos complejos

# Al salir: CTRL+C
# ✅ Datos guardados
```

### Día 2: Construir features
```bash
bash dev-preserve-data.sh
# ✅ Usuarios y cuentas de ayer están aquí

# Crear reportes usando cuentas previas
# Agregar suscripciones
# Probar flujos complejos

# Al salir: CTRL+C
# ✅ Todo guardado
```

### Día 3: Testing
```bash
bash dev-preserve-data.sh
# ✅ Base de datos con datos reales

# Correr tests
# Verificar integraciones
# Probar offline sync

# Al salir: CTRL+C
```

---

## 📞 Soporte

Si tienes dudas sobre preservación de datos:

1. **¿Se perdieron datos?**
   - Revisa `firebase-emulators-data/`
   - Busca backups en git history
   - Usa `git reflog` para recuperar commits

2. **¿Script no preserva datos?**
   - Verifica: `ls -la firebase-emulators-data/`
   - Usa `bash dev-preserve-data.sh` explícitamente

3. **¿Necesito limpiar datos?**
   - Solo si realmente necesitas empezar de cero
   - Comunícalo en la sesión
   - Usa script apropiado después

---

## 🎯 Resumen

| Situación | Acción |
|-----------|--------|
| Desarrollo diario | `bash dev-preserve-data.sh` |
| Cambio de sesión | Presiona CTRL+C, luego `bash dev-preserve-data.sh` |
| Necesito datos limpios | Comunica y usa `pnpm dev:clean` |
| Puerto ocupado | Mata proceso: `lsof -ti:PUERTO \| xargs kill -9` |
| Recuperar datos | Busca en `firebase-emulators-data/` o git |

**Principio fundamental:** 
> Desarrolla con datos reales y complejos. Nunca limpies sin saber por qué.

