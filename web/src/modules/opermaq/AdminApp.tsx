import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit as firestoreLimit, onSnapshot } from 'firebase/firestore';
import { db } from './firebase/config';
import { AdminAssetList } from './components/AdminAssetList';
import { AdminAssetDetail } from './components/AdminAssetDetail';
import AdminKnowledgeDashboard from './components/AdminKnowledgeDashboard';
import { SyncIndicator } from './components/SyncIndicator';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { AssetRegistration } from './components/AssetRegistration';
import { useCurrentUser, type UserRole } from './hooks/useCurrentUser';
import { M3IconButton } from './components/M3IconButton';
import { auth } from './firebase/config';
import { signOut } from 'firebase/auth';
import { BrandSynchronizer } from './components/BrandSynchronizer';
import { useTheme } from './hooks/useTheme';
import { VaultReviewDashboard } from './components/VaultReviewDashboard';
import { M3Switch } from './components/M3Switch';
import { useTranslation } from 'react-i18next';
import { AdminMetricsDashboard } from './components/AdminMetricsDashboard';
import { GlobalSymbologyDashboard } from './components/GlobalSymbologyDashboard';
import { Login } from './components/Login';

// ─── Tipos ──────────────────────────────────────────────────────────────────
interface VaultItem {
  estado_aprobacion?: string;
  content_status?: string;
  is_discarded?: boolean;
}

const ALL_ADMIN_ROLES: UserRole[] = [
  'DEV_ROOT',
  'SUPER_ADMIN',
  'DEVELOPER',
  'TEST_PILOT',
  'PILOT_LEAD',
  'OWNER',
  'ADMIN',
  'OPERMAQ',
];

const CATALOG_AND_PILOT_ROLES: UserRole[] = [
  'DEV_ROOT',
  'SUPER_ADMIN',
  'DEVELOPER',
  'TEST_PILOT',
  'PILOT_LEAD',
  'OWNER',
  'ADMIN',
  'OPERMAQ',
];

const METRICS_AND_SETTINGS_ROLES: UserRole[] = [
  'DEV_ROOT',
  'SUPER_ADMIN',
  'DEVELOPER',
  'OWNER',
  'ADMIN',
  'OPERMAQ',
];

/**
 * OPERMAQ Admin Console — Consola Administrativa Integrada
 */
export interface AdminAppProps {
  embedded?: boolean;
  role?: UserRole;
  userId?: string | null;
  onClose?: () => void;
}

