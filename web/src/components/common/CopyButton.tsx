import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CopyButtonProps {
    value: string;
    title?: string;
    className?: string;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
    value,
    title,
    className = ''
}) => {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);

    const baseTitle = title || t('core_common.copy_value', 'Copiar valor');
    const copiedTitle = t('core_common.copied', 'Copiado');

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
            title={copied ? copiedTitle : baseTitle}
            aria-label={copied ? copiedTitle : baseTitle}
            className={`bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer inline-flex items-center justify-center rounded-none shadow-none ${className}`}
        >
            <span className={`material-symbols-outlined text-[16px] select-none ${copied ? 'text-[#00AEEF]' : ''}`}>
                {copied ? 'check' : 'content_copy'}
            </span>
        </button>
    );
};

export default CopyButton;
