# DESARROLLO CON DATOS PERSISTENTES - SOLUCIÓN DEFINITIVA

## 🎯 PROBLEMA IDENTIFICADO:
- El `--export-on-exit` NO funciona correctamente
- Los datos se pierden en cada reinicio
- Necesitas datos complejos persistentes para desarrollo

## ✅ SOLUCIÓN: Base de Datos de Desarrollo Persistente

### 1. NUEVO COMANDO PARA DESARROLLO:
```bash
pnpm dev:persist
```

### 2. FLUJO PARA DATOS PERSISTENTES:

1. **Una sola vez** (setup inicial):
   - Iniciar sistema limpio
   - Crear super admin y datos complejos
   - Hacer backup manual forzado

2. **Desarrollo diario**:
   - Usar comando que NO borre datos
   - Los datos persisten automáticamente

### 3. COMANDOS ESPECÍFICOS:

- `pnpm dev:persist` - Desarrollo con datos persistentes
- `pnpm dev:clean` - Solo cuando quieras empezar limpio
- `pnpm backup:force` - Backup manual de datos

### 4. GARANTÍA DE PERSISTENCIA:
- Los datos se guardan en directorio especial
- No se usan flags de import/export automáticos
- Control manual total sobre los datos