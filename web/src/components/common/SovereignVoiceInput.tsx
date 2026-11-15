import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { auth } from '../../config/firebase';
import { resolveNormalizedLang } from '../../i18n';
import { getApiUrl } from '../../utils/network';
import M3LinearProgress from './M3LinearProgress';

export interface EphemeralVoiceAudioPayload {
    mimeType: 'audio/webm' | 'audio/mp4' | 'audio/ogg' | 'audio/wav';
    dataBase64: string;
}

export interface SovereignVoiceInputProps {
    onTranscript: (text: string) => void;
    onAudioCaptured?: (audio: EphemeralVoiceAudioPayload) => Promise<void> | void;
    module?: 'core' | 'opermaq' | 'stockpile';
    contextPath?: string;
    compact?: boolean;
    disabled?: boolean;
    label?: string;
    className?: string;
}

type VoiceStatus = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'ERROR';

function mapSpeechLocale(lang: string): string {
    const normalized = resolveNormalizedLang(lang);
    if (normalized === 'en') return 'en-US';
    if (normalized === 'pt') return 'pt-BR';
    return 'es-CL';
}

function normalizeAudioMime(rawMime: string): 'audio/webm' | 'audio/mp4' | 'audio/ogg' | 'audio/wav' {
    const lower = (rawMime || '').toLowerCase();
    if (lower.includes('mp4') || lower.includes('aac')) return 'audio/mp4';
    if (lower.includes('ogg')) return 'audio/ogg';
    if (lower.includes('wav')) return 'audio/wav';
    return 'audio/webm';
}

async function blobToBase64(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const slice = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...slice);
    }
    return btoa(binary);
}

