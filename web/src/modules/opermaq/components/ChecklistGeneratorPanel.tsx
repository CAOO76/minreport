/**
 * ChecklistGeneratorPanel — F4.1
 * Panel de generación de checklists industriales con base documental verificada.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { API_BASE_URL } from '../firebase/config';
import ChecklistInteractive from './ChecklistInteractive';
import { EdgeSyncQueue } from '../lib/EdgeSyncQueue';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface ChecklistType    { id: string; label: string; icon: string }
interface OperProfile      { id: string; label: string; label_short: string; icon: string; altitud: string; clima: string }
interface ChecklistItem    {
  componente: string; accion: string;
  criterio_pasa: string; criterio_no_pasa: string; accion_inmediata: string;
  tipo_input: 'BOOLEAN' | 'NUMERIC' | 'VISUAL' | 'WARNING';
  referencia_oem?: string; es_critico: boolean;
  origen_dato: 'OEM_VALIDADO' | 'HSEC_VALIDADO' | 'IA_SINBASEDOCUMENTAL';
}
interface ChecklistGroup   { zona: string; items: ChecklistItem[] }
interface GeneratedChecklist {
  id: string; makeModel: string; type: string; operationalProfile: string;
  groups: ChecklistGroup[];
  metadata: {
    total_items: number; items_criticos: number;
    items_oem: number; items_ia: number;
    norma_hsec: string; generatedAt: string; advertencia_ia?: string;
  };
}

import { authFetch } from '../utils/authFetch';

async function apiFetch(path: string, opts: RequestInit = {}) {
  // authFetch ya maneja el token y App Check
  const res = await authFetch(`${API_BASE_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

// ─── Componente principal ─────────────────────────────────────────────────────
interface Props {
  globalAssetId: string;
  makeModel: string;
  category?: string;
}

export default function ChecklistGeneratorPanel({ globalAssetId, makeModel, category = 'Maquinaria Pesada' }: Props) {
  const { t } = useTranslation();
  const [types,    setTypes]    = useState<ChecklistType[]>([]);
  const [profiles, setProfiles] = useState<OperProfile[]>([]);
  const [selType,  setSelType]  = useState('PRE_OPERACIONAL');
  const [selProf,  setSelProf]  = useState('NMA-RO');
  const [regimen,  setRegimen]  = useState<number>(10);
  const [loading,  setLoading]  = useState(false);
  const [checklist, setChecklist] = useState<GeneratedChecklist | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [showInteractive, setShowInteractive] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);

  // ─── Colores por origen ───────────────────────────────────────────────────────
  const ORIGEN_STYLE: Record<string, { bg: string; color: string; label: string }> = {
    OEM_VALIDADO:          { bg: 'var(--color-success-container)', color: 'var(--color-success)',  label: t('checklist.generator.items.origin.oem') },
    HSEC_VALIDADO:         { bg: 'var(--color-info-container)',    color: 'var(--color-info)',     label: t('checklist.generator.items.origin.hsec') },
    IA_SINBASEDOCUMENTAL:  { bg: 'var(--color-warn-container)',    color: 'var(--color-warn)',     label: t('checklist.generator.items.origin.ia') },
  };

  const INPUT_ICON: Record<string, string> = {
    BOOLEAN: 'check_circle', NUMERIC: 'straighten', VISUAL: 'visibility', WARNING: 'warning',
  };

  // Cargar metadatos de tipos y perfiles
  useEffect(() => {
    apiFetch('/checklist/types').then(d => setTypes(d.types)).catch(() => {});
    apiFetch('/checklist/profiles').then(d => setProfiles(d.profiles)).catch(() => {});
  }, []);

  async function handleGenerate() {
    setLoading(true); setError(null); setChecklist(null);
    try {
      const data = await apiFetch('/checklist/generate', {
        method: 'POST',
        body: JSON.stringify({ globalAssetId, makeModel, category, type: selType, operationalProfileId: selProf, regimenHoras: regimen }),
      });
      setChecklist(data.checklist);
      
      // Guardar en caché offline
      try {
        await EdgeSyncQueue.saveOfflineKnowledge(`checklist_${globalAssetId}_${selType}`, data.checklist);
      } catch (cacheErr) {
        console.warn('[EDGE] Error al cachear checklist:', cacheErr);
      }
    } catch (e) {
      console.warn('[EDGE] Fallo en generación online, intentando fallback offline.', e);
      try {
        const cached = await EdgeSyncQueue.getOfflineKnowledge(`checklist_${globalAssetId}_${selType}`);
        if (cached) {
          setChecklist(cached as GeneratedChecklist);
          setError(`${t('checklist.generator.error_gen')} (Modo Offline - Datos Recuperados)`);
          return;
        }
      } catch (fallbackErr) {
        console.error('[EDGE] Error al recuperar checklist offline:', fallbackErr);
      }
      
      const message = e instanceof Error ? e.message : t('checklist.generator.error_gen');
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function handleExportJSON() {
    if (!checklist) return;
    const blob = new Blob([JSON.stringify(checklist, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `checklist_${makeModel.replace(/\s+/g, '_')}_${selType}_${Date.now()}.json`;
    a.click();
  }

  const selProfile = profiles.find(p => p.id === selProf);

  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto', fontFamily: 'Atkinson Hyperlegible, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 28, color: 'var(--color-primary)' }}>checklist</span>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em' }}>{t('checklist.generator.title')}</h2>
          <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.6, fontWeight: 500 }}>{makeModel}</p>
        </div>
      </div>

      {/* Configuración */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Tipo */}
        <div className="form-group">
          <label style={{ fontSize: '0.7rem', fontWeight: 800, opacity: 0.8, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {t('checklist.generator.type_label')}
          </label>
          <select
            value={selType} onChange={e => setSelType(e.target.value)}
            style={{ width: '100%', marginTop: 8, padding: '12px 14px', borderRadius: 0,
              border: '1.5px solid var(--color-outline-variant)', background: 'var(--color-surface)',
              color: 'var(--color-on-surface)', fontSize: '0.9rem', fontWeight: 500, outline: 'none' }}
            autoComplete="off"
          >
            {types.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Régimen */}
        <div className="form-group">
          <label style={{ fontSize: '0.7rem', fontWeight: 800, opacity: 0.8, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {t('checklist.generator.regimen_label')}
          </label>
          <input
            type="number" min={1} max={24} value={regimen}
            onChange={e => setRegimen(Number(e.target.value))}
            autoComplete="off"
            spellCheck={false}
            style={{ width: '100%', marginTop: 8, padding: '12px 14px', borderRadius: 0,
              border: '1.5px solid var(--color-outline-variant)', background: 'var(--color-surface)',
              color: 'var(--color-on-surface)', fontSize: '0.9rem', fontWeight: 500, boxSizing: 'border-box', outline: 'none' }}
          />
        </div>
      </div>

      {/* Perfil operacional */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: '0.7rem', fontWeight: 800, opacity: 0.8, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          {t('checklist.generator.profile_label')}
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
          {profiles.map(p => (
            <button
              key={p.id} onClick={() => setSelProf(p.id)}
              style={{
                padding: '8px 18px', borderRadius: 0, fontSize: '0.85rem', cursor: 'pointer',
                border: selProf === p.id ? '2px solid var(--color-primary)' : '1.5px solid var(--color-outline-variant)',
                background: selProf === p.id ? 'var(--color-primary-container)' : 'transparent',
                color: selProf === p.id ? 'var(--color-primary)' : 'var(--color-on-surface)',
                fontWeight: selProf === p.id ? 700 : 500, transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}>{p.icon}</span>
              {p.label_short}
            </button>
          ))}
        </div>
        {selProfile && (
          <div style={{ marginTop: 12, padding: '12px 16px', borderRadius: 0, background: 'var(--color-surface-variant)', fontSize: '0.85rem', opacity: 0.9, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--color-primary)' }}>location_on</span>
            {selProfile.altitud} · {selProfile.clima}
          </div>
        )}
      </div>

      {/* Botón generar */}
      <button
        onClick={handleGenerate} disabled={loading}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px 28px',
          borderRadius: 0, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
          background: loading ? 'var(--color-outline)' : 'var(--color-primary)',
          color: 'white', fontWeight: 700, fontSize: '0.95rem', transition: 'all 0.2s', marginBottom: 32,
          width: '100%', boxShadow: 'none'
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
          {loading ? 'hourglass_top' : 'auto_awesome'}
        </span>
        {loading ? t('checklist.generator.generating') : t('checklist.generator.generate_btn')}
      </button>

      {/* Error */}
      {error && (
        <div style={{ padding: '14px 18px', borderRadius: 0, background: 'var(--color-error-container)',
          color: 'var(--color-error)', fontSize: '0.9rem', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'center', fontWeight: 500 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>error_outline</span>
          {error}
        </div>
      )}

      {/* Advertencia IA sin base documental */}
      {checklist?.metadata.advertencia_ia && (
        <div style={{ padding: '14px 18px', borderRadius: 0, background: 'var(--color-warn-container)',
          color: 'var(--color-warn)', fontSize: '0.85rem', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'center', fontWeight: 500, lineHeight: 1.4 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>warning_amber</span>
          {checklist.metadata.advertencia_ia}
        </div>
      )}

      {/* Resultado */}
      {checklist && (
        <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
            {[
              { label: t('checklist.generator.stats.total'),  value: checklist.metadata.total_items,    icon: 'format_list_numbered' },
              { label: t('checklist.generator.stats.critical'), value: checklist.metadata.items_criticos, icon: 'priority_high', color: 'var(--color-error)' },
              { label: t('checklist.generator.stats.oem'),     value: checklist.metadata.items_oem,      icon: 'verified',      color: 'var(--color-success)' },
              { label: t('checklist.generator.stats.ia'),  value: checklist.metadata.items_ia,       icon: 'auto_fix_high', color: 'var(--color-warn)' },
            ].map(s => (
              <div key={s.label} style={{ padding: '18px 12px', borderRadius: 0,
                background: 'var(--color-surface-container-low)', textAlign: 'center', border: '1px solid var(--color-outline-variant)' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 24, color: s.color || 'var(--color-primary)', marginBottom: 8 }}>{s.icon}</span>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: s.color || 'var(--color-on-surface)', lineHeight: 1.2 }}>{s.value}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.7, fontWeight: 600, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Acciones */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24, alignItems: 'center' }}>
            <button onClick={handleExportJSON} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 0,
              border: '1.5px solid var(--color-outline)', background: 'transparent',
              color: 'var(--color-on-surface)', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s'
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span>
              {t('checklist.generator.actions.export')}
            </button>
            
            <button onClick={() => setShowInteractive(true)} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px', borderRadius: 0,
              border: 'none', background: 'var(--color-primary)',
              color: 'white', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 700, transition: 'all 0.2s',
              boxShadow: 'none'
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>engineering</span>
              {t('checklist.generator.actions.inspect')}
            </button>

            <span style={{ fontSize: '0.8rem', opacity: 0.6, fontWeight: 500, marginLeft: 'auto', background: 'var(--color-surface-variant)', padding: '6px 12px', borderRadius: 0 }}>
              {t('checklist.generator.actions.norm', { norma: checklist.metadata.norma_hsec })}
            </span>
          </div>

          {/* Modal de éxito tras inspección */}
          {successId && (
            <div style={{ padding: '18px', borderRadius: 0, background: 'var(--color-success-container)', color: 'var(--color-success)', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 14, border: '1px solid var(--color-success)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 28 }}>check_circle</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: '1rem' }}>{t('checklist.generator.success.title')}</div>
                <div style={{ fontSize: '0.85rem', opacity: 0.8, fontWeight: 500 }}>ID: {successId}</div>
              </div>
              <button onClick={() => setSuccessId(null)} style={{ background: 'var(--color-surface)', border: 'none', color: 'var(--color-success)', cursor: 'pointer', width: 32, height: 32, borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
          )}

          {/* Grupos de ítems */}
          {checklist.groups.map((group, gi) => (
            <div key={gi} style={{ marginBottom: 24, borderRadius: 0, overflow: 'hidden',
              border: '1.5px solid var(--color-outline-variant)', background: 'var(--color-surface)' }}>
              {/* Zona header */}
              <div style={{ padding: '14px 20px', background: 'var(--color-surface-container-high)',
                display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1.5px solid var(--color-outline-variant)' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--color-primary)' }}>location_searching</span>
                <span style={{ fontWeight: 800, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>{group.zona}</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', opacity: 0.7, fontWeight: 700, background: 'var(--color-outline-variant)', padding: '2px 8px', borderRadius: 0 }}>
                  {group.items.length} {group.items.length !== 1 ? 'ÍTEMS' : 'ÍTEM'}
                </span>
              </div>

              {/* Ítems */}
              <div>
                {group.items.map((item, ii) => {
                  const origen = ORIGEN_STYLE[item.origen_dato];
                  return (
                    <div key={ii} style={{
                      padding: '18px 20px',
                      borderBottom: ii < group.items.length - 1 ? '1px solid var(--color-outline-variant)' : 'none',
                      display: 'grid', gridTemplateColumns: '24px 1fr', gap: '10px 16px',
                    }}>
                      {/* Ícono tipo */}
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--color-primary)', gridRow: 'span 2', alignSelf: 'start', marginTop: 3 }}>
                        {INPUT_ICON[item.tipo_input]}
                      </span>

                      {/* Cabecera ítem */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-on-surface)' }}>
                          {item.accion} — {item.componente}
                        </span>
                        {item.es_critico && (
                          <span style={{ fontSize: '0.65rem', padding: '3px 10px', borderRadius: 0,
                            background: 'var(--color-error)', color: 'white', fontWeight: 800, letterSpacing: '0.04em' }}>
                            {t('checklist.generator.items.critical')}
                          </span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: '0.65rem', padding: '3px 10px', borderRadius: 0,
                          background: origen.bg, color: origen.color, fontWeight: 800, letterSpacing: '0.04em' }}>
                          {origen.label}
                        </span>
                      </div>

                      {/* Detalles */}
                      <div style={{ fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--color-on-surface-variant)', fontWeight: 500 }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
                          <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>✓</span>
                          <span><strong>{t('checklist.generator.items.pass')}:</strong> {item.criterio_pasa}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
                          <span style={{ color: 'var(--color-error)', fontWeight: 700 }}>✗</span>
                          <span><strong>{t('checklist.generator.items.fail')}:</strong> {item.criterio_no_pasa}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 15, color: 'var(--color-primary)' }}>bolt</span>
                          <span><strong>{t('checklist.generator.items.action')}:</strong> {item.accion_inmediata}</span>
                        </div>
                        {item.referencia_oem && (
                          <div style={{ marginTop: 8, padding: '6px 12px', borderRadius: 0, background: 'var(--color-surface-container-low)', fontSize: '0.75rem', opacity: 0.8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>description</span>
                            {item.referencia_oem}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Overlay Interactivo F-FIELD */}
      {showInteractive && checklist && (
        <ChecklistInteractive 
          checklist={{
            ...checklist,
            globalAssetId,
            operationalProfile: selProf
          }} 
          onClose={() => setShowInteractive(false)}
          onSuccess={(id) => {
            setSuccessId(id);
            setShowInteractive(false);
          }}
        />
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
