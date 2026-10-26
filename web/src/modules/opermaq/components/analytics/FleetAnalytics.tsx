import React from 'react';
import { useAnalyticsStats } from '../../hooks/useAnalyticsStats';
import { useVaultStats } from '../../hooks/useVaultStats';
import { FleetHealthGauge } from './FleetHealthGauge';
import { ChecklistComplianceChart } from './ChecklistComplianceChart';
import { RiskDistributionPie } from './RiskDistributionPie';
import { VaultCompletenessProgress } from './VaultCompletenessProgress';
import { M3IconButton } from '../M3IconButton';
import { useTranslation } from 'react-i18next';

export const FleetAnalytics: React.FC = () => {
  const { t } = useTranslation();
  const { stats: analytics, loading: loadingAnalytics, refresh: refreshAnalytics } = useAnalyticsStats();
  const { stats: vault, loading: loadingVault, refresh: refreshVault } = useVaultStats();

  const handleRefresh = () => {
    refreshAnalytics();
    refreshVault();
  };

  return (
    <div className="flex flex-col h-full bg-background font-atkinson p-8 overflow-y-auto panel-enter">
      {/* Header */}
      <div className="flex justify-between items-end mb-10">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1 h-3 bg-copper"></span>
            <span className="text-[10px] font-black tracking-[0.2em] text-muted uppercase">
              {t('analytics.subtitle', 'Operational Intelligence')}
            </span>
          </div>
          <h2 className="text-4xl font-black tracking-tighter text-foreground uppercase">
            {t('analytics.title', 'Fleet Analytics Dashboard')}
          </h2>
        </div>
        
        <M3IconButton 
          icon="refresh" 
          variant="secondary" 
          onClick={handleRefresh}
          className="!w-12 !h-12"
          title={t('common.refresh', 'Actualizar')}
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* KPI Cards Top */}
        <div className="lg:col-span-1 bg-surface border border-border-base p-6 flex flex-col gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest opacity-40">{t('analytics.inspections_30d', 'Inspecciones (30d)')}</span>
          <span className="text-5xl font-black tracking-tighter">{analytics.totalInspections}</span>
          <div className="flex items-center gap-2 mt-2 font-mono text-[10px] text-muted uppercase">
            <span>Período: 30 Días</span>
          </div>
        </div>

        <div className="lg:col-span-1 bg-surface border border-border-base p-6 flex flex-col gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest opacity-40">{t('analytics.critical_events', 'Eventos Críticos')}</span>
          <span className="text-5xl font-black tracking-tighter text-red-500">{analytics.criticalFailures}</span>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] font-bold text-red-500">ALERTA</span>
            <span className="text-[10px] opacity-30 uppercase font-black">requiere acción</span>
          </div>
        </div>

        <div className="lg:col-span-2 bg-surface border border-border-base p-6 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <span className="text-[9px] font-black uppercase tracking-widest opacity-40">{t('analytics.daily_activity', 'Actividad Diaria')}</span>
            <span className="text-[10px] font-black text-copper uppercase">{t('analytics.last_30_days', 'Últimos 30 días')}</span>
          </div>
          <div className="h-24">
            <ChecklistComplianceChart data={analytics.dailyActivity} loading={loadingAnalytics} />
          </div>
        </div>

        {/* Second Row */}
        <div className="lg:col-span-1 bg-surface border border-border-base p-8 flex flex-col items-center">
          <div className="w-full aspect-square">
            <FleetHealthGauge score={analytics.complianceRate} loading={loadingAnalytics} />
          </div>
          <p className="text-[11px] text-center opacity-40 leading-tight mt-4">
            {t('analytics.fleet_health_desc', 'Calculado basado en la tasa de aprobación de ítems críticos en terreno.')}
          </p>
        </div>

        <div className="lg:col-span-1 bg-surface border border-border-base p-6 flex flex-col gap-4">
          <span className="text-[10px] font-black uppercase tracking-widest mb-2">{t('analytics.risk_distribution', 'Distribución de Riesgo')}</span>
          <div className="flex-1">
            <RiskDistributionPie distribution={analytics.riskDistribution} loading={loadingAnalytics} />
          </div>
        </div>

        <div className="lg:col-span-2 bg-surface border border-border-base p-6 flex flex-col gap-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] font-black uppercase tracking-widest">{t('analytics.vault_status', 'Estado de Bóvedas de Conocimiento')}</span>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-copper"></span>
              <span className="text-[9px] font-black uppercase opacity-40">{t('analytics.data_density', 'Densidad de Datos')}</span>
            </div>
          </div>
          <div className="flex-1">
            <VaultCompletenessProgress 
              byPillar={vault.byPillar} 
              totalFiles={vault.totalFiles} 
              totalChunks={vault.totalChunks}
              loading={loadingVault} 
            />
          </div>
        </div>

      </div>

      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .panel-enter { animation: fadeSlideUp 0.35s ease-out both; }
      `}</style>
    </div>
  );
};
