# 🎨 DESIGN TOKENS REFERENCE - MINREPORT

**Referencia rápida para desarrolladores**  
**Última actualización:** 2 de Noviembre 2025  
**Documento completo:** MINREPORT_VITACORA_Y_ESTANDARES.md → ESTÁNDARES DE UI/UX

---

## 🚀 COPIAR & PEGAR - TOKENS PRINCIPALES

### 1️⃣ COLORES

```css
/* Primarios */
--color-primary: #0066CC;
--color-primary-light: #E3F2FD;
--color-primary-dark: #003366;

/* Secundarios */
--color-secondary: #666666;
--color-secondary-light: #F5F5F5;
--color-secondary-dark: #333333;

/* Estados */
--color-success: #4CAF50;
--color-success-light: #F1F8E9;
--color-error: #F44336;
--color-error-light: #FFEBEE;
--color-warning: #FF9800;
--color-warning-light: #FFF3E0;
--color-info: #00BCD4;
--color-info-light: #E0F2F1;

/* Neutrales */
--color-bg-primary: #FFFFFF;
--color-bg-secondary: #F5F5F5;
--color-text-primary: #000000;
--color-text-secondary: #666666;
--color-text-disabled: #999999;
--color-border: #EEEEEE;
--color-border-light: #E0E0E0;
```

### 2️⃣ TIPOGRAFÍA

```css
/* Tamaños */
--text-size-display: 48px;   /* Hero */
--text-size-h1: 40px;        /* Main titles */
--text-size-h2: 32px;        /* Subtitles */
--text-size-h3: 28px;        /* Sections */
--text-size-title-lg: 22px;  /* Card titles */
--text-size-title-md: 18px;  /* Section headers */
--text-size-body-md: 14px;   /* Default text */
--text-size-body-sm: 12px;   /* Descriptions */
--text-size-caption: 11px;   /* Captions */

/* Pesos */
--text-weight-light: 300;
--text-weight-regular: 400;   /* Default */
--text-weight-medium: 500;
--text-weight-semibold: 600;
--text-weight-bold: 700;

/* Line heights */
--line-height-tight: 1.2;
--line-height-normal: 1.5;    /* Default */
--line-height-relaxed: 1.75;

/* Font */
--font-family-primary: 'Atkinson Hyper Legible', sans-serif;
--font-family-mono: 'Monaco', 'Courier New', monospace;
```

### 3️⃣ ESPACIADO

```css
--space-xs: 4px;      /* Minimal */
--space-sm: 8px;      /* Small */
--space-md: 16px;     /* Default */
--space-lg: 24px;     /* Large */
--space-xl: 32px;     /* Extra large */
--space-2xl: 48px;    /* 2x large */
--space-3xl: 64px;    /* 3x large */
```

### 4️⃣ BORDER RADIUS

```css
--radius-sm: 4px;     /* Subtle */
--radius-md: 8px;     /* Default (buttons) */
--radius-lg: 12px;    /* Cards, modals */
--radius-full: 9999px; /* Pills, avatars */
```

### 5️⃣ SOMBRAS

```css
--shadow-sm: 0 2px 4px rgba(0,0,0,0.1);
--shadow-md: 0 4px 8px rgba(0,0,0,0.12);
--shadow-lg: 0 8px 16px rgba(0,0,0,0.15);
--shadow-xl: 0 12px 24px rgba(0,0,0,0.15);
--shadow-2xl: 0 16px 28px rgba(0,0,0,0.20);
```

### 6️⃣ TRANSICIONES

```css
--transition-fast: 100ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-normal: 200ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
```

---

## 🎯 COMPONENTES COMUNES - COPIAR & PEGAR

### BUTTON (Filled Primary)

```tsx
import { Button } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

<Button
  variant="contained"
  color="primary"
  startIcon={<AddIcon />}
  sx={{
    height: 40,
    padding: '12px 24px',
    borderRadius: '8px',
    fontWeight: 600,
    textTransform: 'none',
    fontSize: '14px',
  }}
>
  Agregar
</Button>
```

### INPUT (Outlined)

```tsx
<TextField
  id="email"
  label="Email"
  type="email"
  variant="outlined"
  fullWidth
  sx={{
    '& .MuiOutlinedInput-root': {
      height: 40,
      borderRadius: '8px',
      '& input::placeholder': {
        color: 'var(--color-text-secondary)',
      },
    },
  }}
  aria-required="true"
/>
```

### CARD

```tsx
<Card
  sx={{
    borderRadius: '12px',
    boxShadow: 'var(--shadow-md)',
    padding: '24px',
    '&:hover': {
      boxShadow: 'var(--shadow-lg)',
    },
  }}
>
  {/* Content */}
</Card>
```

### MODAL

```tsx
<Modal open={open} onClose={onClose}>
  <Box
    sx={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 480,
      backgroundColor: 'var(--color-bg-primary)',
      borderRadius: '12px',
      boxShadow: 'var(--shadow-2xl)',
      padding: '24px',
      backdropFilter: 'blur(2px)',
    }}
  >
    {/* Content */}
  </Box>
</Modal>
```

---

## 📱 RESPONSIVE BREAKPOINTS

```css
/* Mobile First Approach */
.container {
  /* Base: xs (0-480px) */
  display: flex;
  flex-direction: column;
}

@media (min-width: 481px) {
  /* sm: 481-768px */
  .container { /* tablet */ }
}

@media (min-width: 769px) {
  /* md: 769-1024px */
  .container { /* tablet large */ }
}

@media (min-width: 1025px) {
  /* lg: 1025-1440px */
  .container { display: grid; grid-template-columns: 1fr 1fr; }
}

@media (min-width: 1441px) {
  /* xl: 1441-1920px */
  .container { max-width: 1200px; margin: 0 auto; }
}
```

