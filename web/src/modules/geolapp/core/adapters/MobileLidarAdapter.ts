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
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const CHUNK_TYPE_JSON = 0x4e4f534a;
const CHUNK_TYPE_BIN = 0x004e4942;

type PlyScalarType =
    | 'char'
    | 'int8'
    | 'uchar'
    | 'uint8'
    | 'short'
    | 'int16'
    | 'ushort'
    | 'uint16'
    | 'int'
    | 'int32'
    | 'uint'
    | 'uint32'
    | 'float'
    | 'float32'
    | 'double'
    | 'float64';

interface PlyPropertyDef {
    name: string;
    type: PlyScalarType;
    byteSize: number;
    byteOffset: number;
    index: number;
}

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

function getPlyScalarByteSize(rawType: string): { type: PlyScalarType; size: number } {
    switch (rawType) {
        case 'char':
        case 'int8':
            return { type: rawType, size: 1 };
        case 'uchar':
        case 'uint8':
            return { type: rawType, size: 1 };
        case 'short':
        case 'int16':
            return { type: rawType, size: 2 };
        case 'ushort':
        case 'uint16':
            return { type: rawType, size: 2 };
        case 'int':
        case 'int32':
            return { type: rawType, size: 4 };
        case 'uint':
        case 'uint32':
            return { type: rawType, size: 4 };
        case 'float':
        case 'float32':
            return { type: rawType, size: 4 };
        case 'double':
        case 'float64':
            return { type: rawType, size: 8 };
        default:
            throw new Error(`Tipo de propiedad PLY no soportado: ${rawType}`);
    }
}

function readPlyScalarLE(view: DataView, offset: number, type: PlyScalarType): number {
    switch (type) {
        case 'char':
        case 'int8':
            return view.getInt8(offset);
        case 'uchar':
        case 'uint8':
            return view.getUint8(offset);
        case 'short':
        case 'int16':
            return view.getInt16(offset, true);
        case 'ushort':
        case 'uint16':
            return view.getUint16(offset, true);
        case 'int':
        case 'int32':
            return view.getInt32(offset, true);
        case 'uint':
        case 'uint32':
            return view.getUint32(offset, true);
        case 'float':
        case 'float32':
            return view.getFloat32(offset, true);
        case 'double':
        case 'float64':
            return view.getFloat64(offset, true);
    }
}

function findPlyEndHeader(bytes: Uint8Array): { headerLines: string[]; dataOffset: number } {
    const maxScan = Math.min(bytes.length, 65536);
    const headerLines: string[] = [];
    let lineStart = 0;

    for (let i = 0; i < maxScan; i++) {
        if (bytes[i] === 0x0a) {
            let lineEnd = i;
            if (lineEnd > lineStart && bytes[lineEnd - 1] === 0x0d) {
                lineEnd--;
            }
            const line = new TextDecoder('ascii')
                .decode(bytes.subarray(lineStart, lineEnd))
                .trim();
            headerLines.push(line);
            lineStart = i + 1;
            if (line === 'end_header') {
                return { headerLines, dataOffset: lineStart };
            }
        }
    }

    throw new Error('Archivo .ply inválido: no se encontró marcador "end_header".');
}

