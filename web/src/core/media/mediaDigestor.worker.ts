/// <reference lib="webworker" />
import { PDFDocument } from 'pdf-lib';

/**
 * MINREPORT MEDIA DIGESTOR WEB WORKER v4.0 (Capa 2 — Hilo Principal 100% Libre, INP < 100ms)
 *
 * Ejecuta fuera del hilo principal de UI:
 * - Hash criptográfico `SHA-256` vía WebCrypto.
 * - Hash perceptual `dHash` 64-bit + Redimensionado/Recorte Óptico + Codificación WebP vía `OffscreenCanvas`.
 * - Compresión estructural sin pérdida de PDF (`pdf-lib` Object Streams) + Purga de metadatos XMP/Autor.
 */

export interface WorkerDigestRequest {
    id: string;
    action: 'DIGEST_IMAGE' | 'DIGEST_PDF_PHASE1' | 'SHA256_ONLY';
    buffer: ArrayBuffer;
    mimeType?: string;
    maxDim?: number;
    quality?: number;
    autoTrimAlpha?: boolean;
}

export interface WorkerDigestResponse {
    id: string;
    ok: boolean;
    error?: string;
    buffer?: ArrayBuffer;
    sha256?: string;
    phashHex?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    pageCount?: number;
    originalBytes?: number;
    optimizedBytes?: number;
}

async function computeSha256Hex(buf: ArrayBuffer): Promise<string> {
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    const bytes = new Uint8Array(hashBuf);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}

function computeDHash64FromBitmap(bitmap: ImageBitmap): string | undefined {
    if (typeof OffscreenCanvas === 'undefined') return undefined;
    const canvas = new OffscreenCanvas(9, 8);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0, 9, 8);
    const data = ctx.getImageData(0, 0, 9, 8).data;

    const lum = new Float32Array(72);
    for (let i = 0; i < 72; i++) {
        const idx = i * 4;
        const alpha = data[idx + 3] / 255;
        const r = data[idx] * alpha + 255 * (1 - alpha);
        const g = data[idx + 1] * alpha + 255 * (1 - alpha);
        const b = data[idx + 2] * alpha + 255 * (1 - alpha);
        lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    let bits = 0n;
    for (let row = 0; row < 8; row++) {
        const offset = row * 9;
        for (let col = 0; col < 8; col++) {
            bits = (bits << 1n) | (lum[offset + col] > lum[offset + col + 1] ? 1n : 0n);
        }
    }
    return bits.toString(16).padStart(16, '0');
}

function findOpticalContentBounds(
    ctx: OffscreenCanvasRenderingContext2D,
    w: number,
    h: number
): { sx: number; sy: number; sw: number; sh: number } {
    const imgData = ctx.getImageData(0, 0, w, h).data;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const a = imgData[i + 3];
            const isNearWhite = imgData[i] > 245 && imgData[i + 1] > 245 && imgData[i + 2] > 245;
            if (a > 16 && !isNearWhite) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
                found = true;
            }
        }
    }

    if (!found || maxX <= minX || maxY <= minY) {
        return { sx: 0, sy: 0, sw: w, sh: h };
    }

    const pad = Math.max(6, Math.round(Math.max(maxX - minX, maxY - minY) * 0.04));
    const sx = Math.max(0, minX - pad);
    const sy = Math.max(0, minY - pad);
    const sw = Math.min(w - sx, maxX - minX + 1 + pad * 2);
    const sh = Math.min(h - sy, maxY - minY + 1 + pad * 2);
    return { sx, sy, sw, sh };
}

