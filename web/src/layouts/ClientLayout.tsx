import { MiningAICopilot } from '../components/ai/MiningAICopilot';
import { TestPilotTransversalHUD } from '../components/pilot/TestPilotTransversalHUD';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { useAuth } from '../context/AuthContext';
import { useMinReportSession } from '../context/MinReportSessionContext';

const ClientLayout = () => {
    const location = useLocation();
    const isFullBleedModule = location.pathname.startsWith('/opermaq') || location.pathname.startsWith('/stockpile');
    const { signOut: signOutContext, profile, currentAccount } = useAuth();
    const { session, hasModuleAccess } = useMinReportSession();

    const membership = profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id);
    const isSubscriptionAdmin = membership?.role === 'SUBSCRIPTION_ADMIN' || membership?.role === 'BILLING_ONLY';
    const isEduSandbox = Boolean(session?.isEduSandbox);

    const effectiveRole = session?.role || membership?.role;
    const isAdminOrOwner = Boolean(
        session?.isDevRoot ||
        session?.isSuperAdmin ||
        effectiveRole === 'OWNER' ||
        effectiveRole === 'ADMIN' ||
        isSubscriptionAdmin
    );

    const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
        `w-12 h-12 flex items-center justify-center rounded-none shadow-none transition-colors mb-2 cursor-pointer ${
            isActive
                ? 'bg-[#C68346] text-white'
                : 'text-[#8A93A6] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
        }`;

    return (
        <div className="flex flex-col h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] transition-colors select-none">
            {/* 1. BARRA SUPERIOR (HEADER) */}
            <header className="h-16 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between px-fib-21 sticky top-0 z-50">
                <div className="flex items-center gap-fib-21">
                    <BrandLogo variant="logotype" className="h-7 w-auto object-contain" />
                    {isEduSandbox && (
                        <span className="px-fib-13 py-1 border border-[#00AEEF]/40 text-[#00AEEF] text-microcopy font-mono uppercase tracking-wider">
                            ENTORNO ACADÉMICO SANDBOX (EDU)
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-fib-13">
                    <LanguageSwitch />
                    <ThemeSwitch />
                </div>
            </header>

            {/* 2. SECCION INFERIOR (Sidebar + Escritorio) */}
            <div className="flex flex-1 overflow-hidden relative">
                <aside className="w-20 bg-[#F8FAFC] dark:bg-[#07090D] border-r border-[#E2E8F0] dark:border-[#12151C] flex flex-col items-center py-fib-21 z-10 transition-colors">
                    <div className="mb-fib-21">
                        <BrandLogo variant="isotype" className="h-10 w-10 object-contain" />
                    </div>

                    <nav className="flex-1 flex flex-col gap-1">
                        {isSubscriptionAdmin ? (
                            <>
                                <NavLink to="/b2b/empresa" className={navLinkClasses} title="Datos de la Empresa">
                                    <span className="material-symbols-outlined text-2xl">business</span>
                                    <span className="sr-only">Datos de la Empresa</span>
                                </NavLink>
                                <NavLink to="/b2b/admins" className={navLinkClasses} title="Administradores Generales">
                                    <span className="material-symbols-outlined text-2xl">manage_accounts</span>
                                    <span className="sr-only">Administradores Generales</span>
                                </NavLink>
                                <NavLink to="/b2b/branding" className={navLinkClasses} title="Gestor de Logos e Identidad">
                                    <span className="material-symbols-outlined text-2xl">palette</span>
                                    <span className="sr-only">Gestor de Logos</span>
                                </NavLink>
                                <NavLink to="/b2b/metricas" className={navLinkClasses} title="Metricas Operacionales">
                                    <span className="material-symbols-outlined text-2xl">bar_chart</span>
                                    <span className="sr-only">Metricas</span>
                                </NavLink>
                                {!isEduSandbox && (
                                    <NavLink to="/b2b/suscripcion" className={navLinkClasses} title="Contrato y Suscripcion">
                                        <span className="material-symbols-outlined text-2xl">receipt_long</span>
                                        <span className="sr-only">Suscripcion</span>
                                    </NavLink>
                                )}
                            </>
                        ) : (
                            <>
                                <NavLink to="/dashboard" className={navLinkClasses} title="Panel Principal">
                                    <span className="material-symbols-outlined text-2xl">dashboard</span>
                                    <span className="sr-only">Panel Principal</span>
                                </NavLink>
                                {hasModuleAccess('opermaq') && (
                                    <>
                                        <div className="w-8 h-[1px] bg-[#CBD5E1] dark:bg-[#5A6072]/50 my-[8px] mx-auto shrink-0" />
                                        <NavLink to="/opermaq" end className={navLinkClasses} title="FLOTA">
                                            <span className="material-symbols-outlined text-2xl">lists</span>
                                            <span className="sr-only">FLOTA</span>
                                        </NavLink>
                                        <NavLink to="/opermaq/simbologia" className={navLinkClasses} title="SIMBOLOGÍA">
                                            <span className="material-symbols-outlined text-2xl">shapes</span>
                                            <span className="sr-only">SIMBOLOGÍA</span>
                                        </NavLink>
                                    </>
                                )}
                                {hasModuleAccess('stockpile') && (
                                    <>
                                        <div className="w-8 h-[1px] bg-[#CBD5E1] dark:bg-[#5A6072]/50 my-[8px] mx-auto shrink-0" />
                                        <NavLink to="/stockpile" className={navLinkClasses} title="STOCKPILE">
                                            <span className="material-symbols-outlined text-2xl">layers</span>
                                            <span className="sr-only">STOCKPILE</span>
                                        </NavLink>
                                    </>
                                )}
                                {isAdminOrOwner && (
                                    <NavLink to="/job-profiles" className={navLinkClasses} title="Perfiles de Cargo">
                                        <span className="material-symbols-outlined text-2xl">demography</span>
                                        <span className="sr-only">Perfiles de Cargo</span>
                                    </NavLink>
                                )}
                                {isAdminOrOwner && !isEduSandbox && (
                                    <NavLink to="/staff" className={navLinkClasses} title="Personal de Terreno">
                                        <span className="material-symbols-outlined text-2xl">badge</span>
                                        <span className="sr-only">Personal de Terreno</span>
                                    </NavLink>
                                )}
                                {session?.isSuperAdmin && (
                                    <NavLink to="/admin" className={navLinkClasses} title="Consola 2º ADMIN">
                                        <span className="material-symbols-outlined text-2xl">admin_panel_settings</span>
                                        <span className="sr-only">Consola Admin</span>
                                    </NavLink>
                                )}
                                {(session?.isTestPilot || session?.isDevRoot) && (
                                    <NavLink to="/pilot" className={navLinkClasses} title="Cabina 3º TEST-PILOT">
                                        <span className="material-symbols-outlined text-2xl">science</span>
                                        <span className="sr-only">Cabina Test-Pilot</span>
                                    </NavLink>
                                )}
                            </>
                        )}
                    </nav>

                    <button
                        type="button"
                        onClick={() => signOutContext()}
                        className="w-10 h-10 flex items-center justify-center rounded-none transition-colors mt-auto text-[#475569] dark:text-[#8A93A6] hover:text-red-500 bg-transparent border-0 cursor-pointer"
                        title="Cerrar Sesion"
                    >
                        <span className="material-symbols-outlined text-2xl">logout</span>
                    </button>
                </aside>

                {/* ESCRITORIO */}
                <main className={`flex-1 ${isFullBleedModule ? 'p-0 overflow-hidden flex flex-col' : 'p-fib-34 overflow-auto'} relative`}>
                    <Outlet />
                </main>

                <TestPilotTransversalHUD />
                <MiningAICopilot />
            </div>
        </div>
    );
};

export default ClientLayout;
