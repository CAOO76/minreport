import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CanonicalGeoFix } from '../../contracts/geo.contracts';
import { coreAuthFetch } from '../../core/network/coreAuthFetch';
import { getOfflineTile, putOfflineTile } from '../../core/geo/pmtilesOfflineStore';
import {
    buildCanonicalGeoFix,
    wgs84ToUtm,
} from '../../core/geo/wgs84UtmProjection';
import { CopyButton } from '../common/CopyButton';

/**
 * MINREPORT SOVEREIGN GEO MAP (Canvas 2D / PMTiles Offline / UTM Metric Grid)
 * Estándar UI/UX Minimalismo Industrial Puro (GEMINI.md §3-4):
 * - Cero librerías externas de mapas o scripts de terceros.
 * - Tipografía Atkinson Hyperlegible Next/Mono (tabular-nums).
 * - Acentos exclusivos #C68346 (Cobre) y #00AEEF (Cian), soporte dual Light/Dark.
 * - Geometría 0px (rounded-none), cero sombras (shadow-none).
 * - Liberación estricta de memoria GPU/Canvas al desmontar (`disposeCanvasGpuResources`).
 */

const UNDECLARED = '[Información técnica no declarada en ficha]';
const DEFAULT_CENTER = { lat: -23.6509, lng: -70.3975 };
const DEFAULT_ZOOM_WITH_FIX = 14;
const DEFAULT_ZOOM_EMPTY = 5;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;
const TILE_SIZE = 256;
const METRIC_STEPS = [
    10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000,
    500000,
];
const ICON_BTN_CLASS =
    'bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none inline-flex items-center justify-center';

export interface SovereignGeoMapProps {
    fix: CanonicalGeoFix | null;
    interactive?: boolean;
    label?: string;
    basemapId?: string;
    onSelectCoordinates?: (coords: {
        lat: number;
        lng: number;
        fix: CanonicalGeoFix;
    }) => void;
    onCaptureCurrent?: () => void;
    className?: string;
    heightPx?: number;
}

type DecodedTileAsset = ImageBitmap | HTMLImageElement;

