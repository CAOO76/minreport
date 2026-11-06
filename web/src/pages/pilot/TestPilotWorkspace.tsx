import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { PilotFeedbackSchema } from '../../contracts';
import { getApiUrl } from '../../utils/network';
import BrandLogo from '../../components/BrandLogo';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import { LanguageSwitch } from '../../components/LanguageSwitch';

const OpermaqModule = lazy(() => import('../../modules/opermaq/OpermaqModule').then((m) => ({ default: m.OpermaqModule })));
const StockpileModule = lazy(() => import('../../modules/stockpile/StockpileModule').then((m) => ({ default: m.StockpileModule })));

type PilotTab =
    | 'SIM_OPERMAQ_CATALOG'
    | 'SIM_OPERMAQ_FLEET'
    | 'SIM_OPERMAQ_SYMBOLOGY'
    | 'SIM_STOCKPILE'
    | 'FEEDBACK_LOG'
    | 'HITL_CURATION';

interface FeedbackRecord {
    id: string;
    module: 'core' | 'opermaq' | 'stockpile';
    category: string;
    priority: string;
    contextPath: string;
    observation: string;
    expectedAiBehavior?: string;
    status: 'OPEN' | 'IN_REVIEW' | 'APPLIED_TO_AI' | 'RESOLVED';
    authorEmail?: string;
    timestamp?: string;
}

interface HitlCandidateDoc {
    id: string;
    tenantId?: string;
    module?: string;
    targetEntity?: string;
    status?: string;
    currentValues?: Record<string, unknown>;
    suggestedValues?: Record<string, unknown>;
    currentValue?: unknown;
    suggestedValue?: unknown;
    field?: string;
    rationale?: string;
    createdAt?: string | number;
}

const MISSING_TECH = '[Información técnica no declarada en ficha]';

