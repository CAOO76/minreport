import { auth } from '../../config/firebase';
import type {
    CasStorageScope,
    DigestedMediaDescriptor,
    MediaDigestionProfile,
} from '../../contracts/media.contracts';
import { offlineStorage } from '../offline/OfflineStorage';
import type { WorkerDigestRequest, WorkerDigestResponse } from './mediaDigestor.worker';

/**
 * MINREPORT MEDIA DIGESTOR CLIENT v4.0 (Edge / PWA / Capacitor 6)
 *
 * Motor transversal único para toda la plataforma MINREPORT (`Core`, `OPERMAQ`, `STOCKPILE CONTROL`).
 * Cero scripts externos de CDN (100% empaquetado local conforme a Capa 1/2).
 *
 * Capacidades:
 * 1. Imágenes (`IMAGE_TECHNICAL_HD`, `IMAGE_FIELD_EVIDENCE`, `IMAGE_THUMBNAIL`, `IMAGE_ISO_SYMBOL`):
 *    Ejecución en Web Worker con `OffscreenCanvas` (INP < 100ms) + fallback seguro en DOM Canvas.
 * 2. PDFs (`PDF_HYBRID_OEM`):
 *    Fase 1 en Web Worker (`pdf-lib` Object Streams + purga XMP) + Fase 2 selectiva por página con `pdfjs-dist`
 *    (solo rasteriza páginas escaneadas sin texto liberando memoria GPU/Canvas en cada iteración).
 * 3. Videos (`VIDEO_FIELD_COMPACT`):
 *    Transcodificación local con `mediabunny` + `WebCodecs` a MP4 `720p @ 30fps` (~1.4 Mbps) + extracción
 *    automática de `posterBlob` y `keyframes[]` en WebP para inspección multimodal.
 * 4. SVG (`VECTOR_SVG_CLEAN`): Sanitización anti-XSS y minificación de precisión.
 * 5. Subida CAS con Preflight (`0 bytes` transmitidos si el `SHA-256` ya existe en el servidor).
 */

export interface ClientDigestedMedia {
    blob: Blob;
    dataUrl?: string;
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
    durationSec?: number;
    posterBlob?: Blob;
    keyframes?: Blob[];
}

const CLIENT_IMAGE_PROFILES: Record<
    'IMAGE_TECHNICAL_HD' | 'IMAGE_FIELD_EVIDENCE' | 'IMAGE_THUMBNAIL' | 'IMAGE_ISO_SYMBOL',
    { maxDim: number; quality: number; autoTrimAlpha?: boolean }
> = {
    IMAGE_TECHNICAL_HD: { maxDim: 2048, quality: 0.86 },
    IMAGE_FIELD_EVIDENCE: { maxDim: 1280, quality: 0.76 },
    IMAGE_THUMBNAIL: { maxDim: 420, quality: 0.62 },
    IMAGE_ISO_SYMBOL: { maxDim: 512, quality: 0.92, autoTrimAlpha: true },
};

class MinreportMediaDigestorEngine {
    private worker: Worker | null = null;
    private pendingCallbacks = new Map<
        string,
        { resolve: (res: WorkerDigestResponse) => void; reject: (err: Error) => void }
    >();

    private getWorker(): Worker | null {
        if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
        if (!this.worker) {
            try {
                this.worker = new Worker(new URL('./mediaDigestor.worker.ts', import.meta.url), {
                    type: 'module',
                });
                this.worker.onmessage = (ev: MessageEvent<WorkerDigestResponse>) => {
                    const msg = ev.data;
                    const cb = this.pendingCallbacks.get(msg.id);
                    if (!cb) return;
                    this.pendingCallbacks.delete(msg.id);
                    if (msg.ok) cb.resolve(msg);
                    else cb.reject(new Error(msg.error || 'Fallo en Worker de digestión'));
                };
                this.worker.onerror = () => {
                    // Si el entorno WebView restringe module workers, caer limpiamente a fallback local
                    this.worker = null;
                };
            } catch {
                this.worker = null;
            }
        }
        return this.worker;
    }

