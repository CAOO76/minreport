import { z } from 'zod';
import { auth } from '../../../../config/firebase';
import { offlineStorage } from '../../../../core/offline/OfflineStorage';
import { getApiUrl } from '../../../../utils/network';
import type { BoulderDetectionBox2D, RosinRammlerProfile } from '../types/GeolappTypes';
import { computeBoxEquivalentDiameterMm, isValidBox2D } from '../utils/rosinRammler';
import { calculationEngine } from './calculation-engine';
import { dataService } from './DataService';
import { storageService } from './StorageService';

export type Granulometry = 'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS';

export interface VisionSuggestion {
    verified: boolean;
    granulometry: Granulometry | null;
    confidence: number | null;
    reasoning: string;
    suggestedFactor: number | null;
    copperObservation?: string | null;
    boulders?: BoulderDetectionBox2D[];
    rosin_rammler?: RosinRammlerProfile;
    p80_mm?: number;
}

export interface AnalyzeGranulometryOptions {
    referenceWidthM?: number;
    oversizeThresholdMm?: number;
}

export interface BoulderCropCasResult {
    cropUrl: string;
    sha256: string;
    originalBytes: number;
    optimizedBytes: number;
    savingsPct: number;
}

const MAX_BOULDER_DETECTIONS = 24;

const VisionInferenceResponseSchema = z.object({
    granulometry: z.enum(['COLPAS', 'GRANSA', 'MIXTO', 'FINOS']),
    confidence: z.number(),
    reasoning: z.string(),
    suggestedFactor: z.number().nullable().optional(),
    copperObservation: z.string().nullable().optional(),
    boulders: z.array(z.unknown()).optional(),
});

function sanitizeTenantPrefix(raw?: string | null): string {
    const cleaned = (raw || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    return cleaned || 'no_tenant';
}

function normalizeConfidenceScore(raw: unknown): number | undefined {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
    const normalized = raw > 1 && raw <= 100 ? raw / 100 : raw;
    return Math.min(0.99, Math.max(0.01, Math.round(normalized * 1000) / 1000));
}

async function computeWebCryptoSha256Hex(blob: Blob): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }
    return `local_${Date.now()}_${blob.size}`;
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob | null> {
    return new Promise((resolve) => {
        try {
            canvas.toBlob((blob) => resolve(blob), mimeType, quality);
        } catch {
            resolve(null);
        }
    });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo decodificar la imagen para procesamiento offscreen.'));
        img.src = src;
    });
}

/**
 * VisionIAService - Motor Industrial de Análisis Geo-Metalúrgico Cu, Detección box_2d y Granulometría RRSB.
 * Consume `/api/ai/inference` con módulo `geolapp`, tolerancia cero a datos inventados en offline
 * y trazabilidad de feedback HITL + recortes CAS en `OfflineStorage` (IndexedDB unificado).
 */
export class VisionIAService {
    private buildOfflineFallbackSuggestion(): VisionSuggestion {
        return {
            verified: false,
            granulometry: null,
            confidence: null,
            reasoning: '[Información técnica no declarada en ficha — Sin conexión a motor de inferencia]',
            suggestedFactor: null,
            copperObservation: null,
        };
    }

    private extractDataUrlParts(dataUrl: string): { base64: string; mimeType: string } {
        if (!dataUrl.startsWith('data:image')) {
            return { base64: '', mimeType: 'image/jpeg' };
        }
        const parts = dataUrl.split(',');
        const mime = parts[0]?.split(';')[0]?.replace('data:', '') || 'image/jpeg';
        return { base64: parts[1] || '', mimeType: mime };
    }

