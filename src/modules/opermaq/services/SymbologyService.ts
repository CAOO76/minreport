import { convertBuffer } from '@visioncortex/vtracer';
import admin, { db } from '../../../config/firebase';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { MediaDigestorServer } from '../../../core/media/MediaDigestorServer';
import { ResilientAIClient } from '../../../core/resilient-ai-client';
import { safeFetchExternal } from '../../../utils/ssrfGuard';
import { HITL_CONFIRM_KEYWORD, MasterSymbologyItem, MasterSymbologyVariant } from '../types/vault.types';
import {
    getCachedMasterSymbologyIndex,
    invalidateMasterSymbologyCache,
    SYNTHETIC_ADHOC_SYMBOL_AUTHOR,
} from './NeuroSymbolicVerifier';

export { getCachedMasterSymbologyIndex };

/**
 * SYMBOLOGY SERVICE — BÓVEDA GLOBAL DE SIMBOLOGÍA ISO 7000 / IEC 60417 (Consolidación 100% CAS)
 *
 * Pipeline (`MINREPORT-MEDIA-DIGESTOR-CAS` en `southamerica-west1`):
 * 1. Búsqueda directa en API pública de Wikimedia Commons + fallback Gemini con Google Search.
 * 2. Digestión obligatoria por `MediaDigestorServer` (`digestSvg` o `digestImage(..., 'IMAGE_ISO_SYMBOL')` / `vtracer`)
 *    y persistencia deduplicada en `CasStorageService.persistDigestedBinary(..., { scope: 'SYMBOLOGY_MASTER' })`.
 * 3. Persistencia exclusiva de URL liviana CAS (`/api/media/blob/symbology/...`) junto con telemetría auditable
 *    `original_bytes`, `optimized_bytes` y `savings_pct`.
 * 4. Confirmación humana obligatoria (`"ACTUALIZAR"`, estándar `GEMINI.md` §3.8).
 */

const WIKI_HEADERS = {
    'User-Agent': 'MINREPORT-OPERMAQ-Symbology/4.0 (https://minreport-access.web.app)',
};

interface SymbologyCasAssetResult {
    downloadUrl: string;
    sha256: string;
    originalBytes: number;
    optimizedBytes: number;
    savingsPct: number;
    svgInline?: string;
    wasVectorized: boolean;
}

async function digestAndPersistSymbologyBuffer(
    rawBuffer: Buffer,
    params: {
        actorUid: string;
        originalFilename: string;
        preferVectorizeRaster?: boolean;
    }
): Promise<SymbologyCasAssetResult> {
    const clientOriginalBytes = rawBuffer.length;
    const rawHead = rawBuffer.subarray(0, 512).toString('utf8');
    const isSvg = /<svg\b/i.test(rawHead);
    const cleanBaseName = (params.originalFilename || 'symbol')
        .replace(/\.[a-z0-9]+$/i, '')
        .slice(0, 180);

    if (isSvg) {
        const digestedSvg = await MediaDigestorServer.digestSvg(rawBuffer);
        const cas = await CasStorageService.persistDigestedBinary(digestedSvg, {
            scope: 'SYMBOLOGY_MASTER',
            actorUid: params.actorUid,
            originalFilename: `${cleanBaseName}.svg`,
            clientOriginalBytes,
        });
        const svgStr = digestedSvg.buffer.toString('utf8');
        return {
            downloadUrl: cas.downloadUrl,
            sha256: cas.sha256,
            originalBytes: cas.originalBytes,
            optimizedBytes: cas.optimizedBytes,
            savingsPct: cas.savingsPct ?? 0,
            svgInline: svgStr.length <= 24000 ? svgStr : undefined,
            wasVectorized: false,
        };
    }

    if (params.preferVectorizeRaster !== false) {
        try {
            const rawSvg = convertBuffer(new Uint8Array(rawBuffer), {
                preset: 'poster',
                clustering: 'color-cluster',
                mode: 'spline',
                filterSpeckle: 6,
                cornerThreshold: 55,
                simplify: 1.4,
                maxColors: 5,
                optimize: 2,
            });
            const digestedSvg = await MediaDigestorServer.digestSvg(rawSvg);
            const cas = await CasStorageService.persistDigestedBinary(digestedSvg, {
                scope: 'SYMBOLOGY_MASTER',
                actorUid: params.actorUid,
                originalFilename: `${cleanBaseName}.svg`,
                clientOriginalBytes,
            });
            const svgStr = digestedSvg.buffer.toString('utf8');
            return {
                downloadUrl: cas.downloadUrl,
                sha256: cas.sha256,
                originalBytes: cas.originalBytes,
                optimizedBytes: cas.optimizedBytes,
                savingsPct: cas.savingsPct ?? 0,
                svgInline: svgStr.length <= 24000 ? svgStr : undefined,
                wasVectorized: true,
            };
        } catch {
            // Fallback determinista hacia IMAGE_ISO_SYMBOL en CAS
        }
    }

    const digestedImg = await MediaDigestorServer.digestImage(rawBuffer, 'IMAGE_ISO_SYMBOL');
    const cas = await CasStorageService.persistDigestedBinary(digestedImg, {
        scope: 'SYMBOLOGY_MASTER',
        actorUid: params.actorUid,
        originalFilename: `${cleanBaseName}.${digestedImg.extension}`,
        clientOriginalBytes,
    });
    return {
        downloadUrl: cas.downloadUrl,
        sha256: cas.sha256,
        originalBytes: cas.originalBytes,
        optimizedBytes: cas.optimizedBytes,
        savingsPct: cas.savingsPct ?? 0,
        wasVectorized: false,
    };
}

