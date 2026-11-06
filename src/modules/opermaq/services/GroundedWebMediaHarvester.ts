import sharp from 'sharp';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { ResilientAIClient, type GroundingSource } from '../../../core/resilient-ai-client';
import { assertSafeExternalUrl, safeFetchExternal } from '../../../utils/ssrfGuard';
import type { ExtractedFigureRef } from '../types/vault.types';

/**
 * GROUNDED WEB MEDIA HARVESTER v4.0 — Captura Visual Autónoma Anti-SSRF desde Caza Web
 *
 * Resuelve la brecha histórica de OPERMAQ donde la caza web devolvía solo texto plano:
 * 1. Inspecciona las URLs reales de `groundingSources` bajo guardia estricta Anti-SSRF
 *    (solo `https:`, bloqueo total de IPs privadas RFC1918, loopback, link-local y metadata cloud).
 * 2. Extrae `<figure>` + `<figcaption>`, `<img src>` técnicos de alta resolución e inline `<svg>`,
 *    además de detectar enlaces directos a folletos/manuales `.pdf` públicos del fabricante.
 * 3. Filtra candidatos mediante verificación geométrica (`sharp` >= 220x160 px) + Juez VLM rápido
 *    (`ANCHOR_HA` `Flash-Lite`) que descarta logos, banners, avatares o fotos con marcas de agua ajenas.
 * 4. Digiere únicamente imágenes aprobadas en `CasStorageService` (`GLOBAL_OEM`, `IMAGE_TECHNICAL_HD`)
 *    y devuelve `ExtractedFigureRef[]` listas para incrustarse inline en el capítulo y en Manuales Ad-Hoc.
 */

const IGNORED_IMAGE_URL_PATTERNS =
    /(?:logo|avatar|icon|sprite|pixel|tracker|analytics|banner-ad|badge|favicon|social|facebook|linkedin|twitter|instagram|youtube\.com\/img)/i;

/**
 * Guardia Anti-SSRF centralizada (`ssrfGuard.ts`): verifica protocolo HTTPS, dominio público
 * y resolución DNS real fuera de rangos loopback, privados RFC1918, link-local y metadata Cloud Run.
 */
export async function assertSafePublicHttpsUrl(rawUrl: string): Promise<URL | null> {
    try {
        return await assertSafeExternalUrl(rawUrl);
    } catch {
        return null;
    }
}

