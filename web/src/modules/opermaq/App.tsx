import AdminApp from './AdminApp';
import { useState, useEffect, useRef } from 'react';
import { signOut } from 'firebase/auth';
import { useCurrentUser } from './hooks/useCurrentUser';
import type { UserRole } from './hooks/useCurrentUser';
import { usePushNotifications } from './hooks/usePushNotifications';
import { AssetList } from './components/AssetList';
import { AssetRegistration } from './components/AssetRegistration';
import { AssetDetail } from './components/AssetDetail';
import { KnowledgeVaultDashboard } from './components/KnowledgeVaultDashboard';
import { TestPilotDashboard } from './components/TestPilotDashboard';
import { ReportManagementPanel } from './components/ReportManagementPanel';
import { FleetAnalytics } from './components/analytics/FleetAnalytics';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { BrandSynchronizer } from './components/BrandSynchronizer';
import { Login } from './components/Login';
import { auth } from './firebase/config';
import { ToastContainer } from 'react-toastify';
import { useThemeContext } from './providers/ThemeProvider';
import 'react-toastify/dist/ReactToastify.css';

type View = 'list' | 'registration' | 'detail' | 'vault' | 'test-pilot' | 'reports' | 'analytics';

interface MenuItem {
  view: View;
  icon: string;
  label: string;
  allowedRoles?: UserRole[];
}

const MENU_ITEMS: MenuItem[] = [
  { view: 'list',       icon: 'inventory_2',  label: 'Catálogos'    },
  { view: 'reports',    icon: 'description',  label: 'Reportes',  allowedRoles: ['DEVELOPER', 'ADMIN', 'OPERMAQ'] },
  { view: 'analytics',  icon: 'analytics',    label: 'Analíticas', allowedRoles: ['DEVELOPER', 'ADMIN', 'OPERMAQ'] },
  { view: 'test-pilot', icon: 'terminal',     label: 'Test Pilot', allowedRoles: ['DEVELOPER', 'TEST_PILOT'] },
];

