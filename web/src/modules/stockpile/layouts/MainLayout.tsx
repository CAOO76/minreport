import React, { useState, useEffect } from 'react';
import { usePlatform } from '../hooks/usePlatform';
import { connectivityMonitor } from '../utils/offline';

export type ViewState =
    | 'home'
    | 'registration'
    | 'stock_list'
    | 'asset_portada'
    | 'selection'
    | 'geometry_selection'
    | 'capture'
    | 'manual_capture'
    | 'vision'
    | 'results'
    | 'measurement_detail'
    | 'management'
    | 'dashboard';

interface MainLayoutProps {
    children: React.ReactNode;
    view: ViewState;
    setView: (view: ViewState) => void;
    hasActiveStockpile: boolean;
    embedded?: boolean;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
    children,
    view,
    setView,
    hasActiveStockpile,
    embedded = false
}) => {
    const { platform, isNative } = usePlatform();
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        const unsubscribe = connectivityMonitor.subscribe((state) => {
            setIsOnline(state.online);
        });
        return () => unsubscribe();
    }, []);

    const navItems: Array<{ id: ViewState; label: string; icon: string; requiresAsset?: boolean }> = [
        { id: 'management', label: 'Analítica', icon: 'monitoring' },
        { id: 'stock_list', label: 'Inventario', icon: 'inventory_2' },
        { id: 'registration', label: 'Nuevo Acopio', icon: 'add_box' },
        { id: 'selection', label: 'Cubicación', icon: 'view_in_ar' },
        { id: 'vision', label: 'Visión IA', icon: 'center_focus_strong' },
        { id: 'asset_portada', label: 'Ficha Activo', icon: 'description', requiresAsset: true }
    ];

    return (
        <div
            className={`app bg-white dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] ${
                embedded ? 'h-full w-full flex-1' : 'min-h-screen w-full'
            } flex flex-col transition-colors duration-200 font-atkinson select-none rounded-none shadow-none`}
        >
            {/* Sub-header Integrado de Módulo (Iconos planos sin texto adosado — GEMINI.md 3.6) */}
            <header className="app-header h-12 shrink-0 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] px-[21px] flex items-center justify-between z-30 shadow-none rounded-none">
                <div className="flex items-center gap-[13px]">
                    <span className="material-symbols-outlined text-[#C68346] text-[18px]">layers</span>
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                        STOCKPILE CONTROL
                    </span>
                </div>

                <nav className="app-nav flex items-center gap-[13px]">
                    {navItems.map((item) => {
                        const isActive =
                            view === item.id ||
                            (item.id === 'selection' && (view === 'capture' || view === 'manual_capture' || view === 'geometry_selection')) ||
                            (item.id === 'asset_portada' && (view === 'dashboard' || view === 'measurement_detail'));
                        const disabled = item.requiresAsset && !hasActiveStockpile;

                        return (
                            <button
                                key={item.id}
                                type="button"
                                disabled={disabled}
                                title={item.label}
                                aria-label={item.label}
                                onClick={() => setView(item.id)}
                                className={`bg-transparent border-0 outline-none p-1.5 transition-colors cursor-pointer relative flex items-center justify-center ${
                                    isActive
                                        ? 'text-[#C68346]'
                                        : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                } disabled:opacity-30 disabled:cursor-not-allowed`}
                            >
                                <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                                {isActive && (
                                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-[2px] bg-[#C68346]" />
                                )}
                            </button>
                        );
                    })}
                </nav>

                <div
                    title={isOnline ? 'Red Activa' : 'Modo Autónomo Offline'}
                    className="flex items-center gap-[8px]"
                >
                    <span className={`w-2 h-2 rounded-none ${isOnline ? 'bg-[#00AEEF]' : 'bg-[#C68346]'}`} />
                </div>
            </header>

            {/* Contenido Principal */}
            <main
                className={`app-main flex-1 w-full mx-auto transition-all duration-200 overflow-y-auto overflow-x-hidden relative ${
                    isNative ? 'max-w-[1200px] px-[13px] py-[21px]' : 'p-0'
                }`}
            >
                {children}
            </main>

            {isNative && (
                <footer className="app-footer hidden sm:block bg-[#F8FAFC] dark:bg-[#07090D] border-t border-[#E2E8F0] dark:border-[#12151C] py-[13px] text-center">
                    <p className="footer-text text-[11px] text-[#475569] dark:text-[#8A93A6] font-mono tracking-widest uppercase">
                        STOCKPILE CONTROL • {platform}
                    </p>
                </footer>
            )}
        </div>
    );
};