function AdminApp({ embedded = false, role: propRole, userId: propUserId, onClose }: AdminAppProps = {}) {
  const { t } = useTranslation();
  const authUser = useCurrentUser();
  const userId = propUserId || authUser.userId;
  const role = propRole || authUser.role || (embedded ? 'DEV_ROOT' : null);
  const isLoading = !embedded && authUser.isLoading;

  const [currentView, setCurrentView] = useState<'list' | 'detail' | 'vault' | 'registration' | 'review' | 'metrics' | 'symbology'>('list');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [vaultParams, setVaultParams] = useState<{ makeModel: string; category: string }>({ makeModel: '', category: '' });
  const [pendingCount, setPendingCount] = useState(0);
  const { isDark, toggleTheme } = useTheme();
  const [isUnauthorized, setIsUnauthorized] = useState(false);

  // Control de accesos y vistas permitidas por rol (Jerarquía Soberana MINREPORT)
  useEffect(() => {
    if (isLoading) return;

    if (userId) {
      if (!role || !ALL_ADMIN_ROLES.includes(role)) {
        setIsUnauthorized(true);
        return;
      }

      setIsUnauthorized(false);

      if (role === 'TEST_PILOT' || role === 'PILOT_LEAD') {
        const testPilotViews = ['list', 'detail', 'vault', 'registration', 'test-pilot', 'review', 'symbology'];
        if (!testPilotViews.includes(currentView)) {
          setCurrentView('list');
        }
      }
    }
  }, [userId, role, isLoading, currentView]);

  useEffect(() => {
    const q = query(
      collection(db, 'global_asset_catalog'),
      orderBy('updatedAt', 'desc'),
      firestoreLimit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let count = 0;
      const VALID_PILLARS = ['ficha_tecnica', 'manual_operaciones', 'pauta_mantencion', 'matriz_riesgos', 'checklist_pre_op', 'simbologia'];

      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const vault = data.knowledge_vault || {};

        VALID_PILLARS.forEach(pId => {
          const pillar = vault[pId] || {};
          const items = pillar.items || [];
          items.forEach((item: VaultItem) => {
            if (item.estado_aprobacion !== 'APROBADO_HUMANO' && item.content_status === 'COMPLETADO') {
              count++;
            }
          });
        });
      });
      setPendingCount(count);
    }, (error) => {
      console.error('[AdminApp] Error en onSnapshot:', error);
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = () => {
    document.cookie = 'opermaq_local_bypass_disabled=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
    document.cookie = 'opermaq_mock_role=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
    localStorage.removeItem('opermaq_force_portal');
    signOut(auth);
  };

  if (isLoading) return (
    <div className="h-full min-h-[calc(100vh-64px)] w-full flex items-center justify-center bg-background text-foreground">
      <span className="material-symbols-outlined animate-spin text-copper !text-4xl">progress_activity</span>
    </div>
  );

  if (!userId && !embedded) {
    return <Login />;
  }

  if (isUnauthorized) {
    return (
      <div className="h-full min-h-[calc(100vh-64px)] w-full flex items-center justify-center bg-background text-foreground font-atkinson p-6">
        <div className="w-full max-w-sm p-8 border border-black/[0.08] dark:border-white/[0.08] bg-surface text-center flex flex-col items-center rounded-none shadow-none">
          <span className="material-symbols-outlined text-[48px] text-copper mb-4 select-none">gpp_maybe</span>
          <h1 className="text-lg font-black uppercase tracking-[0.2em] text-foreground mb-2">
            Acceso Restringido
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-foreground/45 mb-6">
            Consola de Administración · OPERMAQ
          </p>

          <div className="w-full text-[12px] text-foreground/70 mb-8 space-y-3 leading-relaxed border-y border-black/[0.04] dark:border-white/[0.04] py-4 text-left">
            <p>
              El perfil de usuario activo (<strong>{role || 'OPERADOR'}</strong>) no cuenta con privilegios administrativos para acceder a esta consola.
            </p>
            <p className="text-foreground/50 text-[11px]">
              Solicite acreditación de rol administrativo o TEST-PILOT al administrador del sistema.
            </p>
          </div>

          <div className="w-full flex flex-col gap-3">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 bg-foreground text-background text-[11px] font-black uppercase tracking-wider hover:bg-foreground/90 transition-colors flex items-center justify-center gap-1.5 border border-transparent rounded-none select-none cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                Volver a Operación
              </button>
            )}

            {!embedded && (
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-2.5 bg-transparent text-foreground/60 text-[10px] font-bold uppercase tracking-wider hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors flex items-center justify-center gap-1.5 border border-black/[0.08] dark:border-white/[0.08] rounded-none select-none cursor-pointer"
              >
                <span className="material-symbols-outlined text-[13px]">logout</span>
                Cerrar Sesión
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${embedded ? "h-full w-full flex-1" : "h-screen w-screen"} bg-background text-foreground font-sans overflow-hidden select-none transition-all duration-300 relative`}>
      <BrandSynchronizer embedded={embedded} />
      {/* Admin Controls HUD */}
      <div className={`${embedded ? "absolute top-2 right-4 z-[50]" : "fixed top-4 right-6 z-[100]"} flex items-center gap-2 pointer-events-auto no-print bg-background/90 dark:bg-background/90 px-2 py-1 border border-black/[0.08] dark:border-white/[0.08]`}>
        {!embedded && (
          <>
            <div className="flex flex-col items-end pt-1">
              <SyncIndicator />
            </div>

            <div className="flex items-center gap-2 bg-surface px-3 py-1 border border-border-base">
              <span className="material-symbols-outlined text-[16px] text-muted">{isDark ? "dark_mode" : "light_mode"}</span>
              <M3Switch checked={isDark} onChange={toggleTheme} />
            </div>
          </>
        )}

        {/* Botón de Catálogos (Equipos) */}
        {role && CATALOG_AND_PILOT_ROLES.includes(role) && (
          <M3IconButton
            icon="inventory_2"
            onClick={() => setCurrentView('list')}
            variant={['list', 'detail', 'vault', 'registration'].includes(currentView) ? 'primary' : 'secondary'}
            title="Catálogo Global"
          />
        )}

        {/* Botón de Métricas (ADM) */}
        {role && METRICS_AND_SETTINGS_ROLES.includes(role) && (
          <M3IconButton
            icon="analytics"
            onClick={() => setCurrentView('metrics')}
            variant={currentView === 'metrics' ? 'primary' : 'secondary'}
            title="Métricas de Uso"
          />
        )}

        {/* Botón de Simbología Global */}
        {role && ALL_ADMIN_ROLES.includes(role) && (
          <M3IconButton
            icon="dangerous"
            onClick={() => setCurrentView('symbology')}
            variant={currentView === 'symbology' ? 'primary' : 'secondary'}
            title="Simbología Global"
          />
        )}

        {/* Botón Vault Review HITL */}
        {role && CATALOG_AND_PILOT_ROLES.includes(role) && (
          <div className="relative">
            <M3IconButton
              icon="fact_check"
              onClick={() => setCurrentView('review')}
              variant={currentView === 'review' ? 'primary' : 'secondary'}
              title={t('admin_app.vault_review_hitl')}
            />
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#C68346] text-white text-[9px] font-mono tabular-nums font-black flex items-center justify-center pointer-events-none rounded-none">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </div>
        )}

        {!embedded && (
          <>
            {onClose && (
              <M3IconButton
                icon="home"
                onClick={onClose}
                variant="secondary"
                title="Volver a Operación"
              />
            )}
            <LanguageSwitcher />
            <M3IconButton
              icon="logout"
              onClick={handleLogout}
              variant="secondary"
              title={t("admin_app.logout")}
            />
          </>
        )}
      </div>
      <main className="h-full w-full">
        {currentView === 'list' && role && CATALOG_AND_PILOT_ROLES.includes(role) && (
          <AdminAssetList onSelectAsset={(id: string) => { setSelectedAssetId(id); setCurrentView('detail'); }} onNewCatalog={() => setCurrentView('registration')} />
        )}
        {currentView === 'metrics' && role && METRICS_AND_SETTINGS_ROLES.includes(role) && (
          <AdminMetricsDashboard />
        )}
        {currentView === 'detail' && selectedAssetId && role && CATALOG_AND_PILOT_ROLES.includes(role) && (
          <AdminAssetDetail catalogId={selectedAssetId} onBack={() => setCurrentView('list')} onOpenVault={(_, mm, cat) => { setVaultParams({ makeModel: mm, category: cat }); setCurrentView('vault'); }} />
        )}
        {currentView === 'vault' && selectedAssetId && role && CATALOG_AND_PILOT_ROLES.includes(role) && (
          <AdminKnowledgeDashboard globalAssetId={selectedAssetId} makeModel={vaultParams.makeModel} category={vaultParams.category} onBack={() => setCurrentView('detail')} />
        )}
        {currentView === 'registration' && role && CATALOG_AND_PILOT_ROLES.includes(role) && (
          <AssetRegistration onSuccess={(id: string) => { setSelectedAssetId(id); setCurrentView('detail'); }} onCancel={() => setCurrentView('list')} isGlobalOnly={true} />
        )}
        {currentView === 'review' && role && CATALOG_AND_PILOT_ROLES.includes(role) && (
          <VaultReviewDashboard />
        )}
        {currentView === 'symbology' && (
          <GlobalSymbologyDashboard />
        )}
      </main>
    </div>
  );
}

export default AdminApp;