async function resolveCasTelemetryFromDraft(params: {
    draftUrl: string;
    actorUid: string;
    fallbackFilename: string;
    knownSha256?: string;
    knownOriginalBytes?: number;
    knownOptimizedBytes?: number;
    knownSavingsPct?: number;
}): Promise<{
    downloadUrl: string;
    sha256: string;
    originalBytes: number;
    optimizedBytes: number;
    savingsPct: number;
}> {
    const cleanUrl = (params.draftUrl || '').trim();
    if (cleanUrl.startsWith('/api/media/blob/symbology/')) {
        const hashMatch = cleanUrl.match(/\/api\/media\/blob\/symbology\/([a-f0-9]{64})\./i);
        const sha256 = (params.knownSha256 || hashMatch?.[1] || '').toLowerCase();
        if (
            typeof params.knownOriginalBytes === 'number' &&
            params.knownOriginalBytes > 0 &&
            typeof params.knownOptimizedBytes === 'number' &&
            params.knownOptimizedBytes > 0
        ) {
            const orig = params.knownOriginalBytes;
            const opt = params.knownOptimizedBytes;
            const pct =
                typeof params.knownSavingsPct === 'number'
                    ? params.knownSavingsPct
                    : orig > 0 && opt < orig
                      ? Number((((orig - opt) / orig) * 100).toFixed(1))
                      : 0;
            return {
                downloadUrl: cleanUrl,
                sha256,
                originalBytes: orig,
                optimizedBytes: opt,
                savingsPct: pct,
            };
        }

        if (sha256) {
            const hit = await CasStorageService.preflightCheck(sha256, 'SYMBOLOGY_MASTER');
            if (hit) {
                return {
                    downloadUrl: hit.downloadUrl,
                    sha256: hit.sha256,
                    originalBytes: hit.originalBytes,
                    optimizedBytes: hit.optimizedBytes,
                    savingsPct: hit.savingsPct ?? 0,
                };
            }
        }

        return {
            downloadUrl: cleanUrl,
            sha256,
            originalBytes: params.knownOriginalBytes || 0,
            optimizedBytes: params.knownOptimizedBytes || 0,
            savingsPct: params.knownSavingsPct || 0,
        };
    }

    // Migración transparente hacia CAS si existía una URL proxy heredada
    const pathParamMatch = cleanUrl.match(/[?&]path=([^&]+)/);
    if (pathParamMatch?.[1]) {
        const legacyPath = decodeURIComponent(pathParamMatch[1]).replace(/^\/+/, '');
        if (
            !legacyPath.includes('..') &&
            (legacyPath.startsWith('assets/symbology/') || legacyPath.startsWith('cas_blobs/symbology/'))
        ) {
            const legacyBlob = await CasStorageService.readCasBlob(legacyPath);
            if (legacyBlob && legacyBlob.buffer.length > 0) {
                const migrated = await digestAndPersistSymbologyBuffer(legacyBlob.buffer, {
                    actorUid: params.actorUid,
                    originalFilename: params.fallbackFilename,
                });
                return {
                    downloadUrl: migrated.downloadUrl,
                    sha256: migrated.sha256,
                    originalBytes: migrated.originalBytes,
                    optimizedBytes: migrated.optimizedBytes,
                    savingsPct: migrated.savingsPct,
                };
            }
        }
    }

    throw new Error('No existe ícono borrador válido en almacenamiento CAS. Ejecute la búsqueda o generación primero.');
}

