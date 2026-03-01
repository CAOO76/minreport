import { Outlet, NavLink } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';

import { LanguageSwitch } from '../components/LanguageSwitch';
import { useTheme } from '../context/ThemeContext';
// import AccountSwitcher from '../components/layout/AccountSwitcher';
import { useAuth } from '../context/AuthContext';

const ClientLayout = () => {
    const { theme, toggleTheme } = useTheme();
    const { signOut: signOutContext, profile, currentAccount } = useAuth();

    // Detectar rol para controlar visibilidad del sidebar
    const membership = profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id);
    const isSubscriptionAdmin = membership?.role === 'SUBSCRIPTION_ADMIN' || membership?.role === 'BILLING_ONLY';
    // SUBSCRIPTION_ADMIN: solo ve inicio (resto de funciones está en sus propias pestañas internas)

    // Clases para los botones del menú (Iconos centrados)
    const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
        `w-12 h-12 flex items-center justify-center rounded-xl transition-all mb-2 ${isActive
            ? 'bg-antigravity-accent text-white shadow-md' // Activo: Azul Antigravity
            : 'text-antigravity-light-muted dark:text-antigravity-dark-muted hover:bg-antigravity-light-bg dark:hover:bg-antigravity-dark-bg hover:text-antigravity-light-text dark:hover:text-antigravity-dark-text' // Inactivo
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
                        className="p-2 text-antigravity-light-muted dark:text-antigravity-dark-muted hover:text-antigravity-light-text dark:hover:text-antigravity-dark-text transition-colors rounded-full hover:bg-antigravity-light-bg dark:hover:bg-antigravity-dark-bg"
                        title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                    >
                        <span className="material-symbols-rounded">
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
                                    <span className="material-symbols-rounded text-2xl">business</span>
                                    <span className="sr-only">Datos de la Empresa</span>
                                </NavLink>
                                <NavLink to="/b2b/admins" className={navLinkClasses} title="Administradores Generales">
                                    <span className="material-symbols-rounded text-2xl">manage_accounts</span>
                                    <span className="sr-only">Administradores Generales</span>
                                </NavLink>
                                <NavLink to="/b2b/metricas" className={navLinkClasses} title="Métricas de Uso">
                                    <span className="material-symbols-rounded text-2xl">bar_chart</span>
                                    <span className="sr-only">Métricas de Uso</span>
                                </NavLink>
                                <NavLink to="/b2b/suscripcion" className={navLinkClasses} title="Suscripción MINREPORT">
                                    <span className="material-symbols-rounded text-2xl">receipt_long</span>
                                    <span className="sr-only">Suscripción MINREPORT</span>
                                </NavLink>
                            </>
                        ) : (
                            /* ── Nav Operacional: General Admin y otros ── */
                            <>
                                <NavLink to="/" className={navLinkClasses} title="Panel Principal">
                                    <span className="material-symbols-rounded text-2xl">dashboard</span>
                                    <span className="sr-only">Panel Principal</span>
                                </NavLink>
                                <NavLink to="/plugins" className={navLinkClasses} title="Módulos Instalados">
                                    <span className="material-symbols-rounded text-2xl">apps</span>
                                    <span className="sr-only">Módulos Instalados</span>
                                </NavLink>
                                <NavLink to="/job-profiles" className={navLinkClasses} title="Perfiles de Cargo">
                                    <span className="material-symbols-rounded text-2xl">demography</span>
                                    <span className="sr-only">Perfiles de Cargo</span>
                                </NavLink>
                                <NavLink to="/staff" className={navLinkClasses} title="Personal de Terreno">
                                    <span className="material-symbols-rounded text-2xl">badge</span>
                                    <span className="sr-only">Personal de Terreno</span>
                                </NavLink>
                            </>
                        )}
                    </nav>

                    {/* Botón Salir */}
                    <button
                        onClick={() => signOutContext()}
                        className="w-12 h-12 flex items-center justify-center rounded-xl transition-all mt-auto text-antigravity-light-muted dark:text-antigravity-dark-muted hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500"
                        title="Cerrar Sesión"
                    >
                        <span className="material-symbols-rounded text-2xl">logout</span>
                    </button>
                </aside>

                {/* ESCRITORIO (Contenido Principal) */}
                <main className="flex-1 overflow-auto p-8 relative">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default ClientLayout;
