import { createHash, randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { db } from '../../../config/firebase';
import { importEsm } from '../../../core/esm-loader';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { withMupdfSemaphore } from '../../../core/media/MediaDigestorServer';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { ResilientAIClient } from '../../../core/resilient-ai-client';
import {
    type ExtractedFigureRef,
    type FigureCallout,
    type PillarId,
    type QuarantineProposedPillarDelta,
    VALID_PILLAR_IDS,
} from '../types/vault.types';
import { buildAndPersistAssetSymbologyPack } from './EquipmentSymbologyPackBuilder';
import { computeFactFingerprint, verifyAndNormalizeTechnicalUnits } from './NeuroSymbolicVerifier';
import { vectorizeRasterSymbolToSvg } from './UniversalSymbologySeedService';
import {
    type StructuredDeltaInput,
    VaultReconciliationService,
} from './VaultReconciliationService';

/**
 * SEGMENTED DOCUMENT PROCESSOR SERVICE v4.0 — Motor de Ingesta de PDFs Extensos, Catálogos, ETT y Láminas OEM
 *
 * Capacidades de Última Generación:
 * 1. Digestión Universal Previa (`MinreportMediaDigestor` + `CAS SHA-256`):
 *    - Solo se almacena el binario optimizado una única vez en `cas_blobs/global_oem/` (o `tenants/`).
 *    - Si el mismo manual/catálogo ya fue procesado (`vault_files/{sha256}.status === 'COMPLETED'`),
 *      retorna en milisegundos con `$0` costo IA y `0` duplicados.
 * 2. Deduplicación Incremental por Página (`FastCDC` Page Fingerprinting):
 *    - Ante una nueva revisión de un manual extenso (ej. 800 páginas con 12 páginas modificadas),
 *      calcula la huella de cada página con `mupdf` WASM y salta el 100% de las páginas ya ingeridas.
 * 3. Reparto Especializado hacia los **5 Pilares Completos**:
 *    - `ficha_tecnica`, `manual_operaciones`, `pauta_mantencion`, `matriz_riesgos`, `checklist_pre_op`.
 * 4. Cosecha Espacial Autónoma de Figuras (`mupdf` 250 DPI + `box_2d` `[ymin,xmin,ymax,xmax]` + `sharp`):
 *    - Recorta diagramas acotados, curvas de carga, mapas de lubricación y esquemas con sus `callouts` (`1..N`),
 *      convirtiéndolos a WebP técnico en CAS y anclándolos directamente a cada capítulo.
 * 5. Vectorización WASM de Simbología OEM (`@visioncortex/vtracer`):
 *    - Convierte pictogramas propietarios de láminas PDF en `.svg` puro dentro de `master_symbology_vault`.
 */

export interface IngestDocumentInput {
    globalAssetId: string;
    fileBuffer: Buffer;
    mimeType: string;
    originalFilename: string;
    clientOriginalBytes?: number;
    documentCategory?: 'OEM_MANUAL' | 'CATALOG_BROCHURE' | 'ETT_SPEC_SHEET' | 'TECHNICAL_CHART_PHOTO';
    visibilityScope?: 'COMMONS_OEM' | 'TENANT_ONLY';
    tenantId?: string;
    actorUid: string;
    actorEmail: string;
    isPrivilegedCurator?: boolean;
    maxWindowsPerRun?: number;
}

export interface PillarDistributionSummary {
    ficha_tecnica: number;
    manual_operaciones: number;
    pauta_mantencion: number;
    matriz_riesgos: number;
    checklist_pre_op: number;
}

export interface IngestDocumentResult {
    jobId: string;
    fileSha256: string;
    storageUrl: string;
    deduplicatedDocumentHit: boolean;
    originalBytes: number;
    optimizedBytes: number;
    savingsRatio: number;
    totalPages: number;
    skippedUnchangedPages: number;
    processedPages: number;
    remainingDeferredPages: number;
    extractedChaptersCount: number;
    extractedFiguresCount: number;
    vectorizedSymbolsCount: number;
    skippedDuplicateFacts: number;
    lockedAdvisoriesCount: number;
    pillarDistribution: PillarDistributionSummary;
}

interface PageInspectionEntry {
    pageNumber: number; // 1-based
    fingerprint: string;
    text: string;
    isScanOrDiagramHeavy: boolean;
}

interface ExtractedWindowChapter {
    pillar_id: PillarId;
    chapter_title: string;
    section?: string;
    priority?: 'CRÍTICO' | 'IMPORTANTE' | 'COMPLEMENTARIO';
    markdown_es: string;
    structured_deltas?: StructuredDeltaInput[];
    iso_symbols?: string[];
    figure_refs_indices?: number[];
}

interface WindowFigureCropSpec {
    window_page_index: number; // 1-based inside window
    figure_type: ExtractedFigureRef['figure_type'];
    title_es: string;
    caption_es?: string;
    box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0..1000
    callouts?: FigureCallout[];
}

interface WindowOemSymbolCropSpec {
    window_page_index: number;
    box_2d: [number, number, number, number];
    concept_slug: string;
    technical_name_es: string;
    action_operator_es: string;
    critical_color?: 'RED' | 'AMBER' | 'GREEN' | 'BLUE' | 'NONE';
}

function emptyPillarDistribution(): PillarDistributionSummary {
    return {
        ficha_tecnica: 0,
        manual_operaciones: 0,
        pauta_mantencion: 0,
        matriz_riesgos: 0,
        checklist_pre_op: 0,
    };
}

function computePageFastCdcFingerprint(pageText: string, visualDigestHex?: string): string {
    const normalized = (pageText || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    const payload = normalized.length >= 60 ? `txt:${normalized}` : `vis:${visualDigestHex || normalized}`;
    return createHash('sha256').update(payload).digest('hex').slice(0, 28);
}

/**
 * Renderiza una página específica (0-based) de un buffer PDF a PNG usando `mupdf` WASM
 * liberando determinísticamente la memoria lineal WASM al finalizar.
 */
export async function renderPdfPageToPng(
    pdfBuffer: Buffer,
    zeroBasedPageIndex: number,
    dpi: number = 240
): Promise<{ pngBuffer: Buffer; width: number; height: number } | null> {
    return withMupdfSemaphore(async () => {
        const mupdf = await importEsm<any>('mupdf');
        let doc: any = null;
        let page: any = null;
        let pixmap: any = null;

        try {
            doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
            const count = doc.countPages();
            if (zeroBasedPageIndex < 0 || zeroBasedPageIndex >= count) return null;

            page = doc.loadPage(zeroBasedPageIndex);
            const scale = dpi / 72;
            const matrix = mupdf.Matrix.scale(scale, scale);
            pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
            const width = pixmap.getWidth();
            const height = pixmap.getHeight();
            const pngUint8: Uint8Array = pixmap.asPNG();
            return {
                pngBuffer: Buffer.from(pngUint8),
                width,
                height,
            };
        } catch {
            return null;
        } finally {
            try {
                pixmap?.destroy?.();
            } catch {}
            try {
                page?.destroy?.();
            } catch {}
            try {
                doc?.destroy?.();
            } catch {}
        }
    });
}

/**
 * Recorta una región normalizada `box_2d` `[ymin, xmin, ymax, xmax]` (`0..1000`) desde una imagen de página
 * con margen óptico de seguridad del 1.5% para no amputar cotas ni números de callout.
 */
export async function cropBox2dFromImage(
    pageImageBuffer: Buffer,
    pageWidth: number,
    pageHeight: number,
    box2d: [number, number, number, number]
): Promise<Buffer | null> {
    const [rawYmin, rawXmin, rawYmax, rawXmax] = box2d;
    const ymin = Math.max(0, Math.min(1000, Number(rawYmin) || 0));
    const xmin = Math.max(0, Math.min(1000, Number(rawXmin) || 0));
    const ymax = Math.max(0, Math.min(1000, Number(rawYmax) || 1000));
    const xmax = Math.max(0, Math.min(1000, Number(rawXmax) || 1000));

    if (ymax - ymin < 35 || xmax - xmin < 35) return null;

    const padX = Math.round(pageWidth * 0.015);
    const padY = Math.round(pageHeight * 0.015);

    const left = Math.max(0, Math.floor((xmin / 1000) * pageWidth) - padX);
    const top = Math.max(0, Math.floor((ymin / 1000) * pageHeight) - padY);
    const right = Math.min(pageWidth, Math.ceil((xmax / 1000) * pageWidth) + padX);
    const bottom = Math.min(pageHeight, Math.ceil((ymax / 1000) * pageHeight) + padY);

    const cropW = right - left;
    const cropH = bottom - top;
    if (cropW < 80 || cropH < 80) return null;

    return sharp(pageImageBuffer)
        .extract({ left, top, width: cropW, height: cropH })
        .toBuffer();
}

/**
 * Extrae el texto plano por página (`mupdf` WASM) de un PDF, acotado a `maxPages`,
 * para localizar las páginas pertinentes a un capítulo antes de renderizar/recortar figuras.
 */
export async function extractPdfPageTexts(
    pdfBuffer: Buffer,
    maxPages: number = 60
): Promise<Array<{ pageIndex: number; text: string }>> {
    return withMupdfSemaphore(async () => {
        const mupdf = await importEsm<any>('mupdf');
        let doc: any = null;
        const out: Array<{ pageIndex: number; text: string }> = [];
        try {
            doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
            const count = Math.min(doc.countPages(), maxPages);
            for (let i = 0; i < count; i++) {
                let page: any = null;
                let sText: any = null;
                try {
                    page = doc.loadPage(i);
                    sText = page.toStructuredText('preserve-whitespace');
                    out.push({ pageIndex: i, text: String(sText.asText() || '') });
                } catch {
                    out.push({ pageIndex: i, text: '' });
                } finally {
                    try {
                        sText?.destroy?.();
                    } catch {}
                    try {
                        page?.destroy?.();
                    } catch {}
                }
            }
        } catch {
            return out;
        } finally {
            try {
                doc?.destroy?.();
            } catch {}
        }
        return out;
    });
}

export class SegmentedDocumentProcessorService {
    /**
     * Consulta semántica local (`768d`) sobre los fragmentos ya ingeridos de manuales/ETT del activo
     * para fundamentar cazas y consultas antes de salir a internet.
     */
    public static async searchLocalAssetCorpus(
        globalAssetId: string,
        queryText: string,
        topK: number = 5
    ): Promise<
        Array<{
            chunkId: string;
            title: string;
            markdown: string;
            sourceFilename: string;
            pages: number[];
            score: number;
            figures: ExtractedFigureRef[];
        }>
    > {
        const chunksCol = db
            .collection('global_asset_catalog')
            .doc(globalAssetId)
            .collection('vault_corpus_chunks');

        let queryVec: number[] | null = null;
        try {
            queryVec = await ResilientAIClient.embedText(queryText, {
                taskType: 'RETRIEVAL_QUERY',
            });
        } catch {
            queryVec = null;
        }

        let candidateDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        let usedVectorIndex = false;

        if (queryVec && queryVec.length > 0 && typeof (chunksCol as any).findNearest === 'function') {
            try {
                const vectorQuery = (chunksCol as any).findNearest(
                    'embedding_768',
                    FieldValue.vector(queryVec),
                    {
                        limit: Math.max(topK * 3, 15),
                        distanceMeasure: 'COSINE',
                        distanceResultField: 'vector_distance',
                    }
                );
                const vecSnap = await vectorQuery.get();
                if (vecSnap && Array.isArray(vecSnap.docs) && vecSnap.docs.length > 0) {
                    candidateDocs = vecSnap.docs;
                    usedVectorIndex = true;
                }
            } catch {
                // Fallback seguro cuando el emulador local o la subcolección no dispone aún de índice vectorial
                usedVectorIndex = false;
            }
        }

        if (!usedVectorIndex) {
            const fallbackSnap = await chunksCol.limit(80).get();
            candidateDocs = fallbackSnap.docs;
        }

        if (candidateDocs.length === 0) return [];

        const queryTerms = queryText
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .split(/[^a-z0-9]+/)
            .filter((t) => t.length > 2);

        const scored = candidateDocs.map((doc) => {
            const d = doc.data();
            const textLower = `${d.chapter_title || ''} ${d.markdown_es || ''}`
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');

            let lexicalHits = 0;
            for (const term of queryTerms) {
                if (textLower.includes(term)) lexicalHits++;
            }
            const lexicalScore = queryTerms.length > 0 ? lexicalHits / queryTerms.length : 0;

            let vectorScore = 0;
            if (typeof d.vector_distance === 'number' && Number.isFinite(d.vector_distance)) {
                vectorScore = Math.max(0, Math.min(1, 1 - d.vector_distance));
            } else {
                const rawEmb = d.embedding_768?.toArray ? d.embedding_768.toArray() : d.embedding_768;
                if (queryVec && Array.isArray(rawEmb) && rawEmb.length === queryVec.length) {
                    vectorScore = Math.max(0, ResilientAIClient.cosineSimilarity(queryVec, rawEmb));
                }
            }

            const combinedScore = queryVec ? vectorScore * 0.72 + lexicalScore * 0.28 : lexicalScore;
            return {
                chunkId: doc.id,
                title: String(d.chapter_title || 'Fragmento OEM'),
                markdown: String(d.markdown_es || ''),
                sourceFilename: String(d.source_filename || 'Manual OEM'),
                pages: Array.isArray(d.source_pages) ? d.source_pages : [],
                score: combinedScore,
                figures: Array.isArray(d.figures) ? (d.figures as ExtractedFigureRef[]) : [],
            };
        });

        return scored
            .filter((c) => c.score >= 0.28)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }

    /**
     * Ingiere un PDF extenso, catálogo, ETT o fotografía/lámina técnica optimizándolo primero con
     * `MinreportMediaDigestor`, extrayendo texto + figuras recortadas + símbolos vectorizados y
     * distribuyendo la información sin duplicados entre los 5 pilares.
     */
    public static async ingestDocument(input: IngestDocumentInput): Promise<IngestDocumentResult> {
        const assetRef = db.collection('global_asset_catalog').doc(input.globalAssetId);
        const assetSnap = await assetRef.get();
        if (!assetSnap.exists) {
            const err: any = new Error(`Activo ${input.globalAssetId} no existe en global_asset_catalog.`);
            err.statusCode = 404;
            throw err;
        }

        const assetData = assetSnap.data()!;
        if (
            input.visibilityScope !== 'TENANT_ONLY' &&
            (assetData.isSealed === true ||
                assetData.is_sealed === true ||
                assetData.knowledge_vault?.is_sealed === true)
        ) {
            const err: any = new Error('La bóveda maestra está sellada (HTTP 403).');
            err.statusCode = 403;
            throw err;
        }

        const make = String(assetData.make_oficial || assetData.make || 'OEM');
        const model = String(assetData.model_oficial || assetData.model || input.globalAssetId);
        const makeModel = assetData.make_model || `${make} ${model}`.trim();

        const isPdf =
            input.mimeType === 'application/pdf' ||
            input.originalFilename.toLowerCase().endsWith('.pdf');
        const isImage = input.mimeType.startsWith('image/');
        const casScope = input.visibilityScope === 'TENANT_ONLY' ? 'TENANT_PRIVATE' : 'GLOBAL_OEM';

        // 1. Si es imagen aportada por cliente hacia COMMONS, aplicar esclusa óptica Zero-Trust (caras/patentes/logos)
        let workingBuffer = input.fileBuffer;
        if (isImage && casScope === 'GLOBAL_OEM' && !input.isPrivilegedCurator) {
            const sanitizedImg = await ConfidentialityAirlockService.sanitizeImageForCommons(
                workingBuffer,
                input.tenantId
            );
            workingBuffer = sanitizedImg.cleanBuffer;
        }

        // 2. Digerir y almacenar binario optimizado en CAS (`PDF_HYBRID_OEM` o `IMAGE_TECHNICAL_HD`)
        const profile = isPdf ? 'PDF_HYBRID_OEM' : 'IMAGE_TECHNICAL_HD';
        const { descriptor, digested } = await CasStorageService.digestAndStore(
            workingBuffer,
            isPdf ? 'application/pdf' : input.mimeType,
            profile,
            {
                scope: casScope,
                tenantId: input.tenantId,
                actorUid: input.actorUid,
                originalFilename: input.originalFilename,
                clientOriginalBytes: input.clientOriginalBytes,
                enableSelectiveRaster: true,
            }
        );

        const vaultFilesCol = assetRef.collection('vault_files');
        const existingFileSnap = await vaultFilesCol.doc(descriptor.sha256).get();
        if (
            existingFileSnap.exists &&
            existingFileSnap.data()?.status === 'COMPLETED' &&
            Number(existingFileSnap.data()?.remainingDeferredPages || 0) === 0
        ) {
            const prev = existingFileSnap.data()!;
            return {
                jobId: prev.lastJobId || `dedup_${descriptor.sha256.slice(0, 10)}`,
                fileSha256: descriptor.sha256,
                storageUrl: descriptor.downloadUrl,
                deduplicatedDocumentHit: true,
                originalBytes: descriptor.originalBytes,
                optimizedBytes: descriptor.optimizedBytes,
                savingsRatio: descriptor.savingsRatio,
                totalPages: Number(prev.totalPages || descriptor.pageCount || 1),
                skippedUnchangedPages: Number(prev.totalPages || descriptor.pageCount || 1),
                processedPages: 0,
                remainingDeferredPages: 0,
                extractedChaptersCount: 0,
                extractedFiguresCount: 0,
                vectorizedSymbolsCount: 0,
                skippedDuplicateFacts: Number(prev.extractedChaptersCount || 0),
                lockedAdvisoriesCount: 0,
                pillarDistribution: prev.pillarDistribution || emptyPillarDistribution(),
            };
        }

        const jobId = `ing_${Date.now()}_${randomUUID().slice(0, 8)}`;
        const jobsCol = assetRef.collection('ingestion_jobs');
        const nowIso = new Date().toISOString();

        await jobsCol.doc(jobId).set({
            jobId,
            globalAssetId: input.globalAssetId,
            fileSha256: descriptor.sha256,
            originalFilename: input.originalFilename,
            documentCategory: input.documentCategory || (isPdf ? 'OEM_MANUAL' : 'TECHNICAL_CHART_PHOTO'),
            visibilityScope: input.visibilityScope || 'COMMONS_OEM',
            status: 'PROCESSING',
            originalBytes: descriptor.originalBytes,
            optimizedBytes: descriptor.optimizedBytes,
            savingsRatio: descriptor.savingsRatio,
            actorUid: input.actorUid,
            actorEmail: input.actorEmail,
            startedAt: nowIso,
        });

        const pillarDistribution = emptyPillarDistribution();
        let extractedChaptersCount = 0;
        let extractedFiguresCount = 0;
        let vectorizedSymbolsCount = 0;
        let skippedDuplicateFacts = 0;
        let lockedAdvisoriesCount = 0;
        let totalPages = 1;
        let skippedUnchangedPages = 0;
        let processedPages = 0;
        let remainingDeferredPages = 0;

        try {
            if (isImage) {
                // ── RUTA A: LÁMINA TÉCNICA / PLACA / GRÁFICO / FOTO INDIVIDUAL ──
                const baseFigure: ExtractedFigureRef = {
                    figure_id: `fig_${descriptor.sha256.slice(0, 12)}`,
                    sha256: descriptor.sha256,
                    phash_hex: descriptor.phashHex,
                    storage_url: descriptor.downloadUrl,
                    mime_type: 'image/webp',
                    figure_type: 'DIAGRAMA_ACOTADO',
                    title_es: input.originalFilename.replace(/\.[^.]+$/, ''),
                    width: descriptor.width,
                    height: descriptor.height,
                    original_bytes: descriptor.originalBytes,
                    optimized_bytes: descriptor.optimizedBytes,
                    savings_pct:
                        descriptor.savingsPct ??
                        Number((Number(descriptor.savingsRatio || 0) * 100).toFixed(1)),
                };

                const extracted = await this.analyzeVisualSheetWithSwarm(
                    makeModel,
                    digested.buffer,
                    input.originalFilename
                );

                baseFigure.figure_type = extracted.figureType || 'FOTO_COMPONENTE';
                baseFigure.title_es = extracted.figureTitle || baseFigure.title_es;
                baseFigure.caption_es = extracted.figureCaption;
                baseFigure.callouts = extracted.callouts;
                extractedFiguresCount = 1;

                for (const ch of extracted.chapters) {
                    const scrubbed = ConfidentialityAirlockService.scrubDeterministicPii(ch.markdown_es).scrubbed;

                    if (input.visibilityScope !== 'TENANT_ONLY' && input.isPrivilegedCurator) {
                        await this.persistCorpusChunk(assetRef, {
                            fileSha256: descriptor.sha256,
                            sourceFilename: input.originalFilename,
                            sourcePages: [1],
                            pageFingerprints: [descriptor.sha256.slice(0, 28)],
                            pillarId: ch.pillar_id,
                            chapterTitle: ch.chapter_title,
                            markdownEs: scrubbed,
                            figures: [baseFigure],
                        });
                        const rec = await VaultReconciliationService.reconcileContribution({
                            globalAssetId: input.globalAssetId,
                            pillarId: ch.pillar_id,
                            chapterTitle: ch.chapter_title,
                            section: ch.section,
                            priority: ch.priority,
                            markdownContent: scrubbed,
                            structuredDeltas: ch.structured_deltas,
                            figures: [baseFigure],
                            symbologyCandidates: ch.iso_symbols,
                            sourceLabel: `${input.originalFilename} (Lámina CAS)`,
                            sourceUrl: descriptor.downloadUrl,
                            isOemSource: input.documentCategory !== 'TECHNICAL_CHART_PHOTO',
                            actorEmail: input.actorEmail,
                        });
                        pillarDistribution[ch.pillar_id]++;
                        extractedChaptersCount++;
                        skippedDuplicateFacts += rec.skippedDuplicates;
                        lockedAdvisoriesCount += rec.addedAdvisories;
                    }
                }
                processedPages = 1;
            } else if (isPdf) {
                // ── RUTA B: PROCESADOR SEGMENTADO DE PDF EXTENSO (`mupdf` + `FastCDC` + `pdf-lib`) ──
                const pagesInfo = await this.inspectPdfPagesWithMupdf(digested.buffer);
                totalPages = pagesInfo.length;

                // Consultar huellas de páginas ya ingeridas previamente para este equipo
                const existingChunksSnap = await assetRef
                    .collection('vault_corpus_chunks')
                    .select('page_fingerprints')
                    .get();
                const knownPageFingerprints = new Set<string>();
                for (const doc of existingChunksSnap.docs) {
                    const fps = doc.data()?.page_fingerprints;
                    if (Array.isArray(fps)) {
                        for (const fp of fps) knownPageFingerprints.add(String(fp));
                    }
                }

                const deltaPages: PageInspectionEntry[] = [];
                for (const p of pagesInfo) {
                    if (knownPageFingerprints.has(p.fingerprint)) {
                        skippedUnchangedPages++;
                    } else {
                        deltaPages.push(p);
                    }
                }

                // Agrupar páginas delta en ventanas coherentes de hasta 14 páginas
                const PAGES_PER_WINDOW = 14;
                const maxWindows = input.maxWindowsPerRun ?? 16;
                const allWindows: PageInspectionEntry[][] = [];
                for (let i = 0; i < deltaPages.length; i += PAGES_PER_WINDOW) {
                    allWindows.push(deltaPages.slice(i, i + PAGES_PER_WINDOW));
                }

                const activeWindows = allWindows.slice(0, maxWindows);
                const deferredWindows = allWindows.slice(maxWindows);
                remainingDeferredPages = deferredWindows.reduce((acc, w) => acc + w.length, 0);

                const masterPdfDoc = await PDFDocument.load(digested.buffer, { ignoreEncryption: true });

                for (const windowPages of activeWindows) {
                    processedPages += windowPages.length;

                    // Cortar sub-PDF ligero solo con las páginas de esta ventana
                    const subPdf = await PDFDocument.create();
                    const zeroBasedIndices = windowPages.map((p) => p.pageNumber - 1);
                    const copied = await subPdf.copyPages(masterPdfDoc, zeroBasedIndices);
                    for (const cp of copied) subPdf.addPage(cp);
                    const windowPdfBytes = Buffer.from(
                        await subPdf.save({ useObjectStreams: true })
                    );

                    const windowResult = await this.extractWindowKnowledgeAndBoxes({
                        makeModel,
                        originalFilename: input.originalFilename,
                        windowPdfBuffer: windowPdfBytes,
                        windowPages,
                    });

                    // 1. Recortar figuras técnicas detectadas (`box_2d` -> `mupdf` 240 DPI -> `sharp` -> CAS WebP)
                    const croppedFiguresByIndex = new Map<number, ExtractedFigureRef>();
                    const pageRenderCache = new Map<number, { pngBuffer: Buffer; width: number; height: number }>();

                    for (let fIdx = 0; fIdx < windowResult.figuresToCrop.length; fIdx++) {
                        const figSpec = windowResult.figuresToCrop[fIdx];
                        const localIdx = Math.max(
                            0,
                            Math.min(windowPages.length - 1, (Number(figSpec.window_page_index) || 1) - 1)
                        );
                        const originalPageNumber = windowPages[localIdx].pageNumber;

                        let rendered = pageRenderCache.get(originalPageNumber);
                        if (!rendered) {
                            const r = await renderPdfPageToPng(digested.buffer, originalPageNumber - 1, 240);
                            if (r) {
                                rendered = r;
                                pageRenderCache.set(originalPageNumber, r);
                            }
                        }
                        if (!rendered) continue;

                        const croppedBuf = await cropBox2dFromImage(
                            rendered.pngBuffer,
                            rendered.width,
                            rendered.height,
                            figSpec.box_2d
                        );
                        if (!croppedBuf) continue;

                        const { descriptor: figDesc } = await CasStorageService.digestAndStore(
                            croppedBuf,
                            'image/png',
                            'IMAGE_TECHNICAL_HD',
                            {
                                scope: casScope,
                                tenantId: input.tenantId,
                                actorUid: input.actorUid,
                                originalFilename: `${input.originalFilename}_p${originalPageNumber}_fig${fIdx + 1}.webp`,
                            }
                        );

                        croppedFiguresByIndex.set(fIdx, {
                            figure_id: `fig_p${originalPageNumber}_${figDesc.sha256.slice(0, 10)}`,
                            sha256: figDesc.sha256,
                            phash_hex: figDesc.phashHex,
                            storage_url: figDesc.downloadUrl,
                            mime_type: 'image/webp',
                            figure_type: figSpec.figure_type || 'DIAGRAMA_ACOTADO',
                            title_es: figSpec.title_es || `Figura Pág. ${originalPageNumber}`,
                            caption_es: figSpec.caption_es,
                            source_page: originalPageNumber,
                            source_doc_hash: descriptor.sha256,
                            source_url: descriptor.downloadUrl,
                            box_2d: figSpec.box_2d,
                            width: figDesc.width,
                            height: figDesc.height,
                            original_bytes: figDesc.originalBytes,
                            optimized_bytes: figDesc.optimizedBytes,
                            savings_pct:
                                figDesc.savingsPct ??
                                Number((Number(figDesc.savingsRatio || 0) * 100).toFixed(1)),
                            callouts: Array.isArray(figSpec.callouts) ? figSpec.callouts : undefined,
                        });
                        extractedFiguresCount++;
                    }

                    // 2. Vectorizar símbolos OEM propietarios detectados en la ventana (`vtracer` WASM -> `.svg`)
                    // Solo curadores privilegiados escriben directo en `master_symbology_vault`
                    const newlyVectorizedConceptIds: string[] = [];
                    const canMutateMasterCatalog =
                        input.visibilityScope !== 'TENANT_ONLY' && Boolean(input.isPrivilegedCurator);
                    for (const symSpec of canMutateMasterCatalog ? windowResult.oemSymbolsToVectorize.slice(0, 6) : []) {
                        const localIdx = Math.max(
                            0,
                            Math.min(windowPages.length - 1, (Number(symSpec.window_page_index) || 1) - 1)
                        );
                        const originalPageNumber = windowPages[localIdx].pageNumber;

                        let rendered = pageRenderCache.get(originalPageNumber);
                        if (!rendered) {
                            const r = await renderPdfPageToPng(digested.buffer, originalPageNumber - 1, 280);
                            if (r) {
                                rendered = r;
                                pageRenderCache.set(originalPageNumber, r);
                            }
                        }
                        if (!rendered) continue;

                        const croppedSym = await cropBox2dFromImage(
                            rendered.pngBuffer,
                            rendered.width,
                            rendered.height,
                            symSpec.box_2d
                        );
                        if (!croppedSym) continue;

                        try {
                            const vectorized = await vectorizeRasterSymbolToSvg(croppedSym, { mode: 'poster' });
                            const brandSlug = make.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                            const cleanSlug = String(symSpec.concept_slug || symSpec.technical_name_es || 'sym')
                                .toLowerCase()
                                .normalize('NFD')
                                .replace(/[\u0300-\u036f]/g, '')
                                .replace(/[^a-z0-9]+/g, '_')
                                .slice(0, 36);
                            const conceptId = `oem_${brandSlug}_${cleanSlug}`;

                            const origSymBytes = croppedSym.length;
                            const optSymBytes = Buffer.byteLength(vectorized.svgString || '', 'utf8');
                            const symSavingsPct =
                                origSymBytes > 0 && optSymBytes < origSymBytes
                                    ? Number((((origSymBytes - optSymBytes) / origSymBytes) * 100).toFixed(1))
                                    : 0;

                            await db
                                .collection('master_symbology_vault')
                                .doc(conceptId)
                                .set(
                                    {
                                        concept_id: conceptId,
                                        standard_family: 'OEM_CUSTOM',
                                        iso_reference: `OEM ${make.toUpperCase()} (Pág. ${originalPageNumber})`,
                                        technical_name_es: symSpec.technical_name_es || cleanSlug,
                                        technical_name_en: cleanSlug.replace(/_/g, ' '),
                                        description_es: symSpec.action_operator_es || '',
                                        action_operator_es: symSpec.action_operator_es || '',
                                        critical_color: symSpec.critical_color || 'NONE',
                                        standard_icon_status: 'encontrado',
                                        standard_icon_url: vectorized.descriptorUrl,
                                        svg_inline:
                                            vectorized.svgString.length <= 24000
                                                ? vectorized.svgString
                                                : undefined,
                                        cas_sha256: vectorized.sha256,
                                        original_bytes: origSymBytes,
                                        optimized_bytes: optSymBytes,
                                        savings_pct: symSavingsPct,
                                        created_at: nowIso,
                                        created_by: 'SegmentedDocumentProcessor vtracer WASM',
                                        updated_at: nowIso,
                                    },
                                    { merge: true }
                                );
                            newlyVectorizedConceptIds.push(conceptId);
                            vectorizedSymbolsCount++;
                        } catch {
                            // Continuar si un recorte puntual no es vectorizable
                        }
                    }

                    // 3. Persistir fragmentos `vault_corpus_chunks` (`768d`) y reconciliar en los 5 Pilares
                    const windowPageNumbers = windowPages.map((p) => p.pageNumber);
                    const windowFingerprints = windowPages.map((p) => p.fingerprint);

                    for (let cIdx = 0; cIdx < windowResult.chapters.length; cIdx++) {
                        const ch = windowResult.chapters[cIdx];
                        if (!VALID_PILLAR_IDS.includes(ch.pillar_id)) continue;

                        const scrubbedMarkdown = ConfidentialityAirlockService.scrubDeterministicPii(
                            ch.markdown_es || ''
                        ).scrubbed;
                        if (!scrubbedMarkdown.trim()) continue;

                        // Asociar figuras vinculadas a este capítulo (o repartir si solo hay un capítulo en la ventana)
                        const chapterFigures: ExtractedFigureRef[] = [];
                        if (Array.isArray(ch.figure_refs_indices) && ch.figure_refs_indices.length > 0) {
                            for (const refIdx of ch.figure_refs_indices) {
                                const fig = croppedFiguresByIndex.get(refIdx);
                                if (fig) chapterFigures.push(fig);
                            }
                        } else if (cIdx === 0 && croppedFiguresByIndex.size > 0) {
                            for (const fig of croppedFiguresByIndex.values()) {
                                chapterFigures.push(fig);
                            }
                        }

                        if (canMutateMasterCatalog) {
                            await this.persistCorpusChunk(assetRef, {
                                fileSha256: descriptor.sha256,
                                sourceFilename: input.originalFilename,
                                sourcePages: windowPageNumbers,
                                pageFingerprints: cIdx === 0 ? windowFingerprints : [],
                                pillarId: ch.pillar_id,
                                chapterTitle: ch.chapter_title,
                                markdownEs: scrubbedMarkdown,
                                figures: chapterFigures,
                            });

                            const pageRangeLabel = `${input.originalFilename} (Págs. ${windowPageNumbers[0]}–${
                                windowPageNumbers[windowPageNumbers.length - 1]
                            })`;

                            const rec = await VaultReconciliationService.reconcileContribution({
                                globalAssetId: input.globalAssetId,
                                pillarId: ch.pillar_id,
                                chapterTitle: ch.chapter_title,
                                section: ch.section,
                                priority: ch.priority,
                                markdownContent: scrubbedMarkdown,
                                structuredDeltas: ch.structured_deltas,
                                figures: chapterFigures,
                                symbologyCandidates: [
                                    ...(ch.iso_symbols || []),
                                    ...newlyVectorizedConceptIds,
                                ],
                                sourceLabel: pageRangeLabel,
                                sourceUrl: descriptor.downloadUrl,
                                isOemSource: true,
                                actorEmail: input.actorEmail,
                            });

                            pillarDistribution[ch.pillar_id]++;
                            extractedChaptersCount++;
                            skippedDuplicateFacts += rec.skippedDuplicates;
                            lockedAdvisoriesCount += rec.addedAdvisories;
                        }
                    }

                    // Si una ventana no produjo capítulos (ej. portada/índice legal), registrar igualmente sus fingerprints para no reprocesarla
                    if (windowResult.chapters.length === 0 && canMutateMasterCatalog) {
                        await assetRef.collection('vault_corpus_chunks').add({
                            file_sha256: descriptor.sha256,
                            source_filename: input.originalFilename,
                            source_pages: windowPageNumbers,
                            page_fingerprints: windowFingerprints,
                            pillar_id: 'ficha_tecnica',
                            chapter_title: 'Índice / Páginas Preliminares',
                            markdown_es: '',
                            created_at: nowIso,
                        });
                    }
                }
            }

            // 4. Reconstruir paquete ad-hoc de simbología del activo para incorporar todos los nuevos símbolos detectados
            if (input.visibilityScope !== 'TENANT_ONLY') {
                await buildAndPersistAssetSymbologyPack(input.globalAssetId);
            }

            const completedAt = new Date().toISOString();
            const fileStatus = remainingDeferredPages > 0 ? 'PARTIAL_DEFERRED' : 'COMPLETED';

            await vaultFilesCol.doc(descriptor.sha256).set(
                {
                    sha256: descriptor.sha256,
                    phashHex: descriptor.phashHex || null,
                    originalFilename: input.originalFilename,
                    mimeType: descriptor.mimeType,
                    storageUrl: descriptor.downloadUrl,
                    storagePath: descriptor.storagePath,
                    documentCategory: input.documentCategory || (isPdf ? 'OEM_MANUAL' : 'TECHNICAL_CHART_PHOTO'),
                    visibilityScope: input.visibilityScope || 'COMMONS_OEM',
                    originalBytes: descriptor.originalBytes,
                    optimizedBytes: descriptor.optimizedBytes,
                    savingsRatio: descriptor.savingsRatio,
                    savingsPct:
                        descriptor.savingsPct ??
                        Number((Number(descriptor.savingsRatio || 0) * 100).toFixed(1)),
                    totalPages,
                    skippedUnchangedPages,
                    processedPages,
                    remainingDeferredPages,
                    extractedChaptersCount,
                    extractedFiguresCount,
                    vectorizedSymbolsCount,
                    pillarDistribution,
                    status: fileStatus,
                    lastJobId: jobId,
                    uploadedBy: input.actorEmail,
                    updatedAt: completedAt,
                },
                { merge: true }
            );

            await jobsCol.doc(jobId).set(
                {
                    status: 'COMPLETED',
                    totalPages,
                    skippedUnchangedPages,
                    processedPages,
                    remainingDeferredPages,
                    extractedChaptersCount,
                    extractedFiguresCount,
                    vectorizedSymbolsCount,
                    skippedDuplicateFacts,
                    lockedAdvisoriesCount,
                    pillarDistribution,
                    completedAt,
                },
                { merge: true }
            );

            return {
                jobId,
                fileSha256: descriptor.sha256,
                storageUrl: descriptor.downloadUrl,
                deduplicatedDocumentHit: false,
                originalBytes: descriptor.originalBytes,
                optimizedBytes: descriptor.optimizedBytes,
                savingsRatio: descriptor.savingsRatio,
                totalPages,
                skippedUnchangedPages,
                processedPages,
                remainingDeferredPages,
                extractedChaptersCount,
                extractedFiguresCount,
                vectorizedSymbolsCount,
                skippedDuplicateFacts,
                lockedAdvisoriesCount,
                pillarDistribution,
            };
        } catch (err: any) {
            await jobsCol
                .doc(jobId)
                .set(
                    {
                        status: 'FAILED',
                        errorMessage: err?.message || 'Fallo en procesamiento segmentado.',
                        completedAt: new Date().toISOString(),
                    },
                    { merge: true }
                )
                .catch(() => {});
            throw err;
        }
    }

    private static async inspectPdfPagesWithMupdf(pdfBuffer: Buffer): Promise<PageInspectionEntry[]> {
        return withMupdfSemaphore(async () => {
            const mupdf = await importEsm<any>('mupdf');
            let doc: any = null;
            const entries: PageInspectionEntry[] = [];

            try {
                doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
                const count = doc.countPages();

                for (let i = 0; i < count; i++) {
                    let page: any = null;
                    let sText: any = null;
                    let pix: any = null;
                    try {
                        page = doc.loadPage(i);
                        sText = page.toStructuredText('preserve-whitespace');
                        const text = String(sText.asText() || '').trim();
                        const isScanOrDiagramHeavy = text.length < 140;

                        let visualDigestHex: string | undefined;
                        if (isScanOrDiagramHeavy) {
                            pix = page.toPixmap(
                                mupdf.Matrix.scale(0.5, 0.5),
                                mupdf.ColorSpace.DeviceGray,
                                false,
                                true
                            );
                            visualDigestHex = createHash('sha256')
                                .update(Buffer.from(pix.getPixels()))
                                .digest('hex')
                                .slice(0, 24);
                        }

                        entries.push({
                            pageNumber: i + 1,
                            fingerprint: computePageFastCdcFingerprint(text, visualDigestHex),
                            text,
                            isScanOrDiagramHeavy,
                        });
                    } finally {
                        try {
                            pix?.destroy?.();
                        } catch {}
                        try {
                            sText?.destroy?.();
                        } catch {}
                        try {
                            page?.destroy?.();
                        } catch {}
                    }
                }
            } finally {
                try {
                    doc?.destroy?.();
                } catch {}
            }

            return entries;
        });
    }

    private static async extractWindowKnowledgeAndBoxes(params: {
        makeModel: string;
        originalFilename: string;
        windowPdfBuffer: Buffer;
        windowPages: PageInspectionEntry[];
    }): Promise<{
        chapters: ExtractedWindowChapter[];
        figuresToCrop: WindowFigureCropSpec[];
        oemSymbolsToVectorize: WindowOemSymbolCropSpec[];
    }> {
        const pageRange = `${params.windowPages[0].pageNumber}–${
            params.windowPages[params.windowPages.length - 1].pageNumber
        }`;

        const prompt = `Eres el Procesador Multimodal Forense OEM de MINREPORT para el activo "${params.makeModel}".
Analiza este segmento del documento "${params.originalFilename}" (correspondiente a las páginas originales ${pageRange}; índice interno de esta ventana: 1 a ${params.windowPages.length}).

OBJETIVO DE EXTRACCIÓN INTEGRAL EN LOS 5 PILARES:
1. Reparte TODA la información técnica concreta (tablas de dimensiones, pesos, motor, caudales, capacidades de fluidos, operación de controles, intervalos de mantención por horómetro, torques, riesgos mecánicos/hidráulicos/eléctricos, LOTO e inspección pre-operacional) hacia los **5 pilares exactos**:
   - "ficha_tecnica"
   - "manual_operaciones"
   - "pauta_mantencion"
   - "matriz_riesgos"
   - "checklist_pre_op"
2. En "markdown_es", redacta el contenido técnico completo en español técnico riguroso con tablas Markdown limpias y unidades SI verificadas (cero resúmenes superficiales).
3. DETECCIÓN ESPACIAL DE FIGURAS ("figures_to_crop"):
   Si cualquiera de las páginas (1..${params.windowPages.length}) contiene diagramas acotados, curvas de carga/rendimiento, esquemas hidráulicos/eléctricos, mapas de puntos de engrase o vistas con componentes numerados (1..N):
   - Devuelve su coordenada normalizada exacta "box_2d": [ymin, xmin, ymax, xmax] en escala 0..1000 sobre esa página ("window_page_index": 1..${params.windowPages.length}).
   - Incluye la lista de "callouts" si la figura tiene números o letras identificadoras.
   - Asocia el índice de esa figura (0, 1, ...) en "figure_refs_indices" del capítulo correspondiente.
4. SIMBOLOGÍA NORMATIVA Y OEM:
   - Lista en "iso_symbols" cualquier código ISO 7010 (ej. "M014", "W019", "P002"), ISO 7000 (ej. "ISO 7000-0248"), ISO 2575, IEC 60417 o GHS presente.
   - Si aparece un pictograma propietario del fabricante que deba recortarse y vectorizarse, inclúyelo en "custom_oem_symbols".

Responde ESTRICTAMENTE en JSON puro con esta estructura:
{
  "chapters": [
    {
      "pillar_id": "ficha_tecnica" | "manual_operaciones" | "pauta_mantencion" | "matriz_riesgos" | "checklist_pre_op",
      "chapter_title": "Título técnico específico del capítulo",
      "section": "SISTEMA HIDRÁULICO",
      "priority": "CRÍTICO",
      "markdown_es": "Tablas y especificaciones completas en Markdown...",
      "structured_deltas": [
        {
          "zona": "HIDRÁULICA",
          "componente": "Presión de alivio principal",
          "valor_nuevo": "210 bar (3045 psi)",
          "condicion_esperada": "A régimen nominal",
          "tipo_input": "NUMERIC",
          "is_oem": true
        }
      ],
      "iso_symbols": ["M002", "W029", "ISO 7000-1409"],
      "figure_refs_indices": [0]
    }
  ],
  "figures_to_crop": [
    {
      "window_page_index": 1,
      "figure_type": "DIAGRAMA_ACOTADO",
      "title_es": "Dimensiones generales y radio de giro",
      "caption_es": "Cotas principales en milímetros con cucharón estándar",
      "box_2d": [120, 80, 680, 920],
      "callouts": [
        { "callout": "A", "component_es": "Altura total a cabina ROPS", "function_or_spec": "1980 mm" }
      ]
    }
  ],
  "custom_oem_symbols": []
}`;

        try {
            const response = await ResilientAIClient.generate({
                module: 'opermaq',
                preferredTier: 'SECONDARY',
                temperature: 0.05,
                maxOutputTokens: 8192,
                thinkingLevel: 'low',
                media: [
                    {
                        mimeType: 'application/pdf',
                        dataBase64: params.windowPdfBuffer.toString('base64'),
                    },
                ],
                prompt,
            });

            const parsed = JSON.parse(ResilientAIClient.extractJsonString(response.text));
            return {
                chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
                figuresToCrop: Array.isArray(parsed.figures_to_crop) ? parsed.figures_to_crop : [],
                oemSymbolsToVectorize: Array.isArray(parsed.custom_oem_symbols)
                    ? parsed.custom_oem_symbols
                    : [],
            };
        } catch {
            // Fallback determinista sobre el texto extraído localmente por `mupdf` si el transporte multimodal falla
            const joinedText = params.windowPages
                .map((p) => `### Página ${p.pageNumber}\n${p.text}`)
                .join('\n\n')
                .trim();

            if (!joinedText) {
                return { chapters: [], figuresToCrop: [], oemSymbolsToVectorize: [] };
            }

            const lower = joinedText.toLowerCase();
            const inferredPillar: PillarId = /mantenci|lubric|filtro|aceite|interval|hor[oó]metro|hours/i.test(lower)
                ? 'pauta_mantencion'
                : /peligro|advertencia|riesgo|warning|danger|loto|bloqueo/i.test(lower)
                ? 'matriz_riesgos'
                : /inspecci[oó]n|pre-op|walk-around|diaria|check/i.test(lower)
                ? 'checklist_pre_op'
                : /dimensi|peso|weight|potencia|power|displacement|cilindrada|especificaci/i.test(lower)
                ? 'ficha_tecnica'
                : 'manual_operaciones';

            return {
                chapters: [
                    {
                        pillar_id: inferredPillar,
                        chapter_title: `Extracto Técnico OEM (Págs. ${pageRange})`,
                        section: 'DOCUMENTACIÓN OEM',
                        priority: 'IMPORTANTE',
                        markdown_es: joinedText.slice(0, 12000),
                    },
                ],
                figuresToCrop: [],
                oemSymbolsToVectorize: [],
            };
        }
    }

    private static async analyzeVisualSheetWithSwarm(
        makeModel: string,
        webpBuffer: Buffer,
        originalFilename: string
    ): Promise<{
        figureType: ExtractedFigureRef['figure_type'];
        figureTitle: string;
        figureCaption: string;
        callouts: FigureCallout[];
        chapters: ExtractedWindowChapter[];
    }> {
        const prompt = `Analiza esta imagen/lámina técnica ("${originalFilename}") perteneciente al activo "${makeModel}".
Extrae todos los datos verificables (tablas, placas de características, curvas, leyendas numeradas 1..N o diagramas) y clasifícalos en el pilar correspondiente ("ficha_tecnica", "manual_operaciones", "pauta_mantencion", "matriz_riesgos" o "checklist_pre_op").
Responde ESTRICTAMENTE en JSON puro:
{
  "figure_type": "DIAGRAMA_ACOTADO" | "CURVA_RENDIMIENTO" | "ESQUEMA_HIDRAULICO_ELECTRICO" | "FOTO_COMPONENTE" | "MAPA_LUBRICACION_PM" | "SIMBOLOGIA_SEGURIDAD",
  "figure_title": "Título técnico conciso",
  "figure_caption": "Descripción técnica objetiva",
  "callouts": [
    { "callout": "1", "component_es": "Componente identificado", "function_or_spec": "Valor o función" }
  ],
  "chapters": [
    {
      "pillar_id": "ficha_tecnica",
      "chapter_title": "Especificaciones extraídas de lámina técnica",
      "section": "ESPECIFICACIONES OEM",
      "priority": "IMPORTANTE",
      "markdown_es": "Contenido estructurado en Markdown...",
      "iso_symbols": []
    }
  ]
}`;

        try {
            const resp = await ResilientAIClient.generate({
                module: 'opermaq',
                preferredTier: 'SECONDARY',
                temperature: 0.05,
                maxOutputTokens: 4096,
                media: [
                    {
                        mimeType: 'image/webp',
                        dataBase64: webpBuffer.toString('base64'),
                    },
                ],
                prompt,
            });
            const parsed = JSON.parse(ResilientAIClient.extractJsonString(resp.text));
            return {
                figureType: parsed.figure_type || 'FOTO_COMPONENTE',
                figureTitle: parsed.figure_title || originalFilename,
                figureCaption: parsed.figure_caption || '',
                callouts: Array.isArray(parsed.callouts) ? parsed.callouts : [],
                chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
            };
        } catch {
            return {
                figureType: 'FOTO_COMPONENTE',
                figureTitle: originalFilename,
                figureCaption: 'Registro gráfico optimizado en CAS.',
                callouts: [],
                chapters: [
                    {
                        pillar_id: 'ficha_tecnica',
                        chapter_title: `Registro Visual Técnico — ${originalFilename}`,
                        section: 'REGISTRO VISUAL OEM',
                        priority: 'COMPLEMENTARIO',
                        markdown_es: `Lámina técnica verificada e indexada en almacenamiento CAS para **${makeModel}**.`,
                    },
                ],
            };
        }
    }

    private static async persistCorpusChunk(
        assetRef: FirebaseFirestore.DocumentReference,
        params: {
            fileSha256: string;
            sourceFilename: string;
            sourcePages: number[];
            pageFingerprints: string[];
            pillarId: PillarId;
            chapterTitle: string;
            markdownEs: string;
            figures?: ExtractedFigureRef[];
        }
    ): Promise<void> {
        let vectorField: any = null;
        try {
            const vec = await ResilientAIClient.embedText(
                `${params.chapterTitle}\n${params.markdownEs.slice(0, 6000)}`,
                {
                    taskType: 'RETRIEVAL_DOCUMENT',
                    title: params.chapterTitle,
                }
            );
            vectorField = FieldValue.vector(vec);
        } catch {
            vectorField = null;
        }

        await assetRef.collection('vault_corpus_chunks').add({
            file_sha256: params.fileSha256,
            source_filename: params.sourceFilename,
            source_pages: params.sourcePages,
            page_fingerprints: params.pageFingerprints,
            pillar_id: params.pillarId,
            chapter_title: params.chapterTitle,
            markdown_es: params.markdownEs,
            ...(Array.isArray(params.figures) && params.figures.length > 0 ? { figures: params.figures } : {}),
            ...(vectorField ? { embedding_768: vectorField } : {}),
            created_at: new Date().toISOString(),
        });
    }

    /**
     * FLUJO SEGURO CLIENTE (`FLOTA`):
     * Recibe un PDF subido desde la flota de un cliente, evalúa su contenido mediante deduplicación
     * de triple capa (`SHA-256` binario + `FastCDC` por página + similitud vectorial `768d` y huella de hechos),
     * sanitiza PII con `ConfidentialityAirlockService` y deposita ÚNICAMENTE los deltas técnicos inéditos
     * en la colección de cuarentena `knowledge_contributions` (`PENDING_HUMAN_REVIEW`), sin mutar jamás
     * `global_asset_catalog` ni publicar nada hasta la revisión humana de MINREPORT.
     */
    public static async ingestClientPdfToQuarantine(input: {
        globalAssetId: string;
        tenantAssetId?: string;
        fileBuffer: Buffer;
        mimeType: string;
        originalFilename: string;
        clientOriginalBytes?: number;
        tenantId: string;
        actorUid: string;
        actorEmail: string;
        maxWindowsPerRun?: number;
    }): Promise<{
        contributionId: string | null;
        quarantineStatus:
            | 'QUEUED_FOR_HUMAN_REVIEW'
            | 'DUPLICATE_BINARY_SKIPPED'
            | 'ALL_PAGES_ALREADY_KNOWN'
            | 'AUTO_DEDUPLICATED_NO_DELTA';
        fileSha256: string;
        deduplicatedDocumentHit: boolean;
        originalBytes: number;
        optimizedBytes: number;
        savingsRatio: number;
        totalPages: number;
        processedPages: number;
        skippedUnchangedPages: number;
        skippedSemanticDuplicates: number;
        netNewItemsCount: number;
    }> {
        const isPdf =
            input.mimeType === 'application/pdf' ||
            input.originalFilename.toLowerCase().endsWith('.pdf');
        if (!isPdf) {
            const err: any = new Error('Por seguridad, desde Control de Flota solo se admiten documentos en formato PDF.');
            err.statusCode = 400;
            throw err;
        }

        const assetRef = db.collection('global_asset_catalog').doc(input.globalAssetId);
        const assetSnap = await assetRef.get();
        if (!assetSnap.exists) {
            const err: any = new Error(`Activo ${input.globalAssetId} no existe en el Catálogo Maestro.`);
            err.statusCode = 404;
            throw err;
        }

        const assetData = assetSnap.data()!;
        const make = String(assetData.make_oficial || assetData.make || 'OEM');
        const model = String(assetData.model_oficial || assetData.model || input.globalAssetId);
        const makeModel = String(assetData.make_model || `${make} ${model}`).trim();

        // 1. Digestión y almacenamiento aislado en CAS privado del tenant (`TENANT_PRIVATE`)
        const { descriptor, digested } = await CasStorageService.digestAndStore(
            input.fileBuffer,
            'application/pdf',
            'PDF_HYBRID_OEM',
            {
                scope: 'TENANT_PRIVATE',
                tenantId: input.tenantId,
                actorUid: input.actorUid,
                originalFilename: input.originalFilename,
                clientOriginalBytes: input.clientOriginalBytes,
                enableSelectiveRaster: true,
            }
        );

        // 2. Nivel 1 — Deduplicación Binaria Exacta O(1) contra `vault_files` y `knowledge_contributions`
        const [existingMasterFileSnap, existingContribSnap] = await Promise.all([
            assetRef.collection('vault_files').doc(descriptor.sha256).get(),
            db
                .collection('knowledge_contributions')
                .where('global_asset_id', '==', input.globalAssetId)
                .where('file_sha256', '==', descriptor.sha256)
                .limit(5)
                .get(),
        ]);

        if (existingMasterFileSnap.exists && existingMasterFileSnap.data()?.status === 'COMPLETED') {
            const prev = existingMasterFileSnap.data()!;
            return {
                contributionId: null,
                quarantineStatus: 'DUPLICATE_BINARY_SKIPPED',
                fileSha256: descriptor.sha256,
                deduplicatedDocumentHit: true,
                originalBytes: descriptor.originalBytes,
                optimizedBytes: descriptor.optimizedBytes,
                savingsRatio: descriptor.savingsRatio,
                totalPages: Number(prev.totalPages || descriptor.pageCount || 1),
                processedPages: 0,
                skippedUnchangedPages: Number(prev.totalPages || descriptor.pageCount || 1),
                skippedSemanticDuplicates: 0,
                netNewItemsCount: 0,
            };
        }

        const activeExistingContrib = existingContribSnap.docs.find((d) => {
            const st = String(d.data()?.status || '');
            return st === 'PENDING_HUMAN_REVIEW' || st === 'APPROVED' || st === 'AUTO_DEDUPLICATED_NO_DELTA';
        });

        if (activeExistingContrib) {
            const prevData = activeExistingContrib.data();
            return {
                contributionId: activeExistingContrib.id,
                quarantineStatus: 'DUPLICATE_BINARY_SKIPPED',
                fileSha256: descriptor.sha256,
                deduplicatedDocumentHit: true,
                originalBytes: descriptor.originalBytes,
                optimizedBytes: descriptor.optimizedBytes,
                savingsRatio: descriptor.savingsRatio,
                totalPages: Number(prevData?.dedup_metrics?.totalPages || descriptor.pageCount || 1),
                processedPages: 0,
                skippedUnchangedPages: Number(prevData?.dedup_metrics?.totalPages || descriptor.pageCount || 1),
                skippedSemanticDuplicates: 0,
                netNewItemsCount: 0,
            };
        }

        // 3. Nivel 2 — Deduplicación Estructural por Página (`mupdf` WASM + `FastCDC`)
        const pagesInfo = await this.inspectPdfPagesWithMupdf(digested.buffer);
        const totalPages = pagesInfo.length;

        const [existingChunksSnap, prevAssetContribsSnap] = await Promise.all([
            assetRef.collection('vault_corpus_chunks').select('page_fingerprints').get(),
            db
                .collection('knowledge_contributions')
                .where('global_asset_id', '==', input.globalAssetId)
                .limit(50)
                .get(),
        ]);

        const knownPageFingerprints = new Set<string>();
        for (const doc of existingChunksSnap.docs) {
            const fps = doc.data()?.page_fingerprints;
            if (Array.isArray(fps)) {
                for (const fp of fps) knownPageFingerprints.add(String(fp));
            }
        }
        for (const doc of prevAssetContribsSnap.docs) {
            const st = String(doc.data()?.status || '');
            if (st === 'REJECTED') continue;
            const fps = doc.data()?.page_fingerprints_seen;
            if (Array.isArray(fps)) {
                for (const fp of fps) knownPageFingerprints.add(String(fp));
            }
        }

        const deltaPages: PageInspectionEntry[] = [];
        let skippedUnchangedPages = 0;
        for (const p of pagesInfo) {
            if (knownPageFingerprints.has(p.fingerprint)) {
                skippedUnchangedPages++;
            } else {
                deltaPages.push(p);
            }
        }

        if (deltaPages.length === 0) {
            return {
                contributionId: null,
                quarantineStatus: 'ALL_PAGES_ALREADY_KNOWN',
                fileSha256: descriptor.sha256,
                deduplicatedDocumentHit: true,
                originalBytes: descriptor.originalBytes,
                optimizedBytes: descriptor.optimizedBytes,
                savingsRatio: descriptor.savingsRatio,
                totalPages,
                processedPages: 0,
                skippedUnchangedPages,
                skippedSemanticDuplicates: 0,
                netNewItemsCount: 0,
            };
        }

        // 4. Nivel 3 — Extracción Multimodal + Esclusa PII + Deduplicación Semántica `768d` y Huella de Hechos
        const PAGES_PER_WINDOW = 14;
        const maxWindows = input.maxWindowsPerRun ?? 12;
        const allWindows: PageInspectionEntry[][] = [];
        for (let i = 0; i < deltaPages.length; i += PAGES_PER_WINDOW) {
            allWindows.push(deltaPages.slice(i, i + PAGES_PER_WINDOW));
        }
        const activeWindows = allWindows.slice(0, maxWindows);

        const existingFactFingerprints = new Set<string>();
        const liveVault = assetData.knowledge_vault || {};
        for (const pid of VALID_PILLAR_IDS) {
            const pItems = Array.isArray(liveVault?.[pid]?.items) ? liveVault[pid].items : [];
            for (const it of pItems) {
                if (it?.is_discarded) continue;
                if (it?.content) {
                    existingFactFingerprints.add(computeFactFingerprint(String(it.content), String(it.title || '')));
                }
                if (Array.isArray(it?.fact_fingerprints)) {
                    for (const fp of it.fact_fingerprints) existingFactFingerprints.add(String(fp));
                }
            }
        }
        for (const doc of prevAssetContribsSnap.docs) {
            if (String(doc.data()?.status || '') === 'REJECTED') continue;
            const pList = Array.isArray(doc.data()?.proposed_items) ? doc.data().proposed_items : [];
            for (const p of pList) {
                if (p?.fact_fingerprint) existingFactFingerprints.add(String(p.fact_fingerprint));
            }
        }

        const masterPdfDoc = await PDFDocument.load(digested.buffer, { ignoreEncryption: true });
        const proposedItems: QuarantineProposedPillarDelta[] = [];
        const pageFingerprintsSeen: string[] = [];
        let processedPages = 0;
        let skippedSemanticDuplicates = 0;

        for (const windowPages of activeWindows) {
            processedPages += windowPages.length;
            for (const wp of windowPages) pageFingerprintsSeen.push(wp.fingerprint);

            const subPdf = await PDFDocument.create();
            const zeroBasedIndices = windowPages.map((p) => p.pageNumber - 1);
            const copied = await subPdf.copyPages(masterPdfDoc, zeroBasedIndices);
            for (const cp of copied) subPdf.addPage(cp);
            const windowPdfBytes = Buffer.from(await subPdf.save({ useObjectStreams: true }));

            const windowResult = await this.extractWindowKnowledgeAndBoxes({
                makeModel,
                originalFilename: input.originalFilename,
                windowPdfBuffer: windowPdfBytes,
                windowPages,
            });

            const croppedFiguresByIndex = new Map<number, ExtractedFigureRef>();
            const pageRenderCache = new Map<number, { pngBuffer: Buffer; width: number; height: number }>();

            for (let fIdx = 0; fIdx < windowResult.figuresToCrop.length; fIdx++) {
                const figSpec = windowResult.figuresToCrop[fIdx];
                const localIdx = Math.max(
                    0,
                    Math.min(windowPages.length - 1, (Number(figSpec.window_page_index) || 1) - 1)
                );
                const originalPageNumber = windowPages[localIdx].pageNumber;

                let rendered = pageRenderCache.get(originalPageNumber);
                if (!rendered) {
                    const r = await renderPdfPageToPng(digested.buffer, originalPageNumber - 1, 220);
                    if (r) {
                        rendered = r;
                        pageRenderCache.set(originalPageNumber, r);
                    }
                }
                if (!rendered) continue;

                const croppedBuf = await cropBox2dFromImage(
                    rendered.pngBuffer,
                    rendered.width,
                    rendered.height,
                    figSpec.box_2d
                );
                if (!croppedBuf) continue;

                const { descriptor: figDesc } = await CasStorageService.digestAndStore(
                    croppedBuf,
                    'image/png',
                    'IMAGE_TECHNICAL_HD',
                    {
                        scope: 'TENANT_PRIVATE',
                        tenantId: input.tenantId,
                        actorUid: input.actorUid,
                        originalFilename: `quarantine_p${originalPageNumber}_fig${fIdx + 1}.webp`,
                    }
                );

                croppedFiguresByIndex.set(fIdx, {
                    figure_id: `qfig_p${originalPageNumber}_${figDesc.sha256.slice(0, 10)}`,
                    sha256: figDesc.sha256,
                    phash_hex: figDesc.phashHex,
                    storage_url: figDesc.downloadUrl,
                    mime_type: 'image/webp',
                    figure_type: figSpec.figure_type || 'DIAGRAMA_ACOTADO',
                    title_es: ConfidentialityAirlockService.scrubDeterministicPii(
                        figSpec.title_es || `Figura Pág. ${originalPageNumber}`
                    ).scrubbed,
                    caption_es: figSpec.caption_es
                        ? ConfidentialityAirlockService.scrubDeterministicPii(figSpec.caption_es).scrubbed
                        : undefined,
                    source_page: originalPageNumber,
                    source_doc_hash: descriptor.sha256,
                    width: figDesc.width,
                    height: figDesc.height,
                    original_bytes: figDesc.originalBytes,
                    optimized_bytes: figDesc.optimizedBytes,
                    savings_pct: figDesc.savingsPct ?? Number((figDesc.savingsRatio * 100).toFixed(1)),
                    callouts: Array.isArray(figSpec.callouts) ? figSpec.callouts : undefined,
                });
            }

            const windowPageNumbers = windowPages.map((p) => p.pageNumber);

            for (let cIdx = 0; cIdx < windowResult.chapters.length; cIdx++) {
                const ch = windowResult.chapters[cIdx];
                if (!VALID_PILLAR_IDS.includes(ch.pillar_id)) continue;

                const scrubbedTitle = ConfidentialityAirlockService.scrubDeterministicPii(
                    ch.chapter_title || 'Capítulo Técnico'
                ).scrubbed.trim();
                const scrubbedMarkdownRaw = ConfidentialityAirlockService.scrubDeterministicPii(
                    ch.markdown_es || ''
                ).scrubbed.trim();
                if (!scrubbedMarkdownRaw) continue;

                const normalizedMarkdown = verifyAndNormalizeTechnicalUnits(scrubbedMarkdownRaw).normalizedMarkdown.trim();
                const factFp = computeFactFingerprint(normalizedMarkdown, scrubbedTitle);

                if (existingFactFingerprints.has(factFp)) {
                    skippedSemanticDuplicates++;
                    continue;
                }

                // Verificar similitud semántica contra corpus existente (umbral estricto >= 0.91)
                const corpusHits = await this.searchLocalAssetCorpus(
                    input.globalAssetId,
                    `${scrubbedTitle}\n${normalizedMarkdown.slice(0, 1800)}`,
                    2
                );
                if (corpusHits.length > 0 && corpusHits[0].score >= 0.91) {
                    skippedSemanticDuplicates++;
                    continue;
                }

                existingFactFingerprints.add(factFp);

                // Localizar snapshot publicado actual (si existe capítulo homólogo) para vista comparativa `[Actual] ➔ [Sugerido]`
                let currentPublishedTitle: string | null = null;
                let currentPublishedExcerpt: string | null = null;
                const pillarItems = Array.isArray(liveVault?.[ch.pillar_id]?.items)
                    ? liveVault[ch.pillar_id].items
                    : [];
                const titleLower = scrubbedTitle.toLowerCase();
                const matchedPublished = pillarItems.find(
                    (it: any) =>
                        !it?.is_discarded &&
                        it?.content &&
                        String(it?.title || '').toLowerCase() === titleLower
                );
                if (matchedPublished) {
                    currentPublishedTitle = String(matchedPublished.title || '');
                    currentPublishedExcerpt = String(matchedPublished.content || '').slice(0, 700);
                }

                const chapterFigures: ExtractedFigureRef[] = [];
                if (Array.isArray(ch.figure_refs_indices) && ch.figure_refs_indices.length > 0) {
                    for (const refIdx of ch.figure_refs_indices) {
                        const fig = croppedFiguresByIndex.get(refIdx);
                        if (fig) chapterFigures.push(fig);
                    }
                } else if (cIdx === 0 && croppedFiguresByIndex.size > 0) {
                    for (const fig of croppedFiguresByIndex.values()) {
                        chapterFigures.push(fig);
                    }
                }

                proposedItems.push({
                    proposal_id: `qprop_${randomUUID().slice(0, 10)}`,
                    pillar_id: ch.pillar_id,
                    chapter_title: scrubbedTitle,
                    section: String(ch.section || 'APORTE DOCUMENTAL OEM').toUpperCase(),
                    priority: ch.priority || 'IMPORTANTE',
                    current_published_title: currentPublishedTitle,
                    current_published_excerpt: currentPublishedExcerpt,
                    suggested_markdown: normalizedMarkdown,
                    structured_deltas: Array.isArray(ch.structured_deltas) ? ch.structured_deltas : undefined,
                    figures: chapterFigures.length > 0 ? chapterFigures : undefined,
                    source_pages: windowPageNumbers,
                    fact_fingerprint: factFp,
                });
            }
        }

        const sanitizedFilename = ConfidentialityAirlockService.scrubDeterministicPii(
            input.originalFilename.replace(/[^a-zA-Z0-9._ -]/g, '_')
        ).scrubbed.slice(0, 140);

        const nowIso = new Date().toISOString();

        if (proposedItems.length === 0) {
            const autoDoc = await db.collection('knowledge_contributions').add({
                global_asset_id: input.globalAssetId,
                make_model: makeModel,
                tenantId: input.tenantId,
                tenant_id: input.tenantId,
                tenant_asset_id: input.tenantAssetId || null,
                authorUid: input.actorUid,
                file_sha256: descriptor.sha256,
                sanitized_filename: sanitizedFilename,
                page_fingerprints_seen: pageFingerprintsSeen,
                status: 'AUTO_DEDUPLICATED_NO_DELTA',
                estado_aprobacion: 'BORRADOR_IA',
                proposed_items: [],
                dedup_metrics: {
                    totalPages,
                    processedPages,
                    skippedUnchangedPages,
                    skippedSemanticDuplicates,
                    netNewItemsCount: 0,
                },
                created_at: nowIso,
                updated_at: nowIso,
            });

            return {
                contributionId: autoDoc.id,
                quarantineStatus: 'AUTO_DEDUPLICATED_NO_DELTA',
                fileSha256: descriptor.sha256,
                deduplicatedDocumentHit: true,
                originalBytes: descriptor.originalBytes,
                optimizedBytes: descriptor.optimizedBytes,
                savingsRatio: descriptor.savingsRatio,
                totalPages,
                processedPages,
                skippedUnchangedPages,
                skippedSemanticDuplicates,
                netNewItemsCount: 0,
            };
        }

        // 5. Persistencia exclusiva en Cuarentena (`knowledge_contributions`)
        // Garantía Zero-Trust (Ley N° 21.719): NINGÚN aporte de un cliente B2B muta `global_asset_catalog`
        // ni promueve imágenes desde `TENANT_PRIVATE` a `GLOBAL_OEM` sin autorización humana granular 1 a 1
        // mediante `consolidateHumanReviewedContribution` y palabra clave `"ACTUALIZAR"`.
        const contribRef = await db.collection('knowledge_contributions').add({
            global_asset_id: input.globalAssetId,
            make_model: makeModel,
            tenantId: input.tenantId,
            tenant_id: input.tenantId,
            tenant_asset_id: input.tenantAssetId || null,
            authorUid: input.actorUid,
            file_sha256: descriptor.sha256,
            sanitized_filename: sanitizedFilename,
            page_fingerprints_seen: pageFingerprintsSeen,
            status: 'PENDING_HUMAN_REVIEW',
            estado_aprobacion: 'BORRADOR_IA',
            proposed_items: proposedItems,
            dedup_metrics: {
                totalPages,
                processedPages,
                skippedUnchangedPages,
                skippedSemanticDuplicates,
                netNewItemsCount: proposedItems.length,
            },
            created_at: nowIso,
            updated_at: nowIso,
        });

        return {
            contributionId: contribRef.id,
            quarantineStatus: 'QUEUED_FOR_HUMAN_REVIEW',
            fileSha256: descriptor.sha256,
            deduplicatedDocumentHit: false,
            originalBytes: descriptor.originalBytes,
            optimizedBytes: descriptor.optimizedBytes,
            savingsRatio: descriptor.savingsRatio,
            totalPages,
            processedPages,
            skippedUnchangedPages,
            skippedSemanticDuplicates,
            netNewItemsCount: proposedItems.length,
        };
    }

    /**
     * Consolidación Humana Granular 1 a 1 (`DEV` / `SUPER_ADMIN` / `TEST_PILOT`):
     * Promueve únicamente los deltas aceptados por un humano de MINREPORT desde `knowledge_contributions`
     * hacia los 5 Pilares del `CATÁLOGO` (`global_asset_catalog`), sanitizando y promoviendo figuras adjuntas
     * desde `TENANT_PRIVATE` a `GLOBAL_OEM` sin exponer jamás el `tenantId` originador.
     */
    public static async consolidateHumanReviewedContribution(params: {
        contributionId: string;
        acceptedProposalIds: string[];
        rejectedProposalIds: string[];
        publishApprovedItems: boolean;
        reviewNotes?: string;
        reviewerUid: string;
        reviewerEmail: string;
    }): Promise<{
        globalAssetId: string;
        status: 'APPROVED' | 'REJECTED';
        consolidatedCount: number;
        rejectedCount: number;
    }> {
        const contribRef = db.collection('knowledge_contributions').doc(params.contributionId);
        const contribSnap = await contribRef.get();
        if (!contribSnap.exists) {
            const err: any = new Error('Contribución en cuarentena no encontrada.');
            err.statusCode = 404;
            throw err;
        }

        const contrib = contribSnap.data()!;
        if (
            contrib.status !== 'PENDING_HUMAN_REVIEW' &&
            contrib.status !== 'ROUTED_TO_PILLAR_ITEMS_HITL'
        ) {
            const err: any = new Error(`La contribución ya fue procesada con estado ${contrib.status}.`);
            err.statusCode = 409;
            throw err;
        }

        const globalAssetId = String(contrib.global_asset_id || '');
        const assetRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const assetSnap = await assetRef.get();
        if (!assetSnap.exists) {
            const err: any = new Error(`Catálogo destino ${globalAssetId} no existe.`);
            err.statusCode = 404;
            throw err;
        }

        const allProposals: QuarantineProposedPillarDelta[] = Array.isArray(contrib.proposed_items)
            ? contrib.proposed_items
            : [];
        const acceptedSet = new Set(params.acceptedProposalIds);
        const originTenantId = String(contrib.tenantId || contrib.tenant_id || '');
        const nowIso = new Date().toISOString();

        let consolidatedCount = 0;
        const touchedItemIdsByPillar = new Map<PillarId, Set<string>>();

        for (const prop of allProposals) {
            if (!acceptedSet.has(prop.proposal_id)) continue;

            // Promover figuras desde `TENANT_PRIVATE` hacia `GLOBAL_OEM` pasando por Esclusa Óptica Zero-Trust
            const promotedFigures: ExtractedFigureRef[] = [];
            if (Array.isArray(prop.figures) && prop.figures.length > 0 && originTenantId) {
                for (const fig of prop.figures) {
                    try {
                        const privPath = CasStorageService.buildStoragePath(
                            'TENANT_PRIVATE',
                            fig.sha256,
                            'webp',
                            originTenantId
                        );
                        const blob = await CasStorageService.readCasBlob(privPath);
                        if (!blob) continue;

                        const sanitized = await ConfidentialityAirlockService.sanitizeImageForCommons(
                            blob.buffer,
                            originTenantId
                        );
                        const { descriptor: pubDesc } = await CasStorageService.digestAndStore(
                            sanitized.cleanBuffer,
                            'image/webp',
                            'IMAGE_TECHNICAL_HD',
                            {
                                scope: 'GLOBAL_OEM',
                                actorUid: params.reviewerUid,
                                originalFilename: `${prop.pillar_id}_${fig.figure_id}.webp`,
                                clientOriginalBytes: fig.original_bytes,
                            }
                        );

                        promotedFigures.push({
                            ...fig,
                            sha256: pubDesc.sha256,
                            phash_hex: pubDesc.phashHex,
                            storage_url: pubDesc.downloadUrl,
                            original_bytes: pubDesc.originalBytes,
                            optimized_bytes: pubDesc.optimizedBytes,
                            savings_pct: pubDesc.savingsPct ?? Number((pubDesc.savingsRatio * 100).toFixed(1)),
                            source_url: undefined,
                        });
                    } catch {
                        // Omitir figura individual si no se pudo promover
                    }
                }
            }

            const rec = await VaultReconciliationService.reconcileContribution({
                globalAssetId,
                pillarId: prop.pillar_id,
                chapterTitle: prop.chapter_title,
                section: prop.section,
                priority: prop.priority,
                markdownContent: prop.suggested_markdown,
                structuredDeltas: prop.structured_deltas,
                figures: promotedFigures,
                sourceLabel: 'Acervo Documental Curado MINREPORT',
                isOemSource: true,
                actorEmail: params.reviewerEmail,
            });

            if (!touchedItemIdsByPillar.has(prop.pillar_id)) {
                touchedItemIdsByPillar.set(prop.pillar_id, new Set());
            }
            touchedItemIdsByPillar.get(prop.pillar_id)!.add(rec.itemId);

            await this.persistCorpusChunk(assetRef, {
                fileSha256: String(contrib.file_sha256 || ''),
                sourceFilename: String(contrib.sanitized_filename || 'Documento Curado MINREPORT'),
                sourcePages: Array.isArray(prop.source_pages) ? prop.source_pages : [1],
                pageFingerprints: consolidatedCount === 0 && Array.isArray(contrib.page_fingerprints_seen)
                    ? contrib.page_fingerprints_seen
                    : [],
                pillarId: prop.pillar_id,
                chapterTitle: prop.chapter_title,
                markdownEs: prop.suggested_markdown,
            });

            consolidatedCount++;
        }

        // Si el revisor humano autoriza publicación inmediata (`publishApprovedItems`), marcar `APROBADO_HUMANO`
        if (params.publishApprovedItems && touchedItemIdsByPillar.size > 0) {
            const freshSnap = await assetRef.get();
            const freshVault = freshSnap.data()?.knowledge_vault || {};
            const vaultPatch: Record<string, any> = {};

            for (const [pillarId, itemIds] of touchedItemIdsByPillar.entries()) {
                const items: any[] = Array.isArray(freshVault?.[pillarId]?.items)
                    ? [...freshVault[pillarId].items]
                    : [];
                let changed = false;
                for (let i = 0; i < items.length; i++) {
                    if (itemIds.has(items[i]?.item_id) && items[i]?.content) {
                        items[i] = {
                            ...items[i],
                            estado_aprobacion: 'APROBADO_HUMANO',
                            approved_by: params.reviewerEmail,
                            approved_at: nowIso,
                        };
                        changed = true;
                    }
                }
                if (changed) {
                    vaultPatch[`knowledge_vault.${pillarId}.items`] = items;
                    vaultPatch[`knowledge_vault.${pillarId}.updated_at`] = nowIso;
                }
            }

            if (Object.keys(vaultPatch).length > 0) {
                vaultPatch.updatedAt = Date.now();
                await assetRef.update(vaultPatch);
            }
        }

        const finalStatus: 'APPROVED' | 'REJECTED' = consolidatedCount > 0 ? 'APPROVED' : 'REJECTED';

        await contribRef.update({
            status: finalStatus,
            estado_aprobacion: finalStatus === 'APPROVED' ? 'APROBADO_HUMANO' : 'RECHAZADO_HUMANO',
            accepted_proposal_ids: Array.from(acceptedSet),
            rejected_proposal_ids: params.rejectedProposalIds,
            review_notes: params.reviewNotes || '',
            reviewed_by_uid: params.reviewerUid,
            reviewed_by_email: params.reviewerEmail,
            reviewed_at: nowIso,
            updated_at: nowIso,
        });

        return {
            globalAssetId,
            status: finalStatus,
            consolidatedCount,
            rejectedCount: allProposals.length - consolidatedCount,
        };
    }
}
