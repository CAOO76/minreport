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
                        initial={{ opacity: 0, scale: 0.98, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 10 }}
                        className="fixed inset-0 m-auto max-w-lg h-fit max-h-[90vh] bg-white dark:bg-[#0D0D0D] rounded-none shadow-2xl z-50 flex flex-col overflow-hidden border border-slate-200 dark:border-white/10 font-atkinson"
                    >
                        {/* Header with Cover */}
                        <div className="relative h-32 bg-black/5 dark:bg-white/5 border-b border-slate-200 dark:border-white/5 overflow-hidden">
                            <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none"></div>
                            <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-black/5 hover:bg-black/10 dark:hover:bg-white/10 text-black dark:text-white rounded-none backdrop-blur-md transition-colors z-20 border border-black/10 dark:border-white/10">
                                <X size={20} />
                            </button>
                            <div className="absolute -bottom-10 left-8 z-10">
                                <div className="w-24 h-24 rounded-none border-4 border-white dark:border-[#0D0D0D] bg-antigravity-accent text-white flex items-center justify-center text-3xl font-black shadow-lg">
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
                                    "px-3 py-1 rounded-none text-[9px] font-black uppercase tracking-[0.2em] border",
                                    user.status === 'ACTIVE' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400" :
                                        user.status === 'SUSPENDED' ? "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-500" :
                                            "bg-black/5 border-black/10 text-slate-500"
                                )}>
                                    {user.status}
                                </span>
                                <span className="px-3 py-1 rounded-none text-[9px] font-black uppercase tracking-[0.2em] border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-slate-600 dark:text-white/60">
                                    {user.role}
                                </span>
                            </div>

                            <div className="space-y-4 pt-4 border-t border-black/5 dark:border-white/5">
                                <h3 className="hud-label text-slate-400 dark:text-white/40 mb-4">Detalles de Cuenta</h3>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-3 rounded-none bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-1">
                                        <div className="flex items-center gap-2 text-slate-400 dark:text-white/30 text-[9px] font-black uppercase tracking-widest">
                                            <Calendar size={12} />
                                            Registro
                                        </div>
                                        <p className="text-sm font-bold dark:text-white">
                                            {new Date(user.createdAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <div className="p-3 rounded-none bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-1">
                                        <div className="flex items-center gap-2 text-slate-400 dark:text-white/30 text-[9px] font-black uppercase tracking-widest">
                                            <HardDrive size={12} />
                                            Almacenamiento
                                        </div>
                                        <p className="text-sm font-bold dark:text-white">
                                            {((user.stats?.storageUsed || 0) / 1024 / 1024).toFixed(1)} MB / {((user.entitlements?.storageLimit || 0) / 1024 / 1024).toFixed(0)} MB
                                        </p>
                                    </div>
                                </div>

                                <div className="p-4 rounded-none bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-3">
                                    <div className="flex items-center gap-2 text-slate-400 dark:text-white/30 text-[9px] font-black uppercase tracking-widest">
                                        <Activity size={12} />
                                        Plugins Activados
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {user.entitlements?.pluginsEnabled?.length ? (
                                            user.entitlements.pluginsEnabled.map(p => (
                                                <span key={p} className="px-2 py-1 rounded-none bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-white/80">
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
