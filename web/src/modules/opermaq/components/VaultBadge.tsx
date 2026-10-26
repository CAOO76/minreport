import { useTranslation } from 'react-i18next';
import type { VaultStats } from '../hooks/useVaultStats';

const PILLAR_META: Record<string, { icon: string; color: string }> = {
  manual_operaciones: { icon: 'engineering',       color: 'var(--md-sys-color-primary)' },
  pauta_mantencion:   { icon: 'build',             color: 'var(--md-sys-color-tertiary)' },
  matriz_riesgos:     { icon: 'health_and_safety', color: 'var(--md-sys-color-error)' },
  checklist_pre_op:   { icon: 'checklist',         color: 'var(--md-sys-color-secondary)' },
};

function PillarMiniBar({ pillar, count, total }: { pillar: string; count: number; total: number }) {
  const { t } = useTranslation();
  const meta  = PILLAR_META[pillar] ?? { icon: 'data_object', color: 'var(--md-sys-color-outline)' };
  const label = t(`vault.pillar_labels.${pillar}_badge`, { defaultValue: pillar });
  const pct   = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className="vault-badge__pillar-row">
      <span
        className="material-symbols-outlined vault-badge__pillar-icon"
        style={{ color: meta.color }}
      >
        {meta.icon}
      </span>
      <span className="vault-badge__pillar-label">{label}</span>
      <div className="vault-badge__pillar-track">
        <div
          className="vault-badge__pillar-fill"
          style={{ width: `${pct}%`, background: meta.color }}
        />
      </div>
      <span className="vault-badge__pillar-count">{count}</span>
    </div>
  );
}

interface VaultBadgeProps {
  stats: VaultStats | null | undefined;
  loading: boolean;
}

export function VaultBadge({ stats, loading }: VaultBadgeProps) {
  const { t } = useTranslation();
  // Guard defensivo: si stats aún no está disponible, mostrar skeleton mínimo
  if (!stats) {
    return (
      <div className="vault-badge vault-badge--empty">
        <div className="vault-badge__header">
          <span className="material-symbols-outlined vault-badge__brain-icon" aria-hidden="true">
            sync
          </span>
          <div className="vault-badge__header-text">
            <span className="vault-badge__subtitle">{t('vault.badge.loading')}</span>
          </div>
        </div>
      </div>
    );
  }

  const isEmpty  = stats.totalFiles === 0;
  const pillars  = Object.entries(stats.byPillar).sort(([, a], [, b]) => b - a);
  const topMakes = Object.entries(stats.byMake).sort(([, a], [, b]) => b - a).slice(0, 3);

  return (
    <div className={`vault-badge ${isEmpty ? 'vault-badge--empty' : 'vault-badge--active'}`}>
      <div className="vault-badge__header">
        <span
          className="material-symbols-outlined vault-badge__brain-icon"
          aria-hidden="true"
        >
          {loading ? 'sync' : isEmpty ? 'database' : 'schema'}
        </span>
        <div className="vault-badge__header-text">
          <span className="vault-badge__subtitle">
            {loading
              ? t('vault.badge.sync')
              : isEmpty
                ? `0 ${t('vault.badge.items_validated')}`
                : `${stats.totalFiles.toLocaleString('es-CL')} ${t('vault.badge.items_validated')}`
            }
          </span>
        </div>
      </div>

      {!isEmpty && pillars.length > 0 && (
        <div className="vault-badge__pillars">
          {pillars.map(([pillar, count]) => (
            <PillarMiniBar
              key={pillar}
              pillar={pillar}
              count={count}
              total={stats.totalFiles}
            />
          ))}
        </div>
      )}

      {!isEmpty && topMakes.length > 0 && (
        <div className="vault-badge__makes">
          {topMakes.map(([make, count]) => (
            <span key={make} className="vault-badge__make-chip">
              {make}
              <span className="vault-badge__make-count">{count}</span>
            </span>
          ))}
        </div>
      )}

      {isEmpty && !loading && (
        <p className="vault-badge__empty-hint">
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>info</span>
          {t('vault.badge.empty_hint')}
        </p>
      )}

      <style>{`
        .vault-badge {
          background: var(--md-sys-color-surface-container);
          border: 1px solid var(--md-sys-color-outline-variant);
          border-radius: 16px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          transition: border-color 0.3s ease;
        }
        .vault-badge--active {
          border-color: color-mix(in srgb, var(--md-sys-color-primary) 40%, transparent);
        }
        .vault-badge__header {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .vault-badge__brain-icon {
          font-size: 22px;
          color: var(--md-sys-color-primary);
          flex-shrink: 0;
        }
        .vault-badge--empty .vault-badge__brain-icon {
          color: var(--md-sys-color-outline);
        }
        .vault-badge__header-text {
          flex: 1;
          display: flex;
          align-items: center;
        }
        .vault-badge__subtitle {
          font-size: 10px;
          font-weight: 700;
          color: var(--md-sys-color-on-surface-variant);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .vault-badge__pillars {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .vault-badge__pillar-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .vault-badge__pillar-icon {
          font-size: 14px;
          flex-shrink: 0;
        }
        .vault-badge__pillar-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--md-sys-color-on-surface-variant);
          width: 64px;
          flex-shrink: 0;
        }
        .vault-badge__pillar-track {
          flex: 1;
          height: 4px;
          background: var(--md-sys-color-surface-container-highest);
          border-radius: 2px;
          overflow: hidden;
        }
        .vault-badge__pillar-fill {
          height: 100%;
          border-radius: 2px;
          transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
          opacity: 0.85;
        }
        .vault-badge__pillar-count {
          font-size: 10px;
          font-weight: 700;
          color: var(--md-sys-color-on-surface);
          width: 24px;
          text-align: right;
          flex-shrink: 0;
        }
        .vault-badge__makes {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .vault-badge__make-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 20px;
          background: var(--md-sys-color-surface-container-low);
          border: 1px solid var(--md-sys-color-outline-variant);
          font-size: 10px;
          font-weight: 600;
          color: var(--md-sys-color-on-surface);
          text-transform: capitalize;
        }
        .vault-badge__make-count {
          background: var(--md-sys-color-primary);
          color: var(--md-sys-color-on-primary);
          border-radius: 10px;
          padding: 0 5px;
          font-size: 9px;
          font-weight: 700;
        }
        .vault-badge__empty-hint {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--md-sys-color-on-surface-variant);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}

export default VaultBadge;
