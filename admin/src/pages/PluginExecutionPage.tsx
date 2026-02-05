import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PluginLoader } from '../core/plugins/PluginLoader';
import { getPluginById } from '../core/PluginRegistry';

export const PluginExecutionPage = () => {
    const { pluginId } = useParams();
    const navigate = useNavigate();
    const manifest = pluginId ? getPluginById(pluginId)?.manifest : null;

    if (!pluginId) return null;

    return (
        <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-xl">
            <header className="h-14 px-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/plugins')} className="p-2 hover:bg-slate-50 dark:hover:bg-white/5 rounded-xl transition-colors">
                        <span className="material-symbols-rounded">arrow_back</span>
                    </button>
                    <h2 className="font-bold text-slate-900 dark:text-white">{manifest?.name || 'Cargando...'}</h2>
                </div>
            </header>
            <div className="flex-1 overflow-auto">
                <PluginLoader pluginId={pluginId} />
            </div>
        </div>
    );
};
