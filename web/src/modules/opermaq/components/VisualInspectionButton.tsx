/**
 * VisualInspectionButton — F6-UI
 * Botón de Inspección Visual Multimodal M3.
 */
import { useState, useRef } from 'react';
import { authFetch } from '../utils/authFetch';
import { API_BASE_URL } from '../firebase/config';
import { EdgeSyncQueue } from '../lib/EdgeSyncQueue';

import { compressToWebP } from '../utils/imageCompression';

interface VisualInspectionResult {
  diagnostico: 'BUENO' | 'DESGASTE_NORMAL' | 'DESGASTE_ANORMAL' | 'CRITICO';
  coincide_componente: boolean;
  detalles_detectados: string[];
  accion_inmediata: string;
  alerta_fcm_requerida: boolean;
}

interface Props {
  expectedComponent: string;
  makeModel: string;
  globalAssetId?: string;
  onResult: (text: string, diagnostic: string) => void;
}

export default function VisualInspectionButton({ expectedComponent, makeModel, globalAssetId, onResult }: Props) {
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);

    try {
      if (!EdgeSyncQueue.isOnline) {
        alert('La inspección visual por IA requiere conectividad activa.');
        setLoading(false);
        return;
      }

      // 1. Optimizar imagen (WebP + Redimensionado)
      const { base64: base64Image } = await compressToWebP(file);

      // 2. Enviar a la API
      const response = await authFetch(`${API_BASE_URL}/vault/inspect/visual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64Image,
          mimeType: 'image/webp',
          expectedComponent,
          makeModel,
          globalAssetId,
        }),
      });

      if (!response.ok) throw new Error('Error en el análisis visual.');

      const data = await response.json();
      if (data.success && data.result) {
        const res: VisualInspectionResult = data.result;
        let text = `[IA] Diagnóstico: ${res.diagnostico}.`;
        if (res.detalles_detectados?.length > 0) text += ` Hallazgos: ${res.detalles_detectados.join(', ')}.`;
        if (res.accion_inmediata) text += ` Acción: ${res.accion_inmediata}`;
        if (!res.coincide_componente) text += ` (⚠️ La foto no coincide plenamente con ${expectedComponent})`;
        onResult(text, res.diagnostico);
      } else {
        throw new Error('Respuesta inválida del servidor.');
      }
    } catch (err) {
      console.error('[F6-UI] Error:', err);
      alert('Error al procesar la inspección visual.');
    } finally {
      setLoading(false);
    }

    // Limpiar el input para permitir subir la misma foto consecutivamente
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          border: 'none',
          background: loading ? 'var(--color-outline)' : 'var(--color-primary-container)',
          color: loading ? 'var(--color-on-surface-variant)' : 'var(--color-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: loading ? 'not-allowed' : 'pointer',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        title="Inspección visual por IA"
      >
        {loading ? (
          <span
            className="material-symbols-outlined"
            style={{
              animation: 'spin 1s linear infinite',
              fontSize: 22,
            }}
          >
            sync
          </span>
        ) : (
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
            photo_camera
          </span>
        )}
        {loading && (
          <style>{`
            @keyframes spin {
              100% { transform: rotate(360deg); }
            }
          `}</style>
        )}
      </button>
    </>
  );
}
