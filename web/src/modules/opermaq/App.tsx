import AdminApp from './AdminApp';
import { useState, useEffect } from 'react';
import { useCurrentUser } from './hooks/useCurrentUser';
import type { UserRole } from './hooks/useCurrentUser';
import { usePushNotifications } from './hooks/usePushNotifications';
import { AssetList } from './components/AssetList';
import { AssetRegistration } from './components/AssetRegistration';
import { AssetDetail } from './components/AssetDetail';
import { KnowledgeVaultDashboard } from './components/KnowledgeVaultDashboard';
import { ReportManagementPanel } from './components/ReportManagementPanel';
import { FleetAnalytics } from './components/analytics/FleetAnalytics';
import { BrandSynchronizer } from './components/BrandSynchronizer';
import { Login } from './components/Login';
import { ToastContainer } from 'react-toastify';
import { useThemeContext } from './providers/ThemeProvider';
import 'react-toastify/dist/ReactToastify.css';

type View = 'list' | 'registration' | 'detail' | 'vault' | 'reports' | 'analytics';

interface MenuItem {
  view: View;
  icon: string;
  label: string;
  allowedRoles?: UserRole[];
}

const MENU_ITEMS: MenuItem[] = [
  { view: 'list',       icon: 'inventory_2',  label: 'Catálogo de Flota' },
  { view: 'reports',    icon: 'description',  label: 'Reportes Operativos', allowedRoles: ['DEV_ROOT', 'SUPER_ADMIN', 'DEVELOPER', 'TEST_PILOT', 'PILOT_LEAD', 'OWNER', 'ADMIN', 'SUPERVISOR', 'OPERMAQ'] },
  { view: 'analytics',  icon: 'analytics',    label: 'Analíticas de Flota', allowedRoles: ['DEV_ROOT', 'SUPER_ADMIN', 'DEVELOPER', 'TEST_PILOT', 'PILOT_LEAD', 'OWNER', 'ADMIN', 'SUPERVISOR', 'OPERMAQ'] },
];

const ADMIN_CONSOLE_ROLES: UserRole[] = [
  'DEV_ROOT',
  'SUPER_ADMIN',
  'DEVELOPER',
  'TEST_PILOT',
  'PILOT_LEAD',
  'OWNER',
  'ADMIN',
  'OPERMAQ',
];

const ROOT_VIEWS: View[] = ['list', 'reports', 'analytics'];

function getActiveRoot(view: View): View {
  return ROOT_VIEWS.includes(view) ? view : 'list';
}




export interface OpermaqAppProps {
  embedded?: boolean;
  role?: UserRole;
  userId?: string;
  tenantId?: string;
  onTelemetryEvent?: (event: any) => void;
}

