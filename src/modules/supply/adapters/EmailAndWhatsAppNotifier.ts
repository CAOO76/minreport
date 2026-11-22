import { EmailService } from '../../../services/EmailService';
import {
    type NotificationPreferences,
    type SupplyPurchase,
    type SupplyRequisition,
} from '../application/supply.types';
import {
    MetaWhatsAppCloudAdapter,
    sanitizeTemplateParameter,
    type WhatsAppSendResult,
} from './MetaWhatsAppCloudAdapter';

/**
 * NOTIFICADOR DUAL EMAIL (RESEND) + WHATSAPP UTILITY (MINREPORT · ABASTECIMIENTO)
 *
 * Despacha alertas operativas hacia compradores (`BUYER` / `SITE_ADMIN` / `OWNER_EXEC`)
 * respetando estrictamente `notificationPreferences`, `quietHoursStart`/`quietHoursEnd` en zona
 * horaria IANA del sitio, consentimiento `whatsappOptInAt` (Ley N° 21.719), minimización de PII
 * hacia Meta y política CSW 24h con template HSM UTILITY `minreport_field_reception_update`
 * (y fallback automático ante error Meta `131047`).
 */

export const FIELD_RECEPTION_HSM_TEMPLATE = 'minreport_field_reception_update';
export const CSW_SAFE_WINDOW_MS = 23.5 * 60 * 60 * 1000; // 23.5 horas (margen 30m previo a cierre 24h Meta)

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

function parseHhMmToMinutes(raw: string | undefined): number | null {
    if (!raw || typeof raw !== 'string') return null;
    const match = raw.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Evalúa si un instante dado (`nowMs`) cae dentro de `quietHoursStart`–`quietHoursEnd`
 * en la zona horaria IANA del sitio (default `America/Santiago`), soportando ventanas nocturnas
 * (ej. `22:00`–`07:00`) y diurnas (ej. `13:00`–`15:00`).
 */
export function isWithinQuietHours(
    nowMs: number,
    prefs?: Partial<NotificationPreferences>,
    timezoneIana: string = 'America/Santiago'
): boolean {
    const startMin = parseHhMmToMinutes(prefs?.quietHoursStart);
    const endMin = parseHhMmToMinutes(prefs?.quietHoursEnd);
    if (startMin === null || endMin === null || startMin === endMin) {
        return false;
    }

    const safeTz = (timezoneIana || 'America/Santiago').trim() || 'America/Santiago';
    let localHour = 0;
    let localMinute = 0;
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: safeTz,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(new Date(nowMs));
        localHour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
        localMinute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    } catch {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/Santiago',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(new Date(nowMs));
        localHour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
        localMinute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    }

    const currentMin = localHour * 60 + localMinute;
    if (startMin < endMin) {
        return currentMin >= startMin && currentMin < endMin;
    }
    // Ventana nocturna que cruza medianoche (ej. 22:00 -> 07:00)
    return currentMin >= startMin || currentMin < endMin;
}

/**
 * Minimiza datos personales y tributarios antes de salir hacia Meta Cloud API (Ley N° 21.719):
 * omite RUTs completos, correos electrónicos y teléfonos personales en alertas operativas WhatsApp.
 */
