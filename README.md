# MINREPORT — Plataforma Industrial Web 3.0 de Control y Reportabilidad Minera

**URL Oficial de Acceso:** `https://minreport-access.web.app`  
**Región Soberana Única:** `southamerica-west1` (Google Cloud Santiago, Chile)

---

## 1. Declaración Oficial de Estrategia de Hosting (Capa 2 & Capa 5)

Conforme al Estándar Global de Arquitectura Web 3.0 Híbrida (5 Capas) y `GEMINI.md`:

- **Frontend / Cliente Unificado (`web/` — PWA Offline-First & Capacitor 6):** Desplegado sobre **Firebase Hosting** (`target: minreport-web`, CDN global perimetral tras **Cloudflare Edge + Zaraz** con `Cache-Control: public, max-age=31536000, immutable` en activos estáticos y fuentes `.woff2` auto-hospedadas).
- **Backend Transaccional, Identidad FIDO2, M2M x402 e Inferencia Resiliente (`src/`):** Desplegado como contenedor serverless en **Google Cloud Run (`minreport-api`, región `southamerica-west1`)**, enrutado de forma nativa desde Firebase Hosting bajo `/api/**`.
- **Persistencia, Almacenamiento CAS y Secretos (`southamerica-west1`):** **Cloud Firestore** (`(default)`), **Cloud Storage** (`cas_blobs/` con direccionamiento por `SHA-256` + `pHash`), **Cloud Functions Gen 2** y **Google Cloud Secret Manager** (cero credenciales privadas hardcodeadas en repositorio). Google App Engine está estrictamente prohibido.

---

## 2. Jerarquía Soberana de 5 Tipos de Cuenta

| Nivel | Cuenta / Rol | Ruta / Superficie | Alcance Operacional |
| :---: | :--- | :--- | :--- |
| **1º** | **`DEV`** (`DEV_ROOT` / `dev@minreport.com`) | `/dev` | Ingeniería núcleo, bóvedas maestras OEM/ISO y gestión exclusiva de cuentas `TEST-PILOT`. |
| **2º** | **`ADMIN`** (`SUPER_ADMIN` / `admin@minreport.com`) | `/admin` | Operación comercial MINREPORT, clientes `B2B`, acreditaciones `EDU`, `modules_status`, verificación de cadena `audit_ledger` y telemetría IA. |
| **3º** | **`TEST-PILOT`** (`TEST_PILOT` / `PILOT_LEAD`) | `/pilot` + HUD Transversal | Simulación de faenas sobre todos los módulos, observaciones contextuales (`pilot_feedback`) y curación IA (`hitl_candidates`). |
| **4º** | **`CLIENTES B2B`** (`OWNER`, `ADMIN`, `SUPERVISOR`, `OPERATOR`, `VIEWER`) | `/dashboard`, `/opermaq`, `/stockpile`, `/b2b/*` | Operación minera con aislamiento multi-tenant estricto por `accountId` (`tenantId`). |
| **5º** | **`EDU`** (`STUDENT`, `PROFESSOR`) | Entorno `isEduSandbox: true` | Simulación académica controlada sin alta de nómina comercial. |

---

## 3. Módulos Nativos Integrados sobre Base de Datos Única

- **`OPERMAQ` (`/opermaq`):** Gestión técnica de maquinaria pesada en 5 pilares, procesador segmentado de manuales PDF/ETT (`FastCDC` + `mupdf`), digestor multimedia CAS (`WebP`/`SVG`), simbología vectorial ISO 7010/7000/2575/IEC/GHS y compilador de manuales ad-hoc propios.
- **`STOCKPILE CONTROL` (`/stockpile`):** Control volumétrico de acopios mineros, captura fotogramétrica con evidencia optimizada en CAS (`SHA-256`) y operación Offline-First particionada por `tenantId` (`SyncQueueEngine`).

---

## 4. Comandos Principales de Desarrollo y Verificación

```bash
# Compilación y verificación estricta TypeScript (Backend + Frontend)
npm run build
cd web && npx tsc --noEmit && npm run build

# Levantar ecosistema local preservando datos de emuladores (./data)
npm run serve:emulators
npm run dev:server
npm run dev --prefix web
```

