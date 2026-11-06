# ADN MINREPORT: Manifiesto de Visión y Arquitectura Web 3.0

## 1. Misión Principal
Estandarizar el control operacional minero mediante ingeniería de datos verificables, telemetría de flota y cubicación volumétrica de precisión, garantizando trazabilidad criptográfica bancaria e inferencia resiliente en faena con o sin conectividad.

## 2. Visión Estratégica
Operar desde Google Cloud Santiago (`southamerica-west1`) bajo el estándar de **Minimalismo Industrial Puro** (*Coffee-Tech Engineering & Bauhaus Funcional*), con ergonomía visual ISO 9241-300 / WCAG 2.2 AAA y tolerancia cero a datos no verificados.

## 3. Jerarquía Soberana de 5 Tipos de Cuenta
1. **1º DEV (`DEV_ROOT` / `dev@minreport.com`):** Gobierno de ingeniería en `/dev`, arquitectura núcleo, bóvedas maestras ISO y creación/gestión exclusiva de colaboradores `TEST-PILOT`.
2. **2º ADMIN (`SUPER_ADMIN` / `admin@minreport.com`):** Operación comercial y administrativa de MINREPORT en `/admin`, clientes B2B, aprobaciones EDU, disponibilidad de módulos (`modules_status`) y auditoría criptográfica de `audit_ledger`.
3. **3º TEST-PILOT (`TEST_PILOT` / `PILOT_LEAD`):** Expertos humanos acreditados por `DEV`. Operan mediante HUD transversal e interfaz dedicada en `/pilot` con acceso a todos los módulos integrados (`OPERMAQ` y `STOCKPILE CONTROL`) para simular faenas, registrar observaciones (`pilot_feedback`) y curar la IA interna (`hitl_candidates`).
4. **4º CLIENTES B2B (`B2B`):** Empresas y faenas mineras con aislamiento multi-tenant estricto por `accountId` (`tenantId`).
5. **5º EDU (`EDUCATIONAL`):** Universidades y centros académicos en entorno sandbox controlado (`isEduSandbox: true`).

## 4. Arquitectura de Módulos Nativos Integrados sobre Base de Datos Única
- **Módulos Nativos Integrados (`OPERMAQ` y `STOCKPILE CONTROL`):** Operan 100% integrados en MINREPORT (`/dev` embebido para ingeniería, `/pilot` para simulación experta, y `/opermaq` y `/stockpile` para clientes), compartiendo la **misma base de datos Cloud Firestore y Cloud Storage**, la misma identidad Firebase Auth + Passkeys FIDO2, los mismos contratos Zod (`web/src/contracts/index.ts`), el mismo digestor multimedia CAS (`SHA-256` + `pHash`) y el mismo motor Offline-First (`SyncQueueEngine`). El desarrollo como aplicaciones independientes corresponde a una fase futura fuera de este repositorio.
- **Cinco Capas Web 3.0:**
  1. **Capa 1:** Perímetro Cloudflare Edge + Zaraz (0 KB de scripts analíticos de terceros en cliente y tipografía/iconografía `.woff2` 100% auto-hospedada).
  2. **Capa 2:** React / Vite / Capacitor 6 PWA con ergonomía ISO 9241-300 (`Atkinson Hyperlegible Next` / `Atkinson Hyperlegible Mono`, Cobre `#C68346`, Cian `#00AEEF`, `rounded-none`, `shadow-none`, Proporción Áurea $\Phi$ y secuencia Fibonacci) e higiene de memoria (`dispose()`).
  3. **Capa 3:** Identidad humana Passkeys / WebAuthn FIDO2 + Monetización agéntica M2M bajo `x402Gatekeeper.ts` (`HTTP 402 Payment Required`) y trazabilidad encadenada SHA-256 (`prevHash` + `entryHash`) en `audit-ledger.ts`.
  4. **Capa 4:** Enjambre Gemini AI centralizado en `resilient-ai-client.ts` (`gemini-2.5-pro` ➔ `gemini-2.5-flash` ➔ `gemini-2.5-flash-lite`) con retroceso exponencial + jitter, caché determinista SHA-256 y aprobación humana HITL (`"ACTUALIZAR"`).
  5. **Capa 5:** Persistencia, secretos (Cloud Secret Manager) y cómputo exclusivos en Google Cloud `southamerica-west1` (Santiago, Chile). Prohibición absoluta de Google App Engine.