self.onmessage = async (ev: MessageEvent<WorkerDigestRequest>) => {
    const req = ev.data;
    try {
        if (req.action === 'SHA256_ONLY') {
            const sha256 = await computeSha256Hex(req.buffer);
            const resp: WorkerDigestResponse = { id: req.id, ok: true, sha256 };
            self.postMessage(resp);
            return;
        }

        if (req.action === 'DIGEST_IMAGE') {
            const originalBytes = req.buffer.byteLength;
            const blobIn = new Blob([req.buffer], { type: req.mimeType || 'image/jpeg' });
            const bitmap = await createImageBitmap(blobIn);

            const maxDim = req.maxDim || 1280;
            const quality = req.quality ?? 0.76;

            let sx = 0;
            let sy = 0;
            let sw = bitmap.width;
            let sh = bitmap.height;

            if (req.autoTrimAlpha && typeof OffscreenCanvas !== 'undefined') {
                const probe = new OffscreenCanvas(bitmap.width, bitmap.height);
                const pCtx = probe.getContext('2d', { willReadFrequently: true });
                if (pCtx) {
                    pCtx.drawImage(bitmap, 0, 0);
                    const bounds = findOpticalContentBounds(pCtx, bitmap.width, bitmap.height);
                    sx = bounds.sx;
                    sy = bounds.sy;
                    sw = bounds.sw;
                    sh = bounds.sh;
                }
            }

            let targetW = sw;
            let targetH = sh;
            if (targetW > maxDim || targetH > maxDim) {
                const ratio = Math.min(maxDim / targetW, maxDim / targetH);
                targetW = Math.max(1, Math.round(targetW * ratio));
                targetH = Math.max(1, Math.round(targetH * ratio));
            }

            const phashHex = computeDHash64FromBitmap(bitmap);

            const outCanvas = new OffscreenCanvas(targetW, targetH);
            const outCtx = outCanvas.getContext('2d');
            if (!outCtx) {
                bitmap.close();
                throw new Error('Contexto OffscreenCanvas 2D no disponible en Worker.');
            }
            outCtx.imageSmoothingEnabled = true;
            outCtx.imageSmoothingQuality = 'high';
            outCtx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, targetW, targetH);
            bitmap.close();

            let outBlob: Blob;
            let outMime = 'image/webp';
            try {
                outBlob = await outCanvas.convertToBlob({ type: 'image/webp', quality });
            } catch {
                outMime = 'image/jpeg';
                outBlob = await outCanvas.convertToBlob({ type: 'image/jpeg', quality });
            }

            const outBuf = await outBlob.arrayBuffer();
            const sha256 = await computeSha256Hex(outBuf);

            const resp: WorkerDigestResponse = {
                id: req.id,
                ok: true,
                buffer: outBuf,
                sha256,
                phashHex,
                mimeType: outMime,
                width: targetW,
                height: targetH,
                originalBytes,
                optimizedBytes: outBuf.byteLength,
            };
            (self as unknown as DedicatedWorkerGlobalScope).postMessage(resp, [outBuf]);
            return;
        }

        if (req.action === 'DIGEST_PDF_PHASE1') {
            const originalBytes = req.buffer.byteLength;
            const pdfDoc = await PDFDocument.load(req.buffer, {
                ignoreEncryption: true,
                updateMetadata: false,
            });
            pdfDoc.setAuthor('');
            pdfDoc.setCreator('MINREPORT MediaDigestor Edge v4.0');
            pdfDoc.setProducer('MINREPORT Industrial Core');
            pdfDoc.setSubject('');
            pdfDoc.setKeywords([]);

            const pageCount = pdfDoc.getPageCount();
            const savedBytes = await pdfDoc.save({
                useObjectStreams: true,
                addDefaultPage: false,
            });

            const useSaved = savedBytes.byteLength < originalBytes;
            const finalBuf: ArrayBuffer = useSaved
                ? (new Uint8Array(savedBytes).slice().buffer as ArrayBuffer)
                : req.buffer;
            const sha256 = await computeSha256Hex(finalBuf);

            const resp: WorkerDigestResponse = {
                id: req.id,
                ok: true,
                buffer: finalBuf,
                sha256,
                mimeType: 'application/pdf',
                pageCount,
                originalBytes,
                optimizedBytes: finalBuf.byteLength,
            };
            (self as unknown as DedicatedWorkerGlobalScope).postMessage(resp, [finalBuf]);
            return;
        }

        throw new Error(`Acción de Worker desconocida: ${(req as any).action}`);
    } catch (err: any) {
        const resp: WorkerDigestResponse = {
            id: req.id,
            ok: false,
            error: err?.message || 'Error en Worker de digestión multimedia.',
        };
        self.postMessage(resp);
    }
};
