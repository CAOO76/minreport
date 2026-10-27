import React, { useState, useEffect } from 'react';
import { formatRut } from '../../utils/rut';
import { useAuth } from '../../context/AuthContext';
import { StaffService } from '../../services/StaffService';
import { db } from '../../config/firebase';
import { collection, query, where, onSnapshot, doc, deleteDoc } from 'firebase/firestore';

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

const labelClass = "block text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] mb-[8px]";
const inputClass = "w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-[13px] py-[8px] text-[13px] text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346] rounded-none shadow-none transition-colors disabled:opacity-40";

export const AdminsPage: React.FC = () => {
    const { currentAccount, user } = useAuth();

    const [admins, setAdmins] = useState<AdminMember[]>([]);
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({ name: '', lastName: '', run: '', email: '' });

    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [showRevokeModal, setShowRevokeModal] = useState(false);
    const [revokeConfirmText, setRevokeConfirmText] = useState('');
    const [selectedAdminToRevoke, setSelectedAdminToRevoke] = useState<AdminMember | null>(null);

    useEffect(() => {
        if (!currentAccount?.id) {
            setInitialLoading(false);
            return;
        }
        const membersRef = collection(db, 'accounts', currentAccount.id, 'members');
        const q = query(membersRef, where('role', '==', 'ADMIN'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as AdminMember));
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
            setError('Cupo máximo alcanzado (2/2).');
            return;
        }
        setError(null);
        setConfirmText('');
        setShowConfirmModal(true);
    };

    const handleDesignate = async () => {
        if (confirmText !== 'ACTUALIZAR' && confirmText !== 'DESIGNAR') return;
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
                setError(result.error || 'Error al registrar designación.');
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
        if (!currentAccount?.id || !selectedAdminToRevoke || (revokeConfirmText !== 'REVOCAR' && revokeConfirmText !== 'ACTUALIZAR')) return;
        setLoading(true);
        try {
            const docRef = doc(db, 'accounts', currentAccount.id, 'members', selectedAdminToRevoke.id);
            await deleteDoc(docRef);
            setShowRevokeModal(false);
            setSelectedAdminToRevoke(null);
        } catch (err) {
            console.error("Error revoking admin:", err);
            setError("Error al revocar acceso.");
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
            if (!result.success) {
                setError(result.error || 'Error al reenviar invitación.');
            }
        } catch (err: any) {
            setError(err.message || 'Error al reenviar invitación.');
        } finally {
            setLoading(false);
        }
    };

    if (initialLoading) {
        return (
            <div className="p-[21px] font-mono text-[13px] text-[#94A3B8] dark:text-[#5A6072]">
                [Cargando registros...]
            </div>
        );
    }

    return (
        <div className="w-full space-y-[21px] select-none font-sans">
            {/* Macro-Layout Proporción Áurea: 38.2% Alta / 61.8% Tabla Técnica */}
            <div className="grid grid-cols-1 lg:grid-cols-[38.2fr_61.8fr] gap-[21px] items-start">

                {/* ÁREA MENOR (38.2%): ALTA DE ADMINISTRADOR */}
                <section className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-[21px] rounded-none shadow-none space-y-[21px]">
                    <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-[13px]">
                        <h2 className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#C68346]">
                            DESIGNACIÓN DE ADMINISTRADOR
                        </h2>
                        <span className="text-[11px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                            {admins.length} / 2
                        </span>
                    </div>

                    <form onSubmit={handlePreSubmit} autoComplete="off" spellCheck={false} className="space-y-[13px]">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[13px]">
                            <div>
                                <label className={labelClass}>NOMBRES</label>
                                <input
                                    required
                                    type="text"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className={labelClass}>APELLIDOS</label>
                                <input
                                    required
                                    type="text"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={form.lastName}
                                    onChange={e => setForm({ ...form, lastName: e.target.value })}
                                    className={inputClass}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[13px]">
                            <div>
                                <label className={labelClass}>RUN</label>
                                <input
                                    required
                                    type="text"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={form.run}
                                    onChange={e => setForm({ ...form, run: formatRut(e.target.value) })}
                                    className={`${inputClass} font-mono tabular-nums select-text`}
                                />
                            </div>
                            <div>
                                <label className={labelClass}>EMAIL CORPORATIVO</label>
                                <input
                                    required
                                    type="email"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={form.email}
                                    onChange={e => setForm({ ...form, email: e.target.value })}
                                    className={`${inputClass} font-mono select-text`}
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="p-[13px] bg-red-500/5 border border-red-500/30 text-[13px] font-mono text-red-600 dark:text-red-400 rounded-none">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={admins.length >= 2 || loading}
                            className="w-full bg-[#C68346] hover:bg-[#b0743e] text-white py-[8px] px-[21px] text-[11px] font-mono font-bold uppercase tracking-[0.05em] transition-colors disabled:opacity-40 cursor-pointer rounded-none shadow-none outline-none"
                        >
                            {loading ? 'PROCESANDO...' : 'DESIGNAR'}
                        </button>
                    </form>
                </section>

                {/* ÁREA MAYOR (61.8%): TABLA TÉCNICA DE ADMINISTRADORES */}
                <section className="bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none">
                    <div className="px-[21px] py-[13px] border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between">
                        <h2 className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6]">
                            REGISTRO DE ADMINISTRADORES
                        </h2>
                        <span className="text-[11px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                            ACTIVOS: {admins.filter(a => a.status === 'ACTIVE').length}
                        </span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse font-mono text-[13px] tabular-nums">
                            <thead>
                                <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] text-[11px] uppercase text-[#475569] dark:text-[#8A93A6]">
                                    <th className="py-[13px] px-[21px]">RUN</th>
                                    <th className="py-[13px] px-[21px]">NOMBRE</th>
                                    <th className="py-[13px] px-[21px]">EMAIL</th>
                                    <th className="py-[13px] px-[21px]">ESTADO</th>
                                    <th className="py-[13px] px-[21px] text-right">ACCIÓN</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {admins.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="py-[34px] px-[21px] text-center text-[13px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                            [Información técnica no declarada en ficha]
                                        </td>
                                    </tr>
                                ) : (
                                    admins.map(admin => (
                                        <tr key={admin.id} className="hover:bg-[#F8FAFC] dark:hover:bg-[#000000]/40 transition-colors">
                                            <td className="py-[13px] px-[21px] text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                                {formatRut(admin.run)}
                                            </td>
                                            <td className="py-[13px] px-[21px] font-sans font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {admin.fullName}
                                            </td>
                                            <td className="py-[13px] px-[21px] text-[#475569] dark:text-[#8A93A6] select-text">
                                                {admin.email}
                                            </td>
                                            <td className="py-[13px] px-[21px]">
                                                <span className={`px-[8px] py-0.5 text-[11px] font-mono uppercase border rounded-none ${
                                                    admin.status === 'ACTIVE'
                                                        ? 'border-[#00AEEF]/40 text-[#00AEEF]'
                                                        : 'border-[#C68346]/40 text-[#C68346]'
                                                }`}>
                                                    {admin.status === 'ACTIVE' ? 'ACTIVO' : 'PENDIENTE'}
                                                </span>
                                            </td>
                                            <td className="py-[13px] px-[21px] text-right">
                                                <div className="inline-flex items-center justify-end gap-[8px]">
                                                    {admin.status === 'PENDING' && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleResendInvitation(admin)}
                                                            disabled={loading}
                                                            title="Reenviar invitación"
                                                            aria-label="Reenviar invitación"
                                                            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">forward_to_inbox</span>
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRevokePreConfirm(admin)}
                                                        disabled={loading}
                                                        title="Revocar administrador"
                                                        aria-label="Revocar administrador"
                                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">person_remove</span>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>

            {/* MODAL CONFIRMACIÓN DESIGNACIÓN (HITL) */}
            {showConfirmModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-[21px] bg-black/70">
                    <div className="w-full max-w-md bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-[21px] rounded-none shadow-none space-y-[21px]">
                        <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-[13px]">
                            <h3 className="text-[13px] font-mono font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                CONFIRMAR DESIGNACIÓN
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowConfirmModal(false)}
                                title="Cerrar"
                                aria-label="Cerrar"
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>

                        <div className="space-y-[13px]">
                            <p className="text-[13px] text-[#475569] dark:text-[#8A93A6]">
                                Administrador: <span className="font-mono font-bold text-[#0F172A] dark:text-[#F3F4F6]">{form.name} {form.lastName}</span> ({form.run})
                            </p>
                            <div>
                                <label className={labelClass}>ESCRIBA "ACTUALIZAR" PARA CONFIRMAR</label>
                                <input
                                    type="text"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={confirmText}
                                    onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                                    className={`${inputClass} font-mono text-center font-bold tracking-widest`}
                                    placeholder="ACTUALIZAR"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={handleDesignate}
                                disabled={confirmText !== 'ACTUALIZAR' && confirmText !== 'DESIGNAR'}
                                className="w-full bg-[#C68346] hover:bg-[#b0743e] disabled:opacity-40 text-white py-[8px] px-[21px] text-[11px] font-mono font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer rounded-none shadow-none"
                            >
                                CONFIRMAR
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL CONFIRMACIÓN REVOCACIÓN (HITL) */}
            {showRevokeModal && selectedAdminToRevoke && (
                <div className="fixed inset-0 z-[101] flex items-center justify-center p-[21px] bg-black/70">
                    <div className="w-full max-w-md bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-[21px] rounded-none shadow-none space-y-[21px]">
                        <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-[13px]">
                            <h3 className="text-[13px] font-mono font-bold uppercase text-red-500">
                                REVOCAR ADMINISTRADOR
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowRevokeModal(false)}
                                title="Cerrar"
                                aria-label="Cerrar"
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>

                        <div className="space-y-[13px]">
                            <p className="text-[13px] text-[#475569] dark:text-[#8A93A6]">
                                Se revocará el acceso de <span className="font-mono font-bold text-[#0F172A] dark:text-[#F3F4F6]">{selectedAdminToRevoke.fullName}</span>.
                            </p>
                            <div>
                                <label className={labelClass}>ESCRIBA "ACTUALIZAR" O "REVOCAR" PARA CONFIRMAR</label>
                                <input
                                    type="text"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={revokeConfirmText}
                                    onChange={(e) => setRevokeConfirmText(e.target.value.toUpperCase())}
                                    className={`${inputClass} font-mono text-center font-bold tracking-widest`}
                                    placeholder="ACTUALIZAR"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={handleConfirmRevoke}
                                disabled={(revokeConfirmText !== 'REVOCAR' && revokeConfirmText !== 'ACTUALIZAR') || loading}
                                className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white py-[8px] px-[21px] text-[11px] font-mono font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer rounded-none shadow-none"
                            >
                                {loading ? 'PROCESANDO...' : 'EJECUTAR REVOCACIÓN'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
