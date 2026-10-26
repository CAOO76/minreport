import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../utils/authFetch';
import { API_BASE_URL, auth } from '../firebase/config';

// API_BASE_URL ya incluye /api — solo añadir el sub-path de benchmark
const BENCH_API = `${API_BASE_URL}/benchmark`;

// ─── Tipos ────────────────────────────────────────────────────────────────────
type TipoIntervencion =
  | 'CAMBIO_ACEITE_MOTOR' | 'CAMBIO_FILTRO_ACEITE' | 'CAMBIO_FILTRO_AIRE'
  | 'CAMBIO_FILTRO_COMBUSTIBLE' | 'CAMBIO_FLUIDO_HIDRAULICO'
  | 'CAMBIO_FLUIDO_TRANSMISION' | 'INSPECCION_FRENOS' | 'CAMBIO_PASTILLAS_FRENO'
  | 'AJUSTE_TENSION_CADENA' | 'CAMBIO_DIENTES_BALDE' | 'REVISION_GENERAL_MOTOR'
  | 'CALIBRACION_INYECTORES' | 'INSPECCION_ESTRUCTURA' | 'OTRA';

type Tendencia = 'REDUCIR_INTERVALO' | 'EXTENDER_INTERVALO' | 'MANTENER_OEM';
type Confianza = 'ALTA' | 'MEDIA' | 'BAJA';
type InsightStatus = 'PENDIENTE_HITL' | 'APROBADO' | 'RECHAZADO';

interface BenchmarkInsight {
  id: string;
  operationalProfileLabel: string;
  tipoIntervencion: TipoIntervencion;
  n: number;
  horasOem: number;
  horasPromedioReal: number;
  horasMediana: number;
  horasMin: number;
  horasMax: number;
  desviacionEstandar: number;
  desvioPromedioPercent: number;
  tendencia: Tendencia;
  confianza: Confianza;
  descripcion: string;
  status: InsightStatus;
  condicionDistribucion?: Record<string, number>;
}

