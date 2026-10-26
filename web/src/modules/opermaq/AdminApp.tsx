import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit as firestoreLimit, onSnapshot } from 'firebase/firestore';
import { db } from './firebase/config';
import { AdminAssetList } from './components/AdminAssetList';
import { AdminAssetDetail } from './components/AdminAssetDetail';
import AdminKnowledgeDashboard from './components/AdminKnowledgeDashboard';
import { TestPilotDashboard } from './components/TestPilotDashboard';
import { SyncIndicator } from './components/SyncIndicator';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { AssetRegistration } from './components/AssetRegistration';
import { AdminRoleManager } from './components/AdminRoleManager';
import { useCurrentUser } from './hooks/useCurrentUser';
import { M3IconButton } from './components/M3IconButton';
import { auth } from './firebase/config';
import { signOut } from 'firebase/auth';
import { BrandManager } from './components/BrandManager';
import { BrandSynchronizer } from './components/BrandSynchronizer';
import { useTheme } from './hooks/useTheme';
import { VaultReviewDashboard } from './components/VaultReviewDashboard';
import { M3Switch } from './components/M3Switch';
import { useTranslation } from 'react-i18next';
import { AdminMetricsDashboard } from './components/AdminMetricsDashboard';
import { GlobalSymbologyDashboard } from './components/GlobalSymbologyDashboard';


// ─── Tipos ──────────────────────────────────────────────────────────────────
interface VaultItem {
  estado_aprobacion?: string;
  content_status?: string;
  is_discarded?: boolean;
}

/**
 * OPERMAQ Admin Console — SPA independiente
 * Interfaz administrativa con acceso directo (Gobernanza OPERMAQ).
 */
export interface AdminAppProps {
  embedded?: boolean;
}

