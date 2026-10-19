# MINREPORT — Estándar Exclusivo de UI/UX y Minimalismo Industrial

Este archivo define las reglas obligatorias de UI/UX para el desarrollo de componentes e interfaces en **MINREPORT**.
Aplica a todos los agentes, subagentes y herramientas en este workspace.

---

## 1. Identidad de Marca y Paleta Cromática
- **Acento Primario Oficial:** `#C68346` (Cobre Industrial MINREPORT). Prohibido `#FFCD00`.
- **Acento Secundario Técnico:** `#00AEEF` (Cian Tecnológico).
- **Fondos Modo Oscuro:** Base `#000000` / Superficie y Paneles `#07090D` / Bordes `#12151C`.
- **Fondos Modo Claro:** Base `#FFFFFF` / Superficie y Paneles `#F8FAFC` / Bordes `#E2E8F0`.
- **Soporte Dual Obligatorio:** Todo componente DEBE implementar tanto modo claro como modo oscuro (`dark:`).

---

## 2. Tipografía y Ergonomía ISO 9241-300 / WCAG 2.2 AAA
- **Texto Principal:** `Atkinson Hyperlegible Next` (o `Atkinson Hyperlegible` como fallback).
- **Datos y Métricas:** `Atkinson Hyperlegible Mono` (`tabular-nums font-mono`).
- **PROHIBIDO:** `Google Sans`, `Roboto`, `Inter`.
- **Escala Ergonómica:**
  - `text-hero-display`: `clamp(2.5rem, 6vw, 5rem)` — lineHeight: 0.95, weight: 700.
  - `text-kpi-display`: `2.25rem` (36px) — lineHeight: 1.15, tabular-nums, weight: 700.
  - `text-h1-header`: `1.375rem` (22px) — lineHeight: 1.25, weight: 600.
  - `text-h2-section`: `1.0625rem` (17px) — lineHeight: 1.35, weight: 600.
  - `text-body-main`: `0.9375rem` (15px) — lineHeight: 1.45, weight: 400.
  - `text-data-dense`: `0.8125rem` (13px) — lineHeight: 1.35, tabular-nums, weight: 400.
  - `text-microcopy`: `0.6875rem` (11px) — lineHeight: 1.20, uppercase, weight: 700.

---

## 3. Geometría y Minimalismo Industrial Puro
- **Bordes:** `rounded-none` / `0px` en tarjetas, inputs, botones, switches y modales.
- **Sombras:** `shadow-none` / `box-shadow: none` estricto (cero sombras difusas o neomorfismo).
- **Micro-Espaciado Fibonacci:** `fib-8` (8px), `fib-13` (13px), `fib-21` (21px), `fib-34` (34px), `fib-55` (55px), `fib-89` (89px).
- **Macro-Layout Paramétrico (Proporción Áurea):** Área Mayor $\Phi \approx 61.8\%$ / Área Menor $1-\Phi \approx 38.2\%$.

---

## 4. Iconografía y Botones
- **Exclusividad:** `material-symbols-outlined`. Prohibido `material-symbols-rounded` o emojis.
- **Botón de Icono Plano:**  
  `bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer`
- **PROHIBIDO:** Adosar texto descriptivo redundante al lado del icono o encerrar iconos en cajas con fondos/bordes decorativos.

---

## 5. Gobernanza de Datos y Formularios
- **Modo Informe Técnico por Defecto:** Vistas presentadas como informe de solo lectura.
- **Edición Quirúrgica HITL:** Requiere escribir obligatoriamente `"ACTUALIZAR"` para persistir cambios en registros oficiales.
- **Formularios Blindados:** `autocomplete="off"` y `spellCheck={false}` obligatorios en todos los `<form>` e `<input>`.
- **Datos Ausentes:** Mostrar con sobriedad `[Información técnica no declarada en ficha]`. Prohibidos badges o métricas inventadas.
- **Switch:** Usar `M3Switch` o `SDKSwitch`. Prohibido `AdminSwitch`.
