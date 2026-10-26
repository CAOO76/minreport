import { useAuth } from '../context/AuthContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { SYSTEM_MODULES, SystemModuleInfo } from '../constants/modules';

export const OperationalDashboard = () => {
    const { currentAccount } = useAuth();
    const { isOnline } = useNetworkStatus();
    const navigate = useNavigate();

    // Fallback de seguridad
    if (!currentAccount) return null;

    const APP_VERSION = '__APP_VERSION__' in window ? (window as any).__APP_VERSION__ : 'v3.0.0';

    // Módulos autorizados para la cuenta actual
    const rawKeys = (currentAccount as any)?.enabledPlugins;
    const enabledKeys: string[] = (Array.isArray(rawKeys) && rawKeys.length > 0)
        ? rawKeys
        : ['opermaq', 'stockpile'];
    const activeModules: SystemModuleInfo[] = SYSTEM_MODULES.filter(mod => enabledKeys.includes(mod.id));

    return (
        <div className="max-w-6xl mx-auto py-8 px-4 space-y-8 animate-in fade-in duration-500 font-sans">
            {/* Encabezado Técnico Aséptico */}
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 dark:border-[#12151C] pb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white uppercase tracking-tight">
                        Panel de Control Operacional
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-[#8A93A6] mt-1 font-mono">
                        Contexto Operativo: <span className="text-[#C68346] font-bold">{currentAccount.name}</span>
                    </p>
                </div>

                <div className="flex items-center gap-6 bg-[#F8FAFC] dark:bg-[#07090D] p-3.5 rounded-none border border-slate-200 dark:border-[#12151C]">
                    <div className="px-3 border-r border-slate-200 dark:border-[#12151C]">
                        <p className="text-[9px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-0.5">ESTADO RED</p>
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-none ${isOnline ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} />
                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                {isOnline ? 'En línea' : 'Sin conexión'}
                            </span>
                        </div>
                    </div>
                    <div className="px-3">
                        <p className="text-[9px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-0.5">SISTEMA</p>
                        <p className="text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300">{APP_VERSION}</p>
                    </div>
                </div>
            </header>

            {/* Módulos Industriales Centralizados */}
            <section className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#12151C] pb-3">
                    <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-2">
                        <span className="material-symbols-outlined text-base text-[#C68346]">apps</span>
                        Módulos Operativos Integrados
                    </h2>
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                        {activeModules.length} activos
                    </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {activeModules.map((module) => (
                        <motion.div
                            key={module.id}
                            whileHover={{ y: -2 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => navigate(module.path)}
                            className="group cursor-pointer p-6 rounded-none bg-[#F8FAFC] dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] transition-all flex flex-col justify-between h-52 relative overflow-hidden shadow-none"
                        >
                            <div className="flex items-start justify-between">
                                <div className="w-12 h-12 rounded-none bg-[#C68346]/10 border border-[#C68346]/20 flex items-center justify-center text-[#C68346] group-hover:bg-[#C68346] group-hover:text-white transition-colors">
                                    <span className="material-symbols-outlined text-2xl">{module.icon}</span>
                                </div>
                                <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                    v{module.version}
                                </span>
                            </div>

                            <div className="space-y-1 mt-4">
                                <h3 className="font-bold text-sm uppercase tracking-tight text-slate-900 dark:text-white group-hover:text-[#C68346] transition-colors">
                                    {module.name}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                    {module.scope}
                                </p>
                            </div>

                            <div className="pt-3 border-t border-slate-200 dark:border-[#12151C] flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-wider text-[#C68346]">
                                <span>Acceder</span>
                                <span className="material-symbols-outlined text-sm group-hover:translate-x-1 transition-transform">arrow_forward</span>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </section>
        </div>
    );
};
