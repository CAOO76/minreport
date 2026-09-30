import React, { useState } from 'react';

interface TenantDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    tenant: any;
    onAction?: (id: string, status: 'ACTIVE' | 'REJECTED', data?: any) => Promise<void>;
}

export const TenantDetailsModal: React.FC<TenantDetailsModalProps> = ({
    isOpen,
    onClose,
    tenant,
    onAction
}) => {
    const [isRejecting, setIsRejecting] = useState(false);
    const [rejectionReason, setRejectionReason] = useState('');
    const [confirmRejectKeyword, setConfirmRejectKeyword] = useState('');
    const [observations, setObservations] = useState('');

    if (!isOpen || !tenant) return null;

    const handleApprove = async () => {
        if (onAction) {
            await onAction(tenant.id, 'ACTIVE', { observations });
            onClose();
        }
    };

    const handleConfirmReject = async () => {
        if (!rejectionReason.trim()) return;
        if (confirmRejectKeyword !== 'RECHAZAR') return;
        if (onAction) {
            await onAction(tenant.id, 'REJECTED', { rejectionReason, observations });
            onClose();
        }
    };

    const formatTimestamp = (ts: any): string => {
        if (!ts) return '[No declarado]';
        if (typeof ts === 'string') return ts;
        if (typeof ts._seconds === 'number') return new Date(ts._seconds * 1000).toISOString();
        if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
        return String(ts);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] max-w-2xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
                {/* Cabecera */}
                <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0] dark:border-[#12151C]">
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[20px] text-[#C68346]">description</span>
                        <h2 className="text-sm font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                            Revisión Técnica de Solicitud
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="bg-transparent border-0 outline-none p-1 text-neutral-400 hover:text-[#0F172A] dark:hover:text-white transition-colors cursor-pointer"
                        title="Cerrar"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>

                {/* Datos de Solicitud */}
                <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div>
                        <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Tipo de Cuenta</dt>
                        <dd className="font-bold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5 font-mono">
                            {tenant.type === 'ENTERPRISE' ? 'B2B Corporativo' :
                             tenant.type === 'EDUCATIONAL' ? 'Institución Educativa' : 'Personal / Independiente'}
                        </dd>
                    </div>

                    <div>
                        <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">RUT / RUN</dt>
                        <dd className="font-mono tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                            {tenant.rut || tenant.run || '[No declarado]'}
                        </dd>
                    </div>

                    <div className="md:col-span-2">
                        <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Identificación / Razón Social</dt>
                        <dd className="text-sm font-bold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                            {tenant.company_name || tenant.institution_name || tenant.full_name || '[No declarado]'}
                        </dd>
                    </div>

                    <div>
                        <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Solicitante</dt>
                        <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                            {tenant.applicant_name || tenant.full_name || '[No declarado]'}
                            {tenant.job_title && <span className="text-[#8A93A6]"> ({tenant.job_title})</span>}
                        </dd>
                    </div>

                    <div>
                        <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Correo Electrónico</dt>
                        <dd className="font-mono text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                            {tenant.email}
                        </dd>
                    </div>

                    <div>
                        <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Domicilio / Ubicación</dt>
                        <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                            {tenant.address || tenant.city || tenant.region || '[No declarado]'}
                        </dd>
                    </div>

                    <div>
                        <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Fecha de Ingreso (UTC)</dt>
                        <dd className="font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                            {formatTimestamp(tenant.createdAt)}
                        </dd>
                    </div>
                </dl>

                {/* Sección de Rechazo */}
                {isRejecting ? (
                    <div className="p-4 border border-rose-500/20 bg-rose-500/5 space-y-3">
                        <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 text-xs font-bold font-mono uppercase">
                            <span className="material-symbols-outlined text-[16px]">warning</span>
                            <span>Motivo de Rechazo Requerido</span>
                        </div>

                        <textarea
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="Especifica el motivo técnico del rechazo..."
                            className="w-full p-2.5 bg-white dark:bg-[#030406] border border-[#E2E8F0] dark:border-[#12151C] text-xs text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none resize-none h-16"
                            autoFocus
                        />

                        <div className="space-y-1">
                            <label className="block text-[11px] font-mono text-[#8A93A6]">
                                Escribe <span className="font-bold text-rose-600">"RECHAZAR"</span> para confirmar:
                            </label>
                            <input
                                type="text"
                                value={confirmRejectKeyword}
                                onChange={(e) => setConfirmRejectKeyword(e.target.value.toUpperCase())}
                                placeholder="RECHAZAR"
                                className="w-full px-3 py-1.5 bg-white dark:bg-[#030406] border border-rose-500/30 text-xs font-mono tracking-widest text-rose-600 outline-none"
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                onClick={() => { setIsRejecting(false); setConfirmRejectKeyword(''); }}
                                className="px-3 py-1.5 text-xs font-mono bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6]"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmReject}
                                disabled={!rejectionReason.trim() || confirmRejectKeyword !== 'RECHAZAR'}
                                className="px-4 py-1.5 text-xs font-mono bg-rose-600 text-white disabled:opacity-30"
                            >
                                Confirmar Rechazo
                            </button>
                        </div>
                    </div>
                ) : (
                    /* Acciones Normales para Solicitudes Pendientes */
                    onAction && tenant.status === 'PENDING_APPROVAL' && (
                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E2E8F0] dark:border-[#12151C]">
                            <button
                                onClick={() => setIsRejecting(true)}
                                className="px-3 py-1.5 text-xs font-mono bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                            >
                                Rechazar Solicitud
                            </button>
                            <button
                                onClick={handleApprove}
                                className="px-4 py-1.5 text-xs font-mono bg-[#C68346] text-white hover:opacity-90 transition-opacity"
                            >
                                Aprobar Cuenta
                            </button>
                        </div>
                    )
                )}
            </div>
        </div>
    );
};
