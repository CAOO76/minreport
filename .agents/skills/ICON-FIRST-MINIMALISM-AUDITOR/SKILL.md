---
name: icon-first-minimalism-auditor
description: Auditor de Minimalismo Operativo Icon-First (ad hoc Material Symbols Outlined sin prosa ni botones con texto redundante), anti-FOUT/anti-flash y separación Terreno Móvil vs Escritorio Solo Lectura en MINREPORT.
---

# ICON-FIRST-MINIMALISM-AUDITOR (HMI Aeroespacial & Senior Terreno)

> **Propósito:** Garantizar minimalismo absoluto de interfaz en todo componente nuevo o modificado de MINREPORT, eliminando botones con texto cuando un icono Material Symbols Outlined ad hoc es suficiente y asegurando transiciones instantáneas sin destellos (`LANDSCAPE`, `WIFI`, FOUT).

## 1. Reglas Estrictas de UI Icon-First Ad Hoc

1. **Sustitución Obligatoria de Botones con Texto por Iconos Ad Hoc:**
   - Toda acción operativa estándar debe representarse únicamente con su icono `material-symbols-outlined` transparente y plano, conservando `aria-label` y `title` traducidos (`t(...)`) para accesibilidad WCAG 2.2 AAA:
     - Medir acopios (Hub): `measuring_tape`
     - Calibrar escala / huincha 2.00 m (Hub y Disparador): `compass_calibration`
     - Capturar / Medir de nuevo (Barra móvil inferior centrada `#C68346`): `add_a_photo`
     - Exportar PDF vectorial: `picture_as_pdf`
     - Cerrar acopio (Despacho o Eliminación en terreno): `done_all` (`local_shipping` / `delete_sweep` en selector dual de causa)
     - Reabrir ciclo (HITL en móvil): `lock_open`
     - Modos visuales (`PHOTO | 3D | DUAL | MAP`): `photo_camera` | `deployed_code` | `view_column_2` | `satellite_alt`
     - Etapas escritorio (`OVERVIEW | TWIN_3D | LEDGER`): `monitoring` | `deployed_code` | `history`
     - Confirmar / Cancelar acción inline: `check` / `close`
     - Ignorar / Restaurar medición: `visibility_off` / `visibility`

2. **Prohibiciones Inviolables en Botones y Navegación:**
   - Prohibido combinar icono + texto descriptivo redundante dentro de botones de acción o pestañas de modo.
   - Prohibido envolver iconos en cajas de color o bordes decorativos; usar únicamente superficies planas transparentes (`bg-transparent border-0`) con cambio de color ISA-101 al foco o selección (`#C68346` / `#00AEEF`).
   - Targets táctiles obligatorios en terreno móvil: mínimo `48px × 48px` (`min-w-[48px] min-h-[48px]`) o `56px–64px` en acciones primarias.

3. **Integridad de Glifos y Anti-FOUT (Cero Flashes):**
   - Cada nombre de glifo Material Symbols usado en código debe verificarse existente en el binario local `@fontsource/material-symbols-outlined/files/material-symbols-outlined-latin-400-normal.woff`.
   - Todo `@font-face` de `Material Symbols Outlined` debe declarar `font-display: block` y la clase `.material-symbols-outlined` debe encerrarse en `@layer components` con tamaño fijo `1em × 1em`, `overflow: hidden` y puerta `html:not(.ms-ready)` para impedir destellos de palabras en inglés (`LANDSCAPE`, `WIFI`, etc.) durante el arranque o transiciones.
   - Prohibidas barras o textos efímeros de carga (`CARGANDO`, `ANALIZANDO`) sobre botones estáticos o fallbacks nativos; usar exclusivamente `M3LinearProgress` sin texto en fallbacks móviles.

4. **Separación Operativa Terreno Móvil vs Escritorio Solo Lectura (`ACOPIOS`):**
   - **Móvil en Terreno:** Único punto autorizado para capturar nuevas mediciones, calibrar escala, cerrar un acopio (`SHIPPED` por despacho o `FIELD_REMOVED` por eliminación con causa obligatoria) y reabrir ciclo bajo `"ACTUALIZAR"`. Su vista de detalle de medición es ultra-simple y de alto contraste para mineros senior (70+).
   - **Escritorio (`DesktopStageWorkspace` + `DesktopDossierPanel`):** Estrictamente **100% solo lectura** para el ciclo del acopio (prohibidos lápices de edición, cierre, reapertura, borrado, toggles de visibilidad, mutaciones 3D o drawer IA sobre fichas ya capturadas). Exhibe exclusivamente telemetría técnica real de cada captura sin decoraciones ni datos alucinados.

5. **Comprobación Automatizada:**
   - Antes de cerrar cualquier cambio UI en MINREPORT, ejecutar `npm run audit:hmi-icons` y verificar salida sin violaciones.
