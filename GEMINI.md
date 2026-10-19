# MINREPORT — Reglas Soberanas y Exclusivas del Workspace

> **Jerarquía y Precedencia:** Este archivo define las directivas **soberanas, de mayor jerarquía y cumplimiento estricto** para el proyecto **MINREPORT**.  
> **Cláusula de Anulación Expresa de CABISEG:** Todas las directivas correspondientes a CABISEG (incluidos colores `#FFCD00`, fuentes `Google Sans` o lineamientos de marca externa) quedan **TOTALMENTE ANULADAS Y ESTRICTAMENTE PROHIBIDAS** en este repositorio.

---

## 1. Identidad y Entorno de Proyecto

- **Proyecto:** MINREPORT
- **URL de Acceso Clientes:** `https://minreport-access.web.app`
- **Naturaleza:** Plataforma de reportería y analítica industrial de alta precisión y accesibilidad ergonómica para la minería.
- **Región Google Cloud Obligatoria:** `southamerica-west1` (Santiago, Chile) para TODOS los servicios.
- **PROHIBICIÓN ABSOLUTA:** Google App Engine y cualquier servicio dependiente de él.
- **Integridad de Datos:** Prohibido reiniciar o eliminar colecciones de bases de datos, datos de emuladores locales (`.firebase-emulator-data`) o el usuario super-admin durante el ciclo de desarrollo.
- **Servicios Permitidos:** Cloud Firestore, Cloud Storage, Cloud Functions Gen 2, Cloud Run, Firebase Hosting / Firebase App Hosting, Cloud Secret Manager.

---

## 2. Arquitectura Web 3.0 Híbrida (5 Capas MINREPORT)

1. **Capa 1 — Perímetro Cloudflare Edge:** WAF y proxy activado. Scripts analíticos y telemetría exclusivamente en el edge (Cloudflare Zaraz / Server-Side en Cloud Run). Cero scripts de terceros en el hilo principal del cliente.
2. **Capa 2 — Framework de Presentación y Rendimiento Espacial:**
   - Stack: Vite / React / Capacitor 6 PWA (o Next.js App Router en módulos SSR).
   - Rendimiento Core Web Vitals: LCP < 1.2s, INP < 100ms, CLS < 0.02.
   - Cero fetching bloqueante en el render path. Carga diferida obligatoria para 3D/Canvas con fallback HUD ligero y liberación WebGL (`dispose()`).
   - Priorizar CSS Scroll-Driven Animations nativas (`animation-timeline: scroll()`) para interacción con scroll con 0 KB de JS.
3. **Capa 3 — Lógica Transaccional, Identidad y Monetización M2M:**
   - Endpoints `/api/m2m/*` protegidos con `x402Gatekeeper.ts`. Sin token o pago válido responder obligatoriamente `HTTP 402 Payment Required` (estándar x402 Foundation).
   - Doble capa de identidad: Passkeys / WebAuthn biométrico FIDO2 para usuarios + autenticación criptográfica agéntica M2M.
   - Validación tipada exhaustiva de payloads con Zod. Mutaciones críticas en `audit-ledger.ts` (Firestore append-only).
4. **Capa 4 — Enjambre Gemini AI (Inferencia Resiliente):**
   - Cliente centralizado `resilient-ai-client.ts`. Enjambre jerárquico: Pro (análisis crítico), Flash (estabilidad operativa), Flash-Lite (alta disponibilidad, < 400ms).
   - Algoritmo de retroceso exponencial con jitter: $D(n) = \min(32s, 2.0s \times 2^n) + \text{jitter}(0, 1s)$.
   - HITL obligatorio en mutaciones de datos maestros y configuraciones operativas.
5. **Capa 5 — Persistencia y Cómputo (Google Cloud Santiago):** Cloud Firestore, Cloud Run y Cloud Secret Manager. Secretos gestionados exclusivamente en Secret Manager, nunca hardcodeados en `.env`.

---

## 3. Estándar Universal de UI/UX: Minimalismo Industrial Puro (MINREPORT)

Inspirado en la ingeniería técnica de alta gama (*Coffee-Tech Engineering* y *Bauhaus Funcional*).

### 3.1 Cero Verborrea y Veracidad Técnica Absoluta
- **Lenguaje Quirúrgico:** Todo texto debe ser técnico, conciso, aséptico y funcional. Prohibida la prosa publicitaria ("la mejor plataforma", "innovación líder") o textos decorativos.
- **Tolerancia Cero a Datos Falsos e Indicadores Ficticios:** Prohibido inventar datos, métricas o descripciones no verificadas. Prohibidos badges decorativos ficticios ("V2.6 PRO", "SYSTEM SECURED", "100% OPERATIVO"). Lo no comprobado figura vacío o como:
  `[Información técnica no declarada en ficha]` o `[Pendiente de registro]`.
