import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    action: 'DELETE' | 'SUSPEND';
    targetName?: string;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, onClose, onConfirm, action, targetName }) => {
    const [confirmationText, setConfirmationText] = useState('');
    const requiredText = action === 'DELETE' ? 'ELIMINAR' : 'SUSPENDER';
    const isMatched = confirmationText === requiredText;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
            <div className="bg-white dark:bg-[#1A1A1A] rounded-none shadow-none max-w-md w-full overflow-hidden border border-black dark:border-white/10 animate-scale-in relative">
                <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none"></div>

                {/* Header de Peligro */}
                <div className="bg-red-500/10 dark:bg-red-500/10 px-6 py-6 border-b border-red-500/20 flex items-center gap-4 relative z-10">
                    <div className="p-3 bg-red-500 text-white rounded-none">
                        <AlertTriangle size={24} />
                    </div>
                    <div>
                        <h3 className="hud-label text-red-600 dark:text-red-400">
                            {action === 'DELETE' ? 'SYSTEM_PURGE' : 'SYSTEM_SUSPENSION'}
                        </h3>
                        <p className="hud-label text-[9px] opacity-60 mt-1">CONFIRMATION_REQUIRED</p>
                    </div>
                </div>

                <div className="p-8 space-y-6 relative z-10">
                    <p className="text-[13px] text-black/60 dark:text-white/60 font-medium leading-relaxed">
                        ESTA OPERACIÓN ES CRÍTICA. ESTÁ A PUNTO DE <strong className="text-black dark:text-white">{action === 'DELETE' ? 'ELIMINAR PERMANENTEMENTE' : 'SUSPENDER EL ACCESO'}</strong> A LA CUENTA: <span className="font-mono bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded-none border border-black/5 dark:border-white/10 uppercase">{targetName || 'UNKNOWN_TARGET'}</span>.
                    </p>

                    {action === 'DELETE' && (
                        <div className="hud-label text-[9px] bg-red-500 text-white p-4 rounded-none border border-red-600">
                            WARNING: ESTA ACCIÓN BORRARÁ TODOS LOS DATOS, USUARIOS Y REGISTROS HISTÓRICOS. IRREVERSIBLE.
                        </div>
                    )}

                    <div className="space-y-3 pt-2">
                        <label className="hud-label text-[9px] opacity-40">
                            INPUT_KEY_CODE: <span className="text-black dark:text-white">"{requiredText}"</span>
                        </label>
                        <input
                            type="text"
                            value={confirmationText}
                            onChange={(e) => setConfirmationText(e.target.value)}
                            placeholder={requiredText}
                            autoComplete="off"
                            spellCheck="false"
                            data-lpignore="true"
                            className="w-full px-5 py-4 rounded-none bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 focus:border-red-500 outline-none transition-all font-black text-center tracking-[0.5em] uppercase placeholder:opacity-20"
                            autoFocus
                        />
                    </div>
                </div>

                <div className="px-8 py-6 bg-black/5 dark:bg-white/5 border-t border-black/5 dark:border-white/5 flex justify-end gap-4 relative z-10">
                    <button
                        onClick={onClose}
                        className="hud-label text-[10px] opacity-40 hover:opacity-100 transition-opacity"
                    >
                        ABORT_ACTION
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={!isMatched}
                        className={clsx(
                            "px-8 py-3 rounded-none hud-label text-[10px] transition-all",
                            isMatched
                                ? "bg-red-600 text-white hover:bg-red-700"
                                : "bg-black/10 dark:bg-white/10 text-black/20 dark:text-white/10 cursor-not-allowed"
                        )}
                    >
                        {action === 'DELETE' ? 'COMMIT_PURGE' : 'COMMIT_SUSPENSION'}
                    </button>
                </div>
            </div>
        </div>
    );
};

import clsx from 'clsx';
