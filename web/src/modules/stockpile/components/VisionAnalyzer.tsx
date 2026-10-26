import React, { useState, useRef, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import { M3Chip } from './M3Chip';
import type { SecureContext } from '@minreport/sdk';

// --- Props del Componente ---
interface VisionAnalyzerProps {
  context: SecureContext;
  onAnalysisComplete: (result: { type: string; image: string }) => void;
}

/**
 * VisionAnalyzer: Componente de Visión Computacional
 * Refactorizado para usar M3Chip y estilos Tailwind unificados.
 * Eliminada la predicción numérica de densidad por requerimiento industrial.
 */
const VisionAnalyzer: React.FC<VisionAnalyzerProps> = ({ onAnalysisComplete }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [analysisState, setAnalysisState] = useState<'idle' | 'analyzing' | 'complete'>('idle');
  const [analysisResult, setAnalysisResult] = useState<{ mean_luminance: number; std_dev: number } | null>(null);
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
          console.error("Error al acceder a la cámara:", err);
          setError('No se pudo acceder a la cámara. Verifique permisos.');
        } finally {
          timeoutIdRef.current = undefined;
        }
      }, 500);
    } catch (err) {
      console.error("Error general en enableCamera:", err);
      setError('Error al iniciar la cámara.');
    }
  }, []);

  useEffect(() => {
    enableCamera();
    return () => {
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    };
  }, [enableCamera]);

  const analyzeGranulometry = () => {
    if (!videoRef.current || !canvasRef.current) return;
    setAnalysisState('analyzing');
    setAnalysisResult(null);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    setTimeout(() => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const sampleSize = 5000;
      const luminances: number[] = [];
      for (let i = 0; i < sampleSize; i++) {
        const index = Math.floor(Math.random() * (data.length / 4)) * 4;
        const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
        luminances.push(luminance);
      }
      const meanLuminance = luminances.reduce((a, b) => a + b, 0) / luminances.length;
      const stdDev = Math.sqrt(luminances.map(l => (l - meanLuminance) ** 2).reduce((a, b) => a + b, 0) / luminances.length);

      setAnalysisResult({
        mean_luminance: parseFloat(meanLuminance.toFixed(2)),
        std_dev: parseFloat(stdDev.toFixed(2))
      });
      setAnalysisState('complete');
    }, 800);
  };

  const handleAcceptAnalysis = async () => {
    if (!analysisResult || !canvasRef.current) return;
    const lowResImage = canvasRef.current.toDataURL('image/jpeg', 0.5);
    const payload = {
      type: 'texture_signature',
      image: lowResImage,
      features: analysisResult
    };
    try {
      // We don't save to SDK storage here anymore, we pass it up to MobileScanner
      onAnalysisComplete(payload as any);
    } catch (err) {
      console.error("Error Analysis Completion:", err);
      setError("Error al procesar captura.");
    }
  };

  return (
    <div className="font-atkinson w-full h-full bg-black relative overflow-hidden rounded-none shadow-2xl ring-1 ring-white/10">
      <canvas ref={canvasRef} className="hidden" />

      {isCameraActive ? (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover z-0"
          />

          <div className="absolute inset-0 z-10 flex flex-col justify-between p-6 pointer-events-none">

            {/* Header Overlay */}
            <div className="w-full flex justify-center mt-safe-top pointer-events-auto">
              {analysisState === 'analyzing' && (
                <M3Chip label="Escaneando Textura..." icon="sensors" className="animate-pulse" />
              )}
              {analysisState === 'complete' && analysisResult && (
                <M3Chip
                  label="Firma de Textura Capturada"
                  icon="check_circle"
                  className="bg-primary/20 border-primary/50 text-primary"
                />
              )}
            </div>

            {/* Footer Actions */}
            <div className="w-full flex justify-center items-center pb-safe-bottom pointer-events-auto landscape:absolute landscape:right-8 landscape:bottom-1/2 landscape:translate-y-1/2 landscape:pb-0">
              {analysisState !== 'complete' ? (
                <button
                  onClick={analyzeGranulometry}
                  disabled={analysisState === 'analyzing'}
                  className={clsx(
                    "w-24 h-24 rounded-none flex items-center justify-center shadow-2xl transition-all duration-300 overflow-hidden",
                    "bg-white/90 text-black hover:bg-white hover:scale-105 active:scale-95",
                    "border-4 border-transparent hover:border-primary/50",
                    { "opacity-50 cursor-not-allowed": analysisState === 'analyzing' }
                  )}
                  aria-label="Analizar"
                >
                  <span className={`material-symbols-rounded text-[48px] ${analysisState === 'analyzing' ? 'animate-spin' : ''}`}>
                    {analysisState === 'analyzing' ? 'autorenew' : 'shutter_speed'}
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-4 bg-black/60 p-2 rounded-none backdrop-blur-md border border-white/10 animate-in fade-in slide-in-from-bottom-4 landscape:flex-col landscape:p-4">
                  <button
                    onClick={() => setAnalysisState('idle')}
                    className="w-16 h-16 rounded-none font-medium text-white/90 hover:bg-white/10 transition-colors flex items-center justify-center overflow-hidden"
                    title="Reintentar"
                  >
                    <span className="material-symbols-rounded text-[32px]">refresh</span>
                  </button>
                  <button
                    onClick={handleAcceptAnalysis}
                    className="w-20 h-20 rounded-none font-bold bg-primary text-black shadow-lg hover:shadow-primary/40 transition-all flex items-center justify-center overflow-hidden"
                    title="Usar Resultado"
                  >
                    <span className="material-symbols-rounded text-[40px]">check</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-full relative z-[999] bg-antigravity-dark-bg">
          {error ? (
            <div className="flex flex-col items-center gap-4 p-8 text-center max-w-sm">
              <span className="material-symbols-rounded text-5xl text-red-500 mb-2">videocam_off</span>
              <p className="text-antigravity-dark-text text-lg font-medium">{error}</p>
              <button
                onClick={enableCamera}
                className="mt-4 px-6 py-3 bg-antigravity-accent text-white rounded-none font-bold shadow-lg hover:bg-antigravity-accent/90 transition-colors"
              >
                Reintentar
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-antigravity-accent border-t-transparent rounded-none animate-spin"></div>
              <p className="text-antigravity-dark-muted font-medium animate-pulse">Iniciando cámara...</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VisionAnalyzer;