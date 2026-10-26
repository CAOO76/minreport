import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { SYSTEM_MODULES } from '../../constants/modules';

const MobileTools: React.FC = () => {
    const { currentAccount } = useAuth();
    const navigate = useNavigate();

    const rawKeys = (currentAccount as any)?.enabledPlugins;
    const enabledKeys: string[] = (Array.isArray(rawKeys) && rawKeys.length > 0)
        ? rawKeys
        : ['opermaq', 'stockpile'];
    const activeModules = SYSTEM_MODULES.filter(mod => enabledKeys.includes(mod.id));

    return (
        <div className="space-y-6 px-4 pt-4 pb-20 font-sans">
            {/* Header */}
            <div className="border-b border-slate-200 dark:border-[#12151C] pb-4">
                <h1 className="text-xl font-bold uppercase tracking-tight text-slate-900 dark:text-[#F3F4F6]">
                    Herramientas y Módulos
                </h1>
                <p className="text-xs text-slate-500 dark:text-[#8A93A6] font-mono mt-1">
                    Módulos industriales integrados para faena
                </p>
            </div>

            {/* Lista de Módulos */}
            <div className="space-y-3">
                {activeModules.map((module) => (
                    <div
                        key={module.id}
                        onClick={() => navigate(module.path)}
                        className="p-4 bg-[#F8FAFC] dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] rounded-none flex items-start gap-4 transition-colors cursor-pointer"
                    >
                        <div className="w-12 h-12 rounded-none bg-[#C68346]/10 border border-[#C68346]/20 flex items-center justify-center text-[#C68346] shrink-0">
                            <span className="material-symbols-outlined text-2xl">{module.icon}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                                <h3 className="font-bold text-sm uppercase tracking-tight text-slate-900 dark:text-[#F3F4F6]">
                                    {module.name}
                                </h3>
                                <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500">
                                    v{module.version}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-[#8A93A6] mt-1 leading-relaxed">
                                {module.scope}
                            </p>
                            <div className="mt-3 flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider text-[#C68346]">
                                <span>Ingresar al módulo</span>
                                <span className="material-symbols-outlined text-sm">arrow_forward</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default MobileTools;