export const SovereignVoiceInput: React.FC<SovereignVoiceInputProps> = ({
    onTranscript,
    onAudioCaptured,
    module = 'core',
    contextPath = '/',
    compact = false,
    disabled = false,
    label,
    className = '',
}) => {
    const { t, i18n } = useTranslation();
    const [status, setStatus] = useState<VoiceStatus>('IDLE');
    const [errorText, setErrorText] = useState<string | null>(null);

    const recognitionRef = useRef<any>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const autoStopTimerRef = useRef<number | null>(null);

    const cleanupMediaResources = useCallback(() => {
        if (autoStopTimerRef.current !== null) {
            window.clearTimeout(autoStopTimerRef.current);
            autoStopTimerRef.current = null;
        }
        if (recognitionRef.current) {
            try {
                recognitionRef.current.onresult = null;
                recognitionRef.current.onerror = null;
                recognitionRef.current.onend = null;
                recognitionRef.current.stop();
            } catch {
                // Ignorar
            }
            recognitionRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            try {
                mediaRecorderRef.current.stop();
            } catch {
                // Ignorar
            }
        }
        mediaRecorderRef.current = null;
        if (mediaStreamRef.current) {
            for (const track of mediaStreamRef.current.getTracks()) {
                try {
                    track.stop();
                } catch {
                    // Ignorar
                }
            }
            mediaStreamRef.current = null;
        }
        audioChunksRef.current = [];
    }, []);

    useEffect(() => {
        return () => {
            cleanupMediaResources();
        };
    }, [cleanupMediaResources]);

    const transcribeViaSovereignServer = useCallback(
        async (blob: Blob) => {
            setStatus('PROCESSING');
            try {
                const mimeType = normalizeAudioMime(blob.type);
                const dataBase64 = await blobToBase64(blob);

                if (onAudioCaptured) {
                    await onAudioCaptured({ mimeType, dataBase64 });
                    setStatus('IDLE');
                    return;
                }

                const idToken = auth.currentUser
                    ? await auth.currentUser.getIdToken()
                    : localStorage.getItem('dev_auth_token') || '';

                if (!idToken) {
                    throw new Error(t('core_voice.err_auth_required', 'Inicie sesión para dictar audio al servidor soberano.'));
                }

                const res = await fetch(getApiUrl('/api/pilot/feedback/extract-wisdom'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${idToken}`,
                    },
                    body: JSON.stringify({
                        rawNarrative: '',
                        module,
                        contextPath,
                        preferredLang: resolveNormalizedLang(i18n.resolvedLanguage || i18n.language),
                        ephemeralAudio: {
                            mimeType,
                            dataBase64,
                        },
                    }),
                });

                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data?.extraction?.cleanObservation) {
                    throw new Error(data?.error || t('core_voice.err_transcription_failed', 'No se pudo transcribir el audio dictado.'));
                }
                onTranscript(String(data.extraction.cleanObservation));
                setStatus('IDLE');
            } catch (err: any) {
                setErrorText(err?.message || t('core_voice.err_transcription_failed', 'No se pudo transcribir el audio dictado.'));
                setStatus('ERROR');
            } finally {
                // Garantiza cero retención en RAM del buffer de audio crudo
                audioChunksRef.current = [];
            }
        },
        [contextPath, i18n.language, i18n.resolvedLanguage, module, onAudioCaptured, onTranscript, t]
    );

    const stopCurrentSession = useCallback(() => {
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch {
                // Ignorar
            }
            recognitionRef.current = null;
            setStatus('IDLE');
            return;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            try {
                mediaRecorderRef.current.stop();
            } catch {
                cleanupMediaResources();
                setStatus('IDLE');
            }
        }
    }, [cleanupMediaResources]);

    const startSpeechRecognition = useCallback((): boolean => {
        if (typeof window === 'undefined') return false;
        const SpeechRec =
            (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRec) return false;

        try {
            const recognition = new SpeechRec();
            recognition.lang = mapSpeechLocale(i18n.resolvedLanguage || i18n.language);
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;

            recognition.onresult = (event: any) => {
                const chunks: string[] = [];
                for (let i = event.resultIndex || 0; i < (event.results?.length || 0); i++) {
                    const alt = event.results[i]?.[0]?.transcript;
                    if (typeof alt === 'string' && alt.trim()) {
                        chunks.push(alt.trim());
                    }
                }
                const combined = chunks.join(' ').trim();
                if (combined) {
                    onTranscript(combined);
                }
            };

            recognition.onerror = (ev: any) => {
                const code = String(ev?.error || '');
                if (code === 'not-allowed' || code === 'service-not-allowed') {
                    setErrorText(t('core_voice.err_permission_denied', 'Permiso de micrófono denegado en este navegador.'));
                    setStatus('ERROR');
                } else if (code !== 'aborted') {
                    setErrorText(t('core_voice.err_no_speech', 'No se detectó voz clara. Puede escribir directamente abajo.'));
                    setStatus('ERROR');
                } else {
                    setStatus('IDLE');
                }
                recognitionRef.current = null;
            };

            recognition.onend = () => {
                recognitionRef.current = null;
                setStatus((prev) => (prev === 'LISTENING' ? 'IDLE' : prev));
            };

            recognitionRef.current = recognition;
            recognition.start();
            setStatus('LISTENING');
            return true;
        } catch {
            recognitionRef.current = null;
            return false;
        }
    }, [i18n.language, i18n.resolvedLanguage, onTranscript, t]);

    const startEphemeralMediaRecorder = useCallback(async () => {
        if (
            typeof navigator === 'undefined' ||
            !navigator.mediaDevices?.getUserMedia ||
            typeof MediaRecorder === 'undefined'
        ) {
            setErrorText(
                t(
                    'core_voice.err_unsupported',
                    'Este navegador no permite captura de micrófono; use el cuadro de texto.'
                )
            );
            setStatus('ERROR');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            audioChunksRef.current = [];

            const recorder = new MediaRecorder(stream);
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (event: BlobEvent) => {
                if (event.data && event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            recorder.onstop = async () => {
                const chunks = [...audioChunksRef.current];
                audioChunksRef.current = [];
                for (const track of stream.getTracks()) {
                    try {
                        track.stop();
                    } catch {
                        // Ignorar
                    }
                }
                mediaStreamRef.current = null;
                mediaRecorderRef.current = null;

                if (chunks.length === 0) {
                    setStatus('IDLE');
                    return;
                }
                const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
                await transcribeViaSovereignServer(blob);
            };

            recorder.start();
            setStatus('LISTENING');

            // Límite de seguridad de 45 segundos para audio efímero liviano
            autoStopTimerRef.current = window.setTimeout(() => {
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                    mediaRecorderRef.current.stop();
                }
            }, 45_000);
        } catch {
            cleanupMediaResources();
            setErrorText(t('core_voice.err_permission_denied', 'Permiso de micrófono denegado en este navegador.'));
            setStatus('ERROR');
        }
    }, [cleanupMediaResources, t, transcribeViaSovereignServer]);

    const handleToggleVoice = () => {
        if (disabled || status === 'PROCESSING') return;
        setErrorText(null);

        if (status === 'LISTENING') {
            stopCurrentSession();
            return;
        }

        // Preferimos reconocimiento web nativo para respuesta instantánea sin red,
        // salvo cuando el caller solicita explícitamente audio efímero al servidor
        if (!onAudioCaptured && startSpeechRecognition()) {
            return;
        }

        void startEphemeralMediaRecorder();
    };

    const resolvedIdleLabel = label || t('core_voice.tap_to_speak', 'TOCAR PARA HABLAR');
    const resolvedListeningLabel = t('core_voice.tap_to_stop', 'ESCUCHANDO · TOCAR PARA TERMINAR');
    const resolvedProcessingLabel = t('core_voice.processing', 'TRANSCRIBIENDO EN CHILE...');

    return (
        <div className={`space-y-fib-8 select-none ${className}`}>
            <button
                type="button"
                onClick={handleToggleVoice}
                disabled={disabled || status === 'PROCESSING'}
                aria-pressed={status === 'LISTENING'}
                aria-label={
                    status === 'LISTENING'
                        ? resolvedListeningLabel
                        : status === 'PROCESSING'
                          ? resolvedProcessingLabel
                          : resolvedIdleLabel
                }
                title={
                    status === 'LISTENING'
                        ? resolvedListeningLabel
                        : resolvedIdleLabel
                }
                className={
                    compact
                        ? `min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 rounded-none shadow-none inline-flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40 ${
                              status === 'LISTENING'
                                  ? 'text-[#00AEEF]'
                                  : 'text-[#C68346] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                          }`
                        : `w-full min-h-[56px] px-fib-21 py-fib-13 border rounded-none shadow-none inline-flex items-center justify-center gap-fib-13 font-mono text-data-dense font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-40 ${
                              status === 'LISTENING'
                                  ? 'border-[#00AEEF] bg-[#00AEEF] text-white'
                                  : 'border-[#C68346] bg-[#FFFFFF] dark:bg-[#000000] text-[#C68346] hover:bg-[#C68346] hover:text-white'
                          }`
                }
            >
                <span className="material-symbols-outlined text-[24px]">
                    {status === 'LISTENING' ? 'stop_circle' : 'mic'}
                </span>
                {!compact && (
                    <span>
                        {status === 'LISTENING'
                            ? resolvedListeningLabel
                            : status === 'PROCESSING'
                              ? resolvedProcessingLabel
                              : resolvedIdleLabel}
                    </span>
                )}
            </button>

            {(status === 'LISTENING' || status === 'PROCESSING') && !compact && (
                <M3LinearProgress
                    indeterminate
                    ariaLabel={
                        status === 'LISTENING'
                            ? t('core_voice.listening_aria', 'Capturando dictado por voz')
                            : resolvedProcessingLabel
                    }
                />
            )}

            {errorText && !compact && (
                <p className="text-microcopy font-mono text-red-600 dark:text-red-400">
                    {errorText}
                </p>
            )}
        </div>
    );
};

export default SovereignVoiceInput;
