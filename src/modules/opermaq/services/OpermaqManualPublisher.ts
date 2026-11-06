import { randomUUID } from 'crypto';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { db } from '../../../config/firebase';
import { AuditLedger } from '../../../core/audit-ledger';
import { CasStorageService } from '../../../core/media/CasStorageService';
import type {
    AdHocManualProfileId,
    EquipmentSymbologyPack,
    ExtractedFigureRef,
    PillarId,
    PillarItem,
    SymbologyPackEntry,
} from '../types/vault.types';
import { buildAndPersistAssetSymbologyPack } from './EquipmentSymbologyPackBuilder';
import { type BlueprintKind, OpermaqSvgBlueprintEngine } from './OpermaqSvgBlueprintEngine';

/**
 * OPERMAQ MANUAL PUBLISHER v4.0 — Editorial Industrial de Manuales Ad-Hoc Propios Ilustrados
 *
 * Produce manuales técnicos ilustrados listos para terreno, taller y auditoría regulatoria,
 * fusionando:
 * 1. Conocimiento Común Curado (`COMMONS`: 5 Pilares de `global_asset_catalog`).
 * 2. Figuras técnicas recortadas en CAS (`figures[]` + tabla de `callouts` `1..N`).
 * 3. Planos vectoriales paramétricos (`OpermaqSvgBlueprintEngine`: Ficha SI, Matriz PM, Ruta 360° LOTO, Placa ISO 3864).
 * 4. Paquete Ad-Hoc completo de Simbología Normativa (`ISO 7010` + `ISO 7000` + `ISO 2575` + `IEC 60417` + `GHS`).
 * 5. Estándares Internos Privados del Cliente (`tenant_custom_overrides`) — aislados estrictamente en `TENANT_PRIVATE` CAS.
 * 6. Sello Criptográfico de Trazabilidad en `AuditLedger` (`SHA-256`).
 */

export interface CompileManualInput {
    globalAssetId: string;
    profileId: AdHocManualProfileId;
    tenantAssetId?: string;
    includeTenantOverrides?: boolean;
    tenantId: string;
    actorUid: string;
    actorEmail: string;
}

export interface CompiledManualOutput {
    manualId: string;
    globalAssetId: string;
    profileId: AdHocManualProfileId;
    profileTitleEs: string;
    pdfDownloadUrl: string;
    pdfSha256: string;
    optimizedBytes: number;
    pageCount: number;
    embeddedFiguresCount: number;
    embeddedSymbolsCount: number;
    includesTenantOverrides: boolean;
    ledgerEntryId: string;
    htmlEdition: string;
    compiledAt: string;
}

const PROFILE_CONFIG: Record<
    AdHocManualProfileId,
    {
        titleEs: string;
        subtitleEs: string;
        pillars: PillarId[];
        blueprints: BlueprintKind[];
    }
> = {
    MASTER_5_PILLARS: {
        titleEs: 'MANUAL TÉCNICO MAESTRO INTEGRAL (5 PILARES)',
        subtitleEs: 'Especificaciones SI, Operación, Mantención PM, Matriz de Riesgos y Pre-Uso Ilustrado',
        pillars: [
            'ficha_tecnica',
            'manual_operaciones',
            'pauta_mantencion',
            'matriz_riesgos',
            'checklist_pre_op',
        ],
        blueprints: [
            'DIMENSION_SPEC_SHEET',
            'PM_HOROMETER_TIMELINE',
            'WALKAROUND_LOTO_MAP',
            'ISO_SAFETY_PLAQUE',
        ],
    },
    OPERATOR_POCKET_GUIDE: {
        titleEs: 'GUÍA OPERATIVA DE CABINA Y PRE-USO ILUSTRADA',
        subtitleEs: 'Controles, Cartilla Completa de Testigos Luminosos, EPP e Inspección 360°',
        pillars: ['manual_operaciones', 'checklist_pre_op', 'matriz_riesgos'],
        blueprints: ['WALKAROUND_LOTO_MAP', 'ISO_SAFETY_PLAQUE'],
    },
    WORKSHOP_PM_MANUAL: {
        titleEs: 'MANUAL DE TALLER, FLUIDOS Y PAUTA HOROMÉTRICA PM',
        subtitleEs: 'Capacidades SI, Torques, Intervalos 10h–2000h y Aislamiento de Energía Cero',
        pillars: ['ficha_tecnica', 'pauta_mantencion'],
        blueprints: ['DIMENSION_SPEC_SHEET', 'PM_HOROMETER_TIMELINE'],
    },
    REGULATORY_DS132_LOTO: {
        titleEs: 'DOSSIER DE SEGURIDAD MINERA, RIESGOS Y BLOQUEO LOTO',
        subtitleEs: 'Cumplimiento Normativo DS 132, Señalética ISO 7010 y Verificación Pre-Operacional',
        pillars: ['matriz_riesgos', 'checklist_pre_op'],
        blueprints: ['ISO_SAFETY_PLAQUE', 'WALKAROUND_LOTO_MAP'],
    },
};

