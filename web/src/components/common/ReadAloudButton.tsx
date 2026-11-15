import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveNormalizedLang } from '../../i18n';

export interface ReadAloudButtonProps {
    text: string;
    compact?: boolean;
    showSpeedToggle?: boolean;
    className?: string;
}

export const ReadAloudButton: React.FC<ReadAloudButtonProps> = ({
    text,
    compact = false,
    showSpeedToggle = true,
    className = '',
}) => {
    const { t, i18n } = useTranslation();
    const [speaking, setSpeaking] = useState(false);
    const [slowRate, setSlowRate] = useState(false);

    const speechSupported =
        typeof window !== 'undefined' &&
        'speechSynthesis' in window &&
        typeof SpeechSynthesisUtterance !== 'undefined';

    const stopSpeech = useCallback(() => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            try {
                window.speechSynthesis.cancel();
            } catch {
                // Ignorar en entornos restringidos
            }
        }
        setSpeaking(false);
    }, []);

    useEffect(() => {
        return () => {
            if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                try {
                    window.speechSynthesis.cancel();
                } catch {
                    // Ignorar al desmontar
                }
            }
        };
    }, []);

    if (!speechSupported || !text.trim()) {
        return null;
    }

    const handleToggleSpeech = () => {
        if (speaking) {
            stopSpeech();
            return;
        }

        const cleanText = text.replace(/\s+/g, ' ').trim();
        if (!cleanText) return;

        try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(cleanText);
            const baseLang = resolveNormalizedLang(i18n.resolvedLanguage || i18n.language);
            utterance.lang = baseLang === 'en' ? 'en-US' : baseLang === 'pt' ? 'pt-BR' : 'es-CL';
            utterance.rate = slowRate ? 0.85 : 1.0;

            utterance.onend = () => setSpeaking(false);
            utterance.onerror = () => setSpeaking(false);

            setSpeaking(true);
            window.speechSynthesis.speak(utterance);
        } catch {
            setSpeaking(false);
        }
    };

    const actionTitle = speaking
        ? t('core_read_aloud.stop_label', 'Detener lectura')
        : t('core_read_aloud.play_label', 'Escuchar en voz alta');

    return (
        <div className={`inline-flex items-center gap-fib-8 select-none ${className}`}>
            <button
                type="button"
                onClick={handleToggleSpeech}
                aria-label={actionTitle}
                title={actionTitle}
                aria-pressed={speaking}
                className={
                    compact
                        ? `min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 rounded-none shadow-none inline-flex items-center justify-center transition-colors cursor-pointer ${
                              speaking
                                  ? 'text-[#00AEEF]'
                                  : 'text-[#475569] dark:text-[#9CA3AF] hover:text-[#C68346] dark:hover:text-[#C68346]'
                          }`
                        : `min-w-[48px] min-h-[48px] bg-transparent border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none px-fib-13 inline-flex items-center justify-center gap-fib-8 transition-colors cursor-pointer ${
                              speaking
                                  ? 'border-[#00AEEF] text-[#00AEEF]'
                                  : 'text-[#334155] dark:text-[#CBD5E1] hover:text-[#C68346] hover:border-[#C68346]'
                          }`
                }
            >
                <span className="material-symbols-outlined text-[22px]">
                    {speaking ? 'stop_circle' : 'volume_up'}
                </span>
                {!compact && (
                    <span className="text-microcopy font-mono uppercase tracking-wider">
                        {speaking
                            ? t('core_read_aloud.stop_short', 'DETENER')
                            : t('core_read_aloud.listen_short', 'ESCUCHAR')}
                    </span>
                )}
            </button>

            {showSpeedToggle && !compact && (
                <button
                    type="button"
                    onClick={() => setSlowRate((prev) => !prev)}
                    aria-pressed={slowRate}
                    title={t('core_read_aloud.speed_aria', 'Alternar velocidad de lectura offline')}
                    aria-label={t('core_read_aloud.speed_aria', 'Alternar velocidad de lectura offline')}
                    className={`min-w-[48px] min-h-[48px] px-2 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none font-mono text-microcopy tabular-nums transition-colors cursor-pointer ${
                        slowRate
                            ? 'border-[#C68346] text-[#C68346] font-bold'
                            : 'text-[#475569] dark:text-[#9CA3AF] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                    }`}
                >
                    {slowRate ? '0.85x' : '1.0x'}
                </button>
            )}
        </div>
    );
};

export default ReadAloudButton;
