/**
 * VoiceToVaultButton — F7-UI
 * Botón de dictado técnico por audio nativo para enriquecer la Bóveda.
 */
import { useState, useRef } from 'react';
import { authFetch } from '../utils/authFetch';
import { API_BASE_URL } from '../firebase/config';
import { EdgeSyncQueue } from '../lib/EdgeSyncQueue';

interface Props {
  globalAssetId: string;
  makeModel: string;
}

export default function VoiceToVaultButton({ globalAssetId, makeModel }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [result, setResult] = useState<{ transcripcion: string; resumen: string } | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/mp3' });
        await handleSendAudio(audioBlob);
        // Detener los tracks del stream para apagar el micrófono
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setResult(null);
      setShowModal(true);
    } catch (err) {
      console.error('[F7-UI] Error al acceder al micrófono:', err);
      alert('No se pudo acceder al micrófono.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleSendAudio = async (blob: Blob) => {
    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;

        if (!EdgeSyncQueue.isOnline) {
          alert('El dictado técnico por IA requiere conectividad activa.');
          setLoading(false);
          setShowModal(false);
          return;
        }

        try {
          const response = await authFetch(`${API_BASE_URL}/api/vault/voice/transcribe-and-extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: base64Audio,
              mimeType: blob.type || 'audio/mp3',
              globalAssetId,
            }),
          });

          if (!response.ok) throw new Error('Error al procesar el dictado.');

          const data = await response.json();
          if (data.success && data.result) {
            setResult({
              transcripcion: data.result.transcripcion,
              resumen: data.result.resumen_tecnico,
            });
          } else {
            throw new Error('Respuesta inválida del servidor.');
          }
        } catch (err) {
          console.error('[F7-UI] Error en API Voice:', err);
          alert('Error al enviar el dictado a la Bóveda.');
          setShowModal(false);
        } finally {
          setLoading(false);
        }
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error('[F7-UI] Error al leer el Blob:', err);
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={loading}
        style={{
          width: '100%',
          padding: '14px',
          borderRadius: '8px',
          border: '1px solid var(--color-outline)',
          background: isRecording ? 'var(--color-error)' : 'var(--color-surface)',
          color: isRecording ? 'white' : 'var(--color-primary)',
          fontWeight: 800,
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.2em',
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          transition: 'all 0.3s ease',
          boxShadow: isRecording ? '0 0 15px var(--color-error)' : 'none',
          animation: isRecording ? 'pulse 1.5s infinite' : 'none',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
          {isRecording ? 'stop' : 'mic'}
        </span>
        {loading ? 'ANALIZANDO...' : isRecording ? 'DETENER GRABACIÓN' : 'DICTADO A BÓVEDA'}
      </button>

      {isRecording && (
        <style>{`
          @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.02); }
            100% { transform: scale(1); }
          }
        `}</style>
      )}

      {showModal && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            fontFamily: "'Atkinson Hyperlegible', sans-serif",
          }}
        >
          <div
            style={{
              background: 'var(--color-surface)',
              padding: '24px',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '400px',
              textAlign: 'center',
              border: '1px solid var(--color-outline-variant)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {isRecording ? (
              <>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: '48px', color: 'var(--color-error)' }}
                >
                  mic
                </span>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>
                  Grabando dictado técnico...
                </h3>
                <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.7 }}>
                  Describe el hallazgo, componente y recomendación de mantenimiento para el
                  equipo {makeModel}.
                </p>
                <button
                  onClick={stopRecording}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'var(--color-error)',
                    color: 'white',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Detener
                </button>
              </>
            ) : loading ? (
              <>
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: '48px',
                    color: 'var(--color-primary)',
                    animation: 'spin 1s linear infinite',
                  }}
                >
                  sync
                </span>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>
                  Procesando audio con IA
                </h3>
                <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.7 }}>
                  Extrayendo especificaciones y guardando en la Bóveda...
                </p>
                <style>{`
                  @keyframes spin { 100% { transform: rotate(360deg); } }
                `}</style>
              </>
            ) : result ? (
              <>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: '48px', color: 'var(--color-success)' }}
                >
                  check_circle
                </span>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>
                  Dictado Procesado Exitosamente
                </h3>
                <div style={{ textAlign: 'left', background: 'var(--color-surface-container-low)', padding: '12px', borderRadius: '8px', fontSize: '0.8rem' }}>
                  <p style={{ margin: '0 0 8px 0' }}><strong>Transcripción:</strong> "{result.transcripcion}"</p>
                  <p style={{ margin: 0 }}><strong>Resumen:</strong> {result.resumen}</p>
                </div>
                <p style={{ margin: 0, fontSize: '0.75rem', opacity: 0.6 }}>
                  Los datos se guardaron en estado PENDIENTE para revisión del Administrador.
                </p>
                <button
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'var(--color-primary)',
                    color: 'white',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Cerrar
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