const ROOT_VIEWS: View[] = ['list', 'reports', 'analytics', 'test-pilot'];

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
  const userEmail = authUser.userEmail || (userId ? `${userId}@minreport.cloud` : null);
  const role = propRole || authUser.role || (embedded ? "DEVELOPER" : null);
  const isLoading = !embedded && authUser.isLoading;
  const [showAdmin, setShowAdmin] = useState(false);
  usePushNotifications(userId);

  const [currentView, setCurrentView] = useState<View>('list');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const { isDark, toggleTheme } = useThemeContext();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Redirección inteligente tras login único
  useEffect(() => {
    if (embedded) return;
    if (userId && role && (role === 'DEVELOPER' || role === 'ADMIN' || role === 'OPERMAQ')) {
      const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      
      // Permitir bypass si se solicita explícitamente entrar al portal cliente
      const params = new URLSearchParams(window.location.search);
      if (params.get('portal') === 'true') {
        localStorage.setItem('opermaq_force_portal', 'true');
        return;
      }
      if (localStorage.getItem('opermaq_force_portal') === 'true') {
        return;
      }

      const isDevMode = import.meta.env.DEV;

      if (isDevMode && isLocal) {
        // En modo desarrollo local en caliente (Vite dev servers), redirigimos al servidor Vite admin dev.
        const adminDevUrl = import.meta.env.VITE_ADMIN_DEV_URL || 'http://localhost:5299';
        if (!window.location.href.startsWith(adminDevUrl)) {
          window.location.href = adminDevUrl;
        }
      } else {
        // En producción real (Firebase Hosting) o en el emulador de Hosting local (puerto 5000),
        // ambas apps comparten el mismo origen y puerto. Redirigimos a la ruta relativa /admin/
        if (!window.location.pathname.startsWith('/admin')) {
          window.location.href = '/admin/';
        }
      }
    }
  }, [userId, role]);

  // Cerrar dropdown de usuario al hacer click fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  const handleLogout = () => {
    // Limpiamos las cookies de bypass antiguas por seguridad
    document.cookie = 'opermaq_local_bypass_disabled=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
    document.cookie = 'opermaq_mock_role=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
    localStorage.removeItem('opermaq_force_portal');
    signOut(auth);
  };

  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="w-12 h-12 border-4 border-copper border-t-transparent rounded-none animate-spin" />
      </div>
    );
  }

  if (!userId) return <Login />;

  if (showAdmin) {
    return (
      <div className={`w-full flex-1 flex flex-col bg-background text-foreground font-atkinson overflow-hidden transition-colors select-none ${embedded ? "h-full min-h-[calc(100vh-64px)]" : "h-screen w-screen"}`}>
        <div className="flex items-center justify-between px-4 py-2 bg-surface border-b border-black/[0.08] dark:border-white/[0.08]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-copper">admin_panel_settings</span>
            <span className="text-xs font-mono font-bold uppercase text-copper">ADMINISTRACIÓN OPERMAQ</span>
          </div>
          <button
            onClick={() => setShowAdmin(false)}
            className="px-3 py-1 bg-copper hover:bg-copper/90 text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 border-0 cursor-pointer rounded-none"
          >
            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
            Volver a Flota
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          <AdminApp embedded={embedded} />
        </div>
      </div>
    );
  }

  const activeRoot = getActiveRoot(currentView);

  return (
    <div className={`w-full flex-1 flex flex-col bg-background text-foreground font-atkinson overflow-hidden transition-colors select-none ${embedded ? "h-full min-h-[calc(100vh-64px)]" : "h-screen w-screen"}`}>
      <BrandSynchronizer />

      {/* ── TOP BAR ── */}
      {!embedded && (
<header className="no-print h-14 flex-shrink-0 flex items-center justify-between px-5 border-b border-black/[0.08] dark:border-white/[0.08] bg-background z-50">

        {/* Izquierda: Logo */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[20px] text-copper select-none">precision_manufacturing</span>
          <span className="text-[13px] font-black uppercase tracking-[0.22em] text-foreground">OPERMAQ</span>
          {tenantId && <span className="hidden sm:inline-block text-[9px] font-mono text-copper uppercase ml-2 px-1.5 py-0.5 border border-copper/30">TENANT: {tenantId}</span>}
          


          {role && (role === 'DEVELOPER' || role === 'ADMIN' || role === 'OPERMAQ') && (
            <button
              type="button"
              onClick={() => {
                if (embedded) {
                  setShowAdmin(true);
                } else {
                  localStorage.removeItem('opermaq_force_portal');
                  window.location.href = isLocal ? "/admin.html" : "/admin/";
                }
              }}
              className="ml-3 px-3 py-1 bg-copper hover:bg-copper/90 text-white text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-1 border border-copper rounded-none select-none cursor-pointer"
            >
              <span className="material-symbols-outlined text-[12px]">dashboard</span>
              Consola Admin
            </button>
          )}
        </div>

        {/* Centro: Usuario / Perfil */}
        <div className="relative" ref={userMenuRef}>

          <button
            id="user-profile-btn"
            onClick={() => setUserMenuOpen(prev => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
            aria-label="Menú de usuario"
          >
            <span className="material-symbols-outlined text-[18px] text-foreground/50">account_circle</span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-foreground/55 max-w-[150px] truncate">
              {userEmail?.split('@')[0] ?? '—'}
            </span>
            <span className="material-symbols-outlined text-[14px] text-foreground/35">
              {userMenuOpen ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          {userMenuOpen && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-52 bg-background border border-black/[0.08] dark:border-white/[0.08] shadow-xl z-[200]">
              {userEmail && (
                <div className="px-3 py-2.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-foreground/35">Sesión Activa</p>
                  <p className="text-[11px] font-medium text-foreground/65 truncate mt-0.5">{userEmail}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Derecha: Selector de Idioma + Cerrar Sesión */}
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <button
            id="logout-btn-topbar"
            onClick={handleLogout}
            title="Cerrar Sesión"
            aria-label="Cerrar Sesión"
            className="w-9 h-9 flex items-center justify-center text-foreground/35 hover:text-foreground/70 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
          </button>
        </div>
      </header>
      )}

      {/* ── BODY: Sidebar + Área de Trabajo ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── SIDEBAR ── */}
        <nav className="no-print flex flex-col flex-shrink-0 w-14 border-r border-black/[0.08] dark:border-white/[0.08] bg-background z-40">
          {/* Ítems de menú */}
          <div className="flex-1 flex flex-col items-center pt-3 gap-0.5">
            {MENU_ITEMS.map(item => {
              if (item.allowedRoles && (!role || !item.allowedRoles.includes(role))) return null;
              const isActive = activeRoot === item.view;
              return (
                <button
                  key={item.view}
                  id={`nav-${item.view}`}
                  onClick={() => handleNavigate(item.view)}
                  title={item.label}
                  aria-label={item.label}
                  className={`w-10 h-10 flex items-center justify-center transition-colors ${
                    isActive
                      ? 'bg-copper/10 text-copper'
                      : 'text-foreground/35 hover:text-foreground/65 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                </button>
              );
            })}

            {/* Acceso a Admin en modo embebido */}
            {embedded && role && (role === "DEVELOPER" || role === "ADMIN" || role === "OPERMAQ") && (
              <button
                type="button"
                onClick={() => setShowAdmin(true)}
                title="Consola de Administración OPERMAQ"
                aria-label="Consola Admin"
                className="w-10 h-10 flex items-center justify-center text-foreground/35 hover:text-copper hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors rounded-none cursor-pointer mt-2"
              >
                <span className="material-symbols-outlined text-[20px]">admin_panel_settings</span>
              </button>
            )}
          </div>

          {/* Footer sidebar: Toggle Modo Claro / Oscuro (Solo en standalone) */}
          {!embedded && (
            <div className="flex flex-col items-center pb-4">
              <button
                id="theme-toggle-btn"
                onClick={toggleTheme}
                title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
                aria-label={isDark ? "Modo claro" : "Modo oscuro"}
                className="w-10 h-10 flex items-center justify-center text-foreground/35 hover:text-foreground/65 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors rounded-none cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">
                  {isDark ? "light_mode" : "dark_mode"}
                </span>
              </button>
            </div>
          )}
        </nav>

        {/* ── ÁREA DE TRABAJO ── */}
        <main className="flex-1 overflow-hidden relative">



          {/* Vistas — solo cambia el Área de Trabajo */}
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
            {currentView === 'test-pilot' && (
              <TestPilotDashboard globalAssetId={selectedAssetId || 'debug-asset'} />
            )}
            {currentView === 'reports' && <ReportManagementPanel />}
            {currentView === 'analytics' && <FleetAnalytics />}
          </div>
        </main>
      </div>

      <ToastContainer
        position="bottom-right"
        theme={isDark ? 'dark' : 'light'}
        toastStyle={{ borderRadius: '0', border: '1px solid rgba(0,0,0,0.1)' }}
      />
    </div>
  );
}

export default App;
