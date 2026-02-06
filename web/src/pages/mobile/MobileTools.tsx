import React, { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { MinReport } from '@minreport/sdk';
import { PluginLoader } from '../../core/plugins/PluginLoader';

const MobileTools: React.FC = () => {
    const [plugins, setPlugins] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [activePlugin, setActivePlugin] = useState<any | null>(null);

    useEffect(() => {
        // Cargar plugins reales desde el SDK
        const loadPlugins = () => {
            const activePlugins = MinReport.Core.getActivePlugins();
            setPlugins(activePlugins);
            setLoading(false);
        };

        // Delay para asegurar inicialización del SDK
        const timer = setTimeout(loadPlugins, 500);
        return () => clearTimeout(timer);
    }, []);

    const handlePluginClick = (plugin: any) => {
        setActivePlugin(plugin);
    };

    // Modo Inmersivo del Plugin (Full Screen dentro del MobileLayout)
    if (activePlugin) {
        return (
            <div className="flex flex-col h-full bg-white dark:bg-black font-atkinson animate-in slide-in-from-right duration-300">
                {/* Header Inmersivo */}
                <div className="h-16 px-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md sticky top-0 z-10">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setActivePlugin(null)}
                            className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-2xl transition-colors text-gray-500"
                        >
                            <span className="material-symbols-rounded !text-2xl">arrow_back</span>
                        </button>
                        <div className="flex items-center gap-3">
                            <span className="material-symbols-rounded text-indigo-600 dark:text-indigo-400 !text-2xl">
                                {activePlugin.icon || 'extension'}
                            </span>
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate max-w-[180px]">
                                {activePlugin.name}
                            </h2>
                        </div>
                    </div>
                </div>

                {/* Contenido Real del Plugin */}
                <div className="flex-1 overflow-y-auto">
                    <PluginLoader pluginId={activePlugin.id} />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 px-4 pt-6 pb-20 font-atkinson">

            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Herramientas</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {loading ? 'Cargando herramientas...' : `${plugins.length} ${plugins.length === 1 ? 'plugin activo' : 'plugins activos'} en tu plan`}
                </p>
            </div>

            {/* Plugins Grid (Real) */}
            {loading ? (
                <div className="grid grid-cols-2 gap-4">
                    {[1, 2].map(i => (
                        <div key={i} className="h-40 rounded-3xl bg-gray-100 dark:bg-zinc-800 animate-pulse" />
                    ))}
                </div>
            ) : plugins.length > 0 ? (
                <div className="grid grid-cols-2 gap-4">
                    {plugins.map((plugin) => (
                        <button
                            key={plugin.id}
                            onClick={() => handlePluginClick(plugin)}
                            className="flex flex-col items-center justify-center p-6 rounded-3xl bg-white dark:bg-zinc-900 shadow-sm border border-gray-100 dark:border-zinc-800 transition-all active:scale-95 active:shadow-none h-40 group"
                        >
                            <div className={`p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 mb-4 group-hover:scale-110 transition-transform`}>
                                <span className="material-symbols-rounded text-indigo-600 dark:text-indigo-400 !text-4xl">
                                    {plugin.icon || 'extension'}
                                </span>
                            </div>
                            <span className="font-bold text-gray-900 dark:text-white text-sm text-center px-2 truncate w-full">
                                {plugin.name}
                            </span>
                        </button>
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-600 border-2 border-dashed border-gray-100 dark:border-zinc-800 rounded-3xl">
                    <Package size={48} strokeWidth={1.5} className="mb-4 opacity-50" />
                    <p className="text-sm">No tienes módulos activos.</p>
                </div>
            )}

            {/* Nota de Seguridad */}
            <div className="pt-4 opacity-50">
                <p className="text-[10px] text-center text-gray-400 px-8">
                    Solo aparecen las herramientas habilitadas por el Administrador de tu cuenta.
                </p>
            </div>
        </div>
    );
};

export default MobileTools;
