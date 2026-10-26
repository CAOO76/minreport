import React from 'react';
import { M3Button } from './M3Button';

interface M3ConfirmModalProps {
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export const M3ConfirmModal: React.FC<M3ConfirmModalProps> = ({
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel
}) => {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white dark:bg-[#0a0a0a] border border-black/10 dark:border-white/10 p-8 max-w-md w-full rounded-none space-y-6 animate-in zoom-in-95 duration-300">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="w-1 h-3 bg-copper"></span>
                        <h3 className="text-sm font-black uppercase tracking-widest text-black/40 dark:text-white/30">
                            {title}
                        </h3>
                    </div>
                    <p className="text-lg font-black text-black dark:text-white uppercase leading-tight">
                        {description}
                    </p>
                </div>

                <div className="flex gap-3 pt-4">
                    <M3Button variant="ghost" onClick={onCancel} className="flex-1">
                        {cancelLabel}
                    </M3Button>
                    <M3Button variant="primary" onClick={onConfirm} className="flex-1">
                        {confirmLabel}
                    </M3Button>
                </div>
            </div>
        </div>
    );
};
