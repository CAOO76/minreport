import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDeleteDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    itemName: string;
    description?: string;
}

export const ConfirmDeleteDialog: React.FC<ConfirmDeleteDialogProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    itemName,
    description
}) => {
    const [confirmText, setConfirmText] = useState('');
    const isValid = confirmText === 'ELIMINAR';

    const handleConfirm = () => {
        if (isValid) {
            onConfirm();
            setConfirmText('');
            onClose();
        }
    };

    const handleClose = () => {
        setConfirmText('');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-[#0D0D0D] rounded-none shadow-2xl max-w-md w-full border border-gray-200 dark:border-white/10 animate-in zoom-in-95 duration-200 relative overflow-hidden">
                <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none"></div>
                {/* Header */}
                <div className="flex items-start justify-between p-6 border-b border-gray-200 dark:border-gray-800">
                    <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-none bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center flex-shrink-0 border border-red-500/20">
                            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-500" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                                {title}
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                Esta acción es irreversible
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6 relative z-10">
                    <div className="p-4 bg-red-500/5 dark:bg-red-500/10 rounded-none border border-red-500/20">
                        <p className="hud-label text-red-600/60 dark:text-red-500/60 mb-2">
                            [SECURITY_ALERT]
                        </p>
                        <p className="text-sm text-red-900 dark:text-red-200 font-medium">
                            {description || `Estás a punto de eliminar permanentemente:`}
                        </p>
                        <p className="text-sm text-red-600 dark:text-red-500 font-black mt-2 break-all uppercase tracking-tight">
                            {itemName}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <label className="hud-label text-gray-400 dark:text-white/40">
                            Para confirmar, escribe <span className="text-red-600 dark:text-red-500">ELIMINAR</span>
                        </label>
                        <input
                            type="text"
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            placeholder="ELIMINAR"
                            autoComplete="off"
                            spellCheck="false"
                            data-lpignore="true"
                            className="w-full px-4 py-3 rounded-none bg-black/5 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-red-500 transition-all font-mono text-center tracking-[0.2em]"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && isValid) {
                                    handleConfirm();
                                }
                            }}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-800">
                    <button
                        onClick={handleClose}
                        className="px-6 py-3 rounded-none bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-white/60 font-black text-[10px] uppercase tracking-[0.2em] hover:bg-gray-200 dark:hover:bg-white/10 transition-all active:scale-95"
                    >
                        [CANCEL_ACTION]
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!isValid}
                        className="px-6 py-3 rounded-none bg-red-600 text-white font-black text-[10px] uppercase tracking-[0.2em] hover:bg-red-700 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        PROCEED_DELETE
                    </button>
                </div>
            </div>
        </div>
    );
};
