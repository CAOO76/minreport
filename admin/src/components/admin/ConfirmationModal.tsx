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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 dark:border-slate-800 animate-scale-in">

                {/* Header de Peligro */}
                <div className="bg-rose-50 dark:bg-rose-900/20 px-6 py-4 border-b border-rose-100 dark:border-rose-800 flex items-center gap-3">
                    <div className="p-2 bg-rose-100 dark:bg-rose-900/40 rounded-full text-rose-600 dark:text-rose-400">
                        <AlertTriangle size={24} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-rose-700 dark:text-rose-400">
                            {action === 'DELETE' ? 'Eliminar Cuenta' : 'Suspender Cuenta'}
                        </h3>
                        <p className="text-xs text-rose-600/80 dark:text-rose-400/80">Esta acción requiere confirmación explícita.</p>
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                        Estás a punto de <strong>{action === 'DELETE' ? 'eliminar permanentemente' : 'suspender el acceso'}</strong> a la cuenta de <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">{targetName || 'Desconocido'}</span>.
                    </p>

                    {action === 'DELETE' && (
                        <div className="text-xs bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200 p-3 rounded-lg border border-rose-100 dark:border-rose-800/50">
                            ⚠️ Esta acción borrará todos los datos asociados, usuarios y registros históricos. <strong>No se puede deshacer.</strong>
                        </div>
                    )}

                    <div className="space-y-2 pt-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Escribe <span className="select-all font-mono text-slate-900 dark:text-white">"{requiredText}"</span> para confirmar
                        </label>
                        <input
                            type="text"
                            value={confirmationText}
                            onChange={(e) => setConfirmationText(e.target.value)}
                            placeholder={requiredText}
                            className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border-2 border-slate-200 dark:border-slate-800 focus:border-rose-500 dark:focus:border-rose-500 outline-none transition-all font-bold text-center tracking-widest uppercase placeholder:text-slate-300 dark:placeholder:text-slate-700"
                            autoFocus
                        />
                    </div>
                </div>

                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={!isMatched}
                        className={clsx(
                            "px-6 py-2 rounded-xl text-sm font-bold text-white shadow-lg transition-all transform active:scale-95",
                            isMatched
                                ? "bg-rose-600 hover:bg-rose-700 shadow-rose-500/20"
                                : "bg-slate-300 dark:bg-slate-800 cursor-not-allowed opacity-50"
                        )}
                    >
                        {action === 'DELETE' ? 'Sí, Eliminar' : 'Sí, Suspender'}
                    </button>
                </div>
            </div>
        </div>
    );
};

import clsx from 'clsx';
