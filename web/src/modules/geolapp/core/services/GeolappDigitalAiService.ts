import { coreAuthFetch } from '../../../../core/network/coreAuthFetch';
import { mediaDigestorClient } from '../../../../core/media/MediaDigestorClient';
import type {
    CopperMineralDomain,
    GeolappDigitalScaleAnchorType,
    GeolappGeometryType,
} from '../types/GeolappTypes';

export interface DigitalAnalyzeRequest {
    stockpileId?: string;
    measurementId?: string;
    photoBlob?: Blob;
    extraBlobs?: Blob[];
    photoUrl?: string;
    tenantId?: string;
    scaleAnchorType: GeolappDigitalScaleAnchorType;
    scaleAnchorMeters?: number;
    referenceBaseMeters?: number;
    imuPitchDeg?: number | null;
    imuRollDeg?: number | null;
    locale?: 'es' | 'en' | 'pt';
}

export interface DigitalAnalyzeResult {
    verified: boolean;
    scaleVerified: boolean;
    pendingScaleCalibration: boolean;
    geometryType: GeolappGeometryType;
    wallConfinement: 'NONE' | 'SINGLE_WALL' | 'BUNKER_3_WALLS';
    copperDomain: CopperMineralDomain | null;
    granulometry: 'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS' | null;
    aiSuggestedGranulometry?: 'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS' | null;
    isNonStockpile?: boolean;
    suggestedDensityTm3: number | null;
    slopeAngleLeftDeg: number | null;
    slopeAngleRightDeg: number | null;
    slopeAngleAvgDeg: number | null;
    slopeWarning: string | null;
    anchorDetected: boolean;
    dimensionsM: Record<string, number> | null;
    volumeM3: number;
    weightT: number;
    confidence: number;
    reasoning: string;
    modelUsed?: string;
}

function blobToBase64Raw(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const raw = String(reader.result || '');
            const idx = raw.indexOf(',');
            resolve(idx >= 0 ? raw.slice(idx + 1) : raw);
        };
        reader.onerror = () => reject(new Error('No se pudo codificar la fotografía.'));
        reader.readAsDataURL(blob);
    });
}

async function prepareImageBase64(blob: Blob): Promise<{ base64: string; mimeType: string }> {
    try {
        const digested = await mediaDigestorClient.digestFile(blob, 'IMAGE_FIELD_EVIDENCE');
        return {
            base64: await blobToBase64Raw(digested.blob),
            mimeType: digested.mimeType || 'image/webp',
        };
    } catch {
        return {
            base64: await blobToBase64Raw(blob),
            mimeType: blob.type || 'image/webp',
        };
    }
}

export class GeolappDigitalAiService {
    async analyzeCapture(request: DigitalAnalyzeRequest): Promise<DigitalAnalyzeResult> {
        let imageBase64: string | undefined;
        let imageMimeType: string | undefined;

        if (request.photoBlob) {
            const prepared = await prepareImageBase64(request.photoBlob);
            imageBase64 = prepared.base64;
            imageMimeType = prepared.mimeType;
        }

        const extraImagesBase64: string[] = [];
        if (Array.isArray(request.extraBlobs)) {
            for (const b of request.extraBlobs.slice(0, 3)) {
                const prep = await prepareImageBase64(b);
                if (prep.base64) extraImagesBase64.push(prep.base64);
            }
        }

        const endpoint = request.stockpileId
            ? `/api/geolapp/stockpiles/${encodeURIComponent(request.stockpileId)}/digital-analyze`
            : '/api/geolapp/digital-analyze';

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (request.tenantId) {
            headers['X-Active-Account-Id'] = request.tenantId;
        }

        const res = await coreAuthFetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                measurementId: request.measurementId,
                tenantId: request.tenantId,
                imageBase64,
                imageMimeType,
                extraImagesBase64: extraImagesBase64.length > 0 ? extraImagesBase64 : undefined,
                photoUrl: request.photoUrl,
                scaleAnchorType: request.scaleAnchorType,
                scaleAnchorMeters: request.scaleAnchorMeters,
                referenceBaseMeters: request.referenceBaseMeters,
                imuPitchDeg:
                    typeof request.imuPitchDeg === 'number' && Number.isFinite(request.imuPitchDeg)
                        ? request.imuPitchDeg
                        : undefined,
                imuRollDeg:
                    typeof request.imuRollDeg === 'number' && Number.isFinite(request.imuRollDeg)
                        ? request.imuRollDeg
                        : undefined,
                locale: request.locale || 'es',
            }),
        });

        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(
                (payload as any)?.error || `Error en inferencia digital IA (${res.status}).`
            );
        }

        return payload as DigitalAnalyzeResult;
    }
}

export const geolappDigitalAiService = new GeolappDigitalAiService();
