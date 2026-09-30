import React, { useRef, useEffect, useState } from 'react';
import { RotateCw, ZoomIn, ZoomOut } from 'lucide-react';

interface Stockpile3DViewerProps {
    stockpileTag: string;
    material: string;
    volumeM3: number;
    density: number;
    shape: string;
    onClose?: () => void;
}

export const Stockpile3DViewer: React.FC<Stockpile3DViewerProps> = ({
    stockpileTag,
    material,
    volumeM3,
    density,
    shape,
    onClose
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [rotation, setRotation] = useState({ x: 35, y: 45 });
    const [zoom, setZoom] = useState(1);
    const [viewMode, setViewMode] = useState<'WIREFRAME' | 'HEATMAP' | 'CONTOURS'>('WIREFRAME');
    const animationFrameId = useRef<number | null>(null);

    // Renderizador WebGL/Canvas 2.5D de Alto Rendimiento (Higiene de GPU estricta)
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let isMounted = true;

        const render = () => {
            if (!isMounted) return;

            const width = canvas.width;
            const height = canvas.height;
            ctx.clearRect(0, 0, width, height);

            // Centro del viewport
            const cx = width / 2;
            const cy = height / 2 + 30;

            // Parámetros de proyección isométrica
            const radX = (rotation.x * Math.PI) / 180;
            const radY = (rotation.y * Math.PI) / 180;

            // Generación de malla paramétrica del acopio
            const rings = 14;
            const segments = 28;
            const maxRadius = 140 * zoom;
            const maxHeight = 110 * zoom;

            ctx.lineWidth = 1;

            // Dibujar elipse base
            ctx.strokeStyle = '#12151C';
            ctx.beginPath();
            ctx.ellipse(cx, cy, maxRadius * 1.1, maxRadius * 0.45, 0, 0, Math.PI * 2);
            ctx.stroke();

            // Dibujar curvas de nivel
            for (let r = rings; r >= 1; r--) {
                const hProgress = (rings - r) / rings;
                const ringRadius = maxRadius * (1 - hProgress * 0.75);
                const ringY = cy - (hProgress * maxHeight * Math.cos(radX));

                ctx.beginPath();
                if (viewMode === 'HEATMAP') {
                    // Gradiente de calor por presión / densidad
                    const hue = 190 + (hProgress * 50); // Cian a Amarillo
                    ctx.strokeStyle = `hsla(${hue}, 85%, 55%, ${0.3 + hProgress * 0.6})`;
                } else if (viewMode === 'CONTOURS') {
                    ctx.strokeStyle = r % 3 === 0 ? '#00AEEF' : 'rgba(255, 255, 255, 0.15)';
                } else {
                    ctx.strokeStyle = 'rgba(0, 174, 239, 0.4)';
                }

                for (let s = 0; s <= segments; s++) {
                    const angle = (s / segments) * Math.PI * 2 + radY;
                    const px = cx + Math.cos(angle) * ringRadius;
                    const py = ringY + Math.sin(angle) * ringRadius * 0.45;

                    if (s === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.stroke();
            }

            // Dibujar meridianos / líneas estructurales
            if (viewMode === 'WIREFRAME') {
                ctx.strokeStyle = 'rgba(255, 205, 0, 0.35)'; // Amarillo CABISEG sutil
                for (let s = 0; s < segments; s += 4) {
                    const angle = (s / segments) * Math.PI * 2 + radY;
                    ctx.beginPath();
                    for (let r = 0; r <= rings; r++) {
                        const hProgress = (rings - r) / rings;
                        const ringRadius = maxRadius * (1 - hProgress * 0.75);
                        const ringY = cy - (hProgress * maxHeight * Math.cos(radX));
                        const px = cx + Math.cos(angle) * ringRadius;
                        const py = ringY + Math.sin(angle) * ringRadius * 0.45;
                        if (r === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.stroke();
                }
            }

            // Vértice superior (Cresta del acopio)
            ctx.fillStyle = '#FFCD00';
            ctx.beginPath();
            ctx.arc(cx, cy - maxHeight * Math.cos(radX), 3, 0, Math.PI * 2);
            ctx.fill();

            // Ejes de coordenadas de ingeniería
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.beginPath();
            ctx.moveTo(30, height - 30);
            ctx.lineTo(70, height - 30); // Eje X (Este)
            ctx.moveTo(30, height - 30);
            ctx.lineTo(30, height - 70); // Eje Z (Cota)
            ctx.stroke();

            ctx.fillStyle = '#8A93A6';
            ctx.font = '9px monospace';
            ctx.fillText('+E (m)', 75, height - 28);
            ctx.fillText('+Z (m)', 22, height - 75);
        };

        render();

        return () => {
            isMounted = false;
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
            // Liberación de recursos GPU y context cleanup
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        };
    }, [rotation, zoom, viewMode]);

    return (
        <div className="bg-[#030406] border border-[#12151C] relative flex flex-col overflow-hidden">
            {/* HUD Superior de Control */}
            <div className="p-3 border-b border-[#12151C] flex items-center justify-between bg-[#07090D]">
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white font-mono">
                        GEMELO DIGITAL 3D: {stockpileTag}
                    </span>
                    <span className="text-[9px] text-[#8A93A6] font-mono hidden sm:inline">
                        ({material} · {shape})
                    </span>
                </div>

                <div className="flex items-center gap-1.5">
                    {(['WIREFRAME', 'HEATMAP', 'CONTOURS'] as const).map(mode => (
                        <button
                            key={mode}
                            onClick={() => setViewMode(mode)}
                            className={`px-2 py-0.5 text-[9px] font-bold uppercase font-mono transition-colors ${
                                viewMode === mode ? 'bg-[#00AEEF] text-black' : 'text-[#8A93A6] hover:text-white bg-white/5'
                            }`}
                        >
                            {mode}
                        </button>
                    ))}
                    {onClose && (
                        <button onClick={onClose} className="text-[#8A93A6] hover:text-white ml-2 text-xs">
                            Cerrar
                        </button>
                    )}
                </div>
            </div>

            {/* Canvas 3D */}
            <div className="relative h-64 sm:h-80 w-full flex items-center justify-center bg-radial-gradient">
                <canvas
                    ref={canvasRef}
                    width={520}
                    height={320}
                    className="w-full h-full cursor-grab active:cursor-grabbing"
                    onMouseMove={e => {
                        if (e.buttons === 1) {
                            setRotation(prev => ({
                                x: Math.max(10, Math.min(80, prev.x - e.movementY * 0.4)),
                                y: prev.y + e.movementX * 0.4
                            }));
                        }
                    }}
                />

                {/* Overlays de Telemetría HUD */}
                <div className="absolute top-3 left-3 space-y-1 font-mono text-[9px] pointer-events-none bg-black/70 p-2 border border-white/5">
                    <p className="text-[#8A93A6]">VOLUMEN: <span className="text-white font-bold">{volumeM3.toLocaleString('es-CL')} m³</span></p>
                    <p className="text-[#8A93A6]">DENSIDAD: <span className="text-[#00AEEF] font-bold">{density} t/m³</span></p>
                    <p className="text-[#8A93A6]">MASA EST.: <span className="text-[#FFCD00] font-bold">{(volumeM3 * density).toLocaleString('es-CL', { maximumFractionDigits: 1 })} Ton</span></p>
                </div>

                {/* Controles de Vista */}
                <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-black/80 p-1 border border-white/10">
                    <button
                        onClick={() => setZoom(prev => Math.min(1.8, prev + 0.15))}
                        className="p-1 text-[#8A93A6] hover:text-white"
                        title="Acercar"
                    >
                        <ZoomIn size={14} />
                    </button>
                    <button
                        onClick={() => setZoom(prev => Math.max(0.6, prev - 0.15))}
                        className="p-1 text-[#8A93A6] hover:text-white"
                        title="Alejar"
                    >
                        <ZoomOut size={14} />
                    </button>
                    <button
                        onClick={() => setRotation({ x: 35, y: 45 })}
                        className="p-1 text-[#8A93A6] hover:text-white"
                        title="Restablecer rotación"
                    >
                        <RotateCw size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Stockpile3DViewer;
