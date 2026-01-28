import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../config/firebase'; // Client SDK
import { doc, getDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { ArrowLeft, Users, Shield, CreditCard, AlertTriangle, UserCheck } from 'lucide-react';
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
            // 1. Get Account Details
            const accRef = doc(db, 'accounts', id!);
            const accSnap = await getDoc(accRef);

            if (accSnap.exists()) {
                setAccount({ id: accSnap.id, ...accSnap.data() });
            } else {
                console.error('Account not found');
                navigate('/enterprises');
                return;
            }

            // 2. Get All Users and Filter (Inefficient but works for now without backend index changes)
            // TODO: Implement cleaner backend search
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
            // TODO: Call backend to kill sessions if needed
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
            // Use existing backend endpoint which handles cascade delete
            await deleteTenant(id!);
            alert('Cuenta eliminada correctamente');
            navigate('/enterprises');
        } catch (error) {
            console.error('Error deleting account:', error);
            alert('Error al eliminar cuenta');
            setActionLoading(false);
        }
    };

    const getRoleBadge = (user: User) => {
        const membership = user.memberships?.find(m => m.accountId === id);
        const role = membership?.role;

        if (role === 'BILLING_ONLY') return <span className="bg-emerald-100 text-emerald-800 text-xs px-2 py-1 rounded-full flex items-center gap-1"><CreditCard size={10} /> Comprador</span>;
        if (role === 'OWNER') return <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded-full flex items-center gap-1"><Shield size={10} /> Dueño/Admin</span>;
        return <span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full">Operador</span>;
    };

    if (loading) return <div className="p-10 text-center text-slate-500">Cargando información de la empresa...</div>;

    // Group Users
    const billingUsers = users.filter(u => u.memberships?.find(m => m.accountId === id)?.role === 'BILLING_ONLY');
    const operationalUsers = users.filter(u => {
        const role = u.memberships?.find(m => m.accountId === id)?.role;
        return role !== 'BILLING_ONLY'; // Owners, Admins, Operators
    });

    return (
        <div className="p-8 max-w-7xl mx-auto">
            {/* Header Navigation */}
            <button
                onClick={() => navigate('/enterprises')}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-6 transition-colors"
            >
                <ArrowLeft size={20} />
                Volver al listado
            </button>

            {/* Account Header */}
            <header className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        {account?.name}
                        <span className={clsx(
                            "text-xs px-2 py-1 rounded-full border",
                            account?.status === 'SUSPENDED' ? "bg-amber-50 border-amber-200 text-amber-700" :
                                account?.status === 'LOCKED' ? "bg-red-50 border-red-200 text-red-700" :
                                    "bg-emerald-50 border-emerald-200 text-emerald-700"
                        )}>
                            {account?.status || 'ACTIVO'}
                        </span>
                    </h1>
                    <div className="flex gap-4 mt-2 text-sm text-slate-500 font-mono">
                        <span>RUT: {account?.rut || 'N/A'}</span>
                        <span>ID: {account?.id}</span>
                    </div>
                </div>

                <div className="flex gap-2">
                    {(!account?.status || account?.status === 'ACTIVE') ? (
                        <button
                            disabled={actionLoading}
                            onClick={() => handleUpdateStatus('SUSPENDED')}
                            className="px-4 py-2 bg-amber-100 text-amber-800 hover:bg-amber-200 rounded-lg text-sm font-medium transition-colors"
                        >
                            Suspender Servicio
                        </button>
                    ) : (
                        <button
                            disabled={actionLoading}
                            onClick={() => handleUpdateStatus('ACTIVE')}
                            className="px-4 py-2 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 rounded-lg text-sm font-medium transition-colors"
                        >
                            Reactivar Servicio
                        </button>
                    )}

                    <button
                        disabled={actionLoading}
                        onClick={handleDeleteAccount}
                        className="px-4 py-2 bg-red-100 text-red-800 hover:bg-red-200 rounded-lg text-sm font-medium transition-colors"
                    >
                        Eliminar Cuenta
                    </button>
                </div>
            </header>

            {/* Users Sections */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Billing / Buyers */}
                <section>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        <CreditCard className="text-antigravity-accent" size={20} />
                        Gestión Comercial / Compradores
                    </h2>
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                        {billingUsers.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 text-sm">No hay usuarios de facturación asignados.</div>
                        ) : (
                            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                                {billingUsers.map(user => (
                                    <li key={user.uid} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-xs">
                                                {user.displayName?.[0] || 'U'}
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-slate-900 dark:text-white">{user.displayName}</p>
                                                <p className="text-xs text-slate-500">{user.email}</p>
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
                <section>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        <Users className="text-antigravity-accent" size={20} />
                        Usuarios Operativos (Dueños/Staff)
                    </h2>
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                        {operationalUsers.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 text-sm">No hay usuarios operativos registrados.</div>
                        ) : (
                            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                                {operationalUsers.map(user => (
                                    <li key={user.uid} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-xs">
                                                {user.displayName?.[0] || 'U'}
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-slate-900 dark:text-white">{user.displayName}</p>
                                                <p className="text-xs text-slate-500">{user.email}</p>
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

            <div className="mt-8 p-4 bg-blue-50 text-blue-800 rounded-lg text-sm border border-blue-100 flex items-start gap-3">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <p>
                    <strong>Nota sobre B2B:</strong> Los usuarios listados aquí pertenecen a la cuenta empresarial identificada por el RUT.
                    Eliminar la cuenta suspenderá el acceso de todos estos usuarios a este espacio de trabajo específico,
                    pero no eliminará sus cuentas personales si tienen acceso a otras empresas.
                </p>
            </div>
        </div>
    );
};