- **Protagonismo del Dato:** Los valores operacionales y gráficos respiran en amplio espacio negativo con iluminación sutil (*hero glow*), sin confinamiento en cajas abarrotadas.

### 3.2 Tipografía Exclusiva y Ergonomía ISO 9241-300 / WCAG 2.2 AAA
- **Tipografía de Interfaz y Lectura:** **`Atkinson Hyperlegible Next`** (alta diferenciación para visibilidad en faena).
- **Tipografía de Datos Numéricos y Tablas:** **`Atkinson Hyperlegible Mono`** (alineación tabular obligatoria).
- **PROHIBICIÓN ABSOLUTA:** Google Sans, Roboto, Inter o cualquier otra fuente no autorizada.
- **Alineación Numérica Tabular:**
  Todas las tablas técnicas, inventarios, códigos SKU y métricas deben usar:
  `font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1, 'cv05' 1;` y clase `tabular-nums font-mono`.
- **Escala de Tokens Ergonómicos:**
  - `text-hero-display`: `clamp(2.5rem, 6vw, 5rem)` — lineHeight: 0.95, letterSpacing: -0.03em, weight: 700.
  - `text-kpi-display`: `2.25rem` (36px) — lineHeight: 1.15, letterSpacing: -0.02em, weight: 700, tabular-nums.
  - `text-h1-header`: `1.375rem` (22px) — lineHeight: 1.25, letterSpacing: -0.01em, weight: 600.
  - `text-h2-section`: `1.0625rem` (17px) — lineHeight: 1.35, letterSpacing: 0em, weight: 600.
  - `text-body-main`: `0.9375rem` (15px) — lineHeight: 1.45, letterSpacing: 0em, weight: 400.
  - `text-data-dense`: `0.8125rem` (13px) — lineHeight: 1.35, letterSpacing: 0.01em, weight: 400, tabular-nums.
  - `text-microcopy`: `0.6875rem` (11px) — lineHeight: 1.20, letterSpacing: 0.05em, uppercase, weight: 700.
- **Jerarquía Neutra por Opacidad (Mitigación de Halación):**
  - `text-primary`: `#F3F4F6` (dark) / `#0F172A` (light) — Datos y títulos primarios.
  - `text-secondary`: `#8A93A6` (dark) / `#475569` (light) — Lectura y especificaciones.
  - `text-disabled`: `#5A6072` (dark) / `#94A3B8` (light) — Metadatos y datos no declarados.

### 3.3 Paleta Cromática y Acentos Oficiales MINREPORT
- **Acento Primario Oficial:** **`#C68346` (Cobre Industrial MINREPORT)**. Exclusivo de la identidad minera. Prohibido el amarillo `#FFCD00`.
- **Acento Secundario Técnico:** **`#00AEEF` (Cian Tecnológico)** para enlaces de ingeniería, estados activos y sellos verificados.
- **Fondos Modo Oscuro:** Base `#000000` / Superficie y Paneles `#07090D` / Bordes `#12151C`.
- **Fondos Modo Claro:** Base `#FFFFFF` / Superficie y Paneles `#F8FAFC` / Bordes `#E2E8F0`.
- **Soporte Dual Obligatorio:** Todo componente DEBE incluir variantes completas para modo claro y modo oscuro (`dark:`). Prohibidas vistas exclusivas para un solo modo.

### 3.4 Geometría Industrial Pura
- **Bordes:** `borderRadius: 0px` (`rounded-none` estricto en tarjetas, inputs, botones, switches y modales).
- **Sombras:** `boxShadow: none` (`shadow-none` estricto). Prohibido el neomorfismo y las sombras difusas ornamentales.

### 3.5 Macro-Layout Paramétrico (Proporción Áurea) y Micro-Espaciado Fibonacci
- **Macro-Layout $\Phi$:**
  - Área Mayor ($\Phi \approx 61.8\%$): Hero monumental, gemelo 3D, gráfico analítico o informe técnico principal.
  - Área Menor ($1 - \Phi \approx 38.2\%$): Drawer lateral de ingeniería, controles de mando o sellos normativos.
  - Prohibida la división simétrica arbitraria (50/50) cuando existe un elemento protagonista.
