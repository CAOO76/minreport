/**
 * ENJAMBRE GEMINI AI - CLIENTE RESILIENTE UNIVERSAL (Capa 4)
 * Estándar Global CABISEG Web 3.0 / SouthAmerica-West1
 * 
 * Jerarquía de Enjambre (Fallback Automático):
 * 1. Pro (Primario): gemini-1.5-pro (Razonamiento crítico)
 * 2. Flash (Secundario): gemini-1.5-flash (Operativa y velocidad)
 * 3. Flash-Lite (Ancla HA): gemini-1.5-flash-8b (Alta disponibilidad, latencia < 400ms)
 * 
 * Algoritmo Invariante de Retroceso con Jitter:
 * D(n) = min(32s, 2.0s * 2^n) + jitter(0, 1s)
 */

export type ThinkingLevel = 'none' | 'low' | 'medium' | 'high';

export interface AIInferenceOptions {
    prompt: string;
    systemInstruction?: string;
    temperature?: number;
    thinkingLevel?: ThinkingLevel;
    requireHITL?: boolean; // Human-in-the-Loop confirmation required
    module: 'opermaq' | 'stockpile' | 'mining-flow' | 'core';
    tenantId: string;
}

export interface AIInferenceResponse {
    text: string;
    tierUsed: 'PRO' | 'FLASH' | 'FLASH_LITE';
    model: string;
    latencyMs: number;
    retries: number;
    hitlRequired?: boolean;
}

const MODEL_TIERS = [
    { tier: 'PRO' as const, model: 'gemini-1.5-pro' },
    { tier: 'FLASH' as const, model: 'gemini-1.5-flash' },
    { tier: 'FLASH_LITE' as const, model: 'gemini-1.5-flash-8b' }
];

export class ResilientAIClient {
    private static apiKey: string = process.env.GEMINI_API_KEY || '';

    /**
     * Invariante de Retroceso Exponencial con Jitter
     * D(n) = min(32000ms, 2000ms * 2^n) + rand(0, 1000ms)
     */
    private static calculateBackoff(attempt: number): number {
        const baseDelay = Math.min(32000, 2000 * Math.pow(2, attempt));
        const jitter = Math.floor(Math.random() * 1000);
        return baseDelay + jitter;
    }

    private static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Ejecuta inferencia resiliente a través del enjambre
     */
    public static async generate(options: AIInferenceOptions): Promise<AIInferenceResponse> {
        const startTime = Date.now();
        let totalRetries = 0;
        let lastError: any = null;

        for (const tierConfig of MODEL_TIERS) {
            console.log(`[AI-SWARM] Intentando tier: ${tierConfig.tier} (${tierConfig.model})`);

            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const response = await this.callGeminiAPI(tierConfig.model, options);
                    const latencyMs = Date.now() - startTime;

                    console.log(`[AI-SWARM] ✅ Éxito con tier ${tierConfig.tier} en ${latencyMs}ms`);

                    return {
                        text: response,
                        tierUsed: tierConfig.tier,
                        model: tierConfig.model,
                        latencyMs,
                        retries: totalRetries,
                        hitlRequired: options.requireHITL
                    };
                } catch (err: any) {
                    totalRetries++;
                    lastError = err;
                    const isRateLimit = err?.status === 429 || err?.message?.includes('429');
                    const isUnavailable = err?.status === 503 || err?.message?.includes('503');

                    console.warn(`[AI-SWARM] ⚠️ Error en tier ${tierConfig.tier} (Intento ${attempt + 1}): ${err.message}`);

                    if (isRateLimit || isUnavailable) {
                        const backoffTime = this.calculateBackoff(totalRetries);
                        console.log(`[AI-SWARM] Aplicando backoff con jitter: ${backoffTime}ms`);
                        await this.sleep(backoffTime);
                    } else {
                        // Error de validación o no recuperable: pasar al siguiente tier
                        break;
                    }
                }
            }
        }

        console.error(`[AI-SWARM] ❌ Fallaron los 3 tiers del enjambre:`, lastError);
        throw new Error(`Enjambre de IA no disponible tras retroceso: ${lastError?.message || 'Error desconocido'}`);
    }

    private static async callGeminiAPI(model: string, options: AIInferenceOptions): Promise<string> {
        const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            // Modo simulación seguro para desarrollo local
            return `[SIMULACIÓN ENJAMBRE IA (${model})]: Inferencia exitosa para módulo ${options.module} (Tenant: ${options.tenantId}). Parámetros analizados correctamente.`;
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        const payload: any = {
            contents: [
                {
                    parts: [{ text: options.prompt }]
                }
            ],
            generationConfig: {
                temperature: options.temperature ?? 0.2
            }
        };

        if (options.systemInstruction) {
            payload.systemInstruction = {
                parts: [{ text: options.systemInstruction }]
            };
        }

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errBody = await res.text();
            const error: any = new Error(`Gemini API HTTP ${res.status}: ${errBody}`);
            error.status = res.status;
            throw error;
        }

        const data: any = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
}
