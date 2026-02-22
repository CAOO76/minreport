import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PluginLoader } from '../core/plugins/PluginLoader';
import { getPluginById } from '../core/PluginRegistry';
import { ArrowLeft, Box, Terminal, Zap } from 'lucide-react';

export const PluginExecutionPage = () => {
    const { pluginId } = useParams();
    const navigate = useNavigate();
    const manifest = pluginId ? getPluginById(pluginId)?.manifest : null;

    if (!pluginId) return null;

    return (
        <div className="flex flex-col h-full elite-tech-surface rounded-[40px] overflow-hidden border border-black/5 dark:border-white/5 shadow-3xl animate-in fade-in zoom-in-95 duration-700">
            <header className="h-20 px-8 border-b border-black/5 dark:border-white/5 flex items-center justify-between relative overflow-hidden bg-black/[0.02] dark:bg-white/[0.02]">
                <div className="absolute inset-0 technical-grid pointer-events-none opacity-20"></div>

                <div className="flex items-center gap-6 relative z-10">
                    <button
                        onClick={() => navigate('/plugins')}
                        className="w-10 h-10 rounded-xl bg-black dark:bg-white text-white dark:text-black flex items-center justify-center hover:scale-110 active:scale-95 transition-all shadow-premium"
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <div className="flex flex-col">
                        <div className="flex items-center gap-3">
                            <Box size={14} className="text-antigravity-accent" />
                            <span className="hud-label !text-antigravity-accent uppercase">External_Module_Execution</span>
                        </div>
                        <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tighter m-0 italic">
                            {manifest?.name || 'INITIALIZING_CORE...'}
                        </h2>
                    </div>
                </div>

                <div className="flex items-center gap-4 relative z-10">
                    <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[9px] font-black uppercase tracking-widest">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                        Runtime_Active
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-black/5 dark:bg-white/5 flex items-center justify-center text-black/20 dark:text-white/20">
                        <Terminal size={18} />
                    </div>
                </div>
            </header>

            <div className="flex-1 overflow-hidden relative">
                <div className="absolute inset-0 technical-grid pointer-events-none opacity-5"></div>
                <div className="h-full w-full overflow-auto custom-scrollbar relative z-10">
                    <PluginLoader pluginId={pluginId} />
                </div>
            </div>

            <footer className="h-10 px-8 border-t border-black/5 dark:border-white/5 flex items-center justify-between relative bg-black/[0.01] dark:bg-white/[0.01]">
                <span className="text-[8px] font-black text-black/20 dark:text-white/10 uppercase tracking-[0.3em] font-mono italic">
                    Isolation_Mode: Sandbox_v4.2.0
                </span>
                <div className="flex items-center gap-4 text-[8px] font-black text-black/10 dark:text-white/5 uppercase tracking-widest">
                    <span>Memory: Optimized</span>
                    <span>Lat: 2ms</span>
                </div>
            </footer>
        </div>
    );
};
