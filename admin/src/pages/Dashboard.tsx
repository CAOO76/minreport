import { useEffect, useState } from 'react';
import { getTenants, updateTenantStatus } from '../services/api';
import { Check, X, Clock, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { LanguageSwitch } from '../components/LanguageSwitch';
import clsx from 'clsx';

interface Tenant {
    id: string;
    type: 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';
    email: string;
    status: 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED';
    createdAt: any;
    company_name?: string;
    institution_name?: string;
    full_name?: string;
    rut?: string;
    run?: string;
}

export const Dashboard = () => {
    const { t } = useTranslation();
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    const handleLogout = () => {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_user');
        navigate('/login');
    };

    const fetchTenants = async () => {
        try {
            const { data } = await getTenants();
            console.log('[DASHBOARD] Tenants received:', data);
            setTenants(data);
        } catch (error) {
            console.error('Error fetching tenants:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTenants();
    }, []);

    const handleAction = async (id: string, status: 'ACTIVE' | 'REJECTED') => {
        try {
            await updateTenantStatus(id, status);
            setTenants(prev => prev.map(t => t.id === id ? { ...t, status } : t));
        } catch (error) {
            alert('Error updating status');
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <header className="mb-10 flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{t('admin.inbox_title')}</h1>
                    <p className="text-slate-500 mt-1">{t('admin.inbox_subtitle')}</p>
                </div>
                <div className="flex items-center gap-4">
                    <LanguageSwitch />
                    <ThemeSwitch />
                    <div className="w-px h-6 bg-slate-200 dark:bg-white/10 mx-1" />
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all font-medium text-sm border border-transparent hover:border-rose-100 dark:hover:border-rose-900/30"
                    >
                        <LogOut size={18} />
                        {t('admin.logout')}
                    </button>
                </div>
            </header>

            <div className="bg-surface-card-light dark:bg-surface-card-dark border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">{t('admin.table.type')}</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">{t('admin.table.name')}</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">{t('admin.table.rut')}</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">{t('admin.table.email')}</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">{t('admin.table.status')}</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-100 text-right">{t('admin.table.actions')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                        {loading ? (
                            <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-500">{t('admin.loading')}</td></tr>
                        ) : tenants.length === 0 ? (
                            <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-500">{t('admin.no_pending')}</td></tr>
                        ) : tenants.map((tenant) => (
                            <tr key={tenant.id} className="hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors">
                                <td className="px-6 py-4 text-center">
                                    <span className="material-symbols-rounded text-slate-500" title={tenant.type}>
                                        {tenant.type === 'ENTERPRISE' ? 'domain' : tenant.type === 'EDUCATIONAL' ? 'school' : 'person'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 font-medium text-slate-900 dark:text-slate-100">
                                    {tenant.company_name || tenant.institution_name || tenant.full_name}
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-500 tabular-nums">
                                    {tenant.rut || tenant.run}
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-500">
                                    {tenant.email}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={clsx(
                                        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide",
                                        tenant.status === 'PENDING_APPROVAL' && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                                        tenant.status === 'ACTIVE' && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                                        tenant.status === 'REJECTED' && "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                                    )}>
                                        {tenant.status === 'PENDING_APPROVAL' && <Clock size={10} />}
                                        {tenant.status === 'ACTIVE' && <Check size={10} />}
                                        {tenant.status === 'REJECTED' && <X size={10} />}
                                        {t(`admin.status.${tenant.status.toLowerCase().replace('_approval', '')}`)}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {tenant.status === 'PENDING_APPROVAL' && (
                                        <div className="flex justify-end gap-2">
                                            <button
                                                onClick={() => handleAction(tenant.id, 'ACTIVE')}
                                                className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                                                title="Aprobar"
                                            >
                                                <Check size={18} />
                                            </button>
                                            <button
                                                onClick={() => handleAction(tenant.id, 'REJECTED')}
                                                className="p-1.5 rounded-md text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                                                title="Rechazar"
                                            >
                                                <X size={18} />
                                            </button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
