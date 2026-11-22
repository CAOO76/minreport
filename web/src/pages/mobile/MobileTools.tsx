import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import type { CoreModuleId } from '../../core/modules/module-registry';
import { SYSTEM_MODULES } from '../../constants/modules';

const MobileTools: React.FC = () => {
    const { t } = useTranslation();
    const { hasModuleAccess } = useMinReportSession();
    const navigate = useNavigate();

    const activeModules = SYSTEM_MODULES.filter((mod) =>
        hasModuleAccess(mod.id as CoreModuleId)
    );

    return (
        <div className="bg-[#FFFFFF] dark:bg-[#000000] px-fib-21 py-fib-55 font-atkinson select-none rounded-none shadow-none">
            {activeModules.length === 0 ? (
                <p className="py-fib-34 text-center text-microcopy font-mono text-[#94A3B8] dark:text-[#5A6072]">
                    {t('core_mobile.no_modules_enabled')}
                </p>
            ) : (
                <section
                    aria-label={t('core_mobile.tools_title')}
                    className="grid grid-cols-3 sm:grid-cols-4 gap-fib-34 place-items-center"
                >
                    {activeModules.map((module) => {
                        const modName = t(`core_shell.modules.${module.id}.name`, module.name);
                        return (
                            <button
                                key={module.id}
                                type="button"
                                onClick={() => navigate(module.path)}
                                aria-label={modName}
                                title={modName}
                                className="min-w-[64px] min-h-[64px] p-fib-13 bg-transparent border-0 outline-none flex items-center justify-center cursor-pointer rounded-none shadow-none text-[#C68346] hover:opacity-75 transition-opacity"
                            >
                                <span className="material-symbols-outlined text-[48px] leading-none text-[#C68346]">
                                    {module.icon}
                                </span>
                            </button>
                        );
                    })}
                </section>
            )}
        </div>
    );
};

export default MobileTools;
