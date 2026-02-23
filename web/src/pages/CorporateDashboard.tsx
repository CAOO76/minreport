import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { CreditCard, BarChart3, ShieldCheck, Mail, ArrowRight, UserPlus, Fingerprint, History, Trash2, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { formatRut } from '../utils/rut';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../config/firebase';

export const CorporateDashboard = () => {
    const { currentAccount, user } = useAuth();
    const [isInviting, setIsInviting] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteName, setInviteName] = useState('');
    const [inviteTaxId, setInviteTaxId] = useState('');
    const [inviteJobTitle, setInviteJobTitle] = useState('ADMINISTRADOR OPERATIVO');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !currentAccount) return;

        setLoading(true);
        setStatus(null);

        try {
            const token = await user.getIdToken();
            const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/invite`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    email: inviteEmail,
                    name: inviteName,
                    taxId: inviteTaxId,
                    jobTitle: inviteJobTitle,
                    accountId: currentAccount.id,
                    companyName: currentAccount.name
                })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Error al enviar invitación');
            }

            setStatus({ type: 'success', msg: `Invitación enviada a ${inviteEmail}` });
            setInviteEmail('');
            setInviteName('');
            setInviteTaxId('');
            setTimeout(() => setIsInviting(false), 2000);
        } catch (err: any) {
            setStatus({ type: 'error', msg: err.message });
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveOperator = async () => {
        if (!currentAccount) return;

        const confirmRemoval = window.confirm(
            "¿Estás seguro de que deseas desvincular al delegado operativo actual? Perderá el acceso de gestión a la cuenta de inmediato."
        );

        if (!confirmRemoval) return;

        setLoading(true);
        setStatus(null);

        try {
            const accountRef = doc(db, 'accounts', currentAccount.id);
            await updateDoc(accountRef, {
                primaryOperator: deleteField(),
                updatedAt: Date.now()
            });
            setStatus({ type: 'success', msg: 'Delegado desvinculado con éxito' });
        } catch (err: any) {
            console.error("Error removing operator:", err);
            setStatus({ type: 'error', msg: 'Error de permisos o conexión al desvincular' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-700">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-black/5 dark:border-white/5 pb-8">
                <div>
                    <h1 className="text-3xl font-black text-black dark:text-white uppercase tracking-tighter">
                        CORPORATE_CONTROL
                    </h1>
                    <p className="hud-label text-[10px] text-antigravity-accent mt-2">
                        ACCOUNT: {currentAccount?.name} • ID: {currentAccount?.taxId}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="px-5 py-3 bg-black/5 dark:bg-white/5 border border-antigravity-accent/30 rounded-none flex items-center gap-3">
                        <ShieldCheck className="text-antigravity-accent" size={18} />
                        <span className="hud-label text-[10px] text-antigravity-accent">ACCESS_GRANTED: CORPORATE_VAULT</span>
                    </div>
                </div>
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Left Col: Metrics & Billing */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Metrics Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-black/5 dark:bg-white/5 p-8 rounded-none border border-black/5 dark:border-white/5 relative overflow-hidden group">
                            <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity"></div>
                            <div className="w-12 h-12 bg-black/5 dark:bg-white/10 rounded-none border border-black/10 dark:border-white/10 flex items-center justify-center text-black/40 dark:text-white/40 mb-6">
                                <BarChart3 size={24} />
                            </div>
                            <p className="hud-label text-[9px] text-black/40 dark:text-white/40">STORAGE_METRICS</p>
                            <h3 className="text-2xl font-black text-black dark:text-white mt-1">4.2 GB <span className="text-xs opacity-40 font-mono">/ 10 GB</span></h3>
                            <div className="w-full h-1.5 bg-black/5 dark:bg-white/5 rounded-none mt-6 overflow-hidden border border-black/5">
                                <div className="h-full bg-antigravity-accent w-[42%]" />
                            </div>
                        </div>
                        <div className="bg-black/5 dark:bg-white/5 p-8 rounded-none border border-black/5 dark:border-white/5 relative overflow-hidden group">
                            <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity"></div>
                            <div className="w-12 h-12 bg-antigravity-accent/10 rounded-none border border-antigravity-accent/20 flex items-center justify-center text-antigravity-accent mb-6">
                                <CreditCard size={24} />
                            </div>
                            <p className="hud-label text-[9px] text-black/40 dark:text-white/40">SUBSCRIPTION_RANK</p>
                            <h3 className="text-2xl font-black text-black dark:text-white mt-1 uppercase tracking-tighter">Enterprise_Pro</h3>
                            <p className="hud-label text-[8px] text-antigravity-accent mt-3 opacity-80">NEXT_BILL: 15_FEB_2026</p>
                        </div>
                    </div>

                    {/* Placeholder for Billing History */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-[2rem] overflow-hidden">
                        <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex justify-between items-center">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-widest">Historial de Suscripción</h3>
                            <button className="text-xs font-bold text-indigo-600 hover:underline">Ver todas</button>
                        </div>
                        <div className="p-8 text-center">
                            <p className="text-slate-400 text-sm italic py-10">No hay facturas recientes para mostrar.</p>
                        </div>
                    </div>

                    {/* NEW: Leadership Management Section */}
                    <div className="bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-none overflow-hidden group">
                        <div className="p-6 border-b border-black/5 dark:border-white/5 flex justify-between items-center bg-black/5 relative overflow-hidden">
                            <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none"></div>
                            <div className="flex items-center gap-4 relative z-10">
                                <div className="w-8 h-8 bg-black dark:bg-white rounded-none flex items-center justify-center text-white dark:text-black">
                                    <History size={16} />
                                </div>
                                <h3 className="hud-label text-[10px] text-black/60 dark:text-white/60">OPERATIONAL_DELEGATES</h3>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-50 dark:border-slate-800">
                                        <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Identidad / RUT</th>
                                        <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Nombre y Cargo</th>
                                        <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Estado</th>
                                        <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {currentAccount?.primaryOperator ? (
                                        <tr className="group hover:bg-black/5 transition-colors border-b border-black/5 dark:border-white/5">
                                            <td className="p-6">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-11 h-11 bg-black/5 dark:bg-white/5 rounded-none border border-black/10 dark:border-white/10 flex items-center justify-center text-black/40 dark:text-white/40">
                                                        <Fingerprint size={20} />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-black text-black dark:text-white uppercase tracking-tighter">{currentAccount.primaryOperator.taxId || 'Sin ID'}</p>
                                                        <p className="hud-label text-[8px] text-black/30 dark:text-white/20 mt-1">
                                                            {currentAccount.primaryOperator.invitedAt
                                                                ? `SYNCED: ${new Date(currentAccount.primaryOperator.invitedAt).toLocaleDateString()}`
                                                                : 'WAITING_SYNC'}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-6">
                                                <p className="text-[12px] font-black uppercase text-black/80 dark:text-white/80">{currentAccount.primaryOperator.name}</p>
                                                <p className="hud-label text-[9px] text-antigravity-accent mt-1">{currentAccount.primaryOperator.jobTitle || 'ADMINISTRADOR OPERATIVO'}</p>
                                            </td>
                                            <td className="p-6 text-center">
                                                <span className={clsx(
                                                    "px-3 py-1.5 rounded-none text-[9px] font-black uppercase tracking-[0.2em] border",
                                                    currentAccount.primaryOperator.status === 'ACTIVE'
                                                        ? "bg-black dark:bg-white text-white dark:text-black border-transparent"
                                                        : "bg-transparent text-black/40 dark:text-white/30 border-black/10 dark:border-white/10"
                                                )}>
                                                    {currentAccount.primaryOperator.status === 'ACTIVE' ? 'STATUS: ACTIVE' : 'STATUS: PENDING'}
                                                </span>
                                            </td>
                                            <td className="p-6 text-right">
                                                <button
                                                    onClick={handleRemoveOperator}
                                                    disabled={loading}
                                                    className="w-10 h-10 border border-black/5 dark:border-white/5 rounded-none flex items-center justify-center text-black/40 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all ml-auto disabled:opacity-50"
                                                    title="Eliminar Delegado"
                                                >
                                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 size={18} />}
                                                </button>
                                            </td>
                                        </tr>
                                    ) : (
                                        <tr>
                                            <td colSpan={4} className="p-10 text-center text-slate-400 text-sm italic">
                                                No hay administradores operativos asignados a esta cuenta.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Right Col: Leadership Delegation */}
                <div className="space-y-6">
                    <div className="bg-black dark:bg-white p-10 rounded-none text-white dark:text-black relative overflow-hidden group">
                        <div className="absolute inset-0 technical-grid opacity-10 pointer-events-none group-hover:opacity-20 transition-opacity"></div>
                        <div className="w-14 h-14 bg-antigravity-accent rounded-none flex items-center justify-center mb-8 relative z-10">
                            <UserPlus size={28} className="text-white" />
                        </div>
                        <h3 className="text-2xl font-black uppercase tracking-tighter leading-none relative z-10">COMMAND_DELEGATION</h3>
                        <p className="hud-label text-[10px] mt-4 opacity-60 leading-relaxed relative z-10">
                            AUTORIZAR NUEVO COMANDANTE OPERATIVO PARA GESTIÓN DE PROTOCOLOS Y TERRENO.
                        </p>

                        {!isInviting ? (
                            <button
                                onClick={() => setIsInviting(true)}
                                className="mt-10 w-full py-5 bg-antigravity-accent text-white hud-label text-[10px] rounded-none hover:brightness-110 transition-all flex items-center justify-center gap-3 relative z-10"
                            >
                                START_AUTH_PROTOCOL
                                <ArrowRight size={18} />
                            </button>
                        ) : (
                            <form
                                onSubmit={handleInvite}
                                className="mt-8 space-y-4 animate-in slide-in-from-top-2"
                                autoComplete="off"
                            >
                                <div className="space-y-4">
                                    <div className="space-y-2 relative z-10">
                                        <label className="hud-label text-[9px] opacity-60 ml-1">FULL_IDENTITY_NAME</label>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                value={inviteName}
                                                onChange={(e) => setInviteName(e.target.value)}
                                                required
                                                autoComplete="off"
                                                spellCheck="false"
                                                data-lpignore="true"
                                                placeholder="COMMANDER_NAME"
                                                className="w-full px-5 py-4 bg-white/5 dark:bg-black/5 border border-white/10 dark:border-black/10 rounded-none text-white dark:text-black placeholder:opacity-20 focus:outline-none focus:border-antigravity-accent transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
                                        <div className="space-y-2">
                                            <label className="hud-label text-[9px] opacity-60 ml-1">TAX_ID_RUT</label>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={inviteTaxId}
                                                    onChange={(e) => setInviteTaxId(formatRut(e.target.value))}
                                                    required
                                                    autoComplete="off"
                                                    spellCheck="false"
                                                    data-lpignore="true"
                                                    placeholder="12.345.678-K"
                                                    className="w-full px-5 py-4 bg-white/5 dark:bg-black/5 border border-white/10 dark:border-black/10 rounded-none text-white dark:text-black placeholder:opacity-20 focus:outline-none focus:border-antigravity-accent transition-all"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="hud-label text-[9px] opacity-60 ml-1">DELEGATED_ROLE</label>
                                            <input
                                                type="text"
                                                value={inviteJobTitle}
                                                onChange={(e) => setInviteJobTitle(e.target.value)}
                                                required
                                                autoComplete="off"
                                                spellCheck="false"
                                                data-lpignore="true"
                                                placeholder="OPERATIONAL_MANAGER"
                                                className="w-full px-5 py-4 bg-white/5 dark:bg-black/5 border border-white/10 dark:border-black/10 rounded-none text-white dark:text-black placeholder:opacity-20 focus:outline-none focus:border-antigravity-accent transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2 relative z-10">
                                        <label className="hud-label text-[9px] opacity-60 ml-1">COMM_EMAIL_NODE</label>
                                        <div className="relative">
                                            <input
                                                type="email"
                                                value={inviteEmail}
                                                onChange={(e) => setInviteEmail(e.target.value)}
                                                required
                                                autoComplete="off"
                                                spellCheck="false"
                                                data-lpignore="true"
                                                placeholder="NODE@SYSTEM.COM"
                                                className="w-full px-5 py-4 bg-white/5 dark:bg-black/5 border border-white/10 dark:border-black/10 rounded-none text-white dark:text-black placeholder:opacity-20 focus:outline-none focus:border-antigravity-accent transition-all"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {status && (
                                    <div className={clsx(
                                        "p-4 rounded-none text-[10px] font-black uppercase tracking-widest text-center animate-in zoom-in border relative z-10",
                                        status.type === 'success' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"
                                    )}>
                                        {status.msg}
                                    </div>
                                )}

                                <div className="flex gap-4 pt-4 relative z-10">
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="flex-1 py-4 bg-antigravity-accent text-white hud-label text-[10px] rounded-none hover:brightness-110 transition-all disabled:opacity-50 flex items-center justify-center"
                                    >
                                        {loading ? "PROCESSING..." : "COMMIT_INVITATION"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsInviting(false)}
                                        className="px-6 py-4 bg-white/10 text-white dark:text-black dark:bg-black/10 hud-label text-[10px] rounded-none hover:bg-white/20 transition-all"
                                    >
                                        ABORT
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-6 rounded-[2rem]">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Ayuda y Soporte</h3>
                        <ul className="space-y-3">
                            <li className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 cursor-pointer transition-colors">¿Cómo reasignar un administrador?</li>
                            <li className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 cursor-pointer transition-colors">Entendiendo las métricas B2B</li>
                            <li className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 cursor-pointer transition-colors">Contactar a Ejecutivo de Cuentas</li>
                        </ul>
                    </div>
                </div>

            </div>
        </div>
    );
};
