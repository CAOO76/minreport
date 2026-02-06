import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Puzzle, Settings } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { M3Switch } from '../ui/M3Switch';

interface Tenant {
    id: string;
    company_name?: string;
    institution_name?: string;
    full_name?: string;
    status: 'ACTIVE' | 'PENDING_APPROVAL' | 'REJECTED' | 'SUSPENDED' | 'DELETED';
    enabledPlugins?: string[];
}

interface TenantPluginsModalProps {
    isOpen: boolean;
    onClose: () => void;
    tenant: Tenant | null;
    onUpdatePlugins: (tenantId: string, newPlugins: string[]) => Promise<void> | void;
}

export const TenantPluginsModal: React.FC<TenantPluginsModalProps> = ({
    isOpen,
    onClose,
    tenant,
    onUpdatePlugins
}) => {
    const { t } = useTranslation();

    if (!tenant) return null;

    const getDisplayName = () => tenant.company_name || tenant.institution_name || tenant.full_name;

    const availablePlugins = [
        {
            id: 'stockpile-control',
            name: 'Stockpile Control',
            type: 'Módulo Operacional',
            icon: 'inventory_2',
            description: 'Gestión de inventarios y movimientos de material.'
        }
    ];

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="fixed inset-0 m-auto max-w-2xl h-fit max-h-[90vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl z-50 flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800"
                    >
                        {/* Header */}
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-white/5">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center border border-indigo-200 dark:border-indigo-800">
                                    <Settings size={24} />
                                </div>
                                <div>
                                    <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                                        Configuración de Plugins
                                    </h2>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                                        {getDisplayName()}
                                    </p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-colors text-slate-400">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6 overflow-y-auto">
                            <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest flex items-center gap-2 mb-4">
                                <span className="material-symbols-rounded text-indigo-500 text-sm">extension</span>
                                Plugins Disponibles
                            </h3>

                            <div className="space-y-3">
                                {availablePlugins.map(plugin => {
                                    const isEnabled = tenant.enabledPlugins?.includes(plugin.id) || false;

                                    return (
                                        <div key={plugin.id} className="flex items-center justify-between p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800 transition-all bg-white dark:bg-slate-800 group hover:shadow-sm">
                                            <div className="flex items-center gap-4">
                                                <div className={clsx(
                                                    "w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-colors",
                                                    isEnabled
                                                        ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400"
                                                        : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600"
                                                )}>
                                                    <span className="material-symbols-rounded">{plugin.icon}</span>
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-slate-900 dark:text-white text-lg">{plugin.name}</h4>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/50 px-1.5 py-0.5 rounded">
                                                            {plugin.type}
                                                        </span>
                                                        <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">
                                                            v1.0.0
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-4">
                                                <span className={clsx(
                                                    "text-xs font-bold uppercase tracking-wider transition-colors",
                                                    isEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"
                                                )}>
                                                    {isEnabled ? 'Activo' : 'Inactivo'}
                                                </span>
                                                <M3Switch
                                                    checked={isEnabled}
                                                    onChange={(checked) => {
                                                        const currentPlugins = tenant.enabledPlugins || [];
                                                        const newPlugins = checked
                                                            ? [...currentPlugins, plugin.id]
                                                            : currentPlugins.filter(p => p !== plugin.id);

                                                        onUpdatePlugins(tenant.id, newPlugins);
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Coming Soon Section - Moved to bottom and minimized */}
                            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
                                <p className="text-center text-xs text-slate-400 italic">
                                    Más plugins estarán disponibles próximamente.
                                </p>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-white/5 flex justify-end">
                            <button
                                onClick={onClose}
                                className="px-6 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-sm hover:shadow-lg transition-all"
                            >
                                Listo
                            </button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
