import sharp from 'sharp';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { ResilientAIClient, type GroundingSource } from '../../../core/resilient-ai-client';
import { assertSafeExternalUrl, safeFetchExternal } from '../../../utils/ssrfGuard';
import type { ExtractedFigureRef } from '../types/vault.types';
import {
    cropBox2dFromImage,
    extractPdfPageTexts,
    renderPdfPageToPng,
} from './SegmentedDocumentProcessorService';

/**
 * GROUNDED WEB MEDIA HARVESTER v5.0 — Captura Visual Real desde Caza Web (HTML + PDF OEM) bajo guardia Anti-SSRF
 *
 * Correcciones `FIX-02`:
 * 1. Resuelve URLs relativas contra la URL FINAL tras las redirecciones de `vertexaisearch.cloud.google.com`
 *    (antes se resolvían contra el redirector y fallaban con 404).
 * 2. Procesa fuentes que son PDF técnicos (`application/pdf`) y los PDF descubiertos dentro de páginas HTML:
 *    localiza páginas pertinentes por texto (`mupdf`), detecta figuras con VLM (`box_2d` `[ymin,xmin,ymax,xmax]`),
 *    recorta con `sharp` y digiere en CAS (`IMAGE_TECHNICAL_HD`).
 * 3. Extrae `srcset`, `data-src`, `data-lazy-src`, `data-original`, `<picture><source>` y `og:image`;
 *    ya no exige `alt` de 6+ caracteres (el filtro de pertinencia lo hace el juez VLM).
 * 4. Juez VLM con salida JSON tipada (`generateStructured`) y telemetría completa (`MediaHarvestReport`).
 *
 * Límites honestos: sitios que bloquean bots (HTTP 403) o que renderizan imágenes solo con JavaScript no entregan
 * candidatos; se registran en el reporte sin evadir controles de acceso.
 */

const IGNORED_IMAGE_URL_PATTERNS =
    /(?:logo|avatar|icon|sprite|pixel|tracker|analytics|banner-ad|badge|favicon|social|facebook|linkedin|twitter|instagram|youtube\.com\/img|placeholder|spacer|blank\.gif)/i;

const MAX_HTML_BYTES = 2_500_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PDF_BYTES = 18 * 1024 * 1024;
const MAX_EVIDENCE_TEXT_CHARS = 400_000;

/**
 * Convierte HTML en texto plano para usarlo como evidencia numérica (sin scripts, estilos ni etiquetas).
 */
export function htmlToPlainText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<\/(?:td|th)>/gi, ' | ')
        .replace(/<\/(?:p|div|li|tr|h[1-6]|br)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim();
}

export interface MediaHarvestReport {
    sources_inspected: number;
    html_pages_parsed: number;
    pdf_documents_parsed: number;
    image_candidates: number;
    pdf_pages_inspected: number;
    figures_stored: number;
    rejections: Record<string, number>;
}

function bumpRejection(report: MediaHarvestReport, reason: string): void {
    report.rejections[reason] = (report.rejections[reason] || 0) + 1;
}

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
    timeoutMs: number = 8000
): Promise<{ buffer: Buffer; contentType: string; finalUrl: URL; status: number } | { error: string; finalUrl?: URL }> {
    try {
        const response = await safeFetchExternal(safeUrl.toString(), {
            method: 'GET',
            maxBytes,
            headers: {
                Accept: acceptHeader,
                'User-Agent': 'MINREPORT-TechnicalVaultBot/5.0 (+https://minreport-access.web.app)',
            },
            signal: AbortSignal.timeout(timeoutMs),
        });

        let finalUrl = safeUrl;
        try {
            const headerFinal = response.headers.get('x-final-url') || response.url;
            if (headerFinal) finalUrl = new URL(headerFinal);
        } catch {
            finalUrl = safeUrl;
        }

        if (!response.ok) return { error: `HTTP_${response.status}`, finalUrl };

        const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const arrayBuf = await response.arrayBuffer();
        if (arrayBuf.byteLength > maxBytes) return { error: 'EXCEDE_TAMANO', finalUrl };

        return {
            buffer: Buffer.from(arrayBuf),
            contentType,
            finalUrl,
            status: response.status,
        };
    } catch (err: any) {
        const msg = String(err?.name || err?.message || 'FETCH_ERROR');
        return { error: /timeout|abort/i.test(msg) ? 'TIMEOUT' : /ssrf|bloque/i.test(msg) ? 'SSRF_BLOQUEADO' : 'FETCH_ERROR' };
    }
}

interface RawHtmlImageCandidate {
    imageUrl: string;
    altOrCaption: string;
    pageUrl: string;
    priority: number;
}

function pickBestFromSrcset(srcset: string): string | null {
    const entries = srcset
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
            const [url, desc] = s.split(/\s+/);
            const n = Number(String(desc || '').replace(/[^0-9.]/g, '')) || 1;
            return { url, n };
        })
        .filter((e) => e.url);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b.n - a.n);
    return entries[0].url;
}

function extractImgUrlFromTag(tag: string): string | null {
    const srcsetMatch = tag.match(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/i);
    if (srcsetMatch) {
        const best = pickBestFromSrcset(srcsetMatch[1]);
        if (best) return best;
    }
    const lazyMatch = tag.match(/(?:data-lazy-src|data-original|data-src|src)\s*=\s*["']([^"']+)["']/i);
    if (lazyMatch && !lazyMatch[1].startsWith('data:')) return lazyMatch[1];
    return null;
}

