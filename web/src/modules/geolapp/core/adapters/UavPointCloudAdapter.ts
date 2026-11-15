import { mediaDigestorClient } from '../../../../core/media/MediaDigestorClient';
import {
    buildPointCloudHeightfieldGlbMesh,
    type Point3DInput,
} from '../utils/glbMeshBuilder';
import type {
    ISurfaceSourceAdapter,
    SurfaceAdapterParseOptions,
    SurfacePointCloudSummary,
} from './ISurfaceSourceAdapter';

const DEFAULT_MAX_POINTS = 16384;
const LAS_SIGNATURE = 'LASF';

function roundTo(value: number, decimals: number): number {
    if (!Number.isFinite(value)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

function computeSavingsPct(originalBytes: number, optimizedBytes: number): number {
    if (!Number.isFinite(originalBytes) || originalBytes <= 0) return 0;
    return Math.max(0, Math.round((1 - optimizedBytes / originalBytes) * 1000) / 10);
}

function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
    if (input instanceof ArrayBuffer) return input;
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
}

function hasLasMagic(buf: ArrayBuffer): boolean {
    if (buf.byteLength < 4) return false;
    const bytes = new Uint8Array(buf, 0, 4);
    return (
        bytes[0] === LAS_SIGNATURE.charCodeAt(0) &&
        bytes[1] === LAS_SIGNATURE.charCodeAt(1) &&
        bytes[2] === LAS_SIGNATURE.charCodeAt(2) &&
        bytes[3] === LAS_SIGNATURE.charCodeAt(3)
    );
}

function parseLasBinary(
    buffer: ArrayBuffer,
    maxPoints: number
): { points: Point3DInput[]; totalPointCount: number; minElevationM: number; maxElevationM: number } {
    if (buffer.byteLength < 227) {
        throw new Error('Archivo .las corrupto o truncado: cabecera menor a 227 bytes.');
    }
    if (!hasLasMagic(buffer)) {
        throw new Error('Archivo .las inválido: firma mágica "LASF" (bytes 0..3) ausente.');
    }

    const view = new DataView(buffer);
    const versionMajor = view.getUint8(24);
    const versionMinor = view.getUint8(25);
    const headerSize = view.getUint16(94, true);
    const offsetToPointData = view.getUint32(96, true);
    const pointDataRecordFormat = view.getUint8(104);
    const pointDataRecordLength = view.getUint16(105, true);
    const legacyPointCount = view.getUint32(107, true);

    if ((pointDataRecordFormat & 0x80) !== 0 || (pointDataRecordFormat & 0x40) !== 0) {
        throw new Error(
            `Formato comprimido .laz no soportado directamente en cliente (pointDataRecordFormat=${pointDataRecordFormat}). Exporte a .las sin compresión.`
        );
    }

    if (headerSize < 227 || headerSize > buffer.byteLength) {
        throw new Error(`Cabecera .las inválida (headerSize=${headerSize}).`);
    }
    if (offsetToPointData < headerSize || offsetToPointData > buffer.byteLength) {
        throw new Error(
            `Desplazamiento de registros .las inválido (offsetToPointData=${offsetToPointData}).`
        );
    }
    if (pointDataRecordLength < 12) {
        throw new Error(
            `Longitud de registro .las insuficiente (${pointDataRecordLength} bytes; mínimo 12 bytes para XYZ).`
        );
    }

    let totalPointCount = legacyPointCount;
    const isLas14OrNewer = versionMajor > 1 || (versionMajor === 1 && versionMinor >= 4);
    if (totalPointCount === 0 && isLas14OrNewer && headerSize >= 255 && buffer.byteLength >= 255) {
        const low = view.getUint32(247, true);
        const high = view.getUint32(251, true);
        if (high > 0x1fffff) {
            throw new Error('Conteo de puntos LAS 1.4 excede rango entero seguro.');
        }
        totalPointCount = high * 4294967296 + low;
    }

    if (!Number.isFinite(totalPointCount) || totalPointCount < 4) {
        throw new Error(
            `Nube .las insuficiente (${totalPointCount} puntos; se requieren al menos 4 puntos reales).`
        );
    }

    const requiredBytes = offsetToPointData + totalPointCount * pointDataRecordLength;
    if (requiredBytes > buffer.byteLength) {
        throw new Error(
            `Archivo .las truncado: requiere ${requiredBytes} bytes y solo contiene ${buffer.byteLength} bytes.`
        );
    }

    const xScale = view.getFloat64(131, true);
    const yScale = view.getFloat64(139, true);
    const zScale = view.getFloat64(147, true);
    const xOffset = view.getFloat64(155, true);
    const yOffset = view.getFloat64(163, true);
    const zOffset = view.getFloat64(171, true);

    if (
        !Number.isFinite(xScale) ||
        !Number.isFinite(yScale) ||
        !Number.isFinite(zScale) ||
        xScale === 0 ||
        yScale === 0 ||
        zScale === 0 ||
        !Number.isFinite(xOffset) ||
        !Number.isFinite(yOffset) ||
        !Number.isFinite(zOffset)
    ) {
        throw new Error('Factores de escala u offsets inválidos en cabecera .las.');
    }

    const sampleCount = Math.min(totalPointCount, maxPoints);
    const points: Point3DInput[] = [];
    let minElevationM = Infinity;
    let maxElevationM = -Infinity;

    for (let k = 0; k < sampleCount; k++) {
        const idx =
            totalPointCount <= maxPoints
                ? k
                : Math.floor((k * totalPointCount) / sampleCount);
        const recOffset = offsetToPointData + idx * pointDataRecordLength;
        const rawX = view.getInt32(recOffset, true);
        const rawY = view.getInt32(recOffset + 4, true);
        const rawZ = view.getInt32(recOffset + 8, true);

        const x = rawX * xScale + xOffset;
        const y = rawY * yScale + yOffset;
        const z = rawZ * zScale + zOffset;

        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            points.push({ x, y, z });
            if (z < minElevationM) minElevationM = z;
            if (z > maxElevationM) maxElevationM = z;
        }
    }

    if (points.length < 4) {
        throw new Error(
            `Archivo .las sin suficientes puntos finitos (${points.length}; mínimo 4).`
        );
    }

    return {
        points,
        totalPointCount,
        minElevationM,
        maxElevationM,
    };
}

