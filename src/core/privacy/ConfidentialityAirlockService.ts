import sharp from 'sharp';
import { z } from 'zod';
import { db } from '../../config/firebase';
import { AuditLedger } from '../audit-ledger';
import { CasStorageService } from '../media/CasStorageService';
import { MediaDigestorServer } from '../media/MediaDigestorServer';
import { ResilientAIClient } from '../resilient-ai-client';

/**
 * CONFIDENTIALITY AIRLOCK SERVICE v4.0 (Zero-Trust Commons Gatekeeper — ISO 27001)
 *
 * Garantiza que todo aporte de usuarios (B2B, EDU, TEST-PILOT) enriquezca el núcleo
 * común (`COMMONS`) de MINREPORT sin jamás filtrar datos privados entre empresas:
 *
 * 1. Sanitización Determinista Regex: Purga RUTs chilenos, correos, teléfonos, coordenadas GPS,
 *    órdenes de compra/contratos, precios y patentes/códigos internos de flota.
 * 2. Segregación Agéntica (`UNIVERSAL_OEM` vs `TENANT_PRIVATE`): Separa especificaciones
 *    universales del modelo de máquina respecto a reglamentos internos de faena, frecuencias radiales
 *    o procedimientos exclusivos del cliente.
 * 3. Redacción Óptica (`box_2d` + `sharp`): Purga EXIF/GPS y desenfoca rostros, patentes,
 *    credenciales o logotipos corporativos del cliente antes de promover una imagen a `GLOBAL_OEM`.
 */

const AirlockClassificationSchema = z.object({
    contains_universal_oem_knowledge: z.boolean(),
    sanitized_universal_markdown: z.string(),
    target_pillar_hint: z
        .enum([
            'ficha_tecnica',
            'manual_operaciones',
            'pauta_mantencion',
            'matriz_riesgos',
            'checklist_pre_op',
        ])
        .optional(),
    contains_tenant_private_rules: z.boolean(),
    tenant_private_notes: z.string(),
    detected_sensitive_categories: z.array(z.string()).default([]),
});

const SensitiveVisualBoxesSchema = z.object({
    sensitive_regions: z
        .array(
            z.object({
                label: z.enum(['FACE', 'LICENSE_PLATE', 'CLIENT_LOGO', 'ID_BADGE', 'DOCUMENT_PII']),
                box_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]),
            })
        )
        .default([]),
});

export interface AirlockEvaluationResult {
    originalRedactedPreview: string;
    containsUniversalOem: boolean;
    sanitizedUniversalMarkdown: string;
    targetPillarHint?:
        | 'ficha_tecnica'
        | 'manual_operaciones'
        | 'pauta_mantencion'
        | 'matriz_riesgos'
        | 'checklist_pre_op';
    containsTenantPrivate: boolean;
    tenantPrivateNotes: string;
    detectedSensitiveCategories: string[];
}