function extractTechnicalCandidatesFromHtml(
    html: string,
    baseUrl: URL
): { images: RawHtmlImageCandidate[]; pdfUrls: string[] } {
    const images: RawHtmlImageCandidate[] = [];
    const pdfUrls = new Set<string>();
    const seenImgs = new Set<string>();

    const pushImage = (rawUrl: string | null, caption: string, priority: number) => {
        if (!rawUrl) return;
        try {
            const resolved = new URL(rawUrl.replace(/&amp;/g, '&'), baseUrl).toString();
            if (!resolved.startsWith('https://')) return;
            if (IGNORED_IMAGE_URL_PATTERNS.test(resolved)) return;
            if (/\.svg(?:\?|$)/i.test(resolved)) return;
            if (seenImgs.has(resolved)) return;
            seenImgs.add(resolved);
            images.push({
                imageUrl: resolved,
                altOrCaption: caption.replace(/\s+/g, ' ').trim().slice(0, 180),
                pageUrl: baseUrl.toString(),
                priority,
            });
        } catch {
            // URL malformada
        }
    };

    // 1. Enlaces directos a folletos / fichas / manuales `.pdf`
    const pdfRegex = /href\s*=\s*["']([^"']+\.pdf(?:[?#][^"']*)?)["']/gi;
    let pdfMatch: RegExpExecArray | null;
    while ((pdfMatch = pdfRegex.exec(html)) !== null && pdfUrls.size < 6) {
        try {
            const resolved = new URL(pdfMatch[1].replace(/&amp;/g, '&'), baseUrl).toString();
            if (resolved.startsWith('https://')) pdfUrls.add(resolved);
        } catch {
            // Ignorar URL malformada
        }
    }

    // 2. `og:image` / `twitter:image` (imagen principal declarada por el sitio)
    const ogRegex = /<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/gi;
    let ogMatch: RegExpExecArray | null;
    while ((ogMatch = ogRegex.exec(html)) !== null) {
        const content = ogMatch[0].match(/content\s*=\s*["']([^"']+)["']/i);
        if (content) pushImage(content[1], 'Imagen principal declarada por la página', 2);
    }

    // 3. `<figure>` con `<figcaption>` (máxima prioridad: suelen ser diagramas o fotos técnicas rotuladas)
    const figureRegex = /<figure\b[^>]*>([\s\S]*?)<\/figure>/gi;
    let figMatch: RegExpExecArray | null;
    while ((figMatch = figureRegex.exec(html)) !== null && images.length < 24) {
        const block = figMatch[1];
        const imgTag = block.match(/<(?:img|source)\b[^>]*>/i)?.[0] || '';
        const captionMatch = block.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
        const altMatch = imgTag.match(/alt\s*=\s*["']([^"']*)["']/i);
        const caption = (captionMatch?.[1] || altMatch?.[1] || '').replace(/<[^>]+>/g, ' ');
        pushImage(extractImgUrlFromTag(imgTag), caption, 3);
    }

    // 4. `<picture><source srcset>` y `<img>` generales (sin exigir `alt`)
    const tagRegex = /<(?:img|source)\b[^>]*>/gi;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(html)) !== null && images.length < 24) {
        const tag = tagMatch[0];
        const altMatch = tag.match(/alt\s*=\s*["']([^"']*)["']/i);
        const alt = (altMatch?.[1] || '').trim();
        const declaredW = Number(tag.match(/\bwidth\s*=\s*["']?(\d+)/i)?.[1] || 0);
        if (declaredW > 0 && declaredW < 200) continue;
        pushImage(extractImgUrlFromTag(tag), alt, alt.length >= 6 ? 1 : 0);
    }

    images.sort((a, b) => b.priority - a.priority);
    return { images, pdfUrls: Array.from(pdfUrls) };
}

interface VlmImageVerdict {
    is_valid: boolean;
    relevance_score: number;
    figure_type: ExtractedFigureRef['figure_type'];
    title_es: string;
    caption_es: string;
    rejection_reason?: string;
}

const VALID_FIGURE_TYPES: ExtractedFigureRef['figure_type'][] = [
    'DIAGRAMA_ACOTADO',
    'CURVA_RENDIMIENTO',
    'ESQUEMA_HIDRAULICO_ELECTRICO',
    'FOTO_COMPONENTE',
    'MAPA_LUBRICACION_PM',
    'SIMBOLOGIA_SEGURIDAD',
];

function normalizeFigureType(raw: unknown): ExtractedFigureRef['figure_type'] {
    const s = String(raw || '').toUpperCase();
    return (VALID_FIGURE_TYPES as string[]).includes(s) ? (s as ExtractedFigureRef['figure_type']) : 'FOTO_COMPONENTE';
}

const BILINGUAL_OMM_TERM_EXPANSION: Record<string, string[]> = {
    mandos: ['controls', 'joystick', 'console', 'switch'],
    controles: ['controls', 'joystick', 'switch'],
    cabina: ['cab', 'operator', 'compartment', 'rops'],
    instrumentacion: ['monitoring', 'instrument', 'panel', 'display', 'gauge', 'indicator'],
    tablero: ['panel', 'display', 'gauge', 'indicator'],
    monitor: ['monitoring', 'display', 'indicator'],
    testigos: ['indicator', 'warning', 'alert'],
    arranque: ['starting', 'engine', 'preheat'],
    marcha: ['starting', 'operation', 'travel'],
    precalentamiento: ['warm', 'starting', 'preheat'],
    operacion: ['operation', 'operating', 'techniques'],
    carguio: ['loading', 'bucket', 'operation'],
    limites: ['limits', 'slope', 'grade', 'warning'],
    alertas: ['warning', 'alert', 'category', 'monitoring'],
    parada: ['stopping', 'shutdown', 'parking'],
    estacionamiento: ['parking', 'brake', 'stopping'],
    emergencia: ['emergency', 'secondary', 'towing'],
    remolque: ['towing', 'brake', 'release'],
    bloqueo: ['lock', 'disconnect', 'switch', 'interlock'],
    acople: ['coupler', 'attachment', 'work', 'tool'],
    implemento: ['attachment', 'coupler', 'work', 'tool'],
    hidraulico: ['hydraulic', 'auxiliary', 'flow'],
    hidraulica: ['hydraulic', 'auxiliary', 'flow'],
    motor: ['engine', 'power', 'torque'],
    motorizacion: ['engine', 'power', 'fuel'],
    dimensiones: ['dimensions', 'specifications', 'weight'],
    capacidades: ['capacities', 'refill', 'fluid'],
    lubricacion: ['lubrication', 'grease', 'maintenance', 'fitting'],
    mantencion: ['maintenance', 'interval', 'service', 'schedule'],
    pauta: ['schedule', 'interval', 'maintenance'],
    preventiva: ['preventive', 'maintenance', 'interval'],
    rutinario: ['routine', 'daily', 'walk', 'inspection'],
    lubricantes: ['lubricants', 'viscosities', 'refill', 'capacities'],
    fluidos: ['fluids', 'capacities', 'refill', 'oil'],
    viscosidades: ['viscosities', 'lubricant', 'sae'],
    refrigerante: ['coolant', 'cooling', 'radiator', 'elc'],
    filtros: ['filter', 'element', 'separator', 'breather', 'strainer'],
    engrase: ['grease', 'lubrication', 'fitting', 'bearing', 'pin'],
    grasera: ['grease', 'fitting', 'lubrication'],
    drenaje: ['drain', 'oil', 'sump', 'valve'],
    respiradero: ['breather', 'vent', 'tank'],
    muestreo: ['sample', 'sampling', 'sos', 'oil', 'valve'],
    tribologico: ['sampling', 'sos', 'oil', 'analysis'],
    sos: ['sos', 'sample', 'sampling', 'oil'],
    apriete: ['torque', 'bolt', 'nut', 'fastener', 'tightening'],
    torque: ['torque', 'tightening', 'bolt', 'specification'],
    desgaste: ['wear', 'clearance', 'limit', 'thickness'],
    holgura: ['clearance', 'lash', 'valve', 'adjustment'],
    valvulas: ['valve', 'lash', 'clearance', 'relief'],
    cadenas: ['chain', 'drive', 'sprocket', 'tension'],
    correas: ['belt', 'tension', 'alternator', 'pulley'],
    acumuladores: ['accumulator', 'precharge', 'nitrogen', 'pilot'],
    frenos: ['brake', 'parking', 'wear', 'disc'],
    aislamiento: ['isolation', 'disconnect', 'lockout', 'purge'],
    loto: ['lockout', 'disconnect', 'switch', 'relief'],
    riesgos: ['safety', 'hazard', 'warning', 'crush', 'rollover'],
    peligros: ['hazard', 'safety', 'warning', 'danger'],
    matriz: ['safety', 'hazard', 'messages', 'labels'],
    hsec: ['safety', 'hazard', 'protection', 'warning'],
    energia: ['energy', 'pressure', 'disconnect', 'isolation'],
    energias: ['energy', 'pressure', 'disconnect', 'isolation'],
    aplastamiento: ['crushing', 'crush', 'brace', 'support', 'pinch'],
    atrapamiento: ['pinch', 'crushing', 'entanglement', 'rotating', 'guard'],
    vuelco: ['rollover', 'rops', 'fops', 'seatbelt', 'stability'],
    colision: ['collision', 'visibility', 'blind', 'camera', 'mirror'],
    ciegos: ['blind', 'visibility', 'mirror', 'camera'],
    visibilidad: ['visibility', 'blind', 'mirror', 'window'],
    inyeccion: ['penetration', 'high', 'pressure', 'fluid', 'leak'],
    quemaduras: ['burn', 'hot', 'surface', 'coolant', 'exhaust'],
    incendio: ['fire', 'prevention', 'extinguisher', 'suppression', 'flammable'],
    supresion: ['suppression', 'fire', 'extinguisher', 'afex'],
    afex: ['suppression', 'fire', 'extinguisher'],
    extintor: ['extinguisher', 'fire', 'location'],
    higiene: ['sound', 'noise', 'vibration', 'dust', 'ergonomics'],
    ruido: ['sound', 'noise', 'decibel', 'hearing'],
    vibracion: ['vibration', 'seat', 'suspension'],
    silice: ['silica', 'dust', 'cab', 'filter', 'respirator'],
    polvo: ['dust', 'air', 'filter', 'cab'],
    epp: ['protective', 'equipment', 'ppe', 'safety'],
    etiquetas: ['labels', 'decals', 'messages', 'warning', 'safety'],
    calcomanias: ['decals', 'labels', 'messages', 'warning'],
    advertencia: ['warning', 'safety', 'messages', 'hazard'],
    checklist: ['inspection', 'walk', 'around', 'daily', 'check'],
    preoperacional: ['daily', 'inspection', 'walk', 'around', 'before', 'starting'],
    inspeccion: ['inspection', 'walk', 'around', 'daily', 'check'],
    perimetral: ['walk', 'around', 'inspection', 'daily'],
    recorrido: ['walk', 'around', 'inspection', 'daily'],
    vuelta: ['walk', 'around', 'inspection'],
    rodado: ['tire', 'wheel', 'rim', 'lug', 'track', 'undercarriage'],
    neumaticos: ['tire', 'inflation', 'pressure', 'wheel', 'rim'],
    orugas: ['track', 'undercarriage', 'roller', 'idler', 'sprocket'],
    tuercas: ['lug', 'nut', 'bolt', 'wheel', 'torque'],
    estanqueidad: ['leak', 'fluid', 'hose', 'seal'],
    fugas: ['leak', 'fluid', 'hose', 'oil', 'coolant'],
    mirilla: ['sight', 'gauge', 'glass', 'level'],
    mirillas: ['sight', 'gauge', 'glass', 'level'],
    varilla: ['dipstick', 'level', 'oil', 'check'],
    niveles: ['level', 'fluid', 'oil', 'coolant', 'sight', 'dipstick'],
    cinturon: ['seat', 'belt', 'restraint', 'buckle'],
    espejos: ['mirror', 'visibility', 'camera', 'window'],
    bocina: ['horn', 'alarm', 'backup'],
    retroceso: ['backup', 'alarm', 'travel', 'reverse'],
    cunas: ['chock', 'wheel', 'parking'],
    luces: ['light', 'lamp', 'headlight', 'strobe', 'beacon'],
    parabrisas: ['windshield', 'wiper', 'washer', 'window', 'glass'],
    limpiaparabrisas: ['wiper', 'washer', 'windshield'],
    prueba: ['test', 'check', 'functional', 'brake', 'starting'],
    funcional: ['functional', 'test', 'check', 'operation'],
    habilitacion: ['inspection', 'daily', 'before', 'starting'],
};

function computeKeywordTerms(itemTitle: string, makeModel: string): string[] {
    const stop = new Set(['del', 'las', 'los', 'para', 'con', 'por', 'una', 'que', 'sistema', 'sistemas', 'equipo', 'fase', 'etapa', 'dominio', 'zona']);
    const baseTokens = `${itemTitle} ${makeModel}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\[[^\]]*\]/g, ' ')
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2 && !stop.has(t));

    const expanded = new Set<string>();
    for (const tok of baseTokens) {
        expanded.add(tok);
        const enList = BILINGUAL_OMM_TERM_EXPANSION[tok];
        if (enList) {
            for (const en of enList) expanded.add(en);
        }
    }
    return Array.from(expanded).slice(0, 26);
}

export class GroundedWebMediaHarvester {
    /**
     * Juez VLM tipado: decide pertinencia técnica de una imagen para el capítulo y devuelve metadatos.
     */
    private static async judgeImage(params: {
        previewWebp: Buffer;
        itemTitle: string;
        makeModel: string;
        chapterExcerpt: string;
    }): Promise<VlmImageVerdict | null> {
        try {
            const res = await ResilientAIClient.generateStructured<VlmImageVerdict>({
                module: 'opermaq',
                preferredTier: 'SECONDARY',
                temperature: 0,
                maxOutputTokens: 600,
                thinkingLevel: 'low',
                media: [{ mimeType: 'image/webp', dataBase64: params.previewWebp.toString('base64') }],
                prompt: `Eres un juez técnico de figuras para el capítulo "${params.itemTitle}" del equipo "${params.makeModel}".
Resumen por secciones del capítulo (encabezado + elementos explícitamente referenciados en el texto):
"""
${params.chapterExcerpt.slice(0, 2400)}
"""
Evalúa la imagen adjunta. Es válida ("is_valid": true) ÚNICAMENTE si representa de forma directa un diagrama, esquema hidráulico/eléctrico, plano acotado, curva de desempeño o conjunto técnico que esté EXPLÍCITAMENTE citado o descrito en el resumen del capítulo.
RECHAZA ESTRICTAMENTE ("is_valid": false):
- Fotografías comerciales de catálogo de repuestos sueltos (packshots de e-commerce sobre fondo blanco como filtros sueltos, bombas de agua desmontadas, empaquetaduras, herrajes, casquillos, pernos o repuestos aislados) no solicitados como figura en el texto.
- Logotipos, banners, miniaturas de tienda, retratos, íconos decorativos, fotos de otros equipos o con marcas de agua invasivas.
No inventes ni describas nada que no sea visible en la imagen.
Responde SOLO JSON:
{"is_valid": boolean, "relevance_score": número 0..1, "figure_type": "DIAGRAMA_ACOTADO"|"CURVA_RENDIMIENTO"|"ESQUEMA_HIDRAULICO_ELECTRICO"|"FOTO_COMPONENTE"|"MAPA_LUBRICACION_PM"|"SIMBOLOGIA_SEGURIDAD", "title_es": "título técnico conciso del esquema/diagrama", "caption_es": "descripción técnica objetiva de lo visible", "rejection_reason": "motivo si no es válida"}`,
            });
            return res.data;
        } catch {
            return null;
        }
    }

    /**
     * Procesa un PDF técnico (fuente directa o descubierto en HTML): localiza páginas pertinentes por texto,
     * detecta figuras con VLM (`box_2d`), recorta con `sharp` y digiere en CAS.
     */
    private static async harvestFiguresFromPdfBuffer(params: {
        pdfBuffer: Buffer;
        sourceUrl: string;
        itemTitle: string;
        makeModel: string;
        chapterExcerpt?: string;
        maxFigures: number;
        report: MediaHarvestReport;
        sourceTexts?: Array<{ url: string; text: string }>;
    }): Promise<ExtractedFigureRef[]> {
        const { report } = params;
        const figures: ExtractedFigureRef[] = [];
        const pageTexts = await extractPdfPageTexts(params.pdfBuffer, 80).catch(() => []);
        if (pageTexts.length === 0) {
            bumpRejection(report, 'PDF_ILEGIBLE');
            return figures;
        }
        report.pdf_documents_parsed++;
        if (params.sourceTexts) {
            const joined = pageTexts
                .map((p) => `[Pág. ${p.pageIndex + 1}] ${p.text}`)
                .join('\n')
                .slice(0, MAX_EVIDENCE_TEXT_CHARS);
            if (joined.trim().length > 80) params.sourceTexts.push({ url: params.sourceUrl, text: joined });
        }
        if (params.maxFigures <= 0) return figures;

        const terms = computeKeywordTerms(params.itemTitle, params.makeModel);
        const scoredPages = pageTexts
            .map((p) => {
                const t = p.text
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '');
                let hits = 0;
                for (const term of terms) if (t.includes(term)) hits++;
                return { ...p, score: terms.length > 0 ? hits / terms.length : 0 };
            })
            .filter((p) => p.score >= 0.16)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);

        if (scoredPages.length === 0) {
            bumpRejection(report, 'PDF_SIN_PAGINAS_PERTINENTES');
            return figures;
        }

        for (const pg of scoredPages) {
            if (figures.length >= params.maxFigures) break;
            report.pdf_pages_inspected++;

            const rendered = await renderPdfPageToPng(params.pdfBuffer, pg.pageIndex, 170).catch(() => null);
            if (!rendered) {
                bumpRejection(report, 'PDF_RENDER_FALLIDO');
                continue;
            }

            const preview = await sharp(rendered.pngBuffer)
                .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 78 })
                .toBuffer();

            let detection: {
                figures: Array<{
                    box_2d: [number, number, number, number];
                    figure_type: string;
                    title_es: string;
                    caption_es: string;
                    relevance_score: number;
                    callouts?: Array<{ callout: string; component_es: string; function_or_spec?: string }>;
                }>;
            } | null = null;

            try {
                const res = await ResilientAIClient.generateStructured<typeof detection & object>({
                    module: 'opermaq',
                    preferredTier: 'SECONDARY',
                    temperature: 0,
                    maxOutputTokens: 1400,
                    thinkingLevel: 'low',
                    media: [{ mimeType: 'image/webp', dataBase64: preview.toString('base64') }],
                    prompt: `Página ${pg.pageIndex + 1} de un documento técnico oficial de "${params.makeModel}".
Capítulo objetivo: "${params.itemTitle}".
${params.chapterExcerpt ? `Secciones del capítulo:\n"""\n${params.chapterExcerpt.slice(0, 1600)}\n"""\n` : ''}Localiza SOLO figuras técnicas (diagramas de mandos/cabina/consola, mapas del panel de instrumentos, esquemas hidráulicos/eléctricos, vistas acotadas, curvas de desempeño o diagramas de remolque/bloqueo) que correspondan directamente al capítulo "${params.itemTitle}".
RECHAZA fotos comerciales de repuestos sueltos (packshots de filtros, bombas sueltas, herrajes), logotipos, portadas, encabezados y texto corrido. Si no hay figuras pertinentes devuelve una lista vacía.
Para cada figura devuelve "box_2d" como [ymin, xmin, ymax, xmax] normalizado 0..1000 que encierre la figura completa con sus rótulos y números de referencia, y si tiene números/letras de llamada (1..N), extráelos en "callouts".
Responde SOLO JSON:
{"figures":[{"box_2d":[0,0,0,0],"figure_type":"DIAGRAMA_ACOTADO|CURVA_RENDIMIENTO|ESQUEMA_HIDRAULICO_ELECTRICO|FOTO_COMPONENTE|MAPA_LUBRICACION_PM|SIMBOLOGIA_SEGURIDAD","title_es":"título técnico conciso","caption_es":"descripción técnica objetiva de lo visible","relevance_score":0.0,"callouts":[{"callout":"1","component_es":"nombre del mando o componente","function_or_spec":"función si consta en la página"}]}]}`,
                });
                detection = res.data as any;
            } catch {
                bumpRejection(report, 'VLM_PDF_SIN_RESPUESTA');
                continue;
            }

            const dets = Array.isArray(detection?.figures) ? detection!.figures : [];
            if (dets.length === 0) {
                bumpRejection(report, 'PDF_PAGINA_SIN_FIGURAS');
                continue;
            }

            for (const det of dets.sort((a, b) => Number(b.relevance_score) - Number(a.relevance_score))) {
                if (figures.length >= params.maxFigures) break;
                if (Number(det.relevance_score) < 0.7) {
                    bumpRejection(report, 'PDF_FIGURA_BAJA_PERTINENCIA');
                    continue;
                }
                if (!Array.isArray(det.box_2d) || det.box_2d.length !== 4) {
                    bumpRejection(report, 'PDF_BOX2D_INVALIDO');
                    continue;
                }
                const crop = await cropBox2dFromImage(
                    rendered.pngBuffer,
                    rendered.width,
                    rendered.height,
                    det.box_2d.map(Number) as [number, number, number, number]
                ).catch(() => null);
                if (!crop) {
                    bumpRejection(report, 'PDF_RECORTE_INVALIDO');
                    continue;
                }

                try {
                    const { descriptor } = await CasStorageService.digestAndStore(crop, 'image/png', 'IMAGE_TECHNICAL_HD', {
                        scope: 'GLOBAL_OEM',
                        actorUid: 'grounded-web-harvester-pdf',
                        originalFilename: `web_pdf_p${pg.pageIndex + 1}.png`,
                    });
                    const cleanCallouts = Array.isArray(det.callouts)
                        ? det.callouts
                              .filter((c) => c && c.callout && c.component_es)
                              .slice(0, 16)
                              .map((c) => ({
                                  callout: String(c.callout).trim().slice(0, 12),
                                  component_es: String(c.component_es).trim().slice(0, 120),
                                  ...(c.function_or_spec ? { function_or_spec: String(c.function_or_spec).trim().slice(0, 160) } : {}),
                              }))
                        : undefined;
                    figures.push({
                        figure_id: `fig_webpdf_${descriptor.sha256.slice(0, 12)}`,
                        sha256: descriptor.sha256,
                        phash_hex: descriptor.phashHex,
                        storage_url: descriptor.downloadUrl,
                        mime_type: 'image/webp',
                        figure_type: normalizeFigureType(det.figure_type),
                        title_es: String(det.title_es || params.itemTitle).slice(0, 120),
                        caption_es: String(det.caption_es || '').slice(0, 220),
                        ...(cleanCallouts && cleanCallouts.length > 0 ? { callouts: cleanCallouts } : {}),
                        source_page: pg.pageIndex + 1,
                        source_url: params.sourceUrl,
                        box_2d: det.box_2d.map(Number) as [number, number, number, number],
                        width: descriptor.width,
                        height: descriptor.height,
                        original_bytes: descriptor.originalBytes,
                        optimized_bytes: descriptor.optimizedBytes,
                        savings_pct: descriptor.savingsPct ?? Number((Number(descriptor.savingsRatio || 0) * 100).toFixed(1)),
                    });
                    report.figures_stored++;
                } catch {
                    bumpRejection(report, 'CAS_ERROR');
                }
            }
        }

        return figures;
    }

    /**
     * Inspecciona las fuentes grounded de una caza web para recuperar diagramas, planos o fotos
     * reales del componente/equipo (HTML y PDF), validados por VLM y comprimidos en CAS WebP.
     */
    public static async harvestFromGroundingSources(params: {
        groundingSources: GroundingSource[];
        makeModel: string;
        itemTitle: string;
        chapterExcerpt?: string;
        maxFigures?: number;
        /** Presupuesto global de red para la fase de fuentes (OPT-F4.1). Por defecto 14 s. */
        sourceBudgetMs?: number;
        /** Presupuesto total máximo incluyendo evaluación VLM (`VEL-02`). Por defecto 25 s. */
        totalHarvestBudgetMs?: number;
        /** Señal de aborto cooperativo (`VEL-02`) para detener VLM sin perder `resolvedSourceUrls` ni `sourceTexts`. */
        signal?: AbortSignal;
    }): Promise<{
        figures: ExtractedFigureRef[];
        discoveredPdfUrls: string[];
        resolvedSourceUrls: Record<string, string>;
        /** Texto plano de las fuentes efectivamente descargadas (evidencia para el verificador numérico OPT-F3.2). */
        sourceTexts: Array<{ url: string; text: string }>;
        report: MediaHarvestReport;
    }> {
        const maxFigures = params.maxFigures ?? 3;
        const figures: ExtractedFigureRef[] = [];
        const discoveredPdfUrls = new Set<string>();
        const resolvedSourceUrls: Record<string, string> = {};
        const sourceTexts: Array<{ url: string; text: string }> = [];
        const directPdfBuffers: Array<{ buffer: Buffer; url: string }> = [];
        const report: MediaHarvestReport = {
            sources_inspected: 0,
            html_pages_parsed: 0,
            pdf_documents_parsed: 0,
            image_candidates: 0,
            pdf_pages_inspected: 0,
            figures_stored: 0,
            rejections: {},
        };

        if (!Array.isArray(params.groundingSources) || params.groundingSources.length === 0) {
            bumpRejection(report, 'SIN_FUENTES_WEB');
            return { figures: [], discoveredPdfUrls: [], resolvedSourceUrls, sourceTexts, report };
        }

        const candidateImages: RawHtmlImageCandidate[] = [];
        const budgetMs = params.sourceBudgetMs ?? 14_000;
        const deadline = Date.now() + budgetMs;
        const totalDeadline = Date.now() + (params.totalHarvestBudgetMs ?? 25_000);
        const isHarvestExpired = (): boolean =>
            Boolean(params.signal?.aborted) || Date.now() >= totalDeadline;

        // 1. Fuentes grounded en paralelo (concurrencia 3) con presupuesto global y URL FINAL tras redirecciones (OPT-F4.1)
        const eligibleSources = params.groundingSources
            .slice(0, 7)
            .filter((src) => src?.uri && !/youtube\.com|youtu\.be/i.test(src.uri));

        const processSource = async (src: GroundingSource): Promise<void> => {
            const remaining = deadline - Date.now();
            if (remaining < 1500) {
                bumpRejection(report, 'PRESUPUESTO_RED_AGOTADO');
                return;
            }
            report.sources_inspected++;

            const safeUrl = await assertSafePublicHttpsUrl(src.uri);
            if (!safeUrl) {
                bumpRejection(report, 'URL_NO_SEGURA');
                return;
            }

            const fetched = await fetchBoundedBytes(
                safeUrl,
                MAX_PDF_BYTES,
                'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5',
                Math.min(9000, remaining)
            );
            if (fetched.finalUrl) {
                resolvedSourceUrls[src.uri] = fetched.finalUrl.toString();
            }
            if ('error' in fetched) {
                bumpRejection(report, fetched.error);
                return;
            }

            const isPdf =
                fetched.contentType.includes('pdf') ||
                fetched.finalUrl.pathname.toLowerCase().endsWith('.pdf') ||
                fetched.buffer.subarray(0, 5).toString('latin1') === '%PDF-';

            if (isPdf) {
                discoveredPdfUrls.add(fetched.finalUrl.toString());
                directPdfBuffers.push({ buffer: fetched.buffer, url: fetched.finalUrl.toString() });
                return;
            }

            if (!fetched.contentType.includes('html')) {
                bumpRejection(report, 'CONTENIDO_NO_HTML');
                return;
            }
            if (fetched.buffer.byteLength > MAX_HTML_BYTES) {
                bumpRejection(report, 'HTML_EXCEDE_TAMANO');
                return;
            }

            report.html_pages_parsed++;
            const html = fetched.buffer.toString('utf8');
            const plain = htmlToPlainText(html);
            if (plain.length > 80) {
                sourceTexts.push({ url: fetched.finalUrl.toString(), text: plain.slice(0, MAX_EVIDENCE_TEXT_CHARS) });
            }
            // FIX-02: base = URL final real (no el redirector de grounding)
            const extracted = extractTechnicalCandidatesFromHtml(html, fetched.finalUrl);
            for (const pdf of extracted.pdfUrls) discoveredPdfUrls.add(pdf);
            if (extracted.images.length === 0) bumpRejection(report, 'HTML_SIN_IMAGENES_ESTATICAS');
            for (const img of extracted.images.slice(0, 6)) {
                if (candidateImages.length < 14) candidateImages.push(img);
            }
        };

        let cursor = 0;
        const workers = Array.from({ length: Math.min(3, eligibleSources.length) }, async () => {
            while (cursor < eligibleSources.length) {
                const next = eligibleSources[cursor++];
                await processSource(next).catch(() => bumpRejection(report, 'FUENTE_ERROR'));
            }
        });
        await Promise.all(workers);

        report.image_candidates = candidateImages.length;
        candidateImages.sort((a, b) => b.priority - a.priority);

        // 2. Evaluar candidatos HTML en paralelo acotado (concurrencia = 3, `VEL-02`): geometría real (`sharp`) + Juez VLM tipado
        const evaluateImageCandidate = async (cand: RawHtmlImageCandidate): Promise<void> => {
            if (figures.length >= maxFigures || isHarvestExpired()) return;

            const safeImgUrl = await assertSafePublicHttpsUrl(cand.imageUrl);
            if (!safeImgUrl) {
                bumpRejection(report, 'URL_IMAGEN_NO_SEGURA');
                return;
            }
            if (figures.length >= maxFigures || isHarvestExpired()) return;

            const remainingMs = Math.max(1500, Math.min(7000, totalDeadline - Date.now()));
            const imgData = await fetchBoundedBytes(
                safeImgUrl,
                MAX_IMAGE_BYTES,
                'image/webp,image/png,image/jpeg,image/*;q=0.8',
                remainingMs
            );
            if ('error' in imgData) {
                bumpRejection(report, `IMG_${imgData.error}`);
                return;
            }
            if (!imgData.contentType.startsWith('image/') || imgData.contentType.includes('svg')) {
                bumpRejection(report, 'IMG_TIPO_NO_SOPORTADO');
                return;
            }

            let width = 0;
            let height = 0;
            let previewWebp: Buffer;
            try {
                const meta = await sharp(imgData.buffer).metadata();
                width = meta.width || 0;
                height = meta.height || 0;
                if (width < 260 || height < 180) {
                    bumpRejection(report, 'IMG_RESOLUCION_INSUFICIENTE');
                    return;
                }
                const aspect = width / height;
                if (aspect > 4.2 || aspect < 0.25) {
                    bumpRejection(report, 'IMG_PROPORCION_BANNER');
                    return;
                }
                previewWebp = await sharp(imgData.buffer)
                    .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 74 })
                    .toBuffer();
            } catch {
                bumpRejection(report, 'IMG_DECODIFICACION_FALLIDA');
                return;
            }

            if (figures.length >= maxFigures || isHarvestExpired()) return;

            const verdict = await this.judgeImage({
                previewWebp,
                itemTitle: params.itemTitle,
                makeModel: params.makeModel,
                chapterExcerpt: params.chapterExcerpt || cand.altOrCaption || '',
            });
            if (!verdict) {
                bumpRejection(report, 'VLM_SIN_RESPUESTA');
                return;
            }
            if (!verdict.is_valid || Number(verdict.relevance_score) < 0.72) {
                bumpRejection(report, 'VLM_NO_PERTINENTE');
                return;
            }
            if (figures.length >= maxFigures) return;

            try {
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

                if (figures.length < maxFigures) {
                    figures.push({
                        figure_id: `fig_web_${descriptor.sha256.slice(0, 12)}`,
                        sha256: descriptor.sha256,
                        phash_hex: descriptor.phashHex,
                        storage_url: descriptor.downloadUrl,
                        mime_type: 'image/webp',
                        figure_type: normalizeFigureType(verdict.figure_type),
                        title_es: String(verdict.title_es || cand.altOrCaption || params.itemTitle).slice(0, 120),
                        caption_es: String(verdict.caption_es || '').slice(0, 220),
                        source_url: cand.pageUrl,
                        width: descriptor.width || width,
                        height: descriptor.height || height,
                        original_bytes: descriptor.originalBytes,
                        optimized_bytes: descriptor.optimizedBytes,
                        savings_pct:
                            descriptor.savingsPct ??
                            Number((Number(descriptor.savingsRatio || 0) * 100).toFixed(1)),
                    });
                    report.figures_stored++;
                }
            } catch {
                bumpRejection(report, 'CAS_ERROR');
            }
        };

        let imgCursor = 0;
        const imgWorkers = Array.from({ length: Math.min(3, candidateImages.length) }, async () => {
            while (imgCursor < candidateImages.length) {
                if (figures.length >= maxFigures || isHarvestExpired()) break;
                const cand = candidateImages[imgCursor++];
                await evaluateImageCandidate(cand).catch(() => bumpRejection(report, 'IMG_WORKER_ERROR'));
            }
        });
        await Promise.all(imgWorkers);

        // 3. PDF técnicos: primero los entregados directamente por grounding, luego los descubiertos en HTML.
        for (const pdf of directPdfBuffers) {
            if (isHarvestExpired()) break;
            const pdfFigs = await this.harvestFiguresFromPdfBuffer({
                pdfBuffer: pdf.buffer,
                sourceUrl: pdf.url,
                itemTitle: params.itemTitle,
                makeModel: params.makeModel,
                chapterExcerpt: params.chapterExcerpt,
                maxFigures: Math.max(0, maxFigures - figures.length),
                report,
                sourceTexts,
            }).catch(() => []);
            figures.push(...pdfFigs);
        }

        const alreadyParsed = new Set(directPdfBuffers.map((p) => p.url));
        for (const pdfUrl of Array.from(discoveredPdfUrls).slice(0, 3)) {
            if (figures.length >= maxFigures || isHarvestExpired()) break;
            if (alreadyParsed.has(pdfUrl)) continue;
            if (totalDeadline - Date.now() < 3000) {
                bumpRejection(report, 'PRESUPUESTO_RED_AGOTADO');
                break;
            }
            const safePdf = await assertSafePublicHttpsUrl(pdfUrl);
            if (!safePdf) {
                bumpRejection(report, 'URL_PDF_NO_SEGURA');
                continue;
            }
            const pdfData = await fetchBoundedBytes(
                safePdf,
                MAX_PDF_BYTES,
                'application/pdf,*/*;q=0.5',
                Math.min(10000, Math.max(2500, totalDeadline - Date.now()))
            );
            if ('error' in pdfData) {
                bumpRejection(report, `PDF_${pdfData.error}`);
                continue;
            }
            if (pdfData.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
                bumpRejection(report, 'PDF_FIRMA_INVALIDA');
                continue;
            }
            if (isHarvestExpired()) break;
            const pdfFigs = await this.harvestFiguresFromPdfBuffer({
                pdfBuffer: pdfData.buffer,
                sourceUrl: pdfData.finalUrl.toString(),
                itemTitle: params.itemTitle,
                makeModel: params.makeModel,
                chapterExcerpt: params.chapterExcerpt,
                maxFigures: maxFigures - figures.length,
                report,
                sourceTexts,
            }).catch(() => []);
            figures.push(...pdfFigs);
        }

        return {
            figures,
            discoveredPdfUrls: Array.from(discoveredPdfUrls).slice(0, 6),
            resolvedSourceUrls,
            sourceTexts,
            report,
        };
    }
}
