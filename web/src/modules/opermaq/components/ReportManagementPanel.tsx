import React, { useState, useEffect } from 'react';
import { db, API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { M3Button } from './M3Button';
import { M3IconButton } from './M3IconButton';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

interface ReportEvent {
  id: string;
  event_type: string;
  source_skill: string;
  payload: Record<string, unknown>;
  timestamp: unknown;
  user_id: string;
}

export const ReportManagementPanel: React.FC = () => {
  const { t } = useTranslation();
  const [history, setHistory] = useState<ReportEvent[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loading, setLoading] = useState(true);

  const SkeletonRow = () => (
    <tr>
      {[...Array(4)].map((_, i) => (
        <td key={i} className="p-4">
          <div className="h-3 bg-black/10 dark:bg-white/10 rounded-none animate-pulse w-full" />
        </td>
      ))}
    </tr>
  );

  // Suscribirse al historial de auditoría de reportes
  useEffect(() => {
    const q = query(
      collection(db, 'event_ledger'),
      where('event_type', 'in', ['REPORT_GENERATION_SUCCESS', 'REPORT_GENERATION_FAILED', 'REPORT_GENERATION_STARTED']),
      orderBy('timestamp', 'desc'),
      limit(20)
    );

    const unsub = onSnapshot(q, (snap) => {
      const events = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ReportEvent[];
      setHistory(events);
      setLoading(false);
    }, (error) => {
      console.error('Error sub al historial de reportes:', error);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const handleGenerateManual = async () => {
    if (isGenerating) return;
    
    setIsGenerating(true);
    toast.info(t('reports.started_toast', 'Iniciando generación de reporte ejecutivo...'));

    try {
      const res = await authFetch(`${API_BASE_URL}/reports/monthly-pdf`, {
        method: 'POST',
        headers: {
          'X-CRON-SECRET': import.meta.env.VITE_CRON_SECRET || '' // Sync con reportRoutes.ts
        }
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(t('reports.success_generated', 'Reporte generado y notificado exitosamente.'));
        if (data.reportUrl) {
          window.open(data.reportUrl, '_blank');
        }
      } else {
        const errorData = await res.json();
        toast.error(t('reports.error_generate', { message: errorData.message || 'No se pudo generar el reporte' }));
      }
    } catch (err) {
      console.error('Error manual report:', err);
      toast.error(t('reports.error_connect', 'Error crítico al conectar con el servicio de reportes.'));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background font-atkinson p-8 overflow-y-auto panel-enter">
      {/* Header */}
      <div className="flex justify-between items-end mb-10">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1 h-3 bg-copper"></span>
            <span className="text-[10px] font-black tracking-[0.2em] text-muted uppercase">
              {t('reports.subtitle', 'Intelligence System')}
            </span>
          </div>
          <h2 className="text-4xl font-black tracking-tighter text-foreground uppercase">
            {t('reports.title', 'Centro de Reportes')}
          </h2>
        </div>
        
        <M3Button 
          variant="primary" 
          onClick={handleGenerateManual}
          disabled={isGenerating}
          className="!h-14 !px-8 !text-[11px] font-black tracking-widest"
        >
          {isGenerating ? (
            <span className="flex items-center gap-2">
              {t('reports.generating', 'PROCESANDO')} <span className="animate-spin material-symbols-outlined">sync</span>
            </span>
          ) : (
            t('reports.generate_cta', 'GENERAR REPORTE MENSUAL AHORA')
          )}
        </M3Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* KPI Panel */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white/5 dark:bg-black/10 backdrop-blur-md border border-white/10 p-6 flex flex-col gap-4">
            <span className="text-[10px] font-black text-muted uppercase tracking-widest">{t('reports.service_status', 'Estado del Servicio')}</span>
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm font-bold">{t('reports.scheduler_active', 'Cloud Scheduler: ACTIVE')}</span>
            </div>
            <p className="text-[11px] text-muted leading-relaxed">
              {t('reports.scheduler_desc', 'Los reportes se generan automáticamente el primer día de cada mes a las 00:00 UTC. Este panel permite disparos manuales para auditorías ad-hoc.')}
            </p>
          </div>

          <div className="bg-copper/5 border border-copper/20 p-6 flex flex-col gap-4 backdrop-blur-md">
            <span className="text-[10px] font-black text-copper uppercase tracking-widest">{t('reports.destinations_title', 'Configuración Destinos')}</span>
            <div className="flex items-center gap-2 text-sm">
              <span className="material-symbols-outlined text-xs">verified</span>
              <span>{t('reports.dest_whatsapp', 'Supervisores vía WhatsApp')}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="material-symbols-outlined text-xs">verified</span>
              <span>{t('reports.dest_storage', 'Cloud Storage (Historial PDF)')}</span>
            </div>
          </div>
        </div>

        {/* History Ledger */}
        <div className="lg:col-span-2">
          <div className="bg-surface border border-border-base flex flex-col h-[600px]">
            <div className="p-4 border-b border-border-base bg-black/5 dark:bg-white/5 flex justify-between items-center">
              <span className="text-[10px] font-black uppercase tracking-widest">{t('reports.ledger_title', 'Historial de Auditoría (Event Ledger)')}</span>
              <M3IconButton icon="refresh" variant="ghost" className="!w-8 !h-8" />
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <table className="w-full text-left border-collapse">
                  <tbody>
                    <SkeletonRow />
                  </tbody>
                </table>
              ) : history.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-20 p-10 text-center">
                  <span className="material-symbols-outlined text-4xl mb-4">history_edu</span>
                  <p className="text-xs uppercase font-black">{t('reports.ledger_empty', 'No hay registros de reportes en el ledger.')}</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-black/10 dark:bg-white/10 text-[9px] font-black uppercase tracking-widest text-muted">
                      <th className="p-4">{t('reports.event_col', 'Evento')}</th>
                      <th className="p-4">{t('reports.date_col', 'Fecha/Hora')}</th>
                      <th className="p-4">{t('reports.details_col', 'Detalles')}</th>
                      <th className="p-4 text-right">{t('reports.action_col', 'Acción')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-base/50">
                    {history.map((event) => (
                      <tr key={event.id} className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors group">
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 ${
                              event.event_type === 'REPORT_GENERATION_SUCCESS' ? 'bg-green-500' : 
                              event.event_type === 'REPORT_GENERATION_FAILED' ? 'bg-red-500' : 'bg-copper'
                            }`}></div>
                            <span className="text-[10px] font-bold uppercase truncate max-w-[150px]">
                              {event.event_type.replace('REPORT_GENERATION_', '')}
                            </span>
                          </div>
                        </td>
                        <td className="p-4 text-[10px] opacity-60">
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          {(event.timestamp as any)?.toDate ? (event.timestamp as any).toDate().toLocaleString() : 'N/A'}
                        </td>
                        <td className="p-4">
                          <div className="text-[10px] truncate max-w-[200px] opacity-40 italic">
                            {String(event.event_type === 'REPORT_GENERATION_SUCCESS' 
                              ? t('reports.pdf_generated', { url: (event.payload?.reportUrl as string)?.substring(0, 30) })
                              : event.event_type === 'REPORT_GENERATION_FAILED'
                              ? t('reports.generation_error', { error: String(event.payload?.error || '') })
                              : t('reports.generating_in_progress', 'Generación en curso...'))}
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          {Boolean(event.payload?.reportUrl) && (
                            <button 
                              onClick={() => window.open(event.payload.reportUrl as string, '_blank')}
                              className="text-[9px] font-black text-copper uppercase hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              {t('reports.view_pdf', 'VER PDF')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .panel-enter { animation: fadeSlideUp 0.35s ease-out both; }
        
        ::-webkit-scrollbar {
          width: 4px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(184, 115, 51, 0.1);
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(184, 115, 51, 0.3);
        }
      `}</style>
    </div>
  );
};
