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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                        Gestión Corporativa
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1 uppercase text-[10px] font-bold tracking-[0.2em]">
                        Cuenta: {currentAccount?.name} • ID: {currentAccount?.taxId}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="px-4 py-2 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 rounded-2xl flex items-center gap-2">
                        <ShieldCheck className="text-indigo-600 dark:text-indigo-400" size={18} />
                        <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">Acceso Corporativo</span>
                    </div>
                </div>
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Left Col: Metrics & Billing */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Metrics Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm">
                            <div className="w-12 h-12 bg-blue-50 dark:bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4">
                                <BarChart3 size={24} />
                            </div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Uso de Almacenamiento</p>
                            <h3 className="text-2xl font-black text-slate-900 dark:text-white mt-1">4.2 GB / 10 GB</h3>
                            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full mt-4 overflow-hidden">
                                <div className="h-full bg-blue-500 w-[42%]" />
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm">
                            <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4">
                                <CreditCard size={24} />
                            </div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Plan Actual</p>
                            <h3 className="text-2xl font-black text-slate-900 dark:text-white mt-1">Enterprise Pro</h3>
                            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold mt-2 uppercase">Próximo cobro: 15 Feb 2026</p>
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
                    <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-[2rem] overflow-hidden">
                        <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/20">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-500/20 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                    <History size={16} />
                                </div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-widest">Delegados Operativos</h3>
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
                                        <tr className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                            <td className="p-6">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400">
                                                        <Fingerprint size={20} />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-black text-slate-900 dark:text-white">{currentAccount.primaryOperator.taxId || 'Sin ID'}</p>
                                                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">
                                                            {currentAccount.primaryOperator.invitedAt
                                                                ? `Asignado: ${new Date(currentAccount.primaryOperator.invitedAt).toLocaleDateString()}`
                                                                : currentAccount.primaryOperator.email}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-6">
                                                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{currentAccount.primaryOperator.name}</p>
                                                <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase">{currentAccount.primaryOperator.jobTitle || 'ADMINISTRADOR OPERATIVO'}</p>
                                            </td>
                                            <td className="p-6 text-center">
                                                <span className={clsx(
                                                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
                                                    currentAccount.primaryOperator.status === 'ACTIVE'
                                                        ? "bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20"
                                                        : "bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20"
                                                )}>
                                                    {currentAccount.primaryOperator.status === 'ACTIVE' ? 'Activado' : 'Pendiente'}
                                                </span>
                                            </td>
                                            <td className="p-6 text-right">
                                                <button
                                                    onClick={handleRemoveOperator}
                                                    disabled={loading}
                                                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all ml-auto disabled:opacity-50"
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
                    <div className="bg-slate-900 dark:bg-indigo-600 p-8 rounded-[2.5rem] text-white shadow-xl shadow-indigo-500/10">
                        <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mb-6">
                            <UserPlus size={28} />
                        </div>
                        <h3 className="text-xl font-bold leading-tight">Delegación de Mando Operativo</h3>
                        <p className="text-indigo-100/70 text-sm mt-3 leading-relaxed">
                            Define quién será el responsable de la operación diaria, reportes y gestión de terreno.
                        </p>

                        {!isInviting ? (
                            <button
                                onClick={() => setIsInviting(true)}
                                className="mt-8 w-full py-4 bg-white text-indigo-600 font-black rounded-2xl hover:bg-indigo-50 transition-all flex items-center justify-center gap-2 shadow-lg"
                            >
                                Asignar Administrador
                                <ArrowRight size={18} />
                            </button>
                        ) : (
                            <form
                                onSubmit={handleInvite}
                                className="mt-8 space-y-4 animate-in slide-in-from-top-2"
                                autoComplete="off"
                            >
                                <div className="space-y-4">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest ml-1">Nombre Completo</label>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                value={inviteName}
                                                onChange={(e) => setInviteName(e.target.value)}
                                                required
                                                autoComplete="off"
                                                placeholder="Nombre del Responsable"
                                                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest ml-1">RUT del Responsable</label>
                                            <div className="relative">
                                                <Fingerprint className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                                                <input
                                                    type="text"
                                                    value={inviteTaxId}
                                                    onChange={(e) => setInviteTaxId(formatRut(e.target.value))}
                                                    required
                                                    autoComplete="off"
                                                    placeholder="12.345.678-k"
                                                    className="w-full pl-11 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest ml-1">Cargo / Puesto</label>
                                            <input
                                                type="text"
                                                value={inviteJobTitle}
                                                onChange={(e) => setInviteJobTitle(e.target.value)}
                                                required
                                                autoComplete="off"
                                                placeholder="Ej: Gerente Op."
                                                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest ml-1">Email Corporativo</label>
                                        <div className="relative">
                                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                                            <input
                                                type="email"
                                                value={inviteEmail}
                                                onChange={(e) => setInviteEmail(e.target.value)}
                                                required
                                                autoComplete="off"
                                                placeholder="ejemplo@empresa.com"
                                                className="w-full pl-11 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {status && (
                                    <div className={clsx(
                                        "p-3 rounded-xl text-xs font-bold text-center animate-in zoom-in",
                                        status.type === 'success' ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200"
                                    )}>
                                        {status.msg}
                                    </div>
                                )}

                                <div className="flex gap-2 pt-2">
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="flex-1 py-3 bg-white text-indigo-600 font-bold rounded-xl hover:bg-indigo-50 transition-all text-sm disabled:opacity-50 flex items-center justify-center"
                                    >
                                        {loading ? "Enviando..." : "Enviar Invitación"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsInviting(false)}
                                        className="px-4 py-3 bg-black/20 text-white font-bold rounded-xl hover:bg-black/30 transition-all text-sm"
                                    >
                                        Cancelar
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