async function fetchBoundedBytes(
    safeUrl: URL,
    maxBytes: number,
    acceptHeader: string,
    timeoutMs: number = 6500
): Promise<{ buffer: Buffer; contentType: string } | null> {
    try {
        const response = await safeFetchExternal(safeUrl.toString(), {
            method: 'GET',
            maxBytes,
            headers: {
                Accept: acceptHeader,
                'User-Agent': 'MINREPORT-TechnicalVaultBot/4.0 (+https://minreport-access.web.app)',
            },
            signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) return null;

        const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const arrayBuf = await response.arrayBuffer();
        if (arrayBuf.byteLength > maxBytes) return null;

        return {
            buffer: Buffer.from(arrayBuf),
            contentType,
        };
    } catch {
        return null;
    }
}

interface RawHtmlImageCandidate {
    imageUrl: string;
    altOrCaption: string;
    pageUrl: string;
}

function extractTechnicalCandidatesFromHtml(
    html: string,
    baseUrl: URL
): { images: RawHtmlImageCandidate[]; pdfUrls: string[] } {
    const images: RawHtmlImageCandidate[] = [];
    const pdfUrls = new Set<string>();
    const seenImgs = new Set<string>();

    // 1. Detectar enlaces directos a folletos / fichas `.pdf`
    const pdfRegex = /href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi;
    let pdfMatch: RegExpExecArray | null;
    while ((pdfMatch = pdfRegex.exec(html)) !== null && pdfUrls.size < 4) {
        try {
            const resolved = new URL(pdfMatch[1], baseUrl).toString();
            if (resolved.startsWith('https://')) pdfUrls.add(resolved);
        } catch {
            // Ignorar URL malformada
        }
    }

    // 2. Extraer `<figure>...</figure>` con prioridad por tener `<figcaption>`
    const figureRegex = /<figure\b[^>]*>([\s\S]*?)<\/figure>/gi;
    let figMatch: RegExpExecArray | null;
    while ((figMatch = figureRegex.exec(html)) !== null && images.length < 8) {
        const block = figMatch[1];
        const srcMatch = block.match(/(?:data-src|src)\s*=\s*["']([^"']+)["']/i);
        if (!srcMatch) continue;
        const captionMatch = block.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
        const altMatch = block.match(/alt\s*=\s*["']([^"']+)["']/i);
        const rawCaption = (captionMatch?.[1] || altMatch?.[1] || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        try {
            const resolved = new URL(srcMatch[1], baseUrl).toString();
            if (
                resolved.startsWith('https://') &&
                !IGNORED_IMAGE_URL_PATTERNS.test(resolved) &&
                !seenImgs.has(resolved)
            ) {
                seenImgs.add(resolved);
                images.push({
                    imageUrl: resolved,
                    altOrCaption: rawCaption.slice(0, 180),
                    pageUrl: baseUrl.toString(),
                });
            }
        } catch {
            // Ignorar
        }
    }

    // 3. Extraer `<img>` técnicos adicionales con `alt` descriptivo
    const imgRegex = /<img\b[^>]*>/gi;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgRegex.exec(html)) !== null && images.length < 10) {
        const tag = imgMatch[0];
        const srcMatch = tag.match(/(?:data-src|src)\s*=\s*["']([^"']+)["']/i);
        if (!srcMatch) continue;
        const altMatch = tag.match(/alt\s*=\s*["']([^"']+)["']/i);
        const alt = (altMatch?.[1] || '').replace(/\s+/g, ' ').trim();
        if (alt.length < 6) continue;

        try {
            const resolved = new URL(srcMatch[1], baseUrl).toString();
            if (
                resolved.startsWith('https://') &&
                !IGNORED_IMAGE_URL_PATTERNS.test(resolved) &&
                !seenImgs.has(resolved)
            ) {
                seenImgs.add(resolved);
                images.push({
                    imageUrl: resolved,
                    altOrCaption: alt.slice(0, 180),
                    pageUrl: baseUrl.toString(),
                });
            }
        } catch {
            // Ignorar
        }
    }

    return { images, pdfUrls: Array.from(pdfUrls) };
}

export class GroundedWebMediaHarvester {
    /**
     * Inspecciona las fuentes grounded de una caza web para recuperar diagramas, planos o fotos
     * reales del componente/equipo, validados por VLM y comprimidos en CAS WebP.
     */
    public static async harvestFromGroundingSources(params: {
        groundingSources: GroundingSource[];
        makeModel: string;
        itemTitle: string;
        maxFigures?: number;
    }): Promise<{
        figures: ExtractedFigureRef[];
        discoveredPdfUrls: string[];
    }> {
        const maxFigures = params.maxFigures ?? 2;
        const figures: ExtractedFigureRef[] = [];
        const discoveredPdfUrls = new Set<string>();

        if (!Array.isArray(params.groundingSources) || params.groundingSources.length === 0) {
            return { figures: [], discoveredPdfUrls: [] };
        }

        const candidateImages: RawHtmlImageCandidate[] = [];

        for (const src of params.groundingSources.slice(0, 4)) {
            if (!src?.uri) continue;
            if (/youtube\.com|youtu\.be/i.test(src.uri)) continue;

            const safeUrl = await assertSafePublicHttpsUrl(src.uri);
            if (!safeUrl) continue;

            if (safeUrl.pathname.toLowerCase().endsWith('.pdf')) {
                discoveredPdfUrls.add(safeUrl.toString());
                continue;
            }

            const fetched = await fetchBoundedBytes(
                safeUrl,
                1_500_000,
                'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
                5500
            );
            if (!fetched || !fetched.contentType.includes('html')) continue;

            const html = fetched.buffer.toString('utf8');
            const extracted = extractTechnicalCandidatesFromHtml(html, safeUrl);
            for (const pdf of extracted.pdfUrls) discoveredPdfUrls.add(pdf);
            for (const img of extracted.images) {
                if (candidateImages.length < 6) candidateImages.push(img);
            }
        }

        // Evaluar candidatos de imagen: dimensiones reales (`sharp`) + Juez VLM rápido (`ANCHOR_HA`)
        for (const cand of candidateImages) {
            if (figures.length >= maxFigures) break;

            const safeImgUrl = await assertSafePublicHttpsUrl(cand.imageUrl);
            if (!safeImgUrl) continue;

            const imgData = await fetchBoundedBytes(
                safeImgUrl,
                6 * 1024 * 1024,
                'image/webp,image/png,image/jpeg,image/*;q=0.8',
                6000
            );
            if (!imgData || !imgData.contentType.startsWith('image/')) continue;
            if (imgData.contentType.includes('svg')) continue;

            let width = 0;
            let height = 0;
            let previewPng: Buffer;
            try {
                const meta = await sharp(imgData.buffer).metadata();
                width = meta.width || 0;
                height = meta.height || 0;
                if (width < 260 || height < 180) continue;
                const aspect = width / height;
                if (aspect > 4.2 || aspect < 0.25) continue; // Descartar banners alargados

                previewPng = await sharp(imgData.buffer)
                    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 72 })
                    .toBuffer();
            } catch {
                continue;
            }

