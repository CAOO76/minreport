import React, { useState, useEffect } from 'react';
import { usePlatform } from '../hooks/usePlatform';
import { connectivityMonitor } from '../utils/offline';

export type ViewState = 'home' | 'selection' | 'capture' | 'manual_capture' | 'dashboard' | 'management' | 'vision';

interface MainLayoutProps {
    children: React.ReactNode;
    view: ViewState;
    setView: (view: ViewState) => void;
    hasActiveStockpile: boolean;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
    children,
    view,
    setView,
    hasActiveStockpile
}) => {
    const { platform, isNative } = usePlatform();
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        const unsubscribe = connectivityMonitor.subscribe((state) => {
            setIsOnline(state.online);
        });
        return () => unsubscribe();
    }, []);

    return (
        <div className="app bg-antigravity-light-bg dark:bg-antigravity-dark-bg text-antigravity-light-text dark:text-antigravity-dark-text min-h-screen flex flex-col transition-colors duration-200 font-atkinson">
            {/* Header: SOLO para versión móvil nativa */}
            {isNative && (
                <header className="app-header bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-b border-antigravity-light-border dark:border-antigravity-dark-border sticky top-0 z-[100] shadow-sm">
                    <div className="header-content max-w-[1240px] mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <h1 className="app-title text-xl sm:text-2xl font-bold flex items-center gap-2">
                            <span className="material-symbols-outlined text-antigravity-accent">landscape</span>
                            <span className="hidden sm:inline">Stockpile Control</span>
                            <span className="sm:hidden">Stockpile</span>
                        </h1>

                        <nav className="app-nav flex gap-2 overflow-x-auto w-full sm:w-auto pb-2 sm:pb-0 scrollbar-none justify-center sm:justify-end">
                            <button
                                className={`nav-button px-3 py-2 sm:px-4 sm:py-2 rounded-none font-medium transition-all duration-200 border flex items-center gap-2 whitespace-nowrap
                                    ${view === 'capture'
                                        ? 'bg-antigravity-accent text-white border-antigravity-accent shadow-lg shadow-antigravity-accent/20'
                                        : 'bg-transparent text-antigravity-light-text dark:text-antigravity-dark-text border-antigravity-light-border dark:border-antigravity-dark-border hover:bg-antigravity-accent/5'}`}
                                onClick={() => setView('capture')}
                            >
                                <span className="material-symbols-outlined text-sm">qr_code_scanner</span>
                                <span className="hidden xs:inline">Captura</span>
                            </button>
                            <button
                                className={`nav-button px-3 py-2 sm:px-4 sm:py-2 rounded-none font-medium transition-all duration-200 border flex items-center gap-2 whitespace-nowrap
                                    ${view === 'vision'
                                        ? 'bg-antigravity-accent text-white border-antigravity-accent shadow-lg shadow-antigravity-accent/20'
                                        : 'bg-transparent text-antigravity-light-text dark:text-antigravity-dark-text border-antigravity-light-border dark:border-antigravity-dark-border hover:bg-antigravity-accent/5'}`}
                                onClick={() => setView('vision')}
                            >
                                <span className="material-symbols-outlined text-sm">camera</span>
                                <span className="hidden xs:inline">Visión</span>
                            </button>
                            <button
                                className={`nav-button px-3 py-2 sm:px-4 sm:py-2 rounded-none font-medium transition-all duration-200 border flex items-center gap-2 whitespace-nowrap
                                    ${view === 'dashboard'
                                        ? 'bg-antigravity-accent text-white border-antigravity-accent shadow-lg shadow-antigravity-accent/20'
                                        : 'bg-transparent text-antigravity-light-text dark:text-antigravity-dark-text border-antigravity-light-border dark:border-antigravity-dark-border hover:bg-antigravity-accent/5'}
                                    disabled:opacity-30 disabled:cursor-not-allowed`}
                                onClick={() => setView('dashboard')}
                                disabled={!hasActiveStockpile}
                            >
                                <span className="material-symbols-outlined text-sm">dashboard</span>
                                <span className="hidden xs:inline">Dashboard</span>
                            </button>
                        </nav>

                        <div className={`connectivity-indicator px-3 py-1.5 rounded-none text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 whitespace-nowrap
                            ${isOnline
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                            <span className={`w-2 h-2 rounded-none ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                            {isOnline ? 'Online' : 'Offline'}
                        </div>
                    </div>
                </header>
            )}

            {/* Main Content - Directo para web (plugin embebido), con padding para móvil */}
            <main className={`app-main flex-1 w-full mx-auto transition-all duration-300 overflow-y-auto overflow-x-hidden relative
                ${isNative ? 'max-w-[1200px] px-4 py-8' : 'p-0'}`}>
                {children}
            </main>

            {/* Footer - Solo en móvil */}
            {isNative && (
                <footer className="app-footer hidden sm:block bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-t border-antigravity-light-border dark:border-antigravity-dark-border py-6 text-center">
                    <p className="footer-text text-[10px] text-slate-500 font-mono tracking-widest uppercase">
                        STOCKPILE • {platform}
                    </p>
                </footer>
            )}
        </div>
    );
};