export function minimizePiiForWhatsAppMeta(raw: string): string {
    return String(raw || '')
        .replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-[0-9Kk]\b/g, '[RUT_RESERVADO]')
        .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL_RESERVADO]')
        .replace(/(?:\+56\s?9|\+56\s?2)\s?\d{4}[\s.-]?\d{4}\b/g, '[TEL_RESERVADO]');
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
        timezoneIana?: string;
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

        const nowMs = Date.now();
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
            const inQuietHours =
                !isUrgentOrAtypical &&
                isWithinQuietHours(nowMs, prefs, params.timezoneIana || 'America/Santiago');
            const whatsappAllowed =
                !inQuietHours &&
                whatsappPref === true &&
                Boolean(buyer.phoneE164) &&
                Boolean(buyer.whatsappOptInAt);
            if (whatsappAllowed && buyer.phoneE164) {
                const res = await MetaWhatsAppCloudAdapter.sendTemplateMessage(
                    buyer.phoneE164,
                    'minreport_requisition_alert',
                    'es',
                    [
                        sanitizeTemplateParameter(params.requisition.reqId),
                        sanitizeTemplateParameter(minimizePiiForWhatsAppMeta(siteLabel)),
                        sanitizeTemplateParameter(
                            minimizePiiForWhatsAppMeta(
                                `${params.requisition.lines.length} ítems: ${linePreview}`
                            )
                        ),
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
     * Minimiza PII hacia Meta omitiendo RUT del proveedor y datos personales en la plantilla WhatsApp.
     */
    public static async notifyOwnerOfDirectPurchase(params: {
        tenantId: string;
        purchase: SupplyPurchase;
        alerts: string[];
        timezoneIana?: string;
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
                        sanitizeTemplateParameter(params.purchase.purchaseId),
                        sanitizeTemplateParameter(
                            minimizePiiForWhatsAppMeta(
                                `${params.purchase.supplierName} (DTE ${params.purchase.documentType} #${params.purchase.folio})`
                            )
                        ),
                        sanitizeTemplateParameter(
                            `$${params.purchase.totalAmountClp.toLocaleString('es-CL')} CLP`
                        ),
                        sanitizeTemplateParameter(
                            minimizePiiForWhatsAppMeta(
                                params.alerts[0] || 'Registrada en inventario/activos'
                            )
                        ),
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
     * Envía confirmación o actualización de estado al solicitante de terreno por WhatsApp:
     * - Respeta `quietHoursStart`/`quietHoursEnd` en la zona horaria IANA del sitio salvo `urgent: true`.
     * - Si `forceTemplate` o `!lastInboundAtMs` o transcurrieron `>= 23.5h` desde `lastInboundAtMs`
     *   (fuera de ventana CSW 24h Meta): envía obligatoriamente el template HSM UTILITY
     *   `minreport_field_reception_update` (`es`) con parámetros saneados y minimización PII.
     * - Si dentro de la ventana 24h `sendTextMessage` devuelve `cswExpired` (error Meta `131047`),
     *   ejecuta fallback automático al mismo HSM `minreport_field_reception_update`.
     */
    public static async sendFieldStatusUpdate(params: {
        toE164: string;
        requisitionId: string;
        siteName?: string;
        statusLabel: string;
        summaryLines: string[];
        lastInboundAtMs?: number | null;
        notificationPreferences?: Partial<NotificationPreferences>;
        timezoneIana?: string;
        urgent?: boolean;
        forceTemplate?: boolean;
        nowMs?: number;
    }): Promise<WhatsAppSendResult> {
        const nowMs = typeof params.nowMs === 'number' && Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
        const tz = params.timezoneIana || 'America/Santiago';

        if (!params.urgent && isWithinQuietHours(nowMs, params.notificationPreferences, tz)) {
            return {
                ok: true,
                mocked: false,
                statusCode: 202,
                skippedReason: 'QUIET_HOURS_DEFERRED',
            };
        }

        const safeLines = params.summaryLines.map((line) => minimizePiiForWhatsAppMeta(line));
        const safeSite = params.siteName ? minimizePiiForWhatsAppMeta(params.siteName) : undefined;
        const safeStatus = minimizePiiForWhatsAppMeta(params.statusLabel);

        const hsmParams = [
            sanitizeTemplateParameter(params.requisitionId),
            sanitizeTemplateParameter(safeSite || 'Faena'),
            sanitizeTemplateParameter(safeStatus),
            sanitizeTemplateParameter(safeLines.join(' | ') || 'Sin detalle adicional'),
        ];

        const hasValidInboundTs =
            typeof params.lastInboundAtMs === 'number' &&
            Number.isFinite(params.lastInboundAtMs) &&
            params.lastInboundAtMs > 0;
        const outsideCswWindow =
            Boolean(params.forceTemplate) ||
            !hasValidInboundTs ||
            nowMs - (params.lastInboundAtMs as number) >= CSW_SAFE_WINDOW_MS;

        if (outsideCswWindow) {
            return MetaWhatsAppCloudAdapter.sendTemplateMessage(
                params.toE164,
                FIELD_RECEPTION_HSM_TEMPLATE,
                'es',
                hsmParams
            );
        }

        const header = `MINREPORT · ${params.requisitionId}${safeSite ? ` (${safeSite})` : ''}`;
        const body = [
            header,
            `Estado: ${safeStatus}`,
            ...safeLines.map((line, idx) => `${idx + 1}. ${line}`),
        ].join('\n');

        const textResult = await MetaWhatsAppCloudAdapter.sendTextMessage(params.toE164, body);
        if (!textResult.ok && (textResult.cswExpired || textResult.metaErrorCode === 131047)) {
            return MetaWhatsAppCloudAdapter.sendTemplateMessage(
                params.toE164,
                FIELD_RECEPTION_HSM_TEMPLATE,
                'es',
                hsmParams
            );
        }

        return textResult;
    }
}
