import { auth } from '../../../../config/firebase';
import { coreAuthFetch } from '../../../../core/network/coreAuthFetch';
import { getApiUrl } from '../../../../utils/network';
import type { StockpileAsset } from '../types/GeolappTypes';
import { dataService } from './DataService';
import { resolveStockpileImageUrl } from './StorageService';

export interface AiEnrichProposal {
    field: string;
    current: string;
    suggested: string;
    rawValue: string | number;
    confidence: number;
    source: 'GEMINI_VISION' | 'GEMINI_DECISIONS' | 'GEMINI_LAB_DOC';
}

export interface AiEnrichResult {
    verified: boolean;
    offlineFallback?: boolean;
    proposals: AiEnrichProposal[];
    reasoning: string;
    modelUsed?: string;
    latencyMs?: number;
}

export interface RequestAiEnrichParams {
    asset: StockpileAsset;
    voiceNoteText?: string;
    labFile?: File | null;
    overridePhotoFile?: Blob | null;
    locale?: 'es' | 'en' | 'pt';
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo decodificar la imagen CAS.'));
        img.src = src;
    });
}

async function compressBlobToBase64Webp(
    blob: Blob,
    maxDim = 1024,
    quality = 0.78
): Promise<{ base64: string; mimeType: 'image/webp' | 'image/jpeg' | 'image/png' } | null> {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return null;
    const objUrl = URL.createObjectURL(blob);
    const canvas = document.createElement('canvas');
    try {
        const img = await loadImage(objUrl);
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (width <= 0 || height <= 0) return null;
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
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/webp', quality);
        const parts = dataUrl.split(',');
        if (!parts[1]) return null;
        return { base64: parts[1], mimeType: 'image/webp' };
    } catch {
        return null;
    } finally {
        canvas.width = 0;
        canvas.height = 0;
        URL.revokeObjectURL(objUrl);
    }
}

async function readBlobAsRawBase64(blob: Blob): Promise<string | null> {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
            const raw = String(reader.result || '');
            const idx = raw.indexOf(',');
            resolve(idx >= 0 ? raw.slice(idx + 1) : raw || null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
    });
}

async function resolveRemoteOrCasBlob(rawUrl?: string | null): Promise<Blob | null> {
    const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!trimmed || trimmed.startsWith('data:')) return null;

    if (trimmed.startsWith('offline-cas://')) {
        const { resolvedUrl, revoke } = await resolveStockpileImageUrl(trimmed);
        if (!resolvedUrl) return null;
        try {
            const resp = await fetch(resolvedUrl);
            return resp.ok ? await resp.blob() : null;
        } catch {
            return null;
        } finally {
            if (revoke) revoke();
        }
    }

    if (trimmed.startsWith('/api/media/cas/') || trimmed.includes('/api/media/cas/')) {
        try {
            const endpoint = trimmed.startsWith('/') ? getApiUrl(trimmed) : trimmed;
            const headers: Record<string, string> = {};
            const token =
                (await auth?.currentUser?.getIdToken().catch(() => null)) ||
                (typeof window !== 'undefined'
                    ? window.localStorage.getItem('dev_auth_token') ||
                      window.localStorage.getItem('dev_vault_token')
                    : null);
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const tenant = dataService.getTenantId();
            if (tenant) headers['X-Active-Account-Id'] = tenant;
            const resp = await fetch(endpoint, { headers });
            return resp.ok ? await resp.blob() : null;
        } catch {
            return null;
        }
    }

    try {
        const resp = await fetch(trimmed);
        return resp.ok ? await resp.blob() : null;
    } catch {
        return null;
    }
}

export class GeolappAiEnrichmentService {
    public async analyzeForEnrichment(
        params: RequestAiEnrichParams
    ): Promise<AiEnrichResult> {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            return {
                verified: false,
                offlineFallback: true,
                proposals: [],
                reasoning:
                    '[Información técnica no declarada en ficha — Sin conexión a motor de inferencia]',
            };
        }

        const { asset, voiceNoteText, labFile, overridePhotoFile, locale = 'es' } = params;

        let imageBase64: string | undefined;
        let imageMimeType: 'image/webp' | 'image/jpeg' | 'image/png' | undefined;

        const photoSourceBlob =
            overridePhotoFile ??
            (await resolveRemoteOrCasBlob(asset.last_photo_url || asset.initial_photo_url));
        if (photoSourceBlob) {
            const compressed = await compressBlobToBase64Webp(photoSourceBlob);
            if (compressed) {
                imageBase64 = compressed.base64;
                imageMimeType = compressed.mimeType;
            }
        }

        let labDocumentBase64: string | undefined;
        let labDocumentMimeType:
            | 'application/pdf'
            | 'image/webp'
            | 'image/jpeg'
            | 'image/png'
            | undefined;

        if (labFile) {
            if (labFile.type === 'application/pdf') {
                const rawPdf = await readBlobAsRawBase64(labFile);
                if (rawPdf) {
                    labDocumentBase64 = rawPdf;
                    labDocumentMimeType = 'application/pdf';
                }
            } else {
                const compressedLab = await compressBlobToBase64Webp(labFile, 1400, 0.82);
                if (compressedLab) {
                    labDocumentBase64 = compressedLab.base64;
                    labDocumentMimeType = compressedLab.mimeType;
                }
            }
        }

        const cleanVoice = String(voiceNoteText || '').trim();
        if (!imageBase64 && !labDocumentBase64 && !cleanVoice) {
            return {
                verified: false,
                proposals: [],
                reasoning:
                    '[Información técnica no declarada en ficha — Adjunte foto, documento o nota de terreno]',
            };
        }

        const tenantId =
            asset.tenantId ||
            dataService.getTenantId() ||
            (typeof window !== 'undefined'
                ? window.localStorage.getItem('minreport_active_account_id') || ''
                : '');

        try {
            const resp = await coreAuthFetch(
                `/api/geolapp/stockpiles/${encodeURIComponent(asset.id)}/ai-enrich`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(tenantId ? { 'X-Active-Account-Id': tenantId } : {}),
                    },
                    body: JSON.stringify({
                        ...(imageBase64 ? { imageBase64, imageMimeType } : {}),
                        ...(labDocumentBase64 ? { labDocumentBase64, labDocumentMimeType } : {}),
                        ...(cleanVoice ? { voiceNoteText: cleanVoice } : {}),
                        locale,
                    }),
                }
            );

            if (!resp.ok) {
                const errJson = (await resp.json().catch(() => ({}))) as { error?: string };
                return {
                    verified: false,
                    offlineFallback: resp.status === 503,
                    proposals: [],
                    reasoning:
                        errJson.error ||
                        '[Información técnica no declarada en ficha — Sin respuesta del motor IA]',
                };
            }

            const json = (await resp.json()) as AiEnrichResult;
            return {
                verified: Boolean(json.verified),
                proposals: Array.isArray(json.proposals) ? json.proposals : [],
                reasoning: json.reasoning || '',
                modelUsed: json.modelUsed,
                latencyMs: json.latencyMs,
            };
        } catch {
            return {
                verified: false,
                offlineFallback: true,
                proposals: [],
                reasoning:
                    '[Información técnica no declarada en ficha — Sin conexión a motor de inferencia]',
            };
        }
    }
}

export const geolappAiEnrichmentService = new GeolappAiEnrichmentService();
