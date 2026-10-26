/**
 * ChecklistInteractive — F-FIELD.3
 * Interfaz interactiva de captura de datos de inspección en terreno.
 */
import { useState } from 'react';
import { getAuth } from 'firebase/auth';
import { authFetch } from '../utils/authFetch';
import { API_BASE_URL } from '../firebase/config';
import { M3Button } from './M3Button';
import InspectionPDFButton from './InspectionPDFButton';
import { EdgeSyncQueue } from '../lib/EdgeSyncQueue';
import VisualInspectionButton from './VisualInspectionButton';

interface SpeechRecognitionEvent extends Event {
  results: {
    [key: number]: {
      [key: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: () => void;
  onend: () => void;
  onerror: () => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  start: () => void;
  stop: () => void;
}

function VoiceInputButton({ onResult }: { onResult: (text: string) => void }) {
  const [isRecording, setIsRecording] = useState(false);

  const startVoice = () => {
    const win = window as unknown as {
      webkitSpeechRecognition?: new () => SpeechRecognition;
      SpeechRecognition?: new () => SpeechRecognition;
    };
    const SR = win.webkitSpeechRecognition || win.SpeechRecognition;
    if (!SR) { alert('Voz no soportada'); return; }

    const recognition = new SR();
    recognition.lang = 'es-CL';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsRecording(true);
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);
    
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      onResult(transcript);
    };

    recognition.start();
  };

  return (
    <button
      onClick={startVoice}
      style={{
        width: 44, height: 44, borderRadius: 22, border: 'none',
        background: isRecording ? 'var(--color-error)' : 'var(--color-primary-container)',
        color: isRecording ? 'white' : 'var(--color-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: isRecording ? '0 0 15px var(--color-error)' : 'none',
        animation: isRecording ? 'pulse 1.5s infinite' : 'none'
      }}
      title="Dictar observación"
    >
      <span className="material-symbols-outlined" style={{ 
        fontVariationSettings: isRecording ? "'FILL' 1" : "'FILL' 0",
        fontSize: 22
      }}>
        {isRecording ? 'mic' : 'mic_none'}
      </span>
      {isRecording && (
        <style>{`
          @keyframes pulse {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.1); opacity: 0.8; }
            100% { transform: scale(1); opacity: 1; }
          }
        `}</style>
      )}
    </button>
  );
}

interface ChecklistItem {
  componente: string;
  accion: string;
  criterio_pasa: string;
  criterio_no_pasa: string;
  es_critico: boolean;
  tipo_input: string;
}

interface ChecklistGroup {
  zona: string;
  items: ChecklistItem[];
}

interface Props {
  checklist: {
    id: string;
    globalAssetId: string;
    makeModel: string;
    type: string;
    operationalProfile: string;
    groups: ChecklistGroup[];
  };
  onClose: () => void;
  onSuccess: (inspectionId: string) => void;
}

import { useOfflineSync } from '../hooks/useOfflineSync';

interface ItemResult {
  componente: string;
  accion: string;
  status: 'PASS' | 'FAIL' | 'NA';
  observation: string;
  voiceNoteText?: string;
}

const API_BASE = API_BASE_URL;

export default function ChecklistInteractive({ checklist, onClose, onSuccess }: Props) {
  const [results, setResults] = useOfflineSync<Record<string, ItemResult>>(`checklist_run_${checklist.id}`, {});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStatusChange = (groupIndex: number, itemIndex: number, status: 'PASS' | 'FAIL' | 'NA') => {
    const key = `${groupIndex}-${itemIndex}`;
    const item = checklist.groups[groupIndex].items[itemIndex];
    setResults(prev => ({
      ...prev,
      [key]: {
        componente: item.componente,
        accion: item.accion,
        status,
        observation: prev[key]?.observation || '',
      }
    }));
  };


  const handleObservationChange = (groupIndex: number, itemIndex: number, text: string) => {
    const key = `${groupIndex}-${itemIndex}`;
    setResults(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        observation: text,
      }
    }));
  };

  const [submittedId, setSubmittedId] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const itemsArray = Object.values(results);
      if (itemsArray.length === 0) {
        throw new Error('Debe completar al menos un ítem.');
      }

      const payload = {
        globalAssetId: checklist.globalAssetId,
        makeModel: checklist.makeModel,
        type: checklist.type,
        operationalProfileId: checklist.operationalProfile,
        items: itemsArray,
        metadata: {
          appVersion: '3.0.0-F-FIELD',
          device: navigator.userAgent
        }
      };

      if (!EdgeSyncQueue.isOnline) {
        console.warn('[EDGE-OPTIMIZER] Sin conexión. Encolando inspección localmente.');
        await EdgeSyncQueue.pushTransaction(
          'API',
          '/api/checklist/submit',
          payload,
          'INSPECTION_SUBMITTED'
        );
        // Generar un ID temporal para el flujo offline
        const offlineId = `offline_${crypto.randomUUID().slice(0, 8)}`;
        setSubmittedId(offlineId);
        return;
      }

      const response = await authFetch(`${API_BASE}/api/checklist/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error('Error al guardar la inspección.');
      
      const data = await response.json();
      setSubmittedId(data.inspectionId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setSubmitting(false);
    }
  }

  const totalItems = checklist.groups.reduce((acc, g) => acc + g.items.length, 0);
  const completedItems = Object.keys(results).length;
  const progress = (completedItems / totalItems) * 100;

  return (
    <div className="checklist-interactive" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'var(--color-surface)', zIndex: 1000,
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Atkinson Hyperlegible', sans-serif"
    }}>
      {/* Vista de Éxito / PDF */}
      {submittedId && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'var(--color-surface)', zIndex: 1100,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 40, textAlign: 'center', gap: 24
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 80, color: 'var(--color-success)' }}>check_circle</span>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: 8 }}>Inspección Finalizada</h2>
            <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>Los datos han sido guardados en el historial del activo.</p>
          </div>
          
          <div style={{ width: '100%', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <InspectionPDFButton 
              makeModel={checklist.makeModel}
              type={checklist.type}
              inspectorName={getAuth().currentUser?.displayName || 'Técnico OPERMAQ'}
              timestamp={new Date().toISOString()}
              items={Object.values(results)}
              fileName={`INSPECCION_${checklist.makeModel.replace(/\s+/g, '_')}_${submittedId.slice(0,6)}.pdf`}
            />
            <M3Button variant="ghost" onClick={() => onSuccess(submittedId)}>
              VOLVER AL ACTIVO
            </M3Button>
          </div>
        </div>
      )}

      {/* Header Fijo */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--color-outline-variant)',
        background: 'var(--color-surface-container)', display: 'flex', alignItems: 'center', gap: 16
      }}>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-on-surface)'
        }}>
          <span className="material-symbols-outlined">close</span>
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{checklist.type}</h2>
          <p style={{ margin: 0, fontSize: '0.75rem', opacity: 0.7 }}>{checklist.makeModel}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-primary)' }}>
            {completedItems} / {totalItems}
          </div>
          <div style={{ width: 60, height: 4, background: 'var(--color-outline-variant)', borderRadius: 2, marginTop: 4 }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--color-primary)', borderRadius: 2, transition: 'width 0.3s' }} />
          </div>
        </div>
      </div>

      {/* Cuerpo Scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {checklist.groups.map((group, gi) => (
          <div key={gi} style={{ marginBottom: 32 }}>
            <h3 style={{
              fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase',
              color: 'var(--color-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>folder</span>
              {group.zona}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {group.items.map((item, ii) => {
                const key = `${gi}-${ii}`;
                const result = results[key];
                return (
                  <div key={ii} style={{
                    padding: '16px', borderRadius: 16,
                    border: '1px solid var(--color-outline-variant)',
                    background: result ? 'var(--color-surface-container-low)' : 'var(--color-surface)',
                    transition: 'all 0.2s'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 4 }}>
                          {item.accion} {item.componente}
                          {item.es_critico && <span style={{ color: 'var(--color-error)', marginLeft: 8 }}>[CRÍTICO]</span>}
                        </div>
                        <div style={{ fontSize: '0.8rem', opacity: 0.7, lineHeight: 1.4 }}>
                          {item.criterio_pasa}
                        </div>
                      </div>
                    </div>

                    {/* Botones de Estado */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      {[
                        { id: 'PASS', label: 'CUMPLE', icon: 'check_circle', color: 'var(--color-success)' },
                        { id: 'FAIL', label: 'NO CUMPLE', icon: 'cancel', color: 'var(--color-error)' },
                        { id: 'NA',   label: 'N/A', icon: 'do_not_disturb_on', color: 'var(--color-outline)' }
                      ].map(btn => (
                        <button
                          key={btn.id}
                          onClick={() => handleStatusChange(gi, ii, btn.id as 'PASS' | 'FAIL' | 'NA')}
                          style={{
                            flex: 1, padding: '10px', borderRadius: 12, border: 'none',
                            cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                            background: result?.status === btn.id ? btn.color : 'var(--color-surface-container-high)',
                            color: result?.status === btn.id ? 'white' : 'var(--color-on-surface-variant)',
                            transition: 'all 0.2s', fontWeight: 600, fontSize: '0.7rem'
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{btn.icon}</span>
                          {btn.label}
                        </button>
                      ))}
                    </div>

                    {/* Observaciones / Voz */}
                    {result && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                        <div style={{ flex: 1, position: 'relative' }}>
                          <input
                            type="text"
                            placeholder="Observaciones..."
                            value={result.observation}
                            onChange={(e) => handleObservationChange(gi, ii, e.target.value)}
                            style={{
                              width: '100%', padding: '10px 12px', borderRadius: 12,
                              border: '1px solid var(--color-outline)',
                              background: 'var(--color-surface)', fontSize: '0.85rem',
                              transition: 'all 0.2s'
                            }}
                            autoComplete="off"
                          />
                        </div>
                        <VisualInspectionButton 
                          expectedComponent={item.componente}
                          makeModel={checklist.makeModel}
                          globalAssetId={checklist.globalAssetId}
                          onResult={(text, diagnostic) => {
                            handleObservationChange(gi, ii, (result.observation ? result.observation + ' ' : '') + text);
                            if (diagnostic === 'CRITICO' || diagnostic === 'DESGASTE_ANORMAL') {
                              handleStatusChange(gi, ii, 'FAIL');
                            }
                          }}
                        />
                        <VoiceInputButton 
                          onResult={(text) => handleObservationChange(gi, ii, (result.observation ? result.observation + ' ' : '') + text)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Fijo */}
      <div style={{
        padding: '20px', borderTop: '1px solid var(--color-outline-variant)',
        background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: 12
      }}>
        {error && (
          <div style={{ color: 'var(--color-error)', fontSize: '0.8rem', textAlign: 'center' }}>
            {error}
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={submitting || completedItems < totalItems * 0.5} // Exigir al menos 50% para demo
          style={{
            padding: '16px', borderRadius: 12, border: 'none',
            background: 'var(--color-primary)', color: 'white',
            fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
            opacity: (submitting || completedItems < totalItems * 0.5) ? 0.6 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
          }}
        >
          {submitting ? 'Guardando...' : 'Finalizar Inspección'}
          <span className="material-symbols-outlined">send</span>
        </button>
      </div>
    </div>
  );
}
