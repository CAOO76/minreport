/**
 * ChecklistHistory — F-FIELD.3
 * Muestra el historial de inspecciones realizadas para un activo.
 */
import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../utils/authFetch';
import { API_BASE_URL } from '../firebase/config';

interface InspectionSummary {
  id: string;
  type: string;
  submittedAt: { _seconds: number; _nanoseconds: number } | string;
  itemsCount: number;
  status: string;
  items?: Array<{
    componente: string;
    estado: string;
    status: string;
    observacion?: string;
    photoUrl?: string;
  }>;
}

interface Props {
  globalAssetId: string;
}

const API_BASE = API_BASE_URL;

export default function ChecklistHistory({ globalAssetId }: Props) {
  const [inspections, setInspections] = useState<InspectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(`${API_BASE}/api/checklist/history?globalAssetId=${globalAssetId}`);
      
      if (!response.ok) throw new Error('Error al cargar historial.');
      
      const data = await response.json();
      setInspections(data.inspections || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, [globalAssetId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const formatDate = (date: InspectionSummary['submittedAt']) => {
    if (typeof date === 'string') return new Date(date).toLocaleString();
    if (typeof date === 'object' && date && '_seconds' in date) {
      return new Date(date._seconds * 1000).toLocaleString();
    }
    return 'Fecha desconocida';
  };

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', opacity: 0.7 }}>
      <span className="material-symbols-outlined spinning" style={{ fontSize: 32 }}>refresh</span>
      <p style={{ fontSize: '0.9rem', marginTop: 12 }}>Cargando historial...</p>
      <style>{`.spinning { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (error) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-error)' }}>
      <span className="material-symbols-outlined" style={{ fontSize: 32 }}>error</span>
      <p style={{ fontSize: '0.9rem', marginTop: 12 }}>{error}</p>
      <button onClick={fetchHistory} style={{ 
        marginTop: 16, padding: '8px 16px', borderRadius: 8, border: 'none',
        background: 'var(--color-primary)', color: 'white', cursor: 'pointer'
      }}>REINTENTAR</button>
    </div>
  );

  if (inspections.length === 0) return (
    <div style={{ padding: 60, textAlign: 'center', opacity: 0.5 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 48 }}>history_toggle_off</span>
      <p style={{ fontSize: '1rem', marginTop: 16, fontWeight: 500 }}>No hay inspecciones registradas.</p>
      <p style={{ fontSize: '0.8rem' }}>Las nuevas inspecciones aparecerán aquí.</p>
    </div>
  );

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="checklist-history" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, fontFamily: 'Atkinson Hyperlegible' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 800, margin: 0 }}>Historial Reciente</h3>
        <button onClick={fetchHistory} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>refresh</span>
        </button>
      </div>

      {inspections.map((ins: InspectionSummary) => {
        const isExpanded = expandedId === ins.id;
        return (
          <div key={ins.id} style={{
            padding: '16px', borderRadius: 16, border: '1px solid var(--color-outline-variant)',
            background: 'var(--color-surface-container-low)', display: 'flex', flexDirection: 'column', gap: 12,
            transition: 'all 0.2s ease'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ 
                width: 48, height: 48, borderRadius: 12, background: 'var(--color-primary-container)',
                color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <span className="material-symbols-outlined">
                  {ins.type.includes('Visual') ? 'photo_camera' : 'assignment_turned_in'}
                </span>
              </div>
              
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 2 }}>{ins.type}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{formatDate(ins.submittedAt)}</div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: ins.status === 'FAIL' ? 'var(--color-error)' : 'var(--color-success)' }}>
                  {ins.status}
                </div>
                <div style={{ fontSize: '0.7rem', opacity: 0.5 }}>{ins.itemsCount} ítems</div>
              </div>

              <button 
                onClick={() => toggleExpand(ins.id)}
                style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer' }}
              >
                <span className="material-symbols-outlined" style={{ 
                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease'
                }}>
                  chevron_right
                </span>
              </button>
            </div>

            {isExpanded && ins.items && ins.items.length > 0 && (
              <div style={{ 
                borderTop: '1px solid var(--color-outline-variant)', 
                paddingTop: 12, 
                display: 'flex', 
                flexDirection: 'column', 
                gap: 8 
              }}>
                {ins.items?.map((item: { componente: string; estado: string; status: string; observacion?: string; photoUrl?: string }, idx: number) => (
                  <div key={idx} style={{ 
                    padding: 12, 
                    borderRadius: 12, 
                    background: 'var(--color-surface-container)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{item.componente}</span>
                      <span style={{ 
                        fontSize: '0.75rem', 
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 6,
                        background: item.status === 'PASS' ? 'var(--color-success-container)' : 'var(--color-error-container)',
                        color: item.status === 'PASS' ? 'var(--color-on-success-container)' : 'var(--color-on-error-container)'
                      }}>
                        {item.status}
                      </span>
                    </div>
                    
                    {item.observacion && (
                      <p style={{ fontSize: '0.8rem', margin: 0, opacity: 0.8 }}>{item.observacion}</p>
                    )}
                    
                    {item.photoUrl && (
                      <div style={{ marginTop: 4, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--color-outline-variant)' }}>
                        <img 
                          src={item.photoUrl} 
                          alt={`Foto de ${item.componente}`} 
                          style={{ width: '100%', maxHeight: 300, objectFit: 'cover' }} 
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
