import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { LanguageSwitch } from './LanguageSwitch';
import { BrandLogo } from './BrandLogo';
import { ErrorBoundary } from './ErrorBoundary';

export const AdminLayout: React.FC = () => {
    const { theme, toggleTheme } = useTheme();
    const navigate = useNavigate();

    const handleLogout = () => {
        localStorage.removeItem('admin_token');
        navigate('/login');
    };

    const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
        `w-10 h-10 flex items-center justify-center transition-colors relative group cursor-pointer ${
            isActive
                ? 'text-[#C68346]'
                : 'text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
        }`;

    return (
        <div className="min-h-screen bg-white dark:bg-[#030406] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col font-sans">
            {/* Cabecera Principal */}
            <header className="h-14 border-b border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] sticky top-0 z-30 px-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <BrandLogo className="h-6 w-auto" />
                    <span className="text-[#94A3B8] dark:text-[#5A6072] text-xs font-mono">/</span>
                    <span className="text-xs font-mono font-medium text-[#475569] dark:text-[#8A93A6] tracking-wider uppercase">
                        Administración
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <LanguageSwitch />
                    <div className="w-[1px] h-4 bg-[#E2E8F0] dark:bg-[#12151C] mx-1" />
                    <button
                        onClick={toggleTheme}
                        className="bg-transparent border-0 outline-none p-1.5 text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                        title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
                        aria-label="Alternar tema"
                    >
                        <span className="material-symbols-outlined text-[18px]">
                            {theme === 'dark' ? 'light_mode' : 'dark_mode'}
                        </span>
                    </button>
                    <button
                        onClick={handleLogout}
                        className="bg-transparent border-0 outline-none p-1.5 text-neutral-400 hover:text-rose-600 transition-colors cursor-pointer flex items-center justify-center"
                        title="Cerrar sesión"
                        aria-label="Cerrar sesión"
                    >
                        <span className="material-symbols-outlined text-[18px]">logout</span>
                    </button>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden relative">
                {/* Barra Lateral */}
                <aside className="w-14 bg-white dark:bg-[#07090D] border-r border-[#E2E8F0] dark:border-[#12151C] flex flex-col items-center py-4 z-20">
                    <nav className="flex-1 flex flex-col items-center gap-2">
                        {/* Solicitudes / Inbox */}
                        <NavLink to="/" className={navLinkClasses} title="Solicitudes pendientes">
                            <span className="material-symbols-outlined text-[20px]">inbox</span>
                            <div className="absolute left-full ml-2 px-2 py-1 bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-[10px] font-mono rounded-none opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                                Bandeja
                            </div>
                        </NavLink>

                        <div className="w-5 h-px bg-[#E2E8F0] dark:bg-[#12151C] my-1" />

                        {/* Cuentas */}
                        <NavLink to="/b2b" className={navLinkClasses} title="Cuentas B2B">
                            <span className="material-symbols-outlined text-[20px]">domain</span>
                            <div className="absolute left-full ml-2 px-2 py-1 bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-[10px] font-mono rounded-none opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                                B2B
                            </div>
                        </NavLink>
                        <NavLink to="/edu" className={navLinkClasses} title="Cuentas Educativas">
                            <span className="material-symbols-outlined text-[20px]">school</span>
                            <div className="absolute left-full ml-2 px-2 py-1 bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-[10px] font-mono rounded-none opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                                Educacional
                            </div>
                        </NavLink>
                        <NavLink to="/personal" className={navLinkClasses} title="Cuentas Personales">
                            <span className="material-symbols-outlined text-[20px]">person</span>
                            <div className="absolute left-full ml-2 px-2 py-1 bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-[10px] font-mono rounded-none opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                                Personal
                            </div>
                        </NavLink>

                        <div className="w-5 h-px bg-[#E2E8F0] dark:bg-[#12151C] my-1" />

                        {/* Módulos Operativos */}
                        <NavLink to="/modules" className={navLinkClasses} title="Módulos del Sistema">
                            <span className="material-symbols-outlined text-[20px]">deployed_code</span>
                            <div className="absolute left-full ml-2 px-2 py-1 bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-[10px] font-mono rounded-none opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                                Módulos
                            </div>
                        </NavLink>

                        {/* Inferencia & Auditoría */}
                        <NavLink to="/ai-telemetry" className={navLinkClasses} title="Servicio de Inferencia">
                            <span className="material-symbols-outlined text-[20px]">memory</span>
                            <div className="absolute left-full ml-2 px-2 py-1 bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-[10px] font-mono rounded-none opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                                Inferencia IA
                            </div>
                        </NavLink>
                        <NavLink to="/audit" className={navLinkClasses} title="Registro de Auditoría">
                            <span className="material-symbols-outlined text-[20px]">policy</span>
                            <div className="absolute left-full ml-2 px-2 py-1 bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-[10px] font-mono rounded-none opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                                Auditoría
                            </div>
                        </NavLink>

                        <div className="w-5 h-px bg-[#E2E8F0] dark:bg-[#12151C] my-1" />

                        {/* Personalización */}
                        <NavLink to="/branding" className={navLinkClasses} title="Identidad Visual">
                            <span className="material-symbols-outlined text-[20px]">palette</span>
                            <div className="absolute left-full ml-2 px-2 py-1 bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-[10px] font-mono rounded-none opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                                Identidad
                            </div>
                        </NavLink>
                        <NavLink to="/ui-assets" className={navLinkClasses} title="Biblioteca de Medios">
                            <span className="material-symbols-outlined text-[20px]">image</span>
                            <div className="absolute left-full ml-2 px-2 py-1 bg-[#0F172A] dark:bg-white text-white dark:text-[#0F172A] text-[10px] font-mono rounded-none opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                                Medios
                            </div>
                        </NavLink>
                    </nav>
                </aside>

                {/* Área de Contenido Principal */}
                <main className="flex-1 overflow-auto p-8 relative z-10">
                    <div className="max-w-[1280px] mx-auto">
                        <ErrorBoundary>
                            <Outlet />
                        </ErrorBoundary>
                    </div>
                </main>
            </div>
        </div>
    );
};
