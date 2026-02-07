
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ClipboardList, Bell, TrendingUp, AlertCircle, Clock, CheckCircle2, LayoutGrid } from 'lucide-react';
import { MinReport } from '@minreport/sdk';
import { PluginLoader } from '../../core/plugins/PluginLoader';

const MobileDashboard: React.FC = () => {
    const { user, profile, currentAccount } = useAuth();
    const [plugins, setPlugins] = useState<any[]>([]);
    const [activePlugin, setActivePlugin] = useState<any | null>(null);

    useEffect(() => {
        // Inicializar plugins desde el SDK
        const init = () => {
            const active = MinReport.Core.getActivePlugins();
            setPlugins(active);
        };
        const timer = setTimeout(init, 500);
        return () => clearTimeout(timer);
    }, []);

    // Datetime greeting
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';

    // Mock Data for UI Visualization
    const stats = [
        { label: 'Tareas Pendientes', value: '3', icon: ClipboardList, color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30' },
        { label: 'Alertas Activas', value: '0', icon: Bell, color: 'text-amber-600', bg: 'bg-amber-100 dark:bg-amber-900/30' },
        { label: 'Eficiencia', value: '94%', icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
        { label: 'Incidentes', value: '1', icon: AlertCircle, color: 'text-rose-600', bg: 'bg-rose-100 dark:bg-rose-900/30' },
    ];

    const activities = [
        { title: 'Checklist Diario completado', time: 'Hace 20 min', type: 'success' },
        { title: 'Reporte de Turno sincronizado', time: 'Hace 1 hora', type: 'info' },
        { title: 'Alerta de Seguridad revisada', time: 'Hace 3 horas', type: 'warning' },
    ];

    if (activePlugin) {
        return (
            <div className="fixed inset-0 bg-white dark:bg-zinc-900 z-[100] flex flex-col">
                <div className="h-16 px-4 border-b border-gray-100 dark:border-zinc-800 flex items-center gap-3 bg-white dark:bg-zinc-900">
                    <button
                        onClick={() => setActivePlugin(null)}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full text-gray-500"
                    >
                        <span className="material-symbols-rounded">arrow_back</span>
                    </button>
                    <span className="material-symbols-rounded text-indigo-600 dark:text-indigo-400">{activePlugin.icon || 'extension'}</span>
                    <h2 className="font-bold text-gray-900 dark:text-white">{activePlugin.name}</h2>
                </div>
                <div className="flex-1 overflow-hidden relative">
                    <PluginLoader pluginId={activePlugin.id} />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-20 px-4 pt-4">

            {/* Header Section */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        {greeting}, <br />
                        <span className="text-indigo-600 dark:text-indigo-400">
                            {user?.displayName?.split(' ')[0] || 'Usuario'}
                        </span>
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id)?.role || 'Miembro'} @ {currentAccount?.name || 'Mi Organización'}
                    </p>
                </div>
                {/* Avatar */}
                <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center border-2 border-white dark:border-zinc-800 shadow-sm">
                    {user?.photoURL ? (
                        <img src={user.photoURL} alt="Avatar" className="w-full h-full rounded-full object-cover" />
                    ) : (
                        <span className="text-lg font-bold text-indigo-600 dark:text-indigo-300">
                            {user?.displayName?.charAt(0) || 'U'}
                        </span>
                    )}
                </div>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-2 gap-4">
                {stats.map((stat, idx) => (
                    <div key={idx} className="bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 flex flex-col items-start gap-3 hover:scale-[1.02] transition-transform">
                        <div className={`p-2 rounded-xl ${stat.bg}`}>
                            <stat.icon size={20} className={stat.color} />
                        </div>
                        <div>
                            <span className="text-2xl font-bold text-gray-900 dark:text-white block">
                                {stat.value}
                            </span>
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                {stat.label}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Plugins Sections */}
            <div>
                <div className="flex items-center justify-between mb-3 px-1">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <LayoutGrid size={20} className="text-indigo-600" />
                        Mis Herramientas
                    </h2>
                </div>

                {plugins.length === 0 ? (
                    <div className="p-8 text-center bg-gray-50 dark:bg-white/5 rounded-2xl border-2 border-dashed border-gray-200 dark:border-zinc-800">
                        <p className="text-sm text-gray-500">No hay herramientas activas</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3">
                        {plugins.map((plugin) => (
                            <button
                                key={plugin.id}
                                onClick={() => setActivePlugin(plugin)}
                                className="w-full text-left bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 flex items-center gap-4 active:scale-[0.98] transition-all"
                            >
                                <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                    <span className="material-symbols-rounded">{plugin.icon || 'extension'}</span>
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-bold text-gray-900 dark:text-white">{plugin.name}</h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{plugin.description}</p>
                                </div>
                                <span className="material-symbols-rounded text-gray-300">chevron_right</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Recent Activity */}
            <div>
                <div className="flex items-center justify-between mb-3 px-1 pt-2">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Actividad Reciente</h2>
                    <button className="text-xs font-medium text-indigo-600 dark:text-indigo-400">Ver todo</button>
                </div>

                <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 divide-y divide-gray-100 dark:divide-zinc-800">
                    {activities.map((item, idx) => (
                        <div key={idx} className="p-4 flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 
                                ${item.type === 'success' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30' :
                                    item.type === 'warning' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30' :
                                        'bg-blue-100 text-blue-600 dark:bg-blue-900/30'}`}>
                                {item.type === 'success' ? <CheckCircle2 size={16} /> :
                                    item.type === 'warning' ? <AlertCircle size={16} /> : <Clock size={16} />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                    {item.title}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {item.time}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

        </div>
    );
};

export default MobileDashboard;