export class ConfidentialityAirlockService {
    /**
     * Redacción determinista de primera línea (0 ms, 100% determinista — Ley N° 19.628 y Nueva Ley N° 21.719).
     * Cubre RUT, correos, teléfonos +56, coordenadas GPS decimales y UTM (husos 18/19), contratos/OC,
     * patentes chilenas contextualizadas (preservando códigos OEM como PC200-8, WA380-6, ISO 7000),
     * truncado de cola privada en VIN/PIN de 17 caracteres (ISO 3779 / ISO 10261) y números de serie S/N.
     */
    public static scrubDeterministicPii(rawText: string): {
        scrubbed: string;
        redactedCategories: string[];
    } {
        let s = rawText || '';
        const cats = new Set<string>();

        const applyRule = (regex: RegExp, replacement: string, category: string) => {
            regex.lastIndex = 0;
            if (regex.test(s)) {
                cats.add(category);
                regex.lastIndex = 0;
                s = s.replace(regex, replacement);
            }
        };

        // 1. RUT Chileno (ej. 12.345.678-9, 76543210-K)
        applyRule(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, '[RUT_RESERVADO]', 'RUT_IDENTIFICADOR');

        // 2. Emails corporativos o personales
        applyRule(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_RESERVADO]', 'EMAIL');

        // 3. Teléfonos móviles y fijos de Chile (+56 9 ..., +56 2 ..., 9 XXXX XXXX)
        applyRule(
            /(?<![\dA-Za-z])(?:\+?56[\s.-]*)?(?:9[\s.-]*\d{4}[\s.-]*\d{4}|2[\s.-]*\d{4}[\s.-]*\d{4})\b/g,
            '[TEL_RESERVADO]',
            'TELEFONO'
        );

        // 4. Coordenadas GPS decimales explícitas
        applyRule(/[-+]?\d{1,2}\.\d{4,}\s*,\s*[-+]?\d{1,3}\.\d{4,}/g, '[COORD_FAENA_RESERVADA]', 'GPS_FAENA');

        // 5. Coordenadas UTM en husos chilenos 18 y 19 (bandas F, G, H, J, K)
        applyRule(
            /\b(?:UTM\s*[:#-]?\s*)?(?:18|19)\s*[FGHJK](?:\s+|\s*[,;/-]\s*)\d{6}(?:[.,]\d+)?(?:\s*m?\s*E)?[\s,;/-]+\d{7}(?:[.,]\d+)?(?:\s*m?\s*N)?\b/gi,
            '[UTM_FAENA_RESERVADA]',
            'UTM_FAENA'
        );

        // 6. Contratos, órdenes de compra, licitaciones y referencias comerciales con dígitos
        applyRule(
            /\b(?:OC|PO|CONTRATO|LICITACI[OÓ]N)\s*[-#:]?\s*(?=[A-Z0-9-]*\d)[A-Z0-9-]{3,24}\b/gi,
            '[REF_CONTRACTUAL_RESERVADA]',
            'CONTRATO_OC'
        );

        // 7. Patentes vehiculares chilenas (PPU) contextualizadas sin afectar modelos/normas OEM (PC200-8, WA380-6, ISO 7000)
        applyRule(
            /\b(?:placa\s+patente|patente(?:\s+vehicular)?|ppu|matr[ií]cula\s+vehicular)\s*[:#-]?\s*(?!(?:ISO|IEC|DIN|SAE|NOM)\b)(?:[A-Z]{2}[-\s·•]?[A-Z]{2}[-\s·•]?\d{2}|[A-Z]{2}[-\s·•]?\d{2}[-\s·•]?\d{2}|[A-Z]{3}[-\s·•]?\d{2,3})(?![-\w])/gi,
            '[PATENTE_RESERVADA]',
            'PATENTE_INTERNA'
        );
        if (
            /\b(veh[ií]culo|camioneta|cami[oó]n|furg[oó]n|tracto|remolque)\s+(?!(?:SDLG|GVWR|GCWR|BLDC|PRCD|BSPT|LVDT|SPDT|DPDT|SPST|NPTF)\b)[BCDFGHJKLPRSTVWXYZ]{4}[-\s·•]?\d{2}(?![-\w])/i.test(
                s
            )
        ) {
            cats.add('PATENTE_INTERNA');
            s = s.replace(
                /\b(veh[ií]culo|camioneta|cami[oó]n|furg[oó]n|tracto|remolque)\s+(?!(?:SDLG|GVWR|GCWR|BLDC|PRCD|BSPT|LVDT|SPDT|DPDT|SPST|NPTF)\b)[BCDFGHJKLPRSTVWXYZ]{4}[-\s·•]?\d{2}(?![-\w])/gi,
                '$1 [PATENTE_RESERVADA]'
            );
        }
        applyRule(
            /\b(?!(?:SDLG|GVWR|GCWR|BLDC|PRCD|BSPT|LVDT|SPDT|DPDT|SPST|NPTF)\b)[BCDFGHJKLPRSTVWXYZ]{4}[-·•]\d{2}(?![-\w])/g,
            '[PATENTE_RESERVADA]',
            'PATENTE_INTERNA'
        );

        // 8. VIN / PIN de 17 caracteres (ISO 3779 / ISO 10261): preserva WMI+VDS (1..8) y redacta cola serial (9..17)
        s = s.replace(
            /(?<![/:.=_-])\b([A-HJ-NPR-Z0-9]{8})([A-HJ-NPR-Z0-9]{9})\b(?![/:.=_-])/gi,
            (full, wmiVds: string, tail: string) => {
                const upFull = full.toUpperCase();
                const upWmi = wmiVds.toUpperCase();
                const upTail = tail.toUpperCase();
                const hasLetters = /[A-HJ-NPR-Z]/.test(upFull);
                const hasValidSerialTail = /\d{3,}$/.test(upTail) && (/\d/.test(upWmi) || /\d{4,}$/.test(upTail));
                if (hasLetters && hasValidSerialTail) {
                    cats.add('VIN_SERIAL_TAIL_REDACTED');
                    return `${upWmi}-XXXXXXXXX`;
                }
                return full;
            }
        );

        // 9. Números de serie individuales explícitos (S/N, N° de serie, Serial No., Chasis N°, N° interno)
        applyRule(
            /\b(?:s\/n[°º]?|sn\s*[:#]|n[°º.]?\s*(?:de\s+)?serie|n[uú]mero\s+de\s+serie|serial(?:\s+(?:no\.?|number|#))?|chasis\s*(?:n[°º.]?|#|:)|n[°º.]?\s*interno|c[oó]d(?:igo)?\.?\s+interno)\s*[:#-]?\s*(?!\[|[A-HJ-NPR-Z0-9]{8}-XXXXXXXXX\b)(?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]{2,23}\b/gi,
            '[SERIE_UNIDAD_RESERVADA]',
            'SERIAL_INDIVIDUAL_REDACTED'
        );

        return {
            scrubbed: s.trim(),
            redactedCategories: Array.from(cats),
        };
    }

    /**
     * Sanitizador determinista especializado para lectura óptica efímera de placas de fabricante / VIN / PIN
     * durante el registro inicial de Catálogo (Ley N° 21.719):
     * - Conserva intactos los dígitos estructurales WMI+VDS (posiciones 1 a 8 de VIN ISO 3779) que identifican
     *   fabricante, modelo, configuración de ejes, cabina y motor.
     * - Purga determinísticamente la cola secuencial de serie individual (posiciones 9 a 17 -> "-XXXXXXXXX"),
     *   números de serie individuales (S/N, PIN, Chasis), patentes vehiculares (PPU) y RUT/correos/teléfonos.
     */
    public static scrubIdentificationPlateAndVinText(rawText: string): {
        scrubbed: string;
        extractedStructuralWmiVds: string | null;
        redactedCategories: string[];
    } {
        const base = this.scrubDeterministicPii(rawText || '');
        let s = base.scrubbed;
        const cats = new Set<string>(base.redactedCategories);

        // Extraer el prefijo estructural WMI+VDS si scrubDeterministicPii truncó un VIN/PIN de 17 caracteres
        const vinMatch = s.match(/\b([A-HJ-NPR-Z0-9]{8})-XXXXXXXXX\b/);
        const extractedStructuralWmiVds: string | null = vinMatch ? vinMatch[1].toUpperCase() : null;

        // En texto crudo de placa de identificación, purgar también patentes chilenas separadas por espacio (ABCD 12)
        if (
            /\b(?!(?:SDLG|GVWR|GCWR|BLDC|PRCD|BSPT|LVDT|SPDT|DPDT|SPST|NPTF)\b)[BCDFGHJKLPRSTVWXYZ]{4}\s\d{2}\b/.test(
                s
            )
        ) {
            cats.add('PATENTE_INTERNA');
            s = s.replace(
                /\b(?!(?:SDLG|GVWR|GCWR|BLDC|PRCD|BSPT|LVDT|SPDT|DPDT|SPST|NPTF)\b)[BCDFGHJKLPRSTVWXYZ]{4}\s\d{2}\b/g,
                '[PATENTE_RESERVADA]'
            );
        }

        return {
            scrubbed: s.replace(/\s+/g, ' ').trim(),
            extractedStructuralWmiVds,
            redactedCategories: Array.from(cats),
        };
    }

    /**
     * Evalúa y separa conocimiento técnico universal OEM de datos operativos privados del cliente
     */
    public static async evaluateTextContribution(params: {
        makeModel: string;
        rawContribution: string;
        tenantId: string;
    }): Promise<AirlockEvaluationResult> {
        const { scrubbed, redactedCategories } = this.scrubDeterministicPii(params.rawContribution);
        if (!scrubbed) {
            return {
                originalRedactedPreview: '',
                containsUniversalOem: false,
                sanitizedUniversalMarkdown: '',
                containsTenantPrivate: false,
                tenantPrivateNotes: '',
                detectedSensitiveCategories: redactedCategories,
            };
        }

        try {
            const prompt = `Actúa como Oficial de Seguridad de Datos Industriales (ISO 27001) y Curador Técnico OEM para el activo "${params.makeModel}".
Analiza el siguiente aporte ingresado por un usuario de una empresa minera y sepáralo estrictamente en DOS compartimentos:

TEXTO PRE-FILTRADO:
"""
${scrubbed}
"""

REGLAS ESTRICTAS DE SEPARACIÓN ZERO-TRUST:
1. "sanitized_universal_markdown": SOLO incluye datos técnicos, mecánicos, hidráulicos, eléctricos, torques, capacidades de fluidos, códigos de falla OEM, pasos de operación segura o puntos de inspección que apliquen UNIVERSALMENTE a cualquier unidad del modelo "${params.makeModel}", redactados de forma impersonal, técnica y libre de cualquier nombre de empresa, faena, persona, contratista, canal radial, velocidad interna de camino minero o código interno de flota (ej. eliminar "Camión 14 de Faena Norte").
2. "tenant_private_notes": Extrae aquí las reglas operativas internas exclusivas del cliente (ej. frecuencias radiales, límites de velocidad propios de la mina, protocolos internos de turno, contactos de supervisión, restricciones locales de rampa o altitud específica de su faena).
3. Elige en "target_pillar_hint" cuál de los 5 pilares corresponde mejor al conocimiento universal: "ficha_tecnica" | "manual_operaciones" | "pauta_mantencion" | "matriz_riesgos" | "checklist_pre_op".

Responde únicamente en JSON válido:
{
  "contains_universal_oem_knowledge": true,
  "sanitized_universal_markdown": "...",
  "target_pillar_hint": "pauta_mantencion",
  "contains_tenant_private_rules": false,
  "tenant_private_notes": "",
  "detected_sensitive_categories": []
}`;

            const { data } = await ResilientAIClient.generateStructured(
                {
                    module: 'opermaq',
                    preferredTier: 'ANCHOR_HA',
                    temperature: 0,
                    tenantId: params.tenantId,
                    prompt,
                },
                AirlockClassificationSchema
            );

            // Segunda pasada determinista por seguridad sobre la salida universal
            const finalUniversal = this.scrubDeterministicPii(data.sanitized_universal_markdown);

            return {
                originalRedactedPreview: scrubbed,
                containsUniversalOem:
                    data.contains_universal_oem_knowledge && finalUniversal.scrubbed.length >= 10,
                sanitizedUniversalMarkdown: finalUniversal.scrubbed,
                targetPillarHint: data.target_pillar_hint,
                containsTenantPrivate:
                    data.contains_tenant_private_rules && data.tenant_private_notes.trim().length > 0,
                tenantPrivateNotes: data.tenant_private_notes.trim(),
                detectedSensitiveCategories: Array.from(
                    new Set([
                        ...redactedCategories,
                        ...(data.detected_sensitive_categories || []),
                        ...finalUniversal.redactedCategories,
                    ])
                ),
            };
        } catch {
            // Fail-Closed ISO 27001: Si el clasificador IA no responde, NADA pasa automáticamente a COMMONS;
            // queda resguardado en privado para revisión humana posterior.
            return {
                originalRedactedPreview: scrubbed,
                containsUniversalOem: false,
                sanitizedUniversalMarkdown: '',
                containsTenantPrivate: true,
                tenantPrivateNotes: scrubbed,
                detectedSensitiveCategories: [...redactedCategories, 'AI_CLASSIFIER_OFFLINE_HELD_PRIVATE'],
            };
        }
    }

    /**
     * Purga EXIF/GPS y aplica desenfoque gaussiano (`box_2d` 0..1000) sobre rostros, patentes,
     * credenciales o logotipos de empresas clientes antes de promover una foto a `GLOBAL_OEM`.
     */
    public static async sanitizeImageForCommons(
        imageBuffer: Buffer,
        tenantId?: string
    ): Promise<{ cleanBuffer: Buffer; blurredRegionsCount: number }> {
        const digested = await MediaDigestorServer.digestImage(imageBuffer, 'IMAGE_TECHNICAL_HD');
        let workingBuf = digested.buffer;
        const width = digested.width || 1024;
        const height = digested.height || 1024;

        try {
            const { data } = await ResilientAIClient.generateStructured(
                {
                    module: 'core',
                    preferredTier: 'ANCHOR_HA',
                    temperature: 0,
                    tenantId,
                    media: [
                        {
                            mimeType: 'image/webp',
                            dataBase64: workingBuf.toString('base64'),
                        },
                    ],
                    prompt: `Inspect this industrial equipment image for privacy/confidentiality leaks before publishing to a shared technical catalog.
Detect ONLY:
- Human faces ("FACE")
- Vehicle license plates or internal fleet door numbers ("LICENSE_PLATE")
- Non-OEM mining company / contractor logos on doors ("CLIENT_LOGO")
- Worker ID badges or personal documents ("ID_BADGE", "DOCUMENT_PII")
Do NOT flag OEM manufacturer badges (like CAT, Komatsu, Makita) or ISO safety decals.
Return normalized bounding boxes [ymin, xmin, ymax, xmax] in 0..1000 scale as JSON:
{"sensitive_regions": [{"label": "LICENSE_PLATE", "box_2d": [ymin, xmin, ymax, xmax]}]}`,
                },
                SensitiveVisualBoxesSchema
            );

            const regions = data.sensitive_regions || [];
            if (regions.length > 0) {
                const composites: sharp.OverlayOptions[] = [];
                for (const reg of regions.slice(0, 12)) {
                    const [ymin, xmin, ymax, xmax] = reg.box_2d;
                    const left = Math.max(0, Math.floor((xmin / 1000) * width));
                    const top = Math.max(0, Math.floor((ymin / 1000) * height));
                    const regW = Math.min(width - left, Math.ceil(((xmax - xmin) / 1000) * width));
                    const regH = Math.min(height - top, Math.ceil(((ymax - ymin) / 1000) * height));
                    if (regW < 6 || regH < 6) continue;

                    const patch = await sharp(workingBuf)
                        .extract({ left, top, width: regW, height: regH })
                        .blur(22)
                        .toBuffer();
                    composites.push({ input: patch, left, top });
                }

                if (composites.length > 0) {
                    workingBuf = await sharp(workingBuf)
                        .composite(composites)
                        .webp({ quality: 85 })
                        .toBuffer();
                    return { cleanBuffer: workingBuf, blurredRegionsCount: composites.length };
                }
            }
        } catch {
            // Si no hay conexión IA o no se detectan regiones, se mantiene EXIF/GPS 100% purgado
        }

        return { cleanBuffer: workingBuf, blurredRegionsCount: 0 };
    }

    /**
     * Registra un aporte de terreno en `commons_airlock_queue` tras pasar la esclusa Zero-Trust
     */
    public static async submitContributionThroughAirlock(params: {
        globalAssetId: string;
        makeModel: string;
        tenantId: string;
        actorUid: string;
        actorEmail: string;
        rawText: string;
        imageBuffer?: Buffer;
        originalImageName?: string;
    }): Promise<{
        queueId: string | null;
        evaluation: AirlockEvaluationResult;
        sanitizedImageUrl?: string;
    }> {
        const evaluation = await this.evaluateTextContribution({
            makeModel: params.makeModel,
            rawContribution: params.rawText,
            tenantId: params.tenantId,
        });

        let sanitizedImageUrl: string | undefined;
        if (params.imageBuffer && evaluation.containsUniversalOem) {
            const { cleanBuffer } = await this.sanitizeImageForCommons(params.imageBuffer, params.tenantId);
            const { descriptor } = await CasStorageService.digestAndStore(
                cleanBuffer,
                'image/webp',
                'IMAGE_TECHNICAL_HD',
                {
                    scope: 'GLOBAL_OEM',
                    actorUid: params.actorUid,
                    originalFilename: params.originalImageName || 'commons_contribution.webp',
                }
            );
            sanitizedImageUrl = descriptor.downloadUrl;
        }

        let queueId: string | null = null;
        if (evaluation.containsUniversalOem) {
            const docRef = await db.collection('commons_airlock_queue').add({
                global_asset_id: params.globalAssetId,
                make_model: params.makeModel,
                tenantId: params.tenantId,
                tenant_id: params.tenantId,
                authorUid: params.actorUid,
                sanitized_universal_markdown: evaluation.sanitizedUniversalMarkdown,
                target_pillar_hint: evaluation.targetPillarHint || 'pauta_mantencion',
                sanitized_image_url: sanitizedImageUrl || null,
                detected_sensitive_categories: evaluation.detectedSensitiveCategories,
                status: 'PENDING_CURATION',
                createdAt: new Date().toISOString(),
            });
            queueId = docRef.id;
        }

        await AuditLedger.record({
            tenantId: params.tenantId,
            actorUid: params.actorUid,
            actorEmail: params.actorEmail,
            action: 'COMMONS_AIRLOCK_EVALUATED',
            module: 'opermaq',
            targetEntity: params.globalAssetId,
            details: {
                queueId,
                containsUniversalOem: evaluation.containsUniversalOem,
                containsTenantPrivate: evaluation.containsTenantPrivate,
                redactedCategories: evaluation.detectedSensitiveCategories,
            },
        }).catch(() => {});

        return {
            queueId,
            evaluation,
            sanitizedImageUrl,
        };
    }
}
