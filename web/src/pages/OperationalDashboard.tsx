import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useMinReportSession } from '../context/MinReportSessionContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useNavigate } from 'react-router-dom';
import { CORE_MODULES, type CoreModuleDescriptor } from '../core/modules/module-registry';

export const OperationalDashboard: React.FC = () => {
    const { t } = useTranslation();
    const { currentAccount } = useAuth();
    const { hasModuleAccess, session } = useMinReportSession();
    const isEduSandbox = Boolean(session?.isEduSandbox);
    const { isOnline } = useNetworkStatus();
    const navigate = useNavigate();

    if (!currentAccount) return null;

    const APP_VERSION = '__APP_VERSION__' in window ? (window as any).__APP_VERSION__ : 'v3.0.0';

    const activeModules: CoreModuleDescriptor[] = CORE_MODULES.filter((mod) =>
        hasModuleAccess(mod.id)
    );

    return (
        <div className="max-w-6xl mx-auto py-fib-34 px-fib-21 space-y-fib-34 font-sans select-none bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]">
            {/* Encabezado Técnico Aséptico */}
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21">
                <div>
                    <h1 className="text-h1-header font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase">
                        {t('core_shell.op_dashboard_title', 'Panel de Control Operacional')}
                    </h1>
                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-fib-8 font-mono">
                        {t('core_shell.op_context_label', 'Contexto Operativo:')}{' '}
                        <span className="text-[#C68346] font-bold">{currentAccount.name}</span>
                        {isEduSandbox && (
                            <span className="ml-fib-13 text-microcopy text-[#00AEEF]">
                                {t('core_shell.edu_sandbox_tag', '[SANDBOX EDU]')}
                            </span>
                        )}
                    </p>
                </div>

                <div className="flex items-center gap-fib-13 text-[#475569] dark:text-[#8A93A6]">
                    <span
                        title={isOnline ? t('core_shell.status_online', 'En línea') : t('core_shell.status_offline', 'Modo Offline')}
                        aria-label={isOnline ? t('core_shell.status_online', 'En línea') : t('core_shell.status_offline', 'Modo Offline')}
                        className={`inline-flex items-center ${isOnline ? 'text-[#00AEEF]' : 'text-red-500'}`}
                    >
                        <span className="material-symbols-outlined text-[18px]">{isOnline ? 'wifi' : 'wifi_off'}</span>
                    </span>
                    <span className="text-microcopy font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">{APP_VERSION}</span>
                </div>
            </header>

            {/* Módulos Industriales Integrados */}
            <section className="space-y-fib-21">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                    <h2 className="text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                        {t('core_shell.integrated_modules_title', 'Módulos Operativos Integrados')}
                    </h2>
                    <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                        {t('core_shell.enabled_modules_count', {
                            count: activeModules.length,
                            defaultValue: `${activeModules.length} habilitado(s)`,
                        })}
                    </span>
                </div>

                {activeModules.length === 0 ? (
                    <div className="p-fib-34 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none text-center">
                        <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                            {t('core_common.undeclared_tech_value', '[Información técnica no declarada en ficha]')} —{' '}
                            {t('core_shell.no_modules_enabled', 'Sin módulos operativos habilitados para esta cuenta.')}
                        </p>
                    </div>
                ) : (
                    <div
                        className={
                            activeModules.length >= 3
                                ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-fib-21'
                                : 'grid grid-cols-1 sm:grid-cols-2 gap-fib-21'
                        }
                    >
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
                                        {t(module.nameKey, module.name)}
                                    </h3>
                                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                                        {t(module.scopeKey, module.scope)}
                                    </p>
                                </div>

                                <div className="pt-fib-13 mt-fib-21 border-t border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-end text-[#C68346]">
                                    <span className="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">
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