---

## 🎨 PALETA DE COLORES (Hex)

| Rol | Color | Hex | RGB |
|-----|-------|-----|-----|
| Primary | Azul | #0066CC | rgb(0, 102, 204) |
| Primary Light | Azul Claro | #E3F2FD | rgb(227, 242, 253) |
| Primary Dark | Azul Oscuro | #003366 | rgb(0, 51, 102) |
| Success | Verde | #4CAF50 | rgb(76, 175, 80) |
| Success Light | Verde Claro | #F1F8E9 | rgb(241, 248, 233) |
| Error | Rojo | #F44336 | rgb(244, 67, 54) |
| Error Light | Rojo Claro | #FFEBEE | rgb(255, 235, 238) |
| Warning | Naranja | #FF9800 | rgb(255, 152, 0) |
| Warning Light | Naranja Claro | #FFF3E0 | rgb(255, 243, 224) |
| Info | Cian | #00BCD4 | rgb(0, 188, 212) |
| Text Primary | Negro | #000000 | rgb(0, 0, 0) |
| Text Secondary | Gris | #666666 | rgb(102, 102, 102) |
| Background | Blanco | #FFFFFF | rgb(255, 255, 255) |
| Background Secondary | Gris Claro | #F5F5F5 | rgb(245, 245, 245) |
| Border | Gris Borde | #EEEEEE | rgb(238, 238, 238) |

---

## 🎯 ICONOS MÁS USADOS

```tsx
import AddIcon from '@mui/icons-material/Add';                    // + Agregar
import EditIcon from '@mui/icons-material/Edit';                  // ✏️ Editar
import DeleteIcon from '@mui/icons-material/Delete';              // 🗑️ Eliminar
import SaveIcon from '@mui/icons-material/Save';                  // 💾 Guardar
import CloseIcon from '@mui/icons-material/Close';                // ✕ Cerrar
import SearchIcon from '@mui/icons-material/Search';              // 🔍 Buscar
import DownloadIcon from '@mui/icons-material/Download';          // ↓ Descargar
import ShareIcon from '@mui/icons-material/Share';                // Compartir
import SettingsIcon from '@mui/icons-material/Settings';          // ⚙️ Config
import PersonIcon from '@mui/icons-material/Person';              // 👤 Usuario
import LogoutIcon from '@mui/icons-material/Logout';              // Exit
import CheckCircleIcon from '@mui/icons-material/CheckCircle';    // ✓ Éxito
import ErrorIcon from '@mui/icons-material/Error';                // ✕ Error
import WarningIcon from '@mui/icons-material/Warning';            // ⚠️ Alerta
import InfoIcon from '@mui/icons-material/Info';                  // ℹ️ Info
import BarChartIcon from '@mui/icons-material/BarChart';          // 📊 Gráfico
import DashboardIcon from '@mui/icons-material/Dashboard';        // Dashboard
import MoreVertIcon from '@mui/icons-material/MoreVert';          // ⋮ Más
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';      // ↓ Expandir
import MenuIcon from '@mui/icons-material/Menu';                  // ≡ Menú
import ArrowBackIcon from '@mui/icons-material/ArrowBack';        // ← Volver
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';  // → Siguiente
```

---

## ♿ ACCESIBILIDAD - CHECKLIST

```tsx
// ✅ Input Label
<label htmlFor="email">Email:</label>
<input id="email" type="email" aria-required="true" />

// ✅ Button Accessible
<button aria-label="Cerrar diálogo" onClick={onClose}>
  <CloseIcon />
</button>

// ✅ Color Contrast (WCAG AA)
// Text on background: 4.5:1 minimum
// Text on UI: 3:1 minimum

// ✅ Keyboard Navigation
// Tab / Shift+Tab / Enter / Space / Escape

// ✅ Focus Visible
*:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}
```

---

## 📚 REFERENCIAS COMPLETAS

- **Documento Maestro:** MINREPORT_VITACORA_Y_ESTANDARES.md
- **Sección:** ESTÁNDARES DE UI/UX (Línea 972)
- **Storybook:** `cd sites/client-app && pnpm storybook`
- **Archivos CSS:** `atkinson-typography.css`, `design-system.css`

---

## 🔗 RÁPIDOS

| Necesito | Ir A |
|---------|------|
| Tipografía | MINREPORT_VITACORA → B. TIPOGRAFÍA |
| Colores | MINREPORT_VITACORA → C. SISTEMA DE COLORES |
| Espaciado | MINREPORT_VITACORA → D. ESPACIADO |
| Iconos | MINREPORT_VITACORA → E. ICONOGRAFÍA |
| Buttons | MINREPORT_VITACORA → F. COMPONENTES (Botones) |
| Inputs | MINREPORT_VITACORA → F. COMPONENTES (Inputs) |
| Cards | MINREPORT_VITACORA → F. COMPONENTES (Cards) |
| Modals | MINREPORT_VITACORA → F. COMPONENTES (Modals) |
| Responsive | MINREPORT_VITACORA → I. RESPONSIVE DESIGN |
| Accesibilidad | MINREPORT_VITACORA → J. ACCESIBILIDAD |

---

**¡Usa este documento como referencia rápida!**  
**Para detalles completos, ver MINREPORT_VITACORA_Y_ESTANDARES.md**