const PILLAR_TITLES_ES: Record<PillarId, string> = {
    ficha_tecnica: 'PILAR 1 — FICHA TÉCNICA E INGENIERÍA NOMINAL (SI)',
    manual_operaciones: 'PILAR 2 — MANUAL DE OPERACIONES Y MANIOBRAS',
    pauta_mantencion: 'PILAR 3 — PAUTA DE MANTENCIÓN PREVENTIVA Y LUBRICACIÓN',
    matriz_riesgos: 'PILAR 4 — MATRIZ DE RIESGOS CRÍTICOS Y ENERGÍA CERO (LOTO)',
    checklist_pre_op: 'PILAR 5 — LISTA DE VERIFICACIÓN PRE-OPERACIONAL (360°)',
};

function sanitizePdfWinAnsi(text: string): string {
    return String(text || '')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2192|\u2794/g, '->')
        .replace(/\u2022/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

function stripMarkdownForPdf(md: string): string {
    return sanitizePdfWinAnsi(
        String(md || '')
            .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
    );
}

function wrapLineWords(line: string, maxChars: number): string[] {
    const clean = line.trim();
    if (!clean) return [''];
    if (clean.length <= maxChars) return [clean];
    const words = clean.split(/\s+/);
    const wrapped: string[] = [];
    let current = '';
    for (const w of words) {
        if (!current) {
            current = w.slice(0, maxChars);
        } else if (current.length + 1 + w.length <= maxChars) {
            current += ` ${w}`;
        } else {
            wrapped.push(current);
            current = w.slice(0, maxChars);
        }
    }
    if (current) wrapped.push(current);
    return wrapped;
}

function escapeHtml(str: string): string {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderSimpleMarkdownToHtml(md: string): string {
    const lines = String(md || '').split('\n');
    const out: string[] = [];
    let inTable = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            if (inTable) {
                out.push('</tbody></table>');
                inTable = false;
            }
            continue;
        }
        // Omitir imágenes markdown redundantes porque se renderizan en tarjetas técnicas dedicadas con callouts
        if (/^!\[[^\]]*\]\([^)]+\)/.test(line)) continue;

        if (line.startsWith('|') && line.endsWith('|')) {
            if (/^\|[\s:-]+\|/.test(line)) continue;
            const cells = line
                .slice(1, -1)
                .split('|')
                .map((c) => escapeHtml(c.trim()));
            if (!inTable) {
                inTable = true;
                out.push(
                    '<table class="tech-table"><thead><tr>' +
                        cells.map((c) => `<th>${c}</th>`).join('') +
                        '</tr></thead><tbody>'
                );
            } else {
                out.push('<tr>' + cells.map((c) => `<td>${c}</td>`).join('') + '</tr>');
            }
            continue;
        }

        if (inTable) {
            out.push('</tbody></table>');
            inTable = false;
        }

        if (line.startsWith('### ')) {
            out.push(`<h4>${escapeHtml(line.slice(4))}</h4>`);
        } else if (line.startsWith('## ')) {
            out.push(`<h3>${escapeHtml(line.slice(3))}</h3>`);
        } else if (line.startsWith('- ') || line.startsWith('* ')) {
            const formatted = escapeHtml(line.slice(2)).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            out.push(`<div class="bullet-row"><span class="bullet-mark">■</span><span>${formatted}</span></div>`);
        } else {
            const formatted = escapeHtml(line).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            out.push(`<p>${formatted}</p>`);
        }
    }

    if (inTable) out.push('</tbody></table>');
    return out.join('\n');
}

async function resolveStorageUrlToPngBuffer(storageUrl: string, svgInline?: string): Promise<Buffer | null> {
    try {
        if (svgInline && svgInline.includes('<svg')) {
            return await sharp(Buffer.from(svgInline, 'utf8'))
                .resize({ width: 1200, withoutEnlargement: false, fit: 'inside' })
                .flatten({ background: '#FFFFFF' })
                .png()
                .toBuffer();
        }

        let storagePath: string | null = null;
        if (storageUrl.startsWith('/api/media/blob/global_oem/')) {
            const fname = storageUrl.split('/').pop() || '';
            storagePath = `cas_blobs/global_oem/${fname}`;
        } else if (storageUrl.startsWith('/api/media/blob/symbology/')) {
            const fname = storageUrl.split('/').pop() || '';
            storagePath = `assets/symbology/cas/${fname}`;
        } else if (storageUrl.startsWith('/api/media/blob/tenant/')) {
            const parts = storageUrl.split('/');
            const fname = parts.pop() || '';
            const tenant = decodeURIComponent(parts.pop() || '');
            storagePath = `cas_blobs/tenants/${tenant}/${fname}`;
        }

        if (!storagePath) return null;
        const blob = await CasStorageService.readCasBlob(storagePath);
        if (!blob) return null;

        return await sharp(blob.buffer)
            .resize({ width: 1280, height: 820, fit: 'inside', withoutEnlargement: true })
            .flatten({ background: '#FFFFFF' })
            .png()
            .toBuffer();
    } catch {
        return null;
    }
}