- **Micro-Espaciado Estricto (Fibonacci):**
  - `fib-8` (`8px`): Micro-gap entre tags y chips.
  - `fib-13` (`13px`): Espaciado en tablas densas y formularios compactos.
  - `fib-21` (`21px`): Espaciado estándar entre tarjetas, filas y componentes.
  - `fib-34` (`34px`): Separación entre bloques y secciones medianas.
  - `fib-55` (`55px`): Márgenes mayores de bloque y paddings de contenedor.
  - `fib-89` (`89px`): Separación de pantalla monumental y transiciones.

### 3.6 Iconografía Exclusiva y Botones Planos
- **Fuente de Iconos Exclusiva:** **Material Symbols Outlined** (`material-symbols-outlined`). Prohibido `material-symbols-rounded` o librerías externas de iconos.
- **Prohibición Total de Emojis:** Sustituidos por códigos ISO alfanuméricos (`CL`, `US`, `EU`) o glifos de Material Symbols.
- **Botones de Iconos Planos y Transparentes:**
  `bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer`
- **Prohibición Expresa:**
  - Prohibido encerrar iconos en cajas con fondos de color o bordes decorativos.
  - Prohibido adosar texto descriptivo redundante al lado del icono (ej. `[icono_lupa] Buscar`).

### 3.7 Componente Switch Estándar
- **Componente Obligatorio:** `M3Switch` (Material Design 3) o `SDKSwitch`.
- **PROHIBIDO:** Usar `AdminSwitch` u otros switches con bordes redondeados cosméticos.

### 3.8 Gobernanza de Datos: Modo Informe vs Edición Quirúrgica (HITL)
- **Modo Informe Técnico por Defecto:** Las pantallas de fichas técnicas, normativas y administración se presentan estructuradas como informe oficial (solo lectura), nunca como formularios editables permanentes.
- **Edición Quirúrgica por Lápiz (`edit`):** Activación puntual por bloque mediante icono de lápiz plano transparente.
- **Confirmación Obligatoria por Palabra Clave:** Toda modificación manual en registros oficiales exige escribir obligatoriamente `"ACTUALIZAR"` para habilitar el guardado.
- **Aprobación Granular 1 a 1 de IA (HITL):** Sugerencias de IA en vista comparativa (`[Actual] ➔ [Sugerido]`), autorizadas campo por campo antes de guardar.
- **Seguridad en Formularios:** `autocomplete="off"` y `spellCheck={false}` obligatorios en todos los `<form>` e `<input>`.

### 3.9 Blindaje de Activos y Seguridad de Interfaz
- **Blindaje de Medios:** Imágenes y SVGs con `draggable={false}`, CSS `-webkit-user-drag: none;` y clases `select-none pointer-events-none`.
- **Gobierno de Selección de Texto:** `select-none` en layouts y tarjetas estáticas. `select-text` habilitado exclusivamente en códigos operativos (SKUs, normativas) acompañado de botón de copia.

---

## 4. Checklist de Pre-Generación Obligatorio (Guardrail Inviolable)

Antes de generar o modificar cualquier componente, interfaz o estilo en MINREPORT, el modelo DEBE validar internamente los siguientes 10 puntos de corte. **Si falla uno solo, el código debe corregirse antes de emitirlo**:

1. [ ] **Tipografía:** ¿Usa únicamente `Atkinson Hyperlegible Next` y `Atkinson Hyperlegible Mono`? (Cero Google Sans, Roboto o Inter).
2. [ ] **Color:** ¿El acento es Cobre Industrial `#C68346` y Cian `#00AEEF`? (Cero amarillo CABISEG `#FFCD00`).
3. [ ] **Soporte Dual:** ¿Cada clase de fondo, texto y borde tiene su contraparte `dark:` completa?
4. [ ] **Geometría:** ¿Todos los contenedores, botones e inputs son `rounded-none` / `0px`? (Cero `rounded-lg`, `rounded-md`, `rounded-full`).
5. [ ] **Sombras:** ¿Está libre de sombras decorativas difusas o neomorfismo (`shadow-none`)?
6. [ ] **Verborrea:** ¿El texto es quirúrgico, aséptico y libre de adjetivación publicitaria?
7. [ ] **Veracidad:** ¿Está libre de badges o estados inventados ("PRO", "ONLINE", "SECURED") y los datos ausentes muestran `[Información técnica no declarada en ficha]`?
8. [ ] **Iconos:** ¿Usa exclusivamente `material-symbols-outlined`, planos, sin texto adosado y sin marcos en caja?
9. [ ] **Formularios:** ¿Incluye `autocomplete="off"` y `spellCheck={false}`?
10. [ ] **Métricas:** ¿Los números y tablas usan `tabular-nums font-mono` y espaciado de Fibonacci (`fib-8` a `fib-89`)?
