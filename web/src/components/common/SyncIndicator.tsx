import React, { useEffect, useState } from 'react';
import { syncQueueEngine, SyncState } from '../../core/offline/SyncQueueEngine';

export const SyncIndicator: React.FC = () => {
    const [state, setState] = useState<SyncState>(syncQueueEngine.getState());
    const [showExpanded, setShowExpanded] = useState<boolean>(false);

    useEffect(() => {
        const unsubscribe = syncQueueEngine.subscribe((nextState) => {
            setState(nextState);
        });
        return unsubscribe;
    }, []);

    const handleForceSync = () => {
        if (state.isOnline && !state.isSyncing) {
            syncQueueEngine.drainQueue();
        }
    };

    // No mostrar indicadores operativos ni de telemetría en flujos públicos de autenticación
    const isAuthPage = typeof window !== 'undefined' && 
        (window.location.pathname.includes('/login') || 
         window.location.pathname.includes('/register') ||
         window.location.pathname.includes('/setup-access') ||
         window.location.pathname.includes('/auth/action'));

    if (isAuthPage) return null;

    const isCleanOnline = state.isOnline && !state.isSyncing && state.pendingCount === 0;

    return (
        <aside
            aria-label="Estado de sincronización"
            className="fixed bottom-4 right-4 z-50 flex items-center select-none font-sans"
        >
            <div 
                onClick={() => setShowExpanded(!showExpanded)}
                className={`flex items-center gap-2 px-3 py-1.5 border transition-all duration-200 cursor-pointer shadow-sm ${
                    !state.isOnline
                        ? 'bg-[#07090D] border-[#C68346] text-[#C68346]'
                        : state.isSyncing
                        ? 'bg-[#07090D] border-[#C68346] text-[#C68346]'
                        : isCleanOnline
                        ? 'bg-[#07090D]/90 backdrop-blur-sm border-[#12151C] text-[#8A93A6] hover:text-[#F3F4F6]'
                        : 'bg-[#07090D] border-amber-600/40 text-amber-500'
                }`}
            >
                {/* Glifo Técnico Material Symbols */}
                {!state.isOnline ? (
                    <span className="material-symbols-outlined text-[14px] text-[#C68346] shrink-0">
                        wifi_off
                    </span>
                ) : state.isSyncing ? (
                    <span className="material-symbols-outlined text-[14px] text-[#C68346] animate-spin shrink-0">
                        sync
                    </span>
                ) : isCleanOnline ? (
                    <span className="material-symbols-outlined text-[14px] text-emerald-400 shrink-0">
                        check
                    </span>
                ) : (
                    <span className="material-symbols-outlined text-[14px] text-amber-500 shrink-0">
                        database
                    </span>
                )}

                {/* Texto de Estado con Números Tabulares */}
                <span className="text-[10px] font-mono font-bold tracking-[0.08em] uppercase" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {!state.isOnline ? (
                        state.pendingCount > 0 
                            ? `MODO TERRENO (${state.pendingCount} PENDIENTES)`
                            : 'MODO TERRENO (LOCAL)'
                    ) : state.isSyncing ? (
                        `SINCRONIZANDO (${state.pendingCount})`
                    ) : isCleanOnline ? (
                        'TELEMETRÍA AL DÍA'
                    ) : (
                        `${state.pendingCount} EN COLA LOCAL`
                    )}
                </span>

                {/* Botón de Sincronización Forzada */}
                {state.isOnline && state.pendingCount > 0 && !state.isSyncing && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleForceSync();
                        }}
                        className="ml-1 text-[9px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 bg-[#C68346]/20 text-[#C68346] border border-[#C68346]/40 hover:bg-[#C68346] hover:text-black transition-colors cursor-pointer"
                    >
                        SUBIR
                    </button>
                )}
            </div>

            {/* Panel de Diagnóstico */}
            {showExpanded && (
                <div className="absolute bottom-10 right-0 w-64 p-3 bg-[#07090D] border border-[#12151C] text-xs font-mono shadow-2xl text-[#8A93A6] z-50">
                    <div className="flex items-center justify-between border-b border-[#12151C] pb-1 mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#F3F4F6]">
                            ESTADO DE SINCRONIZADOR
                        </span>
                        <span className={`text-[9px] font-bold ${state.isOnline ? 'text-emerald-400' : 'text-[#C68346]'}`}>
                            {state.isOnline ? 'RED: ACTIVA' : 'RED: AISLADA'}
                        </span>
                    </div>

                    <div className="space-y-1 text-[10px]">
                        <div className="flex justify-between">
                            <span>ALMACÉN OFFLINE:</span>
                            <span className="text-[#F3F4F6]">INDEXEDDB + L-STORE</span>
                        </div>
                        <div className="flex justify-between">
                            <span>TRANSACCIONES EN COLA:</span>
                            <span className="text-[#F3F4F6] font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {state.pendingCount}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span>ÚLTIMA SINCRONIZACIÓN:</span>
                            <span className="text-[#F3F4F6]">
                                {state.lastSyncTimestamp ? state.lastSyncTimestamp.slice(11, 19) : 'SIN REGISTRO'}
                            </span>
                        </div>
                    </div>

                    {state.lastError && (
                        <div className="mt-2 p-1.5 bg-red-950/20 border border-red-900/60 text-red-400 text-[9px]">
                            {state.lastError}
                        </div>
                    )}
                </div>
            )}
        </aside>
    );
};

export default SyncIndicator;
