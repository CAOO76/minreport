import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, X as XIcon, MapPin, Phone, Globe, FileText, Calendar, Building, User } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

interface Tenant {
    id: string;
    type: 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';
    email: string;
    status: 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED';
    createdAt: any;
    company_name?: string;
    institution_name?: string;
    full_name?: string;
    rut?: string;
    run?: string;
    address?: string;
    address_place_id?: string;
    phone?: string;
    website?: string;
    position?: string;
}

interface TenantDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    tenant: Tenant | null;
    onAction?: (id: string, status: 'ACTIVE' | 'REJECTED') => void;
}

export const TenantDetailsModal: React.FC<TenantDetailsModalProps> = ({
    isOpen,
    onClose,
    tenant,
    onAction
}) => {
    const { t } = useTranslation();

    if (!tenant) return null;

    const getDisplayName = () => tenant.company_name || tenant.institution_name || tenant.full_name;
    const getIdNumber = () => tenant.rut || tenant.run || 'N/A';

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
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start bg-slate-50/50 dark:bg-white/5">
                            <div className="flex gap-4">
                                <div className={clsx(
                                    "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl border shadow-sm",
                                    tenant.type === 'ENTERPRISE' && "bg-blue-50 border-blue-100 text-blue-600 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400",
                                    tenant.type === 'EDUCATIONAL' && "bg-purple-50 border-purple-100 text-purple-600 dark:bg-purple-900/20 dark:border-purple-800 dark:text-purple-400",
                                    tenant.type === 'PERSONAL' && "bg-emerald-50 border-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400"
                                )}>
                                    <span className="material-symbols-rounded">
                                        {tenant.type === 'ENTERPRISE' ? 'domain' : tenant.type === 'EDUCATIONAL' ? 'school' : 'person'}
                                    </span>
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">
                                        {getDisplayName()}
                                    </h2>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className={clsx(
                                            "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border",
                                            tenant.status === 'PENDING_APPROVAL' && "bg-amber-50 border-amber-100 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400",
                                            tenant.status === 'ACTIVE' && "bg-emerald-50 border-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400",
                                            tenant.status === 'REJECTED' && "bg-rose-50 border-rose-100 text-rose-700 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-400"
                                        )}>
                                            {t(`admin.status.${tenant.status.toLowerCase().replace('_approval', '')}`)}
                                        </span>
                                        <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">
                                            {tenant.id}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-colors text-slate-400">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6 overflow-y-auto space-y-8">
                            {/* Primary Info Grid */}
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                        <FileText size={12} />
                                        Identificador Fiscal
                                    </label>
                                    <p className="text-sm font-medium text-slate-900 dark:text-white font-mono">{getIdNumber()}</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                        <Calendar size={12} />
                                        Fecha Solicitud
                                    </label>
                                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                                        {new Date(tenant.createdAt._seconds * 1000).toLocaleDateString()}
                                    </p>
                                </div>
                            </div>

                            <hr className="border-slate-100 dark:border-slate-800" />

                            {/* Contact Details */}
                            <div className="space-y-4">
                                <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest">Información de Contacto</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/5 flex gap-3">
                                        <div className="p-2 bg-white dark:bg-white/5 rounded-lg h-fit text-slate-400">
                                            <MapPin size={16} />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase">Dirección</label>
                                            <p className="text-sm text-slate-700 dark:text-slate-300">{tenant.address || 'No registrada'}</p>
                                            {tenant.address_place_id && (
                                                <span className="inline-block mt-1 text-[9px] bg-green-100 text-green-700 px-1.5 rounded dark:bg-green-900/30 dark:text-green-400">
                                                    Google Validated
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/5 flex gap-3">
                                        <div className="p-2 bg-white dark:bg-white/5 rounded-lg h-fit text-slate-400">
                                            <Phone size={16} />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase">Teléfono</label>
                                            <p className="text-sm text-slate-700 dark:text-slate-300 font-mono">{tenant.phone || 'No registrado'}</p>
                                        </div>
                                    </div>
                                    <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/5 flex gap-3">
                                        <div className="p-2 bg-white dark:bg-white/5 rounded-lg h-fit text-slate-400">
                                            <Globe size={16} />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase">Sitio Web</label>
                                            <a href={tenant.website} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline truncate block">
                                                {tenant.website || 'No registrado'}
                                            </a>
                                        </div>
                                    </div>
                                    {tenant.position && (
                                        <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/5 flex gap-3">
                                            <div className="p-2 bg-white dark:bg-white/5 rounded-lg h-fit text-slate-400">
                                                <User size={16} />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase">Cargo / Rol</label>
                                                <p className="text-sm text-slate-700 dark:text-slate-300">{tenant.position}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Footer / Actions */}
                        {onAction && tenant.status === 'PENDING_APPROVAL' && (
                            <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-white/5 flex justify-end gap-3">
                                <button
                                    onClick={() => onAction(tenant.id, 'REJECTED')}
                                    className="px-4 py-2.5 rounded-xl border border-rose-200 text-rose-600 font-bold text-sm hover:bg-rose-50 transition-colors flex items-center gap-2"
                                >
                                    <XIcon size={16} />
                                    Rechazar
                                </button>
                                <button
                                    onClick={() => onAction(tenant.id, 'ACTIVE')}
                                    className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2"
                                >
                                    <Check size={16} />
                                    Aprobar Solicitud
                                </button>
                            </div>
                        )}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
