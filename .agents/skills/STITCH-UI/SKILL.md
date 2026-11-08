---
name: STITCH-UI-Governance
description: Motor de gobernanza de diseño Minimalismo Industrial Puro (Atkinson Hyperlegible Next/Mono, Cobre #C68346, Cian #00AEEF, M3Switch, rounded-none, shadow-none) y arquitectura modular nativa para MINREPORT.
---

# STITCH-UI-Governance (MINREPORT Web 3.0)

Gobierna los componentes de interfaz compartidos de **MINREPORT** y sus módulos nativos (`OPERMAQ` y `STOCKPILE CONTROL`).

## 1. Reglas de Componentes y Tokens
1. **Tipografía y Escala:**
   - Lectura: `Atkinson Hyperlegible Next`.
   - Tablas y métricas: `Atkinson Hyperlegible Mono` (`tabular-nums font-mono`).
   - Escala: `text-hero-display` (`clamp(2.5rem, 6vw, 5rem)`), `text-kpi-display` (`2.25rem`), `text-h1-header` (`1.375rem`), `text-h2-section` (`1.0625rem`), `text-body-main` (`0.9375rem`), `text-data-dense` (`0.8125rem`), `text-microcopy` (`0.6875rem`).
2. **Geometría, Switches e Indicadores de Progreso (Material Design 3):**
   - Todo contenedor, input, botón y modal debe usar `rounded-none` (`0px`) y `shadow-none`.
   - Switch estándar exclusivo: `M3Switch`.
   - **Indicadores de Progreso Exclusivos (`M3LinearProgress` y `M3CircularProgress` — Estándar Oficial https://m3.material.io/components/progress-indicators/overview):**
     - Quedan **estrictamente prohibidos** los indicadores de progreso improvisados (barras sin track/stop indicator, textos/números encerrados en cajas junto a iconos, flechas `chevron_right` entre pestañas o iconos `progress_activity` con `animate-spin`).
     - **Linear Progress Indicator (`M3LinearProgress`):** Altura estricta de `4px` (`h-[4px]`), geometría `rounded-none`, compuesta por:
       1. **Active Indicator:** `#C68346` (Cobre Industrial en progreso) o `#00AEEF` (Cian Tecnológico al 100%).
       2. **Track Gap M3:** Separación limpia de `4px` (`gap-[4px]`) entre el indicador activo y la pista inactiva.
       3. **Track (Pista Inactiva):** `#E2E8F0` (modo claro) / `#12151C` (modo oscuro).
       4. **Stop Indicator M3:** Punto cuadrado de `4px × 4px` al extremo derecho de la pista en modo determinado para indicar el límite máximo del recorrido.
     - **Circular Progress Indicator (`M3CircularProgress`):** SVG vectorial limpio (`role="progressbar"`, `strokeLinecap="butt"`, `strokeWidth: 3px–4px`) con pista `#E2E8F0` / `#12151C` y trazo activo `#C68346` / `#00AEEF` (determinado o indeterminado).
3. **Formularios y Gobernanza HITL:**
   - Todos los `<form>` e `<input>` deben incluir `autoComplete="off"` y `spellCheck={false}`.
   - Pantallas técnicas en modo informe (solo lectura) por defecto; edición quirúrgica mediante icono `edit` plano y confirmación con palabra clave `"ACTUALIZAR"`.