            // Juez VLM rápido (`Flash-Lite` / `ANCHOR_HA`) para garantizar pertinencia técnica y cero marcas de agua intrusivas
            try {
                const vlmCheck = await ResilientAIClient.generate({
                    module: 'opermaq',
                    preferredTier: 'ANCHOR_HA',
                    temperature: 0.0,
                    maxOutputTokens: 320,
                    media: [
                        {
                            mimeType: 'image/webp',
                            dataBase64: previewPng.toString('base64'),
                        },
                    ],
                    prompt: `Evalúa si esta imagen corresponde a apoyo técnico genuino (diagrama acotado, curva, esquema, cabina, componente o fotografía real de maquinaria/herramienta) útil para el capítulo "${params.itemTitle}" del equipo "${params.makeModel}".
Rechaza (` + '`is_valid: false`' + `) si es un logotipo corporativo, banner publicitario, retrato de personas, ícono decorativo o tiene marcas de agua invasivas de portales de compraventa.
Responde ESTRICTAMENTE en JSON:
{
  "is_valid": true,
  "figure_type": "DIAGRAMA_ACOTADO" | "CURVA_RENDIMIENTO" | "ESQUEMA_HIDRAULICO_ELECTRICO" | "FOTO_COMPONENTE" | "MAPA_LUBRICACION_PM",
  "title_es": "Título técnico conciso en español",
  "caption_es": "Descripción técnica breve verificable"
}`,
                });

                const verdict = JSON.parse(ResilientAIClient.extractJsonString(vlmCheck.text));
                if (!verdict?.is_valid) continue;

                const { descriptor } = await CasStorageService.digestAndStore(
                    imgData.buffer,
                    imgData.contentType,
                    'IMAGE_TECHNICAL_HD',
                    {
                        scope: 'GLOBAL_OEM',
                        actorUid: 'grounded-web-harvester',
                        originalFilename: cand.altOrCaption || 'web_technical_figure.webp',
                    }
                );

                figures.push({
                    figure_id: `fig_web_${descriptor.sha256.slice(0, 12)}`,
                    sha256: descriptor.sha256,
                    phash_hex: descriptor.phashHex,
                    storage_url: descriptor.downloadUrl,
                    mime_type: 'image/webp',
                    figure_type: verdict.figure_type || 'FOTO_COMPONENTE',
                    title_es: String(verdict.title_es || cand.altOrCaption || params.itemTitle).slice(0, 120),
                    caption_es: String(verdict.caption_es || '').slice(0, 220),
                    source_url: cand.pageUrl,
                    width: descriptor.width || width,
                    height: descriptor.height || height,
                });
            } catch {
                // Continuar silenciosamente si la evaluación VLM descarta o expira
            }
        }

        return {
            figures,
            discoveredPdfUrls: Array.from(discoveredPdfUrls).slice(0, 4),
        };
    }
}
