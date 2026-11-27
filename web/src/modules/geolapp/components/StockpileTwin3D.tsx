import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CopyButton } from '../../../components/common/CopyButton';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import type {
    MeasurementLifecycleStatus,
    UnifiedBoundingBoxM,
} from '../../../contracts/acopios.contracts';
import { resolveStockpileMeshBinary } from '../core/services/StorageService';
import {
    buildThreeGeometryFromDemGridV1,
    type DemGridGeometryUserData,
    type DemGridInput,
} from '../core/utils/demGridGeometry';
import {
    buildTwin3DDimensionsOverlay,
    disposeMaterialResources,
    disposeObject3DTree,
    formatTwin3DVolumeM3,
} from '../core/utils/twin3dDimensionsOverlay';

export interface StockpileTwin3DProps {
    meshUrl?: string | null;
    /** Superficie DEM 2.5D real generada in-situ en terreno (Nivel 1 Offline, `dem_grid_v1` / `dem_grid_v2`) */
    localPreviewMesh?: DemGridInput | null;
    lifecycleStatus?: MeasurementLifecycleStatus | null;
    copperDomain?: string;
    tinVolumeM3?: number | null;
    dimensionsM?: { a?: number | null; b?: number | null; h?: number | null } | null;
    volumeM3?: number | null;
    slopeAngleDeg?: number | null;
    footprintAreaM2?: number | null;
    showDimensionsDefault?: boolean;
    casMetrics?: {
        originalBytes?: number;
        optimizedBytes?: number;
        savingsPct?: number;
        sha256?: string;
    };
    meshSource?: string;
    className?: string;
    heightPx?: number;
    compact?: boolean;
}

interface ParsedMeshTelemetry {
    boundingBoxM: UnifiedBoundingBoxM;
    triangleCount: number;
    vertexCount: number;
    tinVolumeM3: number | null;
    originalBytes?: number;
    optimizedBytes?: number;
    savingsPct?: number;
    sourceLabel: string;
    tierTag: 'CLOUD' | 'IN-SITU';
    hasVertexColors: boolean;
}

const UNDECLARED_VALUE = '[Información técnica no declarada en ficha]';
const PENDING_RECORD = '[Pendiente de registro]';
const FLAT_ICON_BTN_CLASS =
    'bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none inline-flex items-center justify-center';

