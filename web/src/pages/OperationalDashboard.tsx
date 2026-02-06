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
            <div className="flex flex-col h-[calc(100vh-12rem)] bg-white dark:bg-zinc-900 rounded-3xl overflow-hidden shadow-xl border border-gray-100 dark:border-zinc-800 animate-in zoom-in-95 duration-300">
                <div className="h-14 px-6 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setActivePlugin(null)}
                            className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors text-gray-500"
                        >
                            <span className="material-symbols-rounded">arrow_back</span>
                        </button>
                        <span className="material-symbols-rounded text-indigo-600 dark:text-indigo-400">{activePlugin.icon || 'extension'}</span>
                        <h2 className="font-bold text-gray-900 dark:text-white">{activePlugin.name}</h2>
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
                    <h1 className="text-3xl font-black text-gray-900 dark:text-gray-100 tracking-tight">
                        Panel de Control
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        Bienvenido al centro operativo de <span className="font-bold text-indigo-600 dark:text-indigo-400">{currentAccount.name}</span>
                    </p>
                </div>

                <div className="flex items-center gap-4 bg-white dark:bg-zinc-900 p-2 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm">
                    <div className="px-3 border-r border-gray-100 dark:border-zinc-800">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Estado</p>
                        <div className="flex items-center gap-1.5">
                            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
                            <span className="text-xs font-bold">{isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                    </div>
                    <div className="px-3">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Versión</p>
                        <p className="text-xs font-bold text-gray-600 dark:text-gray-300">{APP_VERSION}</p>
                    </div>
                </div>
            </header>

            {/* Grid de Aplicaciones */}
            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <span className="material-symbols-rounded text-indigo-600">apps</span>
                        Mis Módulos Habilitados
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {plugins.map((plugin) => (
                            <motion.div
                                key={plugin.id}
                                whileHover={{ y: -5 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => setActivePlugin(plugin)}
                                className="group cursor-pointer p-6 rounded-3xl bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 hover:border-indigo-500/30 hover:shadow-xl transition-all flex flex-col justify-between h-48"
                            >
                                <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-2xl group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                    <span className="material-symbols-rounded">{plugin.icon || 'extension'}</span>
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900 dark:text-white group-hover:text-indigo-600 transition-colors">
                                        {plugin.name}
                                    </h3>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">
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
