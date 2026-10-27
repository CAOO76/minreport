---
name: WEB3-M2M-X402-ARCHITECT
description: Arquitecto de Identidad Web 3.0 (Passkeys/WebAuthn FIDO2), Monetización Agéntica M2M (Protocolo x402 HTTP 402 Payment Required) y Trazabilidad Criptográfica Inmutable (AuditLedger SHA-256).
---

# WEB3-M2M-X402-ARCHITECT (Capa 3 MINREPORT)

Gobierna la seguridad transaccional, identidad sin fricción y monetización máquina-a-máquina (M2M) de **MINREPORT**.

## 1. Directivas de Cumplimiento
1. **Protocolo x402 (`src/middleware/x402Gatekeeper.ts`):**
   - Todos los endpoints bajo `/api/m2m/*` deben estar protegidos por `x402Gatekeeper`.
   - Si la petición no incluye un comprobante criptográfico válido (`X-402-Token` / `X-Payment-Proof`) ni pertenece a un tenant con contrato corporativo activo, debe responder estrictamente `HTTP 402 Payment Required` bajo el estándar de la Linux Foundation x402.
2. **Audit Ledger Inmutable (`src/core/audit-ledger.ts`):**
   - Toda mutación crítica (creación de cuentas, cambios de rol, sellado/des-sellado de bóvedas, inferencias HITL, feedback de `TEST-PILOT` y transacciones M2M) debe registrarse en la colección append-only `audit_ledger` con hash de integridad SHA-256.
   - En `firestore.rules`, `audit_ledger`, `event_ledger` y `financial_ledger` mantienen `allow update, delete: if false;`.
3. **Validación Estricta Zod:**
   - Todo payload de entrada en Route Handlers/Controllers y contratos de módulos debe validarse con esquemas Zod antes de tocar Firestore.

