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
2. **Geometría y Switches:**
   - Todo contenedor, input, botón y modal debe usar `rounded-none` (`0px`) y `shadow-none`.
   - Switch estándar exclusivo: `M3Switch`.
3. **Formularios y Gobernanza HITL:**
   - Todos los `<form>` e `<input>` deben incluir `autoComplete="off"` y `spellCheck={false}`.
   - Pantallas técnicas en modo informe (solo lectura) por defecto; edición quirúrgica mediante icono `edit` plano y confirmación con palabra clave `"ACTUALIZAR"`.

