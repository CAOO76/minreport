import React, { useState, useRef, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import { M3Chip } from './M3Chip';

interface VisionAnalyzerProps {
    context?: any;
    onAnalysisComplete: (result: { type: string; image: string; features?: { mean_luminance: number; std_dev: number } }) => void;
}

/**
 * VisionAnalyzer: Componente de Visión Computacional
 * Refactorizado bajo estándar Minimalismo Industrial Puro (GEMINI.md).
 * Libera explícitamente memoria de <canvas> tras muestreo y al desmontar.
 */
const VisionAnalyzer: React.FC<VisionAnalyzerProps> = ({ onAnalysisComplete }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [isCameraActive, setIsCameraActive] = useState(false);
    const [analysisState, setAnalysisState] = useState<'idle' | 'analyzing' | 'complete'>('idle');
    const [analysisResult, setAnalysisResult] = useState<{ mean_luminance: number; std_dev: number } | null>(null);
    const [capturedSnapshot, setCapturedSnapshot] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const streamRef = useRef<MediaStream | null>(null);
    const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const enableCamera = useCallback(async () => {
        setError(null);
        setIsCameraActive(false);

        try {
            if (timeoutIdRef.current) {
                clearTimeout(timeoutIdRef.current);
                timeoutIdRef.current = undefined;
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }

            timeoutIdRef.current = setTimeout(async () => {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
                    });
                    streamRef.current = stream;
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                        setIsCameraActive(true);
                    }
                } catch (err) {
                    console.error('Error al acceder a la cámara:', err);
                    setError('No se pudo acceder a la cámara. Verifique permisos.');
                } finally {
                    timeoutIdRef.current = undefined;
                }
            }, 500);
        } catch (err) {
            console.error('Error general en enableCamera:', err);
            setError('Error al iniciar la cámara.');
        }
    }, []);

    useEffect(() => {
        void enableCamera();
        const canvasEl = canvasRef.current;
        return () => {
            if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
            if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
            if (canvasEl) {
                canvasEl.width = 0;
                canvasEl.height = 0;
            }
        };
    }, [enableCamera]);

    const analyzeGranulometry = () => {
        if (!videoRef.current || !canvasRef.current) return;
        setAnalysisState('analyzing');
        setAnalysisResult(null);
        setCapturedSnapshot('');
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        setTimeout(() => {
            try {
                canvas.width = Math.max(1, video.videoWidth);
                canvas.height = Math.max(1, video.videoHeight);
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                const totalPixels = Math.max(1, Math.floor(data.length / 4));
                const sampleSize = Math.min(5000, totalPixels);
                const step = Math.max(1, Math.floor(totalPixels / sampleSize));
                const luminances: number[] = [];
                for (let i = 0; i < sampleSize; i++) {
                    const index = ((i * step) % totalPixels) * 4;
                    const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
                    luminances.push(luminance);
                }
                const meanLuminance = luminances.reduce((a, b) => a + b, 0) / luminances.length;
                const stdDev = Math.sqrt(
                    luminances.map(l => (l - meanLuminance) ** 2).reduce((a, b) => a + b, 0) / luminances.length
                );

                const lowResImage = canvas.toDataURL('image/jpeg', 0.5);
                setCapturedSnapshot(lowResImage);
                setAnalysisResult({
                    mean_luminance: parseFloat(meanLuminance.toFixed(2)),
                    std_dev: parseFloat(stdDev.toFixed(2))
                });
                setAnalysisState('complete');
            } finally {
                canvas.width = 0;
                canvas.height = 0;
            }
        }, 400);
    };

    const handleAcceptAnalysis = () => {
        if (!analysisResult || !capturedSnapshot) return;
        try {
            onAnalysisComplete({
                type: 'texture_signature',
                image: capturedSnapshot,
                features: analysisResult
            });
        } catch (err) {
            console.error('Error Analysis Completion:', err);
            setError('Error al procesar captura.');
        } finally {
            if (canvasRef.current) {
                canvasRef.current.width = 0;
                canvasRef.current.height = 0;
            }
        }
    };

    return (
        <div className="font-atkinson w-full h-full bg-[#000000] relative overflow-hidden rounded-none shadow-none border border-[#E2E8F0] dark:border-[#12151C] select-none">
            <canvas ref={canvasRef} className="hidden" />

            {isCameraActive ? (
                <>
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover z-0"
                    />

                    <div className="absolute inset-0 z-10 flex flex-col justify-between p-[21px] pointer-events-none">
                        {/* Header Overlay */}
                        <div className="w-full flex justify-center mt-safe-top pointer-events-auto">
                            {analysisState === 'analyzing' && (
                                <M3Chip label="Escaneando Textura..." className="animate-pulse" />
                            )}
                            {analysisState === 'complete' && analysisResult && (
                                <M3Chip
                                    label={`Textura L=${analysisResult.mean_luminance} · σ=${analysisResult.std_dev}`}
                                    selected
                                />
                            )}
                        </div>

                        {/* Footer Actions */}
                        <div className="w-full flex justify-center items-center pb-safe-bottom pointer-events-auto landscape:absolute landscape:right-8 landscape:bottom-1/2 landscape:translate-y-1/2 landscape:pb-0">
                            {analysisState !== 'complete' ? (
                                <button
                                    type="button"
                                    onClick={analyzeGranulometry}
                                    disabled={analysisState === 'analyzing'}
                                    className={clsx(
                                        'w-24 h-24 rounded-none flex items-center justify-center shadow-none transition-colors duration-200 overflow-hidden cursor-pointer',
                                        'bg-[#FFFFFF] text-[#0F172A] hover:bg-[#F8FAFC]',
                                        'border-2 border-[#E2E8F0] hover:border-[#C68346]',
                                        { 'opacity-50 cursor-not-allowed': analysisState === 'analyzing' }
                                    )}
                                    aria-label="Analizar"
                                    title="Analizar"
                                >
                                    <span className={`material-symbols-outlined text-[44px] text-[#C68346] ${analysisState === 'analyzing' ? 'animate-spin' : ''}`}>
                                        {analysisState === 'analyzing' ? 'autorenew' : 'shutter_speed'}
                                    </span>
                                </button>
                            ) : (
                                <div className="flex items-center gap-[13px] bg-[#FFFFFF] dark:bg-[#07090D] p-[13px] rounded-none border border-[#E2E8F0] dark:border-[#12151C] shadow-none landscape:flex-col">
                                    <button
                                        type="button"
                                        onClick={() => setAnalysisState('idle')}
                                        className="bg-transparent border-0 outline-none p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer"
                                        title="Reintentar"
                                        aria-label="Reintentar"
                                    >
                                        <span className="material-symbols-outlined text-[32px]">refresh</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleAcceptAnalysis}
                                        className="w-16 h-16 rounded-none font-bold bg-[#C68346] text-[#FFFFFF] shadow-none transition-colors flex items-center justify-center overflow-hidden cursor-pointer"
                                        title="Usar Resultado"
                                        aria-label="Usar Resultado"
                                    >
                                        <span className="material-symbols-outlined text-[36px]">check</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            ) : (
                <div className="flex items-center justify-center h-full relative z-[999] bg-[#FFFFFF] dark:bg-[#000000]">
                    {error ? (
                        <div className="flex flex-col items-center gap-[13px] p-[34px] text-center max-w-sm">
                            <span className="material-symbols-outlined text-5xl text-[#C68346] mb-1">videocam_off</span>
                            <p className="text-[#0F172A] dark:text-[#F3F4F6] text-base font-medium">{error}</p>
                            <button
                                type="button"
                                onClick={enableCamera}
                                className="mt-2 px-[21px] py-[13px] bg-[#C68346] text-[#FFFFFF] rounded-none font-bold shadow-none hover:bg-[#C68346]/90 transition-colors cursor-pointer"
                            >
                                Reintentar
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-[13px]">
                            <div className="w-12 h-12 border-4 border-[#C68346] border-t-transparent rounded-none animate-spin" />
                            <p className="text-[#475569] dark:text-[#8A93A6] font-medium animate-pulse">Iniciando cámara...</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default VisionAnalyzer;
