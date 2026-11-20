---
name: FEDERATED-MODULE-ARCHITECT
description: Arquitecto Principal de Módulos Nativos Integrados sobre Base de Datos Única, Gobernanza de las 5 Cuentas Soberanas (DEV, ADMIN, TEST-PILOT, B2B, EDU) y Minimalismo Operativo Absoluto (HMI Aeroespacial & Industrial) de MINREPORT.
---

# FEDERATED-MODULE-ARCHITECT (MINREPORT Web 3.0)

Esta skill gobierna la arquitectura de todos los módulos operativos bajo la marca única **MINREPORT** —**`OPERMAQ`** (`moduleId`: `opermaq`), **`ACOPIOS`** (`moduleId` técnico interno: `stockpile`, ruta cliente `/acopios`, móvil DEV `/mobile/dev-acopios`) y futuros módulos industriales— garantizando que operen como **Módulos Nativos Integrados** sobre una única fuente de verdad. Quedan **estrictamente prohibidas** toda sub-marca comercial heredada o denominación paralela para el módulo de acopios.

## 1. Reglas Inviolables de Unidad de Datos, Web 3.0 y Contexto
1. **Prohibición Total de SDKs Legacy y Mocks:** Queda estrictamente prohibido crear o importar `@minreport/sdk`, `MockSecureContext`, `core-sdk-shield`, `plugin.ts` o stubs de Firebase que devuelvan `null`.
2. **Base de Datos e Instancia Firebase Única (`southamerica-west1`) y Ley N° 21.719 / N° 19.628:**
   - Todos los módulos importan `{ app, auth, db, storage }` desde `web/src/config/firebase.ts`, cumplen residencia exclusiva en `southamerica-west1` (cero App Engine), aplican `ConfidentialityAirlockService` / `resilient-ai-client.ts`, registran mutaciones críticas en `audit-ledger.ts` y procesan medios bajo CAS SHA-256 + `dHash` 64-bit (`MINREPORT-MEDIA-DIGESTOR-CAS`).
   - Toda mutación offline debe encolarse mediante `SyncQueueEngine` (`web/src/core/offline/SyncQueueEngine.ts`) y validarse contra los esquemas Zod canónicos de `web/src/contracts/index.ts`.
3. **Contexto Compartido (`AuthContext`, `MinReportSessionContext`, `ThemeContext`, `BrandingContext`, `i18n`):**
   - Ningún módulo puede instanciar su propio `i18n.init()` destructivo ni mantener un `localStorage` de tema o idioma desconectado del núcleo. Las traducciones de módulos se agregan mediante `i18n.addResourceBundle(lng, 'translation', bundle, true, true)`.

## 2. Operación Integrada en el Espacio de Trabajo (`embedded`)
- **Dentro de `DEV` (`/dev` — `DevVaultGateway.tsx`):** Todos los módulos (`OPERMAQ`, `ACOPIOS`) y secciones administrativas se renderizan **100% embebidos** dentro del área `<main>` de `DEV`, sin saltar a rutas externas (`navigate('/opermaq')`, `navigate('/acopios')`, `navigate('/stockpile')`, `navigate('/b2b/*')`).
- **Layout Integrado (`embedded = true`):** Los módulos utilizan `h-full w-full flex-1` (nunca `h-screen w-screen`), controles contextuales sin cabeceras apiladas (MBUX Zero-Layer) con botones de icono planos (`material-symbols-outlined`, sin texto adosado) y delegan el header global y la sesión al contenedor de MINREPORT.
- **Desarrollo Standalone Pendiente:** El desarrollo de aplicaciones independientes está pendiente para una fase posterior y **no debe insertarse como shell paralelo dentro de MINREPORT**.

