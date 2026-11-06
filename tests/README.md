# Suite E2E Playwright — MINREPORT

## Arquitectura de Pruebas

La suite valida la aplicación unificada `web/` (`http://localhost:5173`) y la API `minreport-api` (`http://localhost:8080`) sobre los emuladores oficiales de Firebase, respetando la jerarquía de **5 Cuentas Soberanas**:

1. **1º DEV (`DEV_ROOT`):** `/dev` — Ingeniería núcleo, bóvedas ISO y acreditación `TEST-PILOT`.
2. **2º ADMIN (`SUPER_ADMIN`):** `/admin` — Operación comercial B2B, aprobaciones `EDU`, `modules_status` y auditoría de `audit_ledger`.
3. **3º TEST-PILOT (`TEST_PILOT` / `PILOT_LEAD`):** `/pilot` + HUD transversal — Simulación minera y curación HITL (`pilot_feedback`, `hitl_candidates`).
4. **4º CLIENTES B2B (`B2B`):** Aislamiento multi-tenant estricto por `accountId` / `tenantId`.
5. **5º EDU (`EDUCATIONAL`):** Entorno académico controlado (`isEduSandbox: true`).

## Regla de Integridad de Datos

- `tests/utils/db-seeder.ts` opera de forma **estrictamente idempotente (`merge: true`)**.
- Queda prohibido reiniciar colecciones, eliminar usuarios protegidos o detener los emuladores locales en `global-teardown.ts`.
- Ninguna credencial se almacena en texto plano dentro del código fuente; las contraseñas de sesión E2E se inyectan mediante variables de entorno efímeras (`E2E_SUPER_ADMIN_PASSWORD`, `E2E_TEST_PILOT_PASSWORD`, `E2E_B2B_OWNER_PASSWORD`, `E2E_B2B_WORKER_PASSWORD`, `E2E_EDU_PASSWORD`).

## Puertos Locales Requeridos

- Web unificada (`web/`): `http://127.0.0.1:5173`
- Backend API (`src/`): `http://127.0.0.1:8080`
- Firestore Emulator: `127.0.0.1:8085`
- Auth Emulator: `127.0.0.1:9190`
- Storage Emulator: `127.0.0.1:9195`

## Ejecución

```bash
npx playwright test
npx playwright test --project="Desktop Chrome"
npx playwright test --project="Admin Console Unified"
```
