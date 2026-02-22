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
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/40 backdrop-blur-xl z-[100]"
                    />

                    {/* Drawer */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 30, stiffness: 200 }}
                        className="fixed right-0 top-0 h-screen w-full max-w-xl elite-tech-surface border-l border-white/10 z-[101] flex flex-col shadow-antigravity-accent/10 shadow-2xl overflow-hidden"
                    >
                        <div className="absolute inset-0 technical-grid pointer-events-none opacity-20"></div>

                        {/* Header */}
                        <div className="p-10 border-b border-white/5 flex justify-between items-center relative z-10">
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-8 h-[1px] bg-antigravity-accent"></div>
                                    <span className="hud-label !text-antigravity-accent uppercase">Component_Inspector</span>
                                </div>
                                <h2 className="text-3xl font-black text-black dark:text-white uppercase tracking-tighter italic m-0">
                                    {isViewMode ? `Release_v${selectedVersion.versionNumber}` : 'Deploy_New_Core'}
                                </h2>
                            </div>
                            <button
                                onClick={onClose}
                                className="w-12 h-12 rounded-none bg-black/5 dark:bg-white/5 hover:bg-antigravity-accent hover:text-white flex items-center justify-center text-black/40 dark:text-white/40 transition-all active:scale-90"
                            >
                                <X size={24} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-10 relative z-10 custom-scrollbar">
                            {error && (
                                <div className="mb-10 p-6 glass-card border-rose-500/20 bg-rose-500/[0.05] rounded-none flex items-start gap-4 text-rose-600">
                                    <AlertCircle size={20} className="shrink-0 mt-1" />
                                    <div>
                                        <p className="hud-label !text-rose-500 mb-2">Protocol_Error_0xsdk</p>
                                        <p className="text-xs font-bold uppercase tracking-widest leading-relaxed">{error}</p>
                                    </div>
                                </div>
                            )}

                            {isViewMode ? (
                                <div className="space-y-12">
                                    {/* Lifecycle Promotion Control */}
                                    <div className="p-10 rounded-none bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-8 relative overflow-hidden group">
                                        <div className="absolute inset-0 technical-grid opacity-10 pointer-events-none"></div>
                                        <div className="flex justify-between items-center relative z-10">
                                            <p className="hud-label flex items-center gap-2">
                                                <Zap size={14} className="text-antigravity-accent" />
                                                LIFECYCLE_PHASE_UPDATE
                                            </p>
                                            <span className={clsx(
                                                "px-4 py-1.5 rounded-none text-[9px] font-black uppercase tracking-[0.2em] border shadow-sm transition-all duration-700",
                                                selectedVersion.status === 'STABLE' && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                                                selectedVersion.status === 'BETA' && "bg-amber-500/10 text-amber-600 border-amber-500/20",
                                                selectedVersion.status === 'DEPRECATED' && "bg-rose-500/10 text-rose-600 border-rose-500/20"
                                            )}>
                                                {selectedVersion.status}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-3 gap-3 relative z-10">
                                            {(['BETA', 'STABLE', 'DEPRECATED'] as SDKStatus[]).map((s) => (
                                                <button
                                                    key={s}
                                                    onClick={() => handleStatusUpdate(s)}
                                                    className={clsx(
                                                        "py-4 rounded-none text-[9px] font-black uppercase tracking-[0.2em] transition-all border italic shadow-sm",
                                                        selectedVersion.status === s
                                                            ? "bg-black dark:bg-white text-white dark:text-black border-transparent shadow-premium"
                                                            : "bg-black/5 dark:bg-white/5 text-black/30 dark:text-white/20 border-transparent hover:bg-black/10 dark:hover:bg-white/10"
                                                    )}
                                                >
                                                    {s}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <span className="hud-label !text-black/30 dark:!text-white/20 ml-2">Release_Validation_Manifest</span>
                                        <div className="p-8 rounded-[32px] bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 text-[11px] font-bold text-black/60 dark:text-white/40 uppercase tracking-widest leading-relaxed italic">
                                            {selectedVersion.changelog}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-8">
                                        <div className="p-8 rounded-none bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
                                            <p className="hud-label !text-black/30 dark:!text-white/20 mb-3">Release_Timestamp</p>
                                            <p className="text-xl font-black text-black dark:text-white font-mono italic">
                                                {selectedVersion.releaseDate?.toDate().toLocaleString()}
                                            </p>
                                        </div>
                                        <div className="p-8 rounded-[32px] bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
                                            <p className="hud-label !text-black/30 dark:!text-white/20 mb-3">Operator_Identity</p>
                                            <p className="text-xl font-black text-black dark:text-white font-mono italic truncate">
                                                {selectedVersion.createdBy.substring(0, 10).toUpperCase()}...
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <form onSubmit={handlePublish} className="space-y-10" autoComplete="off">
                                    <div className="space-y-8">
                                        {/* Version Number */}
                                        <div className="space-y-3 px-1">
                                            <label className="hud-label !text-black/30 dark:!text-white/20 ml-1">
                                                Semantic_Version_Identifier
                                            </label>
                                            <input
                                                type="text"
                                                required
                                                value={versionNumber}
                                                onChange={(e) => setVersionNumber(e.target.value)}
                                                placeholder="e.g. 2.4.8-industrial"
                                                className="premium-input !py-6"
                                            />
                                        </div>

                                        {/* Status */}
                                        <div className="space-y-3 px-1">
                                            <label className="hud-label !text-black/30 dark:!text-white/20 ml-1">
                                                Protocol_Status
                                            </label>
                                            <div className="relative group">
                                                <select
                                                    value={status}
                                                    onChange={(e) => setStatus(e.target.value as SDKStatus)}
                                                    className="premium-input !py-6 appearance-none cursor-pointer uppercase italic font-black"
                                                >
                                                    <option value="BETA">PHASE_BETA (Internal_Review)</option>
                                                    <option value="STABLE">PHASE_STABLE (Deployment_Ready)</option>
                                                    <option value="DEPRECATED">PHASE_DEPRECATED (Legacy_Control)</option>
                                                </select>
                                                <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none opacity-40 group-hover:opacity-100 transition-opacity">
                                                    <Zap size={14} className="text-antigravity-accent" />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Changelog */}
                                        <div className="space-y-3 px-1">
                                            <label className="hud-label !text-black/30 dark:!text-white/20 ml-1">
                                                Validation_Log_Entries
                                            </label>
                                            <textarea
                                                required
                                                rows={10}
                                                value={changelog}
                                                onChange={(e) => setChangelog(e.target.value)}
                                                placeholder="Inject core modifications manifest..."
                                                className="premium-input !py-6 !h-64 resize-none !px-8 placeholder:italic"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isLoading}
                                        className="w-full py-6 rounded-none bg-antigravity-accent text-white font-black text-[11px] uppercase tracking-[0.4em] flex items-center justify-center gap-4 shadow-premium hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-30 italic"
                                    >
                                        {isLoading ? (
                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        ) : (
                                            <>
                                                <Send size={18} />
                                                Commit_Binary_to_Cloud
                                            </>
                                        )}
                                    </button>
                                </form>
                            )}
                        </div>

                        {/* Footer - Only in View Mode */}
                        {isViewMode && (
                            <div className="p-10 border-t border-white/5 bg-black/5 dark:bg-white/[0.02]">
                                <button
                                    onClick={() => onDownload(selectedVersion!)}
                                    disabled={selectedVersion.status === 'DEPRECATED' || isLoading}
                                    className={clsx(
                                        "w-full py-6 rounded-none font-black text-[11px] uppercase tracking-[0.4em] flex items-center justify-center gap-4 transition-all italic shadow-2xl",
                                        selectedVersion.status === 'DEPRECATED'
                                            ? "bg-rose-500/10 text-rose-500/30 border border-rose-500/10 cursor-not-allowed"
                                            : "bg-black dark:bg-white text-white dark:text-black hover:scale-[1.02] active:scale-95"
                                    )}
                                >
                                    <Download size={18} />
                                    {selectedVersion.status === 'DEPRECATED' ? 'Binary_Locked_Deprecation' : 'Extract_Signed_Package'}
                                </button>
                                <p className="text-[9px] text-center text-black/20 dark:text-white/20 mt-6 uppercase font-black tracking-[0.3em] font-mono italic">
                                    {selectedVersion.status === 'DEPRECATED'
                                        ? 'Integrity Violation: Access Revoked for Outdated Core.'
                                        : 'Generating technical manifest digest...'}
                                </p>
                            </div>
                        )}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