    private callWorker(
        payload: Omit<WorkerDigestRequest, 'id'>,
        transfer: Transferable[] = []
    ): Promise<WorkerDigestResponse> {
        const w = this.getWorker();
        if (!w) {
            return Promise.reject(new Error('Worker no disponible'));
        }
        const id = `mdw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return new Promise((resolve, reject) => {
            this.pendingCallbacks.set(id, { resolve, reject });
            w.postMessage({ ...payload, id }, transfer);
        });
    }

    public async computeSha256Hex(input: Blob | ArrayBuffer): Promise<string> {
        const buf = input instanceof Blob ? await input.arrayBuffer() : input;
        const digest = await crypto.subtle.digest('SHA-256', buf);
        const bytes = new Uint8Array(digest);
        let hex = '';
        for (let i = 0; i < bytes.length; i++) {
            hex += bytes[i].toString(16).padStart(2, '0');
        }
        return hex;
    }

    public blobToDataUrl(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('No se pudo convertir Blob a DataURL.'));
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Digestión de Imágenes (WebP sin EXIF + `pHash` + `SHA-256`)
     */
    public async digestImage(
        fileOrBlob: File | Blob,
        profile:
            | 'IMAGE_TECHNICAL_HD'
            | 'IMAGE_FIELD_EVIDENCE'
            | 'IMAGE_THUMBNAIL'
            | 'IMAGE_ISO_SYMBOL' = 'IMAGE_FIELD_EVIDENCE',
        includeDataUrl: boolean = false
    ): Promise<ClientDigestedMedia> {
        const spec = CLIENT_IMAGE_PROFILES[profile] || CLIENT_IMAGE_PROFILES.IMAGE_FIELD_EVIDENCE;
        const originalBytes = fileOrBlob.size;

        if (typeof OffscreenCanvas !== 'undefined') {
            try {
                const rawBuf = await fileOrBlob.arrayBuffer();
                const res = await this.callWorker(
                    {
                        action: 'DIGEST_IMAGE',
                        buffer: rawBuf,
                        mimeType: fileOrBlob.type || 'image/jpeg',
                        maxDim: spec.maxDim,
                        quality: spec.quality,
                        autoTrimAlpha: spec.autoTrimAlpha,
                    },
                    [rawBuf]
                );

                if (res.buffer && res.sha256) {
                    const mimeType = res.mimeType || 'image/webp';
                    const blob = new Blob([res.buffer], { type: mimeType });
                    const optimizedBytes = blob.size;
                    const savingsRatio =
                        originalBytes > 0
                            ? Math.max(0, Number(((originalBytes - optimizedBytes) / originalBytes).toFixed(4)))
                            : 0;
                    const dataUrl = includeDataUrl ? await this.blobToDataUrl(blob) : undefined;
                    return {
                        blob,
                        dataUrl,
                        sha256: res.sha256,
                        phashHex: res.phashHex,
                        mimeType,
                        extension: mimeType.includes('webp') ? 'webp' : 'jpg',
                        profile,
                        originalBytes,
                        optimizedBytes,
                        savingsRatio,
                        width: res.width,
                        height: res.height,
                    };
                }
            } catch {
                // Caer a HTMLCanvasElement en caso de WebView sin OffscreenCanvas en Worker
            }
        }

        return this.digestImageFallbackDom(fileOrBlob, profile, includeDataUrl);
    }

    private async digestImageFallbackDom(
        fileOrBlob: File | Blob,
        profile: 'IMAGE_TECHNICAL_HD' | 'IMAGE_FIELD_EVIDENCE' | 'IMAGE_THUMBNAIL' | 'IMAGE_ISO_SYMBOL',
        includeDataUrl: boolean
    ): Promise<ClientDigestedMedia> {
        const spec = CLIENT_IMAGE_PROFILES[profile] || CLIENT_IMAGE_PROFILES.IMAGE_FIELD_EVIDENCE;
        const originalBytes = fileOrBlob.size;
        const objUrl = URL.createObjectURL(fileOrBlob);

        try {
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error('Fallo decodificando imagen en cliente.'));
                el.src = objUrl;
            });

            let targetW = img.naturalWidth || img.width;
            let targetH = img.naturalHeight || img.height;
            if (targetW > spec.maxDim || targetH > spec.maxDim) {
                const ratio = Math.min(spec.maxDim / targetW, spec.maxDim / targetH);
                targetW = Math.max(1, Math.round(targetW * ratio));
                targetH = Math.max(1, Math.round(targetH * ratio));
            }

            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Contexto Canvas 2D no disponible.');

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, targetW, targetH);

            let mimeType = 'image/webp';
            let dataUrl = canvas.toDataURL(mimeType, spec.quality);
            if (!dataUrl.startsWith('data:image/webp')) {
                mimeType = 'image/jpeg';
                dataUrl = canvas.toDataURL(mimeType, spec.quality);
            }

            // Liberar memoria GPU de inmediato
            canvas.width = 0;
            canvas.height = 0;

            const byteStr = atob(dataUrl.split(',')[1]);
            const bytes = new Uint8Array(byteStr.length);
            for (let i = 0; i < byteStr.length; i++) {
                bytes[i] = byteStr.charCodeAt(i);
            }

            const blob = new Blob([bytes], { type: mimeType });
            const sha256 = await this.computeSha256Hex(bytes.buffer);
            const optimizedBytes = blob.size;
            const savingsRatio =
                originalBytes > 0
                    ? Math.max(0, Number(((originalBytes - optimizedBytes) / originalBytes).toFixed(4)))
                    : 0;

            return {
                blob,
                dataUrl: includeDataUrl ? dataUrl : undefined,
                sha256,
                mimeType,
                extension: mimeType.includes('webp') ? 'webp' : 'jpg',
                profile,
                originalBytes,
                optimizedBytes,
                savingsRatio,
                width: targetW,
                height: targetH,
            };
        } finally {
            URL.revokeObjectURL(objUrl);
        }
    }

    /**
     * Digestión de gráficos vectoriales `.svg` en cliente
     */
    public async digestSvg(svgInput: File | Blob | string): Promise<ClientDigestedMedia> {
        const raw = typeof svgInput === 'string' ? svgInput : await svgInput.text();
        const originalBytes = new Blob([raw]).size;
        let clean = raw
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
            .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(clean)) {
            clean = clean.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        }

        const blob = new Blob([clean], { type: 'image/svg+xml' });
        const sha256 = await this.computeSha256Hex(blob);
        const optimizedBytes = blob.size;
        const savingsRatio =
            originalBytes > 0
                ? Math.max(0, Number(((originalBytes - optimizedBytes) / originalBytes).toFixed(4)))
                : 0;

        return {
            blob,
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
     * Digestión Híbrida de PDFs en cliente (`PDF_HYBRID_OEM`):
     * 1. Fase 1 lossless en Web Worker (`pdf-lib` Object Streams + purga XMP).
     * 2. Fase 2 selectiva opcional (`pdfjs-dist` local) solo en documentos escaneados pesados (<= 120 págs en cliente;
     *    documentos masivos de 121-1500 págs delegan Fase 2 a `mupdf` WASM en servidor tras Fase 1).
     */
    public async digestPdf(
        fileOrBlob: File | Blob,
        options: { enableClientSelectiveRaster?: boolean } = {}
    ): Promise<ClientDigestedMedia> {
        const originalBytes = fileOrBlob.size;
        let currentBuf = await fileOrBlob.arrayBuffer();
        let pageCount: number | undefined;

        try {
            const copyForWorker = currentBuf.slice(0);
            const phase1 = await this.callWorker(
                {
                    action: 'DIGEST_PDF_PHASE1',
                    buffer: copyForWorker,
                },
                [copyForWorker]
            );
            if (phase1.buffer) {
                currentBuf = phase1.buffer;
                pageCount = phase1.pageCount;
            }
        } catch {
            // Si el worker no pudo reescribir, mantener buffer original para Fase 2 o servidor
        }

        const avgPageBytes = pageCount ? currentBuf.byteLength / Math.max(1, pageCount) : 0;
        const runPhase2 =
            options.enableClientSelectiveRaster === true &&
            pageCount !== undefined &&
            pageCount > 0 &&
            pageCount <= 80 &&
            currentBuf.byteLength > 1_500_000 &&
            avgPageBytes > 300_000;

        if (runPhase2) {
            try {
                const [{ PDFDocument }, pdfjsLib] = await Promise.all([
                    import('pdf-lib'),
                    import('pdfjs-dist'),
                ]);
                // Worker local empaquetado por Vite (0 KB de CDN externo)
                pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
                    'pdfjs-dist/build/pdf.worker.min.mjs',
                    import.meta.url
                ).toString();

                const srcPdfLib = await PDFDocument.load(currentBuf, { ignoreEncryption: true });
                const outPdfLib = await PDFDocument.create();
                const loadingTask = pdfjsLib.getDocument({ data: currentBuf.slice(0) });
                const pdfDoc = await loadingTask.promise;

                let resampledCount = 0;
                for (let p = 1; p <= pdfDoc.numPages; p++) {
                    const page = await pdfDoc.getPage(p);
                    const textContent = await page.getTextContent();
                    const charCount = textContent.items
                        .map((it: any) => String(it.str || ''))
                        .join('')
                        .trim().length;

                    if (charCount < 160) {
                        const viewport = page.getViewport({ scale: 160 / 72 });
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.round(viewport.width);
                        canvas.height = Math.round(viewport.height);
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
                            const jpgDataUrl = canvas.toDataURL('image/jpeg', 0.78);
                            canvas.width = 0;
                            canvas.height = 0;

                            const jpgBase64 = jpgDataUrl.split(',')[1];
                            const jpgBin = Uint8Array.from(atob(jpgBase64), (c) => c.charCodeAt(0));
                            const embedded = await outPdfLib.embedJpg(jpgBin);
                            const baseVp = page.getViewport({ scale: 1 });
                            const newPage = outPdfLib.addPage([baseVp.width, baseVp.height]);
                            newPage.drawImage(embedded, {
                                x: 0,
                                y: 0,
                                width: baseVp.width,
                                height: baseVp.height,
                            });
                            resampledCount++;
                        }
                    } else {
                        const [copied] = await outPdfLib.copyPages(srcPdfLib, [p - 1]);
                        outPdfLib.addPage(copied);
                    }
                    page.cleanup();
                }

                await (pdfDoc as unknown as { destroy?: () => Promise<void> }).destroy?.();
                if (resampledCount > 0) {
                    const outBytes = await outPdfLib.save({ useObjectStreams: true });
                    if (outBytes.byteLength < currentBuf.byteLength * 0.94) {
                        currentBuf = outBytes.buffer.slice(
                            outBytes.byteOffset,
                            outBytes.byteOffset + outBytes.byteLength
                        ) as ArrayBuffer;
                    }
                }
            } catch (err) {
                console.warn('[MEDIA-DIGESTOR-CLIENT] Fase 2 PDF selectiva delegada al servidor:', err);
            }
        }

        const blob = new Blob([currentBuf], { type: 'application/pdf' });
        const sha256 = await this.computeSha256Hex(currentBuf);
        const optimizedBytes = blob.size;
        const savingsRatio =
            originalBytes > 0
                ? Math.max(0, Number(((originalBytes - optimizedBytes) / originalBytes).toFixed(4)))
                : 0;

        return {
            blob,
            sha256,
            mimeType: 'application/pdf',
            extension: 'pdf',
            profile: 'PDF_HYBRID_OEM',
            originalBytes,
            optimizedBytes,
            savingsRatio,
            pageCount,
        };
    }

    /**
     * Digestión de Video en Terreno (`VIDEO_FIELD_COMPACT`) mediante `mediabunny` + `WebCodecs`:
     * Transcodifica clips 4K/1080p de inspección o cubicación hacia MP4 `720p @ 30fps` (~1.4 Mbps)
     * y extrae automáticamente `posterBlob` + `keyframes[]` en WebP.
     */
    public async digestVideo(
        fileOrBlob: File | Blob,
        options: { maxKeyframes?: number; onProgress?: (progress: number) => void } = {}
    ): Promise<ClientDigestedMedia> {
        const originalBytes = fileOrBlob.size;
        const maxKeyframes = options.maxKeyframes ?? 4;

        try {
            const mb = await import('mediabunny');
            const input = new mb.Input({
                source: new mb.BlobSource(fileOrBlob),
                formats: mb.ALL_FORMATS,
            });

            const durationSec = await input.computeDuration().catch(() => 0);
            const videoTrack = await input.getPrimaryVideoTrack();
            const keyframes: Blob[] = [];
            let posterBlob: Blob | undefined;

            if (videoTrack) {
                try {
                    const sink = new mb.CanvasSink(videoTrack, { width: 1280, fit: 'contain' });
                    const step = durationSec > 1 ? durationSec / Math.max(1, maxKeyframes) : 0.5;
                    const timestamps = Array.from({ length: maxKeyframes }, (_, idx) =>
                        Math.min(Math.max(0, durationSec - 0.1), idx * step)
                    );
                    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
                        if (!wrapped?.canvas) continue;
                        const c = wrapped.canvas;
                        let frameBlob: Blob | null = null;
                        if ('convertToBlob' in c && typeof c.convertToBlob === 'function') {
                            frameBlob = await c.convertToBlob({ type: 'image/webp', quality: 0.76 });
                        } else if ('toBlob' in c && typeof c.toBlob === 'function') {
                            frameBlob = await new Promise<Blob | null>((res) =>
                                (c as HTMLCanvasElement).toBlob(res, 'image/webp', 0.76)
                            );
                        }
                        if (frameBlob) {
                            if (!posterBlob) posterBlob = frameBlob;
                            keyframes.push(frameBlob);
                        }
                    }
                } catch {
                    // Continuar transcodificación aunque falle muestreo de keyframes
                }
            }

            const target = new mb.BufferTarget();
            const output = new mb.Output({
                format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
                target,
            });

            const conversion = await mb.Conversion.init({
                input,
                output,
                video: {
                    width: 1280,
                    height: 720,
                    fit: 'contain',
                    frameRate: 30,
                    bitrate: 1_400_000,
                },
                audio: {
                    bitrate: 96_000,
                },
                tags: {}, // Purga metadatos GPS/dispositivo del contenedor de video
                showWarnings: false,
            });

            if (options.onProgress) {
                conversion.onProgress = (p) => options.onProgress?.(p);
            }

            if (conversion.isValid) {
                await conversion.execute();
                const outBuffer = target.buffer;
                if (outBuffer && outBuffer.byteLength > 0 && outBuffer.byteLength < originalBytes) {
                    const outBlob = new Blob([outBuffer], { type: 'video/mp4' });
                    const sha256 = await this.computeSha256Hex(outBuffer);
                    const optimizedBytes = outBlob.size;
                    const savingsRatio = Math.max(
                        0,
                        Number(((originalBytes - optimizedBytes) / originalBytes).toFixed(4))
                    );
                    input.dispose();
                    return {
                        blob: outBlob,
                        sha256,
                        mimeType: 'video/mp4',
                        extension: 'mp4',
                        profile: 'VIDEO_FIELD_COMPACT',
                        originalBytes,
                        optimizedBytes,
                        savingsRatio,
                        durationSec,
                        posterBlob,
                        keyframes,
                    };
                }
            }
            input.dispose();
        } catch (err) {
            console.warn('[MEDIA-DIGESTOR-CLIENT] WebCodecs no disponible o clip ya compacto:', err);
        }

        const sha256 = await this.computeSha256Hex(fileOrBlob);
        return {
            blob: fileOrBlob,
            sha256,
            mimeType: fileOrBlob.type || 'video/mp4',
            extension: fileOrBlob.type.includes('webm') ? 'webm' : 'mp4',
            profile: 'VIDEO_FIELD_COMPACT',
            originalBytes,
            optimizedBytes: originalBytes,
            savingsRatio: 0,
        };
    }

    /**
     * Digestión polimórfica automática por archivo
     */
    public async digestFile(
        file: File | Blob,
        requestedProfile?: MediaDigestionProfile
    ): Promise<ClientDigestedMedia> {
        const mime = (file.type || '').toLowerCase();
        const name = file instanceof File ? file.name.toLowerCase() : '';

        if (mime.includes('svg') || name.endsWith('.svg') || requestedProfile === 'VECTOR_SVG_CLEAN') {
            return this.digestSvg(file);
        }
        if (mime.includes('pdf') || name.endsWith('.pdf') || requestedProfile === 'PDF_HYBRID_OEM') {
            return this.digestPdf(file);
        }
        if (mime.startsWith('video/') || requestedProfile === 'VIDEO_FIELD_COMPACT') {
            return this.digestVideo(file);
        }
        const imgProfile =
            requestedProfile === 'IMAGE_TECHNICAL_HD' ||
            requestedProfile === 'IMAGE_FIELD_EVIDENCE' ||
            requestedProfile === 'IMAGE_THUMBNAIL' ||
            requestedProfile === 'IMAGE_ISO_SYMBOL'
                ? requestedProfile
                : 'IMAGE_FIELD_EVIDENCE';
        return this.digestImage(file, imgProfile);
    }

    private resolveApiBase(): string {
        const rawBase: string =
            (import.meta as any).env?.VITE_OPERMAQ_API_URL ||
            (import.meta as any).env?.VITE_API_URL ||
            (typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? 'http://localhost:8080/api'
                : '/api');
        return rawBase.endsWith('/api') ? rawBase : `${rawBase.replace(/\/+$/, '')}/api`;
    }

    private async buildAuthHeaders(tenantId?: string): Promise<Record<string, string>> {
        const user = auth.currentUser;
        const fallbackToken =
            typeof window !== 'undefined'
                ? localStorage.getItem('dev_auth_token') || localStorage.getItem('dev_vault_token')
                : null;
        const idToken = user ? await user.getIdToken() : fallbackToken;
        const headers: Record<string, string> = {};
        if (idToken) headers.Authorization = `Bearer ${idToken}`;
        const activeTenant =
            tenantId ||
            (typeof window !== 'undefined' ? localStorage.getItem('minreport_active_account_id') : null);
        if (activeTenant) headers['X-Active-Account-Id'] = activeTenant;
        return headers;
    }

    /**
     * Pipeline completo Edge -> CAS:
     * 1. Digiere localmente.
     * 2. Si está offline, guarda el Blob optimizado en IndexedDB (`offline_cas_blobs`) por `sha256`.
     * 3. Si está online, consulta `GET /api/media/cas-preflight/:sha256` (0 bytes subidos si ya existe)
     *    y solo sube el binario optimizado si no existe.
     */
    public async digestAndUploadCas(
        file: File | Blob,
        options: {
            profile?: MediaDigestionProfile;
            scope?: CasStorageScope;
            tenantId?: string;
            filename?: string;
        } = {}
    ): Promise<{ descriptor: DigestedMediaDescriptor; digested: ClientDigestedMedia }> {
        const digested = await this.digestFile(file, options.profile);
        const scope = options.scope || 'TENANT_PRIVATE';
        const filename =
            options.filename ||
            (file instanceof File ? file.name : `asset_${digested.sha256.slice(0, 10)}.${digested.extension}`);

        // Guardar en caché CAS local IndexedDB para disponibilidad inmediata en terreno sin red
        await offlineStorage
            .putCasBlob({
                sha256: digested.sha256,
                blob: digested.blob,
                mimeType: digested.mimeType,
                profile: digested.profile,
                scope,
                filename,
                originalBytes: digested.originalBytes,
                optimizedBytes: digested.optimizedBytes,
                updatedAt: Date.now(),
            })
            .catch(() => {});

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            const localUrl = URL.createObjectURL(digested.blob);
            return {
                digested,
                descriptor: {
                    sha256: digested.sha256,
                    phashHex: digested.phashHex,
                    scope,
                    tenantId: options.tenantId,
                    profile: digested.profile,
                    mimeType: digested.mimeType,
                    extension: digested.extension,
                    originalFilename: filename,
                    originalBytes: digested.originalBytes,
                    optimizedBytes: digested.optimizedBytes,
                    savingsRatio: digested.savingsRatio,
                    width: digested.width,
                    height: digested.height,
                    pageCount: digested.pageCount,
                    durationSec: digested.durationSec,
                    storagePath: `offline_cas/${digested.sha256}.${digested.extension}`,
                    downloadUrl: localUrl,
                    deduplicatedHit: false,
                    createdAt: new Date().toISOString(),
                },
            };
        }

        const apiBase = this.resolveApiBase();
        const headers = await this.buildAuthHeaders(options.tenantId);

        // Preflight O(1): Si el SHA-256 ya fue subido antes, ahorra 100% de subida
        try {
            const preRes = await fetch(
                `${apiBase}/media/cas-preflight/${digested.sha256}?scope=${encodeURIComponent(scope)}`,
                { headers }
            );
            if (preRes.ok) {
                const preJson = await preRes.json();
                if (preJson?.exists && preJson?.descriptor) {
                    return { descriptor: preJson.descriptor as DigestedMediaDescriptor, digested };
                }
            }
        } catch {
            // Continuar hacia subida multipart
        }

        const form = new FormData();
        form.append('file', digested.blob, filename);
        form.append('profile', digested.profile);
        form.append('scope', scope);

        const uploadRes = await fetch(`${apiBase}/media/digest-upload`, {
            method: 'POST',
            headers,
            body: form,
        });

        if (!uploadRes.ok) {
            const errBody = await uploadRes.json().catch(() => ({}));
            throw new Error(errBody?.error || `Error HTTP ${uploadRes.status} al registrar activo CAS.`);
        }

        const uploadJson = await uploadRes.json();
        return {
            descriptor: uploadJson.descriptor as DigestedMediaDescriptor,
            digested,
        };
    }
}

export const mediaDigestorClient = new MinreportMediaDigestorEngine();