function parseAsciiPointCloud(
    rawText: string,
    maxPoints: number
): { points: Point3DInput[]; totalPointCount: number; minElevationM: number; maxElevationM: number } {
    const lines = rawText.split(/\r?\n/);
    const allPoints: Point3DInput[] = [];
    let minElevationM = Infinity;
    let maxElevationM = -Infinity;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
            continue;
        }

        const tokens = trimmed.split(/[\s,;]+/).filter((t) => t.length > 0);
        // Saltar línea de conteo de puntos en archivos .pts o cabeceras textuales
        if (tokens.length === 1 && /^\d+$/.test(tokens[0]) && allPoints.length === 0) {
            continue;
        }
        if (tokens.length < 3) {
            continue;
        }

        const x = Number(tokens[0]);
        const y = Number(tokens[1]);
        const z = Number(tokens[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            // Cabecera tipo X,Y,Z o Easting,Northing,Elevation al inicio del archivo
            if (allPoints.length === 0) {
                continue;
            }
            throw new Error(`Línea ${i + 1} corrupta en nube ASCII: coordenadas XYZ no numéricas.`);
        }

        allPoints.push({ x, y, z });
        if (z < minElevationM) minElevationM = z;
        if (z > maxElevationM) maxElevationM = z;
    }

    if (allPoints.length < 4) {
        throw new Error(
            `Nube de puntos insuficiente (${allPoints.length} puntos válidos; se requieren al menos 4).`
        );
    }

    let sampledPoints = allPoints;
    if (allPoints.length > maxPoints) {
        sampledPoints = [];
        for (let k = 0; k < maxPoints; k++) {
            const idx = Math.floor((k * allPoints.length) / maxPoints);
            sampledPoints.push(allPoints[idx]);
        }
    }

    return {
        points: sampledPoints,
        totalPointCount: allPoints.length,
        minElevationM,
        maxElevationM,
    };
}

