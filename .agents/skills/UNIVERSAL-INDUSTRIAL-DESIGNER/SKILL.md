---
name: UNIVERSAL-INDUSTRIAL-DESIGNER
description: Motor soberano de diseño paramétrico Minimalismo Operativo Absoluto (HMI Aeroespacial & Industrial) para MINREPORT. Impone referentes NASA OpenMCT, SpaceX Dragon, F-35 PCD / ANSI/ISA-101, MBUX Zero-Layer y Leica Captivate; Proporción Áurea (61.8% / 38.2%), Fibonacci (fib-8 a fib-89), Atkinson Hyperlegible Next/Mono, Color por Excepción (>=85% neutro, #C68346, #00AEEF), bordes 0px (rounded-none) y cero sombras (shadow-none).
---

# UNIVERSAL-INDUSTRIAL-DESIGNER (Soberanía MINREPORT)

> **Cláusula de Exclusividad MINREPORT:** Marca única **MINREPORT** con módulos nativos funcionales **`OPERMAQ`** (`moduleId`: `opermaq`) y **`ACOPIOS`** (`moduleId` técnico interno: `stockpile`). Quedan **estrictamente prohibidos** cualquier sub-marca comercial heredada para acopios, las fuentes `Google Sans`, `Roboto`, `Inter` y el color amarillo `#FFCD00`.

## 1. Referentes HMI Aeroespaciales & Industriales (Obligatorios por Defecto)
1. **NASA OpenMCT & NASA-STD-3001 (Economía Cognitiva):**
   - Fusión de telemetría en vivo + curva evolutiva + evidencia visual en un único lienzo operativo, sin saltos innecesarios ni prosa explicativa.
2. **SpaceX Dragon Touchscreen HMI (Dark Cockpit & Guantes):**
   - Estado nominal silencioso (*Dark Cockpit*), targets táctiles aptos para guantes y vibración en terreno (`>= 48px–64px`) y gates de confirmación HITL (`"ACTUALIZAR"`) únicamente en mutaciones críticas o irreversibles.
3. **Lockheed Martin F-35 PCD & ANSI/ISA-101 High-Performance HMI (Color por Excepción):**
   - `>= 85%` del lienzo monocromático neutro (`#000000`/`#F3F4F6` oscuro y `#FFFFFF`/`#0F172A` claro *Sol Atacama*).
   - Cobre **`#C68346`** reservado exclusivamente para dato protagonista, foco activo o excepción/alerta (ej. talud `> 38°`, cola offline o pendiente de escala).
   - Cian **`#00AEEF`** reservado exclusivamente para verificación IA, nivel IMU óptimo e interactividad técnica.
   - Cero badges de texto largos o decoración "árbol de Navidad".
4. **Mercedes-Benz MBUX Zero-Layer (Contextualidad Estricta):**
   - Controles estrictamente contextuales sin apilar cabeceras ni barras globales redundantes.
5. **Leica Captivate Field HMI (Legibilidad Extrema en Terreno):**
   - Legibilidad extrema *Sol Atacama* / *Cabina Oscura* WCAG 2.2 AAA, `Atkinson Hyperlegible Next/Mono` con `tabular-nums` y retículas HUD directas.

## 2. Reglas de Diseño Paramétrico Industrial
1. **Tipografía Exclusiva ISO 9241-300 / WCAG 2.2 AAA:**
   - Lectura e Interfaz: **`Atkinson Hyperlegible Next`**.
   - Datos Numéricos, SKUs y Tablas: **`Atkinson Hyperlegible Mono`** con `tabular-nums font-mono`.
2. **Paleta Cromática y Soporte Dual (`light` / `dark:`):**
   - Acento Primario (Protagonista / Foco / Excepción ISA-101): **`#C68346` (Cobre Industrial MINREPORT)**.
   - Acento Secundario Técnico (IA / IMU Óptimo / Interactividad): **`#00AEEF` (Cian Tecnológico)**.
   - Modo Oscuro: Base `#000000`, Superficie `#07090D`, Bordes `#12151C`, Texto primario `#F3F4F6`, Secundario `#8A93A6`.
   - Modo Claro (*Sol Atacama*): Base `#FFFFFF`, Superficie `#F8FAFC`, Bordes `#E2E8F0`, Texto primario `#0F172A`, Secundario `#475569`.
3. **Geometría Pura y Cero Verborrea:**
   - `borderRadius: 0px` (`rounded-none` obligatorio en todos los elementos) y `boxShadow: none` (`shadow-none`).
   - Lenguaje quirúrgico aséptico; cero prosa publicitaria ni badges inventados. Datos ausentes: `[Información técnica no declarada en ficha]`.
   - Todos los `<form>` e `<input>` con `autoComplete="off"` / `autocomplete="off"` y `spellCheck={false}`. Blindaje de medios (`SecureImage`) y protección de datos Ley N° 21.719 / N° 19.628 (`southamerica-west1`, CAS SHA-256).
4. **Macro-Layout Áureo ($\Phi$) y Micro-Espaciado Fibonacci:**
   - En escritorio, división asimétrica $\Phi \approx 61.8\%$ (visor principal / informe / gemelo 3D) y $1 - \Phi \approx 38.2\%$ (panel de control / drawer de ingeniería).
   - Espaciados exclusivos: `fib-8` (`8px`), `fib-13` (`13px`), `fib-21` (`21px`), `fib-34` (`34px`), `fib-55` (`55px`), `fib-89` (`89px`).
5. **Iconografía y Botones Planos:**
   - Exclusivamente `material-symbols-outlined` (prohibido `material-symbols-rounded` y prohibidos los emojis).
   - Botones de icono planos y transparentes: `bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer`.
   - Prohibido adosar texto redundante o etiquetas numéricas en caja junto a iconos en barras de navegación.
6. **Indicadores de Progreso y Switch Material Design 3:**
   - Switch obligatorio: `M3Switch` (`rounded-none`).
   - Referencia normativa obligatoria: `https://m3.material.io/components/progress-indicators/overview`.
   - **Progreso Lineal (`M3LinearProgress`):** Pista de `4px` de espesor (`rounded-none`), indicador activo (`#C68346` en curso / `#00AEEF` completado), separación M3 de `4px` entre indicador activo y pista (`#E2E8F0` / `dark:#12151C`), y `Stop Indicator` cuadrado de `4px × 4px` al final del track.
   - **Progreso Circular (`M3CircularProgress`):** Trazo SVG vectorial (`strokeLinecap="butt"`, `strokeWidth: 3px–4px`) determinado o indeterminado. Prohibido usar iconos `progress_activity` rotando con `animate-spin` o conectores decorativos (`chevron_right`) entre pasos.

## 3. Estándar Móvil Plano (Zero-Layer) y Visual Dual Foto/3D (`ACOPIOS`)
1. **Reglas Estrictas App Móvil:**
   - Cero prosa, cero slogans, cero párrafos explicativos, cero textos tutoriales: únicamente botones funcionales, datos tabulares, indicadores precisos, gráficos vectoriales e imágenes/mallas 3D finales.
   - Cero tarjetas o cajas con bordes y relleno en móvil: lienzo plano con divisores `hairline 1px` y barra lateral `3px` ISA-101 por excepción (`#C68346` alerta/pendiente, `#00AEEF` verificado IA, transparente nominal).
   - Cabecera superior única contextual de `56px` (prohibido apilar `TopBar` + subheaders + banners offline redundantes).
   - Menú inicial `MINREPORT` con único icono plano centrado sin texto ni caja; barra inferior (`56px`) **exclusiva** dentro del detalle de acopio con el botón `CÁMARA` (`add_a_photo`) centrado (`#C68346`).
2. **Estándar Visual Dual Foto Real / Malla 3D (`ACOPIOS` / `stockpile`):**
   - Escritorio (`FOTO | 3D | DUAL`) y móvil (`FOTO | 3D`) mediante `StockpileVisualStage` + `StockpileTwin3DLazy` (`compact` mode en móvil/comparativas), integrando fotos reales optimizadas (con perimetrales y `box_2d`) y mallas `.glb`/TIN con carga diferida y `dispose()` WebGL estricto al desmontar o conmutar.
