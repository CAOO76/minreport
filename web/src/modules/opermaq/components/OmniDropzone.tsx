import React, { useState } from 'react';
import { API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';

interface OmniDropzoneProps {
  globalAssetId: string;
  makeModel: string;
  onUploadSuccess: () => void;
}

export const OmniDropzone: React.FC<OmniDropzoneProps> = ({ globalAssetId, makeModel, onUploadSuccess }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (file.type !== 'application/pdf') {
      setError('Solo se admiten archivos PDF técnicos.');
      return;
    }

    setIsUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('globalAssetId', globalAssetId);
    formData.append('makeModel', makeModel);
    formData.append('environmentalContext', 'Faena Minera - Alta Cordillera / Clima Extremo');

    try {
      const response = await authFetch(`${API_BASE_URL}/vault/curate-doc`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Error en el Motor Omni-Ingesta');
      }

      onUploadSuccess();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Error al procesar el documento.');
    } finally {
      setIsUploading(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div 
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`
        relative group transition-all duration-500 ease-out p-4 mb-4 border border-dashed
        ${isDragging 
          ? 'border-copper bg-copper/5 scale-[1.01]' 
          : 'border-black/20 dark:border-white/20 bg-transparent'}
        ${isUploading ? 'opacity-50 pointer-events-none' : 'hover:border-copper hover:bg-copper/[0.02]'}
        flex flex-row items-center justify-center text-left space-x-4
      `}
    >
      <div className={`
        w-10 h-10 rounded-none border border-black/10 dark:border-white/20 flex flex-shrink-0 items-center justify-center transition-all duration-500
        ${isDragging ? 'rotate-12 scale-110 border-copper/50 text-copper' : 'text-black/40 dark:text-white/40'}
      `}>
        {isUploading ? (
          <svg className="w-5 h-5 animate-spin" viewBox="0 -960 960 960" fill="currentColor">
            <path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q17 0 28.5 11.5T520-840q0 17-11.5 28.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-17 11.5-28.5T840-520q17 0 28.5 11.5T960-480q0 83-31.5 155.5t-86 127Q788-143 715-111.5T480-80Z"/>
          </svg>
        ) : (
          <svg className="w-5 h-5" viewBox="0 -960 960 960" fill="currentColor">
            <path d="M440-400h80v-168l64 64 56-56-160-160-160 160 56 56 64-64v168Zm40 320q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Z" />
          </svg>
        )}
      </div>

      <div className="space-y-0.5 text-left w-full max-w-sm flex-1">
        <h3 className="text-[10px] font-black tracking-[0.2em] uppercase text-black/80 dark:text-white/80">
          {isUploading ? 'Procesando Documento...' : 'Omni-Ingesta Central'}
        </h3>
        <p className="text-[9px] font-medium text-black/40 dark:text-white/40 uppercase tracking-widest leading-tight">
          Arrastra el manual PDF aquí para alimentar la bóveda
        </p>
      </div>

      {error && (
        <div className="text-[9px] font-bold text-red-500 uppercase tracking-tighter animate-bounce">
          {error}
        </div>
      )}

      {isUploading && (
        <div className="absolute bottom-0 left-0 h-1 bg-copper animate-progress-indefinite w-full" />
      )}
      
      {/* Hidden file input for mobile/click support */}
      <input 
        type="file" 
        className="absolute inset-0 opacity-0 cursor-pointer" 
        accept="application/pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
};