export class OpermaqManualPublisher {
    public static async compileAdHocManual(input: CompileManualInput): Promise<CompiledManualOutput> {
        const assetRef = db.collection('global_asset_catalog').doc(input.globalAssetId);
        const snap = await assetRef.get();
        if (!snap.exists) {
            const err: any = new Error(`Activo ${input.globalAssetId} no existe en global_asset_catalog.`);
            err.statusCode = 404;
            throw err;
        }

        const assetData = snap.data()!;
        const cfg = PROFILE_CONFIG[input.profileId] || PROFILE_CONFIG.MASTER_5_PILLARS;

        const make = String(assetData.make_oficial || assetData.make || 'OEM');
        const model = String(assetData.model_oficial || assetData.model || input.globalAssetId);
        const makeModel = assetData.make_model || `${make} ${model}`.trim();
        const equipmentType = String(assetData.tipo_equipo || assetData.categoria_equipo || 'ACTIVO INDUSTRIAL');

        // 1. Asegurar paquete completo de simbología ad-hoc del equipo
        const symbologyPack: EquipmentSymbologyPack =
            assetData.symbology_pack && assetData.symbology_pack.total_symbols > 0
                ? assetData.symbology_pack
                : await buildAndPersistAssetSymbologyPack(input.globalAssetId, assetData);

        // 2. Generar planos paramétricos vectoriales propios para garantizar soporte gráfico completo
        const generatedBlueprints: Array<{ figure: ExtractedFigureRef; svgString: string }> = [];
        for (const bpKind of cfg.blueprints) {
            const bp = await OpermaqSvgBlueprintEngine.generateAndStoreAssetBlueprint({
                globalAssetId: input.globalAssetId,
                kind: bpKind,
                actorUid: input.actorUid,
            });
            generatedBlueprints.push(bp);
        }

        // 3. Cargar opcionalmente `tenant_custom_overrides` (aislado por tenant)
        let tenantOverrides: Record<string, any> | null = null;
        if (input.includeTenantOverrides && input.tenantAssetId) {
            const tSnap = await db.collection('tenant_assets').doc(input.tenantAssetId).get();
            if (tSnap.exists) {
                const tData = tSnap.data()!;
                const docTenant = tData.tenantId || tData.accountId;
                if (!docTenant || docTenant === input.tenantId) {
                    tenantOverrides = tData.tenant_custom_overrides || null;
                }
            }
        }

        const compiledAt = new Date().toISOString();
        const manualId = `man_${input.profileId.toLowerCase()}_${randomUUID().slice(0, 8)}`;

        // 4. Registrar sello criptográfico previo en `AuditLedger`
        const ledgerEntryId = await AuditLedger.record({
            tenantId: input.tenantId,
            actorUid: input.actorUid,
            actorEmail: input.actorEmail,
            action: 'OPERMAQ_ADHOC_MANUAL_COMPILED',
            module: 'opermaq',
            targetEntity: input.globalAssetId,
            details: {
                manualId,
                profileId: input.profileId,
                makeModel,
                includesTenantOverrides: Boolean(tenantOverrides),
                totalSymbols: symbologyPack.total_symbols,
            },
        });

        // 5. Construir PDF Ilustrado con `pdf-lib` (A4: 595.28 x 841.89 pt)
        const pdfDoc = await PDFDocument.create();
        pdfDoc.setTitle(`${cfg.titleEs} — ${makeModel}`);
        pdfDoc.setAuthor('MINREPORT Industrial Publishing Engine v4.0');
        pdfDoc.setSubject(cfg.subtitleEs);

        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontMono = await pdfDoc.embedFont(StandardFonts.CourierBold);

        const PAGE_W = 595.28;
        const PAGE_H = 841.89;
        const MARGIN = 40;
        const CONTENT_W = PAGE_W - MARGIN * 2;

        const COLOR_SLATE = rgb(0.06, 0.09, 0.16);
        const COLOR_MUTED = rgb(0.35, 0.4, 0.48);
        const COLOR_COPPER = rgb(0.776, 0.514, 0.275); // #C68346
        const COLOR_CYAN = rgb(0.0, 0.682, 0.937); // #00AEEF
        const COLOR_LIGHT_BG = rgb(0.97, 0.98, 0.99);

        let currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
        let cursorY = PAGE_H - MARGIN;
        let embeddedFiguresCount = 0;

        const drawHeaderBar = (page: any, subtitleRight: string) => {
            page.drawRectangle({ x: 0, y: PAGE_H - 34, width: PAGE_W, height: 34, color: COLOR_SLATE });
            page.drawRectangle({ x: 0, y: PAGE_H - 36, width: PAGE_W, height: 2, color: COLOR_COPPER });
            page.drawText(sanitizePdfWinAnsi(`MINREPORT OPERMAQ | ${makeModel.toUpperCase()}`), {
                x: MARGIN,
                y: PAGE_H - 22,
                size: 8.5,
                font: fontBold,
                color: rgb(0.95, 0.96, 0.97),
            });
            page.drawText(sanitizePdfWinAnsi(subtitleRight), {
                x: PAGE_W - MARGIN - 190,
                y: PAGE_H - 22,
                size: 8,
                font: fontMono,
                color: rgb(0.75, 0.8, 0.86),
            });
        };

        const addContinuationPage = (sectionLabel: string) => {
            currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
            drawHeaderBar(currentPage, sectionLabel.slice(0, 32));
            cursorY = PAGE_H - 58;
        };

        const ensureSpace = (neededHeight: number, sectionLabel: string) => {
            if (cursorY - neededHeight < MARGIN + 26) {
                addContinuationPage(sectionLabel);
            }
        };

        // ── PORTADA TÉCNICA INDUSTRIAL ──
        currentPage.drawRectangle({ x: 0, y: PAGE_H - 185, width: PAGE_W, height: 185, color: COLOR_SLATE });
        currentPage.drawRectangle({ x: 0, y: PAGE_H - 189, width: PAGE_W, height: 4, color: COLOR_COPPER });
        currentPage.drawText('MINREPORT — EDITORIAL DE INGENIERIA OPERMAQ v4.0', {
            x: MARGIN,
            y: PAGE_H - 52,
            size: 9.5,
            font: fontMono,
            color: COLOR_CYAN,
        });
        currentPage.drawText(sanitizePdfWinAnsi(makeModel.toUpperCase()), {
            x: MARGIN,
            y: PAGE_H - 92,
            size: 24,
            font: fontBold,
            color: rgb(1, 1, 1),
        });
        currentPage.drawText(sanitizePdfWinAnsi(cfg.titleEs), {
            x: MARGIN,
            y: PAGE_H - 120,
            size: 12.5,
            font: fontBold,
            color: COLOR_COPPER,
        });
        currentPage.drawText(sanitizePdfWinAnsi(cfg.subtitleEs), {
            x: MARGIN,
            y: PAGE_H - 140,
            size: 9.5,
            font: fontRegular,
            color: rgb(0.82, 0.85, 0.9),
        });
        currentPage.drawText(
            sanitizePdfWinAnsi(`DENOMINACION: ${equipmentType} | AUDIT LEDGER ID: ${ledgerEntryId}`),
            {
                x: MARGIN,
                y: PAGE_H - 165,
                size: 8.5,
                font: fontMono,
                color: rgb(0.7, 0.75, 0.82),
            }
        );

        cursorY = PAGE_H - 212;

        // Incrustar el primer plano paramétrico en portada (Ficha SI o Placa ISO / WalkAround)
        if (generatedBlueprints.length > 0) {
            const coverBpPng = await resolveStorageUrlToPngBuffer(
                generatedBlueprints[0].figure.storage_url,
                generatedBlueprints[0].svgString
            );
            if (coverBpPng) {
                const embeddedImg = await pdfDoc.embedPng(coverBpPng);
                const dims = embeddedImg.scaleToFit(CONTENT_W, 275);
                currentPage.drawImage(embeddedImg, {
                    x: MARGIN + (CONTENT_W - dims.width) / 2,
                    y: cursorY - dims.height,
                    width: dims.width,
                    height: dims.height,
                });
                cursorY -= dims.height + 18;
                embeddedFiguresCount++;
            }
        }

        // Resumen de paquete de simbología y trazabilidad en portada
        currentPage.drawRectangle({
            x: MARGIN,
            y: cursorY - 84,
            width: CONTENT_W,
            height: 84,
            color: COLOR_LIGHT_BG,
            borderColor: COLOR_SLATE,
            borderWidth: 1,
        });
        currentPage.drawText('FICHA DE GOBERNANZA Y TRAZABILIDAD DEL MANUAL AD-HOC', {
            x: MARGIN + 12,
            y: cursorY - 18,
            size: 9.5,
            font: fontBold,
            color: COLOR_SLATE,
        });
        currentPage.drawText(
            sanitizePdfWinAnsi(
                `Simbologia Normativa Integrada: ${symbologyPack.total_symbols} pictogramas (ISO 7010 / ISO 7000 / ISO 2575 / IEC 60417 / GHS)`
            ),
            { x: MARGIN + 12, y: cursorY - 36, size: 8.5, font: fontMono, color: COLOR_MUTED }
        );
        currentPage.drawText(
            sanitizePdfWinAnsi(
                `Alcance de Datos: ${
                    tenantOverrides
                        ? 'COMMONS OEM + ESTANDARES INTERNOS FAENA (PRIVADO TENANT)'
                        : 'NUCLEO COLABORATIVO UNIVERSAL OEM (COMMONS)'
                }`
            ),
            { x: MARGIN + 12, y: cursorY - 52, size: 8.5, font: fontMono, color: COLOR_MUTED }
        );
        currentPage.drawText(
            sanitizePdfWinAnsi(`Fecha Compilacion: ${compiledAt} | Autorizado: ${input.actorEmail}`),
            { x: MARGIN + 12, y: cursorY - 68, size: 8.5, font: fontMono, color: COLOR_MUTED }
        );

        // ── SECCIÓN DE PLANOS VECTORIALES ADICIONALES ──
        for (let bIdx = 1; bIdx < generatedBlueprints.length; bIdx++) {
            const bp = generatedBlueprints[bIdx];
            const png = await resolveStorageUrlToPngBuffer(bp.figure.storage_url, bp.svgString);
            if (!png) continue;

            addContinuationPage('ESQUEMA VECTORIAL');
            currentPage.drawText(sanitizePdfWinAnsi(bp.figure.title_es.toUpperCase()), {
                x: MARGIN,
                y: cursorY,
                size: 11,
                font: fontBold,
                color: COLOR_SLATE,
            });
            cursorY -= 16;

            const emb = await pdfDoc.embedPng(png);
            const dims = emb.scaleToFit(CONTENT_W, 310);
            currentPage.drawImage(emb, {
                x: MARGIN,
                y: cursorY - dims.height,
                width: dims.width,
                height: dims.height,
            });
            cursorY -= dims.height + 24;
            embeddedFiguresCount++;
        }

        // ── SECCIÓN DE CARTILLA DE SIMBOLOGÍA AD-HOC DEL EQUIPO ──
        const allPackEntries: SymbologyPackEntry[] = [
            ...(symbologyPack.groups?.MANDATORY_PPE || []),
            ...(symbologyPack.groups?.HAZARD_PROHIBITION || []),
            ...(symbologyPack.groups?.CABIN_TELLTALES_CONTROLS || []),
            ...(symbologyPack.groups?.MAINTENANCE_FLUIDS_ELECTRICAL || []),
        ];

        if (allPackEntries.length > 0) {
            addContinuationPage('SIMBOLOGIA AD-HOC');
            currentPage.drawText(
                sanitizePdfWinAnsi(`PAQUETE AD-HOC DE SIMBOLOGIA NORMATIVA (${allPackEntries.length} SIMBOLOS)`),
                {
                    x: MARGIN,
                    y: cursorY,
                    size: 12,
                    font: fontBold,
                    color: COLOR_SLATE,
                }
            );
            cursorY -= 20;

            for (const sym of allPackEntries) {
                ensureSpace(34, 'SIMBOLOGIA AD-HOC');
                currentPage.drawRectangle({
                    x: MARGIN,
                    y: cursorY - 26,
                    width: CONTENT_W,
                    height: 28,
                    color: COLOR_LIGHT_BG,
                    borderColor: rgb(0.88, 0.9, 0.94),
                    borderWidth: 0.6,
                });
                currentPage.drawText(sanitizePdfWinAnsi(`[${sym.iso_reference}]`), {
                    x: MARGIN + 6,
                    y: cursorY - 10,
                    size: 8,
                    font: fontMono,
                    color: COLOR_COPPER,
                });
                currentPage.drawText(sanitizePdfWinAnsi(sym.technical_name_es.slice(0, 68)), {
                    x: MARGIN + 108,
                    y: cursorY - 10,
                    size: 8.5,
                    font: fontBold,
                    color: COLOR_SLATE,
                });
                currentPage.drawText(sanitizePdfWinAnsi(sym.action_operator_es.slice(0, 96)), {
                    x: MARGIN + 108,
                    y: cursorY - 21,
                    size: 7.5,
                    font: fontRegular,
                    color: COLOR_MUTED,
                });
                cursorY -= 31;
            }
        }

        // ── DESARROLLO ILUSTRADO DE LOS PILARES SELECCIONADOS ──
        const vault = assetData.knowledge_vault || {};
        for (const pillarId of cfg.pillars) {
            const pillarTitle = PILLAR_TITLES_ES[pillarId];
            const items: PillarItem[] = ((vault[pillarId]?.items as PillarItem[]) || []).filter(
                (i) => !i.is_discarded
            );

            addContinuationPage(pillarId.toUpperCase());
            currentPage.drawRectangle({
                x: MARGIN,
                y: cursorY - 24,
                width: CONTENT_W,
                height: 28,
                color: COLOR_SLATE,
            });
            currentPage.drawText(sanitizePdfWinAnsi(pillarTitle), {
                x: MARGIN + 10,
                y: cursorY - 14,
                size: 10.5,
                font: fontBold,
                color: rgb(1, 1, 1),
            });
            cursorY -= 38;

            if (items.length === 0) {
                currentPage.drawText('[Informacion tecnica no declarada en ficha para este pilar]', {
                    x: MARGIN,
                    y: cursorY,
                    size: 9,
                    font: fontRegular,
                    color: COLOR_MUTED,
                });
                cursorY -= 20;
                continue;
            }

            for (const item of items) {
                ensureSpace(64, pillarId.toUpperCase());
                currentPage.drawText(
                    sanitizePdfWinAnsi(`${item.order}. ${item.title} [${item.section || 'GENERAL'}]`),
                    {
                        x: MARGIN,
                        y: cursorY,
                        size: 10.5,
                        font: fontBold,
                        color: COLOR_COPPER,
                    }
                );
                cursorY -= 15;

                const bodyClean = item.content?.trim()
                    ? stripMarkdownForPdf(item.content)
                    : '[Informacion tecnica no declarada en ficha]';

                for (const rawLine of bodyClean.split('\n')) {
                    const wrappedLines = wrapLineWords(rawLine, 94);
                    for (const wl of wrappedLines) {
                        if (!wl) {
                            cursorY -= 5;
                            continue;
                        }
                        ensureSpace(14, pillarId.toUpperCase());
                        currentPage.drawText(wl, {
                            x: MARGIN,
                            y: cursorY,
                            size: 8.5,
                            font: fontRegular,
                            color: COLOR_SLATE,
                        });
                        cursorY -= 11.5;
                    }
                }

                // Incrustar figuras técnicas recortadas de este capítulo (`item.figures[]`) + sus callouts
                for (const fig of item.figures || []) {
                    const figPng = await resolveStorageUrlToPngBuffer(fig.storage_url);
                    if (!figPng) continue;

                    ensureSpace(220, pillarId.toUpperCase());
                    const embFig = await pdfDoc.embedPng(figPng);
                    const fDims = embFig.scaleToFit(CONTENT_W - 24, 195);
                    currentPage.drawImage(embFig, {
                        x: MARGIN + 12,
                        y: cursorY - fDims.height,
                        width: fDims.width,
                        height: fDims.height,
                    });
                    cursorY -= fDims.height + 12;
                    embeddedFiguresCount++;

                    currentPage.drawText(
                        sanitizePdfWinAnsi(
                            `Figura: ${fig.title_es}${fig.source_page ? ` (Pag. ${fig.source_page} OEM)` : ''}`
                        ),
                        {
                            x: MARGIN + 12,
                            y: cursorY,
                            size: 8,
                            font: fontBold,
                            color: COLOR_MUTED,
                        }
                    );
                    cursorY -= 12;

                    for (const co of fig.callouts || []) {
                        ensureSpace(12, pillarId.toUpperCase());
                        currentPage.drawText(
                            sanitizePdfWinAnsi(
                                `  [${co.callout}] ${co.component_es}${
                                    co.function_or_spec ? `: ${co.function_or_spec}` : ''
                                }`
                            ),
                            {
                                x: MARGIN + 16,
                                y: cursorY,
                                size: 7.8,
                                font: fontMono,
                                color: COLOR_SLATE,
                            }
                        );
                        cursorY -= 10.5;
                    }
                }

                cursorY -= 12;
            }
        }

        // ── ANEXO DE ESTÁNDARES INTERNOS DE FAENA (`TENANT OVERRIDES`) ──
        if (tenantOverrides && Object.keys(tenantOverrides).length > 0) {
            addContinuationPage('ESTANDAR INTERNO FAENA');
            currentPage.drawRectangle({
                x: MARGIN,
                y: cursorY - 24,
                width: CONTENT_W,
                height: 28,
                color: COLOR_COPPER,
            });
            currentPage.drawText('ANEXO PRIVADO DE FAENA — REGLAS Y AJUSTES ESPECIFICOS DEL CLIENTE', {
                x: MARGIN + 10,
                y: cursorY - 14,
                size: 10,
                font: fontBold,
                color: rgb(1, 1, 1),
            });
            cursorY -= 38;

            const overrideLines = sanitizePdfWinAnsi(JSON.stringify(tenantOverrides, null, 2)).split('\n');
            for (const ol of overrideLines) {
                ensureSpace(13, 'ESTANDAR INTERNO FAENA');
                currentPage.drawText(ol.slice(0, 92), {
                    x: MARGIN,
                    y: cursorY,
                    size: 8,
                    font: fontMono,
                    color: COLOR_SLATE,
                });
                cursorY -= 11;
            }
        }

        // Numerar páginas en el pie técnico
        const pages = pdfDoc.getPages();
        for (let i = 0; i < pages.length; i++) {
            pages[i].drawLine({
                start: { x: MARGIN, y: 28 },
                end: { x: PAGE_W - MARGIN, y: 28 },
                thickness: 0.6,
                color: rgb(0.82, 0.85, 0.89),
            });
            pages[i].drawText(
                sanitizePdfWinAnsi(
                    `MINREPORT OPERMAQ | Ledger: ${ledgerEntryId} | Pagina ${i + 1} de ${pages.length}`
                ),
                {
                    x: MARGIN,
                    y: 16,
                    size: 7.5,
                    font: fontMono,
                    color: COLOR_MUTED,
                }
            );
        }

        const rawPdfBuffer = Buffer.from(await pdfDoc.save({ useObjectStreams: true }));
        const casScope = tenantOverrides ? 'TENANT_PRIVATE' : 'GLOBAL_OEM';

        const { descriptor: pdfDesc } = await CasStorageService.digestAndStore(
            rawPdfBuffer,
            'application/pdf',
            'PDF_HYBRID_OEM',
            {
                scope: casScope,
                tenantId: input.tenantId,
                actorUid: input.actorUid,
                originalFilename: `${input.globalAssetId}_${input.profileId.toLowerCase()}.pdf`,
                enableSelectiveRaster: false,
            }
        );

        // 6. Construir Edición HTML5 Imprimible / Offline PWA (con SVG puros e imágenes CAS inline)
        const htmlEdition = this.buildPrintableHtmlEdition({
            makeModel,
            equipmentType,
            cfg,
            generatedBlueprints,
            symbologyPack,
            vault,
            tenantOverrides,
            ledgerEntryId,
            compiledAt,
        });

        const recordDoc = {
            manualId,
            globalAssetId: input.globalAssetId,
            profileId: input.profileId,
            profileTitleEs: cfg.titleEs,
            pdfDownloadUrl: pdfDesc.downloadUrl,
            pdfSha256: pdfDesc.sha256,
            optimizedBytes: pdfDesc.optimizedBytes,
            pageCount: pages.length,
            embeddedFiguresCount,
            embeddedSymbolsCount: symbologyPack.total_symbols,
            includesTenantOverrides: Boolean(tenantOverrides),
            tenantId: tenantOverrides ? input.tenantId : null,
            ledgerEntryId,
            compiledBy: input.actorEmail,
            compiledAt,
        };

        if (!tenantOverrides) {
            await assetRef.collection('generated_manuals').doc(manualId).set(recordDoc);
        }

        return {
            ...recordDoc,
            htmlEdition,
        };
    }