function formatCasBytes(bytes?: number | null): string | null {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${Math.round(bytes)} B`;
}

function parseGlbArrayBuffer(loader: GLTFLoader, buffer: ArrayBuffer): Promise<GLTF> {
    return new Promise((resolve, reject) => {
        loader.parse(
            buffer,
            '',
            (gltf) => resolve(gltf),
            (err) => reject(err instanceof Error ? err : new Error('Error parseando binario GLB'))
        );
    });
}

function computeStatsFromGltfRoot(root: THREE.Object3D): {
    boundingBoxM: UnifiedBoundingBoxM;
    triangleCount: number;
    vertexCount: number;
    tinVolumeM3: number | null;
    hasVertexColors: boolean;
} {
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);

    let triangleCount = 0;
    let vertexCount = 0;
    let signedVolSum6 = 0;
    let hasVertexColors = false;

    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const cross = new THREE.Vector3();

    root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const pos = mesh.geometry.getAttribute('position');
        if (!pos) return;
        if (mesh.geometry.getAttribute('color')) {
            hasVertexColors = true;
        }
        vertexCount += pos.count;
        const idx = mesh.geometry.getIndex();
        if (idx) {
            for (let i = 0; i + 2 < idx.count; i += 3) {
                v0.fromBufferAttribute(pos, idx.getX(i));
                v1.fromBufferAttribute(pos, idx.getX(i + 1));
                v2.fromBufferAttribute(pos, idx.getX(i + 2));
                cross.crossVectors(v1, v2);
                signedVolSum6 += v0.dot(cross);
                triangleCount++;
            }
        } else {
            for (let i = 0; i + 2 < pos.count; i += 3) {
                v0.fromBufferAttribute(pos, i);
                v1.fromBufferAttribute(pos, i + 1);
                v2.fromBufferAttribute(pos, i + 2);
                cross.crossVectors(v1, v2);
                signedVolSum6 += v0.dot(cross);
                triangleCount++;
            }
        }
    });

    const tinVol = Math.abs(signedVolSum6) / 6;
    const roundedVol =
        Number.isFinite(tinVol) && tinVol > 0
            ? tinVol < 1.0
                ? Math.round(tinVol * 1000) / 1000
                : Math.round(tinVol * 100) / 100
            : null;
    return {
        boundingBoxM: {
            widthX: Number.isFinite(size.x) ? Math.round(size.x * 1000) / 1000 : 0,
            heightY: Number.isFinite(size.y) ? Math.round(size.y * 1000) / 1000 : 0,
            depthZ: Number.isFinite(size.z) ? Math.round(size.z * 1000) / 1000 : 0,
        },
        triangleCount,
        vertexCount,
        tinVolumeM3: roundedVol,
        hasVertexColors,
    };
}

function fitCameraToBox(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    box: UnifiedBoundingBoxM
): void {
    const maxDim = Math.max(box.widthX, box.heightY, box.depthZ, 0.25);
    const distance = Math.max(maxDim * 2.1, 0.65);
    const targetY = Math.max(0.05, box.heightY * 0.42);
    camera.position.set(
        distance * 0.85,
        Math.max(box.heightY * 1.15, distance * 0.52),
        distance * 0.85
    );
    camera.near = Math.max(0.01, distance * 0.01);
    camera.far = Math.max(500, distance * 25);
    camera.updateProjectionMatrix();
    controls.minDistance = Math.max(0.25, distance * 0.25);
    controls.maxDistance = Math.max(25, distance * 6);
    controls.target.set(0, targetY, 0);
    controls.update();
}

function swapGeometryColorBuffer(
    geometry: THREE.BufferGeometry,
    sourceColors: Float32Array
): void {
    const existing = geometry.getAttribute('color');
    if (
        existing instanceof THREE.BufferAttribute &&
        existing.array instanceof Float32Array &&
        existing.array.length === sourceColors.length
    ) {
        existing.array.set(sourceColors);
        existing.needsUpdate = true;
    } else {
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(sourceColors), 3));
    }
}

/**
 * Aplica estado visual wireframe / RGB fotográfico (`dem_grid_v2`) / capa de confianza ANSI/ISA-101 (`COLOR_0`),
 * preservando color neutro (`0xffffff`) cuando el material posee textura fotográfica real (`mat.map`)
 * o `photoColors` en `geometry.userData`.
 */
export function applyStockpileVisualMaterialState(
    root: THREE.Object3D | null,
    wireframe: boolean,
    confidenceLayer: boolean
): void {
    if (!root) return;
    root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const userData = mesh.geometry?.userData as Partial<DemGridGeometryUserData> | undefined;
        const hasPhotoVertexColors = Boolean(
            userData?.hasPhotoVertexColors && userData?.photoColors instanceof Float32Array
        );
        const hasConfidenceBuffer = userData?.confidenceColors instanceof Float32Array;

        if (!wireframe && mesh.geometry) {
            if (confidenceLayer && hasConfidenceBuffer) {
                swapGeometryColorBuffer(mesh.geometry, userData!.confidenceColors!);
            } else if (!confidenceLayer && hasPhotoVertexColors && userData?.photoColors) {
                swapGeometryColorBuffer(mesh.geometry, userData.photoColors);
            }
        }

        const hasColorAttr = Boolean(mesh.geometry?.getAttribute('color'));
        const useVertexColors =
            !wireframe &&
            hasColorAttr &&
            (confidenceLayer || hasPhotoVertexColors);
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
            if (mat instanceof THREE.MeshStandardMaterial) {
                const hasPhotoTexture = Boolean(mat.map);
                mat.wireframe = wireframe;
                mat.vertexColors = useVertexColors;
                if (useVertexColors) {
                    mat.color.setHex(0xffffff);
                    mat.emissive.setHex(0x000000);
                } else if (hasPhotoTexture && !wireframe) {
                    mat.color.setHex(0xffffff);
                    mat.emissive.setHex(0x000000);
                } else {
                    mat.color.setHex(wireframe ? 0x00aeef : 0xc68346);
                    mat.emissive.setHex(wireframe ? 0x004966 : 0x000000);
                }
                mat.needsUpdate = true;
            } else if ('wireframe' in mat) {
                const basicMat = mat as THREE.MeshBasicMaterial;
                const hasPhotoTexture = Boolean(basicMat.map);
                basicMat.wireframe = wireframe;
                basicMat.vertexColors = useVertexColors;
                basicMat.color?.setHex(
                    useVertexColors || (hasPhotoTexture && !wireframe)
                        ? 0xffffff
                        : wireframe
                          ? 0x00aeef
                          : 0xc68346
                );
                mat.needsUpdate = true;
            }
        }
    });
}

export const StockpileTwin3D: React.FC<StockpileTwin3DProps> = ({
    meshUrl,
    localPreviewMesh,
    lifecycleStatus,
    copperDomain,
    tinVolumeM3,
    dimensionsM,
    volumeM3,
    slopeAngleDeg,
    footprintAreaM2,
    showDimensionsDefault,
    casMetrics,
    meshSource,
    className = '',
    heightPx = 340,
    compact = false,
}) => {
    const { t } = useTranslation();
    const viewportHostRef = useRef<HTMLDivElement | null>(null);
    const modelGroupRef = useRef<THREE.Object3D | null>(null);
    const dimensionsGroupRef = useRef<THREE.Group | null>(null);
    const meshBboxRef = useRef<UnifiedBoundingBoxM | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const gridRef = useRef<{
        helper: THREE.GridHelper | null;
        extent: number;
        divisions: number;
    }>({ helper: null, extent: 12, divisions: 12 });
    const resetCameraFnRef = useRef<(() => void) | null>(null);
    const requestRenderRef = useRef<(() => void) | null>(null);

    const [isWireframe, setIsWireframe] = useState(false);
    const [showConfidenceLayer, setShowConfidenceLayer] = useState(false);
    const [showDimensions, setShowDimensions] = useState<boolean>(
        () => showDimensionsDefault ?? true
    );
    const [meshVersion, setMeshVersion] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [failureReason, setFailureReason] = useState<string | null>(null);
    const [retryCounter, setRetryCounter] = useState(0);
    const [webglUnavailable, setWebglUnavailable] = useState(false);
    const [isDark, setIsDark] = useState<boolean>(() =>
        typeof document !== 'undefined'
            ? document.documentElement.classList.contains('dark')
            : false
    );

    const isWireframeRef = useRef(isWireframe);
    const showConfidenceLayerRef = useRef(showConfidenceLayer);
    const isDarkRef = useRef(isDark);
    useEffect(() => {
        isWireframeRef.current = isWireframe;
    }, [isWireframe]);
    useEffect(() => {
        showConfidenceLayerRef.current = showConfidenceLayer;
    }, [showConfidenceLayer]);
    useEffect(() => {
        isDarkRef.current = isDark;
    }, [isDark]);

    const [meshBuffer, setMeshBuffer] = useState<ArrayBuffer | null>(null);
    const [activeRenderMode, setActiveRenderMode] = useState<'NONE' | 'GLB' | 'DEM_V1'>('NONE');
    const [telemetry, setTelemetry] = useState<ParsedMeshTelemetry | null>(null);

    const demKey = useMemo(() => {
        if (!localPreviewMesh) return '';
        return `${localPreviewMesh.format || 'dem_grid_v1'}:${localPreviewMesh.nx}x${localPreviewMesh.nz}:${localPreviewMesh.cellSizeM}:${localPreviewMesh.rgbB64?.length || 0}:${localPreviewMesh.sha256 || localPreviewMesh.heightsM.length}`;
    }, [localPreviewMesh]);

    const defaultDemSourceLabel =
        localPreviewMesh?.format === 'dem_grid_v2' ? 'IN_SITU_DEM_GRID_V2' : 'IN_SITU_DEM_GRID_V1';

    // Sincronizar tema Light/Dark sin reconstruir contexto WebGL
    useEffect(() => {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
        const rootEl = document.documentElement;
        const syncTheme = () => setIsDark(rootEl.classList.contains('dark'));
        syncTheme();
        const observer = new MutationObserver(syncTheme);
        observer.observe(rootEl, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    // Cargar binario .glb real desde meshUrl o activar Nivel 1 Offline (`dem_grid_v1`).
    // POLÍTICA CERO 3D SINTÉTICO: jamás se genera cono/pirámide desde {a,b,h}.
    useEffect(() => {
        let cancelled = false;
        const cleanUrl = typeof meshUrl === 'string' ? meshUrl.trim() : '';
        const hasDem = Boolean(
            localPreviewMesh &&
                localPreviewMesh.nx >= 2 &&
                localPreviewMesh.nz >= 2 &&
                Array.isArray(localPreviewMesh.heightsM) &&
                localPreviewMesh.heightsM.length === localPreviewMesh.nx * localPreviewMesh.nz
        );

        if (!cleanUrl && !hasDem) {
            setIsLoading(false);
            setLoadFailed(false);
            setFailureReason(null);
            setMeshBuffer(null);
            setActiveRenderMode('NONE');
            setTelemetry(null);
            return;
        }

        if (!cleanUrl && hasDem) {
            setIsLoading(false);
            setLoadFailed(false);
            setFailureReason(null);
            setMeshBuffer(null);
            setActiveRenderMode('DEM_V1');
            setTelemetry({
                boundingBoxM: { widthX: 0, heightY: 0, depthZ: 0 },
                triangleCount: 0,
                vertexCount: 0,
                tinVolumeM3:
                    typeof tinVolumeM3 === 'number'
                        ? tinVolumeM3
                        : localPreviewMesh?.volumeM3 ?? null,
                sourceLabel: defaultDemSourceLabel,
                tierTag: 'IN-SITU',
                hasVertexColors: true,
            });
            return;
        }

        setIsLoading(true);
        setLoadFailed(false);
        setFailureReason(null);

        (async () => {
            const fetched = await resolveStockpileMeshBinary(cleanUrl);
            if (cancelled) return;

            if (fetched.arrayBuffer && fetched.arrayBuffer.byteLength >= 12) {
                const magicView = new DataView(fetched.arrayBuffer);
                const isGlbHeader =
                    magicView.getUint32(0, true) === 0x46546c67 &&
                    magicView.getUint32(4, true) === 2;
                if (isGlbHeader) {
                    setMeshBuffer(fetched.arrayBuffer);
                    setActiveRenderMode('GLB');
                    setLoadFailed(false);
                    setFailureReason(null);
                    setTelemetry({
                        boundingBoxM: { widthX: 0, heightY: 0, depthZ: 0 },
                        triangleCount: 0,
                        vertexCount: 0,
                        tinVolumeM3: typeof tinVolumeM3 === 'number' ? tinVolumeM3 : null,
                        originalBytes: casMetrics?.originalBytes,
                        optimizedBytes:
                            casMetrics?.optimizedBytes ?? fetched.arrayBuffer.byteLength,
                        savingsPct: casMetrics?.savingsPct,
                        sourceLabel: meshSource || fetched.sourceLabel,
                        tierTag: 'CLOUD',
                        hasVertexColors: false,
                    });
                    setIsLoading(false);
                    return;
                }
                setFailureReason('INVALID_GLB_HEADER');
            } else {
                setFailureReason(fetched.sourceLabel || 'CAS_FETCH_ERROR');
            }

            // Si falla la descarga remota pero existe DEM real in-situ, mostrar Nivel 1 honestamente etiquetado
            if (hasDem) {
                setMeshBuffer(null);
                setActiveRenderMode('DEM_V1');
                setLoadFailed(true);
                setTelemetry({
                    boundingBoxM: { widthX: 0, heightY: 0, depthZ: 0 },
                    triangleCount: 0,
                    vertexCount: 0,
                    tinVolumeM3:
                        typeof tinVolumeM3 === 'number'
                            ? tinVolumeM3
                            : localPreviewMesh?.volumeM3 ?? null,
                    sourceLabel: defaultDemSourceLabel,
                    tierTag: 'IN-SITU',
                    hasVertexColors: true,
                });
            } else {
                setMeshBuffer(null);
                setActiveRenderMode('NONE');
                setLoadFailed(true);
                setTelemetry(null);
            }
            setIsLoading(false);
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meshUrl, demKey, meshSource, retryCounter]);

    // Actualizar material wireframe / capa de confianza ANSI/ISA-101 (`COLOR_0`) sin recrear la escena
    const applyVisualMaterialState = useCallback(
        (root: THREE.Object3D | null, wireframe: boolean, confidenceLayer: boolean) => {
            applyStockpileVisualMaterialState(root, wireframe, confidenceLayer);
            requestRenderRef.current?.();
        },
        []
    );

    useEffect(() => {
        applyVisualMaterialState(modelGroupRef.current, isWireframe, showConfidenceLayer);
    }, [isWireframe, showConfidenceLayer, applyVisualMaterialState]);

    // Montar visor Three.js con renderizado bajo demanda (`0%` GPU en reposo) e higiene WebGL estricta
    useEffect(() => {
        const host = viewportHostRef.current;
        if (!host || activeRenderMode === 'NONE') {
            return;
        }
        if (activeRenderMode === 'GLB' && !meshBuffer) {
            return;
        }
        if (activeRenderMode === 'DEM_V1' && !localPreviewMesh) {
            return;
        }

        let disposed = false;
        let rafId = 0;
        let renderer: THREE.WebGLRenderer | null = null;
        let controls: OrbitControls | null = null;
        let resizeObserver: ResizeObserver | null = null;
        let gridHelper: THREE.GridHelper | null = null;

        const darkNow = isDarkRef.current;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(darkNow ? (compact ? 0x030508 : 0x000000) : 0xf8fafc);
        sceneRef.current = scene;

        const initWidth = Math.max(1, host.clientWidth || 320);
        const initHeight = Math.max(1, host.clientHeight || heightPx);
        const camera = new THREE.PerspectiveCamera(42, initWidth / initHeight, 0.1, 1000);
        camera.position.set(14, 10, 14);

        try {
            renderer = new THREE.WebGLRenderer({
                antialias: true,
                powerPreference: 'high-performance',
            });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 2));
            renderer.setSize(initWidth, initHeight);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.05;
            host.innerHTML = '';
            host.appendChild(renderer.domElement);
            setWebglUnavailable(false);
        } catch {
            sceneRef.current = null;
            setWebglUnavailable(true);
            if (activeRenderMode === 'DEM_V1' && localPreviewMesh) {
                const builtDem = buildThreeGeometryFromDemGridV1(localPreviewMesh);
                if (builtDem) {
                    setTelemetry((prev) => ({
                        boundingBoxM: builtDem.boundingBoxM,
                        triangleCount: builtDem.triangleCount,
                        vertexCount: builtDem.vertexCount,
                        tinVolumeM3:
                            typeof tinVolumeM3 === 'number'
                                ? tinVolumeM3
                                : builtDem.tinVolumeM3,
                        originalBytes: prev?.originalBytes ?? casMetrics?.originalBytes,
                        optimizedBytes: prev?.optimizedBytes ?? casMetrics?.optimizedBytes,
                        savingsPct: prev?.savingsPct ?? casMetrics?.savingsPct,
                        sourceLabel: prev?.sourceLabel || meshSource || defaultDemSourceLabel,
                        tierTag: 'IN-SITU',
                        hasVertexColors: builtDem.hasConfidenceColors,
                    }));
                    builtDem.geometry.dispose();
                }
            }
            return;
        }

        const prevCamPos = new THREE.Vector3();
        const prevTarget = new THREE.Vector3();

        const requestRender = () => {
            if (disposed || rafId !== 0 || !renderer) return;
            rafId = window.requestAnimationFrame(() => {
                rafId = 0;
                if (disposed || !renderer) return;
                prevCamPos.copy(camera.position);
                if (controls) prevTarget.copy(controls.target);

                const stillDamping = controls ? controls.update() : false;
                renderer.render(scene, camera);

                const moved =
                    prevCamPos.distanceToSquared(camera.position) > 1e-8 ||
                    (controls ? prevTarget.distanceToSquared(controls.target) > 1e-8 : false);
                if (stillDamping || moved) {
                    requestRender();
                }
            });
        };
        requestRenderRef.current = requestRender;

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.maxPolarAngle = Math.PI * 0.495;
        controls.minDistance = 0.25;
        controls.maxDistance = 80;
        controls.addEventListener('change', requestRender);

        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 0.85);
        scene.add(hemiLight);

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
        keyLight.position.set(18, 28, 14);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0x94a3b8, 0.55);
        fillLight.position.set(-16, 12, -14);
        scene.add(fillLight);

        const attachMeshRoot = (
            root: THREE.Object3D,
            computed: {
                boundingBoxM: UnifiedBoundingBoxM;
                triangleCount: number;
                vertexCount: number;
                tinVolumeM3: number | null;
                hasVertexColors: boolean;
            },
            tierTag: 'CLOUD' | 'IN-SITU',
            defaultSource: string
        ) => {
            const themeDark = isDarkRef.current;
            const gridExtent = Math.max(
                4,
                Math.ceil(Math.max(computed.boundingBoxM.widthX, computed.boundingBoxM.depthZ) * 1.8)
            );
            const divisions = Math.min(40, Math.max(12, Math.round(gridExtent)));
            gridHelper = new THREE.GridHelper(
                gridExtent,
                divisions,
                themeDark ? 0x334155 : 0x94a3b8,
                themeDark ? 0x12151c : 0xe2e8f0
            );
            gridRef.current = { helper: gridHelper, extent: gridExtent, divisions };
            scene.add(gridHelper);
            scene.add(root);
            modelGroupRef.current = root;
            meshBboxRef.current = computed.boundingBoxM;

            applyVisualMaterialState(
                root,
                isWireframeRef.current,
                showConfidenceLayerRef.current
            );
            if (controls) {
                fitCameraToBox(camera, controls, computed.boundingBoxM);
                resetCameraFnRef.current = () => {
                    if (controls) {
                        fitCameraToBox(camera, controls, computed.boundingBoxM);
                        requestRender();
                    }
                };
            }
            setMeshVersion((prev) => prev + 1);
            requestRender();

            setTelemetry((prev) => ({
                boundingBoxM:
                    computed.boundingBoxM.widthX > 0
                        ? computed.boundingBoxM
                        : prev?.boundingBoxM || computed.boundingBoxM,
                triangleCount:
                    computed.triangleCount > 0 ? computed.triangleCount : prev?.triangleCount || 0,
                vertexCount:
                    computed.vertexCount > 0 ? computed.vertexCount : prev?.vertexCount || 0,
                tinVolumeM3:
                    typeof tinVolumeM3 === 'number'
                        ? tinVolumeM3
                        : computed.tinVolumeM3 ?? prev?.tinVolumeM3 ?? null,
                originalBytes: prev?.originalBytes ?? casMetrics?.originalBytes,
                optimizedBytes: prev?.optimizedBytes ?? casMetrics?.optimizedBytes,
                savingsPct: prev?.savingsPct ?? casMetrics?.savingsPct,
                sourceLabel: prev?.sourceLabel || meshSource || defaultSource,
                tierTag,
                hasVertexColors: computed.hasVertexColors,
            }));
        };

        if (activeRenderMode === 'DEM_V1' && localPreviewMesh) {
            const builtDem = buildThreeGeometryFromDemGridV1(localPreviewMesh);
            if (builtDem) {
                const mat = new THREE.MeshStandardMaterial({
                    color: 0xc68346,
                    metalness: 0.14,
                    roughness: 0.78,
                    vertexColors: false,
                });
                const mesh = new THREE.Mesh(builtDem.geometry, mat);
                const group = new THREE.Group();
                group.add(mesh);
                attachMeshRoot(
                    group,
                    {
                        boundingBoxM: builtDem.boundingBoxM,
                        triangleCount: builtDem.triangleCount,
                        vertexCount: builtDem.vertexCount,
                        tinVolumeM3: builtDem.tinVolumeM3,
                        hasVertexColors: builtDem.hasConfidenceColors,
                    },
                    'IN-SITU',
                    defaultDemSourceLabel
                );
            } else {
                setActiveRenderMode('NONE');
                setLoadFailed(true);
                setFailureReason('INVALID_DEM_GRID_V1');
            }
        } else if (activeRenderMode === 'GLB' && meshBuffer) {
            const loader = new GLTFLoader();
            parseGlbArrayBuffer(loader, meshBuffer)
                .then((gltf) => {
                    if (disposed) {
                        disposeObject3DTree(gltf.scene);
                        return;
                    }

                    const root = gltf.scene;
                    const box = new THREE.Box3().setFromObject(root);
                    const center = new THREE.Vector3();
                    box.getCenter(center);

                    // Asentar base en y = 0 centrado en XZ
                    root.position.set(-center.x, -box.min.y, -center.z);
                    root.traverse((obj) => {
                        const mesh = obj as THREE.Mesh;
                        if (!mesh.isMesh) return;
                        if (!(mesh.material instanceof THREE.MeshStandardMaterial)) {
                            const prevMat = mesh.material;
                            if (Array.isArray(prevMat)) {
                                prevMat.forEach(disposeMaterialResources);
                            } else if (prevMat) {
                                disposeMaterialResources(prevMat);
                            }
                            mesh.material = new THREE.MeshStandardMaterial({
                                color: 0xc68346,
                                metalness: 0.14,
                                roughness: 0.78,
                            });
                        }
                    });

                    const computed = computeStatsFromGltfRoot(root);
                    attachMeshRoot(root, computed, 'CLOUD', 'GLB_3D');
                })
                .catch(() => {
                    if (disposed) return;
                    setLoadFailed(true);
                    setFailureReason('GLB_PARSE_ERROR');
                    setMeshBuffer(null);
                    setActiveRenderMode(localPreviewMesh ? 'DEM_V1' : 'NONE');
                });
        }

        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver((entries) => {
                if (disposed || !renderer) return;
                const entry = entries[0];
                if (!entry) return;
                const w = Math.max(1, Math.floor(entry.contentRect.width));
                const h = Math.max(1, Math.floor(entry.contentRect.height));
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
                renderer.setSize(w, h);
                requestRender();
            });
            resizeObserver.observe(host);
        }

        return () => {
            disposed = true;
            resetCameraFnRef.current = null;
            requestRenderRef.current = null;
            modelGroupRef.current = null;
            dimensionsGroupRef.current = null;
            meshBboxRef.current = null;
            sceneRef.current = null;
            gridRef.current = { helper: null, extent: 12, divisions: 12 };
            if (rafId) {
                window.cancelAnimationFrame(rafId);
            }
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            if (controls) {
                controls.removeEventListener('change', requestRender);
                controls.dispose();
            }
            disposeObject3DTree(scene);
            if (renderer) {
                renderer.dispose();
                renderer.forceContextLoss();
                if (renderer.domElement.parentNode === host) {
                    host.removeChild(renderer.domElement);
                }
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meshBuffer, activeRenderMode, demKey, heightPx, compact]);

    // Actualizar fondo y grilla al alternar modo claro/oscuro liberando geometría previa
    useEffect(() => {
        const scene = sceneRef.current;
        if (!scene) return;
        scene.background = new THREE.Color(isDark ? (compact ? 0x030508 : 0x000000) : 0xf8fafc);

        const prevGrid = gridRef.current.helper;
        if (prevGrid) {
            scene.remove(prevGrid);
            prevGrid.geometry.dispose();
            const mat = prevGrid.material;
            if (Array.isArray(mat)) {
                mat.forEach(disposeMaterialResources);
            } else if (mat) {
                disposeMaterialResources(mat);
            }
            const nextGrid = new THREE.GridHelper(
                gridRef.current.extent,
                gridRef.current.divisions,
                isDark ? 0x334155 : 0x94a3b8,
                isDark ? 0x12151c : 0xe2e8f0
            );
            gridRef.current.helper = nextGrid;
            scene.add(nextGrid);
        }
        requestRenderRef.current?.();
    }, [isDark, compact]);

    const effectiveTinVolume =
        typeof tinVolumeM3 === 'number' && Number.isFinite(tinVolumeM3)
            ? tinVolumeM3
            : typeof volumeM3 === 'number' && Number.isFinite(volumeM3)
              ? volumeM3
              : telemetry?.tinVolumeM3 ?? null;

    const effectiveOverlayVolume =
        typeof volumeM3 === 'number' && Number.isFinite(volumeM3) && volumeM3 > 0
            ? volumeM3
            : effectiveTinVolume;

    // Reconstruir overlay de Cotas 3D CAD con limpieza estricta GPU (`disposeObject3DTree`)
    useEffect(() => {
        const scene = sceneRef.current;
        if (dimensionsGroupRef.current) {
            scene?.remove(dimensionsGroupRef.current);
            disposeObject3DTree(dimensionsGroupRef.current);
            dimensionsGroupRef.current = null;
        }
        const activeBbox = meshBboxRef.current;
        if (
            showDimensions &&
            scene &&
            activeBbox &&
            (activeBbox.widthX > 0 || activeBbox.depthZ > 0 || activeBbox.heightY > 0)
        ) {
            const overlay = buildTwin3DDimensionsOverlay({
                boundingBoxM: activeBbox,
                dimensionsM,
                volumeM3: effectiveOverlayVolume,
                slopeAngleDeg,
                footprintAreaM2,
                isDark,
                compact,
            });
            scene.add(overlay);
            dimensionsGroupRef.current = overlay;
        }
        requestRenderRef.current?.();

        return () => {
            if (dimensionsGroupRef.current) {
                sceneRef.current?.remove(dimensionsGroupRef.current);
                disposeObject3DTree(dimensionsGroupRef.current);
                dimensionsGroupRef.current = null;
            }
        };
    }, [
        showDimensions,
        isDark,
        compact,
        meshVersion,
        dimensionsM?.a,
        dimensionsM?.b,
        dimensionsM?.h,
        effectiveOverlayVolume,
        slopeAngleDeg,
        footprintAreaM2,
    ]);

    const origBytes = casMetrics?.originalBytes ?? telemetry?.originalBytes;
    const optBytes = casMetrics?.optimizedBytes ?? telemetry?.optimizedBytes;
    const casPct =
        typeof casMetrics?.savingsPct === 'number'
            ? casMetrics.savingsPct
            : typeof telemetry?.savingsPct === 'number'
              ? telemetry.savingsPct
              : typeof origBytes === 'number' && typeof optBytes === 'number' && origBytes > 0
                ? Math.max(0, Math.round((1 - optBytes / origBytes) * 1000) / 10)
                : undefined;

    const origText = formatCasBytes(origBytes);
    const optText = formatCasBytes(optBytes);
    const hasCasTrace = origText !== null && optText !== null;
    const casLabel = hasCasTrace
        ? `ORIG: ${origText} -> CAS: ${optText} (-${(casPct ?? 0).toFixed(1)}%)`
        : PENDING_RECORD;

    const bbox = telemetry?.boundingBoxM;
    const hasDimensions = Boolean(
        bbox && (bbox.widthX > 0 || bbox.depthZ > 0 || bbox.heightY > 0)
    );
    const dimensionsLabel =
        hasDimensions && bbox
            ? `${bbox.widthX.toFixed(2)} x ${bbox.depthZ.toFixed(2)} x ${bbox.heightY.toFixed(2)} m`
            : UNDECLARED_VALUE;
    const compactDimensionsLabel =
        hasDimensions && bbox
            ? bbox.widthX < 1 || bbox.depthZ < 1 || bbox.heightY < 1
                ? `${bbox.widthX.toFixed(2)}×${bbox.depthZ.toFixed(2)}×${bbox.heightY.toFixed(2)}m`
                : `${bbox.widthX.toFixed(1)}×${bbox.depthZ.toFixed(1)}×${bbox.heightY.toFixed(1)}m`
            : '--';

    const trianglesLabel =
        telemetry && telemetry.triangleCount > 0
            ? telemetry.triangleCount.toLocaleString('en-US')
            : PENDING_RECORD;

    const volumeLabel =
        effectiveTinVolume !== null && Number.isFinite(effectiveTinVolume)
            ? `${formatTwin3DVolumeM3(effectiveTinVolume)} m³`
            : UNDECLARED_VALUE;

    const hasRenderableMesh = activeRenderMode !== 'NONE';
    const hasCleanMeshUrl = typeof meshUrl === 'string' && meshUrl.trim().length > 0;
    const canToggleConfidence = Boolean(telemetry?.hasVertexColors);
    const tierBadge =
        activeRenderMode === 'GLB' || lifecycleStatus === 'CLOUD_3D_VERIFIED'
            ? 'CLOUD'
            : 'IN-SITU';

    if (compact) {
        return (
            <section
                aria-label={t('twin3d.title', 'GEMELO DIGITAL 3D (.GLB)')}
                className={`w-full border-0 bg-[#F8FAFC] dark:bg-[#030508] rounded-none shadow-none select-none font-atkinson text-[#0F172A] dark:text-[#F3F4F6] ${className}`}
            >
                <div className="relative w-full bg-[#F8FAFC] dark:bg-[#030508]">
                    {isLoading && (
                        <div className="absolute top-0 inset-x-0 z-20">
                            <M3LinearProgress
                                indeterminate
                                ariaLabel={t('twin3d.loading_mesh', 'CARGANDO MALLA .glb...')}
                            />
                        </div>
                    )}

                    <div className="absolute top-fib-8 right-fib-8 z-10 flex items-center gap-fib-8">
                        <button
                            type="button"
                            onClick={() => setShowDimensions((prev) => !prev)}
                            title={t('twin3d.dimensions_toggle', 'COTAS 3D')}
                            aria-label={t('twin3d.dimensions_toggle', 'COTAS 3D')}
                            aria-pressed={showDimensions}
                            disabled={!hasRenderableMesh || webglUnavailable}
                            className={`${FLAT_ICON_BTN_CLASS} min-w-[48px] min-h-[48px] ${
                                showDimensions ? 'text-[#00AEEF] dark:text-[#00AEEF]' : ''
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                            <span className="material-symbols-outlined text-[20px]">
                                straighten
                            </span>
                        </button>

                        {canToggleConfidence && (
                            <button
                                type="button"
                                onClick={() => setShowConfidenceLayer((prev) => !prev)}
                                title={t('twin3d.confidence_layer_toggle', 'CAPA CONFIANZA ISA-101')}
                                aria-label={t(
                                    'twin3d.confidence_layer_toggle',
                                    'CAPA CONFIANZA ISA-101'
                                )}
                                aria-pressed={showConfidenceLayer}
                                disabled={!hasRenderableMesh || webglUnavailable}
                                className={`${FLAT_ICON_BTN_CLASS} min-w-[44px] min-h-[44px] ${
                                    showConfidenceLayer ? 'text-[#00AEEF] dark:text-[#00AEEF]' : ''
                                } disabled:opacity-40 disabled:cursor-not-allowed`}
                            >
                                <span className="material-symbols-outlined text-[20px]">
                                    layers
                                </span>
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={() => setIsWireframe((prev) => !prev)}
                            title={t('twin3d.wireframe_toggle', 'MODO WIREFRAME')}
                            aria-label={t('twin3d.wireframe_toggle', 'MODO WIREFRAME')}
                            aria-pressed={isWireframe}
                            disabled={!hasRenderableMesh || webglUnavailable}
                            className={`${FLAT_ICON_BTN_CLASS} min-w-[44px] min-h-[44px] ${
                                isWireframe ? 'text-[#00AEEF] dark:text-[#00AEEF]' : ''
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                            <span className="material-symbols-outlined text-[20px]">grid_4x4</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => resetCameraFnRef.current?.()}
                            title={t('twin3d.reset_camera', 'Centrar cámara 3D')}
                            aria-label={t('twin3d.reset_camera', 'Centrar cámara 3D')}
                            disabled={!hasRenderableMesh || webglUnavailable}
                            className={`${FLAT_ICON_BTN_CLASS} min-w-[44px] min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                            <span className="material-symbols-outlined text-[20px]">
                                center_focus_strong
                            </span>
                        </button>

                        {hasRenderableMesh && loadFailed && hasCleanMeshUrl && (
                            <button
                                type="button"
                                onClick={() => setRetryCounter((c) => c + 1)}
                                title={t('twin3d.retry_load', 'REINTENTAR')}
                                aria-label={t('twin3d.retry_load', 'REINTENTAR')}
                                className={`${FLAT_ICON_BTN_CLASS} min-w-[44px] min-h-[44px] text-[#C68346]`}
                            >
                                <span className="material-symbols-outlined text-[20px]">
                                    refresh
                                </span>
                            </button>
                        )}
                    </div>

                    {hasRenderableMesh && !webglUnavailable ? (
                        <div
                            ref={viewportHostRef}
                            style={{ height: `${heightPx}px`, touchAction: 'none' }}
                            className="w-full relative overflow-hidden rounded-none"
                        />
                    ) : (
                        <div
                            style={{ height: `${heightPx}px` }}
                            className="w-full px-fib-21 flex flex-col items-center justify-center gap-fib-8 text-center"
                        >
                            <span className="material-symbols-outlined text-[32px] text-[#94A3B8] dark:text-[#5A6072]">
                                deployed_code
                            </span>
                            {!isLoading && (
                                <span className="text-microcopy font-mono uppercase text-[#94A3B8] dark:text-[#5A6072]">
                                    {t('twin3d.no_model_3d', 'SIN MODELO 3D')}
                                </span>
                            )}
                            {!isLoading && failureReason && (
                                <span className="text-microcopy font-mono uppercase text-[#C68346]">
                                    {failureReason}
                                </span>
                            )}
                            {!isLoading && loadFailed && hasCleanMeshUrl && (
                                <button
                                    type="button"
                                    onClick={() => setRetryCounter((c) => c + 1)}
                                    title={t('twin3d.retry_load', 'REINTENTAR')}
                                    aria-label={t('twin3d.retry_load', 'REINTENTAR')}
                                    className={`${FLAT_ICON_BTN_CLASS} min-w-[48px] min-h-[48px] text-[#00AEEF]`}
                                >
                                    <span className="material-symbols-outlined text-[22px]">
                                        refresh
                                    </span>
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {hasRenderableMesh && (
                    <div className="px-fib-13 py-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] bg-transparent flex items-center justify-between gap-fib-8 font-mono tabular-nums text-microcopy text-[#475569] dark:text-[#8A93A6]">
                        <span className="truncate">
                            {compactDimensionsLabel} ·{' '}
                            {effectiveTinVolume !== null
                                ? `${formatTwin3DVolumeM3(effectiveTinVolume)} m³`
                                : '--'}{' '}
                            · {telemetry?.triangleCount ?? 0} TRI
                        </span>
                        <span
                            className={`shrink-0 font-bold uppercase ${
                                tierBadge === 'CLOUD' ? 'text-[#00AEEF]' : 'text-[#C68346]'
                            }`}
                        >
                            {tierBadge}
                        </span>
                    </div>
                )}
            </section>
        );
    }

    return (
        <section
            aria-label={t('twin3d.title', 'GEMELO DIGITAL 3D (.GLB)')}
            className={`w-full bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none select-none font-atkinson text-[#0F172A] dark:text-[#F3F4F6] ${className}`}
        >
            <header className="flex items-center justify-between gap-fib-13 px-fib-21 py-fib-13 bg-[#F8FAFC] dark:bg-[#000000] border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div className="flex items-center gap-fib-13 min-w-0">
                    <span
                        className={`font-mono tabular-nums text-microcopy uppercase shrink-0 ${
                            tierBadge === 'CLOUD' ? 'text-[#00AEEF]' : 'text-[#C68346]'
                        }`}
                    >
                        {tierBadge === 'CLOUD' ? 'TIN · GLB' : 'IN-SITU · DEM'}
                    </span>
                    <h3 className="text-h2-section font-semibold truncate">
                        {t('twin3d.title', 'GEMELO DIGITAL 3D')}
                    </h3>
                    {copperDomain && (
                        <span className="font-mono tabular-nums text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                            {copperDomain}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-fib-8 shrink-0">
                    <button
                        type="button"
                        onClick={() => setShowDimensions((prev) => !prev)}
                        title={t('twin3d.dimensions_toggle', 'COTAS 3D')}
                        aria-label={t('twin3d.dimensions_toggle', 'COTAS 3D')}
                        aria-pressed={showDimensions}
                        disabled={!hasRenderableMesh || webglUnavailable}
                        className={`${FLAT_ICON_BTN_CLASS} min-w-[48px] min-h-[48px] ${
                            showDimensions ? 'text-[#00AEEF] dark:text-[#00AEEF]' : ''
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                        <span className="material-symbols-outlined text-[20px]">straighten</span>
                    </button>

                    {canToggleConfidence && (
                        <button
                            type="button"
                            onClick={() => setShowConfidenceLayer((prev) => !prev)}
                            title={t('twin3d.confidence_layer_toggle', 'CAPA CONFIANZA ISA-101')}
                            aria-label={t(
                                'twin3d.confidence_layer_toggle',
                                'CAPA CONFIANZA ISA-101'
                            )}
                            aria-pressed={showConfidenceLayer}
                            disabled={!hasRenderableMesh || webglUnavailable}
                            className={`${FLAT_ICON_BTN_CLASS} ${
                                showConfidenceLayer ? 'text-[#00AEEF] dark:text-[#00AEEF]' : ''
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                            <span className="material-symbols-outlined text-[20px]">layers</span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => setIsWireframe((prev) => !prev)}
                        title={t('twin3d.wireframe_toggle', 'MODO WIREFRAME')}
                        aria-label={t('twin3d.wireframe_toggle', 'MODO WIREFRAME')}
                        aria-pressed={isWireframe}
                        disabled={!hasRenderableMesh || webglUnavailable}
                        className={`${FLAT_ICON_BTN_CLASS} ${
                            isWireframe ? 'text-[#00AEEF] dark:text-[#00AEEF]' : ''
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                        <span className="material-symbols-outlined text-[20px]">grid_4x4</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => resetCameraFnRef.current?.()}
                        title={t('twin3d.reset_camera', 'Centrar cámara 3D')}
                        aria-label={t('twin3d.reset_camera', 'Centrar cámara 3D')}
                        disabled={!hasRenderableMesh || webglUnavailable}
                        className={`${FLAT_ICON_BTN_CLASS} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                        <span className="material-symbols-outlined text-[20px]">
                            center_focus_strong
                        </span>
                    </button>

                    {hasRenderableMesh && loadFailed && hasCleanMeshUrl && (
                        <button
                            type="button"
                            onClick={() => setRetryCounter((c) => c + 1)}
                            title={t('twin3d.retry_load', 'REINTENTAR')}
                            aria-label={t('twin3d.retry_load', 'REINTENTAR')}
                            className={`${FLAT_ICON_BTN_CLASS} text-[#C68346]`}
                        >
                            <span className="material-symbols-outlined text-[20px]">refresh</span>
                        </button>
                    )}
                </div>
            </header>

            {isLoading && (
                <div className="px-fib-21 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border-b border-[#E2E8F0] dark:border-[#12151C]">
                    <M3LinearProgress
                        indeterminate
                        ariaLabel={t('twin3d.loading_mesh', 'CARGANDO MALLA .glb...')}
                    />
                </div>
            )}

            <div className="relative w-full bg-[#F8FAFC] dark:bg-[#000000]">
                {hasRenderableMesh && !webglUnavailable ? (
                    <div
                        ref={viewportHostRef}
                        style={{ height: `${heightPx}px`, touchAction: 'none' }}
                        className="w-full relative overflow-hidden rounded-none"
                    />
                ) : (
                    <div className="px-fib-21 py-fib-34 flex flex-col items-start gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                        <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                            {isLoading
                                ? t('twin3d.loading_mesh', 'CARGANDO MALLA .glb...')
                                : t('twin3d.no_model_3d', 'SIN MODELO 3D')}
                        </p>
                        {!isLoading && failureReason && (
                            <p className="text-microcopy font-mono uppercase text-[#C68346]">
                                {failureReason}
                            </p>
                        )}
                        {!isLoading && loadFailed && hasCleanMeshUrl && (
                            <button
                                type="button"
                                onClick={() => setRetryCounter((c) => c + 1)}
                                title={t('twin3d.retry_load', 'REINTENTAR')}
                                aria-label={t('twin3d.retry_load', 'REINTENTAR')}
                                className={`${FLAT_ICON_BTN_CLASS} text-[#00AEEF]`}
                            >
                                <span className="material-symbols-outlined text-[22px]">
                                    refresh
                                </span>
                            </button>
                        )}
                        {webglUnavailable && hasRenderableMesh && (
                            <p className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t(
                                    'twin3d.webgl_fallback_notice',
                                    'MODO INFORME TABULAR SIN CONTEXTO WEBGL ACTIVO'
                                )}
                            </p>
                        )}
                    </div>
                )}
            </div>

            <footer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-fib-13 px-fib-21 py-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D]">
                <div className="flex flex-col gap-fib-8 min-w-0">
                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('twin3d.dimensions_label', 'DIMENSIONES (X x Z x H)')}
                    </span>
                    <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] truncate">
                        {dimensionsLabel}
                    </span>
                </div>

                <div className="flex flex-col gap-fib-8 min-w-0">
                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('twin3d.tin_volume_label', 'VOLUMEN TIN (V_TIN)')}
                    </span>
                    <span className="text-data-dense font-mono tabular-nums text-[#C68346] font-bold truncate">
                        {volumeLabel}
                    </span>
                </div>

                <div className="flex flex-col gap-fib-8 min-w-0">
                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('twin3d.triangles_label', 'TRIÁNGULOS TIN')}
                    </span>
                    <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] truncate">
                        {trianglesLabel}
                    </span>
                </div>

                <div className="flex flex-col gap-fib-8 min-w-0">
                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('twin3d.cas_trace_label', 'TRAZABILIDAD CAS .GLB')}
                    </span>
                    <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] truncate">
                        {casLabel}
                    </span>
                </div>

                {(casMetrics?.sha256 || telemetry?.sourceLabel) && (
                    <div className="sm:col-span-2 lg:col-span-4 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap items-center justify-between gap-fib-13">
                        <span className="text-microcopy font-mono tabular-nums uppercase text-[#475569] dark:text-[#8A93A6]">
                            {telemetry?.sourceLabel || meshSource || PENDING_RECORD}
                        </span>
                        {casMetrics?.sha256 && (
                            <div className="flex items-center gap-fib-8 min-w-0">
                                <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] select-text truncate max-w-[260px]">
                                    SHA-256: {casMetrics.sha256}
                                </span>
                                <CopyButton
                                    value={casMetrics.sha256}
                                    title={t('core_common.copy_value', 'Copiar valor')}
                                />
                            </div>
                        )}
                    </div>
                )}
            </footer>
        </section>
    );
};

export default StockpileTwin3D;
