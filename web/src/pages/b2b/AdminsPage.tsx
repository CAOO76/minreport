import { useState, useEffect } from 'react';
import { formatRut } from '../../utils/rut';
import { useAuth } from '../../context/AuthContext';
import { StaffService } from '../../services/StaffService';
import { db } from '../../config/firebase';
import { collection, query, where, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { Shield, UserPlus, AlertTriangle, Loader2, X, Mail } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface AdminMember {
    id: string;
    userId: string;
    fullName: string;
    email: string;
    run: string;
    role: 'ADMIN' | 'OPERATOR';
    status: 'ACTIVE' | 'PENDING';
    invitedAt: number;
}

export const AdminsPage = () => {
    const { currentAccount, user } = useAuth();
    const [admins, setAdmins] = useState<AdminMember[]>([]);
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({ name: '', lastName: '', run: '', email: '' });

    // Confirmation Modals State
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmText, setConfirmText] = useState('');

    const [showRevokeModal, setShowRevokeModal] = useState(false);
    const [revokeConfirmText, setRevokeConfirmText] = useState('');
    const [selectedAdminToRevoke, setSelectedAdminToRevoke] = useState<AdminMember | null>(null);

    // 1. Listen to real Admins in Firestore
    useEffect(() => {
        if (!currentAccount?.id) return;

        const membersRef = collection(db, 'accounts', currentAccount.id, 'members');
        const q = query(membersRef, where('role', '==', 'ADMIN'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as AdminMember));
            setAdmins(list);
            setInitialLoading(false);
        }, (err) => {
            console.error("Error listening to admins:", err);
            setError("Error al sincronizar administradores.");
            setInitialLoading(false);
        });

        return () => unsubscribe();
    }, [currentAccount?.id]);

    const handlePreSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (admins.length >= 2) {
            setError('Límite de 2 Administradores Generales alcanzado.');
            return;
        }
        setError(null);
        setShowConfirmModal(true);
    };

    const handleDesignate = async () => {
        if (confirmText !== 'DESIGNAR') return;
        if (!currentAccount || !user) return;

        setLoading(true);
        setError(null);
        setShowConfirmModal(false);

        try {
            const result = await StaffService.designateAdmin(
                currentAccount.id,
                form,
                currentAccount.name
            );

            if (result.success) {
                setForm({ name: '', lastName: '', run: '', email: '' });
                setConfirmText('');
            } else {
                setError(result.error || 'No se pudo designar al administrador.');
            }
        } catch (err: any) {
            setError(err.message || 'Error en la operación.');
        } finally {
            setLoading(false);
        }
    };

    const handleRevokePreConfirm = (admin: AdminMember) => {
        setSelectedAdminToRevoke(admin);
        setRevokeConfirmText('');
        setShowRevokeModal(true);
    };

    const handleConfirmRevoke = async () => {
        if (!currentAccount?.id || !selectedAdminToRevoke || revokeConfirmText !== 'REVOCAR') return;

        setLoading(true);
        try {
            const docRef = doc(db, 'accounts', currentAccount.id, 'members', selectedAdminToRevoke.id);
            await deleteDoc(docRef);
            setShowRevokeModal(false);
            setSelectedAdminToRevoke(null);
        } catch (err) {
            console.error("Error revoking admin:", err);
            setError("No se pudo revocar el acceso.");
        } finally {
            setLoading(false);
        }
    };

    const handleResendInvitation = async (adm: AdminMember) => {
        if (!currentAccount || !user) return;

        setLoading(true);
        setError(null);

        try {
            // Re-use designateAdmin logic as it handles resending (new link + email)
            // We split fullName back into name/lastName for the service
            const parts = adm.fullName.split(' ');
            const name = parts[0] || '';
            const lastName = parts.slice(1).join(' ') || 'Admin';

            const result = await StaffService.designateAdmin(
                currentAccount.id,
                { name, lastName, run: adm.run, email: adm.email },
                currentAccount.name
            );

            if (result.success) {
                alert(`Invitación reenviada con éxito a ${adm.email}`);
            } else {
                setError(result.error || 'No se pudo reenviar la invitación.');
            }
        } catch (err: any) {
            setError(err.message || 'Error al reenviar.');
        } finally {
            setLoading(false);
        }
    };

    const inp = 'w-full bg-transparent border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-[#C68346] rounded-none transition-colors disabled:opacity-50';
    const lbl = 'block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1';

    if (initialLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
                <Loader2 className="w-8 h-8 animate-spin text-[#C68346]" />
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Sincronizando Directorio...</p>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto py-8 px-6 space-y-8" style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}>

            {/* Header */}
            <div className="border-b border-gray-200 dark:border-gray-800 pb-6 flex items-start justify-between">
                <div>
                    <h1 className="text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-2">
                        <Shield className="w-5 h-5 text-[#C68346]" />
                        Administradores Generales
                    </h1>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Designa hasta 2 cargos de confianza interna. No requiere intervención de MINREPORT.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Formulario */}
                <div className="border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1a2233] p-6">
                    <div className="flex items-center gap-2 mb-1">
                        <UserPlus className="w-4 h-4 text-[#C68346]" />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white">Designar Administrador</h2>
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-tight text-gray-400 mb-6">
                        {admins.length < 2
                            ? `Capacidad disponible: ${2 - admins.length}`
                            : 'Límite de confianza alcanzado.'}
                    </p>

                    <form onSubmit={handlePreSubmit} autoComplete="off" className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className={lbl}>Nombre</label>
                                <input required type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inp} />
                            </div>
                            <div>
                                <label className={lbl}>Apellidos</label>
                                <input required type="text" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} className={inp} />
                            </div>
                        </div>
                        <div>
                            <label className={lbl}>RUN <span className="text-[8px] opacity-60 ml-1">(Identidad)</span></label>
                            <input required type="text" value={form.run}
                                onChange={e => setForm({ ...form, run: formatRut(e.target.value) })}
                                placeholder="12.345.678-9" className={inp + ' font-mono'} />
                        </div>
                        <div>
                            <label className={lbl}>Email Corporativo</label>
                            <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={inp} />
                        </div>

                        {error && (
                            <div className="p-2 bg-red-500/10 border border-red-500/20 text-[10px] text-red-500 font-bold uppercase tracking-wide flex items-center gap-2">
                                <AlertTriangle className="w-3 h-3" /> {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={admins.length >= 2 || loading}
                            className="w-full mt-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[10px] font-bold uppercase tracking-widest py-3 hover:bg-black dark:hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed transition-all rounded-none"
                        >
                            {loading ? 'Procesando...' : 'Iniciar Designación'}
                        </button>
                    </form>
                </div>

                {/* Tabla */}
                <div className="lg:col-span-2">
                    <div className="flex items-baseline justify-between mb-4 border-b border-gray-100 dark:border-gray-800 pb-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Cargos de Confianza Interna</p>
                        <span className="text-[10px] font-mono text-gray-400">{admins.length} / 2</span>
                    </div>
                    <div className="border border-gray-200 dark:border-gray-800 overflow-hidden">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                                    {['RUN', 'Nombre Completo', 'Email', 'Estado', ''].map((h, i) => (
                                        <th key={i} className={`px-4 py-3 text-[9px] font-black uppercase tracking-widest text-gray-500 ${i === 4 ? 'text-right' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {admins.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-16 text-center">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Sin administradores designados</p>
                                        </td>
                                    </tr>
                                )}
                                {admins.map(admin => (
                                    <tr key={admin.id} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group">
                                        <td className="px-4 py-4 font-mono text-xs text-gray-500">{formatRut(admin.run)}</td>
                                        <td className="px-4 py-4 font-bold text-gray-900 dark:text-white uppercase text-[11px]">{admin.fullName}</td>
                                        <td className="px-4 py-4 text-gray-500 text-xs">{admin.email}</td>
                                        <td className="px-4 py-4">
                                            <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 border ${admin.status === 'ACTIVE'
                                                ? 'border-emerald-500/20 text-emerald-500 bg-emerald-500/5'
                                                : 'border-orange-500/20 text-orange-500 bg-orange-50/50 dark:bg-orange-500/5'
                                                }`}>
                                                {admin.status === 'ACTIVE' ? 'Activo' : 'Invitación'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 text-right">
                                            <div className="flex items-center justify-end gap-3">
                                                {admin.status === 'PENDING' && (
                                                    <button
                                                        onClick={() => handleResendInvitation(admin)}
                                                        disabled={loading}
                                                        className="text-[9px] text-orange-500 hover:text-orange-600 font-bold uppercase tracking-widest flex items-center gap-1 transition-colors"
                                                        title="Reenviar vínculo de acceso"
                                                    >
                                                        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                                                        Reenviar
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleRevokePreConfirm(admin)}
                                                    className="text-[9px] text-gray-400 hover:text-red-500 font-bold uppercase tracking-widest transition-colors opacity-60 group-hover:opacity-100"
                                                >
                                                    Revocar
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Designate Confirmation Modal */}
            <AnimatePresence>
                {showConfirmModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={() => setShowConfirmModal(false)}
                            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                            className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 shadow-2xl"
                        >
                            <div className="flex justify-between items-start mb-6">
                                <div className="p-3 bg-orange-500/10 text-orange-500">
                                    <Shield size={24} />
                                </div>
                                <button onClick={() => setShowConfirmModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
                                    <X size={20} />
                                </button>
                            </div>

                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2 uppercase tracking-tight">Confirmar Designación</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
                                Estás designando a <span className="font-bold text-slate-900 dark:text-white">{form.name} {form.lastName}</span> como Administrador General.
                                Tendrá privilegios sobre el personal y perfiles técnicos de la empresa.
                            </p>

                            <div className="space-y-4">
                                <p className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">
                                    Para confirmar, escribe "DESIGNAR" a continuación:
                                </p>
                                <input
                                    type="text"
                                    value={confirmText}
                                    onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-4 py-3 text-sm font-black tracking-widest uppercase focus:outline-none focus:border-orange-500 dark:focus:border-orange-500 transition-colors"
                                    placeholder="DESIGNAR"
                                />
                                <button
                                    onClick={handleDesignate}
                                    disabled={confirmText !== 'DESIGNAR'}
                                    className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-20 disabled:grayscale text-white font-bold uppercase tracking-widest text-xs py-4 transition-all"
                                >
                                    Confirmar Cargo de Confianza
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Revoke Confirmation Modal */}
            <AnimatePresence>
                {showRevokeModal && selectedAdminToRevoke && (
                    <div className="fixed inset-0 z-[101] flex items-center justify-center p-6">
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={() => setShowRevokeModal(false)}
                            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                            className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 shadow-2xl"
                        >
                            <div className="flex justify-between items-start mb-6">
                                <div className="p-3 bg-red-500/10 text-red-500">
                                    <AlertTriangle size={24} />
                                </div>
                                <button onClick={() => setShowRevokeModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
                                    <X size={20} />
                                </button>
                            </div>

                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2 uppercase tracking-tight text-red-500">Revocar Acceso</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
                                Estás a punto de revocar todos los privilegios administrativos de <span className="font-bold text-slate-900 dark:text-white">{selectedAdminToRevoke.fullName}</span>.
                                Esta acción es inmediata y no se puede deshacer.
                            </p>

                            <div className="space-y-4">
                                <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">
                                    Para confirmar la revocación, escribe "REVOCAR" a continuación:
                                </p>
                                <input
                                    type="text"
                                    value={revokeConfirmText}
                                    onChange={(e) => setRevokeConfirmText(e.target.value.toUpperCase())}
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-red-200 dark:border-red-900/30 px-4 py-3 text-sm font-black tracking-widest uppercase focus:outline-none focus:border-red-500 transition-colors"
                                    placeholder="REVOCAR"
                                />
                                <button
                                    onClick={handleConfirmRevoke}
                                    disabled={revokeConfirmText !== 'REVOCAR' || loading}
                                    className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-20 disabled:grayscale text-white font-bold uppercase tracking-widest text-xs py-4 transition-all"
                                >
                                    {loading ? 'Procesando...' : 'Confirmar Revocación'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};
