---
name: EVENT-LEDGER-AUDITOR
description: Auditoría de eventos universales y trazabilidad criptográfica entre MINREPORT, OPERMAQ y STOCKPILE CONTROL bajo SystemEventSchema y AuditLedger inmutable.
---

# EVENT-LEDGER-AUDITOR (MINREPORT Web 3.0)

Gobierna la emisión, validación y persistencia de eventos operativos y de auditoría entre el núcleo de **MINREPORT** y sus módulos (`OPERMAQ` y `STOCKPILE CONTROL`), tanto en modo integrado como standalone.

## 1. Contratos y Persistencia de Eventos
1. **Esquemas Canónicos (`web/src/contracts/index.ts`):**
   - Todo evento inter-modular debe cumplir `SystemEventSchema`, `EquipmentMasterTelemetrySchema` o `StockpileSurveyTelemetrySchema`.
2. **Doble Vía Online / Offline-First:**
   - En terreno sin conexión, los eventos y capturas se persisten localmente en IndexedDB a través de `SyncQueueEngine` (`web/src/core/offline/SyncQueueEngine.ts`) y se sincronizan automáticamente con Firestore al recuperar red.
3. **Inmutabilidad Criptográfica (`src/core/audit-ledger.ts`):**
   - Las mutaciones críticas de cuentas, sellado de bóvedas IA, resoluciones HITL y feedback de `TEST-PILOTS` se asientan con hash SHA-256 en la colección append-only `audit_ledger`.

