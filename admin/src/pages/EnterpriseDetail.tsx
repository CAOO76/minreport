import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../config/firebase'; // Client SDK
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { ArrowLeft, Users, Shield, CreditCard, AlertTriangle, UserCheck, Activity, ShieldCheck, Globe, Trash2, Power } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { deleteTenant } from '../services/api'; // Reuse delete backend logic

interface User {
    uid: string;
    email: string;
    displayName: string;
    photoURL?: string;
    memberships: any[];
    status?: string;
}

export const EnterpriseDetail = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { t } = useTranslation();

    const [account, setAccount] = useState<any>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => {
        if (id) {
            fetchData();
        }
    }, [id]);

    const fetchData = async () => {
        try {
            const accRef = doc(db, 'accounts', id!);
            const accSnap = await getDoc(accRef);

            if (accSnap.exists()) {
                setAccount({ id: accSnap.id, ...accSnap.data() });
            } else {
                navigate('/b2b');
                return;
            }

            const usersSnap = await getDocs(collection(db, 'users'));
            const accountUsers = usersSnap.docs
                .map(d => d.data() as User)
                .filter(u => u.memberships?.some(m => m.accountId === id));

            setUsers(accountUsers);
        } catch (error) {
            console.error('Error fetching details:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateStatus = async (newStatus: 'ACTIVE' | 'SUSPENDED' | 'LOCKED') => {
        if (!confirm(`¿Estás seguro de cambiar el estado a ${newStatus}? Esto afectará a todos los usuarios.`)) return;

        setActionLoading(true);
        try {
            await updateDoc(doc(db, 'accounts', id!), {
                status: newStatus,
                updatedAt: new Date().toISOString()
            });
            setAccount((prev: any) => ({ ...prev, status: newStatus }));
        } catch (error) {
            console.error('Error updating status:', error);
            alert('Error al actualizar estado');
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (!confirm('PELIGRO: ¿Estás seguro de eliminar esta cuenta y TODOS sus datos asociados? Esta acción no se puede deshacer.')) return;

        setActionLoading(true);
        try {
            await deleteTenant(id!);
            alert('Cuenta eliminada correctamente');
            navigate('/b2b');
        } catch (error) {
            console.error('Error deleting account:', error);
            alert('Error al eliminar cuenta');
            setActionLoading(false);
        }
    };

    const getRoleBadge = (user: User) => {
        const membership = user.memberships?.find(m => m.accountId === id);
        const role = membership?.role;

        if (role === 'BILLING_ONLY') return (
            <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-none text-[10px] font-black uppercase tracking-widest">
                <CreditCard size={10} /> Comprador
            </div>
        );
        if (role === 'OWNER') return (
            <div className="flex items-center gap-2 px-3 py-1 bg-purple-500/10 text-purple-500 border border-purple-500/20 rounded-full text-[10px] font-black uppercase tracking-widest">
                <Shield size={10} /> Admin_Core
            </div>
        );
        return (
            <div className="flex items-center gap-2 px-3 py-1 bg-black/5 dark:bg-white/10 text-black/40 dark:text-white/40 border border-black/5 dark:border-white/5 rounded-full text-[10px] font-black uppercase tracking-widest">
                Operador
            </div>
        );
    };

    if (loading) return (
        <div className="p-12 flex flex-col items-center justify-center space-y-6">
            <div className="w-16 h-16 border-b-2 border-antigravity-accent rounded-none animate-spin"></div>
            <div className="hud-label animate-pulse tracking-[1em]">ACCESSING_NODE_DATA</div>
        </div>
    );

    const billingUsers = users.filter(u => u.memberships?.find(m => m.accountId === id)?.role === 'BILLING_ONLY');
    const operationalUsers = users.filter(u => {
        const role = u.memberships?.find(m => m.accountId === id)?.role;
        return role !== 'BILLING_ONLY';
    });

    return (
        <div className="space-y-12 animate-in fade-in duration-1000 pb-24">
            <header className="flex flex-col gap-8">
                <button
                    onClick={() => navigate('/b2b')}
                    className="group flex items-center gap-3 text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-all text-xs font-black uppercase tracking-widest"
                >
                    <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
                    Inventory_Return
                </button>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-10">
                    <div className="space-y-4">
                        <div className="flex items-center gap-4">
                            <h1 className="text-6xl font-black text-black dark:text-white tracking-tighter m-0 uppercase italic">
                                {account?.name}
                            </h1>
                            <div className={clsx(
                                "px-6 py-2 rounded-none text-[10px] font-black uppercase tracking-[0.3em] border shadow-premium animate-pulse",
                                (!account?.status || account?.status === 'ACTIVE') ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                                    account?.status === 'SUSPENDED' ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                                        "bg-rose-500/10 text-rose-500 border-rose-500/20"
                            )}>
                                {account?.status || 'LINKED_NODE'}
                            </div>
                        </div>
                        <div className="flex items-center gap-6 hud-label !text-black/30 dark:!text-white/20">
                            <span className="flex items-center gap-2"><Globe size={14} /> RUT_{account?.rut || 'UNDEFINED'}</span>
                            <span className="flex items-center gap-2 italic">UUID_{account?.id}</span>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="p-1 elite-tech-surface flex rounded-none border-white/5 shadow-2xl overflow-hidden">
                            {(!account?.status || account?.status === 'ACTIVE') ? (
                                <button
                                    disabled={actionLoading}
                                    onClick={() => handleUpdateStatus('SUSPENDED')}
                                    className="px-6 py-4 bg-amber-500 text-white hover:bg-amber-600 font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-3"
                                >
                                    <Power size={14} />
                                    Suspend_Core
                                </button>
                            ) : (
                                <button
                                    disabled={actionLoading}
                                    onClick={() => handleUpdateStatus('ACTIVE')}
                                    className="px-6 py-4 bg-emerald-500 text-white hover:bg-emerald-600 font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-3"
                                >
                                    <Activity size={14} />
                                    Reactivate_Node
                                </button>
                            )}
                            <button
                                disabled={actionLoading}
                                onClick={handleDeleteAccount}
                                className="px-6 py-4 bg-rose-600 text-white hover:bg-rose-700 font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-3"
                            >
                                <Trash2 size={14} />
                                Purge_Data
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-12">
                {/* Billing / Buyers */}
                <section className="space-y-6">
                    <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-[2px] bg-antigravity-accent opacity-30"></div>
                            <h2 className="hud-label m-0">Commercial_Protocol_Staff</h2>
                        </div>
                        <span className="text-[10px] font-black text-black/20 dark:text-white/10 uppercase font-mono">COUNT_{billingUsers.length}</span>
                    </div>

                    <div className="elite-tech-surface rounded-none shadow-3xl overflow-hidden border-black/5 dark:border-white/5 relative">
                        <div className="absolute inset-0 technical-grid pointer-events-none opacity-20"></div>
                        {billingUsers.length === 0 ? (
                            <div className="p-20 text-center hud-label opacity-20 relative z-10">NULL_BILLING_STAFF</div>
                        ) : (
                            <ul className="divide-y divide-black/5 dark:divide-white/5 relative z-10 m-0">
                                {billingUsers.map(user => (
                                    <li key={user.uid} className="p-8 flex items-center justify-between group hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
                                        <div className="flex items-center gap-5">
                                            <div className="w-12 h-12 rounded-none bg-black dark:bg-white flex items-center justify-center text-white dark:text-black font-black text-xs shadow-premium">
                                                {user.displayName?.[0] || 'U'}
                                            </div>
                                            <div>
                                                <p className="text-base font-black text-black dark:text-white uppercase tracking-tight italic m-0">{user.displayName}</p>
                                                <p className="text-[10px] font-bold text-black/30 dark:text-white/20 tracking-widest m-0">{user.email.toLowerCase()}</p>
                                            </div>
                                        </div>
                                        {getRoleBadge(user)}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </section>

                {/* Operational Staff */}
                <section className="space-y-6">
                    <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-[2px] bg-antigravity-accent opacity-30"></div>
                            <h2 className="hud-label m-0">Operational_Core_Nodes</h2>
                        </div>
                        <span className="text-[10px] font-black text-black/20 dark:text-white/10 uppercase font-mono">COUNT_{operationalUsers.length}</span>
                    </div>

                    <div className="elite-tech-surface rounded-none shadow-3xl overflow-hidden border-black/5 dark:border-white/5 relative">
                        <div className="absolute inset-0 technical-grid pointer-events-none opacity-20"></div>
                        {operationalUsers.length === 0 ? (
                            <div className="p-20 text-center hud-label opacity-20 relative z-10">NULL_OPERATIONAL_STAFF</div>
                        ) : (
                            <ul className="divide-y divide-black/5 dark:divide-white/5 relative z-10 m-0">
                                {operationalUsers.map(user => (
                                    <li key={user.uid} className="p-8 flex items-center justify-between group hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
                                        <div className="flex items-center gap-5">
                                            <div className="relative">
                                                <div className="absolute -inset-1 bg-antigravity-accent opacity-0 group-hover:opacity-40 blur-sm transition-opacity rounded-none"></div>
                                                <div className="relative w-12 h-12 rounded-none bg-antigravity-accent/10 border border-antigravity-accent/20 flex items-center justify-center text-antigravity-accent font-black text-xs shadow-lg">
                                                    {user.displayName?.[0] || 'U'}
                                                </div>
                                            </div>
                                            <div>
                                                <p className="text-base font-black text-black dark:text-white uppercase tracking-tight italic m-0 group-hover:text-antigravity-accent transition-colors">{user.displayName}</p>
                                                <p className="text-[10px] font-bold text-black/30 dark:text-white/20 tracking-widest m-0">{user.email.toLowerCase()}</p>
                                            </div>
                                        </div>
                                        {getRoleBadge(user)}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </section>
            </div>

            <div className="p-10 rounded-none glass-card border-amber-500/20 bg-amber-500/5 flex gap-8 items-start relative overflow-hidden">
                <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none"></div>
                <div className="w-14 h-14 rounded-none bg-amber-500/10 flex items-center justify-center shrink-0 shadow-lg">
                    <AlertTriangle className="text-amber-500" size={28} />
                </div>
                <div className="space-y-4 relative z-10">
                    <h5 className="text-amber-600 dark:text-amber-500 font-black text-xs uppercase tracking-[0.3em] flex items-center gap-3 m-0 italic">
                        Node_Action_Protocol_Alpha_v2
                    </h5>
                    <p className="text-[11px] text-amber-700/60 dark:text-amber-400/50 font-black uppercase tracking-widest leading-loose max-w-2xl m-0">
                        <strong>Technical_Notice:</strong> Los usuarios listados pertenecen a la cuenta empresarial identificada bajo el RUT de nodo.
                        La ejecución de la purga de datos desconectará irreversiblemente todos los enlaces operativos, pero conservará la identidad atómica de los usuarios si poseen privilegios en otros nodos del sistema.
                    </p>
                </div>
            </div>

            <footer className="pt-12 border-t border-black/5 dark:border-white/5 flex flex-col md:flex-row justify-between gap-6 hud-label !text-[10px] !text-black/20 dark:!text-white/20">
                <div className="flex items-center gap-4">
                    <ShieldCheck className="text-emerald-500" size={14} />
                    B2B_PROTOCOL_ENFORCEMENT_VERIFIED
                </div>
                <div className="italic tracking-widest uppercase">Encryption_Level: AES-256-INDUSTRIAL_GRADE</div>
            </footer>
        </div>
    );
};
