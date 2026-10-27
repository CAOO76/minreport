# ADN MINREPORT: Manifiesto de Visión y Arquitectura Web 3.0

## 1. Misión Principal
Transformar la minería mediante ingeniería de control, telemetría de maquinaria y cubicación volumétrica de alta precisión, democratizando el acceso a inteligencia operativa, trazabilidad bancaria e inferencia resiliente en faena.

## 2. Visión Estratégica
Consolidarse como el estándar operativo y de reportabilidad minera desde Chile (`southamerica-west1`) hacia LATAM y mercados globales bajo el paradigma de **Minimalismo Industrial Puro** (*Coffee-Tech Engineering & Bauhaus Funcional*).

## 3. Jerarquía Soberana de 5 Tipos de Cuenta
1. **1º DEV (`DEV_ROOT` / `dev@minreport.com`):** Gobierno de ingeniería, arquitectura núcleo, bóvedas maestras ISO y creación/gestión exclusiva de colaboradores `TEST-PILOT`.
2. **2º ADMIN (`SUPER_ADMIN` / `admin@minreport.com`):** Operación comercial y administrativa del negocio MINREPORT, contratos B2B, aprobaciones EDU, disponibilidad de módulos y auditoría del ledger.
3. **3º TEST-PILOT (`TEST_PILOT` / `PILOT_LEAD`):** Expertos humanos de dominio minero acreditados por `DEV`. Operan con interfaz y HUD transversal dedicado sobre todos los módulos (integrados e independientes) para simular proyectos mineros, comentar en contexto, solicitar correcciones y entrenar/curar la IA interna de MINREPORT (`hitl_candidates`, `pilot_feedback`).
4. **4º CLIENTES B2B (`B2B`):** Empresas y faenas mineras con aislamiento multi-tenant estricto por `accountId` (`tenantId`).
5. **5º EDU (`EDUCATIONAL`):** Universidades y centros académicos en entorno sandbox controlado (`isEduSandbox: true`).

## 4. Arquitectura Polimórfica Dual-Mode (Versión 3.0.0)
- **Módulos Nativos Federados (`OPERMAQ` y `STOCKPILE CONTROL`):** Operan 100% integrados en el núcleo de MINREPORT (`/opermaq`, `/stockpile`) y, simultáneamente, pueden ejecutarse y desplegarse como aplicaciones independientes (Standalone PWA / Capacitor App / Dominios dedicados) compartiendo **una única base de datos Cloud Firestore y Cloud Storage**, la misma identidad Firebase Auth, los mismos contratos Zod (`web/src/contracts/index.ts`) y el mismo motor Offline-First (`SyncQueueEngine`).
- **Cinco Capas Web 3.0:**
  1. **Capa 1:** Perímetro Cloudflare Edge + Zaraz (0 KB de scripts de terceros en cliente).
  2. **Capa 2:** React / Vite / Capacitor 6 PWA con ergonomía ISO 9241-300 (`Atkinson Hyperlegible Next` / `Mono`, Cobre `#C68346`, Cian `#00AEEF`, `rounded-none`, `shadow-none`, Proporción Áurea $\Phi$ y secuencia Fibonacci) e higiene GPU (`dispose()`).
  3. **Capa 3:** Identidad FIDO2 / Passkeys + Monetización M2M bajo protocolo `x402Gatekeeper.ts` (`HTTP 402 Payment Required`) y trazabilidad SHA-256 en `audit-ledger.ts`.
  4. **Capa 4:** Enjambre Gemini AI centralizado en `resilient-ai-client.ts` (`gemini-2.5-pro` ➔ `gemini-2.5-flash` ➔ `gemini-2.5-flash-lite`) con caché determinista SHA-256 y aprobación humana HITL (`"ACTUALIZAR"`).
  5. **Capa 5:** Persistencia y cómputo exclusivos en Google Cloud `southamerica-west1` (Santiago, Chile). Prohibición absoluta de Google App Engine.

---
*Este documento constituye la fuente de verdad estratégica de MINREPORT Web 3.0.*