interface Props {
  globalAssetId: string;
  makeModel: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tendenciaColor(t: Tendencia) {
  if (t === 'REDUCIR_INTERVALO')  return '#ef4444';
  if (t === 'EXTENDER_INTERVALO') return '#22c55e';
  return '#6b7280';
}
function tendenciaIcon(t: Tendencia) {
  if (t === 'REDUCIR_INTERVALO')  return '⬇️';
  if (t === 'EXTENDER_INTERVALO') return '⬆️';
  return '➡️';
}
function confianzaBadgeColor(c: Confianza) {
  const map: Record<Confianza, string> = { ALTA: '#22c55e', MEDIA: '#f59e0b', BAJA: '#ef4444' };
  return map[c];
}

// ─── Componente ───────────────────────────────────────────────────────────────
export default function BenchmarkPanel({ globalAssetId, makeModel }: Props) {
  const { t } = useTranslation();

  const TIPO_LABELS: Record<TipoIntervencion, string> = {
    CAMBIO_ACEITE_MOTOR: t('benchmark.types.CAMBIO_ACEITE_MOTOR'),
    CAMBIO_FILTRO_ACEITE: t('benchmark.types.CAMBIO_FILTRO_ACEITE'),
    CAMBIO_FILTRO_AIRE: t('benchmark.types.CAMBIO_FILTRO_AIRE'),
    CAMBIO_FILTRO_COMBUSTIBLE: t('benchmark.types.CAMBIO_FILTRO_COMBUSTIBLE'),
    CAMBIO_FLUIDO_HIDRAULICO: t('benchmark.types.CAMBIO_FLUIDO_HIDRAULICO'),
    CAMBIO_FLUIDO_TRANSMISION: t('benchmark.types.CAMBIO_FLUIDO_TRANSMISION'),
    INSPECCION_FRENOS: t('benchmark.types.INSPECCION_FRENOS'),
    CAMBIO_PASTILLAS_FRENO: t('benchmark.types.CAMBIO_PASTILLAS_FRENO'),
    AJUSTE_TENSION_CADENA: t('benchmark.types.AJUSTE_TENSION_CADENA'),
    CAMBIO_DIENTES_BALDE: t('benchmark.types.CAMBIO_DIENTES_BALDE'),
    REVISION_GENERAL_MOTOR: t('benchmark.types.REVISION_GENERAL_MOTOR'),
    CALIBRACION_INYECTORES: t('benchmark.types.CALIBRACION_INYECTORES'),
    INSPECCION_ESTRUCTURA: t('benchmark.types.INSPECCION_ESTRUCTURA'),
    OTRA: t('benchmark.types.OTRA'),
  };

  const CONDICION_OPTS = [
    { value: 'NORMAL', label: t('benchmark.conditions.NORMAL') },
    { value: 'DESGASTE_PREMATURO', label: t('benchmark.conditions.DESGASTE_PREMATURO') },
    { value: 'FALLA', label: t('benchmark.conditions.FALLA') },
    { value: 'EXCELENTE', label: t('benchmark.conditions.EXCELENTE') },
  ];

  const [insights, setInsights]         = useState<BenchmarkInsight[]>([]);
  const [loading, setLoading]           = useState(false);
  const [generating, setGenerating]     = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [tab, setTab]                   = useState<'insights' | 'register'>('insights');
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [reviewingId, setReviewingId]   = useState<string | null>(null);
  const [form, setForm] = useState({
    tipoIntervencion: 'CAMBIO_ACEITE_MOTOR' as TipoIntervencion,
    operationalProfileId: 'rajo_abierto_nivel',
    horasReales: '',
    horasOem: '',
    condicionEncontrada: 'NORMAL',
    notas: '',
  });
  const [submitMsg, setSubmitMsg] = useState('');

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${BENCH_API}/insights/${globalAssetId}`);
      const data = await res.json();
      if (data.success) setInsights(data.insights ?? []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [globalAssetId]);

  useEffect(() => { fetchInsights(); }, [fetchInsights]);

  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      await authFetch(`${BENCH_API}/report/${globalAssetId}`, { method: 'POST' });
      await fetchInsights();
    } catch { /* silent */ } finally { setGenerating(false); }
  };

  const handleSubmitEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const uid = auth.currentUser?.uid ?? 'anon';
    const email = auth.currentUser?.email ?? 'anon';
    setSubmitting(true);
    setSubmitMsg('');
    try {
      const res = await authFetch(`${BENCH_API}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalAssetId,
          makeModel,
          tenantId:            uid,
          tipoIntervencion:    form.tipoIntervencion,
          operationalProfileId: form.operationalProfileId,
          horasReales:         parseFloat(form.horasReales),
          horasOem:            parseFloat(form.horasOem),
          condicionEncontrada: form.condicionEncontrada,
          notas:               form.notas || undefined,
        }),
      });
      const data = await res.json();
      setSubmitMsg(data.message ?? (data.success ? `✅ ${t('benchmark.form.success')}` : `❌ ${t('benchmark.form.error')}`));
      if (data.success) {
        setForm(f => ({ ...f, horasReales: '', notas: '' }));
        if (data.triggeredInsight) await handleGenerateReport();
        else await fetchInsights();
      }
      void email; // suppress unused
    } catch { setSubmitMsg(`❌ ${t('benchmark.form.conn_error')}`); } finally { setSubmitting(false); }
  };

  const handleReview = async (insightId: string, decision: 'APROBADO' | 'RECHAZADO') => {
    const email = auth.currentUser?.email ?? auth.currentUser?.uid ?? 'system';
    setReviewingId(insightId);
    try {
      await authFetch(`${BENCH_API}/insights/${insightId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reviewedBy: email }),
      });
      await fetchInsights();
    } catch { /* silent */ } finally { setReviewingId(null); }
  };

  const pendingCount  = insights.filter(i => i.status === 'PENDIENTE_HITL').length;
  const approvedCount = insights.filter(i => i.status === 'APROBADO').length;

  return (
    <div style={{ padding: '20px 24px', fontFamily: 'inherit' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>
            📊 {t('benchmark.title')}
          </h3>
          <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.55 }}>
            {t('benchmark.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {pendingCount > 0 && (
            <span style={{ background: '#f59e0b', color: '#fff', fontSize: 11, fontWeight: 700,
              padding: '2px 8px', borderRadius: 99 }}>
              {pendingCount} {pendingCount > 1 ? t('benchmark.pendings') : t('benchmark.pending')}
            </span>
          )}
          <button onClick={handleGenerateReport} disabled={generating}
            style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8,
              border: '1px solid rgba(128,128,128,0.3)', background: 'transparent',
              cursor: generating ? 'default' : 'pointer', opacity: generating ? 0.5 : 1 }}>
            {generating ? `⚙️ ${t('benchmark.analyzing')}` : `🔄 ${t('benchmark.regenerate')}`}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20,
        borderBottom: '1px solid rgba(128,128,128,0.15)' }}>
        {(['insights', 'register'] as const).map(tabKey => (
          <button key={tabKey} onClick={() => setTab(tabKey)}
            style={{ fontSize: 13, fontWeight: tab === tabKey ? 600 : 400, padding: '6px 14px',
              border: 'none', background: 'none', cursor: 'pointer',
              borderBottom: tab === tabKey ? '2px solid currentColor' : '2px solid transparent',
              opacity: tab === tabKey ? 1 : 0.5, transition: 'all .15s' }}>
            {tabKey === 'insights' ? `📈 ${t('benchmark.tabs.insights')} (${insights.length})` : `➕ ${t('benchmark.tabs.register')}`}
          </button>
        ))}
      </div>

      {/* Tab: Insights */}
      {tab === 'insights' && (
        <div>
          {loading && <p style={{ opacity: 0.5, fontSize: 13 }}>{t('benchmark.loading')}</p>}
          {!loading && insights.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', opacity: 0.4 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
              <p style={{ fontSize: 13 }}>{t('benchmark.no_insights')}<br />{t('benchmark.no_insights_desc')}</p>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {insights.map(ins => {
              const isExpanded = expandedId === ins.id;
              const desvioAbs  = Math.abs(ins.desvioPromedioPercent);
              return (
                <div key={ins.id}
                  style={{ border: '1px solid rgba(128,128,128,0.18)', borderRadius: 10, overflow: 'hidden' }}>

                  {/* Card header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', cursor: 'pointer', background: 'rgba(128,128,128,0.03)' }}
                    onClick={() => setExpandedId(isExpanded ? null : ins.id)}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {tendenciaIcon(ins.tendencia)} {TIPO_LABELS[ins.tipoIntervencion]}
                        </span>
                        <span style={{ fontSize: 11, opacity: 0.55 }}>· {ins.operationalProfileLabel}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99,
                          background: ins.status === 'APROBADO' ? '#22c55e22' : ins.status === 'RECHAZADO' ? '#ef444422' : '#f59e0b22',
                          color: ins.status === 'APROBADO' ? '#16a34a' : ins.status === 'RECHAZADO' ? '#dc2626' : '#d97706' }}>
                          {ins.status === 'PENDIENTE_HITL' ? t('benchmark.labels.pending_review') : ins.status}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99,
                          background: confianzaBadgeColor(ins.confianza) + '22',
                          color: confianzaBadgeColor(ins.confianza) }}>
                          {t('benchmark.labels.confidence')} {ins.confianza}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
                        <span style={{ fontSize: 12, opacity: 0.6 }}>{t('benchmark.labels.oem')}: <strong>{ins.horasOem}h</strong></span>
                        <span style={{ fontSize: 12, opacity: 0.6 }}>
                          {t('benchmark.labels.real')}: <strong style={{ color: tendenciaColor(ins.tendencia) }}>{ins.horasPromedioReal}h</strong>
                        </span>
                        <span style={{ fontSize: 12, color: tendenciaColor(ins.tendencia), fontWeight: 700 }}>
                          {ins.desvioPromedioPercent > 0 ? '+' : ''}{ins.desvioPromedioPercent.toFixed(1)}%
                        </span>
                        <span style={{ fontSize: 12, opacity: 0.5 }}>{t('benchmark.labels.n')}{ins.n}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 16, opacity: 0.4, marginLeft: 8 }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>

                  {/* Detail expanded */}
                  {isExpanded && (
                    <div style={{ padding: '16px', borderTop: '1px solid rgba(128,128,128,0.12)' }}>
                      <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16, opacity: 0.8 }}>
                        {ins.descripcion}
                      </p>

                      {/* Stats grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px,1fr))', gap: 10, marginBottom: 16 }}>
                        {[
                          { label: t('benchmark.stats.median'),       value: `${ins.horasMediana}h` },
                          { label: t('benchmark.stats.min'),          value: `${ins.horasMin}h` },
                          { label: t('benchmark.stats.max'),          value: `${ins.horasMax}h` },
                          { label: t('benchmark.stats.std_dev'),      value: `±${ins.desviacionEstandar}h` },
                          { label: t('benchmark.stats.deviation_vs_oem'), value: `${desvioAbs.toFixed(1)}%`, color: tendenciaColor(ins.tendencia) },
                          { label: t('benchmark.stats.base_events'),  value: `${ins.n}` },
                        ].map(s => (
                          <div key={s.label} style={{ background: 'rgba(128,128,128,0.06)', borderRadius: 8, padding: '10px 12px' }}>
                            <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 2 }}>{s.label}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* Condiciones */}
                      {ins.condicionDistribucion && Object.keys(ins.condicionDistribucion).length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 6 }}>{t('benchmark.stats.condition_found')}</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {Object.entries(ins.condicionDistribucion).map(([k, v]) => (
                              <span key={k} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99,
                                background: 'rgba(128,128,128,0.1)', fontWeight: 500 }}>
                                {t(`benchmark.conditions.${k}`, { defaultValue: k.replace(/_/g, ' ') })} ({v})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* HITL Actions */}
                      {ins.status === 'PENDIENTE_HITL' && (
                        <div style={{ display: 'flex', gap: 8, paddingTop: 12,
                          borderTop: '1px solid rgba(128,128,128,0.12)' }}>
                          <span style={{ fontSize: 12, opacity: 0.6, flex: 1, alignSelf: 'center' }}>
                            🔍 {t('benchmark.review_required')}
                          </span>
                          <button onClick={() => handleReview(ins.id, 'RECHAZADO')}
                            disabled={reviewingId === ins.id}
                            style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8,
                              border: '1px solid #ef4444', color: '#ef4444', background: 'transparent',
                              cursor: 'pointer', opacity: reviewingId === ins.id ? 0.5 : 1 }}>
                            ✗ {t('benchmark.reject')}
                          </button>
                          <button onClick={() => handleReview(ins.id, 'APROBADO')}
                            disabled={reviewingId === ins.id}
                            style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8,
                              border: 'none', background: '#22c55e', color: '#fff',
                              cursor: 'pointer', opacity: reviewingId === ins.id ? 0.5 : 1, fontWeight: 600 }}>
                            ✓ {t('benchmark.approve')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {insights.length > 0 && (
            <div style={{ marginTop: 16, padding: '10px 16px', borderRadius: 8,
              background: 'rgba(128,128,128,0.05)', fontSize: 12, opacity: 0.7 }}>
              {approvedCount} aprobado(s) · {pendingCount} pendiente(s)
            </div>
          )}
        </div>
      )}

      {/* Tab: Registro de evento */}
      {tab === 'register' && (
        <form onSubmit={handleSubmitEvent} autoComplete="off">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, opacity: 0.55, display: 'block', marginBottom: 4 }}>{t('benchmark.form.type')}</label>
              <select value={form.tipoIntervencion}
                onChange={e => setForm(f => ({ ...f, tipoIntervencion: e.target.value as TipoIntervencion }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
                  border: '1px solid rgba(128,128,128,0.25)', background: 'transparent', fontSize: 13 }}>
                {Object.entries(TIPO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, opacity: 0.55, display: 'block', marginBottom: 4 }}>{t('benchmark.form.oem_interval')}</label>
              <input type="number" min="1" required value={form.horasOem}
                onChange={e => setForm(f => ({ ...f, horasOem: e.target.value }))}
                placeholder="ej: 500"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
                  border: '1px solid rgba(128,128,128,0.25)', background: 'transparent', fontSize: 13 }} />
            </div>

            <div>
              <label style={{ fontSize: 11, opacity: 0.55, display: 'block', marginBottom: 4 }}>{t('benchmark.form.real_hours')}</label>
              <input type="number" min="1" required value={form.horasReales}
                onChange={e => setForm(f => ({ ...f, horasReales: e.target.value }))}
                placeholder="ej: 448"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
                  border: '1px solid rgba(128,128,128,0.25)', background: 'transparent', fontSize: 13 }} />
            </div>

            <div>
              <label style={{ fontSize: 11, opacity: 0.55, display: 'block', marginBottom: 4 }}>{t('benchmark.form.condition')}</label>
              <select value={form.condicionEncontrada}
                onChange={e => setForm(f => ({ ...f, condicionEncontrada: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
                  border: '1px solid rgba(128,128,128,0.25)', background: 'transparent', fontSize: 13 }}>
                {CONDICION_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, opacity: 0.55, display: 'block', marginBottom: 4 }}>{t('benchmark.form.operational_profile')}</label>
              <input value={form.operationalProfileId}
                onChange={e => setForm(f => ({ ...f, operationalProfileId: e.target.value }))}
                placeholder="ej: cordillera_alta"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
                  border: '1px solid rgba(128,128,128,0.25)', background: 'transparent', fontSize: 13 }} />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, opacity: 0.55, display: 'block', marginBottom: 4 }}>{t('benchmark.form.notes')}</label>
              <textarea rows={2} value={form.notas}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder={t('benchmark.form.notes_placeholder')}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, resize: 'vertical',
                  border: '1px solid rgba(128,128,128,0.25)', background: 'transparent', fontSize: 13 }} />
            </div>
          </div>

          <p style={{ fontSize: 11, opacity: 0.4, marginTop: 10, lineHeight: 1.5 }}>
            🔒 {t('benchmark.form.anonymous_alert')}
          </p>

          {submitMsg && (
            <div style={{ marginTop: 8, fontSize: 13, padding: '8px 12px', borderRadius: 8,
              background: submitMsg.includes('✅') ? '#22c55e18' : '#ef444418',
              color: submitMsg.includes('✅') ? '#16a34a' : '#dc2626' }}>
              {submitMsg}
            </div>
          )}

          <button type="submit" disabled={submitting}
            style={{ marginTop: 14, width: '100%', padding: '10px', borderRadius: 8,
              border: 'none', background: '#1a1a2e', color: '#fff',
              fontSize: 14, fontWeight: 600,
              cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
            {submitting ? t('benchmark.form.registering') : `📥 ${t('benchmark.form.register_btn')}`}
          </button>
        </form>
      )}
    </div>
  );
}