function extractIsoSearchQuery(isoRef: string): string | null {
    if (!isoRef) return null;
    const iso7010 = isoRef.match(/\b([MWPEF]\d{3})\b/i);
    if (iso7010) return `ISO 7010 ${iso7010[1].toUpperCase()}.svg`;
    const ghs = isoRef.match(/\b(GHS\s*0?[1-9])\b/i);
    if (ghs) return `GHS-pictogram ${ghs[1].toUpperCase().replace(/\s+/g, '')}`;
    const num = isoRef.match(/(?:7000|60417|2575)[-_ ]*(\d{3,4}[A-Za-z]?)/) || isoRef.match(/\b(\d{4})\b/);
    if (num) {
        const prefix = /60417|iec/i.test(isoRef)
            ? 'IEC 60417'
            : /2575/i.test(isoRef)
            ? 'ISO 2575'
            : 'ISO 7000';
        return `${prefix} ${num[1]}`;
    }
    return null;
}

function isValidFilename(f: string): boolean {
    if (!f || f.length < 5 || f.length > 200) return false;
    if (/[{}$`\n\r]/.test(f)) return false;
    if (!/\.(svg|png|jpg|jpeg|webp)$/i.test(f)) return false;
    return true;
}

export function isValidHitlSymbologyWord(word?: string): boolean {
    if (!word) return false;
    // Norma soberana exclusiva GEMINI.md §3.8: únicamente "ACTUALIZAR"
    return word.trim().toUpperCase() === HITL_CONFIRM_KEYWORD;
}

export async function getMasterSymbols(): Promise<MasterSymbologyItem[]> {
    const cached = await getCachedMasterSymbologyIndex();
    const items: MasterSymbologyItem[] = [];
    for (const [docId, rawData] of cached.docsById.entries()) {
        const data = rawData as Omit<MasterSymbologyItem, 'concept_id'> & { created_by?: string };
        if (data.created_by === SYNTHETIC_ADHOC_SYMBOL_AUTHOR) continue;
        items.push({ concept_id: docId, ...data });
    }
    items.sort((a, b) => (a.technical_name_es || '').localeCompare(b.technical_name_es || '', 'es'));
    return items;
}

export async function getPendingSymbols(): Promise<MasterSymbologyItem[]> {
    const snap = await db
        .collection('master_symbology_vault')
        .where('standard_icon_status', '==', 'pendiente_dibujo_humano')
        .get();
    const items: MasterSymbologyItem[] = [];
    snap.forEach((doc) => {
        items.push({ concept_id: doc.id, ...(doc.data() as Omit<MasterSymbologyItem, 'concept_id'>) });
    });
    items.sort((a, b) => (a.technical_name_es || '').localeCompare(b.technical_name_es || '', 'es'));
    return items;
}

export async function addSymbolConcept(
    data: Partial<MasterSymbologyItem>,
    userEmail: string
): Promise<MasterSymbologyItem> {
    const concept_id =
        data.concept_id ||
        data.iso_reference?.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') ||
        data.technical_name_es?.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') ||
        `sym_${Date.now()}`;

    const docRef = db.collection('master_symbology_vault').doc(concept_id);
    const snap = await docRef.get();
    if (snap.exists) {
        throw new Error(`El concepto con ID '${concept_id}' ya existe en el catálogo global.`);
    }

    const newItem: MasterSymbologyItem = {
        concept_id,
        iso_reference: data.iso_reference || 'ISO 7000 Ref-No. No declarado',
        technical_name_es: data.technical_name_es || '[Información técnica no declarada en ficha]',
        technical_name_en: data.technical_name_en || '',
        description_es: data.description_es || '[Información técnica no declarada en ficha]',
        description_en: data.description_en || '',
        critical_color: data.critical_color || 'NONE',
        standard_icon_status: 'pendiente_busqueda',
        brands_variants: {},
        insertion_point_hint: data.insertion_point_hint || '',
        referenced_by_items: data.referenced_by_items || [],
        created_at: new Date().toISOString(),
        created_by: userEmail,
    };

    await docRef.set(newItem);
    invalidateMasterSymbologyCache();
    return newItem;
}

export async function searchIsoIconFromWikimedia(conceptId: string, isoReference: string): Promise<string | null> {
    const docRef = db.collection('master_symbology_vault').doc(conceptId);
    try {
        const docSnap = await docRef.get();
        const conceptData = docSnap.data() || {};
        const nameEs = conceptData.technical_name_es || '';
        const nameEn = conceptData.technical_name_en || '';

        const candidateFilenames: string[] = [];

        // 1. Búsqueda directa en Wikimedia Commons API (priorizando archivos .svg puros)
        const directQuery = extractIsoSearchQuery(isoReference);
        if (directQuery) {
            const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
                directQuery
            )}&srnamespace=6&format=json`;
            try {
                const searchRes = await safeFetchExternal(searchUrl, {
                    headers: WIKI_HEADERS,
                    maxBytes: 2 * 1024 * 1024,
                });
                if (searchRes.ok) {
                    const searchData = (await searchRes.json()) as any;
                    for (const item of searchData.query?.search || []) {
                        if (item.title && String(item.title).startsWith('File:')) {
                            const filename = String(item.title).substring(5);
                            if (isValidFilename(filename)) candidateFilenames.push(filename);
                        }
                    }
                    // Priorizar siempre archivos vectoriales .svg antes que rasters
                    candidateFilenames.sort((a, b) => {
                        const aSvg = a.toLowerCase().endsWith('.svg') ? 0 : 1;
                        const bSvg = b.toLowerCase().endsWith('.svg') ? 0 : 1;
                        return aSvg - bSvg;
                    });
                }
            } catch (err) {
                console.warn('[SymbologyService] Búsqueda directa Wikimedia falló:', err);
            }
        }

        // 2. Fallback con Gemini + Google Search si la consulta numérica no arrojó archivo directo
        if (candidateFilenames.length === 0) {
            const prompt = `Eres un especialista en simbología industrial normalizada (ISO 7000, ISO 3864, IEC 60417).
Identifica hasta 3 nombres de archivos exactos existentes en Wikimedia Commons para:
- Referencia Normativa: "${isoReference}"
- Nombre Técnico (ES): "${nameEs}"
- Nombre Técnico (EN): "${nameEn}"

Usa Google Search. Devuelve ÚNICAMENTE hasta 3 nombres de archivo exactos (ej. "ISO 7000 - Ref-No 0246.svg"), uno por línea, o "NOT_FOUND" si no existe ninguno verificado.`;

            const aiRes = await ResilientAIClient.generate({
                module: 'opermaq',
                preferredTier: 'SECONDARY',
                temperature: 0,
                useGoogleSearch: true,
                prompt,
            });

            for (const rawLine of aiRes.text.split('\n')) {
                const line = rawLine
                    .trim()
                    .replace(/```/g, '')
                    .replace(/["'`]/g, '')
                    .replace(/^(file|archivo):/i, '')
                    .trim();
                if (!line || line.toLowerCase().includes('not_found')) continue;
                if (isValidFilename(line)) candidateFilenames.push(line);
            }
        }

        if (candidateFilenames.length === 0) {
            await docRef.update({
                standard_icon_status: 'pendiente_dibujo_humano',
                temp_icon_candidates: admin.firestore.FieldValue.delete(),
                updated_at: new Date().toISOString(),
            });
            return null;
        }

        const candidates: Array<{
            url: string;
            source_filename: string;
            cas_sha256: string;
            original_bytes: number;
            optimized_bytes: number;
            savings_pct: number;
        }> = [];

        for (let i = 0; i < candidateFilenames.slice(0, 3).length; i++) {
            const filename = candidateFilenames[i];
            const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(
                `File:${filename}`
            )}&prop=imageinfo&iiprop=url|mime&iiurlwidth=512&format=json`;

            try {
                const wikiRes = await safeFetchExternal(apiUrl, {
                    headers: WIKI_HEADERS,
                    maxBytes: 2 * 1024 * 1024,
                });
                if (!wikiRes.ok) continue;
                const wikiData = (await wikiRes.json()) as any;
                const page = Object.values(wikiData.query?.pages || {})[0] as any;
                if (!page || page.missing !== undefined || !page.imageinfo?.[0]) continue;

                const imgInfo = page.imageinfo[0];
                const isSvgSource =
                    String(imgInfo.mime || '').includes('svg') || filename.toLowerCase().endsWith('.svg');
                // NUNCA degradar un .svg original a miniatura PNG de 256px: descargar el .svg vectorial puro
                const targetDownloadUrl = isSvgSource ? imgInfo.url : imgInfo.thumburl || imgInfo.url;
                if (!targetDownloadUrl) continue;

                const downloadRes = await safeFetchExternal(targetDownloadUrl, {
                    headers: WIKI_HEADERS,
                    maxBytes: 12 * 1024 * 1024,
                });
                if (!downloadRes.ok) continue;

                const buffer = Buffer.from(await downloadRes.arrayBuffer());
                if (buffer.length < 120) continue;

                const casRes = await digestAndPersistSymbologyBuffer(buffer, {
                    actorUid: isSvgSource ? 'wikimedia-svg-harvester' : 'wikimedia-raster-harvester',
                    originalFilename: filename,
                    preferVectorizeRaster: !isSvgSource,
                });

                candidates.push({
                    url: casRes.downloadUrl,
                    source_filename: casRes.wasVectorized ? `${filename} (Vectorizado SVG)` : filename,
                    cas_sha256: casRes.sha256,
                    original_bytes: casRes.originalBytes,
                    optimized_bytes: casRes.optimizedBytes,
                    savings_pct: casRes.savingsPct,
                });
            } catch (candErr) {
                console.warn(`[SymbologyService] Error procesando candidato ${filename}:`, candErr);
            }
        }

        if (candidates.length === 0) {
            await docRef.update({
                standard_icon_status: 'pendiente_dibujo_humano',
                temp_icon_candidates: admin.firestore.FieldValue.delete(),
                updated_at: new Date().toISOString(),
            });
            return null;
        }

        const primary = candidates[0];
        await docRef.update({
            temp_icon_candidates: candidates,
            temp_standard_icon_url: primary.url,
            temp_cas_sha256: primary.cas_sha256,
            temp_original_bytes: primary.original_bytes,
            temp_optimized_bytes: primary.optimized_bytes,
            temp_savings_pct: primary.savings_pct,
            standard_icon_status: 'pendiente_confirmacion_humana',
            updated_at: new Date().toISOString(),
        });

        return primary.url;
    } catch (err) {
        console.error(`[SymbologyService] Falló búsqueda Wikimedia para ${conceptId}:`, err);
        await docRef
            .update({
                standard_icon_status: 'pendiente_dibujo_humano',
                updated_at: new Date().toISOString(),
            })
            .catch(() => {});
        return null;
    }
}

export const searchIsoIconCandidates = searchIsoIconFromWikimedia;

export async function drawStandardIcon(
    conceptId: string,
    candidateIndex: number,
    userEmail: string
): Promise<string> {
    const docRef = db.collection('master_symbology_vault').doc(conceptId);
    const snap = await docRef.get();
    if (!snap.exists) throw new Error(`El concepto '${conceptId}' no existe.`);
    const concept = snap.data() as MasterSymbologyItem;

    const referenceFilename = concept.temp_icon_candidates?.[candidateIndex]?.source_filename || '';

    const promptRes = await ResilientAIClient.generate({
        module: 'opermaq',
        preferredTier: 'ANCHOR_HA',
        temperature: 0.1,
        prompt: `Write a concise English visual prompt for Imagen 4.0 to draw a flat, high-contrast ISO 7000 industrial machine dashboard pictogram:
- Technical Name: "${concept.technical_name_es}"
- ISO Reference: "${concept.iso_reference}"
- Meaning: "${concept.description_es}"
${referenceFilename ? `- Reference symbol: "${referenceFilename}"` : ''}
Rules: Pure solid white background (#FFFFFF), clean flat black geometric ISO 7000 vector-style icon (or standard ISO critical safety color if applicable: ${concept.critical_color}), centered, zero text, zero letters, zero numbers, zero watermarks. Reply ONLY with the English prompt.`,
    });

    const imageOut = await ResilientAIClient.generateTechnicalImage({
        prompt: promptRes.text.trim(),
        aspectRatio: '1:1',
        outputMimeType: 'image/png',
    });

    const buffer = Buffer.from(imageOut.base64Data, 'base64');
    const casRes = await digestAndPersistSymbologyBuffer(buffer, {
        actorUid: userEmail,
        originalFilename: `${conceptId}_standard_draft.png`,
        preferVectorizeRaster: true,
    });

    await docRef.update({
        temp_standard_icon_url: casRes.downloadUrl,
        temp_cas_sha256: casRes.sha256,
        temp_original_bytes: casRes.originalBytes,
        temp_optimized_bytes: casRes.optimizedBytes,
        temp_savings_pct: casRes.savingsPct,
        ...(casRes.svgInline ? { temp_svg_inline: casRes.svgInline } : {}),
        temp_icon_candidates: admin.firestore.FieldValue.delete(),
        standard_icon_status: 'pendiente_confirmacion_humana',
        updated_at: new Date().toISOString(),
    });

    return casRes.downloadUrl;
}

