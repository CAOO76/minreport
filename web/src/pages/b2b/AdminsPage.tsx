import { useState, useEffect } from 'react';
import { formatRut } from '../../utils/rut';
import { useAuth } from '../../context/AuthContext';
import { StaffService } from '../../services/StaffService';
import { db } from '../../config/firebase';
import { collection, query, where, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';

// Common CSS fragments to ensure consistency
const containerClass = "max-w-7xl mx-auto py-12 px-8 space-y-12 animate-in fade-in duration-500";
const sectionHeaderClass = "border-b border-antigravity-light-border dark:border-antigravity-dark-border pb-8 mb-10";
const cardClass = "bg-antigravity-light-surface dark:bg-antigravity-dark-surface border border-antigravity-light-border dark:border-antigravity-dark-border p-8 transition-all hover:border-antigravity-accent/30";
const labelClass = "block text-[10px] font-bold uppercase tracking-[0.15em] text-antigravity-light-muted dark:text-antigravity-dark-muted mb-2";
const inputClass = "w-full bg-transparent border border-antigravity-light-border dark:border-antigravity-dark-border px-4 py-3 text-sm text-antigravity-light-text dark:text-antigravity-dark-text placeholder-antigravity-light-muted/30 focus:outline-none focus:border-antigravity-accent rounded-none transition-all duration-300 disabled:opacity-30 selection:bg-antigravity-accent/30";

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

    // Modals
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [showRevokeModal, setShowRevokeModal] = useState(false);
    const [revokeConfirmText, setRevokeConfirmText] = useState('');
    const [selectedAdminToRevoke, setSelectedAdminToRevoke] = useState<AdminMember | null>(null);

    useEffect(() => {
        if (!currentAccount?.id) return;
        const membersRef = collection(db, 'accounts', currentAccount.id, 'members');
        const q = query(membersRef, where('role', '==', 'ADMIN'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AdminMember));
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
            const result = await StaffService.designateAdmin(currentAccount.id, form, currentAccount.name);
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
            const parts = adm.fullName.split(' ');
            const name = parts[0] || '';
            const lastName = parts.slice(1).join(' ') || 'Admin';
            const result = await StaffService.designateAdmin(
                currentAccount.id,
                { name, lastName, run: adm.run, email: adm.email },
                currentAccount.name
            );
            if (result.success) {
                // Success feedback can be handled via better UI notifications if needed
            } else {
                setError(result.error || 'No se pudo reenviar la invitación.');
            }
        } catch (err: any) {
            setError(err.message || 'Error al reenviar.');
        } finally {
            setLoading(false);
        }
    };

    if (initialLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-[70vh] space-y-6">
                <span className="material-symbols-rounded text-4xl animate-spin text-antigravity-accent">sync</span>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-antigravity-light-muted dark:text-antigravity-dark-muted">Sincronizando Directorio de Confianza</p>
            </div>
        );
    }

    return (
        <div className={containerClass} style={{ fontFamily: '"Atkinson Hyperlegible", sans-serif' }}>

            {/* 1. Header Section - Asymmetric and Spacious */}
            <header className={sectionHeaderClass}>
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-4">
                            <span className="material-symbols-rounded text-antigravity-accent text-3xl">verified_user</span>
                            <span className="h-[1px] w-12 bg-antigravity-accent/20 md:block hidden" />
                        </div>
                        <h1 className="text-3xl font-black uppercase tracking-tight text-antigravity-light-text dark:text-antigravity-dark-text">
                            Administradores <br className="hidden md:block" />
                            <span className="text-antigravity-accent">Generales</span>
                        </h1>
                        <p className="max-w-md text-sm text-antigravity-light-muted dark:text-antigravity-dark-muted mt-4 leading-relaxed">
                            Cargos de máxima confianza técnica y operativa. Tienen autonomía total sobre el personal y perfiles del ecosistema corporativo.
                        </p>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-antigravity-accent/60 mb-1">Capacidad de Gestión</span>
                        <div className="flex items-center gap-1">
                            {[0, 1].map((idx) => (
                                <div key={idx} className={`w-10 h-1.5 rounded-none ${idx < admins.length ? 'bg-antigravity-accent' : 'bg-antigravity-light-border dark:bg-antigravity-dark-border'}`} />
                            ))}
                        </div>
                        <span className="text-[11px] font-mono mt-2 text-antigravity-light-muted dark:text-antigravity-dark-muted">{admins.length} / 2 utilizados</span>
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-16 items-start">

                {/* 2. Form Section - Professional and Clean */}
                <section className="xl:col-span-4 space-y-6">
                    <div className={cardClass}>
                        <div className="flex items-center gap-2 mb-8">
                            <span className="material-symbols-rounded text-antigravity-accent">person_add</span>
                            <h2 className="text-xs font-black uppercase tracking-widest">Nueva Designación</h2>
                        </div>

                        <form onSubmit={handlePreSubmit} autoComplete="off" className="space-y-8">
                            <div className="space-y-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className={labelClass}>Nombres</label>
                                        <input required type="text" autoComplete="off" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="Ej. Roberto" />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Apellidos</label>
                                        <input required type="text" autoComplete="off" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} className={inputClass} placeholder="Ej. Lagos" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className={labelClass}>Identificador (RUN)</label>
                                        <input required type="text" autoComplete="off" value={form.run}
                                            onChange={e => setForm({ ...form, run: formatRut(e.target.value) })}
                                            className={`${inputClass} font-mono`} placeholder="12.345.678-9" />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Email Corporativo</label>
                                        <input required type="email" autoComplete="off" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={inputClass} placeholder="r.lagos@empresa.cl" />
                                    </div>
                                </div>
                            </div>

                            {error && (
                                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                    className="p-4 bg-red-500/5 border-l-2 border-red-500 text-[11px] text-red-500 font-bold flex items-start gap-3">
                                    <span className="material-symbols-rounded text-sm">warning</span>
                                    <span className="uppercase tracking-wide">{error}</span>
                                </motion.div>
                            )}

                            <button
                                type="submit"
                                disabled={admins.length >= 2 || loading}
                                className="group w-full bg-antigravity-light-text dark:bg-antigravity-dark-text text-antigravity-light-surface dark:text-antigravity-dark-surface py-4 px-6 text-[10px] font-black uppercase tracking-[0.2em] transition-all hover:bg-antigravity-accent hover:text-white disabled:opacity-10 disabled:grayscale flex items-center justify-center gap-2"
                            >
                                {loading ? (
                                    <span className="material-symbols-rounded animate-spin">refresh</span>
                                ) : (
                                    <>
                                        <span>Iniciar Designación</span>
                                        <span className="material-symbols-rounded text-sm transition-transform group-hover:translate-x-1">arrow_forward</span>
                                    </>
                                )}
                            </button>
                        </form>
                    </div>

                    <div className="p-6 border border-antigravity-light-border dark:border-antigravity-dark-border border-dashed">
                        <p className="text-[10px] text-antigravity-light-muted dark:text-antigravity-dark-muted leading-loose uppercase tracking-widest">
                            <span className="text-antigravity-accent font-black">Nota:</span> Las designaciones son responsabilidad exclusiva de la empresa y no requieren validación de mesa de ayuda.
                        </p>
                    </div>
                </section>

                {/* 3. Table Section - Spacious and Readable */}
                <section className="xl:col-span-8">
                    <div className="border border-antigravity-light-border dark:border-antigravity-dark-border bg-antigravity-light-surface dark:bg-antigravity-dark-surface">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-antigravity-light-border dark:border-antigravity-dark-border">
                                        {['Identidad', 'Nombre', 'Contacto', 'Estado', ''].map((h, i) => (
                                            <th key={i} className="px-8 py-6 text-[9px] font-black uppercase tracking-[0.2em] text-antigravity-light-muted dark:text-antigravity-dark-muted">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-antigravity-light-border/50 dark:divide-antigravity-dark-border/50">
                                    {admins.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-8 py-24 text-center">
                                                <div className="flex flex-col items-center gap-4 opacity-30">
                                                    <span className="material-symbols-rounded text-5xl">person_off</span>
                                                    <p className="text-xs font-bold uppercase tracking-[0.2em]">Sin Cargos Designados</p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        admins.map(admin => (
                                            <tr key={admin.id} className="group hover:bg-antigravity-accent/[0.02] transition-colors">
                                                <td className="px-8 py-8">
                                                    <span className="font-mono text-xs text-antigravity-light-text/60 dark:text-antigravity-dark-text/60">
                                                        {formatRut(admin.run)}
                                                    </span>
                                                </td>
                                                <td className="px-8 py-8">
                                                    <div className="text-[12px] font-black uppercase tracking-wider text-antigravity-light-text dark:text-antigravity-dark-text">
                                                        {admin.fullName}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-8">
                                                    <div className="text-[11px] text-antigravity-light-muted dark:text-antigravity-dark-muted break-all">
                                                        {admin.email}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-8">
                                                    <div className={`inline-flex items-center gap-2 px-3 py-1 text-[9px] font-bold uppercase tracking-wider border ${admin.status === 'ACTIVE'
                                                        ? 'border-emerald-500/30 text-emerald-500 bg-emerald-500/5'
                                                        : 'border-antigravity-accent/30 text-antigravity-accent bg-antigravity-accent/5'
                                                        }`}>
                                                        <span className={`w-1 h-1 ${admin.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-antigravity-accent animate-pulse'}`} />
                                                        {admin.status === 'ACTIVE' ? 'Activo' : 'Pendiente'}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-8 text-right">
                                                    <div className="flex items-center justify-end gap-6 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        {admin.status === 'PENDING' && (
                                                            <button
                                                                onClick={() => handleResendInvitation(admin)}
                                                                disabled={loading}
                                                                className="text-[9px] font-black uppercase tracking-widest text-antigravity-accent hover:underline flex items-center gap-1"
                                                            >
                                                                <span className="material-symbols-rounded text-sm">mail</span>
                                                                Reenviar
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleRevokePreConfirm(admin)}
                                                            className="text-[9px] font-black uppercase tracking-widest text-red-500/60 hover:text-red-500 transition-colors"
                                                        >
                                                            Revocar
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            </div>

            {/* Designate Modal */}
            <AnimatePresence>
                {showConfirmModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-8">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={() => setShowConfirmModal(false)} className="absolute inset-0 bg-black/60 backdrop-blur-md" />
                        <motion.div initial={{ scale: 0.98, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.98, opacity: 0 }}
                            className="relative w-full max-w-lg bg-antigravity-light-surface dark:bg-antigravity-dark-surface border border-antigravity-light-border dark:border-antigravity-dark-border p-12 shadow-2xl">
                            <header className="mb-10">
                                <span className="material-symbols-rounded text-antigravity-accent text-4xl mb-6">gavel</span>
                                <h3 className="text-xl font-black uppercase tracking-tight mb-2">Confirmar <span className="text-antigravity-accent">Designación</span></h3>
                                <p className="text-sm text-antigravity-light-muted dark:text-antigravity-dark-muted leading-relaxed">
                                    Estás delegando autoridad administrativa a <span className="font-bold text-antigravity-light-text dark:text-antigravity-dark-text italic">{form.name} {form.lastName}</span>.
                                </p>
                            </header>

                            <div className="space-y-8">
                                <div className="space-y-4">
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-antigravity-accent">Validación de seguridad</p>
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        value={confirmText}
                                        onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                                        className={`${inputClass} text-center font-black tracking-[0.5em] text-lg py-4`}
                                        placeholder="DESIGNAR"
                                    />
                                    <p className="text-[9px] uppercase tracking-widest text-antigravity-light-muted dark:text-antigravity-dark-muted text-center">Escriba "DESIGNAR" para proceder</p>
                                </div>
                                <button
                                    onClick={handleDesignate}
                                    disabled={confirmText !== 'DESIGNAR'}
                                    className="w-full bg-antigravity-accent hover:bg-antigravity-accent/80 disabled:opacity-20 text-white py-5 text-xs font-black uppercase tracking-[0.3em] transition-all"
                                >
                                    Confirmar Poder Delegado
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Revoke Modal */}
            <AnimatePresence>
                {showRevokeModal && selectedAdminToRevoke && (
                    <div className="fixed inset-0 z-[101] flex items-center justify-center p-8">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={() => setShowRevokeModal(false)} className="absolute inset-0 bg-black/80 backdrop-blur-md" />
                        <motion.div initial={{ scale: 0.98, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.98, opacity: 0 }}
                            className="relative w-full max-w-lg bg-antigravity-light-surface dark:bg-antigravity-dark-surface border border-red-500/30 p-12 shadow-2xl">
                            <header className="mb-10">
                                <span className="material-symbols-rounded text-red-500 text-4xl mb-6">danger</span>
                                <h3 className="text-xl font-black uppercase tracking-tight mb-2 text-red-500">Revocar <span className="text-antigravity-light-text dark:text-antigravity-dark-text">Acceso</span></h3>
                                <p className="text-sm text-antigravity-light-muted dark:text-antigravity-dark-muted leading-relaxed">
                                    Esta acción eliminará de forma inmediata todos los privilegios de <span className="font-bold text-red-500">{selectedAdminToRevoke.fullName}</span>.
                                </p>
                            </header>

                            <div className="space-y-8">
                                <div className="space-y-4">
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-500">Validación Crítica</p>
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        value={revokeConfirmText}
                                        onChange={(e) => setRevokeConfirmText(e.target.value.toUpperCase())}
                                        className={`${inputClass} text-center font-black tracking-[0.5em] text-lg py-4 border-red-500/50 focus:border-red-500`}
                                        placeholder="REVOCAR"
                                    />
                                </div>
                                <button
                                    onClick={handleConfirmRevoke}
                                    disabled={revokeConfirmText !== 'REVOCAR' || loading}
                                    className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-20 text-white py-5 text-xs font-black uppercase tracking-[0.3em] transition-all"
                                >
                                    {loading ? 'Procesando...' : 'Ejecutar Revocación'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};
