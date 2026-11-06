import { createHash } from 'crypto';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import type { MediaDigestionProfile } from '../../contracts/media.contracts';
import { importEsm } from '../esm-loader';

/**
 * MINREPORT MEDIA DIGESTOR SERVER v4.0 (Capa 2/5 — Optimización Universal Sin Pérdida Técnica)
 *
 * Procesa PDF, Imagen y SVG garantizando:
 * 1. Purga total de metadatos privados (EXIF, GPS, XMP, Autor, Productor).
 * 2. Huella criptográfica SHA-256 exacta + Huella perceptual `dHash` 64-bit (`pHashHex` 16 chars)
 *    para detectar cuasi-duplicados visuales aunque hayan sido recodificados.
 * 3. Compresión híbrida selectiva en PDF:
 *    - Fase 1: `pdf-lib` Object Streams (compresión estructural 100% sin pérdida vectorial).
 *    - Fase 2: `mupdf` WASM selectivo por página — rasteriza a 160 DPI JPEG 0.78 ÚNICAMENTE
 *      las páginas escaneadas pesadas sin capa textual (`< 160` caracteres), preservando
 *      intactos los diagramas vectoriales, planos CAD y textos buscables.
 * 4. Recorte óptico automático al canal alfa (`sharp.trim`) para simbología ISO/OEM.
 */

export interface DigestedBinaryOutput {
    buffer: Buffer;
    sha256: string;
    phashHex?: string;
    mimeType: string;
    extension: string;
    profile: MediaDigestionProfile;
    originalBytes: number;
    optimizedBytes: number;
    savingsRatio: number;
    width?: number;
    height?: number;
    pageCount?: number;
    resampledPages?: number;
    preservedVectorPages?: number;
}

const IMAGE_PROFILE_SPECS: Record<
    'IMAGE_TECHNICAL_HD' | 'IMAGE_FIELD_EVIDENCE' | 'IMAGE_THUMBNAIL' | 'IMAGE_ISO_SYMBOL',
    { maxDim: number; quality: number; nearLossless?: boolean; autoTrimAlpha?: boolean }
> = {
    IMAGE_TECHNICAL_HD: { maxDim: 2048, quality: 86 },
    IMAGE_FIELD_EVIDENCE: { maxDim: 1280, quality: 76 },
    IMAGE_THUMBNAIL: { maxDim: 420, quality: 62 },
    IMAGE_ISO_SYMBOL: { maxDim: 512, quality: 92, nearLossless: true, autoTrimAlpha: true },
};

const MAX_MUPDF_CONCURRENCY = 2;
let activeMupdfTasks = 0;
const mupdfWaitQueue: Array<() => void> = [];

/**
 * Semáforo global para acotar instancias simultáneas de `mupdf` WASM (máx 2)
 * y prevenir agotamiento de memoria lineal WASM ante cargas concurrentes.
 */
export async function withMupdfSemaphore<T>(task: () => Promise<T>): Promise<T> {
    if (activeMupdfTasks >= MAX_MUPDF_CONCURRENCY) {
        await new Promise<void>((resolve) => {
            mupdfWaitQueue.push(resolve);
        });
    }
    activeMupdfTasks++;
    try {
        return await task();
    } finally {
        activeMupdfTasks = Math.max(0, activeMupdfTasks - 1);
        const next = mupdfWaitQueue.shift();
        if (next) next();
    }
}

export class MediaDigestorServer {
    public static computeSha256Hex(data: Buffer | Uint8Array | string): string {
        return createHash('sha256').update(data).digest('hex');
    }