export const TestPilotWorkspace: React.FC = () => {
    const navigate = useNavigate();
    const { user, signOut } = useAuth();
    const { session, isLoaded } = useMinReportSession();

    const [activeTab, setActiveTab] = useState<PilotTab>('SIM_OPERMAQ_CATALOG');
    const [feedbackItems, setFeedbackItems] = useState<FeedbackRecord[]>([]);
    const [hitlCandidates, setHitlCandidates] = useState<HitlCandidateDoc[]>([]);
    const [selectedCandidate, setSelectedCandidate] = useState<HitlCandidateDoc | null>(null);
    const [approvedFields, setApprovedFields] = useState<Record<string, boolean>>({});
    const [confirmKeyword, setConfirmKeyword] = useState('');
    const [loadingList, setLoadingList] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);

    // Formulario rapido lateral
    const [category, setCategory] = useState<'AI_KNOWLEDGE_TRAINING' | 'CHANGE_REQUEST' | 'BUG_CORRECTION' | 'FIELD_SIMULATION'>('FIELD_SIMULATION');
    const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('MEDIUM');
    const [observation, setObservation] = useState('');
    const [expectedAiBehavior, setExpectedAiBehavior] = useState('');
    const [submittingFeedback, setSubmittingFeedback] = useState(false);

    const getToken = async () => {
        if (auth.currentUser) return auth.currentUser.getIdToken();
        return localStorage.getItem('dev_auth_token') || '';
    };

    const loadPilotFeedback = useCallback(async () => {
        setLoadingList(true);
        setErrorMsg(null);
        try {
            const token = await getToken();
            const res = await fetch(getApiUrl('/api/pilot/feedback'), {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || `Error HTTP ${res.status} al cargar pilot_feedback`);
            }
            setFeedbackItems(Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []);
        } catch (err: any) {
            setErrorMsg(err?.message || 'Error consultando bitacora pilot_feedback.');
        } finally {
            setLoadingList(false);
        }
    }, []);

    const loadHitlCandidates = useCallback(async () => {
        setLoadingList(true);
        setErrorMsg(null);
        try {
            const snap = await getDocs(collection(db, 'hitl_candidates'));
            const docs: HitlCandidateDoc[] = snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<HitlCandidateDoc, 'id'>),
            }));
            setHitlCandidates(docs);
        } catch (err: any) {
            setErrorMsg(err?.message || 'Error consultando coleccion hitl_candidates.');
        } finally {
            setLoadingList(false);
        }
    }, []);

    useEffect(() => {
        if (!isLoaded || !session || (!session.isTestPilot && !session.isDevRoot)) return;
        if (activeTab === 'FEEDBACK_LOG') {
            loadPilotFeedback();
        } else if (activeTab === 'HITL_CURATION') {
            loadHitlCandidates();
        }
    }, [activeTab, isLoaded, session, loadPilotFeedback, loadHitlCandidates]);

    const handleSelectCandidate = (cand: HitlCandidateDoc) => {
        setSelectedCandidate(cand);
        setConfirmKeyword('');
        const suggestedMap = cand.suggestedValues || (cand.field ? { [cand.field]: cand.suggestedValue } : {});
        const initialChecks: Record<string, boolean> = {};
        Object.keys(suggestedMap).forEach((k) => {
            initialChecks[k] = true;
        });
        setApprovedFields(initialChecks);
    };

    const handleConsolidateHitl = async (decision: 'APPROVED' | 'REJECTED') => {
        if (!selectedCandidate || confirmKeyword.trim() !== 'ACTUALIZAR') return;
        setErrorMsg(null);
        setStatusMsg(null);
        try {
            const suggestedMap = selectedCandidate.suggestedValues || (selectedCandidate.field ? { [selectedCandidate.field]: selectedCandidate.suggestedValue } : {});
            const acceptedPatch: Record<string, unknown> = {};
            Object.entries(suggestedMap).forEach(([k, v]) => {
                if (approvedFields[k]) {
                    acceptedPatch[k] = v;
                }
            });

            await updateDoc(doc(db, 'hitl_candidates', selectedCandidate.id), {
                status: decision,
                approvedFields: decision === 'APPROVED' ? acceptedPatch : {},
                reviewedByUid: session?.uid || '',
                reviewedByEmail: session?.email || '',
                reviewedAt: new Date().toISOString(),
            });

            setStatusMsg(`Candidato HITL ${selectedCandidate.id} consolidado con estado ${decision}.`);
            setConfirmKeyword('');
            setSelectedCandidate(null);
            await loadHitlCandidates();
        } catch (err: any) {
            setErrorMsg(err?.message || 'No se pudo consolidar el candidato HITL.');
        }
    };

    const handleCreateFeedback = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!session) return;
        setErrorMsg(null);
        setStatusMsg(null);

        const mod: 'core' | 'opermaq' | 'stockpile' =
            activeTab === 'SIM_OPERMAQ_CATALOG' ||
                activeTab === 'SIM_OPERMAQ_FLEET' ||
                activeTab === 'SIM_OPERMAQ_SYMBOLOGY'
                ? 'opermaq'
                : activeTab === 'SIM_STOCKPILE'
                    ? 'stockpile'
                    : 'core';

        const payload = {
            tenantId: session.tenantId || 'pilot-sandbox',
            authorUid: session.uid,
            authorEmail: session.email || 'pilot@minreport.com',
            authorName: session.displayName || 'Test Pilot',
            module: mod,
            executionMode: 'integrated' as const,
            category,
            priority,
            contextPath: `/pilot/${activeTab.toLowerCase()}`,
            observation: observation.trim(),
            expectedAiBehavior: expectedAiBehavior.trim() || undefined,
            status: 'OPEN' as const,
            timestamp: new Date().toISOString(),
        };

        const parsed = PilotFeedbackSchema.safeParse(payload);
        if (!parsed.success) {
            setErrorMsg(parsed.error.issues[0]?.message || 'Verifique los campos de la observacion.');
            return;
        }

        setSubmittingFeedback(true);
        try {
            const token = await getToken();
            const res = await fetch(getApiUrl('/api/pilot/feedback'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(parsed.data),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(body?.error || `Error HTTP ${res.status}`);
            }
            setObservation('');
            setExpectedAiBehavior('');
            setStatusMsg('Observacion registrada correctamente en pilot_feedback.');
            if (activeTab === 'FEEDBACK_LOG') {
                await loadPilotFeedback();
            }
        } catch (err: any) {
            setErrorMsg(err?.message || 'Fallo al enviar observacion.');
        } finally {
            setSubmittingFeedback(false);
        }
    };

    if (!isLoaded) return null;
    if (!user) return <Navigate to="/login" replace />;
    if (session?.isSuperAdmin) return <Navigate to="/admin" replace />;
    if (!session?.isTestPilot && !session?.isDevRoot) return <Navigate to="/dashboard" replace />;

    const isSimulation =
        activeTab === 'SIM_OPERMAQ_CATALOG' ||
        activeTab === 'SIM_OPERMAQ_FLEET' ||
        activeTab === 'SIM_OPERMAQ_SYMBOLOGY' ||
        activeTab === 'SIM_STOCKPILE';

    return (
        <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col font-sans select-none antialiased">
            {/* Barra Superior Dedicada 3º TEST-PILOT */}
            <header className="h-14 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between sticky top-0 z-40">
                <div className="flex items-center gap-fib-21">
                    <BrandLogo variant="logotype" className="h-6 w-auto object-contain" />
                    <span className="text-microcopy font-mono uppercase text-[#00AEEF] border-l border-[#E2E8F0] dark:border-[#12151C] pl-fib-13">
                        3º TEST-PILOT · SIMULACION Y CURACION IA
                    </span>
                </div>

                <div className="flex items-center gap-fib-13">
                    <button
                        type="button"
                        onClick={() => navigate('/dashboard')}
                        title="Ir a vista cliente MINREPORT"
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                        <span className="material-symbols-outlined text-[20px]">dashboard</span>
                    </button>
                    <LanguageSwitch />
                    <ThemeSwitch />
                    <button
                        type="button"
                        onClick={() => signOut()}
                        title="Cerrar sesion"
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 cursor-pointer"
                    >
                        <span className="material-symbols-outlined text-[20px]">logout</span>
                    </button>
                </div>
            </header>

            <nav className="px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center gap-fib-21 overflow-x-auto">
                {[
                    { id: 'SIM_OPERMAQ_CATALOG' as PilotTab, label: 'CATÁLOGO', icon: 'front_loader' },
                    { id: 'SIM_OPERMAQ_FLEET' as PilotTab, label: 'FLOTA', icon: 'lists' },
                    { id: 'SIM_OPERMAQ_SYMBOLOGY' as PilotTab, label: 'SIMBOLOGÍA', icon: 'shapes' },
                    { id: 'SIM_STOCKPILE' as PilotTab, label: 'STOCKPILE 3D', icon: 'layers' },
                    { id: 'FEEDBACK_LOG' as PilotTab, label: 'PILOT_FEEDBACK', icon: 'fact_check' },
                    { id: 'HITL_CURATION' as PilotTab, label: 'HITL_CANDIDATES', icon: 'psychology' },
                ].map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                            setActiveTab(tab.id);
                            setErrorMsg(null);
                            setStatusMsg(null);
                        }}
                        className={`py-fib-13 px-fib-8 bg-transparent border-0 border-b-2 text-xs font-mono uppercase tracking-wider cursor-pointer flex items-center gap-fib-8 whitespace-nowrap ${activeTab === tab.id
                            ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-bold'
                            : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            }`}
                    >
                        <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                        <span>{tab.label}</span>
                    </button>
                ))}
            </nav>

            {(errorMsg || statusMsg) && (
                <div className="px-fib-21 pt-fib-13">
                    {errorMsg && (
                        <div className="p-fib-13 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono">
                            {errorMsg}
                        </div>
                    )}
                    {statusMsg && (
                        <div className="p-fib-13 bg-[#00AEEF]/10 border border-[#00AEEF]/30 text-[#00AEEF] text-xs font-mono">
                            {statusMsg}
                        </div>
                    )}
                </div>
            )}

            {/* Macro-Layout Proporcion Aurea (61.8% / 38.2%) */}
            <main className="flex-1 flex flex-col lg:flex-row p-fib-21 gap-fib-21">
                {/* AREA MAYOR (61.8%) */}
                <section className="w-full lg:w-[61.8%] bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none overflow-hidden flex flex-col">
                    {activeTab === 'SIM_OPERMAQ_CATALOG' && (
                        <div className="flex-1 min-h-[600px] flex flex-col">
                            <Suspense fallback={<div className="p-fib-34 font-mono text-xs text-[#8A93A6]">CATÁLOGO...</div>}>
                                <OpermaqModule key="pilot-opermaq-catalog" domainMode="CATALOG" hostScope="TEST_PILOT" />
                            </Suspense>
                        </div>
                    )}

                    {activeTab === 'SIM_OPERMAQ_FLEET' && (
                        <div className="flex-1 min-h-[600px] flex flex-col">
                            <Suspense fallback={<div className="p-fib-34 font-mono text-xs text-[#8A93A6]">FLOTA...</div>}>
                                <OpermaqModule key="pilot-opermaq-fleet" domainMode="FLEET" hostScope="TEST_PILOT" />
                            </Suspense>
                        </div>
                    )}

                    {activeTab === 'SIM_OPERMAQ_SYMBOLOGY' && (
                        <div className="flex-1 min-h-[600px] flex flex-col">
                            <Suspense fallback={<div className="p-fib-34 font-mono text-xs text-[#8A93A6]">SIMBOLOGÍA...</div>}>
                                <OpermaqModule key="pilot-opermaq-symbology" domainMode="SYMBOLOGY" hostScope="TEST_PILOT" />
                            </Suspense>
                        </div>
                    )}

                    {activeTab === 'SIM_STOCKPILE' && (
                        <div className="flex-1 min-h-[600px] flex flex-col">
                            <Suspense fallback={<div className="p-fib-34 font-mono text-xs text-[#8A93A6]">Cargando STOCKPILE CONTROL...</div>}>
                                <StockpileModule />
                            </Suspense>
                        </div>
                    )}

                    {activeTab === 'FEEDBACK_LOG' && (
                        <div className="p-fib-21 space-y-fib-21">
                            <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <h1 className="text-h2-section uppercase">Registro Historico `pilot_feedback`</h1>
                                <button
                                    type="button"
                                    onClick={loadPilotFeedback}
                                    title="Actualizar bitacora"
                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-[20px]">refresh</span>
                                </button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse font-mono text-data-dense tabular-nums">
                                    <thead>
                                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                            <th className="py-fib-13 px-fib-8">Modulo</th>
                                            <th className="py-fib-13 px-fib-8">Categoria</th>
                                            <th className="py-fib-13 px-fib-8">Observacion</th>
                                            <th className="py-fib-13 px-fib-8">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                        {loadingList ? (
                                            <tr>
                                                <td colSpan={4} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                                    Cargando observaciones...
                                                </td>
                                            </tr>
                                        ) : feedbackItems.length === 0 ? (
                                            <tr>
                                                <td colSpan={4} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                                    [Sin observaciones registradas]
                                                </td>
                                            </tr>
                                        ) : (
                                            feedbackItems.map((item) => (
                                                <tr key={item.id} className="hover:bg-[#FFFFFF] dark:hover:bg-[#000000]">
                                                    <td className="py-fib-13 px-fib-8 uppercase text-[#C68346]">{item.module}</td>
                                                    <td className="py-fib-13 px-fib-8">{item.category}</td>
                                                    <td className="py-fib-13 px-fib-8 font-sans">{item.observation}</td>
                                                    <td className="py-fib-13 px-fib-8 text-[#00AEEF] uppercase">{item.status}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === 'HITL_CURATION' && (
                        <div className="p-fib-21 space-y-fib-21">
                            <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <h1 className="text-h2-section uppercase">Bandeja de Curacion IA (`hitl_candidates`)</h1>
                                <button
                                    type="button"
                                    onClick={loadHitlCandidates}
                                    title="Actualizar candidatos"
                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-[20px]">refresh</span>
                                </button>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse font-mono text-data-dense tabular-nums">
                                    <thead>
                                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                            <th className="py-fib-13 px-fib-8">ID Candidato</th>
                                            <th className="py-fib-13 px-fib-8">Modulo</th>
                                            <th className="py-fib-13 px-fib-8">Entidad</th>
                                            <th className="py-fib-13 px-fib-8">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                        {hitlCandidates.length === 0 ? (
                                            <tr>
                                                <td colSpan={4} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                                    [Sin propuestas pendientes en hitl_candidates]
                                                </td>
                                            </tr>
                                        ) : (
                                            hitlCandidates.map((cand) => (
                                                <tr
                                                    key={cand.id}
                                                    onClick={() => handleSelectCandidate(cand)}
                                                    className={`cursor-pointer ${selectedCandidate?.id === cand.id
                                                        ? 'bg-[#C68346]/10'
                                                        : 'hover:bg-[#FFFFFF] dark:hover:bg-[#000000]'
                                                        }`}
                                                >
                                                    <td className="py-fib-13 px-fib-8 select-text">{cand.id}</td>
                                                    <td className="py-fib-13 px-fib-8 uppercase text-[#C68346]">{cand.module || 'core'}</td>
                                                    <td className="py-fib-13 px-fib-8">{cand.targetEntity || MISSING_TECH}</td>
                                                    <td className="py-fib-13 px-fib-8 text-[#00AEEF] uppercase">{cand.status || 'PENDING'}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </section>

                {/* AREA MENOR (38.2%) */}
                <aside className="w-full lg:w-[38.2%] bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 rounded-none shadow-none flex flex-col gap-fib-21">
                    {activeTab === 'HITL_CURATION' ? (
                        <>
                            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <span className="text-microcopy font-mono uppercase text-[#00AEEF]">
                                    APROBACION GRANULAR 1 A 1 (HITL)
                                </span>
                                <h2 className="text-h2-section uppercase mt-1">
                                    Vista Comparativa [Actual] a [Sugerido]
                                </h2>
                            </div>

                            {!selectedCandidate ? (
                                <p className="text-xs font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                    Seleccione un candidato en la bandeja izquierda para autorizar o descartar campo por campo.
                                </p>
                            ) : (
                                <div className="space-y-fib-21">
                                    <div className="space-y-fib-8 text-xs font-mono">
                                        {Object.entries(
                                            selectedCandidate.suggestedValues ||
                                            (selectedCandidate.field ? { [selectedCandidate.field]: selectedCandidate.suggestedValue } : {})
                                        ).map(([fieldKey, suggestedVal]) => {
                                            const currentVal =
                                                selectedCandidate.currentValues?.[fieldKey] ??
                                                selectedCandidate.currentValue ??
                                                MISSING_TECH;
                                            return (
                                                <label
                                                    key={fieldKey}
                                                    className="flex items-start gap-fib-13 p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] cursor-pointer"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={Boolean(approvedFields[fieldKey])}
                                                        onChange={(e) =>
                                                            setApprovedFields((prev) => ({
                                                                ...prev,
                                                                [fieldKey]: e.target.checked,
                                                            }))
                                                        }
                                                        className="mt-1 accent-[#C68346]"
                                                    />
                                                    <div className="flex-1 space-y-1">
                                                        <span className="text-microcopy uppercase text-[#C68346] block">{fieldKey}</span>
                                                        <div className="flex flex-wrap items-center gap-fib-8 text-xs">
                                                            <span className="text-[#475569] dark:text-[#8A93A6]">
                                                                [Actual: {String(currentVal)}]
                                                            </span>
                                                            <span className="material-symbols-outlined text-[14px] text-[#00AEEF]">
                                                                arrow_forward
                                                            </span>
                                                            <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                                [Sugerido: {String(suggestedVal)}]
                                                            </span>
                                                        </div>
                                                    </div>
                                                </label>
                                            );
                                        })}
                                    </div>

                                    <div className="space-y-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-13">
                                        <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                            Escriba ACTUALIZAR para consolidar curacion
                                        </label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={confirmKeyword}
                                            onChange={(e) => setConfirmKeyword(e.target.value.toUpperCase())}
                                            placeholder="ACTUALIZAR"
                                            className="w-full px-fib-13 py-2 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-xs font-mono tracking-widest text-center rounded-none outline-none"
                                        />
                                        <div className="grid grid-cols-2 gap-fib-8">
                                            <button
                                                type="button"
                                                disabled={confirmKeyword.trim() !== 'ACTUALIZAR'}
                                                onClick={() => handleConsolidateHitl('APPROVED')}
                                                className="py-2.5 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase rounded-none border-0 cursor-pointer disabled:opacity-40"
                                            >
                                                Autorizar Campos
                                            </button>
                                            <button
                                                type="button"
                                                disabled={confirmKeyword.trim() !== 'ACTUALIZAR'}
                                                onClick={() => handleConsolidateHitl('REJECTED')}
                                                className="py-2.5 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-red-500 text-red-600 dark:text-red-400 text-xs font-mono uppercase rounded-none cursor-pointer disabled:opacity-40"
                                            >
                                                Descartar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <form onSubmit={handleCreateFeedback} autoComplete="off" spellCheck={false} className="space-y-fib-13">
                            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <span className="text-microcopy font-mono uppercase text-[#C68346]">
                                    {isSimulation ? 'REGISTRO DE SIMULACION EN VIVO' : 'NUEVA ENTRADA PILOT_FEEDBACK'}
                                </span>
                                <h2 className="text-h2-section uppercase mt-1">
                                    Observacion y Entrenamiento Experto
                                </h2>
                            </div>

                            <div className="grid grid-cols-2 gap-fib-8">
                                <div>
                                    <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-1">
                                        Categoria
                                    </label>
                                    <select
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value as any)}
                                        className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-2.5 py-2 text-xs font-mono rounded-none outline-none"
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
                                        className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-2.5 py-2 text-xs font-mono rounded-none outline-none"
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
                                    Observacion Tecnica
                                </label>
                                <textarea
                                    required
                                    rows={4}
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={observation}
                                    onChange={(e) => setObservation(e.target.value)}
                                    placeholder="Documente hallazgos de operacion minera, ergonomia o precision de calculo..."
                                    className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] p-fib-13 text-xs font-sans rounded-none outline-none resize-none select-text"
                                />
                            </div>

                            <div>
                                <label className="block text-microcopy font-mono uppercase text-[#00AEEF] mb-1">
                                    Comportamiento Esperado IA (Opcional)
                                </label>
                                <textarea
                                    rows={3}
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={expectedAiBehavior}
                                    onChange={(e) => setExpectedAiBehavior(e.target.value)}
                                    placeholder="Especifique criterio tecnico o norma DS 132/ISO para entrenar el enjambre..."
                                    className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] p-fib-13 text-xs font-sans rounded-none outline-none resize-none select-text"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={submittingFeedback}
                                className="w-full py-2.5 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase tracking-wider rounded-none border-0 cursor-pointer disabled:opacity-50"
                            >
                                {submittingFeedback ? 'GUARDANDO...' : 'REGISTRAR EN PILOT_FEEDBACK'}
                            </button>
                        </form>
                    )}
                </aside>
            </main>
        </div>
    );
};

export default TestPilotWorkspace;