export async function registerStandardIcon(
    conceptId: string,
    userEmail: string,
    confirmWord: string
): Promise<MasterSymbologyItem> {
    if (!isValidHitlSymbologyWord(confirmWord)) {
        throw new Error('CONFIRM_WORD_MISMATCH: Debe ingresar "ACTUALIZAR" para confirmar el registro.');
    }

    const docRef = db.collection('master_symbology_vault').doc(conceptId);
    const snap = await docRef.get();
    if (!snap.exists) throw new Error(`Concepto '${conceptId}' no encontrado.`);
    const currentData = snap.data() || {};

    const draftUrl = typeof currentData.temp_standard_icon_url === 'string' ? currentData.temp_standard_icon_url : '';
    if (!draftUrl) {
        throw new Error('No existe ícono borrador en CAS. Ejecute la búsqueda o redibujo primero.');
    }

    const matchedCandidate = Array.isArray(currentData.temp_icon_candidates)
        ? currentData.temp_icon_candidates.find((c: any) => c?.url === draftUrl)
        : undefined;

    const consolidated = await resolveCasTelemetryFromDraft({
        draftUrl,
        actorUid: userEmail,
        fallbackFilename: `${conceptId}_standard`,
        knownSha256: matchedCandidate?.cas_sha256 || currentData.temp_cas_sha256,
        knownOriginalBytes: matchedCandidate?.original_bytes ?? currentData.temp_original_bytes,
        knownOptimizedBytes: matchedCandidate?.optimized_bytes ?? currentData.temp_optimized_bytes,
        knownSavingsPct: matchedCandidate?.savings_pct ?? currentData.temp_savings_pct,
    });

    await docRef.update({
        standard_icon_url: consolidated.downloadUrl,
        cas_sha256: consolidated.sha256,
        original_bytes: consolidated.originalBytes,
        optimized_bytes: consolidated.optimizedBytes,
        savings_pct: consolidated.savingsPct,
        ...(typeof currentData.temp_svg_inline === 'string' && currentData.temp_svg_inline
            ? { svg_inline: currentData.temp_svg_inline }
            : {}),
        temp_standard_icon_url: admin.firestore.FieldValue.delete(),
        temp_icon_candidates: admin.firestore.FieldValue.delete(),
        temp_cas_sha256: admin.firestore.FieldValue.delete(),
        temp_original_bytes: admin.firestore.FieldValue.delete(),
        temp_optimized_bytes: admin.firestore.FieldValue.delete(),
        temp_savings_pct: admin.firestore.FieldValue.delete(),
        temp_svg_inline: admin.firestore.FieldValue.delete(),
        standard_icon_status: 'encontrado',
        verified_by: userEmail,
        updated_at: new Date().toISOString(),
    });
    invalidateMasterSymbologyCache();

    const updated = await docRef.get();
    return { concept_id: updated.id, ...(updated.data() as Omit<MasterSymbologyItem, 'concept_id'>) };
}

