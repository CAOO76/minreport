import { PluginLifeCycle, MinReportContext } from '@minreport/sdk';

/**
 * StockpileControl Plugin
 * 
 * Adaptador estandarizado para la gestión de acopios en MINREPORT.
 * Implementa el ciclo de vida del SDK y sigue las guías de diseño M3/Flat.
 */
export class StockpileControlPlugin implements PluginLifeCycle {
    private context: MinReportContext | null = null;

    /**
     * Inicialización del plugin con el contexto del sistema.
     */
    async onInit(context: MinReportContext) {
        this.context = context;
        console.log("[StockpileControl] Iniciando Control de Acopios...", {
            projectId: context.projectId,
            userId: context.userId,
            isOffline: context.isOffline
        });
    }

    /**
     * Reacción a actualizaciones de entidades (No implementado en este mock)
     */
    async onEntityUpdate(_entityId: string, _data: any) {
        // Lógica para reaccionar a cambios en otros módulos
    }

    /**
     * Renderizado del Widget de Acopios
     */
    renderWidget() {
        return (
            <div
                style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}
                className="w-full bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-[32px] overflow-hidden shadow-sm flex flex-col"
            >
                {/* Header del Plugin */}
                <div className="p-6 border-b border-slate-100 dark:border-zinc-700 flex justify-between items-center bg-slate-50/50 dark:bg-zinc-800/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
                            <span className="material-symbols-rounded text-white">inventory_2</span>
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-zinc-100 text-lg leading-tight uppercase tracking-tight">
                                Control de Acopios
                            </h3>
                            <p className="text-[10px] text-indigo-500 font-bold tracking-widest uppercase opacity-70">
                                Live Stockpile Tracking
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => console.log("[StockpileControl] Sincronizando...")}
                        className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-2xl hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2"
                    >
                        <span className="material-symbols-rounded text-lg">sync</span>
                        Sincronizar
                    </button>
                </div>

                {/* Tabla de Datos (Mock) */}
                <div className="p-0 overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 dark:bg-zinc-900/40">
                                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest">ID</th>
                                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest">Material</th>
                                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest">Ley (Au)</th>
                                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest">Tonelaje</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-zinc-700">
                            {[
                                { id: 'AC-001', mat: 'Oxidados', ley: '1.25 g/t', ton: '15,400' },
                                { id: 'AC-002', mat: 'Sulfuros', ley: '0.85 g/t', ton: '42,100' },
                                { id: 'AC-003', mat: 'Marginal', ley: '0.32 g/t', ton: '8,900' }
                            ].map((row, i) => (
                                <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-zinc-700/30 transition-colors">
                                    <td className="px-6 py-4 text-sm font-bold text-slate-700 dark:text-zinc-300 font-mono">{row.id}</td>
                                    <td className="px-6 py-4 text-sm text-slate-600 dark:text-zinc-400">{row.mat}</td>
                                    <td className="px-6 py-4 text-sm font-bold text-emerald-600 dark:text-emerald-400">{row.ley}</td>
                                    <td className="px-6 py-4 text-sm font-bold text-slate-900 dark:text-zinc-100">{row.ton} <span className="text-[10px] text-slate-400">mT</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Footer / Simulación de Error */}
                <div className="p-4 bg-slate-50/30 dark:bg-zinc-900/20 flex justify-end items-center gap-4">
                    <p className="text-[10px] text-slate-400 dark:text-zinc-600 italic">
                        Última actualización: hace 2 mins
                    </p>
                    <button
                        onClick={() => { throw new Error('Test Crash: StockpileControl triggered a fatal exception.') }}
                        className="w-1.5 h-1.5 rounded-full bg-slate-200 dark:bg-zinc-700 hover:bg-red-500 dark:hover:bg-red-500 transition-colors"
                        title="Simular Error (Debug)"
                    />
                </div>
            </div>
        );
    }
}

export default new StockpileControlPlugin();