function parsePlyBuffer(
    bytes: Uint8Array,
    maxPoints: number,
    isStringInput: boolean
): { points: Point3DInput[]; totalPointCount: number; minElevationM: number; maxElevationM: number } {
    const { headerLines, dataOffset } = findPlyEndHeader(bytes);
    if (headerLines.length === 0 || headerLines[0] !== 'ply') {
        throw new Error('Archivo .ply inválido: cabecera inicial "ply" ausente.');
    }

    let formatKind: 'ascii' | 'binary_little_endian' | null = null;
    let vertexCount = 0;
    let currentElement = '';
    const vertexProps: PlyPropertyDef[] = [];
    let vertexByteStride = 0;

    for (let i = 1; i < headerLines.length - 1; i++) {
        const line = headerLines[i];
        if (!line || line.startsWith('comment ') || line.startsWith('obj_info ')) {
            continue;
        }
        const parts = line.split(/\s+/);
        if (parts[0] === 'format') {
            if (parts[1] === 'ascii') {
                formatKind = 'ascii';
            } else if (parts[1] === 'binary_little_endian') {
                formatKind = 'binary_little_endian';
            } else {
                throw new Error(`Formato .ply no soportado: ${parts.slice(1).join(' ')}.`);
            }
        } else if (parts[0] === 'element') {
            currentElement = parts[1] || '';
            if (currentElement === 'vertex') {
                const parsedCount = Number.parseInt(parts[2] || '0', 10);
                if (!Number.isFinite(parsedCount) || parsedCount < 0) {
                    throw new Error(`Cantidad de vértices inválida en PLY: ${parts[2]}.`);
                }
                vertexCount = parsedCount;
            }
        } else if (parts[0] === 'property' && currentElement === 'vertex') {
            if (parts[1] === 'list') {
                throw new Error('Propiedades de tipo list en elemento vertex de PLY no soportadas.');
            }
            const rawType = parts[1];
            const propName = parts[2];
            if (!rawType || !propName) {
                throw new Error(`Declaración de propiedad PLY malformada: ${line}`);
            }
            const { type, size } = getPlyScalarByteSize(rawType);
            vertexProps.push({
                name: propName,
                type,
                byteSize: size,
                byteOffset: vertexByteStride,
                index: vertexProps.length,
            });
            vertexByteStride += size;
        }
    }

    if (!formatKind) {
        throw new Error('Archivo .ply inválido: declaración "format" ausente en cabecera.');
    }
    if (vertexCount < 4) {
        throw new Error(
            `Archivo .ply insuficiente (${vertexCount} vértices; se requieren al menos 4).`
        );
    }

    const xProp = vertexProps.find((p) => p.name === 'x');
    const yProp = vertexProps.find((p) => p.name === 'y');
    const zProp = vertexProps.find((p) => p.name === 'z');
    if (!xProp || !yProp || !zProp) {
        throw new Error('Archivo .ply inválido: propiedades obligatorias x, y, z ausentes en vertex.');
    }

    const points: Point3DInput[] = [];
    let minElevationM = Infinity;
    let maxElevationM = -Infinity;

    if (formatKind === 'binary_little_endian') {
        if (isStringInput) {
            throw new Error('Archivo .ply binary_little_endian requiere entrada binaria ArrayBuffer.');
        }
        const requiredBytes = dataOffset + vertexCount * vertexByteStride;
        if (requiredBytes > bytes.byteLength) {
            throw new Error(
                `Archivo .ply binario truncado: requiere ${requiredBytes} bytes y tiene ${bytes.byteLength} bytes.`
            );
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const sampleCount = Math.min(vertexCount, maxPoints);

        for (let k = 0; k < sampleCount; k++) {
            const idx =
                vertexCount <= maxPoints ? k : Math.floor((k * vertexCount) / sampleCount);
            const rowOffset = dataOffset + idx * vertexByteStride;
            const x = readPlyScalarLE(view, rowOffset + xProp.byteOffset, xProp.type);
            const y = readPlyScalarLE(view, rowOffset + yProp.byteOffset, yProp.type);
            const z = readPlyScalarLE(view, rowOffset + zProp.byteOffset, zProp.type);

            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                points.push({ x, y, z });
                if (z < minElevationM) minElevationM = z;
                if (z > maxElevationM) maxElevationM = z;
            }
        }
    } else {
        const bodyText = new TextDecoder('utf-8').decode(bytes.subarray(dataOffset));
        const bodyLines = bodyText.split(/\r?\n/);
        const parsedAll: Point3DInput[] = [];
        const minTokens = Math.max(xProp.index, yProp.index, zProp.index) + 1;

        for (let i = 0; i < bodyLines.length && parsedAll.length < vertexCount; i++) {
            const trimmed = bodyLines[i].trim();
            if (!trimmed) continue;
            const tokens = trimmed.split(/\s+/);
            if (tokens.length < minTokens) {
                throw new Error(`Vértice PLY ASCII en línea ${i + 1} con columnas insuficientes.`);
            }
            const x = Number(tokens[xProp.index]);
            const y = Number(tokens[yProp.index]);
            const z = Number(tokens[zProp.index]);
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                parsedAll.push({ x, y, z });
                if (z < minElevationM) minElevationM = z;
                if (z > maxElevationM) maxElevationM = z;
            }
        }

        if (parsedAll.length < 4) {
            throw new Error(
                `Archivo .ply ASCII sin suficientes vértices finitos (${parsedAll.length}; mínimo 4).`
            );
        }

        if (parsedAll.length <= maxPoints) {
            points.push(...parsedAll);
        } else {
            for (let k = 0; k < maxPoints; k++) {
                const idx = Math.floor((k * parsedAll.length) / maxPoints);
                points.push(parsedAll[idx]);
            }
        }
    }

    if (points.length < 4) {
        throw new Error(
            `Archivo .ply sin suficientes puntos finitos (${points.length}; mínimo 4).`
        );
    }

    return {
        points,
        totalPointCount: vertexCount,
        minElevationM,
        maxElevationM,
    };
}

