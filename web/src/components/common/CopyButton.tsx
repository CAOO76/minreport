import React, { useState } from 'react';

interface CopyButtonProps {
    value: string;
    title?: string;
    className?: string;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
    value,
    title = 'Copiar valor',
    className = ''
}) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch {
            // Fallback silencioso si el navegador bloquea clipboard API
        }
    };

    return (
        <button
            type="button"
            onClick={handleCopy}
            title={copied ? 'Copiado' : title}
            aria-label={copied ? 'Copiado' : title}
            className={`bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer inline-flex items-center justify-center rounded-none shadow-none ${className}`}
        >
            <span className={`material-symbols-outlined text-[16px] select-none ${copied ? 'text-[#00AEEF]' : ''}`}>
                {copied ? 'check' : 'content_copy'}
            </span>
        </button>
    );
};

export default CopyButton;
