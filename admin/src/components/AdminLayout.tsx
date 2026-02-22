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

    const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
        `w-12 h-12 flex items-center justify-center transition-all duration-300 relative group rounded-none ${isActive
            ? 'bg-black dark:bg-white text-white dark:text-black shadow-xl'
            : 'text-black/40 dark:text-white/30 hover:bg-black/5 dark:hover:bg-white/5 hover:text-black dark:hover:text-white'
        }`;

    return (
        <div className="min-h-screen industrial-mineral-gradient transition-colors flex flex-col relative overflow-hidden">
            {/* Capa de Fondo Técnica */}
            <div className="absolute inset-0 technical-grid pointer-events-none opacity-40"></div>

            <header className="h-20 bg-white/40 dark:bg-black/20 backdrop-blur-md border-b border-black/5 dark:border-white/5 flex items-center justify-between px-8 sticky top-0 z-50">
                <div className="flex items-center gap-4">
                    <BrandLogo variant="logotype" className="h-7 w-auto opacity-80" />
                    <div className="h-4 w-[1px] bg-black/10 dark:bg-white/10 mx-2"></div>
                    <span className="hud-label !text-antigravity-accent opacity-80">Admin Operations</span>
                </div>

                <div className="flex items-center gap-4">
                    <LanguageSwitch />
                    <button
                        onClick={toggleTheme}
                        className="w-10 h-10 flex items-center justify-center rounded-none text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white transition-all"
                    >
                        <span className="material-symbols-rounded text-[24px]">
                            {theme === 'dark' ? 'light_mode' : 'dark_mode'}
                        </span>
                    </button>
                    <button
                        onClick={handleLogout}
                        className="w-10 h-10 flex items-center justify-center rounded-none text-rose-500 hover:text-rose-500/80 transition-all"
                        title="Logout"
                    >
                        <span className="material-symbols-rounded text-[24px]">logout</span>
                    </button>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden relative">
                <aside className="w-24 bg-white/30 dark:bg-black/20 backdrop-blur-xl border-r border-black/5 dark:border-white/5 flex flex-col items-center py-8 z-20">
                    <div className="mb-10 p-2 rounded-none">
                        <BrandLogo variant="isotype" className="h-10 w-10" />
                    </div>

                    <nav className="flex-1 flex flex-col gap-4">
                        <NavLink to="/" className={navLinkClasses} title="Inbox Requests">
                            <span className="material-symbols-rounded text-[24px]">inbox</span>
                            <div className="absolute left-full ml-4 px-2 py-1 bg-black dark:bg-white text-white dark:text-black text-[10px] font-bold rounded-none opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">Inbox</div>
                        </NavLink>

                        <div className="w-8 h-px bg-black/5 dark:bg-white/5 mx-auto my-2" />

                        <NavLink to="/b2b" className={navLinkClasses} title="Enterprise Management">
                            <span className="material-symbols-rounded text-[24px]">domain</span>
                            <div className="absolute left-full ml-4 px-2 py-1 bg-black dark:bg-white text-white dark:text-black text-[10px] font-bold rounded-none opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">B2B</div>
                        </NavLink>
                        <NavLink to="/edu" className={navLinkClasses} title="Educational">
                            <span className="material-symbols-rounded text-[24px]">school</span>
                        </NavLink>
                        <NavLink to="/personal" className={navLinkClasses} title="Personal">
                            <span className="material-symbols-rounded text-[24px]">person</span>
                        </NavLink>

                        <div className="w-8 h-px bg-black/5 dark:bg-white/5 mx-auto my-2" />

                        <NavLink to="/branding" className={navLinkClasses} title="UI/UX Core">
                            <span className="material-symbols-rounded text-[24px]">palette</span>
                        </NavLink>
                        <NavLink to="/plugins" className={navLinkClasses} title="Extensions">
                            <span className="material-symbols-rounded text-[24px]">extension</span>
                        </NavLink>
                        <NavLink to="/ui-assets" className={navLinkClasses} title="Media Library">
                            <span className="material-symbols-rounded text-[24px]">photo_library</span>
                        </NavLink>
                        <NavLink to="/sdk" className={navLinkClasses} title="SDK">
                            <span className="material-symbols-rounded text-[24px]">developer_mode</span>
                        </NavLink>
                    </nav>
                </aside>

                <main className="flex-1 overflow-auto p-12 relative z-10 scroll-smooth">
                    <div className="max-w-[var(--max-width)] mx-auto">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
};