export async function generateBrandVariant(
    conceptId: string,
    brand: string,
    userEmail: string
): Promise<{
    temp_storage_url: string;
    cas_sha256: string;
    original_bytes: number;
    optimized_bytes: number;
    savings_pct: number;
}> {
    const normBrand = brand.toLowerCase().trim();
    const docRef = db.collection('master_symbology_vault').doc(conceptId);
    const snap = await docRef.get();
    if (!snap.exists) throw new Error(`Concepto '${conceptId}' no encontrado.`);
    const concept = snap.data() as MasterSymbologyItem;

    const promptRes = await ResilientAIClient.generate({
        module: 'opermaq',
        preferredTier: 'ANCHOR_HA',
        temperature: 0.1,
        prompt: `Write a concise English visual prompt for Imagen 4.0 to draw a flat OEM instrument panel warning/indicator icon in the visual style of "${brand}":
- Technical Symbol: "${concept.technical_name_es}" (${concept.iso_reference})
- Meaning: "${concept.description_es}"
Rules: Solid white background (#FFFFFF), clean flat industrial pictogram, zero text, zero brand logos, zero letters, centered. Reply ONLY with the English prompt.`,
    });

    const imageOut = await ResilientAIClient.generateTechnicalImage({
        prompt: promptRes.text.trim(),
        aspectRatio: '1:1',
        outputMimeType: 'image/png',
    });

    const buffer = Buffer.from(imageOut.base64Data, 'base64');
    const casRes = await digestAndPersistSymbologyBuffer(buffer, {
        actorUid: userEmail,
        originalFilename: `${conceptId}_${normBrand}_draft.png`,
        preferVectorizeRaster: true,
    });

    const variantObj: Partial<MasterSymbologyVariant> & {
        cas_sha256: string;
        original_bytes: number;
        optimized_bytes: number;
        savings_pct: number;
    } = {
        verified_by_human: false,
        temp_storage_url: casRes.downloadUrl,
        cas_sha256: casRes.sha256,
        original_bytes: casRes.originalBytes,
        optimized_bytes: casRes.optimizedBytes,
        savings_pct: casRes.savingsPct,
        style_notes: `Borrador generado y consolidado en CAS para fabricante ${brand}.`,
    };

    await docRef.update({
        [`brands_variants.${normBrand}`]: variantObj,
        updated_at: new Date().toISOString(),
    });

    return {
        temp_storage_url: casRes.downloadUrl,
        cas_sha256: casRes.sha256,
        original_bytes: casRes.originalBytes,
        optimized_bytes: casRes.optimizedBytes,
        savings_pct: casRes.savingsPct,
    };
}