function App({ embedded = false, role: propRole, userId: propUserId, tenantId, onTelemetryEvent }: OpermaqAppProps = {}) {
  const authUser = useCurrentUser();
  const userId = propUserId || authUser.userId;
  const role = propRole || authUser.role || (embedded ? "DEVELOPER" : null);
  const isLoading = !embedded && authUser.isLoading;
  const [showAdmin, setShowAdmin] = useState(false);
  usePushNotifications(userId);

  const [currentView, setCurrentView] = useState<View>('list');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const { isDark } = useThemeContext();

  useEffect(() => {
    if (selectedAssetId) localStorage.setItem('opermaq_asset_id', selectedAssetId);
    else localStorage.removeItem('opermaq_asset_id');
  }, [selectedAssetId]);

  const handleSelectAsset = (id: string) => {
    setSelectedAssetId(id);
    setCurrentView('detail');
    if (onTelemetryEvent) {
      onTelemetryEvent({ type: 'ASSET_SELECTED', assetId: id, tenantId, userId });
    }
  };

  const handleNavigate = (view: View) => {
    setCurrentView(view);
    if (ROOT_VIEWS.includes(view)) {
      setSelectedAssetId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full min-h-[calc(100vh-64px)] w-full flex items-center justify-center bg-background">
        <div className="w-12 h-12 border-4 border-copper border-t-transparent rounded-none animate-spin" />
      </div>
    );
  }

  if (!userId) return <Login />;

  if (showAdmin) {
    return (
      <div className="w-full h-full flex-1 flex flex-col bg-background text-foreground font-atkinson overflow-hidden transition-colors select-none">
        <div className="h-12 flex items-center justify-between px-[21px] bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] shrink-0">
          <div className="flex items-center gap-[13px]">
            <span className="material-symbols-outlined text-[18px] text-[#C68346]">precision_manufacturing</span>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">OPERMAQ · CATÁLOGO MAESTRO OEM</span>
          </div>
          <button
            type="button"
            onClick={() => setShowAdmin(false)}
            title="Volver a vista operativa de flota"
            aria-label="Volver a Flota"
            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          <AdminApp embedded={true} role={role} userId={userId} onClose={() => setShowAdmin(false)} />
        </div>
      </div>
    );
  }

  const activeRoot = getActiveRoot(currentView);

  return (
    <div className="w-full h-full flex-1 flex flex-col bg-background text-foreground font-atkinson overflow-hidden transition-colors select-none">
      <BrandSynchronizer embedded={embedded} />

      {/* ── SUB-HEADER INTEGRADO DE MÓDULO (Botones Planos sin texto adosado) ── */}
      <header className="no-print h-12 shrink-0 flex items-center justify-between px-[21px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] z-30">
        <div className="flex items-center gap-[13px]">
          <span className="material-symbols-outlined text-[18px] text-[#C68346]">local_shipping</span>
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
            OPERMAQ
          </span>
        </div>

        <nav className="flex items-center gap-[13px]">
          {MENU_ITEMS.map(item => {
            if (item.allowedRoles && (!role || !item.allowedRoles.includes(role))) return null;
            const isActive = activeRoot === item.view;
            return (
              <button
                key={item.view}
                id={`nav-${item.view}`}
                type="button"
                onClick={() => handleNavigate(item.view)}
                title={item.label}
                aria-label={item.label}
                className={`bg-transparent border-0 outline-none p-1.5 transition-colors cursor-pointer relative flex items-center justify-center ${
                  isActive
                    ? 'text-[#C68346]'
                    : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-[2px] bg-[#C68346]" />
                )}
              </button>
            );
          })}

          {role && ADMIN_CONSOLE_ROLES.includes(role) && (
            <button
              type="button"
              onClick={() => setShowAdmin(true)}
              title="Catálogo Maestro OEM y Bóveda Técnica"
              aria-label="Catálogo Maestro OEM"
              className="bg-transparent border-0 outline-none p-1.5 text-slate-400 hover:text-[#C68346] transition-colors cursor-pointer flex items-center justify-center"
            >
              <span className="material-symbols-outlined text-[20px]">admin_panel_settings</span>
            </button>
          )}
        </nav>
      </header>

      {/* ── ÁREA DE TRABAJO DEL MÓDULO ── */}
      <main className="flex-1 overflow-hidden relative">
        <div className="h-full w-full overflow-auto">
          {currentView === 'list' && (
            <AssetList
              onSelectAsset={handleSelectAsset}
              onNew={() => setCurrentView('registration')}
            />
          )}
          {currentView === 'registration' && (
            <AssetRegistration
              isGlobalOnly={true}
              onSuccess={() => setCurrentView('list')}
              onCancel={() => setCurrentView('list')}
            />
          )}
          {currentView === 'detail' && selectedAssetId && (
            <AssetDetail
              assetId={selectedAssetId}
              onBack={() => setCurrentView('list')}
              onOpenVault={() => setCurrentView('vault')}
            />
          )}
          {currentView === 'vault' && selectedAssetId && (
            <KnowledgeVaultDashboard
              assetId={selectedAssetId}
              onBack={() => setCurrentView('list')}
            />
          )}
          {currentView === 'reports' && <ReportManagementPanel />}
          {currentView === 'analytics' && <FleetAnalytics />}
        </div>
      </main>

      <ToastContainer
        position="bottom-right"
        theme={isDark ? 'dark' : 'light'}
        toastStyle={{ borderRadius: '0', border: '1px solid rgba(0,0,0,0.1)' }}
      />
    </div>
  );
}

export default App;
