import { auth } from '../config/firebase.config';
import { getApiUrl } from '../../../utils/network';
import { idbStorage, sanitizeStockpileTenantPrefix } from '../utils/indexedDB';
import { dataService } from './DataService';

export type Granulometry = 'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS';

export interface VisionSuggestion {
    verified: boolean;
    granulometry: Granulometry | null;
    confidence: number | null;
    reasoning: string;
    suggestedFactor: number | null;
}

/**
 * VisionIAService - Motor Industrial de Análisis Granulométrico (Enjambre Resiliente Gemini AI — Capa 4 MINREPORT)
 * Procesa texturas pétreas, bordes de colpas y curvas granulométricas mediante `/api/ai/inference`
 * sin exponer llaves de API en el navegador y con tolerancia cero a datos inventados en modo offline.
 */
export class VisionIAService {
    /**
     * Comprime un DataURL de imagen antes de transmitirlo al endpoint de inferencia,
     * liberando explícitamente la memoria de `<canvas>` (`width = 0; height = 0`) en `finally`.
     */
    private async compressImageDataUrl(dataUrl: string, maxDim = 1024, quality = 0.75): Promise<{ base64: string; mimeType: string }> {
        if (typeof document === 'undefined' || !dataUrl.startsWith('data:image')) {
            const parts = dataUrl.split(',');
            const mime = parts[0]?.split(';')[0]?.replace('data:', '') || 'image/jpeg';
            return { base64: parts[1] || '', mimeType: mime };
        }

        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                try {
                    let { width, height } = img;
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
                        const mimeType = header.split(';')[0].replace('data:', '') || 'image/webp';
                        resolve({ base64: base64 || '', mimeType });
                        return;
                    }
                } catch {
                    // Fallback al dataUrl original
                } finally {
                    canvas.width = 0;
                    canvas.height = 0;
                }
                const parts = dataUrl.split(',');
                const mime = parts[0]?.split(';')[0]?.replace('data:', '') || 'image/jpeg';
                resolve({ base64: parts[1] || '', mimeType: mime });
            };
            img.onerror = () => {
                const parts = dataUrl.split(',');
                const mime = parts[0]?.split(';')[0]?.replace('data:', '') || 'image/jpeg';
                resolve({ base64: parts[1] || '', mimeType: mime });
            };
            img.src = dataUrl;
        });
    }

    /**
     * Analiza una imagen o fotograma de acopio utilizando el Enjambre Gemini AI (`/api/ai/inference`).
     * Si no hay red o falla el motor de inferencia, devuelve `verified: false` sin inventar valores.
     */
    public async analyzeTexture(imageData: string): Promise<VisionSuggestion> {
        if (typeof imageData === 'string' && imageData.startsWith('data:image') && navigator.onLine) {
            try {
                const token = await auth?.currentUser?.getIdToken();
                const { base64, mimeType } = await this.compressImageDataUrl(imageData);

                const prompt = [
                    'Actúa como ingeniero geotécnico minero experto en granulometría y cubicación de acopios.',
                    'Analiza la firma granulométrica de la captura adjunta y clasifica la granulometría predominante estrictamente en una de estas categorías:',
                    'COLPAS (bloques >12 pulgadas), GRANSA (fragmentos medianos 2 a 6 pulgadas), MIXTO (matriz heterogénea), o FINOS (arenas, tierras o relaves finos).',
                    'Responde ÚNICAMENTE un objeto JSON válido sin bloques markdown con los campos:',
                    '{"granulometry": "COLPAS" | "GRANSA" | "MIXTO" | "FINOS", "confidence": 0.89, "reasoning": "diagnóstico técnico conciso en español (máx 20 palabras)", "suggestedFactor": 1.78}'
                ].join(' ');

                const headers: Record<string, string> = {
                    'Content-Type': 'application/json'
                };
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                const response = await fetch(getApiUrl('/api/ai/inference'), {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        prompt,
                        module: 'stockpile',
                        thinkingLevel: 'medium',
                        image: {
                            mimeType,
                            data: base64
                        }
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const rawText: string = data.text || data.result || '';
                    if (rawText) {
                        const cleanedJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
                        const parsed = JSON.parse(cleanedJson);
                        if (
                            parsed.granulometry &&
                            ['COLPAS', 'GRANSA', 'MIXTO', 'FINOS'].includes(parsed.granulometry) &&
                            typeof parsed.confidence === 'number'
                        ) {
                            const gran = parsed.granulometry as Granulometry;
                            const factorNum = Number(parsed.suggestedFactor);
                            return {
                                verified: true,
                                granulometry: gran,
                                confidence: Math.min(0.99, Math.max(0.01, Number(parsed.confidence))),
                                reasoning: String(parsed.reasoning || 'Clasificación granulométrica verificada por inferencia multimodal.'),
                                suggestedFactor: Number.isFinite(factorNum) && factorNum > 0 ? factorNum : null
                            };
                        }
                    }
                }
            } catch (err) {
                console.warn('[VisionIA] Motor de inferencia no disponible:', err);
            }
        }

        // Tolerancia cero a datos inventados (GEMINI.md §3.1)
        return {
            verified: false,
            granulometry: null,
            confidence: null,
            reasoning: '[Información técnica no declarada en ficha — Sin conexión a motor de inferencia]',
            suggestedFactor: null
        };
    }

    /**
     * Registra el feedback del operador (HITL) particionado por tenant para calibración continua.
     */
    public async recordOperatorFeedback(
        suggestion: VisionSuggestion,
        accepted: boolean,
        finalGranulometry: Granulometry
    ): Promise<void> {
        if (!suggestion.verified || !suggestion.granulometry) return;

        const safeTenant = sanitizeStockpileTenantPrefix(dataService.getTenantId());
        const key = `sc:${safeTenant}:vision_feedback_loop`;
        const feedback = {
            timestamp: Date.now(),
            suggested: suggestion.granulometry,
            accepted,
            final: finalGranulometry,
            confidence: suggestion.confidence,
            isCorrection: !accepted
        };

        try {
            const history = (await idbStorage.get<unknown[]>(key)) || [];
            history.push(feedback);
            await idbStorage.set(key, history.slice(-50));
        } catch (e) {
            console.warn('[VisionIA] Error persistiendo feedback loop:', e);
        }
    }
}

export const visionIAService = new VisionIAService();
