import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import { M3Button } from './M3Button';

/**
 * F4.3 — Integration Panel
 *
 * Panel de exportación e integración con ecosistemas externos.
 * Disponible en el tab "Integraciones" del KnowledgeVaultDashboard.
 *
 * Funcionalidades:
 *   • Exportar datos validados como JSON (CMMS / IBM Maximo / SAP PM)
 *   • Exportar datos validados como CSV (ERP / hojas de cálculo)
 *   • Probar webhook de anomalías (DINGO Trakka / terceros)
 *   • Visualizar el estado del gateway de integración
 */

interface IntegrationPanelProps {
  globalAssetId: string;
  makeModel: string;
}

type ExportPillar = 'manual_operaciones' | 'pauta_mantencion' | 'matriz_riesgos' | 'checklist_pre_op';

const IntegrationPanel: React.FC<IntegrationPanelProps> = ({ globalAssetId, makeModel }) => {
  const { t } = useTranslation();

  const PILLAR_OPTIONS: { id: ExportPillar; label: string; icon: string }[] = [
    { id: 'manual_operaciones', label: t('vault.pillar_labels.manual_operaciones'), icon: 'settings' },
    { id: 'pauta_mantencion',   label: t('vault.pillar_labels.pauta_mantencion'),   icon: 'build' },
    { id: 'matriz_riesgos',     label: t('vault.pillar_labels.matriz_riesgos'),     icon: 'security' },
    { id: 'checklist_pre_op',   label: t('vault.pillar_labels.checklist_pre_op'),   icon: 'rule' },
  ];

  const [selectedPillars, setSelectedPillars] = useState<Set<ExportPillar>>(
    new Set<ExportPillar>(['manual_operaciones', 'pauta_mantencion', 'matriz_riesgos', 'checklist_pre_op'])
  );
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);
  const [exportResult, setExportResult] = useState<{
    type: 'success' | 'error';
    message: string;
    records?: number;
  } | null>(null);

  // Anomaly test state
  const [anomalyType, setAnomalyType] = useState('engine_overheating');
  const [anomalyDesc, setAnomalyDesc] = useState('');
  const [anomalySeverity, setAnomalySeverity] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('HIGH');
  const [testingAnomaly, setTestingAnomaly] = useState(false);
  const [anomalyResult, setAnomalyResult] = useState<{ found: boolean; message: string } | null>(null);

  const togglePillar = (pillar: ExportPillar) => {
    setSelectedPillars(prev => {
      const next = new Set(prev);
      if (next.has(pillar)) {
        next.delete(pillar);
      } else {
        next.add(pillar);
      }
      return next;
    });
  };

  const pillarsParam = Array.from(selectedPillars).join(',');

  // ─── Exportación JSON ─────────────────────────────────────────────────────

  const handleExportJson = async () => {
    setExporting('json');
    setExportResult(null);
    try {
      const res = await authFetch(
        `${API_BASE_URL}/integration/export/${encodeURIComponent(globalAssetId)}?format=cmms&pillars=${pillarsParam}`
      );
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || t('integration.export.common.error'));

      // Descargar como archivo JSON
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `opermaq-${globalAssetId}-cmms.json`;
      a.click();
      URL.revokeObjectURL(url);

      setExportResult({
        type: 'success',
        message: t('integration.export.json.success'),
        records: data.meta?.total_records ?? 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('integration.export.common.error');
      setExportResult({ type: 'error', message });
    } finally {
      setExporting(null);
    }
  };

  // ─── Exportación CSV ──────────────────────────────────────────────────────

  const handleExportCsv = async () => {
    setExporting('csv');
    setExportResult(null);
    try {
      const res = await authFetch(
        `${API_BASE_URL}/integration/export/${encodeURIComponent(globalAssetId)}/csv?pillars=${pillarsParam}`
      );

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || t('integration.export.common.error'));
      }

      const csv = await res.text();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `opermaq-${globalAssetId}-erp.csv`;
      a.click();
      URL.revokeObjectURL(url);

      const rowCount = csv.split('\n').length - 1;
      setExportResult({ type: 'success', message: t('integration.export.csv.success'), records: rowCount });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('integration.export.common.error');
      setExportResult({ type: 'error', message });
    } finally {
      setExporting(null);
    }
  };

  // ─── Test de anomalía ────────────────────────────────────────────────────

  const handleTestAnomaly = async () => {
    setTestingAnomaly(true);
    setAnomalyResult(null);
    try {
      const res = await authFetch(`${API_BASE_URL}/integration/anomaly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          external_asset_id: `TEST-${Date.now()}`,
          opermaq_catalog_id: globalAssetId,
          anomaly_type: anomalyType,
          anomaly_description: anomalyDesc || `Anomalía de prueba: ${anomalyType}`,
          severity: anomalySeverity,
          detected_at: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      setAnomalyResult({ found: data.found, message: data.message || data.procedure || 'Sin respuesta' });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('integration.webhook.error');
      setAnomalyResult({ found: false, message });
    } finally {
      setTestingAnomaly(false);
    }
  };

  return (
    <div className="p-5 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-black/5">
        <span className="material-symbols-outlined text-copper !text-2xl">hub</span>
        <div>
          <h3 className="text-sm font-black tracking-widest text-black/80 dark:text-white/80 uppercase">
            {t('integration.title')}
          </h3>
          <p className="text-[10px] text-black/40 dark:text-white/40 mt-0.5">
            {t('integration.subtitle', { model: makeModel })}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-green-50 dark:bg-green-900/20 rounded-none border border-green-200/50">
          <div className="w-1.5 h-1.5 rounded-none bg-green-500 animate-pulse" />
          <span className="text-[10px] font-black text-green-700 dark:text-green-400 uppercase tracking-wider">{t('integration.status.online')}</span>
        </div>
      </div>

      {/* Selector de pilares */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-black/40 dark:text-white/40 mb-2">
          {t('integration.pillars_label')}
        </p>
        <div className="flex flex-wrap gap-2">
          {PILLAR_OPTIONS.map(p => (
            <button
              key={p.id}
              onClick={() => togglePillar(p.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-none text-[10px] font-black uppercase tracking-wider border transition-all ${
                selectedPillars.has(p.id)
                  ? 'bg-copper text-white border-copper'
                  : 'bg-transparent text-black/40 border-black/10 hover:border-copper/40'
              }`}
            >
              <span className="material-symbols-outlined !text-[12px]">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Botones de exportación */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* JSON / CMMS */}
        <div className="rounded-none border border-black/8 dark:border-white/8 bg-white dark:bg-black/20 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined !text-[20px] text-blue-500">data_object</span>
            <div>
              <p className="text-xs font-black text-black/80 dark:text-white/80">{t('integration.export.json.title')}</p>
              <p className="text-[10px] text-black/40">{t('integration.export.json.subtitle')}</p>
            </div>
          </div>
          <p className="text-[10px] text-black/50 dark:text-white/40 leading-relaxed">
            {t('integration.export.json.description')}
          </p>
          <M3Button
            onClick={handleExportJson}
            icon={exporting === 'json' ? 'hourglass_empty' : 'download'}
            variant="primary"
            disabled={exporting !== null || selectedPillars.size === 0}
          >
            {exporting === 'json' ? t('integration.export.json.exporting') : t('integration.export.json.btn')}
          </M3Button>
        </div>

        {/* CSV / ERP */}
        <div className="rounded-none border border-black/8 dark:border-white/8 bg-white dark:bg-black/20 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined !text-[20px] text-green-500">table</span>
            <div>
              <p className="text-xs font-black text-black/80 dark:text-white/80">{t('integration.export.csv.title')}</p>
              <p className="text-[10px] text-black/40">{t('integration.export.csv.subtitle')}</p>
            </div>
          </div>
          <p className="text-[10px] text-black/50 dark:text-white/40 leading-relaxed">
            {t('integration.export.csv.description')}
          </p>
          <M3Button
            onClick={handleExportCsv}
            icon={exporting === 'csv' ? 'hourglass_empty' : 'download'}
            variant="secondary"
            disabled={exporting !== null || selectedPillars.size === 0}
          >
            {exporting === 'csv' ? t('integration.export.csv.exporting') : t('integration.export.csv.btn')}
          </M3Button>
        </div>
      </div>

      {/* Resultado de exportación */}
      {exportResult && (
        <div className={`flex items-start gap-2 px-3 py-2.5 rounded-none text-[10px] font-medium ${
          exportResult.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200/50'
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200/50'
        }`}>
          <span className="material-symbols-outlined !text-[14px] mt-0.5">
            {exportResult.type === 'success' ? 'check_circle' : 'error'}
          </span>
          <span>
            {exportResult.message}
            {exportResult.records !== undefined && ` (${t('integration.export.common.records', { count: exportResult.records })})`}
          </span>
        </div>
      )}

      {/* Webhook anomalías — DINGO Trakka */}
      <div className="rounded-none border border-black/8 dark:border-white/8 bg-white dark:bg-black/20 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined !text-[20px] text-amber-500">webhook</span>
          <div>
            <p className="text-xs font-black text-black/80 dark:text-white/80">{t('integration.webhook.title')}</p>
            <p className="text-[10px] text-black/40">{t('integration.webhook.subtitle')}</p>
          </div>
        </div>
        <p className="text-[10px] text-black/50 dark:text-white/40 leading-relaxed">
          {t('integration.webhook.description')}
        </p>

        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] font-black uppercase tracking-wider text-black/40">{t('integration.webhook.type_label')}</label>
              <input
                type="text"
                value={anomalyType}
                onChange={e => setAnomalyType(e.target.value)}
                placeholder="ej: engine_overheating"
                className="w-full mt-1 px-3 py-1.5 text-[10px] bg-black/5 dark:bg-white/5 rounded-none border border-black/8 outline-none focus:border-copper"
                autoComplete="off"
              />
            </div>
            <div className="w-28">
              <label className="text-[10px] font-black uppercase tracking-wider text-black/40">{t('integration.webhook.severity_label')}</label>
              <select
                value={anomalySeverity}
                onChange={e => setAnomalySeverity(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL')}
                className="w-full mt-1 px-2 py-1.5 text-[10px] bg-black/5 dark:bg-white/5 rounded-none border border-black/8 outline-none focus:border-copper"
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-black/40">{t('integration.webhook.desc_label')}</label>
            <input
              type="text"
              value={anomalyDesc}
              onChange={e => setAnomalyDesc(e.target.value)}
              placeholder={t('integration.webhook.desc_placeholder')}
              className="w-full mt-1 px-3 py-1.5 text-[10px] bg-black/5 dark:bg-white/5 rounded-none border border-black/8 outline-none focus:border-copper"
              autoComplete="off"
            />
          </div>
          <M3Button
            onClick={handleTestAnomaly}
            icon={testingAnomaly ? 'hourglass_empty' : 'send'}
            variant="ghost"
            disabled={testingAnomaly || !anomalyType}
          >
            {testingAnomaly ? t('integration.webhook.analyzing') : t('integration.webhook.btn')}
          </M3Button>
        </div>

        {anomalyResult && (
          <div className={`flex items-start gap-2 px-3 py-2.5 rounded-none text-[10px] font-medium ${
            anomalyResult.found
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200/50'
              : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200/50'
          }`}>
            <span className="material-symbols-outlined !text-[14px] mt-0.5">
              {anomalyResult.found ? 'medical_information' : 'info'}
            </span>
            <span>{anomalyResult.message}</span>
          </div>
        )}
      </div>

      {/* Endpoint reference */}
      <div className="rounded-none border border-black/5 dark:border-white/5 bg-black/2 dark:bg-white/2 p-4 space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-black/30 dark:text-white/30 mb-3">
          {t('integration.api_ref.title')}
        </p>
        {[
          { method: 'GET',   path: `/api/integration/export/${globalAssetId}`,      desc: t('integration.api_ref.json_desc') },
          { method: 'GET',   path: `/api/integration/export/${globalAssetId}/csv`,  desc: t('integration.api_ref.csv_desc') },
          { method: 'POST',  path: '/api/integration/anomaly',                       desc: t('integration.api_ref.webhook_desc') },
          { method: 'GET',   path: '/api/integration/health',                        desc: t('integration.api_ref.health_desc') },
        ].map(ep => (
          <div key={ep.path} className="flex items-center gap-2">
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-none font-mono ${
              ep.method === 'GET' ? 'bg-blue-100 text-blue-700' :
              ep.method === 'POST' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
            }`}>{ep.method}</span>
            <code className="text-[10px] text-black/50 dark:text-white/50 font-mono">{ep.path}</code>
            <span className="text-[10px] text-black/30 dark:text-white/30 ml-auto">{ep.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default IntegrationPanel;
