import { EmailService } from '../../../services/EmailService';
import {
    type NotificationPreferences,
    type SupplyPurchase,
    type SupplyRequisition,
} from '../application/supply.types';
import { MetaWhatsAppCloudAdapter, type WhatsAppSendResult } from './MetaWhatsAppCloudAdapter';

/**
 * NOTIFICADOR DUAL EMAIL (RESEND) + WHATSAPP UTILITY (MINREPORT · ABASTECIMIENTO)
 *
 * Despacha alertas operativas hacia compradores (`BUYER` / `SITE_ADMIN` / `OWNER_EXEC`)
 * respetando estrictamente `notificationPreferences` y consentimiento `whatsappOptInAt`
 * (Ley N° 21.719), además de retroalimentación de estado hacia solicitantes en terreno.
 */

export interface SupplyNotificationRecipient {
    uid: string;
    displayName?: string;
    email?: string;
    phoneE164?: string;
    whatsappOptInAt?: string | number | null;
    role?: string;
    notificationPreferences?: Partial<NotificationPreferences>;
}

export interface NotificationDispatchResult {
    emailsSent: number;
    whatsappsSent: number;
    failures: number;
}

function escapeHtml(raw: string): string {
    return String(raw || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildRequisitionEmailHtml(requisition: SupplyRequisition, siteName: string): string {
    const hasAtypical =
        requisition.atypicalFlags.length > 0 ||
        requisition.lines.some((l) => l.atypicalFlags.length > 0);
    const accentColor = hasAtypical ? '#C68346' : '#0F172A';

    const rowsHtml = requisition.lines
        .map((line) => {
            const flags = line.atypicalFlags.length > 0 ? line.atypicalFlags.join(', ') : '-';
            return `<tr>
                <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:monospace;">${escapeHtml(line.canonicalSkuId)}</td>
                <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;">${escapeHtml(line.itemName)}</td>
                <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:right;font-family:monospace;">${line.qtyRequested} ${escapeHtml(line.unitSi)}</td>
                <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:monospace;">${escapeHtml(line.procurementBucket)}</td>
                <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:monospace;color:${line.atypicalFlags.length > 0 ? '#C68346' : '#475569'};">${escapeHtml(flags)}</td>
            </tr>`;
        })
        .join('');

    return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:21px;background:#F8FAFC;color:#0F172A;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:680px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-left:4px solid ${accentColor};">
    <div style="background:#000000;color:#FFFFFF;padding:16px 21px;">
      <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8A93A6;">MINREPORT · ABASTECIMIENTO</div>
      <div style="font-size:18px;font-weight:700;margin-top:4px;">REQUISICIÓN ${escapeHtml(requisition.reqId)}</div>
    </div>
    <div style="padding:21px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px;">
        <tr><td style="padding:4px 0;color:#475569;">FAENA / SITIO</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(siteName)}</td></tr>
        <tr><td style="padding:4px 0;color:#475569;">ORIGEN</td><td style="padding:4px 0;font-family:monospace;">${escapeHtml(requisition.demandOrigin)}</td></tr>
        <tr><td style="padding:4px 0;color:#475569;">SOLICITANTE</td><td style="padding:4px 0;">${escapeHtml(requisition.requesterName)} (${escapeHtml(requisition.requesterRole)})</td></tr>
        <tr><td style="padding:4px 0;color:#475569;">CENTRO DE COSTO</td><td style="padding:4px 0;font-family:monospace;">${escapeHtml(requisition.costCenter)}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #E2E8F0;">
        <thead>
          <tr style="background:#F8FAFC;text-align:left;font-size:11px;text-transform:uppercase;color:#475569;">
            <th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;">SKU</th>
            <th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;">ÍTEM</th>
            <th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:right;">CANTIDAD</th>
            <th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;">RUBRO</th>
            <th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;">EXCEPCIÓN</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

function buildDirectPurchaseAlertHtml(purchase: SupplyPurchase, alerts: string[]): string {
    const hasAlert = alerts.length > 0 || purchase.atypicalFlags.length > 0;
    const accent = hasAlert ? '#C68346' : '#00AEEF';
    const itemsHtml = purchase.lines
        .map(
            (l) => `<tr>
            <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;">${escapeHtml(l.description)}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:right;font-family:monospace;">${l.qtyPurchased} ${escapeHtml(l.unitSi)}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:right;font-family:monospace;">$${l.subtotalClp.toLocaleString('es-CL')}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:monospace;">${escapeHtml(l.destination)}</td>
        </tr>`
        )
        .join('');

    return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:21px;background:#F8FAFC;color:#0F172A;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:680px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-left:4px solid ${accent};">
    <div style="background:#000000;color:#FFFFFF;padding:16px 21px;">
      <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8A93A6;">MINREPORT · ABASTECIMIENTO</div>
      <div style="font-size:18px;font-weight:700;margin-top:4px;">COMPRA ${escapeHtml(purchase.purchaseMode)} · DTE ${purchase.documentType} #${purchase.folio}</div>
    </div>
    <div style="padding:21px;">
      <p style="font-size:13px;margin:0 0 13px 0;">Proveedor: <strong>${escapeHtml(purchase.supplierName)}</strong> (${escapeHtml(purchase.supplierTaxId)}) · Total: <strong>$${purchase.totalAmountClp.toLocaleString('es-CL')} CLP</strong></p>
      ${
          alerts.length > 0
              ? `<div style="padding:10px 13px;border-left:3px solid #C68346;background:#FFF7ED;font-size:12px;margin-bottom:16px;">${alerts
                    .map((a) => `<div>${escapeHtml(a)}</div>`)
                    .join('')}</div>`
              : ''
      }
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #E2E8F0;">
        <thead>
          <tr style="background:#F8FAFC;text-align:left;font-size:11px;text-transform:uppercase;color:#475569;">
            <th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;">DESCRIPCIÓN</th>
            <th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:right;">CANTIDAD</th>
            <th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:right;">SUBTOTAL</th>
            <th style="padding:8px 10px;border-bottom:1px solid #E2E8F0;">DESTINO</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

export class EmailAndWhatsAppNotifier {
    /**
     * Notifica a compradores / responsables sobre una nueva requisición confirmada.
     */
    public static async notifyBuyersOfRequisition(params: {
        tenantId: string;
        requisition: SupplyRequisition;
        siteName?: string;
        buyers: SupplyNotificationRecipient[];
    }): Promise<NotificationDispatchResult> {
        let emailsSent = 0;
        let whatsappsSent = 0;
        let failures = 0;

        const siteLabel = params.siteName || params.requisition.siteId;
        const isUrgentOrAtypical =
            params.requisition.atypicalFlags.length > 0 ||
            params.requisition.lines.some(
                (l) => l.urgency === 'CRITICAL' || l.urgency === 'HIGH' || l.atypicalFlags.length > 0
            );

        const subjectPrefix = isUrgentOrAtypical ? '[ATÍPICO/CRÍTICO]' : '[PEDIDO]';
        const subject = `${subjectPrefix} MINREPORT Abastecimiento · ${params.requisition.reqId} (${siteLabel})`;
        const html = buildRequisitionEmailHtml(params.requisition, siteLabel);
        const linePreview = params.requisition.lines
            .slice(0, 4)
            .map((l) => `${l.itemName} ${l.qtyRequested} ${l.unitSi}`)
            .join(', ');

        for (const buyer of params.buyers) {
            const prefs = buyer.notificationPreferences || {};
            if (prefs.urgentOnly === true && !isUrgentOrAtypical) {
                continue;
            }

            const emailPref = prefs.emailEnabled ?? prefs.email;
            const emailAllowed = emailPref !== false && Boolean(buyer.email);
            if (emailAllowed && buyer.email) {
                try {
                    await EmailService.sendEmail({
                        from: 'MINREPORT <no-reply@minreport.com>',
                        to: buyer.email,
                        subject,
                        html,
                    });
                    emailsSent += 1;
                } catch {
                    failures += 1;
                }
            }

            const whatsappPref = prefs.whatsappEnabled ?? prefs.whatsapp;
            const whatsappAllowed =
                whatsappPref === true &&
                Boolean(buyer.phoneE164) &&
                Boolean(buyer.whatsappOptInAt);
            if (whatsappAllowed && buyer.phoneE164) {
                const res = await MetaWhatsAppCloudAdapter.sendTemplateMessage(
                    buyer.phoneE164,
                    'minreport_requisition_alert',
                    'es',
                    [
                        params.requisition.reqId,
                        siteLabel,
                        `${params.requisition.lines.length} ítems: ${linePreview}`,
                        isUrgentOrAtypical ? 'REVISIÓN ATÍPICA/PRIORITARIA' : 'ESTÁNDAR',
                    ]
                );
                if (res.ok) {
                    whatsappsSent += 1;
                } else {
                    failures += 1;
                }
            }
        }

        return { emailsSent, whatsappsSent, failures };
    }

    /**
     * Alerta informativa a OWNER / ADMIN sobre compra autónoma o activo sin factura (DTE 33/34).
     */
    public static async notifyOwnerOfDirectPurchase(params: {
        tenantId: string;
        purchase: SupplyPurchase;
        alerts: string[];
        recipients: SupplyNotificationRecipient[];
    }): Promise<NotificationDispatchResult> {
        let emailsSent = 0;
        let whatsappsSent = 0;
        let failures = 0;

        const html = buildDirectPurchaseAlertHtml(params.purchase, params.alerts);
        const subject = `[COMPRA ${params.purchase.purchaseMode}] DTE ${params.purchase.documentType} #${params.purchase.folio} · $${params.purchase.totalAmountClp.toLocaleString('es-CL')} CLP`;

        for (const recipient of params.recipients) {
            const prefs = recipient.notificationPreferences || {};
            const emailPref = prefs.emailEnabled ?? prefs.email;
            if (emailPref !== false && recipient.email) {
                try {
                    await EmailService.sendEmail({
                        from: 'MINREPORT <no-reply@minreport.com>',
                        to: recipient.email,
                        subject,
                        html,
                    });
                    emailsSent += 1;
                } catch {
                    failures += 1;
                }
            }

            const whatsappPref = prefs.whatsappEnabled ?? prefs.whatsapp;
            if (whatsappPref === true && recipient.phoneE164 && recipient.whatsappOptInAt) {
                const res = await MetaWhatsAppCloudAdapter.sendTemplateMessage(
                    recipient.phoneE164,
                    'minreport_direct_purchase_alert',
                    'es',
                    [
                        params.purchase.purchaseId,
                        `${params.purchase.supplierName} (DTE ${params.purchase.documentType} #${params.purchase.folio})`,
                        `$${params.purchase.totalAmountClp.toLocaleString('es-CL')} CLP`,
                        params.alerts[0] || 'Registrada en inventario/activos',
                    ]
                );
                if (res.ok) {
                    whatsappsSent += 1;
                } else {
                    failures += 1;
                }
            }
        }

        return { emailsSent, whatsappsSent, failures };
    }

    /**
     * Envía confirmación o actualización de estado al solicitante de terreno por WhatsApp en burbuja única.
     */
    public static async sendFieldStatusUpdate(params: {
        toE164: string;
        requisitionId: string;
        siteName?: string;
        statusLabel: string;
        summaryLines: string[];
    }): Promise<WhatsAppSendResult> {
        const header = `MINREPORT · ${params.requisitionId}${params.siteName ? ` (${params.siteName})` : ''}`;
        const body = [
            header,
            `Estado: ${params.statusLabel}`,
            ...params.summaryLines.map((line, idx) => `${idx + 1}. ${line}`),
        ].join('\n');

        return MetaWhatsAppCloudAdapter.sendTextMessage(params.toE164, body);
    }
}
