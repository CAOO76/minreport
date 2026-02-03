import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, X as XIcon, MapPin, Phone, Globe, FileText, Calendar, Building, User, History, Shield, Info, MessageSquare } from 'lucide-react';
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
    processedBy?: string;
    processedAt?: string;
    rejectionReason?: string;
    observations?: string;
}

interface TenantDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    tenant: Tenant | null;
    onAction?: (id: string, status: 'ACTIVE' | 'REJECTED', data?: { rejectionReason?: string, observations?: string }) => void;
}

export const TenantDetailsModal: React.FC<TenantDetailsModalProps> = ({
    isOpen,
    onClose,
    tenant,
    onAction
}) => {
    const { t } = useTranslation();
    const [rejectionReason, setRejectionReason] = React.useState('');
    const [observations, setObservations] = React.useState('');
    const [isRejecting, setIsRejecting] = React.useState(false);

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

                            <hr className="border-slate-100 dark:border-slate-800" />

                            {/* Traceability Section */}
                            <div className="space-y-4">
                                <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
                                    <History size={14} className="text-antigravity-accent" />
                                    Trazabilidad de la Solicitud
                                </h3>

                                <div className="space-y-3 relative before:absolute before:inset-0 before:left-3.5 before:w-px before:bg-slate-100 dark:before:bg-slate-800">
                                    {/* Action: Request */}
                                    <div className="relative pl-9 py-1 text-sm">
                                        <div className="absolute left-1.5 top-2.5 w-4 h-4 rounded-full bg-blue-500 border-4 border-white dark:border-slate-900 shadow-sm" />
                                        <span className="text-slate-500 tabular-nums">
                                            {new Date(tenant.createdAt._seconds ? tenant.createdAt._seconds * 1000 : tenant.createdAt).toLocaleString()}
                                        </span>
                                        <p className="font-bold text-slate-700 dark:text-slate-300">Solicitud creada</p>
                                        <p className="text-[11px] text-slate-400">Origen: Registro público {tenant.type}</p>
                                    </div>

                                    {/* Action: Validation / Process (If not pending) */}
                                    {tenant.status !== 'PENDING_APPROVAL' && (
                                        <div className="relative pl-9 py-1 text-sm">
                                            <div className={clsx(
                                                "absolute left-1.5 top-2.5 w-4 h-4 rounded-full border-4 border-white dark:border-slate-900 shadow-sm",
                                                tenant.status === 'ACTIVE' ? "bg-emerald-500" : "bg-rose-500"
                                            )} />
                                            <span className="text-slate-500 tabular-nums">
                                                {tenant.processedAt ? new Date(tenant.processedAt).toLocaleString() : 'N/A'}
                                            </span>
                                            <p className="font-bold text-slate-700 dark:text-slate-300">
                                                {tenant.status === 'ACTIVE' ? 'Solicitud Aprobada' : 'Solicitud Rechazada'}
                                            </p>
                                            <div className="mt-1 space-y-1">
                                                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                                    <Shield size={10} />
                                                    Responsable: <span className="text-slate-700 dark:text-slate-300 font-medium">{tenant.processedBy || 'Master Admin'}</span>
                                                </div>
                                                {tenant.status === 'REJECTED' && (
                                                    <div className="flex items-start gap-1.5 text-[11px] text-rose-500 bg-rose-50 dark:bg-rose-900/20 p-2 rounded-lg mt-1 border border-rose-100 dark:border-rose-900/30">
                                                        <Info size={10} className="mt-0.5 shrink-0" />
                                                        <div>
                                                            <span className="font-bold uppercase text-[9px]">Motivo del Rechazo:</span>
                                                            <p className="font-medium leading-relaxed">{tenant.rejectionReason || 'No especificado'}</p>
                                                        </div>
                                                    </div>
                                                )}
                                                {tenant.observations && (
                                                    <div className="flex items-start gap-1.5 text-[11px] text-slate-600 bg-slate-100 dark:bg-slate-800/50 p-2 rounded-lg mt-1 border border-slate-200 dark:border-slate-700">
                                                        <MessageSquare size={10} className="mt-0.5 shrink-0" />
                                                        <div>
                                                            <span className="font-bold uppercase text-[9px]">Observaciones Internas:</span>
                                                            <p className="font-medium leading-relaxed italic">"{tenant.observations}"</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Action Inputs (If Pending) */}
                            {tenant.status === 'PENDING_APPROVAL' && (
                                <div className="space-y-4 p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 animate-in fade-in slide-in-from-bottom-2">
                                    <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">
                                        <MessageSquare size={14} />
                                        Notas de Procesamiento
                                    </div>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Observaciones (Opcional)</label>
                                            <textarea
                                                value={observations}
                                                onChange={(e) => setObservations(e.target.value)}
                                                placeholder="Ej: Verificado por llamada telefónica, documentación completa..."
                                                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-antigravity-accent outline-none transition-all resize-none h-20"
                                            />
                                        </div>
                                        {isRejecting && (
                                            <div className="animate-in zoom-in-95 duration-200">
                                                <label className="text-[10px] font-bold text-rose-500 uppercase mb-1 block">Motivo del Rechazo (Obligatorio)</label>
                                                <textarea
                                                    value={rejectionReason}
                                                    onChange={(e) => setRejectionReason(e.target.value)}
                                                    placeholder="Ej: RUT no corresponde a la empresa, sitio web inactivo..."
                                                    className="w-full bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-900/30 rounded-xl p-3 text-sm focus:ring-2 focus:ring-rose-500 outline-none transition-all resize-none h-20"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer / Actions */}
                        {onAction && tenant.status === 'PENDING_APPROVAL' && (
                            <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-white/5 flex flex-col md:flex-row justify-between gap-3 items-center">
                                <div className="text-[10px] text-slate-400 text-center md:text-left">
                                    <p>Esta acción es irreversible y notificará al usuario vía email.</p>
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => {
                                            if (!isRejecting) {
                                                setIsRejecting(true);
                                                return;
                                            }
                                            if (!rejectionReason.trim()) {
                                                alert('Debes ingresar un motivo de rechazo');
                                                return;
                                            }
                                            onAction(tenant.id, 'REJECTED', { rejectionReason, observations });
                                        }}
                                        className={clsx(
                                            "px-4 py-2.5 rounded-xl border font-bold text-sm transition-all flex items-center gap-2",
                                            isRejecting
                                                ? "bg-rose-600 text-white border-rose-600 hover:bg-rose-700 shadow-lg shadow-rose-600/20"
                                                : "border-rose-200 text-rose-600 hover:bg-rose-50"
                                        )}
                                    >
                                        <XIcon size={16} />
                                        {isRejecting ? 'Confirmar Rechazo' : 'Rechazar'}
                                    </button>
                                    {!isRejecting && (
                                        <button
                                            onClick={() => onAction(tenant.id, 'ACTIVE', { observations })}
                                            className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2"
                                        >
                                            <Check size={16} />
                                            Aprobar Solicitud
                                        </button>
                                    )}
                                    {isRejecting && (
                                        <button
                                            onClick={() => setIsRejecting(false)}
                                            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-500 font-bold text-sm hover:bg-slate-100 transition-colors"
                                        >
                                            Cancelar
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