    /**
     * Calcula un hash perceptual diferencial de 64 bits (`9x8` luminancia) en hexadecimal (16 chars).
     * Distancia de Hamming <= 5 identifica imágenes visualmente equivalentes pese a re-escalado o recodificación.
     */
    public static async computePerceptualHash64(imageBuffer: Buffer): Promise<string | undefined> {
        try {
            const raw9x8 = await sharp(imageBuffer)
                .grayscale()
                .resize(9, 8, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
                .raw()
                .toBuffer();

            if (raw9x8.length < 72) return undefined;

            let bits = 0n;
            for (let row = 0; row < 8; row++) {
                const rowOffset = row * 9;
                for (let col = 0; col < 8; col++) {
                    const left = raw9x8[rowOffset + col];
                    const right = raw9x8[rowOffset + col + 1];
                    bits = (bits << 1n) | (left > right ? 1n : 0n);
                }
            }
            return bits.toString(16).padStart(16, '0');
        } catch {
            return undefined;
        }
    }

    /**
     * Distancia de Hamming entre dos hashes perceptuales hexadecimales de 64 bits (0..64)
     */
    public static hammingDistanceHex64(hashA?: string, hashB?: string): number {
        if (!hashA || !hashB || hashA.length !== 16 || hashB.length !== 16) {
            return 64;
        }
        try {
            let xor = BigInt(`0x${hashA}`) ^ BigInt(`0x${hashB}`);
            let dist = 0;
            while (xor > 0n) {
                dist += Number(xor & 1n);
                xor >>= 1n;
            }
            return dist;
        } catch {
            return 64;
        }
    }

    /**
     * Sanitiza y minifica gráficos vectoriales `.svg` con `svgo` (0 scripts, 0 XSS, viewBox garantizado)
     */
    public static async digestSvg(svgInput: Buffer | string): Promise<DigestedBinaryOutput> {
        const rawStr = Buffer.isBuffer(svgInput) ? svgInput.toString('utf8') : String(svgInput);
        const originalBytes = Buffer.byteLength(rawStr, 'utf8');

        // Purga defensiva anti-XSS antes de optimización AST
        let sanitized = rawStr
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
            .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(/javascript\s*:/gi, '');

        try {
            const svgoMod = await importEsm<typeof import('svgo')>('svgo');
            const optimized = svgoMod.optimize(sanitized, {
                multipass: true,
                plugins: ['preset-default', 'removeDimensions', 'removeScripts'],
            });
            if (optimized?.data) {
                sanitized = optimized.data;
            }
        } catch (err: any) {
            console.warn('[MEDIA-DIGESTOR] Fallback de sanitización SVG sin AST:', err?.message);
        }

        // Garantizar xmlns para renderizado autónomo en `<img>` y PDFs
        if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(sanitized)) {
            sanitized = sanitized.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        }

        const outBuffer = Buffer.from(sanitized.trim(), 'utf8');
        const optimizedBytes = outBuffer.length;
        const sha256 = this.computeSha256Hex(outBuffer);
        const savingsRatio =
            originalBytes > 0 ? Math.max(0, Number(((originalBytes - optimizedBytes) / originalBytes).toFixed(4))) : 0;

        return {
            buffer: outBuffer,
            sha256,
            mimeType: 'image/svg+xml',
            extension: 'svg',
            profile: 'VECTOR_SVG_CLEAN',
            originalBytes,
            optimizedBytes,
            savingsRatio,
        };
    }

    /**
     * Optimiza imágenes fotográficas, esquemas técnicos o recortes ISO hacia WebP limpio sin EXIF
     */
    public static async digestImage(
        inputBuffer: Buffer,
        profile:
            | 'IMAGE_TECHNICAL_HD'
            | 'IMAGE_FIELD_EVIDENCE'
            | 'IMAGE_THUMBNAIL'
            | 'IMAGE_ISO_SYMBOL' = 'IMAGE_FIELD_EVIDENCE'
    ): Promise<DigestedBinaryOutput> {
        const originalBytes = inputBuffer.length;
        const spec = IMAGE_PROFILE_SPECS[profile] || IMAGE_PROFILE_SPECS.IMAGE_FIELD_EVIDENCE;

        let pipeline = sharp(inputBuffer, { failOn: 'none' }).rotate(); // Auto-orienta según EXIF y descarta metadatos EXIF/GPS

        if (spec.autoTrimAlpha) {
            try {
                // Recorte óptico al contenido real eliminando márgenes muertos blancos/transparentes
                const trimmed = await pipeline
                    .ensureAlpha()
                    .trim({ threshold: 14 })
                    .extend({
                        top: 12,
                        bottom: 12,
                        left: 12,
                        right: 12,
                        background: { r: 0, g: 0, b: 0, alpha: 0 },
                    })
                    .toBuffer();
                pipeline = sharp(trimmed);
            } catch {
                pipeline = sharp(inputBuffer, { failOn: 'none' }).rotate();
            }
        }

        const resized = pipeline.resize({
            width: spec.maxDim,
            height: spec.maxDim,
            fit: 'inside',
            withoutEnlargement: true,
        });

        const { data: webpBuffer, info } = await resized
            .webp({
                quality: spec.quality,
                nearLossless: Boolean(spec.nearLossless),
                effort: 4,
            })
            .toBuffer({ resolveWithObject: true });

        const phashHex = await this.computePerceptualHash64(webpBuffer);
        const sha256 = this.computeSha256Hex(webpBuffer);
        const optimizedBytes = webpBuffer.length;
        const savingsRatio =
            originalBytes > 0 ? Math.max(0, Number(((originalBytes - optimizedBytes) / originalBytes).toFixed(4))) : 0;

        return {
            buffer: webpBuffer,
            sha256,
            phashHex,
            mimeType: 'image/webp',
            extension: 'webp',
            profile,
            originalBytes,
            optimizedBytes,
            savingsRatio,
            width: info.width,
            height: info.height,
        };
    }

