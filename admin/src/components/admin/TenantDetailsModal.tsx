import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, X as XIcon, MapPin, Phone, FileText, Calendar, History, Shield, Info, MessageSquare, Activity, Globe, Mail, Badge, BookOpen, GraduationCap } from 'lucide-react';
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
    applicant_name?: string;
    job_title?: string;
    rut?: string;
    run?: string;
    entity_type?: string;
    industry?: string;
    billing_email?: string;
    website?: string;
    institution_website?: string;
    program_name?: string;
    graduation_date?: string;
    usage_profile?: string;
    address?: string;
    city?: string;
    commune?: string;
    region?: string;
    postal_code?: string;
    address_place_id?: string;
    phone?: string;
    position?: string;
    processedBy?: string;
    processedAt?: string;
    rejectionReason?: string;
    observations?: string;
    enabledPlugins?: string[];
    profile?: string;
    country?: string;
    email_domain?: string;
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
    const [confirmText, setConfirmText] = React.useState('');

    if (!tenant) return null;

    const getDisplayName = () => tenant.company_name || tenant.institution_name || tenant.full_name;
    const getIdNumber = () => tenant.rut || tenant.run || 'N/A';
    const getApplicantInfo = () => {
        const name = tenant.applicant_name || tenant.full_name;
        const job = tenant.job_title || tenant.position;
        return name ? `${name}${job ? ` / ${job}` : ''}` : 'N/A';
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
                        className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 transition-all duration-500"
                    />
                    <motion.div
                        className="fixed inset-0 flex items-center justify-center p-6 z-50 pointer-events-none"
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 30 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 30 }}
                            className="relative w-full max-w-3xl h-fit max-h-full elite-tech-surface !bg-white/90 dark:!bg-black/70 rounded-none shadow-3xl flex flex-col overflow-hidden border-white/20 dark:border-white/5 pointer-events-auto"
                        >
                            {/* Technical Grid Texture Over Modal */}
                            <div className="absolute inset-0 technical-grid pointer-events-none opacity-20 z-0"></div>

                            {/* Header */}
                            <div className="relative z-10 p-10 border-b border-black/5 dark:border-white/5 flex justify-between items-start">
                                <div className="flex gap-6">
                                    <div className={clsx(
                                        "w-16 h-16 rounded-none flex items-center justify-center text-3xl transition-all duration-500",
                                        tenant.type === 'ENTERPRISE' && "bg-blue-500/10 text-blue-500 border border-blue-500/20",
                                        tenant.type === 'EDUCATIONAL' && "bg-purple-500/10 text-purple-500 border border-purple-500/20",
                                        tenant.type === 'PERSONAL' && "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                                    )}>
                                        <span className="material-symbols-rounded text-[32px]">
                                            {tenant.type === 'ENTERPRISE' ? 'domain' : tenant.type === 'EDUCATIONAL' ? 'school' : 'person'}
                                        </span>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-3 mb-1">
                                            <div className="w-6 h-[1.5px] bg-antigravity-accent"></div>
                                            <span className="hud-label !text-antigravity-accent">{tenant.type}</span>
                                        </div>
                                        <h2 className="text-3xl font-black text-black dark:text-white leading-none uppercase tracking-tighter italic">
                                            {getDisplayName()}
                                        </h2>
                                        <div className="flex items-center gap-3 mt-3">
                                            <span className={clsx(
                                                "px-3 py-0.5 rounded-none text-[10px] font-black uppercase tracking-widest border",
                                                tenant.status === 'PENDING_APPROVAL' && "bg-amber-500/10 text-amber-600 border-amber-500/20",
                                                tenant.status === 'ACTIVE' && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                                                tenant.status === 'REJECTED' && "bg-rose-500/10 text-rose-600 border-rose-500/20"
                                            )}>
                                                {t(`admin.status.${tenant.status.toLowerCase().replace('_approval', '')}`)}
                                            </span>
                                            <span className="text-[10px] text-black/30 dark:text-white/30 font-mono tracking-widest font-black">
                                                HASH: {tenant.id.toUpperCase()}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <button onClick={onClose} className="w-12 h-12 flex items-center justify-center bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-none transition-all text-black/40 dark:text-white/40">
                                    <X size={24} />
                                </button>
                            </div>

                            {/* Body */}
                            <div className="relative z-10 p-10 overflow-y-auto space-y-12">

                                {/* Info Registry Section */}
                                <div className="space-y-10">
                                    <h3 className="hud-label !text-antigravity-accent tracking-[0.4em] flex items-center gap-3">
                                        <Info size={14} className="shrink-0" />
                                        Request Master Record
                                    </h3>

                                    <div className="grid grid-cols-2 gap-x-12 gap-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
                                        <div className="space-y-1.5 px-4 border-l-2 border-black/5 dark:border-white/5">
                                            <label className="text-[9px] font-black text-black/40 dark:text-white/30 uppercase tracking-[0.2em]">Entity Identity</label>
                                            <p className="text-sm font-black text-black dark:text-white tracking-tight uppercase leading-none">{getDisplayName()}</p>
                                            <p className="text-[11px] font-mono font-bold text-copper-500 tracking-widest mt-1 italic">{getIdNumber()}</p>
                                            {tenant.entity_type && (
                                                <span className="inline-block mt-2 px-2 py-0.5 bg-black/5 dark:bg-white/5 text-[8px] font-black uppercase tracking-widest border border-black/10 dark:border-white/10">
                                                    {tenant.entity_type}
                                                </span>
                                            )}
                                        </div>

                                        <div className="space-y-1.5 px-4 border-l-2 border-black/5 dark:border-white/5">
                                            <label className="text-[9px] font-black text-black/40 dark:text-white/30 uppercase tracking-[0.2em]">Authorized Applicant</label>
                                            <p className="text-sm font-black text-black dark:text-white tracking-tight leading-none uppercase">{getApplicantInfo()}</p>
                                            <div className="flex items-center gap-2 mt-2">
                                                <Mail size={10} className="text-antigravity-accent opacity-60" />
                                                <p className="text-[11px] font-bold text-antigravity-accent tracking-tighter italic">{tenant.email.toLowerCase()}</p>
                                            </div>
                                        </div>

                                        {/* Dynamic Fields per Type */}
                                        {tenant.type === 'ENTERPRISE' && (
                                            <>
                                                <div className="space-y-1.5 px-4 border-l-2 border-black/5 dark:border-white/5">
                                                    <label className="text-[9px] font-black text-black/40 dark:text-white/30 uppercase tracking-[0.2em]">Business Activity</label>
                                                    <div className="flex items-start gap-2">
                                                        <Activity size={12} className="mt-0.5 opacity-40 shrink-0" />
                                                        <p className="text-[11px] font-bold text-black/60 dark:text-white/60 leading-relaxed uppercase italic">
                                                            {tenant.industry || 'No_Giro_Specified'}
                                                        </p>
                                                    </div>
                                                    {tenant.email_domain && (
                                                        <p className="text-[9px] font-mono opacity-40 uppercase ml-5 tracking-widest mt-0.5">Authorized Domain: @{tenant.email_domain}</p>
                                                    )}
                                                </div>
                                                <div className="space-y-1.5 px-4 border-l-2 border-black/5 dark:border-white/5">
                                                    <label className="text-[9px] font-black text-black/40 dark:text-white/30 uppercase tracking-[0.2em]">Billing & Digital</label>
                                                    <div className="space-y-2">
                                                        {tenant.billing_email && (
                                                            <div className="flex items-center gap-2">
                                                                <FileText size={12} className="opacity-40" />
                                                                <span className="text-[10px] font-mono font-bold text-black/60 dark:text-white/60 italic lowercase">{tenant.billing_email}</span>
                                                            </div>
                                                        )}
                                                        {tenant.website && (
                                                            <div className="flex items-center gap-2">
                                                                <Globe size={12} className="opacity-40" />
                                                                <span className="text-[10px] font-mono font-bold text-antigravity-accent italic lowercase">{tenant.website}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        {tenant.type === 'EDUCATIONAL' && (
                                            <>
                                                <div className="space-y-1.5 px-4 border-l-2 border-black/5 dark:border-white/5">
                                                    <label className="text-[9px] font-black text-black/40 dark:text-white/30 uppercase tracking-[0.2em]">Academic Track</label>
                                                    <div className="flex items-start gap-2">
                                                        <GraduationCap size={12} className="mt-0.5 opacity-40 shrink-0" />
                                                        <div className="space-y-1">
                                                            <p className="text-[11px] font-bold text-black/60 dark:text-white/60 leading-relaxed uppercase italic">
                                                                {tenant.program_name || 'Program_Not_Specified'}
                                                            </p>
                                                            {tenant.profile && (
                                                                <span className="inline-block px-1.5 py-0.5 bg-antigravity-accent/10 text-antigravity-accent text-[8px] font-black uppercase tracking-widest border border-antigravity-accent/20">
                                                                    {tenant.profile}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {tenant.graduation_date && (
                                                        <p className="text-[9px] font-mono opacity-40 uppercase ml-5 tracking-widest mt-0.5">EST. Grad: {tenant.graduation_date}</p>
                                                    )}
                                                </div>
                                                <div className="space-y-1.5 px-4 border-l-2 border-black/5 dark:border-white/5">
                                                    <label className="text-[9px] font-black text-black/40 dark:text-white/30 uppercase tracking-[0.2em]">Institutional Access</label>
                                                    {tenant.institution_website && (
                                                        <div className="flex items-center gap-2">
                                                            <Globe size={12} className="opacity-40" />
                                                            <span className="text-[10px] font-mono font-bold text-antigravity-accent italic lowercase">{tenant.institution_website}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </>
                                        )}

                                        {tenant.type === 'PERSONAL' && tenant.usage_profile && (
                                            <div className="space-y-1.5 px-4 border-l-2 border-black/5 dark:border-white/5">
                                                <label className="text-[9px] font-black text-black/40 dark:text-white/30 uppercase tracking-[0.2em]">Usage Protocol</label>
                                                <p className="text-sm font-black text-black dark:text-white tracking-tight leading-none uppercase italic border border-black/10 dark:border-white/10 px-3 py-2 bg-black/5 dark:bg-white/5 inline-block">
                                                    {tenant.usage_profile}
                                                </p>
                                            </div>
                                        )}

                                        {/* Physical & Metadata */}
                                        <div className="space-y-1.5 px-4 border-l-2 border-black/5 dark:border-white/5">
                                            <label className="text-[9px] font-black text-black/40 dark:text-white/30 uppercase tracking-[0.2em]">Operational Geodata</label>
                                            <p className="text-[11px] font-bold text-black dark:text-white leading-relaxed uppercase italic">
                                                {tenant.address || 'Address_Not_Specified'}
                                            </p>
                                            <div className="flex flex-wrap gap-2 mt-2">
                                                {[tenant.country, tenant.commune, tenant.city, tenant.region, tenant.postal_code].filter(Boolean).map((loc, idx) => (
                                                    <span key={idx} className="px-1.5 py-0.5 bg-black/5 dark:bg-white/5 text-[8px] font-black uppercase text-black/40 dark:text-white/40 border border-black/5 dark:border-white/5 italic">
                                                        {loc}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="space-y-1.5 px-4 border-l-2 border-black/5 dark:border-white/5">
                                            <label className="text-[9px] font-black text-black/40 dark:text-white/30 uppercase tracking-[0.2em]">Protocol Attributes</label>
                                            <div className="flex flex-wrap gap-x-6 gap-y-3 mt-1">
                                                <div className="flex items-center gap-2">
                                                    <Calendar size={12} className="opacity-40" />
                                                    <span className="text-[10px] font-mono font-black text-black/60 dark:text-white/60 uppercase italic">
                                                        {new Date(tenant.createdAt._seconds ? tenant.createdAt._seconds * 1000 : tenant.createdAt).toLocaleDateString()}
                                                    </span>
                                                </div>
                                                {tenant.phone && (
                                                    <div className="flex items-center gap-2">
                                                        <Phone size={12} className="opacity-40" />
                                                        <span className="text-[10px] font-mono font-black text-black/60 dark:text-white/60 uppercase italic">{tenant.phone}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="h-px bg-black/5 dark:bg-white/5"></div>

                                {/* Traceability Section */}
                                <div className="space-y-8">
                                    <h3 className="hud-label !text-antigravity-accent tracking-[0.4em] flex items-center gap-3">
                                        <Activity className="shrink-0" size={14} />
                                        Security Traceability Log
                                    </h3>

                                    <div className="space-y-6 relative before:absolute before:inset-0 before:left-[11px] before:w-[2px] before:bg-black/5 dark:before:bg-white/5">
                                        {/* Action: Request */}
                                        <div className="relative pl-12 py-1">
                                            <div className="absolute left-0 top-[6px] w-6 h-6 rounded-none bg-blue-500 border-4 border-white dark:border-black shadow-lg" />
                                            <span className="text-[10px] font-mono font-black text-black/30 dark:text-white/20 tracking-tighter">
                                                {new Date(tenant.createdAt._seconds ? tenant.createdAt._seconds * 1000 : tenant.createdAt).toLocaleString()}
                                            </span>
                                            <p className="font-black text-black dark:text-white uppercase tracking-tight text-sm">System Entry Protocol</p>
                                            <p className="text-[11px] font-bold text-black/40 dark:text-white/40 mt-1 uppercase italic">Origin: Unified Public Registry [{tenant.type}]</p>
                                        </div>

                                        {/* Action: Validation / Process */}
                                        {tenant.status !== 'PENDING_APPROVAL' && (
                                            <div className="relative pl-12 py-1 animate-in slide-in-from-left-2 duration-700">
                                                <div className={clsx(
                                                    "absolute left-0 top-[6px] w-6 h-6 rounded-none border-4 border-white dark:border-black shadow-lg",
                                                    tenant.status === 'ACTIVE' ? "bg-emerald-500" : "bg-rose-500"
                                                )} />
                                                <span className="text-[10px] font-mono font-black text-black/30 dark:text-white/20 tracking-tighter">
                                                    {tenant.processedAt ? new Date(tenant.processedAt).toLocaleString() : 'AUTH_TIMESTAMP_MISSING'}
                                                </span>
                                                <p className="font-black text-black dark:text-white uppercase tracking-tight text-sm">
                                                    {tenant.status === 'ACTIVE' ? 'ACCESS_GRANTED' : 'ACCESS_DENIED'}
                                                </p>
                                                <div className="mt-3 space-y-2">
                                                    <div className="flex items-center gap-2 text-[10px] font-black text-black/40 dark:text-white/40 uppercase tracking-widest">
                                                        <Shield size={12} className="text-antigravity-accent" />
                                                        Validator: <span className="text-black dark:text-white">{tenant.processedBy || 'Master_Admin_Node'}</span>
                                                    </div>
                                                    {tenant.status === 'REJECTED' && (
                                                        <div className="p-4 glass-card border-rose-500/20 bg-rose-500/5 rounded-none">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <Info size={12} className="text-rose-500" />
                                                                <span className="text-[9px] font-black uppercase text-rose-500 tracking-widest">Rejection_Log:</span>
                                                            </div>
                                                            <p className="text-xs font-bold text-rose-600/80 leading-relaxed italic">"{tenant.rejectionReason || 'No_Reason_Specified'}"</p>
                                                        </div>
                                                    )}
                                                    {tenant.observations && (
                                                        <div className="p-4 glass-card border-black/10 bg-black/5 rounded-none">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <MessageSquare size={12} className="text-black/40 dark:text-white/40" />
                                                                <span className="text-[9px] font-black uppercase text-black/40 dark:text-white/40 tracking-widest">Internal_Notes:</span>
                                                            </div>
                                                            <p className="text-xs font-bold text-black/60 dark:text-white/60 leading-relaxed italic">"{tenant.observations}"</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Action Inputs (If Pending) */}
                                {tenant.status === 'PENDING_APPROVAL' && (
                                    <div className="p-1 glass-card bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/10 rounded-none overflow-hidden">
                                        <div className="p-8 space-y-6">
                                            <div className="flex items-center gap-3">
                                                <div className="w-2 h-2 rounded-none bg-antigravity-accent animate-ping"></div>
                                                <span className="hud-label tracking-[0.3em]">Decision Console</span>
                                            </div>
                                            <div className="space-y-6">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black text-black/40 dark:text-white/30 uppercase tracking-[0.2em]">Administrative Observations</label>
                                                    <textarea
                                                        value={observations}
                                                        onChange={(e) => setObservations(e.target.value)}
                                                        autoComplete="off"
                                                        placeholder="Input validation notes here..."
                                                        className="premium-input !rounded-none h-24 resize-none !py-4 transition-all focus:ring-4 focus:ring-antigravity-accent/5"
                                                    />
                                                </div>
                                                {isRejecting && (
                                                    <div className="space-y-4 animate-in zoom-in-95">
                                                        <div className="space-y-2">
                                                            <label className="text-[10px] font-black text-rose-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                                                <span>1. Mandatory Rejection Protocol</span>
                                                                <span className="text-[8px] px-2 py-0.5 bg-rose-500/10 rounded-full">Required</span>
                                                            </label>
                                                            <textarea
                                                                value={rejectionReason}
                                                                onChange={(e) => setRejectionReason(e.target.value)}
                                                                autoComplete="off"
                                                                placeholder="Specify rejection grounds for audit log..."
                                                                className="premium-input !rounded-none h-20 resize-none !py-4 border-rose-500/30 dark:border-rose-500/20 focus:border-rose-500 text-rose-600 focus:ring-4 focus:ring-rose-500/5"
                                                            />
                                                        </div>

                                                        <div className="space-y-2 p-4 border border-rose-500/20 bg-rose-500/5">
                                                            <label className="text-[10px] font-black text-rose-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                                                <span>2. Action Authorization</span>
                                                            </label>
                                                            <p className="text-[10px] text-rose-600/70 mb-2 leading-relaxed font-mono">
                                                                To proceed with access denial, type the word <strong className="text-rose-500 tracking-widest bg-rose-500/10 px-1 py-0.5">RECHAZAR</strong> below.
                                                            </p>
                                                            <input
                                                                type="text"
                                                                value={confirmText}
                                                                onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                                                                placeholder="RECHAZAR"
                                                                autoComplete="off"
                                                                className="premium-input !rounded-none !py-3 tracking-widest text-center font-black text-rose-500 focus:border-rose-500 focus:ring-rose-500/10 bg-white/50 dark:bg-black/50"
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Footer / Actions */}
                            {onAction && tenant.status === 'PENDING_APPROVAL' && (
                                <div className="relative z-10 p-10 border-t border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 flex flex-col md:flex-row justify-between gap-6 items-center">
                                    <div className="text-[9px] font-black text-black/40 dark:text-white/30 uppercase tracking-[0.2em] leading-relaxed max-w-xs">
                                        Protocol: Action will trigger automated email notification to the applicant node.
                                    </div>
                                    <div className="flex gap-4">
                                        <button
                                            onClick={() => {
                                                if (!isRejecting) {
                                                    setIsRejecting(true);
                                                    return;
                                                }
                                                if (!rejectionReason.trim()) {
                                                    alert('Protocol Error: Rejection reason is required.');
                                                    return;
                                                }
                                                if (confirmText !== 'RECHAZAR') {
                                                    alert('Protocol Error: You must type RECHAZAR to confirm the denial.');
                                                    return;
                                                }
                                                onAction(tenant.id, 'REJECTED', { rejectionReason, observations });
                                            }}
                                            className={clsx(
                                                "h-14 px-8 rounded-none font-black text-sm uppercase tracking-widest transition-all duration-500 flex items-center gap-3 shadow-premium",
                                                isRejecting
                                                    ? (rejectionReason.trim() && confirmText === 'RECHAZAR'
                                                        ? "bg-rose-600 text-white hover:bg-rose-700 hover:shadow-rose-600/30 translate-y-[-2px]"
                                                        : "bg-rose-500/20 text-rose-500/50 cursor-not-allowed")
                                                    : "bg-black/5 dark:bg-white/10 text-rose-600 border border-rose-500/20 hover:bg-rose-500/10"
                                            )}
                                            disabled={isRejecting && (!rejectionReason.trim() || confirmText !== 'RECHAZAR')}
                                        >
                                            <XIcon size={18} />
                                            {isRejecting ? 'Confirm_Denial' : 'Deny_Access'}
                                        </button>
                                        {!isRejecting && (
                                            <button
                                                onClick={() => onAction(tenant.id, 'ACTIVE', { observations })}
                                                className="h-14 px-10 rounded-none bg-black dark:bg-white text-white dark:text-black font-black text-sm uppercase tracking-widest hover:scale-105 active:scale-95 transition-all flex items-center gap-3 shadow-2xl hover:shadow-antigravity-accent/30"
                                            >
                                                <Check size={18} />
                                                Authorize_Node
                                            </button>
                                        )}
                                        {isRejecting && (
                                            <button
                                                onClick={() => {
                                                    setIsRejecting(false);
                                                    setConfirmText('');
                                                }}
                                                className="h-14 px-8 rounded-none border border-black/10 dark:border-white/10 text-black/40 dark:text-white/40 font-black text-sm uppercase tracking-widest hover:bg-black/5 transition-all"
                                            >
                                                Abort
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