function latLngToWorldPx(lat: number, lng: number, zoom: number): { x: number; y: number } {
    const scale = TILE_SIZE * Math.pow(2, zoom);
    const x = ((lng + 180) / 360) * scale;
    const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
    const sinLat = Math.sin((clampedLat * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
    return { x, y };
}

function worldPxToLatLng(x: number, y: number, zoom: number): { lat: number; lng: number } {
    const scale = TILE_SIZE * Math.pow(2, zoom);
    const wrappedX = ((x % scale) + scale) % scale;
    const lng = (wrappedX / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / scale;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return {
        lat: Math.max(-80, Math.min(84, lat)),
        lng: Math.max(-180, Math.min(180, lng)),
    };
}

function chooseMetricStep(metersPerPx: number): number {
    for (const step of METRIC_STEPS) {
        const px = step / metersPerPx;
        if (px >= 58 && px <= 145) {
            return step;
        }
    }
    return METRIC_STEPS[METRIC_STEPS.length - 1];
}

function formatMetricDistance(meters: number): string {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 1)} km`;
    }
    return `${meters} m`;
}

async function decodeTileBytes(bytes: Uint8Array): Promise<DecodedTileAsset | null> {
    if (bytes.byteLength < 8) return null;
    const bufferCopy = new Uint8Array(bytes.byteLength);
    bufferCopy.set(bytes);
    const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
    const isSvg = head.startsWith('<svg') || head.startsWith('<?xml');
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isWebp =
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;

    if (!isSvg && !isPng && !isJpg && !isWebp) {
        return null;
    }

    const mime = isSvg
        ? 'image/svg+xml'
        : isJpg
          ? 'image/jpeg'
          : isWebp
            ? 'image/webp'
            : 'image/png';
    const blob = new Blob([bufferCopy.buffer], { type: mime });

    if (typeof createImageBitmap === 'function' && !isSvg) {
        try {
            return await createImageBitmap(blob);
        } catch {
            // Fallback a HTMLImageElement
        }
    }

    if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') {
        return null;
    }

    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('Fallo decodificando tesela cartográfica.'));
            el.src = url;
        });
        return img;
    } catch {
        return null;
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function disposeCanvasGpuResources(canvas: HTMLCanvasElement | null): void {
    if (!canvas) return;
    try {
        const gl =
            (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ||
            (canvas.getContext('webgl') as WebGLRenderingContext | null);
        if (gl) {
            const loseContextExt = gl.getExtension('WEBGL_lose_context');
            loseContextExt?.loseContext();
        }
    } catch {
        // Si el canvas ya posee contexto 2D activo, omitir WebGL sin lanzar errores
    }
    canvas.width = 0;
    canvas.height = 0;
}

export const SovereignGeoMap: React.FC<SovereignGeoMapProps> = ({
    fix,
    interactive = false,
    label,
    basemapId = 'minreport-basemap-cl',
    onSelectCoordinates,
    onCaptureCurrent,
    className = '',
    heightPx = 300,
}) => {
    const { t } = useTranslation();
    const undeclaredText = t('core_common.undeclared_tech_value', UNDECLARED);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rafRef = useRef<number | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const tileCacheRef = useRef<Map<string, DecodedTileAsset>>(new Map());
    const pendingTilesRef = useRef<Set<string>>(new Set());
    const failedTilesRef = useRef<Set<string>>(new Set());

    const [viewCenter, setViewCenter] = useState<{ lat: number; lng: number }>(() =>
        fix ? { lat: fix.lat, lng: fix.lng } : DEFAULT_CENTER
    );
    const [zoom, setZoom] = useState<number>(() =>
        fix ? DEFAULT_ZOOM_WITH_FIX : DEFAULT_ZOOM_EMPTY
    );
    const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() =>
        typeof document !== 'undefined'
            ? document.documentElement.classList.contains('dark')
            : false
    );
    const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
        width: 560,
        height: heightPx,
    });
    const [tileTick, setTileTick] = useState(0);

    const dragStateRef = useRef<{
        active: boolean;
        startX: number;
        startY: number;
        lastX: number;
        lastY: number;
        movedPx: number;
    }>({
        active: false,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        movedPx: 0,
    });

    // Sincronizar centro cuando llega un nuevo fix
    useEffect(() => {
        if (fix) {
            setViewCenter({ lat: fix.lat, lng: fix.lng });
            setZoom((prev) => (prev < 11 ? DEFAULT_ZOOM_WITH_FIX : prev));
        }
    }, [fix]);

    // Observar cambios de tema Light/Dark en <html>
    useEffect(() => {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
            return;
        }
        const root = document.documentElement;
        const syncTheme = () => setIsDarkTheme(root.classList.contains('dark'));
        syncTheme();
        const observer = new MutationObserver(syncTheme);
        observer.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    // Observar dimensiones reales del contenedor
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            const width = Math.max(240, Math.round(rect.width));
            setViewportSize({ width, height: heightPx });
        };

        updateSize();

        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(updateSize);
            ro.observe(el);
            return () => ro.disconnect();
        }

        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, [heightPx]);

    // Limpieza obligatoria GPU/Canvas, rAF, AbortController y bitmaps al desmontar
    useEffect(() => {
        const canvasEl = canvasRef.current;
        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            tileCacheRef.current.forEach((asset) => {
                if ('close' in asset && typeof asset.close === 'function') {
                    try {
                        asset.close();
                    } catch {
                        // No-op
                    }
                }
            });
            tileCacheRef.current.clear();
            pendingTilesRef.current.clear();
            disposeCanvasGpuResources(canvasEl);
        };
    }, []);

    const ensureTileLoaded = useCallback(
        async (z: number, tx: number, ty: number, signal: AbortSignal) => {
            const key = `${basemapId}:${z}:${tx}:${ty}`;
            if (
                tileCacheRef.current.has(key) ||
                pendingTilesRef.current.has(key) ||
                failedTilesRef.current.has(key)
            ) {
                return;
            }

            pendingTilesRef.current.add(key);
            try {
                let bytes = await getOfflineTile(basemapId, z, tx, ty);

                if (
                    !bytes &&
                    !signal.aborted &&
                    (typeof navigator === 'undefined' || navigator.onLine)
                ) {
                    try {
                        const res = await coreAuthFetch(
                            `/api/geo/pmtiles/${encodeURIComponent(basemapId)}/tile/${z}/${tx}/${ty}`,
                            { signal }
                        );
                        if (res.ok) {
                            const buf = await res.arrayBuffer();
                            bytes = new Uint8Array(buf);
                            await putOfflineTile(basemapId, z, tx, ty, bytes).catch(() => {});
                        } else {
                            failedTilesRef.current.add(key);
                        }
                    } catch {
                        if (!signal.aborted) {
                            failedTilesRef.current.add(key);
                        }
                    }
                } else if (!bytes) {
                    failedTilesRef.current.add(key);
                }

                if (bytes && !signal.aborted) {
                    const decoded = await decodeTileBytes(bytes);
                    if (decoded && !signal.aborted) {
                        if (tileCacheRef.current.size >= 128) {
                            const firstKey = tileCacheRef.current.keys().next().value;
                            if (firstKey) {
                                const old = tileCacheRef.current.get(firstKey);
                                if (old && 'close' in old && typeof old.close === 'function') {
                                    old.close();
                                }
                                tileCacheRef.current.delete(firstKey);
                            }
                        }
                        tileCacheRef.current.set(key, decoded);
                        setTileTick((t) => t + 1);
                    }
                }
            } finally {
                pendingTilesRef.current.delete(key);
            }
        },
        [basemapId]
    );

    // Renderizado principal en Canvas 2D
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
        }

        rafRef.current = requestAnimationFrame(() => {
            const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
            const cssW = viewportSize.width;
            const cssH = viewportSize.height;

            canvas.width = Math.round(cssW * dpr);
            canvas.height = Math.round(cssH * dpr);

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const bg = isDarkTheme ? '#07090D' : '#F8FAFC';
            const gridStroke = isDarkTheme ? '#12151C' : '#E2E8F0';
            const subText = isDarkTheme ? '#8A93A6' : '#475569';
            const primaryText = isDarkTheme ? '#F3F4F6' : '#0F172A';

            // 1. Fondo industrial plano
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, cssW, cssH);

            // 2. Teselas PMTiles (cacheadas offline o bajo demanda)
            const intZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom)));
            const centerWorld = latLngToWorldPx(viewCenter.lat, viewCenter.lng, intZoom);
            const topLeftWorldX = centerWorld.x - cssW / 2;
            const topLeftWorldY = centerWorld.y - cssH / 2;
            const maxTileIdx = Math.pow(2, intZoom);

            const minTx = Math.floor(topLeftWorldX / TILE_SIZE);
            const maxTx = Math.floor((topLeftWorldX + cssW) / TILE_SIZE);
            const minTy = Math.max(0, Math.floor(topLeftWorldY / TILE_SIZE));
            const maxTy = Math.min(maxTileIdx - 1, Math.floor((topLeftWorldY + cssH) / TILE_SIZE));

            for (let tx = minTx; tx <= maxTx; tx++) {
                const wrappedTx = ((tx % maxTileIdx) + maxTileIdx) % maxTileIdx;
                for (let ty = minTy; ty <= maxTy; ty++) {
                    const key = `${basemapId}:${intZoom}:${wrappedTx}:${ty}`;
                    const cachedAsset = tileCacheRef.current.get(key);
                    const drawX = Math.round(tx * TILE_SIZE - topLeftWorldX);
                    const drawY = Math.round(ty * TILE_SIZE - topLeftWorldY);

                    if (cachedAsset) {
                        ctx.save();
                        ctx.globalAlpha = isDarkTheme ? 0.36 : 0.45;
                        ctx.drawImage(cachedAsset, drawX, drawY, TILE_SIZE, TILE_SIZE);
                        ctx.restore();
                    } else {
                        void ensureTileLoaded(intZoom, wrappedTx, ty, controller.signal);
                    }
                }
            }

            // 3. Grilla métrica UTM exacta
            const metersPerPx =
                (156543.03392 * Math.cos((viewCenter.lat * Math.PI) / 180)) /
                Math.pow(2, zoom);
            const metricStep = chooseMetricStep(metersPerPx);
            const stepPx = metricStep / metersPerPx;

            let centerUtmE = 500000;
            let centerUtmN = 0;
            let utmZoneLabel = 'UTM';
            try {
                const utmCenter = wgs84ToUtm(viewCenter.lat, viewCenter.lng);
                centerUtmE = utmCenter.eastingM;
                centerUtmN = utmCenter.northingM;
                utmZoneLabel = `${String(utmCenter.zone).padStart(2, '0')}${utmCenter.band}`;
            } catch {
                // Coordenadas en polos extremos
            }

            const firstEastingTick =
                Math.floor((centerUtmE - (cssW / 2) * metersPerPx) / metricStep) * metricStep;
            const lastEastingTick =
                Math.ceil((centerUtmE + (cssW / 2) * metersPerPx) / metricStep) * metricStep;

            const firstNorthingTick =
                Math.floor((centerUtmN - (cssH / 2) * metersPerPx) / metricStep) * metricStep;
            const lastNorthingTick =
                Math.ceil((centerUtmN + (cssH / 2) * metersPerPx) / metricStep) * metricStep;

            ctx.lineWidth = 1;
            ctx.font = '10px "Atkinson Hyperlegible Mono", monospace';

            for (let eTick = firstEastingTick; eTick <= lastEastingTick; eTick += metricStep) {
                const px = Math.round(cssW / 2 + (eTick - centerUtmE) / metersPerPx) + 0.5;
                if (px < 0 || px > cssW) continue;
                ctx.strokeStyle = gridStroke;
                ctx.beginPath();
                ctx.moveTo(px, 0);
                ctx.lineTo(px, cssH);
                ctx.stroke();

                if (stepPx >= 48) {
                    ctx.fillStyle = subText;
                    ctx.fillText(`${Math.round(eTick)}E`, px + 4, 14);
                }
            }

            for (let nTick = firstNorthingTick; nTick <= lastNorthingTick; nTick += metricStep) {
                const py = Math.round(cssH / 2 - (nTick - centerUtmN) / metersPerPx) + 0.5;
                if (py < 0 || py > cssH) continue;
                ctx.strokeStyle = gridStroke;
                ctx.beginPath();
                ctx.moveTo(0, py);
                ctx.lineTo(cssW, py);
                ctx.stroke();

                if (stepPx >= 48) {
                    ctx.fillStyle = subText;
                    ctx.fillText(`${Math.round(nTick)}N`, 8, py - 4);
                }
            }

            // 4. Retícula central de referencia cuando no hay fix
            const viewCenterX = cssW / 2;
            const viewCenterY = cssH / 2;

            // 5. Marcador y anillo de incertidumbre si existe fix
            if (fix) {
                const exactWorldCenter = latLngToWorldPx(viewCenter.lat, viewCenter.lng, zoom);
                const fixWorld = latLngToWorldPx(fix.lat, fix.lng, zoom);
                const mx = viewCenterX + (fixWorld.x - exactWorldCenter.x);
                const my = viewCenterY + (fixWorld.y - exactWorldCenter.y);

                if (typeof fix.accuracyM === 'number' && fix.accuracyM > 0) {
                    const radiusPx = Math.max(8, Math.min(220, fix.accuracyM / metersPerPx));
                    ctx.save();
                    ctx.fillStyle = 'rgba(0, 174, 239, 0.12)';
                    ctx.strokeStyle = '#00AEEF';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 3]);
                    ctx.beginPath();
                    ctx.arc(mx, my, radiusPx, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.restore();
                }

                // Mira ortogonal industrial en Cobre #C68346
                ctx.strokeStyle = '#C68346';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(mx - 18, my);
                ctx.lineTo(mx + 18, my);
                ctx.moveTo(mx, my - 18);
                ctx.lineTo(mx, my + 18);
                ctx.stroke();

                // Marcador cuadrado 0px
                ctx.fillStyle = '#C68346';
                ctx.fillRect(Math.round(mx - 5), Math.round(my - 5), 10, 10);
                ctx.strokeStyle = bg;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(Math.round(mx - 5), Math.round(my - 5), 10, 10);

                const cleanLabel = (label || '').trim();
                if (cleanLabel) {
                    const tagText = cleanLabel.slice(0, 36).toUpperCase();
                    ctx.font = '700 10px "Atkinson Hyperlegible Mono", monospace';
                    const textW = ctx.measureText(tagText).width;
                    const boxX = Math.min(cssW - textW - 22, Math.max(8, mx + 12));
                    const boxY = Math.max(24, my - 22);
                    ctx.fillStyle = isDarkTheme ? '#000000' : '#FFFFFF';
                    ctx.fillRect(boxX, boxY, textW + 12, 18);
                    ctx.strokeStyle = '#C68346';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(boxX + 0.5, boxY + 0.5, textW + 11, 17);
                    ctx.fillStyle = primaryText;
                    ctx.fillText(tagText, boxX + 6, boxY + 12);
                }
            }

            // 6. Rosa Norte geométrica (esquina superior derecha)
            const compassX = cssW - 28;
            const compassY = 34;
            ctx.save();
            ctx.translate(compassX, compassY);
            ctx.fillStyle = '#00AEEF';
            ctx.beginPath();
            ctx.moveTo(0, -13);
            ctx.lineTo(6, 4);
            ctx.lineTo(0, 0);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#C68346';
            ctx.beginPath();
            ctx.moveTo(0, -13);
            ctx.lineTo(-6, 4);
            ctx.lineTo(0, 0);
            ctx.closePath();
            ctx.fill();

            ctx.font = '700 10px "Atkinson Hyperlegible Mono", monospace';
            ctx.fillStyle = primaryText;
            ctx.textAlign = 'center';
            ctx.fillText('N', 0, 16);
            ctx.restore();

            // 7. Barra de escala métrica exacta (esquina inferior izquierda)
            const scaleBarWidth = Math.max(40, Math.min(150, Math.round(stepPx)));
            const scaleMetersShown = Math.round(scaleBarWidth * metersPerPx);
            const scaleLabelText = formatMetricDistance(
                scaleMetersShown > 0 ? scaleMetersShown : metricStep
            );
            const scaleX = 14;
            const scaleY = cssH - 18;

            ctx.strokeStyle = '#00AEEF';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(scaleX, scaleY);
            ctx.lineTo(scaleX + scaleBarWidth, scaleY);
            ctx.moveTo(scaleX, scaleY - 5);
            ctx.lineTo(scaleX, scaleY + 3);
            ctx.moveTo(scaleX + scaleBarWidth, scaleY - 5);
            ctx.lineTo(scaleX + scaleBarWidth, scaleY + 3);
            ctx.stroke();

            ctx.font = '700 10px "Atkinson Hyperlegible Mono", monospace';
            ctx.fillStyle = primaryText;
            ctx.textAlign = 'left';
            ctx.fillText(
                `${scaleLabelText} · ${utmZoneLabel} · Z${zoom.toFixed(0)}`,
                scaleX,
                scaleY - 8
            );
        });
    }, [
        basemapId,
        ensureTileLoaded,
        fix,
        isDarkTheme,
        label,
        tileTick,
        viewCenter,
        viewportSize,
        zoom,
    ]);

    const handleZoomIn = () => {
        setZoom((z) => Math.min(MAX_ZOOM, z + 1));
    };

    const handleZoomOut = () => {
        setZoom((z) => Math.max(MIN_ZOOM, z - 1));
    };

    const handleRecenter = () => {
        if (fix) {
            setViewCenter({ lat: fix.lat, lng: fix.lng });
            setZoom(DEFAULT_ZOOM_WITH_FIX);
        } else {
            setViewCenter(DEFAULT_CENTER);
            setZoom(DEFAULT_ZOOM_EMPTY);
        }
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!interactive) return;
        dragStateRef.current = {
            active: true,
            startX: e.clientX,
            startY: e.clientY,
            lastX: e.clientX,
            lastY: e.clientY,
            movedPx: 0,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!interactive || !dragStateRef.current.active) return;
        const dx = e.clientX - dragStateRef.current.lastX;
        const dy = e.clientY - dragStateRef.current.lastY;
        dragStateRef.current.lastX = e.clientX;
        dragStateRef.current.lastY = e.clientY;
        dragStateRef.current.movedPx += Math.hypot(dx, dy);

        const centerWorld = latLngToWorldPx(viewCenter.lat, viewCenter.lng, zoom);
        const nextCenter = worldPxToLatLng(centerWorld.x - dx, centerWorld.y - dy, zoom);
        setViewCenter(nextCenter);
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!interactive || !dragStateRef.current.active) return;
        const totalMoved = dragStateRef.current.movedPx;
        dragStateRef.current.active = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }

        if (totalMoved < 5 && onSelectCoordinates && canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            const offsetX = e.clientX - rect.left - rect.width / 2;
            const offsetY = e.clientY - rect.top - rect.height / 2;
            const centerWorld = latLngToWorldPx(viewCenter.lat, viewCenter.lng, zoom);
            const selected = worldPxToLatLng(
                centerWorld.x + offsetX,
                centerWorld.y + offsetY,
                zoom
            );
            const nextFix = buildCanonicalGeoFix({
                lat: selected.lat,
                lng: selected.lng,
                source: 'MANUAL_INPUT',
            });
            onSelectCoordinates({
                lat: nextFix.lat,
                lng: nextFix.lng,
                fix: nextFix,
            });
        }
    };

    const handleWheel = useCallback(
        (e: WheelEvent) => {
            if (!interactive) return;
            e.preventDefault();
            const delta = e.deltaY < 0 ? 1 : -1;
            setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)));
        },
        [interactive]
    );

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !interactive) return;
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            canvas.removeEventListener('wheel', handleWheel);
        };
    }, [handleWheel, interactive]);

    const wgsText = fix ? `${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}` : '';
    const utmText = fix ? fix.utm.formatted : '';

    return (
        <div
            ref={containerRef}
            className={`w-full border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] rounded-none shadow-none select-none font-sans ${className}`}
        >
            {/* Cabecera Técnica de Visor Geoespacial */}
            <div className="px-fib-13 py-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between gap-fib-8">
                <div className="flex items-center gap-fib-8 min-w-0">
                    <span className="text-microcopy font-mono uppercase text-[#C68346] truncate">
                        {fix
                            ? `${fix.srid} · ${fix.utm.epsg} · ${fix.source}`
                            : t('core_geo.header_title')}
                    </span>
                </div>

                {/* Controles Planos de Icono Exclusivo (Material Symbols Outlined, sin texto adosado) */}
                <div className="flex items-center gap-fib-8 shrink-0">
                    <button
                        type="button"
                        onClick={handleZoomIn}
                        title={t('core_geo.zoom_in')}
                        aria-label={t('core_geo.zoom_in')}
                        className={ICON_BTN_CLASS}
                    >
                        <span className="material-symbols-outlined text-[18px]">add</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleZoomOut}
                        title={t('core_geo.zoom_out')}
                        aria-label={t('core_geo.zoom_out')}
                        className={ICON_BTN_CLASS}
                    >
                        <span className="material-symbols-outlined text-[18px]">remove</span>
                    </button>
                    {onCaptureCurrent && (
                        <button
                            type="button"
                            onClick={onCaptureCurrent}
                            title={t('core_geo.capture_gnss')}
                            aria-label={t('core_geo.capture_gnss')}
                            className={ICON_BTN_CLASS}
                        >
                            <span className="material-symbols-outlined text-[18px] text-[#00AEEF]">
                                my_location
                            </span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleRecenter}
                        title={t('core_geo.recenter')}
                        aria-label={t('core_geo.recenter')}
                        className={ICON_BTN_CLASS}
                    >
                        <span className="material-symbols-outlined text-[18px]">
                            filter_center_focus
                        </span>
                    </button>
                </div>
            </div>

            {/* Lienzo Cartográfico Soberano */}
            <div className="relative w-full overflow-hidden bg-[#F8FAFC] dark:bg-[#07090D]">
                <canvas
                    ref={canvasRef}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    style={{ width: '100%', height: `${heightPx}px`, display: 'block' }}
                    className={interactive ? 'cursor-crosshair touch-none' : 'cursor-default'}
                    aria-label={t('core_geo.canvas_aria')}
                />

                {!fix && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-fib-21">
                        <span className="px-fib-13 py-fib-8 bg-[#FFFFFF]/90 dark:bg-[#000000]/90 border border-[#E2E8F0] dark:border-[#12151C] text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072] rounded-none shadow-none">
                            {undeclaredText}
                        </span>
                    </div>
                )}
            </div>

            {/* Telemetría Coordenadas WGS84 / UTM con Copia Determinista */}
            <div className="px-fib-13 py-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] grid grid-cols-1 md:grid-cols-2 gap-fib-8">
                <div className="flex items-center justify-between gap-fib-8">
                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        WGS84 (EPSG:4326)
                    </span>
                    {fix ? (
                        <div className="inline-flex items-center gap-fib-8">
                            <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                {wgsText}
                            </span>
                            <CopyButton value={wgsText} title={t('core_geo.copy_wgs84')} />
                        </div>
                    ) : (
                        <span className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                            {undeclaredText}
                        </span>
                    )}
                </div>

                <div className="flex items-center justify-between gap-fib-8">
                    <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        UTM {fix ? `(${fix.utm.epsg})` : ''}
                    </span>
                    {fix ? (
                        <div className="inline-flex items-center gap-fib-8">
                            <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                {utmText}
                            </span>
                            <CopyButton value={utmText} title={t('core_geo.copy_utm')} />
                        </div>
                    ) : (
                        <span className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                            {undeclaredText}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SovereignGeoMap;