## 3. Jerarquía Soberana de 5 Tipos de Cuenta
Todo módulo y endpoint debe reconocer y respetar los 5 niveles de identidad:
1. **`1º DEV` (`DEV_ROOT` / `dev@minreport.com`):** Control total de ingeniería, bóvedas maestras ISO, monitoreo pasivo de métricas de usuarios `TEST-PILOT` (`[Desarrollo pendiente]`) y acceso exclusivo actual a la versión móvil de pruebas `MINREPORT TEST` (`com.minreport.app.fieldtest`). Prohibidas las funciones operativas `TEST-PILOT` en `/dev`.
2. **`2º ADMIN` (`SUPER_ADMIN` / `admin@minreport.com`):** Operación comercial de MINREPORT, gestión B2B/EDU y disponibilidad de módulos.
3. **`3º TEST-PILOT` (`TEST_PILOT` / `PILOT_LEAD`):** Interfaz `/pilot` 100% independiente y hermética respecto de `DEV`, `ADMIN`, `B2B` y `EDU` (cero HUD transversal en otros módulos). Idéntica a la interfaz `4º B2B` final (`OPERMAQ` y `ACOPIOS` —`moduleId`: `stockpile`— en modo cliente sobre sandbox `pilot-*`, sin acceso al catálogo maestro `CATALOG`), preparada para incorporar posteriormente módulos de interacción con IA para corregir, mejorar y opinar.
4. **`4º CLIENTES B2B` (`OWNER`, `ADMIN`, `SUPERVISOR`, `OPERATOR`, `VIEWER`, `BILLING_ONLY`):** Aislamiento estricto por `tenantId` (`accountId`).
5. **`5º EDU` (`STUDENT`, `PROFESSOR`):** Entorno académico controlado (`isEduSandbox: true`).

## 4. Minimalismo Operativo Absoluto (HMI Aeroespacial, Móvil Plano y Visual Dual `ACOPIOS`)
1. **Referentes HMI Obligatorios en Todos los Módulos:**
   - **NASA OpenMCT & NASA-STD-3001:** Fusión de telemetría en vivo + curva evolutiva + evidencia visual en un único lienzo sin saltos ni prosa explicativa.
   - **SpaceX Dragon Touchscreen HMI:** *Dark Cockpit* silencioso en estado nominal, targets táctiles aptos para guantes/vibración (`>= 48px–64px`) y gates HITL (`"ACTUALIZAR"`) únicamente en mutaciones críticas o irreversibles.
   - **Lockheed Martin F-35 PCD & ANSI/ISA-101:** Color por Excepción (`>= 85%` lienzo monocromático neutro `#000000`/`#F3F4F6` oscuro y `#FFFFFF`/`#0F172A` claro *Sol Atacama*; `#C68346` dato protagonista/foco/excepción ej. talud `> 38°` o cola offline; `#00AEEF` verificación IA, nivel IMU óptimo e interactividad técnica). Cero badges de texto largos o decoración "árbol de Navidad".
   - **Mercedes-Benz MBUX Zero-Layer & Leica Captivate Field HMI:** Controles contextuales (cero barras redundantes apiladas), legibilidad WCAG 2.2 AAA con `Atkinson Hyperlegible Next/Mono` (`tabular-nums`), `rounded-none`, `shadow-none`, `M3Switch`, `M3LinearProgress` (`4px`, `gap 4px`, `stop indicator 4×4px`), `M3CircularProgress` y `<form>`/`<input>` con `autoComplete="off"` `spellCheck={false}`.
2. **Estándar Móvil Plano:** Cero prosa/slogans/párrafos/tutoriales; cero tarjetas con bordes y relleno (lienzo plano con divisores `hairline 1px` y barra lateral `3px` ISA-101 por excepción); cabecera única contextual `56px`; menú inicial `MINREPORT` con único icono plano centrado sin texto ni caja; barra inferior `56px` exclusiva en detalle de acopio con botón `CÁMARA` centrado.
3. **Estándar Visual Dual Foto Real / Malla 3D (`ACOPIOS`):** Escritorio (`FOTO | 3D | DUAL`) y móvil (`FOTO | 3D`) mediante `StockpileVisualStage` + `StockpileTwin3DLazy` (`compact` mode), con perimetrales, `box_2d`, `.glb`/TIN, carga diferida e higiene WebGL `dispose()` al desmontar o conmutar.
