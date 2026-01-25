import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MapPin, Phone, Mail, Shield, Calendar, HardDrive, Activity } from 'lucide-react';
import clsx from 'clsx';
import { UserProfile } from '../../types/admin';

interface UserDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    user: UserProfile | null;
}

export const UserDetailsModal: React.FC<UserDetailsModalProps> = ({
    isOpen,
    onClose,
    user
}) => {
    if (!user) return null;

    const getInitials = (name: string, email: string) => {
        const base = name || email;
        return base.substring(0, 2).toUpperCase();
    };

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
                        className="fixed inset-0 m-auto max-w-lg h-fit max-h-[90vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl z-50 flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800 font-atkinson"
                    >
                        {/* Header with Cover */}
                        <div className="relative h-32 bg-slate-100 dark:bg-white/5 border-b border-slate-200 dark:border-slate-800">
                            <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/40 text-white rounded-full backdrop-blur-md transition-colors z-10">
                                <X size={20} />
                            </button>
                            <div className="absolute -bottom-10 left-8">
                                <div className="w-24 h-24 rounded-full border-4 border-white dark:border-slate-900 bg-antigravity-accent text-white flex items-center justify-center text-3xl font-black shadow-lg">
                                    {getInitials(user.displayName, user.email)}
                                </div>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="pt-12 px-8 pb-8 space-y-6">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white leading-tight">
                                    {user.displayName || 'Sin Nombre'}
                                </h2>
                                <div className="flex items-center gap-2 mt-1 text-slate-500">
                                    <Mail size={14} />
                                    <span className="text-sm">{user.email}</span>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <span className={clsx(
                                    "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border",
                                    user.status === 'ACTIVE' ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                                        user.status === 'SUSPENDED' ? "bg-amber-50 border-amber-200 text-amber-700" :
                                            "bg-slate-100 text-slate-500"
                                )}>
                                    {user.status}
                                </span>
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border border-slate-200 bg-slate-50 text-slate-600">
                                    {user.role}
                                </span>
                            </div>

                            <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Detalles de Cuenta</h3>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 space-y-1">
                                        <div className="flex items-center gap-2 text-slate-400 text-[10px] font-bold uppercase">
                                            <Calendar size={12} />
                                            Registro
                                        </div>
                                        <p className="text-sm font-medium dark:text-slate-200">
                                            {new Date(user.createdAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 space-y-1">
                                        <div className="flex items-center gap-2 text-slate-400 text-[10px] font-bold uppercase">
                                            <HardDrive size={12} />
                                            Almacenamiento
                                        </div>
                                        <p className="text-sm font-medium dark:text-slate-200">
                                            {((user.stats?.storageUsed || 0) / 1024 / 1024).toFixed(1)} MB / {((user.entitlements?.storageLimit || 0) / 1024 / 1024).toFixed(0)} MB
                                        </p>
                                    </div>
                                </div>

                                <div className="p-4 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 space-y-2">
                                    <div className="flex items-center gap-2 text-slate-400 text-[10px] font-bold uppercase">
                                        <Activity size={12} />
                                        Plugins Activados
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {user.entitlements?.pluginsEnabled?.length ? (
                                            user.entitlements.pluginsEnabled.map(p => (
                                                <span key={p} className="px-2 py-1 rounded bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-600 dark:text-slate-300 capitalize">
                                                    {p}
                                                </span>
                                            ))
                                        ) : (
                                            <span className="text-xs text-slate-400 italic">Ningún plugin activo</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