export async function registerBrandVariant(
    conceptId: string,
    brand: string,
    userEmail: string,
    confirmWord: string
): Promise<MasterSymbologyItem> {
    if (!isValidHitlSymbologyWord(confirmWord)) {
        throw new Error('CONFIRM_WORD_MISMATCH: Debe ingresar "ACTUALIZAR" para confirmar el registro.');
    }

    const normBrand = brand.toLowerCase().trim();
    const docRef = db.collection('master_symbology_vault').doc(conceptId);
    const snap = await docRef.get();
    if (!snap.exists) throw new Error(`Concepto '${conceptId}' no encontrado.`);

    const currentData = snap.data() || {};
    const currentVariant = (currentData.brands_variants || {})[normBrand] || {};
    const draftUrl = typeof currentVariant.temp_storage_url === 'string' ? currentVariant.temp_storage_url : '';
    if (!draftUrl) {
        throw new Error(`No existe borrador temporal en CAS para la marca '${brand}'.`);
    }

    const consolidated = await resolveCasTelemetryFromDraft({
        draftUrl,
        actorUid: userEmail,
        fallbackFilename: `${conceptId}_${normBrand}`,
        knownSha256: currentVariant.cas_sha256,
        knownOriginalBytes: currentVariant.original_bytes,
        knownOptimizedBytes: currentVariant.optimized_bytes,
        knownSavingsPct: currentVariant.savings_pct,
    });

    const updatedVariant: MasterSymbologyVariant & {
        cas_sha256: string;
        original_bytes: number;
        optimized_bytes: number;
        savings_pct: number;
    } = {
        verified_by_human: true,
        verified_by: userEmail,
        verified_at: new Date().toISOString(),
        asset_storage_url: consolidated.downloadUrl,
        cas_sha256: consolidated.sha256,
        original_bytes: consolidated.originalBytes,
        optimized_bytes: consolidated.optimizedBytes,
        savings_pct: consolidated.savingsPct,
        style_notes: `Variante verificada en CAS para ${brand}.`,
    };

    await docRef.update({
        [`brands_variants.${normBrand}`]: updatedVariant,
        updated_at: new Date().toISOString(),
    });
    invalidateMasterSymbologyCache();

    const updated = await docRef.get();
    return { concept_id: updated.id, ...(updated.data() as Omit<MasterSymbologyItem, 'concept_id'>) };
}

