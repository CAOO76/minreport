import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import { M3IconButton } from './M3IconButton';

interface CatalogStats {
  total_global_assets: number;
  total_fleet_deployments: number;
  reuse_ratio: string;
  active_deployments: number;
  discarded_deployments: number;
}

export const AdminMetricsDashboard: React.FC = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(`${API_BASE_URL}/admin/catalog-stats`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setStats(data);
    } catch (err: unknown) {
      console.error('[AdminMetricsDashboard] Error fetching stats:', err);
      setError(t('analytics.error_loading', 'Error al cargar las métricas de administración.'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="flex flex-col h-full bg-background font-atkinson p-8 overflow-y-auto panel-enter select-none">
      {/* Header */}
      <div className="flex justify-between items-end mb-10">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1.5 h-3 bg-copper"></span>
            <span className="text-[10px] font-black tracking-[0.25em] text-muted uppercase">
              Consola de Operaciones
            </span>
          </div>
          <h2 className="text-4xl font-black tracking-tighter text-foreground uppercase">
            Métricas de Gobernanza y Uso
          </h2>
        </div>
        
        <M3IconButton 
          icon="refresh" 
          variant="secondary" 
          onClick={fetchStats}
          className="!w-12 !h-12"
          title={t('common.refresh', 'Actualizar')}
        />
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center min-h-[300px]">
          <span className="material-symbols-outlined animate-spin text-copper !text-4xl">progress_activity</span>
          <p className="text-[10px] font-black tracking-[0.2em] text-muted uppercase mt-4">Consultando datos del catálogo maestro...</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-red-500/20 bg-red-500/[0.02] p-8 min-h-[300px]">
          <span className="material-symbols-outlined text-red-500 !text-4xl mb-4">report</span>
          <p className="text-sm font-bold text-red-500">{error}</p>
          <button 
            onClick={fetchStats}
            className="mt-6 px-4 py-2 border border-red-500/30 text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-500/10 transition-colors"
          >
            Reintentar Conexión
          </button>
        </div>
      ) : stats ? (
        <div className="space-y-10">
          {/* Grid de KPIs Principales */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Tarjeta 1: Catálogos Globales */}
            <div className="bg-surface border border-border-base p-6 flex flex-col justify-between min-h-[140px] hover:border-copper/30 transition-all duration-300 relative group overflow-hidden">
              <div className="absolute top-0 left-0 w-[2px] h-full bg-copper scale-y-0 group-hover:scale-y-100 transition-transform duration-500"></div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-muted">{t('metrics.global_assets', 'Activos en Catálogo Maestro')}</p>
                <p className="text-5xl font-black tracking-tighter mt-4 text-foreground">{stats.total_global_assets}</p>
              </div>
              <div className="flex items-center gap-2 mt-4 text-[10px] text-muted/60 uppercase font-black">
                <span className="material-symbols-outlined text-[14px]">database</span>
                <span>Modelos oficiales normalizados</span>
              </div>
            </div>

            {/* Tarjeta 2: Despliegues Totales */}
            <div className="bg-surface border border-border-base p-6 flex flex-col justify-between min-h-[140px] hover:border-copper/30 transition-all duration-300 relative group overflow-hidden">
              <div className="absolute top-0 left-0 w-[2px] h-full bg-copper scale-y-0 group-hover:scale-y-100 transition-transform duration-500"></div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-muted">{t('metrics.fleet_deployments', 'Despliegues en Clientes')}</p>
                <p className="text-5xl font-black tracking-tighter mt-4 text-foreground">{stats.total_fleet_deployments}</p>
              </div>
              <div className="flex items-center gap-4 mt-4">
                <div className="flex items-center gap-1 text-[10px] font-bold text-green-500">
                  <span className="w-1.5 h-1.5 bg-green-500"></span>
                  <span>{stats.active_deployments} Activos</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] font-bold text-muted/50">
                  <span className="w-1.5 h-1.5 bg-muted/40"></span>
                  <span>{stats.discarded_deployments} Archivados</span>
                </div>
              </div>
            </div>

            {/* Tarjeta 3: Ratio de Reutilización */}
            <div className="bg-surface border border-border-base p-6 flex flex-col justify-between min-h-[140px] hover:border-copper/30 transition-all duration-300 relative group overflow-hidden">
              <div className="absolute top-0 left-0 w-[2px] h-full bg-copper scale-y-0 group-hover:scale-y-100 transition-transform duration-500"></div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-muted">{t('metrics.reuse_ratio', 'Tasa de Reutilización de Catálogo')}</p>
                <p className="text-5xl font-black tracking-tighter mt-4 text-copper">{stats.reuse_ratio}</p>
              </div>
              <div className="flex items-center gap-2 mt-4 text-[10px] text-muted/60 uppercase font-black">
                <span className="material-symbols-outlined text-[14px]">share</span>
                <span>Equipos de clientes por activo maestro</span>
              </div>
            </div>
          </div>

          {/* Gráfico y Sección de Gestión Operativa */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Panel Izquierdo: Resumen de Distribución */}
            <div className="lg:col-span-1 bg-surface border border-border-base p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-[11px] font-black uppercase tracking-widest mb-4">Salud del Catálogo Industrial</h3>
                <p className="text-xs text-muted leading-relaxed">
                  La arquitectura de OPERMAQ previene la redundancia de datos. Una tasa de reutilización mayor a 1.00 indica que múltiples clientes están vinculando sus flotas a especificaciones técnicas y manuales ya validados por expertos (Test Pilots), reduciendo el costo operacional de generación mediante IA.
                </p>
              </div>
              
              <div className="mt-8 space-y-4 border-t border-border-base pt-6">
                <div>
                  <div className="flex justify-between text-[10px] font-black uppercase tracking-widest mb-1.5">
                    <span>Eficiencia de Datos</span>
                    <span className="text-copper">
                      {stats.total_global_assets > 0 
                        ? `${Math.min(100, Math.round((stats.total_fleet_deployments / (stats.total_global_assets * 5)) * 100))}%`
                        : '0%'
                      }
                    </span>
                  </div>
                  <div className="w-full h-1 bg-black/5 dark:bg-white/5">
                    <div 
                      className="h-full bg-copper transition-all duration-1000"
                      style={{ 
                        width: stats.total_global_assets > 0 
                          ? `${Math.min(100, (stats.total_fleet_deployments / (stats.total_global_assets * 5)) * 100)}%`
                          : '0%' 
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Panel Derecho: Tabla de Control de Despliegues */}
            <div className="lg:col-span-2 bg-surface border border-border-base p-6 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-[11px] font-black uppercase tracking-widest">
                    Historial de Despliegue Consolidado
                  </h3>
                  <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 bg-copper/10 text-copper">
                    Master Catalog
                  </span>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-border-base text-[9px] font-black uppercase tracking-widest text-muted">
                        <th className="pb-3">Métrica de Catálogo</th>
                        <th className="pb-3 text-right">Valor Consolidado</th>
                        <th className="pb-3 text-right">Métrica Relativa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04] text-xs">
                      <tr>
                        <td className="py-3.5 font-medium text-foreground">Total Equipos en Producción</td>
                        <td className="py-3.5 text-right font-bold">{stats.total_fleet_deployments}</td>
                        <td className="py-3.5 text-right text-muted/65">100% de la flota</td>
                      </tr>
                      <tr>
                        <td className="py-3.5 font-medium text-foreground">Equipos en Operación Activa</td>
                        <td className="py-3.5 text-right font-bold text-green-500">{stats.active_deployments}</td>
                        <td className="py-3.5 text-right text-muted/65">
                          {stats.total_fleet_deployments > 0 
                            ? `${Math.round((stats.active_deployments / stats.total_fleet_deployments) * 100)}%` 
                            : '0%'}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 font-medium text-foreground">Equipos Descartados/Archivados</td>
                        <td className="py-3.5 text-right font-bold">{stats.discarded_deployments}</td>
                        <td className="py-3.5 text-right text-muted/65">
                          {stats.total_fleet_deployments > 0 
                            ? `${Math.round((stats.discarded_deployments / stats.total_fleet_deployments) * 100)}%` 
                            : '0%'}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3.5 font-medium text-foreground">Densidad de Bóveda por Activo</td>
                        <td className="py-3.5 text-right font-bold text-copper">5 Pilares</td>
                        <td className="py-3.5 text-right text-muted/65">Estructura normalizada</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-border-base flex justify-between items-center text-[10px] text-muted">
                <span>Último análisis: Tiempo real</span>
                <span className="font-bold">CONEXIÓN ESTABLE</span>
              </div>
            </div>

          </div>
        </div>
      ) : null}

      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .panel-enter { animation: fadeSlideUp 0.3s ease-out both; }
      `}</style>
    </div>
  );
};
