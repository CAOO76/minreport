---
name: SEC-SHIELD-ISO27001
description: Motor de seguridad bancaria multi-tenant, cumplimiento de la Ley Chilena de Protección de Datos Personales (Ley N° 19.628 y Nueva Ley N° 21.719), aislamiento por accountId/tenantId, gobernanza de las 5 cuentas (DEV, ADMIN, TEST-PILOT, B2B, EDU) y blindaje de activos bajo estándar ISO 27001.
---

# SEC-SHIELD-ISO27001 & LEY 21.719 CHILE (Seguridad Bancaria y Protección de Datos MINREPORT)

Gobierna el aislamiento multi-tenant, el cumplimiento estricto de la **Ley N° 19.628 y Nueva Ley N° 21.719 de Protección de Datos Personales de Chile**, el control de acceso basado en las 5 cuentas soberanas (`DEV`, `ADMIN`, `TEST-PILOT`, `B2B`, `EDU`) y el blindaje del DOM en **MINREPORT**.

## 1. Reglas de Seguridad, Privacidad Legal y Aislamiento
1. **Cumplimiento Ley N° 19.628 y Nueva Ley N° 21.719 (Chile):**
   - **Residencia Exclusiva:** Todo dato y archivo reside en `southamerica-west1` (Santiago de Chile). Prohibido usar servicios de consumo de terceros (Google Drive personal, NotebookLM externo, Colab) para alojar o procesar fuentes privadas de MINREPORT.
   - **Motor Propio Símil NotebookLM:** Las fuentes privadas se gestionan exclusivamente con código propio (`CasStorageService`, `SegmentedDocumentProcessorService` y `vaultChatService` en modo `SOVEREIGN_VAULT_FIRST`).
   - **Esclusa Zero-Trust Pre-Inferencia (`ConfidentialityAirlockService`):** Purga determinista obligatoria de RUTs chilenos, patentes PPU, teléfonos `+56`, correos, coordenadas GPS de faena y contratos antes de cualquier inferencia IA con contexto `tenantId` o promoción al catálogo común (`COMMONS`), más desenfoque óptico `sharp` de rostros, patentes y logos de clientes en imágenes.
2. **Aislamiento Multi-Tenant Estricto:**
   - Toda consulta o escritura de clientes `B2B` y `EDU` en Firestore (`tenant_assets`, `stockpiles`, `inspections`, `financial_events`) y Cloud Storage (`cas_blobs/tenants/{tenantId}/**`) debe validar pertenencia a la cuenta (`isAccountMember(tenantId)`).
   - Los usuarios `DEV` (`DEV_ROOT`), `ADMIN` (`SUPER_ADMIN`) y `TEST-PILOT` (`TEST_PILOT` / `PILOT_LEAD`) operan bajo permisos explícitos de auditoría, curación de bóvedas (`global_asset_catalog`, `hitl_candidates`, `pilot_feedback`) y simulación controlada.
3. **Blindaje de Activos e Interfaz:**
   - Imágenes y SVGs con `draggable={false}`, `-webkit-user-drag: none` y `select-none pointer-events-none`.
   - Layouts estáticos con `select-none`; `select-text` habilitado únicamente en inputs y códigos operativos.
4. **Cero Secretos en Cliente y Centralización IA:**
   - Ninguna llave privada o API Key de IA (`GEMINI_API_KEY`, `RESEND_API_KEY`) puede exponerse en variables `VITE_*` del navegador.
   - Prohibido instanciar `new GoogleGenAI` fuera de `src/core/resilient-ai-client.ts`.
