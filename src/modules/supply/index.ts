import type { Express } from 'express';
import supplyRouter from './application/supply.controller';

/**
 * PUNTO DE MONTAJE DEL MÓDULO NATIVO INTEGRADO MINREPORT · ABASTECIMIENTO (`supply`)
 *
 * Orden de seguridad:
 * - `/api/supply/whatsapp/webhook` (GET/POST) se valida por `hub.verify_token` y
 *   firma criptográfica HMAC-SHA256 `X-Hub-Signature-256` (Fail-Closed) antes del JWT.
 * - Todas las demás rutas `/api/supply/*` exigen sesión verificada y aislamiento
 *   multi-tenant estricto (`requireSupplyTenantScope`) sobre la base de datos única
 *   Cloud Firestore en `southamerica-west1`.
 */
export function registerSupplyModuleRoutes(app: Express): void {
    app.use('/api/supply', supplyRouter);
}

export { supplyRouter };
export { MetaWhatsAppCloudAdapter } from './adapters/MetaWhatsAppCloudAdapter';
export { EmailAndWhatsAppNotifier } from './adapters/EmailAndWhatsAppNotifier';
export { ReceiptIntelligencePipeline } from './application/ReceiptIntelligencePipeline';
export { SupplyRepository, SUPPLY_COLLECTIONS } from './application/SupplyRepository';
export { CampChannel } from './channels/camp.channel';