export async function uploadManualVariant(
    conceptId: string,
    brand: string,
    buffer: Buffer,
    userEmail: string,
    confirmWord: string
): Promise<MasterSymbologyItem> {
    if (!isValidHitlSymbologyWord(confirmWord)) {
        throw new Error('CONFIRM_WORD_MISMATCH: Debe ingresar "ACTUALIZAR" para confirmar el registro.');
    }

    const normBrand = brand.toLowerCase().trim();
    const docRef = db.collection('master_symbology_vault').doc(conceptId);
    const snap = await docRef.get();
    if (!snap.exists) throw new Error(`Concepto '${conceptId}' no encontrado.`);

    const casRes = await digestAndPersistSymbologyBuffer(buffer, {
        actorUid: userEmail,
        originalFilename: `${conceptId}_${normBrand}`,
        preferVectorizeRaster: true,
    });

    const updatedVariant: MasterSymbologyVariant & {
        cas_sha256: string;
        original_bytes: number;
        optimized_bytes: number;
        savings_pct: number;
    } = {
        verified_by_human: true,
        verified_by: userEmail,
        verified_at: new Date().toISOString(),
        asset_storage_url: casRes.downloadUrl,
        cas_sha256: casRes.sha256,
        original_bytes: casRes.originalBytes,
        optimized_bytes: casRes.optimizedBytes,
        savings_pct: casRes.savingsPct,
        style_notes: 'Variante OEM optimizada y consolidada en CAS.',
    };

    await docRef.update({
        [`brands_variants.${normBrand}`]: updatedVariant,
        updated_at: new Date().toISOString(),
    });
    invalidateMasterSymbologyCache();

    const updated = await docRef.get();
    return { concept_id: updated.id, ...(updated.data() as Omit<MasterSymbologyItem, 'concept_id'>) };
}