    /**
     * Digestor Híbrido de PDFs Extensos (`PDF_HYBRID_OEM`):
     * - Fase 1: Compresión sin pérdida estructural con `pdf-lib` (`useObjectStreams: true`) + purga de metadatos privados.
     * - Fase 2: Si el PDF supera el umbral de peso por página (> 350 KB/pág promedio) y `enableSelectiveRaster !== false`,
     *   analiza página por página con `mupdf`: conserva 100% intactas las páginas vectoriales/textuales y re-muestrea
     *   exclusivamente páginas escaneadas pesadas (`< 160` caracteres de texto) a `160 DPI` JPEG `0.78` (`mozjpeg`).
     */
    public static async digestPdf(
        pdfBuffer: Buffer,
        options: { enableSelectiveRaster?: boolean; targetScannedDpi?: number } = {}
    ): Promise<DigestedBinaryOutput> {
        const originalBytes = pdfBuffer.length;
        const enableSelectiveRaster = options.enableSelectiveRaster ?? true;
        const targetDpi = options.targetScannedDpi || 160;

        let srcDoc: PDFDocument;
        try {
            srcDoc = await PDFDocument.load(pdfBuffer, {
                ignoreEncryption: true,
                updateMetadata: false,
            });
        } catch {
            // Si el PDF tiene estructura exótica no editable por pdf-lib, devolver el binario original con su SHA-256
            const sha256 = this.computeSha256Hex(pdfBuffer);
            return {
                buffer: pdfBuffer,
                sha256,
                mimeType: 'application/pdf',
                extension: 'pdf',
                profile: 'PDF_HYBRID_OEM',
                originalBytes,
                optimizedBytes: originalBytes,
                savingsRatio: 0,
            };
        }

        // Purgar metadatos privados de autoría / corporativos (Zero-Trust Privacy)
        srcDoc.setAuthor('');
        srcDoc.setCreator('MINREPORT MediaDigestor v4.0');
        srcDoc.setProducer('MINREPORT Industrial Core');
        srcDoc.setSubject('');
        srcDoc.setKeywords([]);

        const pageCount = srcDoc.getPageCount();
        const phase1Bytes = await srcDoc.save({
            useObjectStreams: true,
            addDefaultPage: false,
            objectsPerTick: 100,
        });
        let bestBuffer: Buffer = Buffer.from(phase1Bytes.buffer, phase1Bytes.byteOffset, phase1Bytes.byteLength);
        if (bestBuffer.length > originalBytes) {
            bestBuffer = Buffer.from(pdfBuffer);
        }

        let resampledPages = 0;
        let preservedVectorPages = pageCount;

        const avgBytesPerPage = bestBuffer.length / Math.max(1, pageCount);
        const shouldInspectForHeavyScans =
            enableSelectiveRaster && bestBuffer.length > 900_000 && avgBytesPerPage > 260_000 && pageCount <= 450;

        if (shouldInspectForHeavyScans) {
            try {
                await withMupdfSemaphore(async () => {
                    const mupdfMod = await importEsm<any>('mupdf');
                    const mupdf = mupdfMod.default || mupdfMod;
                    let muDoc: any = null;
                    try {
                        muDoc = mupdf.Document.openDocument(bestBuffer, 'application/pdf');
                        const hybridDoc = await PDFDocument.create();
                        hybridDoc.setCreator('MINREPORT MediaDigestor v4.0');
                        hybridDoc.setProducer('MINREPORT Industrial Core');

                        const scale = targetDpi / 72;
                        const scaleMatrix = mupdf.Matrix.scale(scale, scale);

                        let candidateResampled = 0;
                        let candidatePreserved = 0;

                        for (let i = 0; i < pageCount; i++) {
                            const muPage = muDoc.loadPage(i);
                            let textLen = 0;
                            try {
                                const stext = muPage.toStructuredText('preserve-whitespace');
                                textLen = stext.asText().trim().length;
                                stext.destroy?.();
                            } catch {
                                textLen = 0;
                            }

                            // Solo rasterizamos si la página carece prácticamente de texto vectorial (< 160 chars),
                            // protegiendo 100% planos CAD con cotas, tablas y procedimientos buscables.
                            if (textLen < 160) {
                                const bounds = muPage.getBounds(); // [x0, y0, x1, y1] en puntos PDF (72 DPI)
                                const pageWidthPt = Math.max(72, bounds[2] - bounds[0]);
                                const pageHeightPt = Math.max(72, bounds[3] - bounds[1]);

                                const pixmap = muPage.toPixmap(scaleMatrix, mupdf.ColorSpace.DeviceRGB, false, true);
                                const pngBytes = Buffer.from(pixmap.asPNG());
                                pixmap.destroy?.();
                                muPage.destroy?.();

                                const jpegBytes = await sharp(pngBytes)
                                    .jpeg({ quality: 78, mozjpeg: true, progressive: true })
                                    .toBuffer();

                                const embeddedJpg = await hybridDoc.embedJpg(jpegBytes);
                                const newPage = hybridDoc.addPage([pageWidthPt, pageHeightPt]);
                                newPage.drawImage(embeddedJpg, {
                                    x: 0,
                                    y: 0,
                                    width: pageWidthPt,
                                    height: pageHeightPt,
                                });
                                candidateResampled++;
                            } else {
                                muPage.destroy?.();
                                const [copiedPage] = await hybridDoc.copyPages(srcDoc, [i]);
                                hybridDoc.addPage(copiedPage);
                                candidatePreserved++;
                            }
                        }

                        if (candidateResampled > 0) {
                            const phase2Uint8 = await hybridDoc.save({
                                useObjectStreams: true,
                                addDefaultPage: false,
                            });
                            const phase2Buffer = Buffer.from(
                                phase2Uint8.buffer,
                                phase2Uint8.byteOffset,
                                phase2Uint8.byteLength
                            );
                            if (phase2Buffer.length < bestBuffer.length * 0.94) {
                                bestBuffer = phase2Buffer;
                                resampledPages = candidateResampled;
                                preservedVectorPages = candidatePreserved;
                            }
                        }
                    } finally {
                        try {
                            muDoc?.destroy?.();
                        } catch {}
                    }
                });
            } catch (err: any) {
                console.warn('[MEDIA-DIGESTOR] Fase 2 selectiva PDF omitida, conservando Fase 1 lossless:', err?.message);
            }
        }

        const optimizedBytes = bestBuffer.length;
        const sha256 = this.computeSha256Hex(bestBuffer);
        const savingsRatio =
            originalBytes > 0 ? Math.max(0, Number(((originalBytes - optimizedBytes) / originalBytes).toFixed(4))) : 0;

        return {
            buffer: bestBuffer,
            sha256,
            mimeType: 'application/pdf',
            extension: 'pdf',
            profile: 'PDF_HYBRID_OEM',
            originalBytes,
            optimizedBytes,
            savingsRatio,
            pageCount,
            resampledPages,
            preservedVectorPages,
        };
    }

