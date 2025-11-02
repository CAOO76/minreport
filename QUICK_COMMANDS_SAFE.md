# ⚡ REFERENCIA RÁPIDA - Comandos Seguros para Desarrollo

## 🚀 Iniciando MINREPORT (con datos preservados)

```bash
# ✅ RECOMENDADO - Siempre usa esto
bash dev-preserve-data.sh

# O alternativa:
pnpm dev:persist
```

**Resultado esperado:**
```
✅ Firebase Emulators iniciado
✅ Datos locales cargados
✅ 3 apps Vite corriendo (5173, 5177, 5175)
```

---

## 🔐 Backup de Datos

```bash
# Antes de cambios importantes
bash backup-dev-data.sh
```

**Resultado:**
- `backups/dev-data-backup-YYYYMMDD_HHMMSS.tar.gz` creado
- Se guardan últimos 5 backups automáticamente

---

## ⏹️ Cerrando MINREPORT (preservando datos)

```bash
# Presiona en terminal:
CTRL+C

# NO hagas:
# ❌ pkill firebase
# ❌ CTRL+C repetido
# ❌ Matar proceso manualmente

# Resultado:
# ✅ Firebase exporta datos automáticamente
# ✅ Procesos se cierran limpiamente
# ✅ Datos listos para próxima sesión
```

---

## 🆘 Resolver Puertos Ocupados (SIN perder datos)

```bash
# Ver qué proceso ocupa el puerto
lsof -i :8085

# Matar solo ese proceso (no limpia datos)
lsof -ti:8085 | xargs kill -9

# Reinicia:
bash dev-preserve-data.sh
```

---

## 💾 Recuperar desde Backup

```bash
# Listar backups disponibles
ls -lh backups/

# Restaurar un backup específico
tar -xzf backups/dev-data-backup-20251102_143000.tar.gz

# Reinicia
bash dev-preserve-data.sh
```

---

## 🔍 Verificar Estado de Datos

```bash
# Ver tamaño de datos
du -sh firebase-emulators-data/

# Ver última exportación
ls -lh firebase-export-*

# Ver estructura de datos
ls -la firebase-emulators-data/firestore_export/

# Listar backups
ls -lh backups/
```

---

## ⚠️ NUNCA hagas esto

```bash
❌ pnpm dev:clean           # Borra datos
❌ pnpm dev:safe            # Limpia primero
❌ pnpm clean:emulators     # Elimina TODO
❌ bash dev-clean-start.sh   # Limpia datos
❌ rm -rf firebase-emulators-data
```

---

## 📋 Workflow Día a Día

### Lunes (Inicio de semana)
```bash
bash dev-preserve-data.sh
# Desarrollar con datos previos
CTRL+C
```

### Martes-Viernes (Continuación)
```bash
bash dev-preserve-data.sh
# Todos los datos de días anteriores están aquí ✅
CTRL+C
```

### Viernes (Antes de fin de semana)
```bash
bash backup-dev-data.sh  # Seguridad extra
bash dev-preserve-data.sh
# Última sesión de la semana
CTRL+C
```

---

## 🎯 Checklist Rápido

### Antes de Empezar
- [ ] Ejecuté `bash dev-preserve-data.sh`
- [ ] Verificar: "Datos locales encontrados"
- [ ] 3 apps Vite corriendo

### Durante Desarrollo
- [ ] Edito código
- [ ] Hot-reload funciona
- [ ] Puedo crear datos complejos

### Al Cerrar
- [ ] Presiono CTRL+C (una sola vez)
- [ ] Espero a que cierre limpiamente
- [ ] Verifico: `ls -lh firebase-export-*`
- [ ] Datos actualizados ✅

---

## 🚨 Emergencias

### "Accidentalmente limpié datos"
```bash
# Opción 1: Recuperar desde backup
tar -xzf backups/dev-data-backup-RECENT.tar.gz

# Opción 2: Recuperar desde git (si estaban versionados)
git restore firebase-emulators-data/

# Opción 3: Empezar limpio y reconstruir
bash dev-preserve-data.sh
```

### "Firebase no inicia"
```bash
# Ver error específico
firebase emulators:start --debug

# Soluciones comunes:
# 1. Limpia cache (NO datos)
rm -rf ~/.cache/firebase/emulators

# 2. Libera puertos
lsof -ti:8085,9190,9195,9196 | xargs kill -9

# 3. Reinicia
bash dev-preserve-data.sh
```

### "Todo está roto"
```bash
# Nuclear option (ÚLTIMO RECURSO)
# 1. Haz backup
bash backup-dev-data.sh

# 2. Limpia TODO (opcional)
rm -rf firebase-emulators-data/

# 3. Reinicia limpio
bash dev-preserve-data.sh

# 4. Recupera desde backup si necesario
tar -xzf backups/dev-data-backup-ANTES.tar.gz
```

---

## 📞 Preguntas Frecuentes

**P: ¿Puedo ir a almorzar dejando esto corriendo?**
R: ✅ Sí, es seguro. Solo presiona CTRL+C al final.

**P: ¿Se pierden datos si cierro la terminal?**
R: ✅ No, se guardan en `firebase-emulators-data/`

**P: ¿Cuánto espacio usan los datos?**
R: Típicamente 10-50MB. Ver: `du -sh firebase-emulators-data/`

**P: ¿Puedo trabajar en múltiples ramas?**
R: ⚠️ Los datos son globales, pero git preserva el código de cada rama.

**P: ¿Cada cuánto debo hacer backup?**
R: Antes de cambios importantes o al final de sesión productiva.

---

## 🎓 Ejemplo de Sesión Real

```bash
# Lunes 09:00 - Inicio
bash dev-preserve-data.sh
# ✅ Carga datos del viernes ✅

# Desarrollo 09:00-13:00
# - Crear usuario Juan
# - Crear cuenta ACME
# - Generar reporte mensual
# - Probar suscripción

# Lunes 13:00 - Cierre
CTRL+C
# ✅ Datos guardados

---

# Martes 09:00 - Reinicio
bash dev-preserve-data.sh
# ✅ Usuario Juan, cuenta ACME, reporte mensual están aquí
# ✅ Continúo donde dejé

# Desarrollo con datos complejos acumulados
# Creo más features basadas en datos reales

# Martes 17:00 - Cierre
bash backup-dev-data.sh  # Extra seguridad
CTRL+C
# ✅ Todo preservado

---

# Miércoles 09:00
bash dev-preserve-data.sh
# ✅ Semana de datos acumulados disponible
```

---

## ✅ Resumen en Una Frase

> **Usa `bash dev-preserve-data.sh` para empezar, presiona CTRL+C para salir. Tus datos están seguros.** 🛡️

---

Más info: Ver `DATA_PRESERVATION_GUIDE.md` y `DEV_DATA_STRATEGY.md`
