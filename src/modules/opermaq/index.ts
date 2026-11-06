import type { Express } from 'express';
import { resolveMinReportSessionScope } from '../../middleware/sessionScope';
import assetsRouter from './routes/assets.routes';
import symbologyPublicRouter from './routes/symbology-public.routes';
import vaultRouter from './routes/vault.routes';
import workerRouter from './routes/worker.routes';

/**
 * PUNTO DE MONTAJE DEL MÓDULO FUNCIONAL OPERMAQ EN EL MONOLITO MINREPORT (ARQUITECTURA ORIGINAL PURA)
 *
 * Orden estricto de seguridad:
 * 1. Proxy público de recursos gráficos ISO 7000 (`/public/simbologia/image-proxy` y `/api/public/simbologia/image-proxy`).
 * 2. Worker asíncrono OIDC de Cloud Tasks (`/api/vault/worker/*`) — autenticado vía OIDC Google Auth, previo al JWT de usuario.
 * 3. Rutas funcionales núcleo subordinadas 100% a `resolveMinReportSessionScope` del Host MINREPORT:
 *    - `/api/assets` (Etapa 1 independiente: Caza y Registro Inicial de Maquinaria)
 *    - `/api/vault`  (Etapas 2 y 3 On-Demand: Itemizado, Caza por Ítem, Curación HITL "ACTUALIZAR" y Simbología ISO 7000)
 */
export function registerOpermaqModuleRoutes(app: Express): void {
    // 1. Recursos gráficos con control de path-traversal y Cache-Control inmutable
    app.use('/', symbologyPublicRouter);

    // 2. Worker Cloud Tasks (OIDC) — DEBE ir antes de `/api/vault`
    app.use('/api/vault/worker', workerRouter);

    // 3. Núcleo funcional puro de OPERMAQ subordinado a la sesión y cuenta activa de MINREPORT Core
    app.use('/api/assets', resolveMinReportSessionScope, assetsRouter);
    app.use('/api/vault', resolveMinReportSessionScope, vaultRouter);
}
