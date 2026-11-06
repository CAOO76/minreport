import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { auth } from '../../config/firebase';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { PilotFeedbackSchema } from '../../contracts';
import { getApiUrl } from '../../utils/network';

export const TestPilotTransversalHUD: React.FC = () => {
    const { session } = useMinReportSession();
    const location = useLocation();
    const navigate = useNavigate();

    const [open, setOpen] = useState(false);
    const [category, setCategory] = useState<'AI_KNOWLEDGE_TRAINING' | 'CHANGE_REQUEST' | 'BUG_CORRECTION' | 'FIELD_SIMULATION'>('FIELD_SIMULATION');
    const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('MEDIUM');
    const [assetOrSurveyId, setAssetOrSurveyId] = useState('');
    const [observation, setObservation] = useState('');
    const [expectedAiBehavior, setExpectedAiBehavior] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    if (!session || (!session.isTestPilot && !session.isDevRoot)) {
        return null;
    }

    const detectedModule: 'core' | 'opermaq' | 'stockpile' = location.pathname.startsWith('/opermaq')
        ? 'opermaq'
        : location.pathname.startsWith('/stockpile')
            ? 'stockpile'
            : 'core';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        setFeedbackMsg(null);

        const candidatePayload = {
            tenantId: session.tenantId || 'pilot-sandbox',
            authorUid: session.uid,
            authorEmail: session.email || 'pilot@minreport.com',
            authorName: session.displayName || 'Test Pilot',
            module: detectedModule,
            executionMode: 'integrated' as const,
            category,
            priority,
            contextPath: location.pathname,
            assetOrSurveyId: assetOrSurveyId.trim() || undefined,
            observation: observation.trim(),
            expectedAiBehavior: expectedAiBehavior.trim() || undefined,
            status: 'OPEN' as const,
            timestamp: new Date().toISOString(),
        };

        const parsed = PilotFeedbackSchema.safeParse(candidatePayload);
        if (!parsed.success) {
            setErrorMsg(parsed.error.issues[0]?.message || 'Datos de observacion invalidos.');
            return;
        }

        setSubmitting(true);
        try {
            const idToken = auth.currentUser
                ? await auth.currentUser.getIdToken()
                : localStorage.getItem('dev_auth_token') || '';

            const res = await fetch(getApiUrl('/api/pilot/feedback'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
                },
                body: JSON.stringify(parsed.data),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || `Error HTTP ${res.status} al registrar feedback`);
            }

            setObservation('');
            setExpectedAiBehavior('');
            setAssetOrSurveyId('');
            setFeedbackMsg('Observacion tecnica registrada en pilot_feedback.');
        } catch (err: any) {
            setErrorMsg(err?.message || 'Fallo de red al registrar observacion TEST-PILOT.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed bottom-fib-21 left-24 z-40 font-sans select-none">
            {!open ? (
                <div className="flex items-center bg-[#F8FAFC] dark:bg-[#07090D] border border-[#C68346] px-fib-13 py-1.5 gap-fib-8 rounded-none shadow-none">
                    <span className="text-microcopy font-mono uppercase text-[#C68346]">3º TEST-PILOT HUD</span>
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        title="Registrar observacion contextual TEST-PILOT"
                        className="bg-transparent border-0 outline-none p-1 text-slate-500 dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-white transition-colors cursor-pointer"
                    >
                        <span className="material-symbols-outlined text-[18px]">rate_review</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/pilot')}
                        title="Abrir Cabina Dedicada /pilot"
                        className="bg-transparent border-0 outline-none p-1 text-slate-500 dark:text-[#8A93A6] hover:text-[#00AEEF] transition-colors cursor-pointer"
                    >
                        <span className="material-symbols-outlined text-[18px]">science</span>
                    </button>
                </div>
            ) : (
                <div className="w-80 sm:w-96 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#C68346] p-fib-21 space-y-fib-13 rounded-none shadow-none">
                    <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                        <div>
                            <span className="text-microcopy font-mono uppercase text-[#C68346] block">
                                3º TEST-PILOT · BITACORA CONTEXTUAL
                            </span>
                            <span className="text-[11px] font-mono text-[#475569] dark:text-[#8A93A6]">
                                {detectedModule.toUpperCase()} · {location.pathname}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => {
                                    setOpen(false);
                                    navigate('/pilot');
                                }}
                                title="Ir a espacio completo /pilot"
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-[#00AEEF] cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[18px]">open_in_full</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                title="Minimizar HUD"
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>
                    </div>

                    {errorMsg && (
                        <div className="p-fib-8 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono">
                            {errorMsg}
                        </div>
                    )}
                    {feedbackMsg && (
                        <div className="p-fib-8 bg-[#00AEEF]/10 border border-[#00AEEF]/30 text-[#00AEEF] text-xs font-mono">
                            {feedbackMsg}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} autoComplete="off" spellCheck={false} className="space-y-fib-13">
                        <div className="grid grid-cols-2 gap-fib-8">
                            <div>
                                <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-1">
                                    Categoria
                                </label>
                                <select
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value as any)}
                                    className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-2 py-1.5 text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                >
                                    <option value="FIELD_SIMULATION">Simulacion Faena</option>
                                    <option value="AI_KNOWLEDGE_TRAINING">Entrenamiento IA</option>
                                    <option value="CHANGE_REQUEST">Solicitud Cambio</option>
                                    <option value="BUG_CORRECTION">Correccion Tecnica</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-1">
                                    Prioridad
                                </label>
                                <select
                                    value={priority}
                                    onChange={(e) => setPriority(e.target.value as any)}
                                    className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-2 py-1.5 text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                >
                                    <option value="LOW">LOW</option>
                                    <option value="MEDIUM">MEDIUM</option>
                                    <option value="HIGH">HIGH</option>
                                    <option value="CRITICAL">CRITICAL</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-1">
                                ID Equipo / Acopio (Opcional)
                            </label>
                            <input
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                value={assetOrSurveyId}
                                onChange={(e) => setAssetOrSurveyId(e.target.value)}
                                placeholder="Ej: CAEX-01 o STK-NORTE"
                                className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] px-2.5 py-1.5 text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none select-text"
                            />
                        </div>

                        <div>
                            <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-1">
                                Observacion Tecnica
                            </label>
                            <textarea
                                required
                                rows={3}
                                autoComplete="off"
                                spellCheck={false}
                                value={observation}
                                onChange={(e) => setObservation(e.target.value)}
                                placeholder="Detalle tecnico verificado en terreno o simulacion..."
                                className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] px-2.5 py-1.5 text-xs font-sans text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none resize-none select-text"
                            />
                        </div>

                        {category === 'AI_KNOWLEDGE_TRAINING' && (
                            <div>
                                <label className="block text-microcopy font-mono uppercase text-[#00AEEF] mb-1">
                                    Criterio Esperado del Enjambre IA
                                </label>
                                <textarea
                                    rows={2}
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={expectedAiBehavior}
                                    onChange={(e) => setExpectedAiBehavior(e.target.value)}
                                    placeholder="Respuesta o regla normativa que la IA debe aplicar..."
                                    className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] px-2.5 py-1.5 text-xs font-sans text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none resize-none select-text"
                                />
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full py-2 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase tracking-wider rounded-none border-0 cursor-pointer disabled:opacity-50"
                        >
                            {submitting ? 'REGISTRANDO...' : 'ENVIAR A PILOT_FEEDBACK'}
                        </button>
                    </form>
                </div>
            )}
        </div>
    );
};

export default TestPilotTransversalHUD;
