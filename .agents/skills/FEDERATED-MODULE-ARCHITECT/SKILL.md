---
name: FEDERATED-MODULE-ARCHITECT
description: Arquitecto Principal de Módulos Nativos Integrados sobre Base de Datos Única y Gobernanza de las 5 Cuentas Soberanas de MINREPORT (DEV, ADMIN, TEST-PILOT, B2B, EDU).
---

# FEDERATED-MODULE-ARCHITECT (MINREPORT Web 3.0)

Esta skill gobierna la arquitectura de todos los módulos operativos de **MINREPORT** (`OPERMAQ`, `STOCKPILE CONTROL` y futuros módulos industriales), garantizando que operen como **Módulos Nativos Integrados** dentro de MINREPORT sobre una única fuente de verdad.

## 1. Reglas Inviolables de Unidad de Datos y Contexto
1. **Prohibición Total de SDKs Legacy y Mocks:** Queda estrictamente prohibido crear o importar `@minreport/sdk`, `MockSecureContext`, `core-sdk-shield`, `plugin.ts` o stubs de Firebase que devuelvan `null`.
2. **Base de Datos e Instancia Firebase Única (`southamerica-west1`):**
   - Todos los módulos deben importar `{ app, auth, db, storage }` desde `web/src/config/firebase.ts`.
   - Toda mutación offline debe encolarse mediante `SyncQueueEngine` (`web/src/core/offline/SyncQueueEngine.ts`) y validarse contra los esquemas Zod canónicos de `web/src/contracts/index.ts`.
3. **Contexto Compartido (`AuthContext`, `MinReportSessionContext`, `ThemeContext`, `BrandingContext`, `i18n`):**
   - Ningún módulo puede instanciar su propio `i18n.init()` destructivo ni mantener un `localStorage` de tema o idioma desconectado del núcleo. Las traducciones de módulos se agregan mediante `i18n.addResourceBundle(lng, 'translation', bundle, true, true)`.

## 2. Operación Integrada en el Espacio de Trabajo (`embedded`)
- **Dentro de `DEV` (`/dev` — `DevVaultGateway.tsx`):** Todos los módulos (`OPERMAQ`, `STOCKPILE CONTROL`) y secciones administrativas se renderizan **100% embebidos** dentro del área `<main>` de `DEV`, sin saltar a rutas externas (`navigate('/opermaq')`, `navigate('/stockpile')`, `navigate('/b2b/*')`).
- **Layout Integrado (`embedded = true`):** Los módulos utilizan `h-full w-full flex-1` (nunca `h-screen w-screen`), sub-headers compactos con botones de icono planos (`material-symbols-outlined`, sin texto adosado) y delegan el header global y la sesión al contenedor de MINREPORT.
- **Desarrollo Standalone Pendiente:** El desarrollo de aplicaciones independientes está pendiente para una fase posterior y **no debe insertarse como shell paralelo dentro de MINREPORT**.

## 3. Jerarquía Soberana de 5 Tipos de Cuenta
Todo módulo y endpoint debe reconocer y respetar los 5 niveles de identidad:
1. **`1º DEV` (`DEV_ROOT` / `dev@minreport.com`):** Control total de ingeniería, bóvedas maestras ISO, monitoreo pasivo de métricas de usuarios `TEST-PILOT` (`[Desarrollo pendiente]`) y acceso exclusivo actual a la versión móvil de pruebas `MINREPORT TEST` (`com.minreport.app.fieldtest`). Prohibidas las funciones operativas `TEST-PILOT` en `/dev`.
2. **`2º ADMIN` (`SUPER_ADMIN` / `admin@minreport.com`):** Operación comercial de MINREPORT, gestión B2B/EDU y disponibilidad de módulos.
3. **`3º TEST-PILOT` (`TEST_PILOT` / `PILOT_LEAD`):** Interfaz `/pilot` 100% independiente y hermética respecto de `DEV`, `ADMIN`, `B2B` y `EDU` (cero HUD transversal en otros módulos). Idéntica a la interfaz `4º B2B` final (`OPERMAQ` en modo cliente + `GEOLAPP®` sobre sandbox `pilot-*`, sin acceso al catálogo maestro `CATALOG`), preparada para incorporar posteriormente módulos de interacción con IA para corregir, mejorar y opinar.
4. **`4º CLIENTES B2B` (`OWNER`, `ADMIN`, `SUPERVISOR`, `OPERATOR`, `VIEWER`, `BILLING_ONLY`):** Aislamiento estricto por `tenantId` (`accountId`).
5. **`5º EDU` (`STUDENT`, `PROFESSOR`):** Entorno académico controlado (`isEduSandbox: true`).

