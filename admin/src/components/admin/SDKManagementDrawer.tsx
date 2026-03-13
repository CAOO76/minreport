import React, { useState, useEffect } from 'react';
import { X, Download, Send, CheckCircle, AlertCircle, Info, ShieldCheck, Cpu, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAdminSDK } from '../../hooks/useAdminSDK';
import { SDKVersion, SDKStatus } from '../../types/sdk-admin';
import { auth } from '../../config/firebase';
import { Timestamp } from 'firebase/firestore';
import clsx from 'clsx';

interface SDKManagementDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    selectedVersion: SDKVersion | null;
    updateVersionStatus: (id: string, newStatus: SDKStatus) => Promise<void>;
    onDownload: (version: SDKVersion) => void;
    isLoading: boolean;
}

/**
 * SDKManagementDrawer component for publishing new SDK versions 
 * and viewing details of existing ones. Refactored to Elite Industrial style.
 */
export const SDKManagementDrawer: React.FC<SDKManagementDrawerProps> = ({
    isOpen,
    onClose,
    selectedVersion,
    updateVersionStatus,
    onDownload,
    isLoading
}) => {
    const { publishVersion, error } = useAdminSDK();

    // Form state for new version
    const [versionNumber, setVersionNumber] = useState('');
    const [status, setStatus] = useState<SDKStatus>('BETA');
    const [changelog, setChangelog] = useState('');

    // Update state for existing version promotion
    const [promoting, setPromoting] = useState<SDKStatus | null>(null);

    // Reset/Sync form when drawer state changes
    useEffect(() => {
        if (isOpen) {
            if (!selectedVersion) {
                setVersionNumber('');
                setStatus('BETA');
                setChangelog('');
            } else {
                setPromoting(selectedVersion.status);
            }
        }
    }, [isOpen, selectedVersion]);

    const handlePublish = async (e: React.FormEvent) => {
        e.preventDefault();
        const user = auth.currentUser;
        if (!user) return;

        try {
            await publishVersion({
                versionNumber,
                status,
                changelog,
                createdBy: user.uid,
                downloadUrl: '',
                releaseDate: Timestamp.now()
            });
            onClose();
        } catch (err) {
            console.error('Error in publish flow:', err);
        }
    };

    const handleStatusUpdate = async (newStatus: SDKStatus) => {
        if (!selectedVersion) return;
        try {
            await updateVersionStatus(selectedVersion.id, newStatus);
            onClose();
        } catch (err) {
            console.error('Error updating status:', err);
        }
    };

    const isViewMode = !!selectedVersion;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop: covers only the content area, accounting for the 96px sidebar */}
                    <div
                        className="fixed inset-0 bg-black/50 z-[100]"
                        onClick={onClose}
                    />

                    <div
                        className="fixed inset-0 z-[101] flex items-center justify-center pointer-events-none"
                    >
                        <div
                            className="bg-white dark:bg-zinc-950 border border-black/10 dark:border-white/10 z-[101] flex flex-col overflow-hidden pointer-events-auto w-full max-w-xl max-h-[90vh] shadow-2xl"
                        >
                            <div className="p-8 border-b border-black/5 dark:border-white/5 flex justify-between items-center">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-8 h-[1px] bg-[#C68346]"></div>
                                        <span className="text-[10px] font-bold text-[#C68346] uppercase tracking-widest">INSPECTOR_SDK</span>
                                    </div>
                                    <h2 className="text-2xl font-bold text-black dark:text-white uppercase tracking-tighter m-0">
                                        {isViewMode ? `VERSIÓN_v${selectedVersion.versionNumber}` : 'DESPLEGAR_NUEVO_CORE'}
                                    </h2>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="p-2 text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-colors active:scale-90"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-8 relative z-10 custom-scrollbar">
                                {isViewMode ? (
                                    <div className="space-y-8">
                                        <div className="p-6 bg-slate-50 dark:bg-zinc-900/50 border border-black/5 dark:border-white/5 space-y-6">
                                            <div className="flex justify-between items-center">
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-[#C68346]">FASE_CICLO_VIDA</p>
                                                <span className={clsx(
                                                    "px-3 py-1 text-[9px] font-bold uppercase tracking-widest border",
                                                    selectedVersion.status === 'STABLE' && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                                                    selectedVersion.status === 'BETA' && "bg-amber-500/10 text-amber-600 border-amber-500/20",
                                                    selectedVersion.status === 'DEPRECATED' && "bg-rose-500/10 text-rose-600 border-rose-500/20"
                                                )}>
                                                    {selectedVersion.status}
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-3 gap-2">
                                                {(['BETA', 'STABLE', 'DEPRECATED'] as SDKStatus[]).map((s) => (
                                                    <button
                                                        key={s}
                                                        onClick={() => handleStatusUpdate(s)}
                                                        className={clsx(
                                                            "py-3 text-[9px] font-bold uppercase tracking-widest transition-all border",
                                                            selectedVersion.status === s
                                                                ? "bg-black dark:bg-white text-white dark:text-black border-transparent"
                                                                : "bg-transparent text-black/30 dark:text-white/20 border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5"
                                                        )}
                                                    >
                                                        {s}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <span className="text-[10px] font-bold text-black/30 dark:text-white/20 uppercase tracking-widest ml-1">LOGS_VALIDACIÓN_RELEASE</span>
                                            <div className="p-6 bg-slate-50 dark:bg-zinc-900/50 border border-black/5 dark:border-white/5 text-[11px] font-medium text-black/70 dark:text-white/50 tracking-wide leading-relaxed">
                                                {selectedVersion.changelog}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="p-6 bg-slate-50 dark:bg-zinc-900/50 border border-black/5 dark:border-white/5">
                                                <p className="text-[9px] font-bold text-black/30 dark:text-white/20 uppercase tracking-widest mb-2">TIMESTAMP_RELEASE</p>
                                                <p className="text-sm font-bold text-black dark:text-white font-mono">
                                                    {selectedVersion.releaseDate?.toDate().toLocaleString()}
                                                </p>
                                            </div>
                                            <div className="p-6 bg-slate-50 dark:bg-zinc-900/50 border border-black/5 dark:border-white/5">
                                                <p className="text-[9px] font-bold text-black/30 dark:text-white/20 uppercase tracking-widest mb-2">OPERADOR_ID</p>
                                                <p className="text-sm font-bold text-black dark:text-white font-mono truncate">
                                                    {selectedVersion.createdBy.toUpperCase()}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <form onSubmit={handlePublish} className="space-y-6" autoComplete="off">
                                        <div className="space-y-6">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold text-black/30 dark:text-white/20 uppercase tracking-widest ml-1">
                                                    IDENTIFICADOR_VERSIÓN_SEMÁNTICA
                                                </label>
                                                <input
                                                    type="text"
                                                    required
                                                    value={versionNumber}
                                                    onChange={(e) => setVersionNumber(e.target.value)}
                                                    placeholder="ej. 2.1.0-alpha"
                                                    className="w-full bg-slate-50 dark:bg-zinc-900 border border-black/10 dark:border-white/10 px-4 py-3 text-sm focus:border-[#C68346] outline-none transition-colors"
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold text-black/30 dark:text-white/20 uppercase tracking-widest ml-1">
                                                    ESTADO_PROTOCOLO
                                                </label>
                                                <select
                                                    value={status}
                                                    onChange={(e) => setStatus(e.target.value as SDKStatus)}
                                                    className="w-full bg-slate-50 dark:bg-zinc-900 border border-black/10 dark:border-white/10 px-4 py-3 text-sm focus:border-[#C68346] outline-none cursor-pointer uppercase font-bold"
                                                >
                                                    <option value="BETA">PHASE_BETA (Revisión_Interna)</option>
                                                    <option value="STABLE">PHASE_STABLE (Listo_Producción)</option>
                                                    <option value="DEPRECATED">PHASE_DEPRECATED (Legacy_Control)</option>
                                                </select>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold text-black/30 dark:text-white/20 uppercase tracking-widest ml-1">
                                                    ENTRADAS_LOG_VALIDACIÓN
                                                </label>
                                                <textarea
                                                    required
                                                    rows={6}
                                                    value={changelog}
                                                    onChange={(e) => setChangelog(e.target.value)}
                                                    placeholder="Describa los cambios críticos del despliegue..."
                                                    className="w-full bg-slate-50 dark:bg-zinc-900 border border-black/10 dark:border-white/10 px-4 py-3 text-sm focus:border-[#C68346] outline-none resize-none"
                                                />
                                            </div>
                                        </div>

                                        <button
                                            type="submit"
                                            disabled={isLoading}
                                            className="w-full py-4 bg-[#C68346] text-white font-bold text-[11px] uppercase tracking-widest flex items-center justify-center gap-3 transition-colors active:bg-[#b3733a] disabled:opacity-30"
                                        >
                                            {isLoading ? (
                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white animate-spin" />
                                            ) : (
                                                <>
                                                    <Send size={16} />
                                                    CONFIRMAR_BINARIO_A_CLOUD
                                                </>
                                            )}
                                        </button>
                                    </form>
                                )}
                            </div>

                            {isViewMode && (
                                <div className="p-8 border-t border-black/5 dark:border-white/5 bg-slate-50 dark:bg-zinc-900/30">
                                    <button
                                        onClick={() => onDownload(selectedVersion!)}
                                        disabled={selectedVersion.status === 'DEPRECATED' || isLoading}
                                        className={clsx(
                                            "w-full py-4 font-bold text-[11px] uppercase tracking-widest flex items-center justify-center gap-3 transition-colors shadow-sm",
                                            selectedVersion.status === 'DEPRECATED'
                                                ? "bg-rose-500/5 text-rose-500/30 cursor-not-allowed border border-rose-500/10"
                                                : "bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-100"
                                        )}
                                    >
                                        <Download size={16} />
                                        {selectedVersion.status === 'DEPRECATED' ? 'BLOQUEADO_POR_OBSOLESCENCIA' : 'DESCARGAR_PAQUETE_FIRMADO'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
};
