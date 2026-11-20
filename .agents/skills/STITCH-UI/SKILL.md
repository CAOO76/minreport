---
name: STITCH-UI-Governance
description: Motor de gobernanza de diseño Minimalismo Operativo Absoluto (HMI Aeroespacial & Industrial — NASA OpenMCT, SpaceX Dragon, F-35 PCD/ISA-101, MBUX Zero-Layer, Leica Captivate) con Atkinson Hyperlegible Next/Mono, Cobre #C68346, Cian #00AEEF, M3Switch, M3LinearProgress, rounded-none, shadow-none y arquitectura modular nativa MINREPORT.
---

# STITCH-UI-Governance (MINREPORT Web 3.0)

Gobierna los componentes de interfaz compartidos de la marca única **MINREPORT** y sus módulos nativos (**`OPERMAQ`** [`moduleId`: `opermaq`] y **`ACOPIOS`** [`moduleId` técnico interno: `stockpile`]). Quedan prohibidas toda sub-marca comercial heredada, cualquier acento `#FFCD00` o fuente `Google Sans`/`Roboto`/`Inter`.

## 1. Referentes HMI Aeroespaciales & Estándar ANSI/ISA-101
1. **NASA OpenMCT & NASA-STD-3001:** Economía cognitiva; fusión de telemetría en vivo + curva evolutiva + evidencia visual en un único lienzo operativo sin saltos innecesarios ni prosa explicativa.
2. **SpaceX Dragon Touchscreen HMI:** *Dark Cockpit* (estado nominal silencioso), targets táctiles aptos para guantes/vibración (`>= 48px–64px`) y gates de confirmación HITL (`"ACTUALIZAR"`) únicamente en mutaciones críticas o irreversibles.
3. **Lockheed Martin F-35 PCD & ANSI/ISA-101 High-Performance HMI:** *Color por Excepción*:
   - `>= 85%` del lienzo monocromático neutro (`#000000`/`#F3F4F6` oscuro; `#FFFFFF`/`#0F172A` claro *Sol Atacama*).
   - Cobre **`#C68346`** reservado exclusivamente a dato protagonista, foco activo o excepción/alerta (ej. talud `> 38°`, cola offline o pendiente de escala).
   - Cian **`#00AEEF`** reservado exclusivamente a verificación IA, nivel IMU óptimo e interactividad técnica.
   - Cero badges de texto largos o decoración "árbol de Navidad".
4. **Mercedes-Benz MBUX Zero-Layer:** Controles estrictamente contextuales sin apilar cabeceras ni barras globales redundantes.
5. **Leica Captivate Field HMI:** Legibilidad extrema *Sol Atacama* / *Cabina Oscura* WCAG 2.2 AAA, `Atkinson Hyperlegible Next/Mono` con `tabular-nums` y retículas HUD directas.

## 2. Reglas de Componentes y Tokens
1. **Tipografía, Escala y Soporte Dual (`light` / `dark:`):**
   - Lectura: `Atkinson Hyperlegible Next`.
   - Tablas y métricas: `Atkinson Hyperlegible Mono` (`tabular-nums font-mono`).
   - Escala: `text-hero-display` (`clamp(2.5rem, 6vw, 5rem)`), `text-kpi-display` (`2.25rem`), `text-h1-header` (`1.375rem`), `text-h2-section` (`1.0625rem`), `text-body-main` (`0.9375rem`), `text-data-dense` (`0.8125rem`), `text-microcopy` (`0.6875rem`).
   - Todo componente debe implementar clases duales completas (`dark:`) y espaciado Fibonacci (`fib-8` a `fib-89`).
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
3. **Iconografía, Formularios, Blindaje y Gobernanza HITL:**
   - Exclusivamente `material-symbols-outlined` planos y transparentes (cero emojis, cero cajas o texto adosado).
   - Todos los `<form>` e `<input>` deben incluir `autoComplete="off"` y `spellCheck={false}`.
   - Pantallas técnicas en modo informe (solo lectura) por defecto; edición quirúrgica mediante icono `edit` plano y confirmación con palabra clave `"ACTUALIZAR"`. Datos faltantes: `[Información técnica no declarada en ficha]`.
   - Medios protegidos (`SecureImage`), cumplimiento Ley N° 21.719 / N° 19.628 (`southamerica-west1`) y pipeline CAS SHA-256 + `dHash` 64-bit (`MINREPORT-MEDIA-DIGESTOR-CAS`).

## 3. Reglas Móviles Planas y Visor Visual Dual Foto/3D (`ACOPIOS`)
1. **App Móvil (Minimalismo Operativo Zero-Layer):**
   - Cero prosa, cero slogans, cero párrafos explicativos, cero textos tutoriales. Solo botones funcionales, datos tabulares, indicadores precisos, gráficos vectoriales e imágenes/mallas 3D finales.
   - Cero tarjetas o cajas con bordes y relleno en móvil: usar lienzo plano con divisores `hairline 1px` y barra lateral `3px` ISA-101 por excepción.
   - Cabecera superior única contextual de `56px` (prohibido apilar `TopBar` + subheaders + banners offline redundantes). Menú inicial `MINREPORT` con único icono plano centrado sin texto ni caja. Barra inferior (`56px`) **exclusiva** dentro del detalle de acopio con el botón `CÁMARA` (`add_a_photo`) centrado (`#C68346`).
2. **Estándar Visual Dual Foto Real / Malla 3D Digital (`ACOPIOS` / `stockpile`):**
   - Todo registro de acopio en escritorio (`FOTO | 3D | DUAL`) y móvil (`FOTO | 3D`) integra `StockpileVisualStage` + `StockpileTwin3DLazy` (`compact` mode en móvil/comparativas), mostrando fotos reales optimizadas (con perimetrales y `box_2d` cuando existan) y/o mallas `.glb`/TIN con carga diferida y `dispose()` WebGL estricto al desmontar o conmutar de modo.
