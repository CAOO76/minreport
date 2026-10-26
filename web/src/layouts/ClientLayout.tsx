import { MiningAICopilot } from '../components/ai/MiningAICopilot';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';

import { LanguageSwitch } from '../components/LanguageSwitch';
import { useTheme } from '../context/ThemeContext';
// import AccountSwitcher from '../components/layout/AccountSwitcher';
import { useAuth } from '../context/AuthContext';

const ClientLayout = () => {
    const location = useLocation();
    const isFullBleedModule = location.pathname.startsWith('/opermaq') || location.pathname.startsWith('/stockpile');
    const { theme, toggleTheme } = useTheme();
    const { signOut: signOutContext, profile, currentAccount } = useAuth();

    // Detectar rol para controlar visibilidad del sidebar
    const membership = profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id);
    const isSubscriptionAdmin = membership?.role === 'SUBSCRIPTION_ADMIN' || membership?.role === 'BILLING_ONLY';
    // SUBSCRIPTION_ADMIN: solo ve inicio (resto de funciones está en sus propias pestañas internas)

    // Clases para los botones del menú (Iconos centrados)
    const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
        `w-12 h-12 flex items-center justify-center rounded-none shadow-none transition-all mb-2 cursor-pointer ${isActive
            ? 'bg-[#C68346] text-white' // Activo: Cobre Industrial MINREPORT
            : 'text-[#8A93A6] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[#0F172A] dark:hover:text-[#F3F4F6]' // Inactivo
        }`;

    return (
        <div className="flex flex-col h-screen bg-antigravity-light-bg dark:bg-antigravity-dark-bg transition-colors">
            {/* 1. BARRA SUPERIOR (HEADER) - Ancho Completo */}
            <header className="h-16 bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-b border-antigravity-light-border dark:border-antigravity-dark-border flex items-center justify-between px-6 sticky top-0 z-50">
                {/* Izquierda: Marca */}
                <div className="flex items-center">
                    {/* Usamos 'logotype' para mostrar solo el texto en la barra superior */}
                    <BrandLogo variant="logotype" className="h-8 w-auto object-contain" />
                </div>

                <div className="flex items-center gap-2">
                    {/* Selector de Idioma */}
                    <LanguageSwitch />

                    {/* Botón Claro/Oscuro */}
                    <button
                        onClick={toggleTheme}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center rounded-none"
                        title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                    >
                        <span className="material-symbols-outlined text-[20px]">
                            {theme === 'dark' ? 'light_mode' : 'dark_mode'}
                        </span>
                    </button>

                    {/* Account Switcher */}
                    {/* Aislamiento de Sesión: AccountSwitcher desactivado para flujo de Túnel Único */}
                    {/* <AccountSwitcher /> */}
                </div>
            </header>

            {/* 2. SECCIÓN INFERIOR (Sidebar + Escritorio) */}
            <div className="flex flex-1 overflow-hidden relative">
                {/* ICON-ONLY SIDEBAR (Left - Fixed width 80px / w-20) */}
                <aside className="w-20 bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-r border-antigravity-light-border dark:border-antigravity-dark-border flex flex-col items-center py-6 z-10 transition-colors">

                    {/* Isotipo en la parte superior */}
                    <div className="mb-6">
                        <BrandLogo variant="isotype" className="h-10 w-10 object-contain" />
                    </div>

                    {/* Navegación */}
                    <nav className="flex-1 flex flex-col gap-2">
                        {isSubscriptionAdmin ? (
                            /* ── Nav B2B: Administrador de Suscripción ── */
                            <>
                                <NavLink to="/b2b/empresa" className={navLinkClasses} title="Datos de la Empresa">
                                    <span className="material-symbols-outlined text-2xl">business</span>
                                    <span className="sr-only">Datos de la Empresa</span>
                                </NavLink>
                                <NavLink to="/b2b/admins" className={navLinkClasses} title="Administradores Generales">
                                    <span className="material-symbols-outlined text-2xl">manage_accounts</span>
                                    <span className="sr-only">Administradores Generales</span>
                                </NavLink>
                                <NavLink to="/b2b/branding" className={navLinkClasses} title="Gestor de Logos & Identidad">
                                    <span className="material-symbols-outlined text-2xl">palette</span>
                                    <span className="sr-only">Gestor de Logos</span>
                                </NavLink>
                                <NavLink to="/b2b/metricas" className={navLinkClasses} title="Métricas de Uso">
                                    <span className="material-symbols-outlined text-2xl">bar_chart</span>
                                    <span className="sr-only">Métricas de Uso</span>
                                </NavLink>
                                <NavLink to="/b2b/suscripcion" className={navLinkClasses} title="Suscripción MINREPORT">
                                    <span className="material-symbols-outlined text-2xl">receipt_long</span>
                                    <span className="sr-only">Suscripción MINREPORT</span>
                                </NavLink>
                            </>
                        ) : (
                            /* ── Nav Operacional: General Admin y otros ── */
                            <>
                                <NavLink to="/dashboard" className={navLinkClasses} title="Panel Principal">
                                    <span className="material-symbols-outlined text-2xl">dashboard</span>
                                    <span className="sr-only">Panel Principal</span>
                                </NavLink>
                                <NavLink to="/opermaq" className={navLinkClasses} title="OPERMAQ (Flota y Equipos)">
                                    <span className="material-symbols-outlined text-2xl">local_shipping</span>
                                    <span className="sr-only">OPERMAQ</span>
                                </NavLink>
                                <NavLink to="/stockpile" className={navLinkClasses} title="STOCKPILE (Cubicaciones)">
                                    <span className="material-symbols-outlined text-2xl">layers</span>
                                    <span className="sr-only">STOCKPILE</span>
                                </NavLink>
                                <NavLink to="/job-profiles" className={navLinkClasses} title="Perfiles de Cargo">
                                    <span className="material-symbols-outlined text-2xl">demography</span>
                                    <span className="sr-only">Perfiles de Cargo</span>
                                </NavLink>
                                <NavLink to="/staff" className={navLinkClasses} title="Personal de Terreno">
                                    <span className="material-symbols-outlined text-2xl">badge</span>
                                    <span className="sr-only">Personal de Terreno</span>
                                </NavLink>
                            </>
                        )}
                    </nav>

                    {/* Botón Salir */}
                    <button
                        onClick={() => signOutContext()}
                        className="w-10 h-10 flex items-center justify-center rounded-none transition-colors mt-auto text-antigravity-light-muted dark:text-antigravity-dark-muted hover:text-red-500 bg-transparent border-0 cursor-pointer"
                        title="Cerrar Sesión"
                    >
                        <span className="material-symbols-outlined text-2xl">logout</span>
                    </button>
                </aside>

                {/* ESCRITORIO (Contenido Principal: Full-Bleed en Módulos, Padded en Paneles) */}
                <main className={`flex-1 ${isFullBleedModule ? 'p-0 overflow-hidden flex flex-col' : 'p-8 overflow-auto'} relative`}>
                    <Outlet />
                </main>

                {/* [CAPA 4 AI] Copiloto de Inteligencia Minera Resiliente */}
                <MiningAICopilot />
            </div>
        </div>
    );
};

export default ClientLayout;
