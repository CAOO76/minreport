import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { SYSTEM_MODULES } from '../../constants/modules';

const MobileTools: React.FC = () => {
    const { t } = useTranslation();
    const { hasModuleAccess } = useMinReportSession();
    const navigate = useNavigate();

    const activeModules = SYSTEM_MODULES.filter((mod) =>
        hasModuleAccess(mod.id as 'opermaq' | 'stockpile')
    );

    return (
        <div className="space-y-fib-21 px-fib-13 pt-fib-13 pb-20 font-sans select-none">
            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                <h1 className="text-h1-header uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                    {t('core_mobile.tools_title')}
                </h1>
                <p className="text-xs text-[#475569] dark:text-[#8A93A6] font-mono mt-1">
                    {t('core_mobile.tools_subtitle')}
                </p>
            </div>

            {activeModules.length === 0 ? (
                <div className="p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-xs font-mono text-[#94A3B8] dark:text-[#5A6072]">
                    {t('core_mobile.no_modules_enabled')}
                </div>
            ) : (
                <div className="space-y-fib-13">
                    {activeModules.map((module) => (
                        <button
                            key={module.id}
                            type="button"
                            onClick={() => navigate(module.path)}
                            className="w-full text-left p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] rounded-none shadow-none flex items-start gap-fib-13 transition-colors cursor-pointer"
                        >
                            <span className="material-symbols-outlined text-[24px] text-[#C68346] shrink-0 mt-0.5">
                                {module.icon}
                            </span>
                            <div className="flex-1 min-w-0">
                                <h3 className="font-bold text-sm uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                                    {t(`core_shell.modules.${module.id}.name`, module.name)}
                                </h3>
                                <p className="text-xs text-[#475569] dark:text-[#8A93A6] mt-1 leading-relaxed">
                                    {t(`core_shell.modules.${module.id}.scope`, module.scope)}
                                </p>
                                <div className="mt-fib-13 flex items-center gap-1 text-microcopy font-mono font-bold uppercase tracking-wider text-[#C68346]">
                                    <span>{t('core_shell.open_module')}</span>
                                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default MobileTools;
