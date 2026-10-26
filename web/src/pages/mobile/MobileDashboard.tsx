import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { SYSTEM_MODULES, SystemModuleInfo } from '../../constants/modules';

const MobileDashboard: React.FC = () => {
    const { user, profile, currentAccount } = useAuth();
    const navigate = useNavigate();

    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';

    const rawKeys = (currentAccount as any)?.enabledPlugins;
    const enabledKeys: string[] = (Array.isArray(rawKeys) && rawKeys.length > 0)
        ? rawKeys
        : ['opermaq', 'stockpile'];
    const activeModules: SystemModuleInfo[] = SYSTEM_MODULES.filter(mod => enabledKeys.includes(mod.id));

    const stats = [
        { label: 'Tareas Pendientes', value: '3', icon: 'assignment', color: 'text-[#00AEEF]', bg: 'bg-[#00AEEF]/10 border-[#00AEEF]/20' },
        { label: 'Alertas Activas', value: '0', icon: 'notifications', color: 'text-[#C68346]', bg: 'bg-[#C68346]/10 border-[#C68346]/20' },
        { label: 'Eficiencia', value: '94%', icon: 'trending_up', color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20' },
        { label: 'Incidentes', value: '1', icon: 'error', color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20' },
    ];

    return (
        <div className="space-y-6 pb-20 px-4 pt-4 font-sans">
            {/* Header Section */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#12151C] pb-4">
                <div>
                    <h1 className="text-lg font-bold uppercase tracking-tight text-slate-900 dark:text-[#F3F4F6]">
                        {greeting}, <br />
                        <span className="text-[#C68346]">
                            {user?.displayName?.split(' ')[0] || 'Usuario'}
                        </span>
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-[#8A93A6] mt-1 font-mono">
                        {profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id)?.role || 'Miembro'} @ {currentAccount?.name || 'MINREPORT'}
                    </p>
                </div>
                {/* Avatar */}
                <div className="w-12 h-12 rounded-none bg-[#C68346]/10 flex items-center justify-center border border-[#C68346]/20 shadow-none">
                    {user?.photoURL ? (
                        <img src={user.photoURL} alt="Avatar" className="w-full h-full rounded-none object-cover" />
                    ) : (
                        <span className="text-base font-bold text-[#C68346] font-mono">
                            {user?.displayName?.charAt(0) || 'U'}
                        </span>
                    )}
                </div>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-2 gap-3">
                {stats.map((stat, idx) => (
                    <div key={idx} className="bg-[#F8FAFC] dark:bg-[#07090D] p-3.5 rounded-none shadow-none border border-slate-200 dark:border-[#12151C] flex flex-col items-start gap-2">
                        <div className={`p-1.5 rounded-none border ${stat.bg}`}>
                            <span className={`material-symbols-outlined text-[18px] ${stat.color}`}>{stat.icon}</span>
                        </div>
                        <div>
                            <span className="text-xl font-bold font-mono tracking-tight text-slate-900 dark:text-[#F3F4F6] block" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {stat.value}
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#8A93A6] block mt-0.5">
                                {stat.label}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Módulos Operativos Integrados */}
            <div>
                <div className="flex items-center justify-between mb-3 border-b border-slate-200 dark:border-[#12151C] pb-2">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-[#F3F4F6] flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-[#C68346]">grid_view</span>
                        Módulos Operativos
                    </h2>
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                        {activeModules.length} disponibles
                    </span>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                    {activeModules.map((module) => (
                        <button
                            key={module.id}
                            onClick={() => navigate(module.path)}
                            className="w-full text-left bg-[#F8FAFC] dark:bg-[#07090D] p-3.5 rounded-none shadow-none border border-slate-200 dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] flex items-center gap-3 transition-colors cursor-pointer"
                        >
                            <div className="w-10 h-10 rounded-none bg-[#C68346]/10 border border-[#C68346]/20 flex items-center justify-center text-[#C68346]">
                                <span className="material-symbols-outlined text-[20px]">{module.icon}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="font-bold text-xs uppercase tracking-tight text-slate-900 dark:text-[#F3F4F6] truncate">{module.name}</h3>
                                <p className="text-[11px] text-slate-500 dark:text-[#8A93A6] line-clamp-1 font-mono mt-0.5">{module.scope}</p>
                            </div>
                            <span className="material-symbols-outlined text-slate-400 text-[18px]">chevron_right</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default MobileDashboard;
