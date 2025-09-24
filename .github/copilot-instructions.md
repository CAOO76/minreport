# Copilot Instructions for MINREPORT

## Project Overview
MINREPORT is a monorepo for a mining project management platform, using pnpm workspaces to manage frontends, backends, and shared libraries. The architecture is designed for modularity, security, and scalability, with a strong focus on data sovereignty (all cloud resources in `southamerica-west1`).

## Key Components
- **Frontends:**
  - `sites/client-app`: Public portal for client access (React + Vite + TypeScript)
  - `sites/admin-app`: Internal admin panel (React + Vite + TypeScript)
  - `sites/public-site`: Landing/marketing page (React + Vite)
- **Backends:**
  - `services/*`: Decoupled TypeScript services, deployed as containers to Cloud Run or as Firebase Cloud Functions (2nd Gen, onCall only)
- **Shared Libraries:**
  - `packages/core`, `packages/sdk`: Core logic and plugin SDK for secure communication via postMessage
- **Plugins:**
  - Plugins are loaded in `<iframe>`s for sandboxing, with communication via postMessage and a custom SDK (`@minreport/sdk`).

## Developer Workflows
- **Install dependencies:**
  ```bash
  pnpm install
  ```
- **Start full local dev environment:**
  ```bash
  pnpm dev
  ```
  This launches Firebase emulators, backend services, and all frontends. Ports and emulator settings are managed via `.env` (local, not committed) and `.env.example` (template).
- **Run tests (all packages):**
  ```bash
  pnpm -r test
  ```
- **Install Playwright browsers (required for client-app tests):**
  ```bash
  pnpm --prefix sites/client-app exec playwright install
  ```
- **CI pipeline:**
  See `.github/workflows/ci.yml` for steps. Playwright browsers must be installed before running tests.

## Conventions & Patterns
- **Commit messages:** Must follow [Conventional Commits](https://www.conventionalcommits.org/)
- **Environment config:** Use `.env` for local overrides, `.env.example` as template. Never commit `.env`.
- **Plugin architecture:**
  - Plugins are loaded via `<iframe>` in `PluginViewer.tsx` (from `@minreport/core`).
  - Communication uses postMessage, abstracted by `@minreport/sdk`.
  - Plugin URLs and metadata are managed in Firestore (`plugins` collection), not hardcoded.
- **Account lifecycle:**
  - Multi-step approval, with secure token-based data collection (see `GEMINI_PLAN.md` for details).
  - All actions are logged for auditability; no deletions of requests/history.
- **Data model:**
  - See `DATA_CONTRACT.md` for Firestore schema and conventions (e.g., RUT/RUN normalization, `activePlugins` array in accounts).

## Integration Points
- **Firebase:** Hosting, Auth, Firestore, Storage, Emulator Suite
- **Cloud Run:** For backend services
- **Google Maps API:** For address validation (future integration)
- **Playwright:** For E2E/browser tests

## Important Files & Directories
- `GEMINI_PLAN.md`: Architecture, workflows, and conventions (always consult for big-picture changes)
- `DATA_CONTRACT.md`: Data model and Firestore schema
- `sites/client-app`, `sites/admin-app`, `sites/public-site`: Frontend apps
- `services/`: Backend services and Cloud Functions
- `packages/core`, `packages/sdk`: Shared logic and plugin SDK
- `.github/workflows/ci.yml`: CI pipeline

## Example Patterns
- **PluginViewer usage:**
  ```tsx
  import { PluginViewer } from '@minreport/core';
  // ...
  <PluginViewer pluginId={pluginId} />
  ```
- **SDK initialization in plugins:**
  ```ts
  import { init } from '@minreport/sdk';
  init((session) => { /* ... */ });
  ```

## Special Notes
- Never expose or link the admin app URL (`minreport-x.web.app`) in public-facing code or docs.
- All code must be compatible with deployment to `southamerica-west1`.
- Always validate RUT/RUN using the standard Chilean algorithm (see `GEMINI_PLAN.md`).

---
For further details, see `GEMINI_PLAN.md` and `DATA_CONTRACT.md`. If any section is unclear or missing, please request clarification or provide feedback for improvement.
