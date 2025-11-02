# 🎨 GUÍA DE IMPLEMENTACIÓN DE ESTÁNDARES UI/UX
## MINREPORT Design System - Versión 1.0

---

## 📋 TABLA DE CONTENIDOS

1. [Inicio Rápido (5 minutos)](#inicio-rápido)
2. [Estructura de Recursos](#estructura-de-recursos)
3. [Ejemplos Prácticos](#ejemplos-prácticos)
4. [Troubleshooting](#troubleshooting)
5. [Validación y Checklist](#validación-y-checklist)

---

## 🚀 INICIO RÁPIDO

### Para Desarrolladores Nuevos (PRIMERO HACER ESTO):

**Paso 1: Leer la Referencia Rápida (3 minutos)**
```bash
# Abre este archivo para ver tokens listos para copiar y pegar
cat DESIGN_TOKENS_REFERENCE.md
```

**Paso 2: Consulta el Sistema Completo (2 minutos)**
```bash
# En MINREPORT_VITACORA_Y_ESTANDARES.md, ve a la sección:
# ESTÁNDARES DE UI/UX (busca por Ctrl+F)
```

**Paso 3: Prueba en Storybook (10 minutos)**
```bash
pnpm storybook
# Abre http://localhost:6006
# Explora los componentes documentados
```

---

## 📂 ESTRUCTURA DE RECURSOS

```
/Volumes/CODE/MINREPORT iMac/minreport/
├── DESIGN_TOKENS_REFERENCE.md          ← COMIENZA AQUÍ (Dev Quick Reference)
├── MINREPORT_VITACORA_Y_ESTANDARES.md  ← Full Design System Doc
│   └── Sección: ESTÁNDARES DE UI/UX
├── packages/
│   ├── core-ui/
│   │   ├── src/
│   │   │   ├── styles/
│   │   │   │   ├── tokens.css         ← CSS Variables (Todas nuestras)
│   │   │   │   ├── typography.css
│   │   │   │   ├── colors.css
│   │   │   │   └── responsive.css
│   │   │   └── components/
│   │   │       ├── Button.tsx
│   │   │       ├── Input.tsx
│   │   │       ├── Card.tsx
│   │   │       ├── Modal.tsx
│   │   │       └── Navigation/
│   │   └── vitest/                   ← Tests (Accessibility validated)
│   └── ui-components/
│       └── (Same structure)
```

---

## 💡 EJEMPLOS PRÁCTICOS

### Ejemplo 1: Crear un Button Correctamente

❌ **INCORRECTO - Hard-coded values:**
```tsx
const Button = styled.button`
  background-color: #6366F1;  // ❌ Hard-coded
  padding: 8px 16px;          // ❌ Hard-coded
  font-size: 14px;            // ❌ Hard-coded
  border-radius: 4px;         // ❌ Hard-coded
`;
```

✅ **CORRECTO - Using design tokens:**
```tsx
// Opción 1: CSS Variables (Recomendado)
const Button = styled.button`
  background-color: var(--color-primary);           // ✅ Token
  padding: var(--spacing-sm) var(--spacing-md);     // ✅ Token
  font-size: var(--font-size-body-medium);          // ✅ Token
  border-radius: var(--border-radius-md);           // ✅ Token
  transition: background-color var(--transition-standard);
`;

// Opción 2: MUI sx prop (Si usas Material-UI)
<Button
  sx={{
    backgroundColor: 'var(--color-primary)',
    padding: `var(--spacing-sm) var(--spacing-md)`,
    fontSize: 'var(--font-size-body-medium)',
    borderRadius: 'var(--border-radius-md)',
  }}
/>
```

### Ejemplo 2: Componente con Responsive Design

❌ **INCORRECTO:**
```tsx
const Container = styled.div`
  width: 100%;
  font-size: 20px;
  
  @media (max-width: 768px) {
    font-size: 16px;
  }
`;
```

✅ **CORRECTO:**
```tsx
const Container = styled.div`
  width: 100%;
  font-size: var(--font-size-h3);                  // Desktop first
  
  @media (max-width: var(--breakpoint-lg)) {
    font-size: var(--font-size-h4);                // Tablet
  }
  
  @media (max-width: var(--breakpoint-sm)) {
    font-size: var(--font-size-body-large);        // Mobile
  }
`;
```

### Ejemplo 3: Accesibilidad - Color Contrast

❌ **INCORRECTO - Bajo contraste:**
```tsx
<button style={{ color: '#D1D5DB', backgroundColor: '#E5E7EB' }}>
  Texto con bajo contraste ❌
</button>
```

✅ **CORRECTO - WCAG AA compliant:**
```tsx
<button
  style={{
    color: 'var(--color-text-primary)',        // Ratio 7:1
    backgroundColor: 'var(--color-primary)',   // Ratio 4.5:1 (WCAG AA)
  }}
  aria-label="Descripción clara del botón"
>
  Texto accesible ✅
</button>
```

---

## 🔍 DÓNDE ENCONTRAR QUÉ

### "¿Necesito especificar colores?"
→ Ver `DESIGN_TOKENS_REFERENCE.md` → Sección **CSS VARIABLES - COLORES**
```css
--color-primary: #6366F1;
--color-secondary: #8B5CF6;
--color-success: #10B981;
--color-error: #EF4444;
```

### "¿Cuál es el tamaño correcto de typography?"
→ Ver `DESIGN_TOKENS_REFERENCE.md` → Sección **CSS VARIABLES - TIPOGRAFÍA**
```css
--font-size-display: 48px;      /* Titulares principales */
--font-size-h1: 36px;           /* Títulos */
--font-size-h2: 28px;           /* Subtítulos */
--font-size-body-large: 16px;   /* Texto principal */
--font-size-body-medium: 14px;  /* Texto secundario */
--font-size-body-small: 12px;   /* Labels, helpers */
--font-size-caption: 11px;      /* Notas pequeñas */
```

### "¿Cómo haré un Button?"
→ Ver `DESIGN_TOKENS_REFERENCE.md` → Sección **COMPONENTES - BUTTON**
```tsx
// Template listo para copiar y pegar
<Button
  variant="filled"
  sx={{
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-on-primary)',
    padding: 'var(--spacing-md) var(--spacing-lg)',
    borderRadius: 'var(--border-radius-md)',
    fontSize: 'var(--font-size-body-medium)',
    fontWeight: 600,
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: 'var(--color-primary-dark)',
    },
  }}
>
  Botón
</Button>
```

### "¿Cuál es el spacing correcto?"
→ Ver `DESIGN_TOKENS_REFERENCE.md` → Sección **CSS VARIABLES - ESPACIADO**
```css
--spacing-xs: 4px;      /* Gaps muy pequeños */
--spacing-sm: 8px;      /* Gaps pequeños */
--spacing-md: 12px;     /* Gaps medianos (estándar) */
--spacing-lg: 16px;     /* Gaps grandes */
--spacing-xl: 24px;     /* Gaps muy grandes */
--spacing-2xl: 32px;    /* Espacios entre secciones */
--spacing-3xl: 64px;    /* Espacios amplios */
```

### "¿Cómo haré responsive?"
→ Ver `DESIGN_TOKENS_REFERENCE.md` → Sección **BREAKPOINTS**
```css
/* Mobile-first approach */
@media (max-width: var(--breakpoint-xs)) { }  /* 0-480px */
@media (max-width: var(--breakpoint-sm)) { }  /* 481-640px */
@media (max-width: var(--breakpoint-md)) { }  /* 641-960px */
@media (max-width: var(--breakpoint-lg)) { }  /* 961-1280px */
@media (max-width: var(--breakpoint-xl)) { }  /* 1281-1536px */
@media (max-width: var(--breakpoint-2xl)) { } /* 1537px+ */
```

### "¿Qué iconos tengo disponibles?"
→ Ver `DESIGN_TOKENS_REFERENCE.md` → Sección **ICONOS DISPONIBLES**
```tsx
import {
  Home,
  Settings,
  Users,
  FileText,
  BarChart3,
  Plus,
  Edit,
  Trash2,
  // ... 25+ más disponibles
} from '@mui/icons-material';

// Uso:
<Home sx={{ fontSize: 24 }} />
```

### "¿Qué necesito validar para accesibilidad?"
→ Ver `DESIGN_TOKENS_REFERENCE.md` → Sección **CHECKLIST ACCESIBILIDAD**

```md
- [ ] Contraste de color WCAG AA (4.5:1 mínimo)
- [ ] Todas las imágenes tienen alt text
- [ ] Los inputs tienen labels
- [ ] Los buttons tienen aria-label si no tienen texto
- [ ] El tab order es lógico
- [ ] Focus visible en todos los elementos interactivos
- [ ] Las animaciones respetan prefers-reduced-motion
```

---

## 🛠️ TROUBLESHOOTING

### Problema: "¿Por qué mis variables CSS no funcionan?"

**Solución:**
1. Verifica que `tokens.css` esté importado en tu entry point
2. Asegúrate de que estés usando `var(--nombre-variable)` (con los guiones)
3. Ejemplo correcto:
   ```css
   background-color: var(--color-primary);  /* ✅ Correcto */
   background-color: --color-primary;       /* ❌ Incorrecto */
   ```

### Problema: "¿Cómo actualizo los tokens globales?"

**Solución:**
1. Los tokens están en `packages/core-ui/src/styles/tokens.css`
2. Edita los valores allí
3. **Todos los componentes se actualizan automáticamente**
4. No necesitas cambiar componentes individuales

### Problema: "¿Mi componente no se ve responsive?"

**Checklist:**
- [ ] ¿Estoy usando media queries con breakpoints variables?
- [ ] ¿El mobile está en el breakpoint menor?
- [ ] ¿He testeado en diferentes tamaños (DevTools)?
- [ ] ¿Estoy usando `var(--breakpoint-*)` o breakpoints hardcoded?

### Problema: "¿El diseño se ve diferente en diferentes navegadores?"

**Checklist:**
- [ ] ¿Estoy usando vendor prefixes donde necesito? (-webkit-, -moz-, etc.)
- [ ] ¿Estoy usando polyfills para navegadores antiguos?
- [ ] ¿He testeado en Chrome, Firefox, Safari, Edge?

---

## ✅ VALIDACIÓN Y CHECKLIST

### Antes de hacer un PR con cambios UI:

```md
## UI/UX Standards Compliance Checklist

- [ ] **Colores**: Solo uso variables de `--color-*`
- [ ] **Tipografía**: Solo uso variables de `--font-size-*` y `--font-weight-*`
- [ ] **Espaciado**: Solo uso variables de `--spacing-*`
- [ ] **Borders**: Solo uso `--border-radius-*`
- [ ] **Sombras**: Solo uso `--shadow-*`
- [ ] **Responsive**: Tengo breakpoints para mobile, tablet, desktop
- [ ] **Accesibilidad**:
  - [ ] Contraste mínimo 4.5:1 en texto
  - [ ] Labels en inputs
  - [ ] ARIA labels donde necesario
  - [ ] Focus visible en elementos interactivos
- [ ] **Animaciones**: Uso `--transition-*` y respeto `prefers-reduced-motion`
- [ ] **Cross-browser**: Testeado en Chrome, Firefox, Safari
- [ ] **Storybook**: Mi componente tiene una historia documentada
- [ ] **Tests**: Validé accesibilidad con axe o similar

## Commit message template:

\`\`\`
feat(ui): Agregar [nombre componente]

- Usa estándares de diseño (colores, tipografía, espaciado)
- Responsive en mobile/tablet/desktop
- WCAG AA accesibilidad
- Incluye Storybook story

Refs: [Issue #123]
\`\`\`
```

---

## 📚 REFERENCIAS RÁPIDAS

| Necesidad | Archivo | Ubicación |
|-----------|---------|-----------|
| **Copy & Paste Tokens** | `DESIGN_TOKENS_REFERENCE.md` | Root |
| **Full Design System** | `MINREPORT_VITACORA_Y_ESTANDARES.md` | Root, sección "ESTÁNDARES DE UI/UX" |
| **Componentes en Vivo** | Storybook | `pnpm storybook` |
| **CSS Variables** | `packages/core-ui/src/styles/tokens.css` | Código |
| **Tipografía** | `packages/core-ui/src/styles/typography.css` | Código |
| **Colores** | `packages/core-ui/src/styles/colors.css` | Código |
| **Responsive** | `packages/core-ui/src/styles/responsive.css` | Código |

---

## 🎯 RESUMEN DE 30 SEGUNDOS

1. **¿Nuevo en el proyecto?** → Lee `DESIGN_TOKENS_REFERENCE.md`
2. **¿Necesitas un token?** → Cópialo de `DESIGN_TOKENS_REFERENCE.md`
3. **¿Necesitas detalles?** → Lee sección "ESTÁNDARES DE UI/UX" en master doc
4. **¿Necesitas ver ejemplos?** → Corre `pnpm storybook`
5. **¿Dudas?** → Consulta esta guía de implementación

---

## 📞 PREGUNTAS FRECUENTES

**P: ¿Puedo usar valores hardcoded?**
A: No. Usa siempre variables. Si el valor no existe, agrégalo a `tokens.css` y propone un PR.

**P: ¿Qué si necesito un color que no está?**
A: Propón agregar una nueva variable a `tokens.css` en un PR, con justificación en el commit message.

**P: ¿Los tokens se sincronizar automáticamente?**
A: Sí. Si editas `tokens.css`, todos los componentes que usan `var(--*)` se actualizan automáticamente.

**P: ¿Cómo hago dark mode?**
A: Los tokens incluyen variantes. Usa media query `@media (prefers-color-scheme: dark) { }` para overrides.

**P: ¿Puedo editar componentes individuales sin afectar otros?**
A: Sí, pero mantén consistencia. Si cambias estilos, considera si afecta a otros componentes.

**P: ¿Dónde documente mis cambios?**
A: En Storybook (`.stories.tsx` files) y en código con comentarios.

---

**Versión**: 1.0  
**Última actualización**: 2 de Noviembre, 2025  
**Autores**: Design System Team + AI Assistant  
**Status**: ✅ Listo para Producción