function inspectGlbBuffer(
    glbBuffer: ArrayBuffer
): Omit<SurfacePointCloudSummary, 'sourceKind' | 'format' | 'casSha256' | 'casDownloadUrl' | 'casSavingsPct'> {
    if (glbBuffer.byteLength < 28) {
        throw new Error('Archivo .glb inválido: tamaño insuficiente (< 28 bytes).');
    }

    const view = new DataView(glbBuffer);
    if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== GLB_VERSION) {
        throw new Error('Archivo .glb inválido: cabecera glTF 2.0 (0x46546C67 v2) corrupta o ausente.');
    }

    const totalLen = view.getUint32(8, true);
    if (totalLen < 28 || totalLen > glbBuffer.byteLength) {
        throw new Error(
            `Archivo .glb truncado: longitud declarada ${totalLen} bytes excede buffer (${glbBuffer.byteLength} bytes).`
        );
    }

    let offset = 12;
    let jsonChunkBytes: Uint8Array | null = null;
    let binStart = -1;
    let binLen = 0;

    while (offset + 8 <= totalLen) {
        const chunkLen = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const chunkDataStart = offset + 8;
        if (chunkDataStart + chunkLen > totalLen) {
            throw new Error('Archivo .glb inválido: chunk truncado más allá de longitud total.');
        }

        if (chunkType === CHUNK_TYPE_JSON && !jsonChunkBytes) {
            jsonChunkBytes = new Uint8Array(glbBuffer, chunkDataStart, chunkLen);
        } else if (chunkType === CHUNK_TYPE_BIN && binStart === -1) {
            binStart = chunkDataStart;
            binLen = chunkLen;
        }
        offset = chunkDataStart + chunkLen;
    }

    if (!jsonChunkBytes || binStart === -1) {
        throw new Error('Archivo .glb inválido: chunks obligatorios JSON y BIN ausentes.');
    }

    let doc: any;
    try {
        const jsonText = new TextDecoder('utf-8').decode(jsonChunkBytes).trim();
        doc = JSON.parse(jsonText);
    } catch {
        throw new Error('Archivo .glb inválido: chunk JSON malformado.');
    }

    const meshes = Array.isArray(doc?.meshes) ? doc.meshes : [];
    const accessors = Array.isArray(doc?.accessors) ? doc.accessors : [];
    const bufferViews = Array.isArray(doc?.bufferViews) ? doc.bufferViews : [];

    if (meshes.length === 0) {
        throw new Error('Archivo .glb sin mallas (`meshes`) declaradas.');
    }

    let totalVertexCount = 0;
    let totalTriangleCount = 0;
    let signedVolSum6 = 0;
    let totalArea = 0;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (const meshObj of meshes) {
        const primitives = Array.isArray(meshObj?.primitives) ? meshObj.primitives : [];
        for (const primitive of primitives) {
            const mode = primitive?.mode ?? 4;
            if (mode !== 4) continue; // Solo TRIANGLES

            const posAccessorIdx = primitive?.attributes?.POSITION;
            if (typeof posAccessorIdx !== 'number') continue;

            const posAcc = accessors[posAccessorIdx];
            const posView = posAcc ? bufferViews[posAcc.bufferView] : undefined;
            if (!posAcc || !posView || posAcc.componentType !== 5126 || posAcc.type !== 'VEC3') {
                throw new Error('GLB accessor POSITION incompatible (se requiere FLOAT VEC3).');
            }

            const vCount = Number(posAcc.count || 0);
            if (vCount < 3) continue;

            const posByteOffset =
                binStart + Number(posView.byteOffset || 0) + Number(posAcc.byteOffset || 0);
            const posStride = Number(posView.byteStride || 12);
            if (posStride < 12 || posByteOffset + (vCount - 1) * posStride + 12 > binStart + binLen) {
                throw new Error('Archivo .glb truncado: accessor POSITION excede chunk BIN.');
            }

            const positions = new Float32Array(vCount * 3);
            for (let i = 0; i < vCount; i++) {
                const pOff = posByteOffset + i * posStride;
                const x = view.getFloat32(pOff, true);
                const y = view.getFloat32(pOff + 4, true);
                const z = view.getFloat32(pOff + 8, true);
                if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
                    throw new Error('Archivo .glb contiene coordenadas POSITION no finitas.');
                }
                positions[i * 3] = x;
                positions[i * 3 + 1] = y;
                positions[i * 3 + 2] = z;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (z < minZ) minZ = z;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
                if (z > maxZ) maxZ = z;
            }
            totalVertexCount += vCount;

            const idxAccessorIdx = primitive?.indices;
            let triIndices: Uint32Array;
            if (typeof idxAccessorIdx === 'number') {
                const idxAcc = accessors[idxAccessorIdx];
                const idxView = idxAcc ? bufferViews[idxAcc.bufferView] : undefined;
                if (!idxAcc || !idxView) {
                    throw new Error('Archivo .glb inválido: accessor de índices sin bufferView.');
                }
                const iCount = Number(idxAcc.count || 0);
                const compType = idxAcc.componentType;
                if (compType !== 5125 && compType !== 5123 && compType !== 5121) {
                    throw new Error(`Tipo de índice GLB no soportado: ${compType}.`);
                }
                const elemSize = compType === 5125 ? 4 : compType === 5123 ? 2 : 1;
                const iStart =
                    binStart + Number(idxView.byteOffset || 0) + Number(idxAcc.byteOffset || 0);
                const iStride = Number(idxView.byteStride || elemSize);

                if (iCount > 0 && iStart + (iCount - 1) * iStride + elemSize > binStart + binLen) {
                    throw new Error('Archivo .glb truncado: accessor de índices excede chunk BIN.');
                }

                triIndices = new Uint32Array(iCount);
                for (let i = 0; i < iCount; i++) {
                    const o = iStart + i * iStride;
                    const idxVal =
                        compType === 5125
                            ? view.getUint32(o, true)
                            : compType === 5123
                              ? view.getUint16(o, true)
                              : view.getUint8(o);
                    if (idxVal >= vCount) {
                        throw new Error(`Archivo .glb corrupto: índice ${idxVal} fuera de rango (${vCount}).`);
                    }
                    triIndices[i] = idxVal;
                }
            } else {
                triIndices = new Uint32Array(vCount);
                for (let i = 0; i < vCount; i++) {
                    triIndices[i] = i;
                }
            }

            for (let t = 0; t + 2 < triIndices.length; t += 3) {
                const i0 = triIndices[t] * 3;
                const i1 = triIndices[t + 1] * 3;
                const i2 = triIndices[t + 2] * 3;

                const x0 = positions[i0];
                const y0 = positions[i0 + 1];
                const z0 = positions[i0 + 2];
                const x1 = positions[i1];
                const y1 = positions[i1 + 1];
                const z1 = positions[i1 + 2];
                const x2 = positions[i2];
                const y2 = positions[i2 + 1];
                const z2 = positions[i2 + 2];

                const c12x = y1 * z2 - z1 * y2;
                const c12y = z1 * x2 - x1 * z2;
                const c12z = x1 * y2 - y1 * x2;
                signedVolSum6 += x0 * c12x + y0 * c12y + z0 * c12z;

                const e1x = x1 - x0;
                const e1y = y1 - y0;
                const e1z = z1 - z0;
                const e2x = x2 - x0;
                const e2y = y2 - y0;
                const e2z = z2 - z0;
                const nx = e1y * e2z - e1z * e2y;
                const ny = e1z * e2x - e1x * e2z;
                const nz = e1x * e2y - e1y * e2x;
                totalArea += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
                totalTriangleCount++;
            }
        }
    }

    if (totalVertexCount < 3 || totalTriangleCount < 1) {
        throw new Error('Archivo .glb sin posiciones o triángulos geométricos válidos.');
    }

    return {
        pointCount: totalVertexCount,
        decimatedPointCount: totalVertexCount,
        boundsM: {
            widthX: roundTo(maxX - minX, 3),
            depthZ: roundTo(maxZ - minZ, 3),
            reliefY: roundTo(maxY - minY, 3),
            minElevationM: roundTo(minY, 3),
            maxElevationM: roundTo(maxY, 3),
        },
        tinVolumeM3: roundTo(Math.abs(signedVolSum6) / 6, 3),
        surfaceAreaM2: roundTo(totalArea, 3),
        vertexCount: totalVertexCount,
        triangleCount: totalTriangleCount,
        glbBuffer,
        originalBytes: glbBuffer.byteLength,
        optimizedGlbBytes: glbBuffer.byteLength,
    };
}

