import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CopyButton } from '../../../components/common/CopyButton';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import { resolveStockpileMeshBinary } from '../core/services/StorageService';
import {
    buildStockpileGlbMesh,
    type GlbBoundingBoxM,
} from '../core/utils/glbMeshBuilder';

export interface StockpileTwin3DProps {
    meshUrl?: string | null;
    fallbackGeometry?: {
        type: string;
        dimensions: Record<string, number | undefined>;
    } | null;
    copperDomain?: string;
    tinVolumeM3?: number | null;
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
    boundingBoxM: GlbBoundingBoxM;
    triangleCount: number;
    vertexCount: number;
    tinVolumeM3: number | null;
    originalBytes?: number;
    optimizedBytes?: number;
    savingsPct?: number;
    sourceLabel: string;
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

function disposeMaterialResources(material: THREE.Material): void {
    const record = material as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        const value = record[key];
        if (
            value &&
            typeof value === 'object' &&
            'isTexture' in value &&
            typeof (value as THREE.Texture).dispose === 'function'
        ) {
            (value as THREE.Texture).dispose();
        }
    }
    material.dispose();
}

function disposeObject3DTree(root: THREE.Object3D): void {
    root.traverse((obj) => {
        const renderable = obj as unknown as {
            geometry?: THREE.BufferGeometry;
            material?: THREE.Material | THREE.Material[];
        };
        if (renderable.geometry && typeof renderable.geometry.dispose === 'function') {
            renderable.geometry.dispose();
        }
        if (renderable.material) {
            const mats = Array.isArray(renderable.material)
                ? renderable.material
                : [renderable.material];
            for (const mat of mats) {
                disposeMaterialResources(mat);
            }
        }
    });
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
    boundingBoxM: GlbBoundingBoxM;
    triangleCount: number;
    vertexCount: number;
    tinVolumeM3: number | null;
} {
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);

    let triangleCount = 0;
    let vertexCount = 0;
    let signedVolSum6 = 0;

    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const cross = new THREE.Vector3();

    root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const pos = mesh.geometry.getAttribute('position');
        if (!pos) return;
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
    return {
        boundingBoxM: {
            widthX: Number.isFinite(size.x) ? Math.round(size.x * 100) / 100 : 0,
            heightY: Number.isFinite(size.y) ? Math.round(size.y * 100) / 100 : 0,
            depthZ: Number.isFinite(size.z) ? Math.round(size.z * 100) / 100 : 0,
        },
        triangleCount,
        vertexCount,
        tinVolumeM3: Number.isFinite(tinVol) && tinVol > 0 ? Math.round(tinVol * 100) / 100 : null,
    };
}

function fitCameraToBox(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    box: GlbBoundingBoxM
): void {
    const maxDim = Math.max(box.widthX, box.heightY, box.depthZ, 2);
    const fovRad = (camera.fov * Math.PI) / 180;
    const distance = Math.max(4, (maxDim / (2 * Math.tan(fovRad / 2))) * 1.65);
    const targetY = Math.max(0.2, box.heightY * 0.42);
    camera.position.set(distance * 0.85, Math.max(box.heightY * 1.15, distance * 0.52), distance * 0.85);
    camera.near = Math.max(0.05, distance * 0.01);
    camera.far = Math.max(500, distance * 25);
    camera.updateProjectionMatrix();
    controls.target.set(0, targetY, 0);
    controls.update();
}