    private async compressImageDataUrl(
        dataUrl: string,
        maxDim = 1024,
        quality = 0.75
    ): Promise<{ base64: string; mimeType: string }> {
        if (typeof document === 'undefined' || (!dataUrl.startsWith('data:image') && !dataUrl.startsWith('blob:'))) {
            return this.extractDataUrlParts(dataUrl);
        }

        try {
            const img = await loadImageElement(dataUrl);
            const canvas = document.createElement('canvas');
            try {
                let width = img.naturalWidth || img.width;
                let height = img.naturalHeight || img.height;
                if (width <= 0 || height <= 0) {
                    return this.extractDataUrlParts(dataUrl);
                }
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0, width, height);
                    const compressed = canvas.toDataURL('image/webp', quality);
                    const [header, base64] = compressed.split(',');
                    const mimeType = header?.split(';')[0]?.replace('data:', '') || 'image/webp';
                    if (base64) {
                        return { base64, mimeType };
                    }
                }
            } finally {
                canvas.width = 0;
                canvas.height = 0;
            }
        } catch {
            // Fallback seguro al dataUrl original
        }

        return this.extractDataUrlParts(dataUrl);
    }

    private async prepareImagePayload(imageInput: string | Blob): Promise<{ base64: string; mimeType: string }> {
        if (typeof imageInput === 'string') {
            if (!imageInput.startsWith('data:image') && !imageInput.startsWith('blob:')) {
                return { base64: '', mimeType: 'image/jpeg' };
            }
            return this.compressImageDataUrl(imageInput);
        }

        if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            const objectUrl = URL.createObjectURL(imageInput);
            try {
                const compressed = await this.compressImageDataUrl(objectUrl);
                if (compressed.base64) return compressed;
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        }

        return { base64: '', mimeType: imageInput.type || 'image/jpeg' };
    }

    private async postGeolappInference(
        prompt: string,
        base64: string,
        mimeType: string
    ): Promise<unknown | null> {
        const devFallbackToken =
            typeof window !== 'undefined'
                ? window.localStorage.getItem('dev_auth_token') ||
                  window.localStorage.getItem('dev_vault_token')
                : null;
        const token = (await auth?.currentUser?.getIdToken().catch(() => null)) || devFallbackToken;

        const rawTenantId =
            dataService.getTenantId() ||
            (typeof window !== 'undefined'
                ? window.localStorage.getItem('minreport_active_account_id') || ''
                : '');
        const tenantId = rawTenantId.trim();

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        if (tenantId) {
            headers['X-Active-Account-Id'] = tenantId;
        }

        const response = await fetch(getApiUrl('/api/ai/inference'), {
            method: 'POST',
            headers,
            body: JSON.stringify({
                prompt,
                module: 'geolapp',
                thinkingLevel: 'medium',
                media: [
                    {
                        mimeType,
                        dataBase64: base64,
                    },
                ],
            }),
        });

        if (!response.ok) return null;

        const data = await response.json();
        const rawText: string = data.text || data.result || '';
        if (!rawText) return null;

        const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        try {
            return JSON.parse(cleaned);
        } catch {
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace) {
                return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
            }
            return null;
        }
    }

    private normalizeBoulders(rawBoulders: unknown, referenceWidthM?: number): BoulderDetectionBox2D[] {
        if (!Array.isArray(rawBoulders)) return [];
        const hasValidScale = typeof referenceWidthM === 'number' && Number.isFinite(referenceWidthM) && referenceWidthM > 0;
        const normalized: BoulderDetectionBox2D[] = [];

        for (const entry of rawBoulders) {
            if (normalized.length >= MAX_BOULDER_DETECTIONS) break;
            if (!entry || typeof entry !== 'object') continue;
            const rawBox = (entry as { box_2d?: unknown }).box_2d;
            if (!isValidBox2D(rawBox)) continue;

            const box2d: [number, number, number, number] = [
                Math.round(rawBox[0] * 100) / 100,
                Math.round(rawBox[1] * 100) / 100,
                Math.round(rawBox[2] * 100) / 100,
                Math.round(rawBox[3] * 100) / 100,
            ];
            if (!isValidBox2D(box2d)) continue;

            const rawLabel = (entry as { label?: unknown }).label;
            const label =
                typeof rawLabel === 'string' && rawLabel.trim().length > 0
                    ? rawLabel.trim().slice(0, 48)
                    : 'COLPA';

            const confidence = normalizeConfidenceScore((entry as { confidence?: unknown }).confidence);

            let estimatedMm: number | undefined;
            if (hasValidScale) {
                const scaled = computeBoxEquivalentDiameterMm(box2d, referenceWidthM as number);
                if (scaled !== null && scaled > 0) {
                    estimatedMm = Math.round(scaled * 10) / 10;
                }
            }

            normalized.push({
                box_2d: box2d,
                label,
                ...(estimatedMm !== undefined ? { estimated_mm: estimatedMm } : {}),
                ...(confidence !== undefined ? { confidence } : {}),
            });
        }

        return normalized;
    }

    public async analyzeTexture(imageData: string): Promise<VisionSuggestion> {
        const isSupportedSource =
            typeof imageData === 'string' &&
            (imageData.startsWith('data:image') || imageData.startsWith('blob:'));

        if (isSupportedSource && typeof navigator !== 'undefined' && navigator.onLine) {
            try {
                const { base64, mimeType } = await this.prepareImagePayload(imageData);
                if (base64 && base64.length >= 4) {
                    const prompt = [
                        'Actua como ingeniero geologo y metalurgista minero experto en acopios (stockpiles) de Cobre (Cu) y granulometria operacional.',
                        'Analiza la firma granulometrica y geo-metalurgica de la captura adjunta de acopio de Cobre (Cu), evaluando fragmentacion, matriz mineral, presencia visual de oxidos cupriferos, sulfuros secundarios/primarios, concentrado, ripios o esteril.',
                        'Clasifica la granulometria predominante estrictamente en una de estas categorias:',
                        'COLPAS (bloques >12 pulgadas), GRANSA (fragmentos medianos 2 a 6 pulgadas), MIXTO (matriz heterogenea), o FINOS (arenas, chancado fino o relaves).',
                        'Si la evidencia visual no permite estimar densidad aparente real con certeza, devuelve suggestedFactor: null.',
                        'Responde UNICAMENTE un objeto JSON valido sin bloques markdown con los campos:',
                        '{"granulometry": "COLPAS" | "GRANSA" | "MIXTO" | "FINOS", "confidence": 0.85, "reasoning": "diagnostico geo-metalurgico y granulometrico conciso en espanol (max 20 palabras)", "suggestedFactor": null, "copperObservation": "observacion visual mineralogica Cu concisa en espanol (max 25 palabras)"}',
                    ].join(' ');

                    const decoded = await this.postGeolappInference(prompt, base64, mimeType);
                    if (decoded) {
                        const validated = VisionInferenceResponseSchema.safeParse(decoded);
                        if (validated.success) {
                            const normalizedConf = normalizeConfidenceScore(validated.data.confidence) ?? 0.5;
                            const factorVal = validated.data.suggestedFactor;
                            const factorNum =
                                typeof factorVal === 'number' && Number.isFinite(factorVal) && factorVal > 0
                                    ? factorVal
                                    : null;
                            const copperObs = validated.data.copperObservation?.trim();

                            return {
                                verified: true,
                                granulometry: validated.data.granulometry,
                                confidence: normalizedConf,
                                reasoning:
                                    validated.data.reasoning.trim() ||
                                    'Clasificacion granulometrica y geo-metalurgica Cu verificada por inferencia multimodal.',
                                suggestedFactor: factorNum,
                                ...(copperObs ? { copperObservation: copperObs } : {}),
                            };
                        }
                    }
                }
            } catch (err) {
                console.warn('[VisionIA] Motor de inferencia no disponible:', err);
            }
        }

        return this.buildOfflineFallbackSuggestion();
    }

    /**
     * Ejecuta análisis granulométrico multimodal con detección de colpas `box_2d` `[ymin, xmin, ymax, xmax]`
     * en escala `0..1000` (máx. 24 cajas válidas) y calcula perfil determinista Rosin-Rammler (`P80`)
     * cuando `referenceWidthM > 0` y existen al menos 2 cajas válidas.
     */
    public async analyzeGranulometryAndBoulders(
        imageInput: string | Blob,
        options?: AnalyzeGranulometryOptions
    ): Promise<VisionSuggestion> {
        const isOnline = typeof navigator !== 'undefined' && navigator.onLine;
        if (!isOnline) {
            return this.buildOfflineFallbackSuggestion();
        }

        try {
            const { base64, mimeType } = await this.prepareImagePayload(imageInput);
            if (!base64 || base64.length < 4) {
                return this.buildOfflineFallbackSuggestion();
            }

            const prompt = [
                'Actua como ingeniero geologo y especialista en fragmentacion minera de Cobre (Cu).',
                'Analiza la fotografia de acopio (stockpile) y detecta hasta 24 fragmentos representativos o colpas visibles con cajas delimitadoras exactas box_2d.',
                'Cada box_2d DEBE usar coordenadas enteras normalizadas [ymin, xmin, ymax, xmax] en rango estricto 0..1000 donde 0 <= ymin < ymax <= 1000 y 0 <= xmin < xmax <= 1000.',
                'Clasifica la granulometria predominante en: COLPAS, GRANSA, MIXTO o FINOS.',
                'Si la evidencia visual no permite estimar densidad aparente real con certeza, devuelve suggestedFactor: null.',
                'Responde UNICAMENTE un objeto JSON valido sin bloques markdown con los campos:',
                '{"granulometry": "COLPAS" | "GRANSA" | "MIXTO" | "FINOS", "confidence": 0.85, "reasoning": "diagnostico granulometrico conciso en espanol (max 20 palabras)", "suggestedFactor": null, "copperObservation": "observacion mineralogica Cu concisa (max 25 palabras)", "boulders": [{"box_2d": [120, 240, 280, 410], "label": "COLPA", "confidence": 0.88}]}',
            ].join(' ');

            const decoded = await this.postGeolappInference(prompt, base64, mimeType);
            if (!decoded) {
                return this.buildOfflineFallbackSuggestion();
            }

            const validated = VisionInferenceResponseSchema.safeParse(decoded);
            if (!validated.success) {
                return this.buildOfflineFallbackSuggestion();
            }

            const normalizedConf = normalizeConfidenceScore(validated.data.confidence) ?? 0.5;
            const factorVal = validated.data.suggestedFactor;
            const factorNum =
                typeof factorVal === 'number' && Number.isFinite(factorVal) && factorVal > 0
                    ? factorVal
                    : null;
            const copperObs = validated.data.copperObservation?.trim();

            const referenceWidthM = options?.referenceWidthM;
            const oversizeThresholdMm = options?.oversizeThresholdMm ?? 250;
            const boulders = this.normalizeBoulders(validated.data.boulders, referenceWidthM);

            let rosinRammlerProfile: RosinRammlerProfile | undefined;
            if (
                typeof referenceWidthM === 'number' &&
                Number.isFinite(referenceWidthM) &&
                referenceWidthM > 0 &&
                boulders.length >= 2
            ) {
                const computed = calculationEngine.computeRosinRammlerFromBoxes(
                    boulders,
                    referenceWidthM,
                    oversizeThresholdMm
                );
                if (computed) {
                    rosinRammlerProfile = computed;
                }
            }

            return {
                verified: true,
                granulometry: validated.data.granulometry,
                confidence: normalizedConf,
                reasoning:
                    validated.data.reasoning.trim() ||
                    'Deteccion granulometrica y de colpas verificada por inferencia multimodal.',
                suggestedFactor: factorNum,
                ...(copperObs ? { copperObservation: copperObs } : {}),
                ...(boulders.length > 0 ? { boulders } : {}),
                ...(rosinRammlerProfile
                    ? { rosin_rammler: rosinRammlerProfile, p80_mm: rosinRammlerProfile.p80_mm }
                    : {}),
            };
        } catch (err) {
            console.warn('[VisionIA] Fallo en analisis granulometrico box_2d:', err);
            return this.buildOfflineFallbackSuggestion();
        }
    }

    /**
     * Recorta una colpa `box_2d` `[ymin, xmin, ymax, xmax]` en `<canvas>` offscreen
     * liberando memoria GPU/RAM (`canvas.width = 0; canvas.height = 0` en `finally`)
     * y consolida la versión optimizada CAS vía `storageService.uploadStockpileImage`.
     */
    public async digestBoulderCropCas(
        sourceBlob: Blob,
        box2d: [number, number, number, number],
        stockpileId: string
    ): Promise<BoulderCropCasResult> {
        if (!isValidBox2D(box2d)) {
            throw new Error('Coordenadas box_2d invalidas para recorte CAS (esperado [ymin, xmin, ymax, xmax] en 0..1000).');
        }
        if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
            throw new Error('Entorno DOM Canvas no disponible para recorte de colpa box_2d.');
        }

        const objectUrl = URL.createObjectURL(sourceBlob);
        const canvas = document.createElement('canvas');
        let croppedBlob: Blob | null = null;

        try {
            const img = await loadImageElement(objectUrl);
            const imgW = img.naturalWidth || img.width;
            const imgH = img.naturalHeight || img.height;
            if (imgW <= 0 || imgH <= 0) {
                throw new Error('Dimensiones de imagen origen invalidas para recorte CAS.');
            }

            const [ymin, xmin, ymax, xmax] = box2d;
            const sx = Math.max(0, Math.floor((xmin / 1000) * imgW));
            const sy = Math.max(0, Math.floor((ymin / 1000) * imgH));
            const ex = Math.min(imgW, Math.ceil((xmax / 1000) * imgW));
            const ey = Math.min(imgH, Math.ceil((ymax / 1000) * imgH));

            const cropW = Math.max(1, ex - sx);
            const cropH = Math.max(1, ey - sy);

            const maxCropDim = 1024;
            let outW = cropW;
            let outH = cropH;
            if (outW > maxCropDim || outH > maxCropDim) {
                const ratio = Math.min(maxCropDim / outW, maxCropDim / outH);
                outW = Math.max(1, Math.round(outW * ratio));
                outH = Math.max(1, Math.round(outH * ratio));
            }

            canvas.width = outW;
            canvas.height = outH;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('No fue posible obtener contexto 2D para recorte offscreen.');
            }
            ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, outW, outH);

            croppedBlob =
                (await canvasToBlob(canvas, 'image/png')) ||
                (await canvasToBlob(canvas, 'image/webp', 0.86));
        } finally {
            canvas.width = 0;
            canvas.height = 0;
            URL.revokeObjectURL(objectUrl);
        }

        if (!croppedBlob || croppedBlob.size <= 0) {
            throw new Error('No se pudo generar el binario recortado de la colpa.');
        }

        const safeStockpileId = sanitizeTenantPrefix(stockpileId);
        const uploaded = await storageService.uploadStockpileImage(croppedBlob, stockpileId, {
            filename: `${safeStockpileId}_boulder_crops_${Date.now()}.webp`,
            format: 'webp',
        });

        const originalBytes = uploaded.originalBytes ?? croppedBlob.size;
        const optimizedBytes = uploaded.optimizedBytes ?? uploaded.size;
        const savingsPct =
            typeof uploaded.savingsPct === 'number' && Number.isFinite(uploaded.savingsPct)
                ? uploaded.savingsPct
                : originalBytes > 0
                  ? Math.max(0, Math.round((1 - optimizedBytes / originalBytes) * 1000) / 10)
                  : 0;
        const sha256 = uploaded.sha256 || (await computeWebCryptoSha256Hex(croppedBlob));

        return {
            cropUrl: uploaded.url,
            sha256,
            originalBytes,
            optimizedBytes,
            savingsPct,
        };
    }

    public async recordOperatorFeedback(
        suggestion: VisionSuggestion,
        accepted: boolean,
        finalGranulometry: Granulometry
    ): Promise<void> {
        if (!suggestion.verified || !suggestion.granulometry) return;

        const safeTenant = sanitizeTenantPrefix(dataService.getTenantId());
        const key = `geolapp:${safeTenant}:vision_feedback_loop`;
        const feedback = {
            timestamp: Date.now(),
            suggested: suggestion.granulometry,
            accepted,
            final: finalGranulometry,
            confidence: suggestion.confidence,
            isCorrection: !accepted,
        };

        try {
            const history = (await offlineStorage.getOfflineMetadata<unknown[]>(key)) || [];
            const nextHistory = Array.isArray(history) ? [...history, feedback].slice(-50) : [feedback];
            await offlineStorage.putOfflineMetadata(key, nextHistory);
        } catch (e) {
            console.warn('[VisionIA] Error persistiendo feedback loop:', e);
        }
    }
}

export const visionIAService = new VisionIAService();
export const visionIA = visionIAService;
