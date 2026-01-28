import { useEffect, useState } from 'react';
import { getAccounts } from '../services/api';
import { useTranslation } from 'react-i18next';
import { Building, Users, AlertTriangle, ArrowRight, Activity } from 'lucide-react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';

interface Account {
    id: string;
    name: string;
    type: string;
    rut?: string;
    status?: string;
    ownerId: string;
    createdAt: string;
}

export const EnterpriseManagement = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadAccounts();
    }, []);

    const loadAccounts = async () => {
        try {
            const { data } = await getAccounts('ENTERPRISE');
            setAccounts(data);
        } catch (error) {
            console.error('Error loading enterprise accounts:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <header className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
                    <Building className="text-antigravity-accent" size={32} />
                    Gestión de Empresas B2B
                </h1>
                <p className="text-slate-500 mt-1">Administra cuentas corporativas, membresías y estados de servicio.</p>
            </header>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">RUT Empresa</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Razón Social</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Estado</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Fecha Alta</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                        {loading ? (
                            <tr><td colSpan={5} className="px-6 py-10 text-center text-slate-500">Cargando empresas...</td></tr>
                        ) : accounts.length === 0 ? (
                            <tr><td colSpan={5} className="px-6 py-10 text-center text-slate-500">No hay empresas registradas.</td></tr>
                        ) : accounts.map((account) => (
                            <tr key={account.id} className="hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors group">
                                <td className="px-6 py-4 text-sm font-mono text-slate-600 dark:text-slate-400">
                                    {account.rut || 'N/A'}
                                </td>
                                <td className="px-6 py-4 font-medium text-slate-900 dark:text-slate-100">
                                    {account.name}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={clsx(
                                        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide",
                                        (!account.status || account.status === 'ACTIVE') && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                                        account.status === 'SUSPENDED' && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                                        account.status === 'LOCKED' && "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                                    )}>
                                        <Activity size={10} />
                                        {account.status || 'ACTIVO'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-500">
                                    {new Date(account.createdAt).toLocaleDateString()}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <button
                                        onClick={() => navigate(`/enterprises/${account.id}`)}
                                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-antigravity-accent hover:text-white transition-all"
                                    >
                                        Gestionar
                                        <ArrowRight size={14} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
