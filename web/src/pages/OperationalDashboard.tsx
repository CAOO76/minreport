import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useMinReportSession } from '../context/MinReportSessionContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useNavigate } from 'react-router-dom';
import { SYSTEM_MODULES, SystemModuleInfo } from '../constants/modules';

export const OperationalDashboard: React.FC = () => {
    const { currentAccount } = useAuth();
    const { hasModuleAccess, session } = useMinReportSession();
    const isEduSandbox = Boolean(session?.isEduSandbox);
    const { isOnline } = useNetworkStatus();
    const navigate = useNavigate();

    if (!currentAccount) return null;

    const APP_VERSION = '__APP_VERSION__' in window ? (window as any).__APP_VERSION__ : 'v3.0.0';

    const activeModules: SystemModuleInfo[] = SYSTEM_MODULES.filter((mod) =>
        mod.id === 'opermaq' || mod.id === 'stockpile'
            ? hasModuleAccess(mod.id)
            : false
    );

    return (
        <div className="max-w-6xl mx-auto py-fib-34 px-fib-21 space-y-fib-34 font-sans select-none bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]">
            {/* Encabezado Técnico Aséptico */}
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21">
                <div>
                    <h1 className="text-h1-header font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase">
                        Panel de Control Operacional
                    </h1>
                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-fib-8 font-mono">
                        Contexto Operativo: <span className="text-[#C68346] font-bold">{currentAccount.name}</span>
                        {isEduSandbox && (
                            <span className="ml-fib-13 text-microcopy text-[#00AEEF]">
                                [SANDBOX EDU]
                            </span>
                        )}
                    </p>
                </div>

                <div className="flex items-center gap-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] p-fib-13 rounded-none shadow-none border border-[#E2E8F0] dark:border-[#12151C]">
                    <div className="px-fib-13 border-r border-[#E2E8F0] dark:border-[#12151C]">
                        <p className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] uppercase mb-0.5">ESTADO RED</p>
                        <div className="flex items-center gap-fib-8">
                            <div className={`w-2 h-2 rounded-none ${isOnline ? 'bg-[#00AEEF]' : 'bg-red-500'}`} />
                            <span className="text-microcopy font-mono font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                {isOnline ? 'En línea' : 'Modo Offline'}
                            </span>
                        </div>
                    </div>
                    <div className="px-fib-13">
                        <p className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] uppercase mb-0.5">VERSIÓN</p>
                        <p className="text-microcopy font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">{APP_VERSION}</p>
                    </div>
                </div>
            </header>

            {/* Módulos Industriales Integrados */}
            <section className="space-y-fib-21">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                    <h2 className="text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6] flex items-center gap-fib-8">
                        <span className="material-symbols-outlined text-[18px] text-[#C68346]">apps</span>
                        <span>Módulos Operativos Integrados</span>
                    </h2>
                    <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                        {activeModules.length} habilitado(s)
                    </span>
                </div>

                {activeModules.length === 0 ? (
                    <div className="p-fib-34 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none text-center">
                        <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                            [Información técnica no declarada en ficha] — Sin módulos operativos habilitados para esta cuenta.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-21">
                        {activeModules.map((module) => (
                            <div
                                key={module.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => navigate(module.path)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        navigate(module.path);
                                    }
                                }}
                                className="group cursor-pointer p-fib-21 rounded-none shadow-none bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] transition-colors flex flex-col justify-between min-h-[196px]"
                            >
                                <div className="flex items-start justify-between">
                                    <span className="material-symbols-outlined text-[24px] text-[#C68346]">
                                        {module.icon}
                                    </span>
                                    <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] uppercase">
                                        v{module.version}
                                    </span>
                                </div>

                                <div className="space-y-fib-8 mt-fib-21">
                                    <h3 className="text-h2-section font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] group-hover:text-[#C68346] transition-colors">
                                        {module.name}
                                    </h3>
                                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                                        {module.scope}
                                    </p>
                                </div>

                                <div className="pt-fib-13 mt-fib-21 border-t border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between text-microcopy font-mono font-bold uppercase text-[#C68346]">
                                    <span>Abrir módulo</span>
                                    <span className="material-symbols-outlined text-[16px] group-hover:translate-x-1 transition-transform">
                                        arrow_forward
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
};

export default OperationalDashboard;