    private static buildPrintableHtmlEdition(params: {
        makeModel: string;
        equipmentType: string;
        cfg: (typeof PROFILE_CONFIG)[AdHocManualProfileId];
        generatedBlueprints: Array<{ figure: ExtractedFigureRef; svgString: string }>;
        symbologyPack: EquipmentSymbologyPack;
        vault: Record<string, any>;
        tenantOverrides: Record<string, any> | null;
        ledgerEntryId: string;
        compiledAt: string;
    }): string {
        const groupLabels: Record<string, string> = {
            MANDATORY_PPE: 'EPP y Acciones Obligatorias (ISO 7010 M)',
            HAZARD_PROHIBITION: 'Peligros, Prohibiciones y Emergencia (ISO 7010 W/P/F/E)',
            CABIN_TELLTALES_CONTROLS: 'Testigos Luminosos y Controles de Cabina (ISO 7000 / ISO 2575)',
            MAINTENANCE_FLUIDS_ELECTRICAL: 'Mantención, Fluidos, Eléctrico y Sustancias (ISO 7000 / IEC 60417 / GHS)',
        };

        const symbologySectionsHtml = Object.entries(params.symbologyPack.groups || {})
            .map(([gKey, entries]) => {
                if (!Array.isArray(entries) || entries.length === 0) return '';
                return `<div class="sym-group">
  <h4>${escapeHtml(groupLabels[gKey] || gKey)}</h4>
  <div class="sym-grid">
    ${entries
        .map(
            (e) => `<div class="sym-card">
      <div class="sym-icon">${
          e.svg_inline
              ? e.svg_inline
              : `<img src="${escapeHtml(e.icon_url)}" alt="${escapeHtml(e.iso_reference)}" draggable="false" />`
      }</div>
      <div class="sym-meta">
        <div class="sym-code">${escapeHtml(e.iso_reference)}</div>
        <div class="sym-title">${escapeHtml(e.technical_name_es)}</div>
        <div class="sym-action">${escapeHtml(e.action_operator_es)}</div>
      </div>
    </div>`
        )
        .join('')}
  </div>
</div>`;
            })
            .join('\n');

        const pillarsHtml = params.cfg.pillars
            .map((pId) => {
                const items: PillarItem[] = ((params.vault[pId]?.items as PillarItem[]) || []).filter(
                    (i) => !i.is_discarded
                );
                return `<section class="pillar-section">
  <div class="pillar-banner">${escapeHtml(PILLAR_TITLES_ES[pId])}</div>
  ${
      items.length === 0
          ? `<p class="undeclared">[Información técnica no declarada en ficha]</p>`
          : items
                .map(
                    (it) => `<article class="chapter-block">
    <header class="chapter-head">
      <span class="chapter-num">${it.order}</span>
      <div>
        <h3>${escapeHtml(it.title)}</h3>
        <div class="chapter-sec">${escapeHtml(it.section || 'GENERAL')}</div>
      </div>
    </header>
    <div class="chapter-body">
      ${
          it.content?.trim()
              ? renderSimpleMarkdownToHtml(it.content)
              : '<p class="undeclared">[Información técnica no declarada en ficha]</p>'
      }
    </div>
    ${(it.figures || [])
        .map(
            (fig) => `<figure class="tech-figure">
      <img src="${escapeHtml(fig.storage_url)}" alt="${escapeHtml(fig.title_es)}" draggable="false" />
      <figcaption><strong>${escapeHtml(fig.title_es)}</strong>${
                fig.source_page ? ` — Pág. ${fig.source_page} OEM` : ''
            }${fig.caption_es ? ` | ${escapeHtml(fig.caption_es)}` : ''}</figcaption>
      ${
          fig.callouts && fig.callouts.length > 0
              ? `<div class="callout-grid">${fig.callouts
                    .map(
                        (c) =>
                            `<div><code>[${escapeHtml(c.callout)}]</code> <strong>${escapeHtml(
                                c.component_es
                            )}</strong>${c.function_or_spec ? `: ${escapeHtml(c.function_or_spec)}` : ''}</div>`
                    )
                    .join('')}</div>`
              : ''
      }
    </figure>`
        )
        .join('')}
  </article>`
                )
                .join('\n')
  }
</section>`;
            })
            .join('\n');

        return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(params.cfg.titleEs)} — ${escapeHtml(params.makeModel)}</title>
<style>
  body { font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; color: #0F172A; background: #FFFFFF; margin: 0; padding: 21px; line-height: 1.45; }
  code, .sym-code, .chapter-num, .tech-table td { font-family: 'Atkinson Hyperlegible Mono', monospace; font-variant-numeric: tabular-nums; }
  .cover-banner { background: #0F172A; color: #F3F4F6; padding: 34px; border-bottom: 4px solid #C68346; margin-bottom: 21px; }
  .cover-banner h1 { margin: 8px 0; font-size: 28px; letter-spacing: -0.02em; }
  .cover-kicker { color: #00AEEF; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
  .cover-sub { color: #CBD5E1; font-size: 13px; margin-top: 6px; }
  .blueprint-wrap { border: 1px solid #E2E8F0; padding: 13px; margin-bottom: 21px; background: #F8FAFC; page-break-inside: avoid; }
  .blueprint-wrap svg { width: 100%; height: auto; display: block; }
  .pillar-banner { background: #0F172A; color: #FFFFFF; padding: 10px 13px; font-weight: 700; font-size: 13px; border-left: 4px solid #C68346; margin: 34px 0 13px; }
  .chapter-block { border: 1px solid #E2E8F0; padding: 21px; margin-bottom: 21px; page-break-inside: avoid; }
  .chapter-head { display: flex; gap: 13px; align-items: center; border-bottom: 1px solid #E2E8F0; padding-bottom: 8px; margin-bottom: 13px; }
  .chapter-num { background: #C68346; color: #FFFFFF; padding: 4px 8px; font-weight: 700; font-size: 12px; }
  .chapter-head h3 { margin: 0; font-size: 16px; }
  .chapter-sec { font-size: 11px; color: #475569; text-transform: uppercase; font-weight: 700; }
  .tech-table { width: 100%; border-collapse: collapse; margin: 13px 0; font-size: 12.5px; }
  .tech-table th, .tech-table td { border: 1px solid #CBD5E1; padding: 8px; text-align: left; }
  .tech-table th { background: #F8FAFC; font-weight: 700; }
  .tech-figure { border: 1px solid #CBD5E1; background: #F8FAFC; padding: 13px; margin: 13px 0; }
  .tech-figure img { max-width: 100%; max-height: 360px; display: block; margin: 0 auto 8px; }
  .callout-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; margin-top: 8px; font-size: 12px; border-top: 1px solid #E2E8F0; padding-top: 8px; }
  .sym-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 13px; margin-bottom: 21px; }
  .sym-card { display: flex; gap: 13px; border: 1px solid #E2E8F0; padding: 8px; background: #FFFFFF; page-break-inside: avoid; }
  .sym-icon { width: 44px; height: 44px; flex-shrink: 0; }
  .sym-icon svg, .sym-icon img { width: 44px; height: 44px; display: block; }
  .sym-code { font-size: 11px; color: #C68346; font-weight: 700; }
  .sym-title { font-size: 12px; font-weight: 700; }
  .sym-action { font-size: 11px; color: #475569; }
  .undeclared { color: #64748B; font-style: italic; font-size: 12.5px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <header class="cover-banner">
    <div class="cover-kicker">MINREPORT OPERMAQ — ${escapeHtml(params.cfg.titleEs)}</div>
    <h1>${escapeHtml(params.makeModel)}</h1>
    <div class="cover-sub">${escapeHtml(params.equipmentType)} | ${escapeHtml(params.cfg.subtitleEs)}</div>
    <div class="cover-sub">Ledger SHA-256 ID: <code>${escapeHtml(params.ledgerEntryId)}</code> | Compilado: <code>${escapeHtml(params.compiledAt)}</code></div>
  </header>

  ${params.generatedBlueprints.map((bp) => `<div class="blueprint-wrap">${bp.svgString}</div>`).join('\n')}

  <section>
    <div class="pillar-banner">CARTILLA AD-HOC DE SIMBOLOGÍA NORMATIVA (${params.symbologyPack.total_symbols} SÍMBOLOS)</div>
    ${symbologySectionsHtml}
  </section>

  ${pillarsHtml}
</body>
</html>`;
    }
}

