import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { BrandLogo } from './BrandLogo';
import { LanguageSwitch } from './LanguageSwitch';

export const AdminLayout = () => {
    const { theme, toggleTheme } = useTheme();
    const navigate = useNavigate();

    const handleLogout = () => {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_user');
        navigate('/login');
    };

    // Clases para los botones del menú (Iconos centrados)
    const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
        `w-12 h-12 flex items-center justify-center rounded-xl transition-all mb-2 ${isActive
            ? 'bg-antigravity-accent text-white shadow-md' // Activo: Azul Antigravity
            : 'text-antigravity-light-muted dark:text-antigravity-dark-muted hover:bg-antigravity-light-bg dark:hover:bg-antigravity-dark-bg hover:text-antigravity-light-text dark:hover:text-antigravity-dark-text' // Inactivo
        }`;

    return (
        // CONTENEDOR PRINCIPAL: Fondo Global Antigravity
        <div className="min-h-screen bg-antigravity-light-bg dark:bg-antigravity-dark-bg transition-colors flex flex-col">

            {/* 1. BARRA SUPERIOR (HEADER) - Ancho Completo */}
            <header className="h-16 bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-b border-antigravity-light-border dark:border-antigravity-dark-border flex items-center justify-between px-6 sticky top-0 z-50">
                {/* Izquierda: Marca */}
                <div className="flex items-center">
                    {/* Usamos 'logotype' para mostrar solo el texto en la barra superior */}
                    <BrandLogo variant="logotype" className="h-8 w-auto object-contain" />
                </div>

                {/* Derecha: Controles Globales */}
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
                </div>
            </header>

            {/* 2. SECCIÓN INFERIOR (Sidebar + Escritorio) */}
            <div className="flex flex-1 overflow-hidden relative">

                {/* SIDEBAR - Solo Iconos */}
                <aside className="w-20 bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-r border-antigravity-light-border dark:border-antigravity-dark-border flex flex-col items-center py-6 z-10">

                    {/* Isotipo en la parte superior */}
                    <div className="mb-6">
                        <BrandLogo variant="isotype" className="h-10 w-10 object-contain" />
                    </div>

                    {/* Navegación */}
                    <nav className="flex-1 flex flex-col gap-2">
                        <NavLink to="/" className={navLinkClasses} title="Solicitudes">
                            <span className="material-symbols-rounded text-2xl">inbox</span>
                        </NavLink>
                        <NavLink to="/users" className={navLinkClasses} title="Usuarios">
                            <span className="material-symbols-rounded text-2xl">group</span>
                        </NavLink>
                        <NavLink to="/enterprises" className={navLinkClasses} title="Empresas B2B">
                            <span className="material-symbols-rounded text-2xl">business</span>
                        </NavLink>
                        <NavLink to="/branding" className={navLinkClasses} title="UI/UX">
                            <span className="material-symbols-rounded text-2xl">palette</span>
                        </NavLink>
                        <NavLink to="/tenants" className={navLinkClasses} title="Tenants">
                            <span className="material-symbols-rounded text-2xl">domain</span>
                        </NavLink>
                        <NavLink to="/plugins" className={navLinkClasses} title="Plugins">
                            <span className="material-symbols-rounded text-2xl">extension</span>
                        </NavLink>
                        <NavLink to="/sdk" className={navLinkClasses} title="Descargar SDK">
                            <span className="material-symbols-rounded text-2xl">sdk</span>
                        </NavLink>
                    </nav>

                    {/* Botón Salir */}
                    <button
                        onClick={handleLogout}
                        className="w-12 h-12 flex items-center justify-center rounded-xl transition-all mt-auto text-antigravity-light-muted dark:text-antigravity-dark-muted hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500"
                        title="Cerrar Sesión"
                    >
                        <span className="material-symbols-rounded text-2xl">logout</span>
                    </button>
                </aside>

                {/* ESCRITORIO (Contenido Principal) */}
                <main className="flex-1 overflow-auto p-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};