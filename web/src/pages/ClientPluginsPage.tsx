import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { MinReport } from '@minreport/sdk';
import { PluginLoader } from '../core/plugins/PluginLoader';

interface ClientPlugin {
    id: string;
    name: string;
    icon: string;
    description: string;
}

export const ClientPluginsPage = () => {
    useTranslation();
    const [plugins, setPlugins] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [activePlugin, setActivePlugin] = useState<any | null>(null);

    useEffect(() => {
        // Load real plugins from SDK
        // This relies on the background initialization in App.tsx
        const init = () => {
            const active = MinReport.Core.getActivePlugins();
            setPlugins(active);
            setLoading(false);
        };

        // Small delay to ensure SDK has finished initializing from App.tsx entitlements
        const timer = setTimeout(init, 500);
        return () => clearTimeout(timer);
    }, []);

    // Full Screen / Immersive Mode
    if (activePlugin) {
        return (
            <div className="flex flex-col h-full bg-antigravity-light-surface dark:bg-antigravity-dark-surface rounded-3xl overflow-hidden shadow-2xl border border-antigravity-light-border dark:border-antigravity-dark-border">
                {/* Immersive Header */}
                <div className="h-16 px-6 border-b border-antigravity-light-border dark:border-antigravity-dark-border flex items-center justify-between bg-white dark:bg-black/20">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setActivePlugin(null)}
                            className="p-2 hover:bg-antigravity-light-bg dark:hover:bg-antigravity-dark-bg rounded-xl transition-colors text-antigravity-light-muted dark:text-antigravity-dark-muted"
                        >
                            <span className="material-symbols-rounded">arrow_back</span>
                        </button>
                        <div className="flex items-center gap-3 pr-4 border-r border-antigravity-light-border dark:border-antigravity-dark-border">
                            <span className="material-symbols-rounded text-antigravity-accent">{activePlugin.icon || 'extension'}</span>
                            <h2 className="text-lg font-bold text-antigravity-light-text dark:text-antigravity-dark-text">{activePlugin.name}</h2>
                        </div>
                        <span className="text-xs font-medium text-antigravity-light-muted dark:text-antigravity-dark-muted hidden sm:block">
                            {activePlugin.description}
                        </span>
                    </div>
                </div>

                {/* Real Plugin Content Area */}
                <div className="flex-1 p-0 overflow-y-auto bg-slate-50 dark:bg-antigravity-dark-bg/50">
                    <PluginLoader pluginId={activePlugin.id} />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 font-atkinson">
            <header>
                <h1 className="text-3xl font-black text-antigravity-light-text dark:text-antigravity-dark-text tracking-tight mb-2">
                    Mis Aplicaciones
                </h1>
                <p className="text-antigravity-light-muted dark:text-antigravity-dark-muted">
                    Accede a tus módulos y herramientas habilitadas por administración.
                </p>
            </header>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-48 rounded-3xl bg-antigravity-light-border dark:bg-antigravity-dark-border animate-pulse opacity-10" />
                    ))}
                </div>
            ) : plugins.length === 0 ? (
                <div className="py-20 text-center rounded-3xl border-2 border-dashed border-antigravity-light-border dark:border-antigravity-dark-border opacity-50">
                    <span className="material-symbols-rounded text-4xl mb-4 text-antigravity-light-muted">apps_off</span>
                    <p className="font-bold text-antigravity-light-text dark:text-antigravity-dark-text">No tienes aplicaciones activas</p>
                    <p className="text-sm text-antigravity-light-muted">Contacta al Super Admin de MINREPORT para habilitar módulos.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {plugins.map((plugin) => (
                        <motion.div
                            key={plugin.id}
                            whileHover={{ y: -5 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setActivePlugin(plugin)}
                            className="group cursor-pointer p-6 rounded-3xl bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 hover:border-indigo-500/30 hover:shadow-xl transition-all flex flex-col justify-between h-56"
                        >
                            <div className="flex justify-between items-start">
                                <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-3xl group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                    <span className="material-symbols-rounded">{plugin.icon || 'extension'}</span>
                                </div>
                                <div className="w-8 h-8 rounded-full border border-gray-100 dark:border-zinc-800 flex items-center justify-center text-gray-400 group-hover:border-indigo-500 group-hover:text-indigo-500 transition-colors">
                                    <span className="material-symbols-rounded text-sm">arrow_outward</span>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1 group-hover:text-indigo-600 transition-colors">
                                    {plugin.name}
                                </h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">
                                    {plugin.description}
                                </p>
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}
        </div>
    );
};
