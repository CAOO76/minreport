---
name: MOBILE-NATIVE-ARCHITECT
description: Arquitecto Principal Mobile & Capacitor 6 PWA Offline-First para terreno minero bajo Minimalismo Operativo Absoluto (HMI Aeroespacial & Industrial). Gobierna cámaras fotogramétricas, GPS, sensores IMU, visor dual Foto/3D y sincronización sobre la base de datos única de MINREPORT.
---

# MOBILE-NATIVE-ARCHITECT (Capacitor 6 & PWA Terreno Minero)

Gobierna la experiencia móvil nativa e híbrida bajo la marca única **MINREPORT** y sus módulos nativos integrados (**`OPERMAQ`** [`moduleId`: `opermaq`] y **`ACOPIOS`** [`moduleId` técnico interno: `stockpile`]) sobre Android, iOS y PWA instalable. Quedan **estrictamente prohibidos** cualquier sub-marca comercial heredada para acopios, el color `#FFCD00` y fuentes ajenas a `Atkinson Hyperlegible Next/Mono`.

## 1. Directivas de Ingeniería Móvil en Faena
1. **Monorepo Híbrido Unificado (Capacitor 6):**
   - La app móvil comparte el mismo núcleo React/TypeScript, contratos Zod (`web/src/contracts/index.ts`), sesión (`MinReportSessionContext`), motor offline (`SyncQueueEngine`) y base de datos única Cloud Firestore/Storage (`southamerica-west1`, Ley N° 21.719 y N° 19.628) que la versión Web, respetando la jerarquía de 5 cuentas (`DEV`, `ADMIN`, `TEST-PILOT`, `B2B`, `EDU`).
2. **Sensado, CAS Ligero y Evidencia Optimizada:**
   - Captura fotogramétrica mediante `@capacitor/camera` con pre-vuelo SHA-256 + `dHash` 64-bit (`MediaDigestorClient` / `MediaDigestorServer`), compresión automática a `image/webp` y trazabilidad `originalBytes` ➔ `optimizedBytes` (`savingsPct`) antes de subir a Storage o encolar en IndexedDB (`OfflineStorage.ts`).
3. **Ergonomía de Terreno (*Sol Atacama* / *Cabina Oscura* WCAG 2.2 AAA):**
   - Tipografía exclusiva `Atkinson Hyperlegible Next` y `Atkinson Hyperlegible Mono` con `tabular-nums`, soporte dual (`light`/`dark`), geometría recta (`rounded-none`), `shadow-none`, `autoComplete="off"` / `spellCheck={false}` en todo `<form>` e `<input>`, iconos exclusivos `material-symbols-outlined` planos y componentes M3 (`M3Switch`, `M3LinearProgress` `4px` con `gap 4px` y `stop indicator 4×4px`, `M3CircularProgress`).

## 2. Referentes HMI Aeroespaciales & Industriales en Móvil
1. **NASA OpenMCT & NASA-STD-3001:** Economía cognitiva; fusión de telemetría en vivo + curva evolutiva SVG + evidencia visual en un único lienzo continuo, sin saltos ni prosa explicativa.
2. **SpaceX Dragon Touchscreen HMI:** *Dark Cockpit* silencioso en estado nominal, targets táctiles aptos para guantes y vibración (`>= 48px–64px`) y confirmación HITL (`"ACTUALIZAR"`) únicamente en mutaciones críticas o irreversibles.
3. **Lockheed Martin F-35 PCD & ANSI/ISA-101 Color por Excepción:** `>= 85%` lienzo monocromático neutro (`#000000`/`#F3F4F6` oscuro y `#FFFFFF`/`#0F172A` claro *Sol Atacama*); Cobre `#C68346` reservado a dato protagonista, foco activo o excepción/alerta (ej. talud `> 38°`, cola offline o escala pendiente); Cian `#00AEEF` reservado a verificación IA, nivel IMU óptimo e interactividad técnica. Cero badges de texto largos o decoración "árbol de Navidad".
4. **Mercedes-Benz MBUX Zero-Layer:** Controles estrictamente contextuales sin apilar cabeceras ni barras globales redundantes.
5. **Leica Captivate Field HMI:** Retículas HUD fotogramétricas directas, nivelador IMU (`pitch · roll`) y lectura numérica tabular instantánea bajo radiación solar extrema.

## 3. Reglas Estrictas de UI Móvil (Cero Prosa, Cero Cajas, Zero-Layer)
1. **Cero Prosa:** Prohibida toda prosa, slogans, párrafos explicativos o textos tutoriales. Exclusivamente botones funcionales, datos tabulares, indicadores precisos, gráficos vectoriales e imágenes/mallas 3D finales.
2. **Cero Tarjetas/Cajas con Bordes y Relleno:** En móvil queda prohibido encerrar listados o formularios en tarjetas con borde y relleno. Usar lienzo plano (`#000000` / `#FFFFFF`) con divisores `hairline 1px` (`#12151C` / `#E2E8F0`) y **barra lateral `3px` ISA-101 por excepción** (`#C68346` alerta/cola/escala, `#00AEEF` verificado IA, transparente nominal).
3. **Cabecera Superior Única Contextual (`56px`):** Una única barra superior contextual de `56px` por pantalla. Prohibido apilar `TopBar` + subheaders + banners offline redundantes.
4. **Menú Inicial `MINREPORT`:** Un único icono plano centrado (`#C68346`, target táctil `>= 48px–64px` / zona `88×88px`) sin texto ni caja.
5. **Barra Inferior (`56px`) Exclusiva en Detalle de Acopio:** Se renderiza **únicamente** dentro del detalle de acopio con el botón `CÁMARA` (`add_a_photo`) centrado (`#C68346`). Prohibida barra inferior en faenas, listados de acopios o monitoreo.

## 4. Estándar Visual Dual Foto Real / Malla 3D Digital en Móvil (`ACOPIOS`)
- El detalle de acopio en móvil debe integrar visualización conmutable (`FOTO | 3D`) vía `StockpileVisualStage` + `StockpileTwin3DLazy` en modo `compact={true}`, renderizando fotos optimizadas (con perimetrales y detecciones `box_2d` cuando existan) o mallas 3D `.glb`/TIN con carga diferida e higiene estricta WebGL `dispose()` al desmontar o volver a `FOTO`.
