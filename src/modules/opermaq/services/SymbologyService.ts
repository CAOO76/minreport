import admin, { db, storage } from '../../../config/firebase';
import { env } from '../../../config/env';
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
import {
    ensureUniversalSymbologySeeded,
    vectorizeRasterSymbolToSvg,
} from './UniversalSymbologySeedService';

/**
 * SYMBOLOGY SERVICE — BÓVEDA GLOBAL DE SIMBOLOGÍA ISO 7000 / IEC 60417 (Etapa 4)
 *
 * Pipeline:
 * 1. Búsqueda directa en API pública de Wikimedia Commons + fallback Gemini con Google Search.
 * 2. Descarga y almacenamiento en Cloud Storage (`southamerica-west1` / Storage Emulator `:9195`).
 * 3. Redibujo vectorial limpio con Imagen 4.0 (`ResilientAIClient.generateTechnicalImage`) para ícono estándar o variante OEM.
 * 4. Confirmación humana obligatoria (`"ACTUALIZAR"`, estándar `GEMINI.md` §3.8).
 */

const WIKI_HEADERS = {
    'User-Agent': 'MINREPORT-OPERMAQ-Symbology/3.0 (https://minreport-access.web.app)',
};

function getBucket() {
    return storage.bucket(env.STORAGE_BUCKET);
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

        const bucket = getBucket();
        const candidates: Array<{ url: string; source_filename: string }> = [];

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

                if (isSvgSource) {
                    const digestedSvg = await MediaDigestorServer.digestSvg(buffer);
                    const cas = await CasStorageService.persistDigestedBinary(digestedSvg, {
                        scope: 'SYMBOLOGY_MASTER',
                        actorUid: 'wikimedia-svg-harvester',
                        originalFilename: filename,
                    });
                    // Además dejar copia compatible en ruta temporal tradicional por si registerStandardIcon se invoca
                    const tempGcsPath = `assets/symbology/${conceptId}/standard_temp_${i}.svg`;
                    await bucket.file(tempGcsPath).save(digestedSvg.buffer, {
                        contentType: 'image/svg+xml',
                    });
                    candidates.push({ url: cas.downloadUrl, source_filename: filename });
                } else {
                    // Vectorizar raster automáticamente con vtracer WASM hacia SVG escalable
                    try {
                        const vectorized = await vectorizeRasterSymbolToSvg(buffer);
                        const tempGcsPath = `assets/symbology/${conceptId}/standard_temp_${i}.svg`;
                        await bucket.file(tempGcsPath).save(Buffer.from(vectorized.svgString, 'utf8'), {
                            contentType: 'image/svg+xml',
                        });
                        candidates.push({ url: vectorized.descriptorUrl, source_filename: `${filename} (Vectorizado SVG)` });
                    } catch {
                        const digestedImg = await MediaDigestorServer.digestImage(buffer, 'IMAGE_ISO_SYMBOL');
                        const cas = await CasStorageService.persistDigestedBinary(digestedImg, {
                            scope: 'SYMBOLOGY_MASTER',
                            actorUid: 'wikimedia-raster-harvester',
                            originalFilename: filename,
                        });
                        const tempGcsPath = `assets/symbology/${conceptId}/standard_temp_${i}.png`;
                        await bucket.file(tempGcsPath).save(digestedImg.buffer, {
                            contentType: digestedImg.mimeType,
                        });
                        candidates.push({ url: cas.downloadUrl, source_filename: filename });
                    }
                }
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

        await docRef.update({
            temp_icon_candidates: candidates,
            temp_standard_icon_url: candidates[0].url,
            standard_icon_status: 'pendiente_confirmacion_humana',
            updated_at: new Date().toISOString(),
        });

        return candidates[0].url;
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
    const bucket = getBucket();
    const tempGcsPath = `assets/symbology/${conceptId}/standard_temp.png`;
    await bucket.file(tempGcsPath).save(buffer, {
        contentType: imageOut.mimeType,
        metadata: { metadata: { conceptId, generatedBy: userEmail } },
    });

    const tempUrl = `/api/public/simbologia/image-proxy?path=${encodeURIComponent(tempGcsPath)}&t=${Date.now()}`;

    await docRef.update({
        temp_standard_icon_url: tempUrl,
        temp_icon_candidates: admin.firestore.FieldValue.delete(),
        standard_icon_status: 'pendiente_confirmacion_humana',
        updated_at: new Date().toISOString(),
    });

    return tempUrl;
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

    // Si ya cuenta con URL CAS vectorial en `temp_standard_icon_url`, consolidar directamente
    if (
        typeof currentData.temp_standard_icon_url === 'string' &&
        currentData.temp_standard_icon_url.startsWith('/api/media/blob/symbology/')
    ) {
        await docRef.update({
            standard_icon_url: currentData.temp_standard_icon_url,
            temp_standard_icon_url: admin.firestore.FieldValue.delete(),
            temp_icon_candidates: admin.firestore.FieldValue.delete(),
            standard_icon_status: 'encontrado',
            verified_by: userEmail,
            updated_at: new Date().toISOString(),
        });
        invalidateMasterSymbologyCache();
        const updatedDirect = await docRef.get();
        return {
            concept_id: updatedDirect.id,
            ...(updatedDirect.data() as Omit<MasterSymbologyItem, 'concept_id'>),
        };
    }

    const bucket = getBucket();
    const tempFile = bucket.file(`assets/symbology/${conceptId}/standard_temp.png`);
    const finalGcsPath = `assets/symbology/${conceptId}/standard.png`;
    const finalFile = bucket.file(finalGcsPath);

    const [exists] = await tempFile.exists();
    if (!exists) {
        throw new Error('No existe ícono temporal en Storage. Ejecute la búsqueda o redibujo primero.');
    }

    await tempFile.move(finalFile);
    const permanentUrl = `/api/public/simbologia/image-proxy?path=${encodeURIComponent(finalGcsPath)}`;

    await docRef.update({
        standard_icon_url: permanentUrl,
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

export async function generateBrandVariant(
    conceptId: string,
    brand: string,
    userEmail: string
): Promise<{ temp_storage_url: string }> {
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
    const bucket = getBucket();
    const tempGcsPath = `assets/symbology/${conceptId}/${normBrand}_temp.png`;
    await bucket.file(tempGcsPath).save(buffer, {
        contentType: imageOut.mimeType,
        metadata: { metadata: { conceptId, brand: normBrand, generatedBy: userEmail } },
    });

    const tempUrl = `/api/public/simbologia/image-proxy?path=${encodeURIComponent(tempGcsPath)}&t=${Date.now()}`;
    const variantObj: Partial<MasterSymbologyVariant> = {
        verified_by_human: false,
        temp_storage_url: tempUrl,
        style_notes: `Borrador generado para fabricante ${brand}.`,
    };

    await docRef.update({
        [`brands_variants.${normBrand}`]: variantObj,
        updated_at: new Date().toISOString(),
    });

    return { temp_storage_url: tempUrl };
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

    const bucket = getBucket();
    const tempFile = bucket.file(`assets/symbology/${conceptId}/${normBrand}_temp.png`);
    const finalGcsPath = `assets/symbology/${conceptId}/${normBrand}.png`;
    const finalFile = bucket.file(finalGcsPath);

    const [exists] = await tempFile.exists();
    if (!exists) throw new Error(`No existe borrador temporal para la marca '${brand}'.`);

    await tempFile.move(finalFile);
    const permanentUrl = `/api/public/simbologia/image-proxy?path=${encodeURIComponent(finalGcsPath)}`;

    const updatedVariant: MasterSymbologyVariant = {
        verified_by_human: true,
        verified_by: userEmail,
        verified_at: new Date().toISOString(),
        asset_storage_url: permanentUrl,
        style_notes: `Variante verificada para ${brand}.`,
    };

    await docRef.update({
        [`brands_variants.${normBrand}`]: updatedVariant,
        updated_at: new Date().toISOString(),
    });

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

    const rawTextHead = buffer.subarray(0, 200).toString('utf8');
    const isSvg = /<svg\b/i.test(rawTextHead);

    let permanentUrl: string;
    if (isSvg) {
        const digestedSvg = await MediaDigestorServer.digestSvg(buffer);
        const cas = await CasStorageService.persistDigestedBinary(digestedSvg, {
            scope: 'SYMBOLOGY_MASTER',
            actorUid: userEmail,
            originalFilename: `${conceptId}_${normBrand}.svg`,
        });
        permanentUrl = cas.downloadUrl;
    } else {
        try {
            const vectorized = await vectorizeRasterSymbolToSvg(buffer);
            permanentUrl = vectorized.descriptorUrl;
        } catch {
            const digestedImg = await MediaDigestorServer.digestImage(buffer, 'IMAGE_ISO_SYMBOL');
            const cas = await CasStorageService.persistDigestedBinary(digestedImg, {
                scope: 'SYMBOLOGY_MASTER',
                actorUid: userEmail,
                originalFilename: `${conceptId}_${normBrand}.webp`,
            });
            permanentUrl = cas.downloadUrl;
        }
    }

    const updatedVariant: MasterSymbologyVariant = {
        verified_by_human: true,
        verified_by: userEmail,
        verified_at: new Date().toISOString(),
        asset_storage_url: permanentUrl,
        style_notes: 'Variante OEM optimizada y vectorizada en CAS.',
    };

    await docRef.update({
        [`brands_variants.${normBrand}`]: updatedVariant,
        updated_at: new Date().toISOString(),
    });

    const updated = await docRef.get();
    return { concept_id: updated.id, ...(updated.data() as Omit<MasterSymbologyItem, 'concept_id'>) };
}

export async function uploadStandardIcon(
    conceptId: string,
    buffer: Buffer,
    userEmail: string
): Promise<MasterSymbologyItem> {
    const docRef = db.collection('master_symbology_vault').doc(conceptId);
    const snap = await docRef.get();
    if (!snap.exists) throw new Error(`Concepto '${conceptId}' no encontrado.`);

    const rawTextHead = buffer.subarray(0, 200).toString('utf8');
    const isSvg = /<svg\b/i.test(rawTextHead);

    let permanentUrl: string;
    let svgInline: string | undefined;
    if (isSvg) {
        const digestedSvg = await MediaDigestorServer.digestSvg(buffer);
        svgInline = digestedSvg.buffer.toString('utf8');
        const cas = await CasStorageService.persistDigestedBinary(digestedSvg, {
            scope: 'SYMBOLOGY_MASTER',
            actorUid: userEmail,
            originalFilename: `${conceptId}_standard.svg`,
        });
        permanentUrl = cas.downloadUrl;
    } else {
        try {
            const vectorized = await vectorizeRasterSymbolToSvg(buffer);
            permanentUrl = vectorized.descriptorUrl;
            svgInline = vectorized.svgString.length <= 24000 ? vectorized.svgString : undefined;
        } catch {
            const digestedImg = await MediaDigestorServer.digestImage(buffer, 'IMAGE_ISO_SYMBOL');
            const cas = await CasStorageService.persistDigestedBinary(digestedImg, {
                scope: 'SYMBOLOGY_MASTER',
                actorUid: userEmail,
                originalFilename: `${conceptId}_standard.webp`,
            });
            permanentUrl = cas.downloadUrl;
        }
    }

    await docRef.update({
        standard_icon_url: permanentUrl,
        ...(svgInline ? { svg_inline: svgInline } : {}),
        standard_icon_status: 'encontrado',
        verified_by: userEmail,
        updated_at: new Date().toISOString(),
    });
    invalidateMasterSymbologyCache();

    const updated = await docRef.get();
    return { concept_id: updated.id, ...(updated.data() as Omit<MasterSymbologyItem, 'concept_id'>) };
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
    const file = getBucket().file(safePath);
    const [exists] = await file.exists();
    if (!exists) {
        const err: any = new Error('Imagen no encontrada en Storage.');
        err.statusCode = 404;
        throw err;
    }
    const [metadata] = await file.getMetadata();
    const [buffer] = await file.download();
    return {
        buffer,
        contentType: metadata.contentType || 'image/png',
    };
}

