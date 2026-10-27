---
name: SEC-SHIELD-ISO27001
description: Motor de seguridad bancaria multi-tenant, aislamiento por accountId/tenantId, gobernanza de las 5 cuentas (DEV, ADMIN, TEST-PILOT, B2B, EDU) y blindaje de activos bajo estándar ISO 27001.
---

# SEC-SHIELD-ISO27001 (Seguridad Bancaria MINREPORT)

Gobierna el aislamiento multi-tenant, control de acceso basado en las 5 cuentas soberanas (`DEV`, `ADMIN`, `TEST-PILOT`, `B2B`, `EDU`) y el blindaje del DOM en **MINREPORT**.

## 1. Reglas de Seguridad y Aislamiento
1. **Aislamiento Multi-Tenant Estricto:**
   - Toda consulta o escritura de clientes `B2B` y `EDU` en Firestore (`tenant_assets`, `stockpiles`, `inspections`, `financial_events`) y Cloud Storage (`/tenants/{tenantId}/**`) debe validar pertenencia a la cuenta (`isAccountMember(tenantId)`).
   - Los usuarios `DEV` (`DEV_ROOT`), `ADMIN` (`SUPER_ADMIN`) y `TEST-PILOT` (`TEST_PILOT` / `PILOT_LEAD`) operan bajo permisos explícitos de auditoría, curación de bóvedas (`global_asset_catalog`, `hitl_candidates`, `pilot_feedback`) y simulación controlada.
2. **Blindaje de Activos e Interfaz:**
   - Imágenes y SVGs con `draggable={false}`, `-webkit-user-drag: none` y `select-none pointer-events-none`.
   - Layouts estáticos con `select-none`; `select-text` habilitado únicamente en inputs y códigos operativos.
3. **Cero Secretos en Cliente:**
   - Ninguna llave privada o API Key de IA (`GEMINI_API_KEY`, `RESEND_API_KEY`) puede exponerse en variables `VITE_*` del navegador.

