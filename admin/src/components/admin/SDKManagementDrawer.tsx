import React, { useState, useEffect } from 'react';
import { X, Download, Send, CheckCircle, AlertCircle } from 'lucide-react';
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
 * and viewing details of existing ones.
 */
export const SDKManagementDrawer: React.FC<SDKManagementDrawerProps> = ({
    isOpen,
    onClose,
    selectedVersion,
    updateVersionStatus,
    onDownload,
    isLoading
}) => {
    const { publishVersion, error } = useAdminSDK(); // publishVersion still needed for new releases if applicable, but we are using AutoSync mostly. 
    // Actually, let's just pass everything from SDKPage for consistency.

    // Form state for new version
    const [versionNumber, setVersionNumber] = useState('');
    const [status, setStatus] = useState<SDKStatus>('BETA'); // Default to BETA for safety
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
                downloadUrl: '', // Simulated
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
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-40"
                    />

                    {/* Drawer */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed right-0 top-0 h-screen w-full max-w-md bg-white border-l border-[#E5E7EB] z-50 flex flex-col shadow-xl font-['Atkinson_Hyperlegible']"
                    >
                        {/* Header */}
                        <div className="p-6 border-b border-[#E5E7EB] flex justify-between items-center bg-slate-50/50">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                                    {isViewMode ? `Detalles Versión` : 'Publicar Nueva Versión'}
                                </h2>
                                <p className="text-xs text-slate-500 mt-1">
                                    {isViewMode ? 'Información técnica del release' : 'Registra un nuevo lanzamiento del SDK'}
                                </p>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-6">
                            {error && (
                                <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-xl flex items-start gap-3 text-rose-600 text-sm">
                                    <AlertCircle size={18} className="shrink-0" />
                                    <p>{error}</p>
                                </div>
                            )}

                            {isViewMode ? (
                                <div className="space-y-6">
                                    {/* Info Cards */}
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Lanzamiento</p>
                                            <h3 className="text-2xl font-black text-slate-900 italic">v{selectedVersion.versionNumber}</h3>
                                        </div>
                                        <span className={clsx(
                                            "inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide",
                                            selectedVersion.status === 'STABLE' && "bg-emerald-600 text-white",
                                            selectedVersion.status === 'BETA' && "bg-yellow-400 text-black",
                                            selectedVersion.status === 'DEPRECATED' && "bg-slate-400 text-white"
                                        )}>
                                            {selectedVersion.status}
                                        </span>
                                    </div>

                                    {/* Lifecycle Promotion Control */}
                                    <div className="p-5 rounded-2xl bg-antigravity-accent/5 border border-antigravity-accent/10 space-y-4">
                                        <p className="text-[10px] font-black text-antigravity-accent uppercase tracking-widest flex items-center gap-2">
                                            <CheckCircle size={12} />
                                            Ciclo de Vida (Lifecycle)
                                        </p>
                                        <div className="space-y-3">
                                            <label className="text-[10px] font-bold text-slate-500 uppercase">Cambiar Estado (Promoción)</label>
                                            <div className="grid grid-cols-3 gap-2">
                                                {(['BETA', 'STABLE', 'DEPRECATED'] as SDKStatus[]).map((s) => (
                                                    <button
                                                        key={s}
                                                        onClick={() => handleStatusUpdate(s)}
                                                        className={clsx(
                                                            "py-2 rounded-lg text-[10px] font-bold uppercase transition-all border",
                                                            selectedVersion.status === s
                                                                ? "bg-slate-900 text-white border-transparent"
                                                                : "bg-white text-slate-400 border-slate-200 hover:border-slate-400"
                                                        )}
                                                    >
                                                        {s}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-5 rounded-2xl bg-slate-50 border border-[#E5E7EB]">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Changelog / Cambios</p>
                                        <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed font-medium">
                                            {selectedVersion.changelog}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-4 rounded-xl border border-slate-100 bg-white shadow-sm">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fecha</p>
                                            <p className="text-sm font-bold text-slate-900 mt-1">
                                                {selectedVersion.releaseDate?.toDate().toLocaleString()}
                                            </p>
                                        </div>
                                        <div className="p-4 rounded-xl border border-slate-100 bg-white shadow-sm">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Autor (UID)</p>
                                            <p className="text-sm font-bold text-slate-900 mt-1 truncate">
                                                {selectedVersion.createdBy.substring(0, 10)}...
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <form onSubmit={handlePublish} className="space-y-6">
                                    <div className="space-y-4">
                                        {/* Version Number */}
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                                Número de Versión
                                            </label>
                                            <input
                                                type="text"
                                                required
                                                value={versionNumber}
                                                onChange={(e) => setVersionNumber(e.target.value)}
                                                placeholder="Ej: 1.0.2"
                                                className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] outline-none transition-all font-bold text-slate-900 placeholder:text-slate-300"
                                            />
                                        </div>

                                        {/* Status */}
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                                Estado del Release
                                            </label>
                                            <select
                                                value={status}
                                                onChange={(e) => setStatus(e.target.value as SDKStatus)}
                                                className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] focus:border-[#111827] outline-none transition-all font-bold text-slate-900 bg-white appearance-none"
                                            >
                                                <option value="BETA">BETA (En desarrollo)</option>
                                                <option value="STABLE">STABLE (Producción)</option>
                                                <option value="DEPRECATED">DEPRECATED (Obsoleta)</option>
                                            </select>
                                        </div>

                                        {/* Changelog */}
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                                Notas del Cambio (Changelog)
                                            </label>
                                            <textarea
                                                required
                                                rows={8}
                                                value={changelog}
                                                onChange={(e) => setChangelog(e.target.value)}
                                                placeholder="Describe las mejoras, correcciones y nuevas funcionalidades..."
                                                className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] focus:border-[#111827] outline-none transition-all font-medium text-slate-700 leading-relaxed resize-none"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isLoading}
                                        className="w-full py-4 rounded-xl bg-[#111827] text-white font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
                                    >
                                        {isLoading ? (
                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        ) : (
                                            <>
                                                <Send size={18} />
                                                Publicar Release
                                            </>
                                        )}
                                    </button>
                                </form>
                            )}
                        </div>

                        {/* Footer - Only in View Mode */}
                        {isViewMode && (
                            <div className="p-6 border-t border-[#E5E7EB] bg-slate-50/50">
                                <button
                                    onClick={() => onDownload(selectedVersion!)}
                                    disabled={selectedVersion.status === 'DEPRECATED' || isLoading}
                                    className={clsx(
                                        "w-full py-4 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-2 transition-all",
                                        selectedVersion.status === 'DEPRECATED'
                                            ? "bg-slate-200 cursor-not-allowed opacity-50"
                                            : "bg-[#111827] hover:opacity-90 active:scale-[0.98]"
                                    )}
                                >
                                    <Download size={18} />
                                    {selectedVersion.status === 'DEPRECATED' ? 'Versión Obsoleta (Bloqueado)' : 'Descargar Paquete SDK'}
                                </button>
                                <p className="text-[9px] text-center text-slate-400 mt-4 uppercase font-black tracking-widest">
                                    {selectedVersion.status === 'DEPRECATED'
                                        ? 'Esta versión ya no se distribuye.'
                                        : 'Generando archivo JSON firmado...'}
                                </p>
                            </div>
                        )}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
