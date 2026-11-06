import React, { useCallback, useEffect, useState } from 'react';
import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { getApiUrl } from '../../utils/network';
import { auth, db } from '../../config/firebase';
import { useMinReportSession } from '../../context/MinReportSessionContext';

interface AIProposal {
    id: string;
    module: string;
    title: string;
    currentValue: string;
    suggestedValue: string;
    confidence?: number;
    status: string;
}

const MISSING_FIELD = '[Información técnica no declarada en ficha]';

export const MiningAICopilot: React.FC = () => {
    const { session } = useMinReportSession();
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'copilot' | 'proposals'>('copilot');
    const [inputPrompt, setInputPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant' | 'error'; text: string; tier?: string }>>([
        {
            role: 'assistant',
            text: 'Copiloto tecnico MINREPORT (Capa 4 Gemini). Ingrese una consulta operativa sobre flota, cubicacion o normativa DS 132.'
        }
    ]);

    const [proposals, setProposals] = useState<AIProposal[]>([]);
    const [proposalsLoading, setProposalsLoading] = useState(false);
    const [proposalsError, setProposalsError] = useState<string | null>(null);
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    const [confirmKeyword, setConfirmKeyword] = useState('');
    const [updatingProposal, setUpdatingProposal] = useState(false);

    const loadProposals = useCallback(async () => {
        if (!session?.tenantId) {
            setProposals([]);
            return;
        }
        setProposalsLoading(true);
        setProposalsError(null);
        try {
            const q = query(
                collection(db, 'hitl_candidates'),
                where('tenantId', '==', session.tenantId)
            );
            const snap = await getDocs(q);
            const items: AIProposal[] = snap.docs.map((docSnap) => {
                const raw = docSnap.data();
                return {
                    id: docSnap.id,
                    module: String(raw.module || 'core'),
                    title: String(raw.title || raw.targetEntity || raw.field || docSnap.id),
                    currentValue: raw.currentValue !== undefined
                        ? String(raw.currentValue)
                        : raw.currentValues
                            ? JSON.stringify(raw.currentValues)
                            : MISSING_FIELD,
                    suggestedValue: raw.suggestedValue !== undefined
                        ? String(raw.suggestedValue)
                        : raw.suggestedValues
                            ? JSON.stringify(raw.suggestedValues)
                            : MISSING_FIELD,
                    confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
                    status: String(raw.status || 'PENDING'),
                };
            });
            setProposals(items);
        } catch (err: any) {
            setProposalsError(err?.message || 'No se pudieron consultar candidatos HITL.');
        } finally {
            setProposalsLoading(false);
        }
    }, [session?.tenantId]);

    useEffect(() => {
        if (isOpen) {
            loadProposals();
        }
    }, [isOpen, loadProposals]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputPrompt.trim() || loading) return;

        const userText = inputPrompt.trim();
        setInputPrompt('');
        setMessages(prev => [...prev, { role: 'user', text: userText }]);
        setLoading(true);

        try {
            const token = await auth.currentUser?.getIdToken();
            const res = await fetch(getApiUrl('/api/ai/inference'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...(session?.tenantId ? { 'X-Active-Account-Id': session.tenantId } : {}),
                },
                body: JSON.stringify({
                    prompt: userText,
                    module: 'core',
                    thinkingLevel: 'medium'
                })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || `Error tecnico de inferencia (HTTP ${res.status}).`);
            }

            setMessages(prev => [
                ...prev,
                {
                    role: 'assistant',
                    text: data.text || '[Respuesta vacia del motor de inferencia]',
                    tier: data.tierUsed
                }
            ]);
        } catch (err: any) {
            setMessages(prev => [
                ...prev,
                {
                    role: 'error',
                    text: err?.message || 'Fallo de comunicacion con el endpoint /api/ai/inference.'
                }
            ]);
        } finally {
            setLoading(false);
        }
    };

    const handleResolveProposal = async (id: string, nextStatus: 'APPROVED' | 'REJECTED') => {
        if (nextStatus === 'APPROVED' && confirmKeyword.trim() !== 'ACTUALIZAR') return;
        setUpdatingProposal(true);
        setProposalsError(null);
        try {
            await updateDoc(doc(db, 'hitl_candidates', id), {
                status: nextStatus,
                reviewedByUid: session?.uid || auth.currentUser?.uid || '',
                reviewedByEmail: session?.email || auth.currentUser?.email || '',
                reviewedAt: new Date().toISOString(),
            });
            setConfirmingId(null);
            setConfirmKeyword('');
            await loadProposals();
        } catch (err: any) {
            setProposalsError(err?.message || 'Error actualizando estado del candidato HITL.');
        } finally {
            setUpdatingProposal(false);
        }
    };

    const pendingCount = proposals.filter(p => p.status === 'PENDING').length;

    return (
        <>
            {/* Disparador Minimalista Industrial con Soporte Dual */}
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="fixed bottom-fib-21 right-fib-21 z-40 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] px-fib-13 py-2.5 rounded-none shadow-none flex items-center gap-fib-8 transition-colors cursor-pointer"
                title="Copiloto Tecnico IA (Capa 4)"
            >
                <span className="material-symbols-outlined text-[18px] text-[#C68346]">smart_toy</span>
                <span className="text-microcopy uppercase font-mono hidden sm:inline">
                    IA MINERA
                </span>
                {pendingCount > 0 && (
                    <span className="text-[10px] font-mono tabular-nums text-[#00AEEF]">
                        ({pendingCount})
                    </span>
                )}
            </button>

            {/* Drawer Lateral Parametrico de Proporcion Aurea (38.2%) */}
            {isOpen && (
                <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
                    <div className="w-full sm:w-[480px] lg:w-[38.2vw] h-full bg-[#FFFFFF] dark:bg-[#000000] border-l border-[#E2E8F0] dark:border-[#12151C] flex flex-col justify-between rounded-none shadow-none">
                        {/* Header */}
                        <div className="p-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between bg-[#F8FAFC] dark:bg-[#07090D]">
                            <div className="flex items-center gap-fib-13">
                                <span className="material-symbols-outlined text-[20px] text-[#C68346]">smart_toy</span>
                                <div>
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                                        Copiloto de Ingenieria Minera
                                    </h3>
                                    <p className="text-[10px] text-[#475569] dark:text-[#8A93A6] font-mono mt-0.5">
                                        Capa 4 · Enjambre Gemini Pro / Flash / Flash-Lite
                                    </p>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                title="Cerrar panel"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>

                        {/* Pestañas */}
                        <div className="flex border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
                            <button
                                type="button"
                                onClick={() => setActiveTab('copilot')}
                                className={`flex-1 py-2.5 text-[11px] font-mono font-bold uppercase tracking-wider text-center transition-colors border-b-2 bg-transparent cursor-pointer ${
                                    activeTab === 'copilot'
                                        ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6]'
                                        : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                }`}
                            >
                                Consulta en Vivo
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('proposals')}
                                className={`flex-1 py-2.5 text-[11px] font-mono font-bold uppercase tracking-wider text-center transition-colors border-b-2 bg-transparent flex items-center justify-center gap-1.5 cursor-pointer ${
                                    activeTab === 'proposals'
                                        ? 'border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6]'
                                        : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                }`}
                            >
                                <span>Candidatos HITL</span>
                                <span className="text-[10px] text-[#00AEEF] tabular-nums">({pendingCount})</span>
                            </button>
                        </div>

                        {/* Contenido */}
                        <div className="flex-1 overflow-y-auto p-fib-21 space-y-fib-13">
                            {activeTab === 'copilot' ? (
                                <>
                                    {messages.map((m, idx) => (
                                        <div
                                            key={idx}
                                            className={`p-fib-13 text-xs leading-relaxed rounded-none ${
                                                m.role === 'user'
                                                    ? 'bg-[#F8FAFC] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border-l-2 border-[#C68346] ml-fib-21'
                                                    : m.role === 'error'
                                                        ? 'bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 font-mono'
                                                        : 'bg-[#F8FAFC] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] mr-fib-13'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-1.5 text-[10px] font-mono text-[#475569] dark:text-[#8A93A6]">
                                                <span>
                                                    {m.role === 'user'
                                                        ? 'USUARIO'
                                                        : m.role === 'error'
                                                            ? 'ERROR DE INFERENCIA'
                                                            : 'ENJAMBRE GEMINI'}
                                                </span>
                                                {m.tier && (
                                                    <span className="text-[#00AEEF] uppercase font-bold">TIER: {m.tier}</span>
                                                )}
                                            </div>
                                            <p className="whitespace-pre-wrap select-text">{m.text}</p>
                                        </div>
                                    ))}

                                    {loading && (
                                        <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-8 text-xs text-[#475569] dark:text-[#8A93A6] font-mono">
                                            <span className="material-symbols-outlined text-[16px] animate-spin text-[#C68346]">progress_activity</span>
                                            <span>Consultando /api/ai/inference...</span>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="space-y-fib-13">
                                    <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border-l-2 border-[#00AEEF] text-[11px] text-[#475569] dark:text-[#8A93A6] font-mono">
                                        GOBERNANZA HITL: Toda propuesta en hitl_candidates exige escribir ACTUALIZAR antes de aprobarse.
                                    </div>

                                    {proposalsError && (
                                        <div className="p-fib-13 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono">
                                            {proposalsError}
                                        </div>
                                    )}

                                    {proposalsLoading ? (
                                        <p className="text-xs font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                            Consultando hitl_candidates de la cuenta activa...
                                        </p>
                                    ) : proposals.length === 0 ? (
                                        <p className="text-xs font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                            [Sin propuestas HITL pendientes para esta cuenta]
                                        </p>
                                    ) : (
                                        proposals.map((prop) => (
                                            <div
                                                key={prop.id}
                                                className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] space-y-fib-13 rounded-none"
                                            >
                                                <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
                                                    <span className="font-bold uppercase tracking-wider text-[#C68346]">
                                                        {prop.module}
                                                    </span>
                                                    <span className="text-[#475569] dark:text-[#8A93A6]">
                                                        {prop.confidence !== undefined ? `Confianza ${prop.confidence}%` : prop.status}
                                                    </span>
                                                </div>

                                                <h4 className="text-xs font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase">
                                                    {prop.title}
                                                </h4>

                                                <div className="space-y-1.5 text-[11px] font-mono">
                                                    <div className="p-2 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6]">
                                                        <span className="text-[9px] uppercase block font-bold">Actual</span>
                                                        {prop.currentValue}
                                                    </div>
                                                    <div className="flex justify-center">
                                                        <span className="material-symbols-outlined text-[16px] text-[#00AEEF]">arrow_downward</span>
                                                    </div>
                                                    <div className="p-2 bg-[#FFFFFF] dark:bg-[#000000] border border-[#00AEEF]/40 text-[#0F172A] dark:text-[#F3F4F6]">
                                                        <span className="text-[9px] uppercase block text-[#00AEEF] font-bold">Sugerido por IA</span>
                                                        {prop.suggestedValue}
                                                    </div>
                                                </div>

                                                {prop.status === 'PENDING' ? (
                                                    confirmingId === prop.id ? (
                                                        <div className="space-y-fib-8 pt-1">
                                                            <input
                                                                type="text"
                                                                autoComplete="off"
                                                                spellCheck={false}
                                                                value={confirmKeyword}
                                                                onChange={(e) => setConfirmKeyword(e.target.value.toUpperCase())}
                                                                placeholder="Escriba ACTUALIZAR"
                                                                className="w-full px-2.5 py-1.5 bg-[#FFFFFF] dark:bg-[#000000] border border-[#C68346] text-xs font-mono tracking-widest text-center text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                                            />
                                                            <div className="flex gap-2">
                                                                <button
                                                                    type="button"
                                                                    disabled={confirmKeyword.trim() !== 'ACTUALIZAR' || updatingProposal}
                                                                    onClick={() => handleResolveProposal(prop.id, 'APPROVED')}
                                                                    className="flex-1 py-1.5 bg-[#C68346] hover:bg-[#B0743E] text-white text-[10px] font-mono font-bold uppercase rounded-none border-0 cursor-pointer disabled:opacity-40"
                                                                >
                                                                    Confirmar
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setConfirmingId(null);
                                                                        setConfirmKeyword('');
                                                                    }}
                                                                    className="px-3 py-1.5 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[10px] font-mono uppercase text-[#475569] dark:text-[#8A93A6] rounded-none cursor-pointer"
                                                                >
                                                                    Cancelar
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex gap-2 pt-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setConfirmingId(prop.id);
                                                                    setConfirmKeyword('');
                                                                }}
                                                                className="flex-1 py-1.5 bg-[#C68346] hover:bg-[#B0743E] text-white text-[10px] font-mono font-bold uppercase tracking-wider rounded-none border-0 cursor-pointer"
                                                            >
                                                                Autorizar con ACTUALIZAR
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleResolveProposal(prop.id, 'REJECTED')}
                                                                disabled={updatingProposal}
                                                                className="px-3 py-1.5 border border-[#E2E8F0] dark:border-[#12151C] text-[10px] font-mono uppercase text-[#475569] dark:text-[#8A93A6] hover:border-red-500 rounded-none cursor-pointer bg-transparent"
                                                            >
                                                                Descartar
                                                            </button>
                                                        </div>
                                                    )
                                                ) : (
                                                    <div className="text-[10px] font-mono text-[#475569] dark:text-[#8A93A6] pt-1">
                                                        Estado consolidado: <span className="text-[#00AEEF] font-bold">{prop.status}</span>
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Formulario de Consulta */}
                        {activeTab === 'copilot' && (
                            <form
                                onSubmit={handleSendMessage}
                                autoComplete="off"
                                spellCheck={false}
                                className="p-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex gap-fib-8"
                            >
                                <input
                                    type="text"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={inputPrompt}
                                    onChange={e => setInputPrompt(e.target.value)}
                                    placeholder="Consultar falla de equipo, cubicacion o normativa DS 132..."
                                    className="flex-1 px-3 py-2 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-xs text-[#0F172A] dark:text-[#F3F4F6] outline-none font-sans rounded-none select-text"
                                />
                                <button
                                    type="submit"
                                    disabled={loading || !inputPrompt.trim()}
                                    title="Enviar consulta"
                                    className="px-3.5 bg-[#C68346] hover:bg-[#B0743E] text-white transition-colors disabled:opacity-40 flex items-center justify-center cursor-pointer border-0 rounded-none"
                                >
                                    <span className="material-symbols-outlined text-[16px]">send</span>
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default MiningAICopilot;