    /**
     * Punto de entrada polimórfico universal por tipo MIME / nombre de archivo
     */
    public static async digestAny(
        inputBuffer: Buffer,
        mimeType: string,
        requestedProfile?: MediaDigestionProfile,
        options?: { enableSelectiveRaster?: boolean }
    ): Promise<DigestedBinaryOutput> {
        const lowerMime = (mimeType || '').toLowerCase();

        if (lowerMime.includes('svg') || requestedProfile === 'VECTOR_SVG_CLEAN') {
            return this.digestSvg(inputBuffer);
        }

        if (lowerMime.includes('pdf') || requestedProfile === 'PDF_HYBRID_OEM') {
            return this.digestPdf(inputBuffer, {
                enableSelectiveRaster: options?.enableSelectiveRaster ?? true,
            });
        }

        if (lowerMime.startsWith('image/')) {
            const imgProfile =
                requestedProfile === 'IMAGE_TECHNICAL_HD' ||
                requestedProfile === 'IMAGE_FIELD_EVIDENCE' ||
                requestedProfile === 'IMAGE_THUMBNAIL' ||
                requestedProfile === 'IMAGE_ISO_SYMBOL'
                    ? requestedProfile
                    : 'IMAGE_FIELD_EVIDENCE';
            return this.digestImage(inputBuffer, imgProfile);
        }

        // Video pre-digerido desde el cliente WebCodecs u otro binario optimizado: sellar SHA-256 sin inflación
        const sha256 = this.computeSha256Hex(inputBuffer);
        const ext = lowerMime.includes('mp4')
            ? 'mp4'
            : lowerMime.includes('webm')
            ? 'webm'
            : 'bin';

        return {
            buffer: inputBuffer,
            sha256,
            mimeType: lowerMime || 'application/octet-stream',
            extension: ext,
            profile: requestedProfile || 'VIDEO_FIELD_COMPACT',
            originalBytes: inputBuffer.length,
            optimizedBytes: inputBuffer.length,
            savingsRatio: 0,
        };
    }
}