export async function uploadStandardIcon(
    conceptId: string,
    buffer: Buffer,
    userEmail: string,
    confirmWord?: string
): Promise<MasterSymbologyItem> {
    if (confirmWord !== undefined && !isValidHitlSymbologyWord(confirmWord)) {
        throw new Error('CONFIRM_WORD_MISMATCH: Debe ingresar "ACTUALIZAR" para confirmar el registro.');
    }

    const docRef = db.collection('master_symbology_vault').doc(conceptId);
    const snap = await docRef.get();
    if (!snap.exists) throw new Error(`Concepto '${conceptId}' no encontrado.`);

    const casRes = await digestAndPersistSymbologyBuffer(buffer, {
        actorUid: userEmail,
        originalFilename: `${conceptId}_standard`,
        preferVectorizeRaster: true,
    });

    await docRef.update({
        standard_icon_url: casRes.downloadUrl,
        cas_sha256: casRes.sha256,
        original_bytes: casRes.originalBytes,
        optimized_bytes: casRes.optimizedBytes,
        savings_pct: casRes.savingsPct,
        ...(casRes.svgInline ? { svg_inline: casRes.svgInline } : {}),
        temp_standard_icon_url: admin.firestore.FieldValue.delete(),
        temp_icon_candidates: admin.firestore.FieldValue.delete(),
        standard_icon_status: 'encontrado',
        verified_by: userEmail,
        updated_at: new Date().toISOString(),
    });
    invalidateMasterSymbologyCache();

    const updated = await docRef.get();
    return { concept_id: updated.id, ...(updated.data() as Omit<MasterSymbologyItem, 'concept_id'>) };
}

export async function uploadCustomStandardIcon(
    conceptId: string,
    buffer: Buffer,
    userEmail: string,
    confirmWord: string
): Promise<MasterSymbologyItem> {
    if (!isValidHitlSymbologyWord(confirmWord)) {
        throw new Error('CONFIRM_WORD_MISMATCH: Debe ingresar "ACTUALIZAR" para confirmar el registro.');
    }
    return uploadStandardIcon(conceptId, buffer, userEmail, confirmWord);
}

export async function downloadSymbologyAssetBuffer(gcsPath: string): Promise<{ buffer: Buffer; contentType: string }> {
    const safePath = gcsPath.replace(/^\/+/, '');
    if (
        safePath.includes('..') ||
        (!safePath.startsWith('assets/symbology/') && !safePath.startsWith('cas_blobs/symbology/'))
    ) {
        const err: any = new Error('Ruta de activo de simbología no permitida.');
        err.statusCode = 403;
        throw err;
    }

    const blob = await CasStorageService.readCasBlob(safePath);
    if (!blob) {
        const err: any = new Error('Imagen no encontrada en almacenamiento CAS.');
        err.statusCode = 404;
        throw err;
    }

    return {
        buffer: blob.buffer,
        contentType: blob.contentType || 'image/png',
    };
}

