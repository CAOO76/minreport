import { useState } from 'react';
import PluginErrorBoundary from './PluginErrorBoundary';
import PluginLoader from './PluginLoader';
import { getAllPlugins } from '../PluginRegistry';

// Registro Central (Simulado por la importación de PluginRegistry oben)
// getAllPlugins nos permite listar las herramientas disponibles
const allAvailablePlugins = getAllPlugins();

const BuggyComponent = () => {
    throw new Error("Simulated Plugin Error");
};

export const PluginErrorBoundaryDemo = () => {
    const [shouldExplode, setShouldExplode] = useState(false);

    return (
        <div className="p-10 space-y-8 min-h-screen bg-slate-50 dark:bg-[#121212]">
            <header className="space-y-2">
                <h1 className="text-3xl font-bold font-sans text-slate-900 dark:text-white">
                    Muro de Contención: Demo de Seguridad
                </h1>
                <p className="text-slate-500 dark:text-zinc-400 font-sans">
                    Verificación de aislamiento de errores en widgets de terceros.
                </p>
                <div className="flex gap-2 mt-4">
                    {allAvailablePlugins.map(p => (
                        <span key={p.id} className="text-[10px] font-bold bg-slate-200 dark:bg-zinc-800 px-3 py-1 rounded-full text-slate-600 dark:text-zinc-400">
                            ID: {p.id} ({p.name})
                        </span>
                    ))}
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl">
                {/* Plugin Saludable */}
                <div className="space-y-4">
                    <span className="text-xs font-bold text-emerald-500 uppercase tracking-widest px-3 py-1 bg-emerald-500/10 rounded-full font-sans">
                        Plugin Operativo
                    </span>
                    <PluginErrorBoundary pluginName="Monitor de Inventario">
                        <div className="p-8 bg-white dark:bg-zinc-800 rounded-[32px] border border-slate-200 dark:border-zinc-700 shadow-sm flex flex-col gap-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                                    <span className="material-symbols-rounded text-emerald-600">inventory_2</span>
                                </div>
                                <h2 className="font-bold text-xl font-sans text-slate-900 dark:text-white">Control de Stock</h2>
                            </div>
                            <p className="text-slate-500 dark:text-zinc-400 text-sm font-sans leading-relaxed">
                                Este es un plugin que funciona correctamente y no lanza excepciones.
                                La aplicación principal fluye sin interrupciones.
                            </p>
                            <div className="h-2 w-full bg-slate-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                                <div className="h-full w-2/3 bg-emerald-500 rounded-full" />
                            </div>
                        </div>
                    </PluginErrorBoundary>
                </div>

                {/* Plugin Inestable */}
                <div className="space-y-4">
                    <span className="text-xs font-bold text-amber-500 uppercase tracking-widest px-3 py-1 bg-amber-500/10 rounded-full font-sans">
                        Plugin Inestable
                    </span>
                    <PluginErrorBoundary
                        pluginName="Stockpile Control"
                        onReset={() => setShouldExplode(false)}
                    >
                        {shouldExplode ? (
                            <BuggyComponent />
                        ) : (
                            <div className="p-8 bg-white dark:bg-zinc-800 rounded-[32px] border border-slate-200 dark:border-zinc-700 shadow-sm flex flex-col gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                                        <span className="material-symbols-rounded text-amber-600">warning</span>
                                    </div>
                                    <h2 className="font-bold text-xl font-sans text-slate-900 dark:text-white">Stockpile Control</h2>
                                </div>
                                <p className="text-slate-500 dark:text-zinc-400 text-sm font-sans leading-relaxed">
                                    Al presionar el botón de abajo, este plugin lanzará una excepción fatal (Exception).
                                </p>
                                <button
                                    onClick={() => setShouldExplode(true)}
                                    className="mt-2 w-full py-4 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-2xl text-sm font-bold active:scale-95 transition-all hover:bg-amber-500/20 font-sans"
                                >
                                    Force Core-Dump (Simular Error)
                                </button>
                            </div>
                        )}
                    </PluginErrorBoundary>
                </div>
                {/* Test de Cargador Seguro (PluginLoader) */}
                <div className="md:col-span-2 space-y-4 pt-8 border-t border-slate-200 dark:border-zinc-800">
                    <span className="text-xs font-bold text-indigo-500 uppercase tracking-widest px-3 py-1 bg-indigo-500/10 rounded-full font-sans">
                        Infraestructura Core: PluginLoader
                    </span>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Caso 1: Plugin No Encontrado */}
                        <div className="space-y-2">
                            <p className="text-xs text-slate-400 font-bold uppercase ml-2">Estado: 404 Not Found</p>
                            <PluginLoader pluginId="plugin-inexistente" />
                        </div>

                        {/* Caso 2: Carga Exitosa (Plugin Real) */}
                        <div className="space-y-2">
                            <p className="text-xs text-slate-400 font-bold uppercase ml-2">Estado: Registro & Carga (Plugin Real)</p>
                            <PluginLoader pluginId="stockpile-control" />
                        </div>
                    </div>
                </div>
            </div>

            <footer className="mt-12 pt-8 border-t border-slate-200 dark:border-zinc-800">
                <p className="text-xs text-slate-400 dark:text-zinc-600 font-sans text-center">
                    MINREPORT Reliability Engine &bull; Plugin Security Sandbox &bull; 2026
                </p>
            </footer>
        </div>
    );
};

export default PluginErrorBoundaryDemo;