export class MobileLidarAdapter
    implements ISurfaceSourceAdapter<ArrayBuffer | string, SurfacePointCloudSummary>
{
    public readonly sourceKind = 'MOBILE_LIDAR' as const;
    public readonly supportedExtensions = ['.ply', '.glb'] as const;

    public canHandle(filenameOrHint: string): boolean {
        const lower = String(filenameOrHint || '').trim().toLowerCase();
        return (
            lower.endsWith('.ply') ||
            lower.endsWith('.glb') ||
            lower === 'ply' ||
            lower === 'glb'
        );
    }

    public async parse(
        input: ArrayBuffer | string,
        options?: SurfaceAdapterParseOptions
    ): Promise<SurfacePointCloudSummary> {
        const filenameLower = String(options?.filename || '').trim().toLowerCase();
        const maxPoints =
            typeof options?.maxPoints === 'number' && options.maxPoints >= 4
                ? Math.trunc(options.maxPoints)
                : DEFAULT_MAX_POINTS;

        const meshName =
            options?.meshName ||
            (options?.filename ? options.filename.replace(/\.[^.]+$/, '') : 'MobileLidarMesh');

        let summary: SurfacePointCloudSummary;

        if (typeof input === 'string') {
            if (options?.format === 'GLB' || filenameLower.endsWith('.glb')) {
                throw new Error('Archivo .glb requiere entrada binaria ArrayBuffer.');
            }
            const encoded = new TextEncoder().encode(input);
            const parsed = parsePlyBuffer(encoded, maxPoints, true);
            const mesh = buildPointCloudHeightfieldGlbMesh(parsed.points, {
                gridSize: options?.gridSize,
                baseElevationM: options?.baseElevationM,
                name: meshName,
            });
            if (!mesh) {
                throw new Error(
                    'Nube .ply insuficiente o sin relieve topográfico (> 0.005 m) para generar malla .glb.'
                );
            }
            summary = {
                sourceKind: this.sourceKind,
                format: 'PLY',
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
                originalBytes: encoded.byteLength,
                optimizedGlbBytes: mesh.optimizedGlbBytes,
            };
        } else if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
            const buffer = toArrayBuffer(input as ArrayBuffer | Uint8Array);
            const isGlbMagic =
                buffer.byteLength >= 4 && new DataView(buffer).getUint32(0, true) === GLB_MAGIC;
            const treatAsGlb =
                isGlbMagic || options?.format === 'GLB' || filenameLower.endsWith('.glb');

            if (treatAsGlb) {
                const glbStats = inspectGlbBuffer(buffer);
                summary = {
                    sourceKind: this.sourceKind,
                    format: 'GLB',
                    ...glbStats,
                };
            } else {
                const bytes = new Uint8Array(buffer);
                const parsed = parsePlyBuffer(bytes, maxPoints, false);
                const mesh = buildPointCloudHeightfieldGlbMesh(parsed.points, {
                    gridSize: options?.gridSize,
                    baseElevationM: options?.baseElevationM,
                    name: meshName,
                });
                if (!mesh) {
                    throw new Error(
                        'Nube .ply insuficiente o sin relieve topográfico (> 0.005 m) para generar malla .glb.'
                    );
                }
                summary = {
                    sourceKind: this.sourceKind,
                    format: 'PLY',
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
                    originalBytes: buffer.byteLength,
                    optimizedGlbBytes: mesh.optimizedGlbBytes,
                };
            }
        } else {
            throw new Error('Entrada inválida para MobileLidarAdapter: se esperaba ArrayBuffer o string.');
        }

        if (options?.uploadCas === true) {
            const glbBlob = new Blob([summary.glbBuffer], { type: 'model/gltf-binary' });
            const { descriptor, digested } = await mediaDigestorClient.digestAndUploadCas(glbBlob, {
                profile: 'MESH_3D_GLB',
                scope: 'TENANT_PRIVATE',
                tenantId: options.tenantId,
                filename: `${meshName}.glb`,
                clientOriginalBytes: summary.originalBytes,
            });
            summary.casSha256 = descriptor.sha256 || digested.sha256;
            summary.casDownloadUrl = descriptor.downloadUrl;
            summary.casSavingsPct =
                typeof descriptor.savingsPct === 'number' && descriptor.savingsPct > 0
                    ? descriptor.savingsPct
                    : computeSavingsPct(summary.originalBytes, summary.optimizedGlbBytes);
        }

        return summary;
    }
}

export const mobileLidarAdapter = new MobileLidarAdapter();
