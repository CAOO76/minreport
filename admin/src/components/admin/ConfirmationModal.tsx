import React, { useState } from 'react';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    action: 'DELETE' | 'SUSPEND' | 'ACTIVATE';
    targetName?: string;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    action,
    targetName
}) => {
    const [keyword, setKeyword] = useState('');

    if (!isOpen) return null;

    const requiredText = action === 'DELETE' ? 'ELIMINAR' : action === 'SUSPEND' ? 'SUSPENDER' : 'ACTIVAR';
    const isMatched = keyword === requiredText;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] max-w-md w-full p-6 space-y-4">
                <div className="flex items-center gap-2 text-[#0F172A] dark:text-[#F3F4F6]">
                    <span className={`material-symbols-outlined text-[20px] ${action === 'DELETE' ? 'text-rose-500' : 'text-amber-500'}`}>
                        warning
                    </span>
                    <h3 className="text-sm font-bold uppercase tracking-wider font-mono">
                        {action === 'DELETE' ? 'Confirmar Eliminación' : action === 'SUSPEND' ? 'Confirmar Suspensión' : 'Confirmar Activación'}
                    </h3>
                </div>

                <p className="text-xs text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                    Operación crítica sobre la cuenta: <strong className="text-[#0F172A] dark:text-[#F3F4F6] font-mono">{targetName || 'Registro seleccionado'}</strong>.
                    {action === 'DELETE'
                        ? ' Se borrarán de forma irreversible los accesos y registros asociados.'
                        : action === 'SUSPEND'
                        ? ' Se suspenderá el acceso operativo de todos sus usuarios vinculados.'
                        : ' Se restablecerá el acceso de los usuarios vinculados a los módulos habilitados.'}
                </p>

                <div className="space-y-1.5">
                    <label className="block text-[11px] font-mono text-[#8A93A6]">
                        Escribe <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">"{requiredText}"</span> para autorizar:
                    </label>
                    <input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value.toUpperCase())}
                        placeholder={requiredText}
                        className="w-full px-3 py-2 bg-[#F8FAFC] dark:bg-[#030406] border border-[#E2E8F0] dark:border-[#12151C] text-xs font-mono tracking-widest text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                        autoFocus
                    />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E2E8F0] dark:border-[#12151C]">
                    <button
                        onClick={onClose}
                        className="px-3 py-1.5 text-xs font-mono bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-white transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={!isMatched}
                        className={`px-4 py-1.5 text-xs font-mono transition-opacity ${
                            action === 'DELETE'
                                ? 'bg-rose-600 text-white disabled:opacity-30'
                                : 'bg-[#C68346] text-white disabled:opacity-30'
                        }`}
                    >
                        Confirmar
                    </button>
                </div>
            </div>
        </div>
    );
};