export const StockpileTwin3D: React.FC<StockpileTwin3DProps> = ({
    meshUrl,
    fallbackGeometry,
    copperDomain,
    tinVolumeM3,
    casMetrics,
    meshSource,
    className = '',
    heightPx = 340,
    compact = false,
}) => {
    const { t } = useTranslation();
    const viewportHostRef = useRef<HTMLDivElement | null>(null);
    const modelGroupRef = useRef<THREE.Group | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const gridRef = useRef<{
        helper: THREE.GridHelper | null;
        extent: number;
        divisions: number;
    }>({ helper: null, extent: 12, divisions: 12 });
    const resetCameraFnRef = useRef<(() => void) | null>(null);

    const [isWireframe, setIsWireframe] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [webglUnavailable, setWebglUnavailable] = useState(false);
    const [isDark, setIsDark] = useState<boolean>(() =>
        typeof document !== 'undefined'
            ? document.documentElement.classList.contains('dark')
            : false
    );
    const [meshBuffer, setMeshBuffer] = useState<ArrayBuffer | null>(null);
    const [telemetry, setTelemetry] = useState<ParsedMeshTelemetry | null>(null);

    const fallbackKey = useMemo(() => {
        if (!fallbackGeometry) return '';
        return JSON.stringify({
            type: fallbackGeometry.type,
            dimensions: fallbackGeometry.dimensions,
        });
    }, [fallbackGeometry]);

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

    // Cargar binario .glb desde meshUrl o generar deterministamente desde fallbackGeometry
    useEffect(() => {
        let cancelled = false;
        const cleanUrl = typeof meshUrl === 'string' ? meshUrl.trim() : '';
        const hasFallback = Boolean(fallbackGeometry && fallbackGeometry.type);

        if (!cleanUrl && !hasFallback) {
            setIsLoading(false);
            setMeshBuffer(null);
            setTelemetry(null);
            return;
        }

        setIsLoading(true);

        (async () => {
            let resolvedBuffer: ArrayBuffer | null = null;
            let resolvedMeta: ParsedMeshTelemetry | null = null;

            if (cleanUrl) {
                const fetched = await resolveStockpileMeshBinary(cleanUrl);
                if (fetched.arrayBuffer && fetched.arrayBuffer.byteLength >= 12) {
                    const magicView = new DataView(fetched.arrayBuffer);
                    const isGlbHeader =
                        magicView.getUint32(0, true) === 0x46546c67 &&
                        magicView.getUint32(4, true) === 2;
                    if (isGlbHeader) {
                        resolvedBuffer = fetched.arrayBuffer;
                        resolvedMeta = {
                            boundingBoxM: { widthX: 0, heightY: 0, depthZ: 0 },
                            triangleCount: 0,
                            vertexCount: 0,
                            tinVolumeM3: typeof tinVolumeM3 === 'number' ? tinVolumeM3 : null,
                            originalBytes: casMetrics?.originalBytes,
                            optimizedBytes:
                                casMetrics?.optimizedBytes ?? fetched.arrayBuffer.byteLength,
                            savingsPct: casMetrics?.savingsPct,
                            sourceLabel: meshSource || fetched.sourceLabel,
                        };
                    }
                }
            }

            if (!resolvedBuffer && fallbackGeometry) {
                const built = buildStockpileGlbMesh({
                    geometryType: fallbackGeometry.type,
                    dimensions: fallbackGeometry.dimensions || {},
                });
                if (built) {
                    resolvedBuffer = built.glbBuffer;
                    const orig = casMetrics?.originalBytes ?? built.rawUnindexedBytes;
                    const opt = casMetrics?.optimizedBytes ?? built.optimizedGlbBytes;
                    const pct =
                        typeof casMetrics?.savingsPct === 'number'
                            ? casMetrics.savingsPct
                            : orig > 0
                              ? Math.max(0, Math.round((1 - opt / orig) * 1000) / 10)
                              : 0;
                    resolvedMeta = {
                        boundingBoxM: built.boundingBoxM,
                        triangleCount: built.triangleCount,
                        vertexCount: built.vertexCount,
                        tinVolumeM3:
                            typeof tinVolumeM3 === 'number' ? tinVolumeM3 : built.tinVolumeM3,
                        originalBytes: orig,
                        optimizedBytes: opt,
                        savingsPct: pct,
                        sourceLabel: meshSource || 'LOCAL_DETERMINISTIC_TIN_GLB',
                    };
                }
            }

            if (cancelled) return;
            setMeshBuffer(resolvedBuffer);
            setTelemetry(resolvedMeta);
            setIsLoading(false);
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meshUrl, fallbackKey, meshSource]);

    // Actualizar material wireframe/sólido sin recrear la escena
    const applyWireframeState = useCallback((root: THREE.Object3D | null, wireframe: boolean) => {
        if (!root) return;
        root.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (!mesh.isMesh || !mesh.material) return;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of mats) {
                if (mat instanceof THREE.MeshStandardMaterial) {
                    mat.wireframe = wireframe;
                    mat.color.setHex(wireframe ? 0x00aeef : 0xc68346);
                    mat.emissive.setHex(wireframe ? 0x004966 : 0x000000);
                    mat.needsUpdate = true;
                } else if ('wireframe' in mat) {
                    (mat as THREE.MeshBasicMaterial).wireframe = wireframe;
                    (mat as THREE.MeshBasicMaterial).color?.setHex(wireframe ? 0x00aeef : 0xc68346);
                    mat.needsUpdate = true;
                }
            }
        });
    }, []);

    useEffect(() => {
        applyWireframeState(modelGroupRef.current, isWireframe);
    }, [isWireframe, applyWireframeState]);

    // Montar visor Three.js con limpieza GPU obligatoria
    useEffect(() => {
        const host = viewportHostRef.current;
        if (!host || !meshBuffer) {
            return;
        }

        let disposed = false;
        let rafId = 0;
        let renderer: THREE.WebGLRenderer | null = null;
        let controls: OrbitControls | null = null;
        let resizeObserver: ResizeObserver | null = null;
        let gridHelper: THREE.GridHelper | null = null;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(isDark ? (compact ? 0x030508 : 0x000000) : 0xf8fafc);
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
            return;
        }

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.maxPolarAngle = Math.PI * 0.495;
        controls.minDistance = 1.5;

        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 0.85);
        scene.add(hemiLight);

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
        keyLight.position.set(18, 28, 14);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0x94a3b8, 0.55);
        fillLight.position.set(-16, 12, -14);
        scene.add(fillLight);

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
                const gridExtent = Math.max(
                    12,
                    Math.ceil(Math.max(computed.boundingBoxM.widthX, computed.boundingBoxM.depthZ) * 1.8)
                );
                const divisions = Math.min(40, Math.max(12, Math.round(gridExtent)));
                gridHelper = new THREE.GridHelper(
                    gridExtent,
                    divisions,
                    isDark ? 0x334155 : 0x94a3b8,
                    isDark ? 0x12151c : 0xe2e8f0
                );
                gridRef.current = { helper: gridHelper, extent: gridExtent, divisions };
                scene.add(gridHelper);
                scene.add(root);
                modelGroupRef.current = root;

                applyWireframeState(root, isWireframe);
                if (controls) {
                    fitCameraToBox(camera, controls, computed.boundingBoxM);
                    resetCameraFnRef.current = () => {
                        if (controls) {
                            fitCameraToBox(camera, controls, computed.boundingBoxM);
                        }
                    };
                }

                setTelemetry((prev) => ({
                    boundingBoxM:
                        computed.boundingBoxM.widthX > 0
                            ? computed.boundingBoxM
                            : prev?.boundingBoxM || computed.boundingBoxM,
                    triangleCount:
                        computed.triangleCount > 0
                            ? computed.triangleCount
                            : prev?.triangleCount || 0,
                    vertexCount:
                        computed.vertexCount > 0
                            ? computed.vertexCount
                            : prev?.vertexCount || 0,
                    tinVolumeM3:
                        typeof tinVolumeM3 === 'number'
                            ? tinVolumeM3
                            : prev?.tinVolumeM3 ?? computed.tinVolumeM3,
                    originalBytes: prev?.originalBytes ?? casMetrics?.originalBytes,
                    optimizedBytes: prev?.optimizedBytes ?? casMetrics?.optimizedBytes,
                    savingsPct: prev?.savingsPct ?? casMetrics?.savingsPct,
                    sourceLabel: prev?.sourceLabel || meshSource || 'GLB_3D',
                }));
            })
            .catch(() => {
                if (disposed) return;
                if (fallbackGeometry) {
                    const localFallback = buildStockpileGlbMesh({
                        geometryType: fallbackGeometry.type,
                        dimensions: fallbackGeometry.dimensions || {},
                    });
                    if (localFallback && localFallback.glbBuffer !== meshBuffer) {
                        setMeshBuffer(localFallback.glbBuffer);
                        return;
                    }
                }
                setMeshBuffer(null);
            });

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
            });
            resizeObserver.observe(host);
        }

        const renderLoop = () => {
            if (disposed || !renderer) return;
            controls?.update();
            renderer.render(scene, camera);
            rafId = window.requestAnimationFrame(renderLoop);
        };
        rafId = window.requestAnimationFrame(renderLoop);

        return () => {
            disposed = true;
            resetCameraFnRef.current = null;
            modelGroupRef.current = null;
            sceneRef.current = null;
            gridRef.current = { helper: null, extent: 12, divisions: 12 };
            if (rafId) {
                window.cancelAnimationFrame(rafId);
            }
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            if (controls) {
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
    }, [meshBuffer, heightPx, compact]);

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
    }, [isDark, compact]);

    const effectiveTinVolume =
        typeof tinVolumeM3 === 'number' && Number.isFinite(tinVolumeM3)
            ? tinVolumeM3
            : telemetry?.tinVolumeM3 ?? null;

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
    const dimensionsLabel = hasDimensions && bbox
        ? `${bbox.widthX.toFixed(2)} x ${bbox.depthZ.toFixed(2)} x ${bbox.heightY.toFixed(2)} m`
        : UNDECLARED_VALUE;

    const trianglesLabel =
        telemetry && telemetry.triangleCount > 0
            ? telemetry.triangleCount.toLocaleString('en-US')
            : PENDING_RECORD;

    const volumeLabel =
        effectiveTinVolume !== null && Number.isFinite(effectiveTinVolume)
            ? `${effectiveTinVolume.toFixed(2)} m³`
            : UNDECLARED_VALUE;

    const hasRenderableMesh = Boolean(meshBuffer);

    if (compact) {
        const compactDimsText =
            hasDimensions && bbox
                ? `${bbox.widthX.toFixed(1)}×${bbox.depthZ.toFixed(1)}×${bbox.heightY.toFixed(1)} m`
                : '--';
        const compactVolText =
            effectiveTinVolume !== null && Number.isFinite(effectiveTinVolume)
                ? `${effectiveTinVolume.toFixed(2)} m³`
                : '--';
        const compactTriText =
            telemetry && telemetry.triangleCount > 0
                ? `${telemetry.triangleCount.toLocaleString('en-US')} TRI`
                : '-- TRI';

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

                    <span className="absolute top-fib-8 left-fib-13 z-10 pointer-events-none font-mono tabular-nums text-microcopy uppercase text-[#C68346]">
                        TIN · GLB
                    </span>

                    <div className="absolute top-fib-8 right-fib-8 z-10 flex items-center gap-fib-8">
                        <button
                            type="button"
                            onClick={() => setIsWireframe((prev) => !prev)}
                            title={t('twin3d.wireframe_toggle', 'MODO WIREFRAME')}
                            aria-label={t('twin3d.wireframe_toggle', 'MODO WIREFRAME')}
                            aria-pressed={isWireframe}
                            disabled={!hasRenderableMesh || webglUnavailable}
                            className={`${FLAT_ICON_BTN_CLASS} min-w-[40px] min-h-[40px] ${
                                isWireframe ? 'text-[#00AEEF] dark:text-[#00AEEF]' : ''
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                            <span className="material-symbols-outlined text-[18px]">grid_4x4</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => resetCameraFnRef.current?.()}
                            title={t('twin3d.reset_camera', 'Centrar cámara 3D')}
                            aria-label={t('twin3d.reset_camera', 'Centrar cámara 3D')}
                            disabled={!hasRenderableMesh || webglUnavailable}
                            className={`${FLAT_ICON_BTN_CLASS} min-w-[40px] min-h-[40px] disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                            <span className="material-symbols-outlined text-[18px]">
                                center_focus_strong
                            </span>
                        </button>
                    </div>

                    {hasRenderableMesh && !webglUnavailable ? (
                        <div
                            ref={viewportHostRef}
                            style={{ height: `${heightPx}px` }}
                            className="w-full relative overflow-hidden rounded-none"
                        />
                    ) : (
                        <div
                            style={{ height: `${heightPx}px` }}
                            className="w-full px-fib-21 flex flex-col items-center justify-center gap-fib-8 text-center"
                        >
                            <span className="material-symbols-outlined text-[28px] text-[#94A3B8] dark:text-[#5A6072]">
                                deployed_code
                            </span>
                            <span className="text-microcopy font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                {isLoading
                                    ? t('twin3d.loading_mesh', 'CARGANDO MALLA .glb...')
                                    : webglUnavailable
                                      ? 'WEBGL OFF'
                                      : PENDING_RECORD}
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between gap-fib-8 px-fib-13 py-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] bg-transparent font-mono tabular-nums text-microcopy text-[#475569] dark:text-[#8A93A6]">
                    <div className="flex items-center gap-fib-8 min-w-0 truncate">
                        <span className="truncate">{compactDimsText}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#C68346] font-bold shrink-0">{compactVolText}</span>
                        <span aria-hidden="true">·</span>
                        <span className="shrink-0">{compactTriText}</span>
                    </div>
                    <span className="uppercase text-[#00AEEF] shrink-0">3D</span>
                </div>
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
                    <span className="font-mono tabular-nums text-microcopy uppercase text-[#C68346] shrink-0">
                        TIN · GLB
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
                        style={{ height: `${heightPx}px` }}
                        className="w-full relative overflow-hidden rounded-none"
                    />
                ) : (
                    <div className="px-fib-21 py-fib-34 flex flex-col gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                        <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                            {isLoading
                                ? t('twin3d.loading_mesh', 'CARGANDO MALLA .glb...')
                                : t('twin3d.no_mesh_declared', UNDECLARED_VALUE)}
                        </p>
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