export class UavPointCloudAdapter
    implements ISurfaceSourceAdapter<ArrayBuffer | string, SurfacePointCloudSummary>
{
    public readonly sourceKind = 'UAV_PHOTOGRAMMETRY' as const;
    public readonly supportedExtensions = ['.las', '.xyz', '.csv', '.pts'] as const;

    public canHandle(filenameOrHint: string): boolean {
        const lower = String(filenameOrHint || '').trim().toLowerCase();
        return (
            lower.endsWith('.las') ||
            lower.endsWith('.xyz') ||
            lower.endsWith('.csv') ||
            lower.endsWith('.pts') ||
            lower === 'las' ||
            lower === 'xyz' ||
            lower === 'csv' ||
            lower === 'pts'
        );
    }

    public async parse(
        input: ArrayBuffer | string,
        options?: SurfaceAdapterParseOptions
    ): Promise<SurfacePointCloudSummary> {
        const filenameLower = String(options?.filename || '').trim().toLowerCase();
        if (filenameLower.endsWith('.laz')) {
            throw new Error(
                'Formato comprimido .laz no soportado en cliente; exporte en .las sin compresión LASzip.'
            );
        }

        const maxPoints =
            typeof options?.maxPoints === 'number' && options.maxPoints >= 4
                ? Math.trunc(options.maxPoints)
                : DEFAULT_MAX_POINTS;

        let format: 'LAS' | 'XYZ' | 'CSV' = 'XYZ';
        let originalBytes = 0;
        let parsed: {
            points: Point3DInput[];
            totalPointCount: number;
            minElevationM: number;
            maxElevationM: number;
        };

        if (typeof input === 'string') {
            if (options?.format === 'LAS' || filenameLower.endsWith('.las')) {
                throw new Error('Archivo .las requiere contenido binario ArrayBuffer con firma LASF.');
            }
            format = options?.format === 'CSV' || filenameLower.endsWith('.csv') ? 'CSV' : 'XYZ';
            originalBytes = new TextEncoder().encode(input).byteLength;
            parsed = parseAsciiPointCloud(input, maxPoints);
        } else if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
            const buffer = toArrayBuffer(input as ArrayBuffer | Uint8Array);
            originalBytes = buffer.byteLength;
            const looksLikeLas =
                hasLasMagic(buffer) || options?.format === 'LAS' || filenameLower.endsWith('.las');

            if (looksLikeLas) {
                format = 'LAS';
                parsed = parseLasBinary(buffer, maxPoints);
            } else {
                format =
                    options?.format === 'CSV' || filenameLower.endsWith('.csv') ? 'CSV' : 'XYZ';
                const decoded = new TextDecoder('utf-8').decode(buffer);
                parsed = parseAsciiPointCloud(decoded, maxPoints);
            }
        } else {
            throw new Error('Entrada inválida para UavPointCloudAdapter: se esperaba ArrayBuffer o string.');
        }

        const meshName =
            options?.meshName ||
            (options?.filename ? options.filename.replace(/\.[^.]+$/, '') : 'UavSurfaceMesh');
        const mesh = buildPointCloudHeightfieldGlbMesh(parsed.points, {
            gridSize: options?.gridSize,
            baseElevationM: options?.baseElevationM,
            name: meshName,
        });

        if (!mesh) {
            throw new Error(
                'Nube de puntos insuficiente o sin relieve topográfico (> 0.005 m) para construir malla .glb.'
            );
        }

        const summary: SurfacePointCloudSummary = {
            sourceKind: this.sourceKind,
            format,
            pointCount: parsed.totalPointCount,
            decimatedPointCount: parsed.points.length,
            boundsM: {
                widthX: mesh.boundingBoxM.widthX,
                depthZ: mesh.boundingBoxM.depthZ,
                reliefY: mesh.boundingBoxM.heightY,
                minElevationM: roundTo(parsed.minElevationM, 3),
                maxElevationM: roundTo(parsed.maxElevationM, 3),
            },
            tinVolumeM3: mesh.tinVolumeM3,
            surfaceAreaM2: mesh.surfaceAreaM2,
            vertexCount: mesh.vertexCount,
            triangleCount: mesh.triangleCount,
            glbBuffer: mesh.glbBuffer,
            originalBytes,
            optimizedGlbBytes: mesh.optimizedGlbBytes,
        };

        if (options?.uploadCas === true) {
            const glbBlob = new Blob([mesh.glbBuffer], { type: 'model/gltf-binary' });
            const { descriptor, digested } = await mediaDigestorClient.digestAndUploadCas(glbBlob, {
                profile: 'MESH_3D_GLB',
                scope: 'TENANT_PRIVATE',
                tenantId: options.tenantId,
                filename: `${meshName}.glb`,
                clientOriginalBytes: originalBytes,
            });
            summary.casSha256 = descriptor.sha256 || digested.sha256;
            summary.casDownloadUrl = descriptor.downloadUrl;
            summary.casSavingsPct =
                typeof descriptor.savingsPct === 'number' && descriptor.savingsPct > 0
                    ? descriptor.savingsPct
                    : computeSavingsPct(originalBytes, mesh.optimizedGlbBytes);
        }

        return summary;
    }
}

export const uavPointCloudAdapter = new UavPointCloudAdapter();
