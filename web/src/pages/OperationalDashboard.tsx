import { useState, useEffect } from 'react';
import { MinReport } from '@minreport/sdk';
import { useAuth } from '../context/AuthContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useNavigate } from 'react-router-dom';
import { PluginLoader } from '../core/plugins/PluginLoader';
import { motion } from 'framer-motion';

export const OperationalDashboard = () => {
    const { currentAccount } = useAuth();
    const { isOnline } = useNetworkStatus();
    const navigate = useNavigate();

    const [plugins, setPlugins] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [activePlugin, setActivePlugin] = useState<any | null>(null);

    useEffect(() => {
        const init = () => {
            const active = MinReport.Core.getActivePlugins();
            setPlugins(active);
            setLoading(false);
        };
        const timer = setTimeout(init, 500);
        return () => clearTimeout(timer);
    }, []);

    // Fallback de seguridad
    if (!currentAccount) return null;

    const APP_VERSION = '__APP_VERSION__' in window ? (window as any).__APP_VERSION__ : 'v1.0.0';

    if (activePlugin) {
        return (
            <div className="flex flex-col h-[calc(100vh-12rem)] bg-white dark:bg-[#0D0D0D] rounded-none overflow-hidden border border-black/5 dark:border-white/5 animate-in zoom-in-95 duration-300 relative">
                <div className="absolute inset-0 technical-grid pointer-events-none opacity-5"></div>
                <div className="h-16 px-6 border-b border-black/5 dark:border-white/5 flex items-center justify-between relative z-10 bg-black/5">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setActivePlugin(null)}
                            className="p-2 hover:bg-black/10 dark:hover:bg-white/5 rounded-none transition-colors text-black/40 dark:text-white/40"
                        >
                            <span className="material-symbols-rounded">arrow_back</span>
                        </button>
                        <span className="material-symbols-rounded text-antigravity-accent">{activePlugin.icon || 'extension'}</span>
                        <h2 className="hud-label text-black dark:text-white">{activePlugin.name}</h2>
                    </div>
                </div>
                <div className="flex-1 bg-gray-50 dark:bg-black/20">
                    <PluginLoader pluginId={activePlugin.id} />
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto py-8 px-4 space-y-8 animate-in fade-in duration-500 font-atkinson">
            {/* Encabezado */}
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-black dark:text-white uppercase tracking-tighter">
                        SYSTEM_DASHBOARD
                    </h1>
                    <p className="hud-label text-[10px] text-black/40 dark:text-white/40 mt-2">
                        OPERATIONAL_CONTEXT: <span className="text-antigravity-accent opacity-100">{currentAccount.name}</span>
                    </p>
                </div>

                <div className="flex items-center gap-6 bg-black/5 dark:bg-white/5 p-4 rounded-none border border-black/5 dark:border-white/5">
                    <div className="px-3 border-r border-black/10 dark:border-white/10">
                        <p className="hud-label text-[9px] text-black/30 dark:text-white/20 mb-1">STATUS</p>
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-none ${isOnline ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} />
                            <span className="text-[10px] font-black uppercase tracking-widest">{isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                    </div>
                    <div className="px-3">
                        <p className="hud-label text-[9px] text-black/30 dark:text-white/20 mb-1">OS_VERSION</p>
                        <p className="text-[10px] font-black">{APP_VERSION}</p>
                    </div>
                </div>
            </header>

            {/* Grid de Aplicaciones */}
            <section className="space-y-4">
                <div className="flex items-center justify-between border-b border-black/5 dark:border-white/5 pb-4">
                    <h2 className="hud-label text-black/40 dark:text-white/40 flex items-center gap-3">
                        <span className="material-symbols-rounded text-lg">apps</span>
                        [ACTIVE_MODULES_INDEX]
                    </h2>
                </div>

                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-44 rounded-3xl bg-gray-100 dark:bg-white/5 animate-pulse" />
                        ))}
                    </div>
                ) : plugins.length === 0 ? (
                    <div className="p-12 text-center rounded-3xl border-2 border-dashed border-gray-200 dark:border-zinc-800">
                        <span className="material-symbols-rounded text-4xl mb-4 text-gray-300">extension_off</span>
                        <p className="font-bold text-gray-500">No hay módulos activos actualmente</p>
                        <button
                            onClick={() => navigate('/plugins')}
                            className="mt-4 text-indigo-600 font-bold hover:underline"
                        >
                            Explorar catálogo
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {plugins.map((plugin) => (
                            <motion.div
                                key={plugin.id}
                                whileHover={{ y: -2 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => setActivePlugin(plugin)}
                                className="group cursor-pointer p-6 rounded-none bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 hover:border-black dark:hover:border-white transition-all flex flex-col justify-between h-52 relative overflow-hidden"
                            >
                                <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity"></div>
                                <div className="w-12 h-12 rounded-none bg-black/5 dark:bg-white/10 flex items-center justify-center text-black/40 dark:text-white/40 text-2xl group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black transition-all border border-black/5">
                                    <span className="material-symbols-rounded">{plugin.icon || 'extension'}</span>
                                </div>
                                <div className="relative z-10">
                                    <h3 className="font-black text-[12px] uppercase tracking-widest text-black/80 dark:text-white/80 group-hover:text-black dark:group-hover:text-white transition-colors">
                                        {plugin.name}
                                    </h3>
                                    <p className="text-[10px] text-black/40 dark:text-white/40 line-clamp-2 mt-2 leading-relaxed font-bold uppercase tracking-tight">
                                        {plugin.description}
                                    </p>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
};
