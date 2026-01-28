import { useEffect, useState } from 'react';
import { getTenants, updateTenantStatus } from '../services/api';
import { Check, X, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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

import { TenantDetailsModal } from '../components/admin/TenantDetailsModal';
import { Eye } from 'lucide-react';

export const Dashboard = () => {
    const { t } = useTranslation();
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);

    const [activeTab, setActiveTab] = useState<'PERSONAL' | 'ENTERPRISE'>('PERSONAL');

    const fetchTenants = async () => {
        try {
            const { data } = await getTenants();
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
            setSelectedTenant(null); // Close modal if open
        } catch (error) {
            alert('Error updating status');
        }
    };

    const filteredTenants = tenants.filter(t => {
        const matches = activeTab === 'ENTERPRISE'
            ? t.type === 'ENTERPRISE'
            : (t.type === 'PERSONAL' || t.type === 'EDUCATIONAL');
        // Debugging logs
        // console.log(`Tenant ${t.id} type:${t.type} matches ${activeTab}? ${matches}`);
        return matches;
    });

    useEffect(() => {
        console.log('[DEBUG] Active Tab:', activeTab);
        console.log('[DEBUG] Filtered Tenants Count:', filteredTenants.length);
    }, [activeTab, tenants]);

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{t('admin.inbox_title')}</h1>
                    <p className="text-slate-500 mt-1">{t('admin.inbox_subtitle')}</p>
                </div>

                {/* Tabs */}
                <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                    <button
                        onClick={() => setActiveTab('PERSONAL')}
                        className={clsx(
                            "px-4 py-2 text-sm font-medium rounded-md transition-all",
                            activeTab === 'PERSONAL'
                                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                        )}
                    >
                        Personas / Educacional
                    </button>
                    <button
                        onClick={() => setActiveTab('ENTERPRISE')}
                        className={clsx(
                            "px-4 py-2 text-sm font-medium rounded-md transition-all",
                            activeTab === 'ENTERPRISE'
                                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                        )}
                    >
                        Empresas (B2B)
                    </button>
                </div>
            </header>

            <div className="bg-antigravity-light-surface dark:bg-antigravity-dark-surface border border-antigravity-light-border dark:border-antigravity-dark-border rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">{t('admin.table.type')}</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                                {activeTab === 'ENTERPRISE' ? 'Razón Social' : t('admin.table.name')}
                            </th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                                {activeTab === 'ENTERPRISE' ? 'RUT Empresa' : 'RUN / ID'}
                            </th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">{t('admin.table.email')}</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">{t('admin.table.status')}</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-100 text-right">{t('admin.table.actions')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                        {loading ? (
                            <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-500">{t('admin.loading')}</td></tr>
                        ) : filteredTenants.length === 0 ? (
                            <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-500">{t('admin.no_pending')}</td></tr>
                        ) : filteredTenants.map((tenant) => (
                            <tr key={tenant.id} className="hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors">
                                <td className="px-6 py-4 text-center">
                                    <span className="material-symbols-rounded text-slate-500" title={tenant.type}>
                                        {tenant.type === 'ENTERPRISE' ? 'domain' : tenant.type === 'EDUCATIONAL' ? 'school' : 'person'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 font-medium text-slate-900 dark:text-slate-100">
                                    {tenant.type === 'ENTERPRISE'
                                        ? tenant.company_name
                                        : (tenant.full_name || tenant.institution_name)}
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
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => setSelectedTenant(tenant)}
                                            className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-antigravity-accent transition-colors"
                                            title="Ver Detalles"
                                        >
                                            <Eye size={18} />
                                        </button>

                                        {tenant.status === 'PENDING_APPROVAL' && (
                                            <>
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
                                            </>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <TenantDetailsModal
                isOpen={!!selectedTenant}
                onClose={() => setSelectedTenant(null)}
                tenant={selectedTenant}
                onAction={handleAction}
            />
        </div>
    );
};