function AdminApp({ embedded = false }: AdminAppProps = {}) {
  const { t } = useTranslation();
  const { userId, role, isLoading } = useCurrentUser();
  const [currentView, setCurrentView] = useState<'list' | 'detail' | 'vault' | 'registration' | 'settings' | 'brand' | 'test-pilot' | 'review' | 'metrics' | 'symbology'>('list');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [vaultParams, setVaultParams] = useState<{ makeModel: string, category: string }>({ makeModel: '', category: '' });
  const [pendingCount, setPendingCount] = useState(0);
  const { isDark, toggleTheme } = useTheme();
  const [isUnauthorized, setIsUnauthorized] = useState(false);

  // Control de accesos, redirección inteligente y vistas permitidas por rol
  useEffect(() => {
    if (isLoading) return;

    if (userId) {
      const allowedRoles = ['DEVELOPER', 'ADMIN', 'OPERMAQ', 'TEST_PILOT'];
      
      // Si el rol es inválido o no está autorizado en administración
      if (!role || !allowedRoles.includes(role)) {
        const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        if (isLocal) {
          setIsUnauthorized(true);
        } else {
          window.location.href = '/';
        }
        return;
      }

      setIsUnauthorized(false);

      // Restricciones de vistas por rol
      if (role === 'TEST_PILOT') {
        const testPilotViews = ['list', 'detail', 'vault', 'registration', 'test-pilot', 'review'];
        if (!testPilotViews.includes(currentView)) {
          setCurrentView('list');
        }
      } else if (role === 'ADMIN' || role === 'OPERMAQ') {
        const adminViews = ['settings', 'metrics'];
        if (!adminViews.includes(currentView)) {
          setCurrentView('metrics');
        }
      }
    }
  }, [userId, role, isLoading, currentView]);


  useEffect(() => {
    // Escuchar cambios en tiempo real en los catálogos para actualizar el contador HITL
    const q = query(
      collection(db, 'global_asset_catalog'),
      orderBy('updatedAt', 'desc'),
      firestoreLimit(100) // Buffer suficiente para detectar ítems pendientes recientes
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let count = 0;
      const VALID_PILLARS = ['ficha_tecnica', 'manual_operaciones', 'pauta_mantencion', 'matriz_riesgos', 'checklist_pre_op', 'simbologia'];
      
      snapshot.forEach(doc => {
        const data = doc.data();
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
    // Limpiamos las cookies de bypass antiguas por seguridad
    document.cookie = 'opermaq_local_bypass_disabled=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
    document.cookie = 'opermaq_mock_role=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
    localStorage.removeItem('opermaq_force_portal');
    signOut(auth);
  };

  if (isLoading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
      <span className="material-symbols-outlined animate-spin text-copper !text-4xl">progress_activity</span>
    </div>
  );

  if (!userId) {
    window.location.href = '/';
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
        <span className="material-symbols-outlined animate-spin text-copper !text-4xl">progress_activity</span>
      </div>
    );
  }


  if (isUnauthorized) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground font-atkinson p-6">
        <div className="w-full max-w-sm p-8 border border-black/[0.08] dark:border-white/[0.08] bg-surface text-center flex flex-col items-center">
          <span className="material-symbols-outlined text-[48px] text-copper mb-4 select-none">gpp_maybe</span>
          <h1 className="text-lg font-black uppercase tracking-[0.2em] text-foreground mb-2">
            Acceso Restringido
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-foreground/45 mb-6">
            Consola de Administración · OPERMAQ
          </p>
          
          <div className="w-full text-[12px] text-foreground/70 mb-8 space-y-3 leading-relaxed border-y border-black/[0.04] dark:border-white/[0.04] py-4 text-left">
            <p>
              El perfil de usuario activo (<strong>{role || 'CLIENTE'}</strong>) no cuenta con privilegios administrativos para acceder a esta consola.
            </p>
            <p className="text-foreground/50 text-[11px]">
              Si consideras que esto es un error, por favor contacta con el administrador del sistema para actualizar tus permisos de rol.
            </p>
          </div>

          <div className="w-full flex flex-col gap-3">
            <a
              href="/?portal=true"
              className="w-full py-3 bg-foreground text-background text-[11px] font-black uppercase tracking-wider hover:bg-foreground/90 transition-colors flex items-center justify-center gap-1.5 border border-transparent rounded-none select-none no-underline"
            >
              <span className="material-symbols-outlined text-[14px]">arrow_back</span>
              Ir al Portal Cliente
            </a>



            <button
              onClick={handleLogout}
              className="w-full py-2.5 bg-transparent text-foreground/60 text-[10px] font-bold uppercase tracking-wider hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors flex items-center justify-center gap-1.5 border border-black/[0.08] dark:border-white/[0.08] rounded-none select-none"
            >
              <span className="material-symbols-outlined text-[13px]">logout</span>
              Cerrar Sesión
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${embedded ? "h-full w-full" : "h-screen w-screen"} bg-background text-foreground font-sans overflow-hidden select-none transition-all duration-300`}>
      <BrandSynchronizer />
      {/* Admin Controls HUD */}
      <div className={`${embedded ? "absolute top-2 right-4 z-[50]" : "fixed top-4 right-6 z-[100]"} flex items-center gap-4 pointer-events-auto no-print`}>


        {!embedded && (
          <>
            <div className="flex flex-col items-end pt-1">
              <SyncIndicator />
            </div>

            <div className="flex items-center gap-2 bg-surface px-4 py-2 border border-border-base">
               <span className="material-symbols-outlined text-[16px] text-muted">{isDark ? "dark_mode" : "light_mode"}</span>
               <M3Switch checked={isDark} onChange={toggleTheme} />
            </div>
          </>
        )}


        {/* Botón de Marca: Sólo para DEVELOPER */}
        {role === 'DEVELOPER' && (
          <M3IconButton 
              icon="palette" 
              onClick={() => setCurrentView('brand')}
              variant={currentView === 'brand' ? 'primary' : 'secondary'}
              title={t('admin_app.manage_brand')}
          />
        )}
        
        {/* Botón de Catálogos (Equipos): Para DEVELOPER y TEST_PILOT */}
        {(role === 'DEVELOPER' || role === 'TEST_PILOT') && (
          <M3IconButton 
              icon="inventory_2" 
              onClick={() => setCurrentView('list')}
              variant={['list', 'detail', 'vault', 'registration'].includes(currentView) ? 'primary' : 'secondary'}
              title="Catálogo Global"
          />
        )}

        {/* Botón de Métricas (ADM): Para DEVELOPER y ADM (ADMIN, OPERMAQ) */}
        {(role === 'DEVELOPER' || role === 'ADMIN' || role === 'OPERMAQ') && (
          <M3IconButton 
              icon="analytics" 
              onClick={() => setCurrentView('metrics')}
              variant={currentView === 'metrics' ? 'primary' : 'secondary'}
              title="Métricas de Uso"
          />
        )}

        {/* Botón de Simbología Global: Para todos los roles administrativos */}
        {(role === 'DEVELOPER' || role === 'TEST_PILOT' || role === 'ADMIN' || role === 'OPERMAQ') && (
          <M3IconButton 
              icon="dangerous" 
              onClick={() => setCurrentView('symbology')}
              variant={currentView === 'symbology' ? 'primary' : 'secondary'}
              title="Simbología Global"
          />
        )}
        
        {/* Botón de Ajustes / Roles: Para DEVELOPER y ADM (ADMIN, OPERMAQ) */}
        {(role === 'DEVELOPER' || role === 'ADMIN' || role === 'OPERMAQ') && (
          <M3IconButton 
              icon="settings" 
              onClick={() => setCurrentView('settings')}
              variant={currentView === 'settings' ? 'primary' : 'secondary'}
              title={t('admin_app.system_settings')}
          />
        )}

        {/* Botón Test Pilot Console: Para DEVELOPER y TEST_PILOT */}
        {(role === 'DEVELOPER' || role === 'TEST_PILOT') && (
          <M3IconButton 
              icon="terminal" 
              onClick={() => setCurrentView('test-pilot')}
              variant={currentView === 'test-pilot' ? 'primary' : 'secondary'}
              title={t('admin_app.test_pilot_console')}
          />
        )}

        {/* Botón Vault Review HITL: Para DEVELOPER y TEST_PILOT */}
        {(role === 'DEVELOPER' || role === 'TEST_PILOT') && (
          <div className="relative">
            <M3IconButton 
                icon="fact_check" 
                onClick={() => setCurrentView('review')}
                variant={currentView === 'review' ? 'primary' : 'secondary'}
                title={t('admin_app.vault_review_hitl')}
            />
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-black text-[9px] font-black flex items-center justify-center pointer-events-none">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </div>
        )}
        
        {!embedded && (
          <>
            <M3IconButton 
              icon="home" 
              onClick={() => { window.location.href = "/?portal=true"; }}
              variant="secondary"
              title="Ir al Portal Cliente"
            />
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
        {currentView === 'list' && (role === 'DEVELOPER' || role === 'TEST_PILOT') && (
          <AdminAssetList onSelectAsset={(id: string) => { setSelectedAssetId(id); setCurrentView('detail'); }} onNewCatalog={() => setCurrentView('registration')} />
        )}
        {currentView === 'brand' && role === 'DEVELOPER' && (
           <BrandManager />
        )}
        {currentView === 'settings' && (role === 'DEVELOPER' || role === 'ADMIN' || role === 'OPERMAQ') && (
           <div className="flex flex-col items-center justify-center h-full"><AdminRoleManager /></div>
        )}
        {currentView === 'metrics' && (role === 'DEVELOPER' || role === 'ADMIN' || role === 'OPERMAQ') && (
          <AdminMetricsDashboard />
        )}
        {currentView === 'detail' && selectedAssetId && (role === 'DEVELOPER' || role === 'TEST_PILOT') && (
          <AdminAssetDetail catalogId={selectedAssetId} onBack={() => setCurrentView('list')} onOpenVault={(_, mm, cat) => { setVaultParams({ makeModel: mm, category: cat }); setCurrentView('vault'); }} />
        )}
        {currentView === 'vault' && selectedAssetId && (role === 'DEVELOPER' || role === 'TEST_PILOT') && (
          <AdminKnowledgeDashboard globalAssetId={selectedAssetId} makeModel={vaultParams.makeModel} category={vaultParams.category} onBack={() => setCurrentView('detail')} />
        )}
        {currentView === 'registration' && (role === 'DEVELOPER' || role === 'TEST_PILOT') && (
          <AssetRegistration onSuccess={(id: string) => { setSelectedAssetId(id); setCurrentView('detail'); }} onCancel={() => setCurrentView('list')} isGlobalOnly={true} />
        )}
        {currentView === 'test-pilot' && (role === 'DEVELOPER' || role === 'TEST_PILOT') && (
          <TestPilotDashboard globalAssetId={selectedAssetId || 'debug-admin'} />
        )}
        {currentView === 'review' && (role === 'DEVELOPER' || role === 'TEST_PILOT') && (
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
