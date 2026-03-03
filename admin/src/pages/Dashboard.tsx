import { useEffect, useState } from 'react';
import { getTenants, updateTenantStatus } from '../services/api';
import { Check, X, Clock, Settings, Eye, Search, Filter, Cpu, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { TenantDetailsModal } from '../components/admin/TenantDetailsModal';

interface Tenant {
    id: string;
    type: 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';
    email: string;
    status: 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED';
    createdAt: any;
    company_name?: string;
    institution_name?: string;
    applicant_name?: string;
    job_title?: string;
    full_name?: string;
    rut?: string;
    run?: string;
    entity_type?: string;
    industry?: string;
    billing_email?: string;
    website?: string;
    institution_website?: string;
    program_name?: string;
    graduation_date?: string;
    usage_profile?: string;
    address?: string;
    city?: string;
    commune?: string;
    region?: string;
    postal_code?: string;
    processedBy?: string;
    processedAt?: string;
    rejectionReason?: string;
    observations?: string;
    enabledPlugins?: string[];
    profile?: string;
    country?: string;
    email_domain?: string;
}

export const Dashboard = () => {
    const { t } = useTranslation();
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
    const [activeTab, setActiveTab] = useState<'PERSONAL' | 'ENTERPRISE' | 'EDUCATIONAL'>('PERSONAL');
    const [searchTerm, setSearchTerm] = useState('');
    const [showRejected, setShowRejected] = useState(false);

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

    const pendingCounts = {
        PERSONAL: tenants.filter(t => t.type === 'PERSONAL' && t.status === 'PENDING_APPROVAL').length,
        EDUCATIONAL: tenants.filter(t => t.type === 'EDUCATIONAL' && t.status === 'PENDING_APPROVAL').length,
        ENTERPRISE: tenants.filter(t => t.type === 'ENTERPRISE' && t.status === 'PENDING_APPROVAL').length,
    };

    const handleAction = async (id: string, status: 'ACTIVE' | 'REJECTED', data?: { rejectionReason?: string, observations?: string, enabledPlugins?: string[] }) => {
        try {
            await updateTenantStatus(id, status, data);
            setTenants(prev => prev.map(t => {
                if (t.id === id) {
                    return {
                        ...t,
                        status,
                        ...data,
                        processedAt: new Date().toISOString(),
                        ...(data?.enabledPlugins ? { enabledPlugins: data.enabledPlugins } : {})
                    };
                }
                return t;
            }));

            if (status !== 'ACTIVE' || (data && !data.enabledPlugins)) {
                setSelectedTenant(null);
            } else {
                setSelectedTenant(prev => prev ? { ...prev, ...data } : null);
            }
        } catch (error) {
            console.error(error);
            alert('Error updating status');
        }
    };

    const filteredTenants = tenants.filter(t => {
        const matchesTab = t.type === activeTab;
        const matchesStatus = showRejected ? t.status === 'REJECTED' : t.status === 'PENDING_APPROVAL';
        const searchLower = searchTerm.toLowerCase();
        const matchesSearch =
            t.email.toLowerCase().includes(searchLower) ||
            (t.company_name?.toLowerCase().includes(searchLower)) ||
            (t.full_name?.toLowerCase().includes(searchLower)) ||
            (t.rut?.toLowerCase().includes(searchLower)) ||
            (t.run?.toLowerCase().includes(searchLower));
        return matchesTab && matchesSearch && matchesStatus;
    });

    const TabButton = ({ type, symbol, count }: { type: typeof activeTab, symbol: string, count: number }) => {
        return (
            <button
                onClick={() => setActiveTab(type)}
                className={clsx(
                    "flex-1 flex items-center justify-center h-14 transition-all duration-500 relative group/tab",
                    activeTab === type
                        ? "text-antigravity-accent"
                        : "text-black/30 dark:text-white/20 hover:text-black/60 dark:hover:text-white/50"
                )}
            >
                <div className="relative flex flex-col items-center">
                    <span className={clsx(
                        "material-symbols-rounded text-[22px] transition-transform duration-500",
                        activeTab === type ? "scale-110" : "opacity-60"
                    )}>
                        {symbol}
                    </span>
                    {count > 0 && (
                        <span className="absolute -top-1.5 -right-3 px-1.5 py-0.5 bg-antigravity-accent text-white text-[8px] font-black leading-none min-w-[14px] flex items-center justify-center rounded-none shadow-sm animate-in zoom-in-50 duration-300">
                            {count}
                        </span>
                    )}
                </div>
                {activeTab === type && (
                    <div className="absolute bottom-3 w-1 h-1 bg-antigravity-accent rounded-none"></div>
                )}
            </button>
        );
    };

    return (
        <div className="space-y-10 animate-in fade-in duration-1000 pb-24">
            <header className="flex items-center justify-between gap-8 pb-10 border-b border-black/5 dark:border-white/5 relative z-20">
                <div className="flex items-center gap-8">
                    <div className="flex flex-col">
                        <span className="text-[8px] font-black text-antigravity-accent tracking-[.3em] uppercase italic opacity-60">CENTRAL_CORE</span>
                        <h1 className="text-4xl font-black text-black dark:text-white tracking-tighter m-0 uppercase italic leading-none">
                            INBOX
                        </h1>
                    </div>

                    <div className="w-[1px] h-10 bg-black/10 dark:bg-white/10"></div>

                    {/* 1. Account type selectors (Left) */}
                    <div className="flex gap-4 items-center">
                        <TabButton type="PERSONAL" symbol="person" count={pendingCounts.PERSONAL} />
                        <TabButton type="EDUCATIONAL" symbol="school" count={pendingCounts.EDUCATIONAL} />
                        <TabButton type="ENTERPRISE" symbol="domain" count={pendingCounts.ENTERPRISE} />
                    </div>
                </div>

                {/* 2. Search Bar (Center/Auto-expand) */}
                <div className="relative flex-1 max-w-3xl group px-4">
                    <Search className="absolute left-10 top-1/2 -translate-y-1/2 text-black/20 dark:text-white/20 group-focus-within:text-antigravity-accent transition-colors" size={18} />
                    <input
                        type="text"
                        placeholder="SEARCH_REGISTRY_HASH..."
                        autoComplete="off"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="premium-input !pl-14 !rounded-none !py-4 shadow-none focus:shadow-none border-0 bg-transparent"
                    />
                    <div className="absolute bottom-0 left-4 right-4 h-[1px] bg-black/5 dark:bg-white/5 group-focus-within:bg-antigravity-accent/30 transition-all"></div>
                </div>

                {/* 3. Account status toggle (Right) */}
                <button
                    onClick={() => setShowRejected(!showRejected)}
                    className={clsx(
                        "flex items-center gap-2 px-6 py-4 transition-all duration-500 rounded-none w-20 justify-center group/toggle relative",
                        showRejected
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                    )}
                    title={showRejected ? 'VIEW_PENDING' : 'VIEW_REJECTED'}
                >
                    <span className="material-symbols-rounded text-[24px] transition-transform duration-500 group-hover/toggle:scale-110">
                        {showRejected ? 'cancel' : 'history'}
                    </span>
                    {showRejected && (
                        <div className="absolute top-3 right-5 w-1.5 h-1.5 bg-rose-500 rounded-none animate-pulse"></div>
                    )}
                </button>
            </header>

            <div className="elite-tech-surface rounded-none shadow-3xl overflow-hidden border-black/5 dark:border-white/5 relative bg-white/[0.01] dark:bg-black/[0.01]">
                <div className="absolute inset-0 technical-grid pointer-events-none opacity-20"></div>

                <div className="overflow-x-auto relative z-10">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-black/5 dark:bg-white/5 border-b border-black/10 dark:border-white/10">
                                <th className="px-10 py-6 hud-label">
                                    <span className="material-symbols-rounded text-[24px]">
                                        {activeTab === 'ENTERPRISE' ? 'domain' : activeTab === 'EDUCATIONAL' ? 'school' : 'person'}
                                    </span>
                                </th>
                                <th className="px-10 py-6 hud-label">
                                    <span className="material-symbols-rounded text-[24px]">person_check</span>
                                </th>
                                <th className="px-10 py-6 hud-label">
                                    <span className="material-symbols-rounded text-[24px]">id_card</span>
                                </th>
                                <th className="px-10 py-6 hud-label">
                                    <span className="material-symbols-rounded text-[24px]">alternate_email</span>
                                </th>
                                <th className="px-10 py-6 hud-label text-right">
                                    <span className="material-symbols-rounded text-[24px]">visibility</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5 dark:divide-white/5">
                            {loading ? (
                                <tr><td colSpan={5} className="px-10 py-24 text-center">
                                    <div className="flex flex-col items-center gap-4 animate-pulse opacity-40">
                                        <Cpu size={40} className="animate-spin duration-[3s]" />
                                        <span className="hud-label italic tracking-[0.3em]">SYNCHRONIZING_CORE_DATA...</span>
                                    </div>
                                </td></tr>
                            ) : filteredTenants.length === 0 ? (
                                <tr><td colSpan={5} className="px-10 py-24 text-center">
                                    <div className="flex flex-col items-center gap-4 opacity-10 grayscale">
                                        <Zap size={60} />
                                        <span className="hud-label italic tracking-[0.4em]">INBOX_CLEAN_NO_PENDING_TASKS</span>
                                    </div>
                                </td></tr>
                            ) : filteredTenants.map((tenant) => (
                                <tr key={tenant.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-all duration-500 group">
                                    <td className="px-10 py-8">
                                        <div className="flex items-center gap-5">
                                            <div className={clsx(
                                                "w-12 h-12 rounded-none flex items-center justify-center shadow-lg transition-transform duration-500 group-hover:scale-110",
                                                tenant.status === 'PENDING_APPROVAL' ? "bg-antigravity-accent text-white" : "bg-black/5 dark:bg-white/10 text-black/40 dark:text-white/40"
                                            )}>
                                                <span className="text-sm font-black italic">
                                                    {(tenant.company_name || tenant.full_name || tenant.institution_name)?.substring(0, 2).toUpperCase()}
                                                </span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-sm font-black text-black dark:text-white uppercase tracking-tighter">
                                                    {tenant.type === 'ENTERPRISE' ? tenant.company_name : (tenant.full_name || tenant.institution_name)}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-10 py-8">
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-black text-black dark:text-white uppercase tracking-tight">
                                                {tenant.applicant_name || tenant.full_name}
                                                {tenant.job_title && (
                                                    <span className="text-black/30 dark:text-white/20"> / {tenant.job_title}</span>
                                                )}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-10 py-8">
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-black text-black/40 dark:text-white/30 uppercase font-mono tracking-widest grayscale group-hover:grayscale-0 transition-all">
                                                {tenant.rut || tenant.run}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-10 py-8">
                                        <span className="text-[12px] font-bold text-antigravity-accent tracking-tighter opacity-70 group-hover:opacity-100 transition-opacity">
                                            {tenant.email.toLowerCase()}
                                        </span>
                                    </td>
                                    <td className="px-10 py-8">
                                        <div className="flex justify-center">
                                            <span className={clsx(
                                                "inline-flex items-center gap-2.5 px-4 py-1.5 rounded-none text-[9px] font-black uppercase tracking-[0.2em] border shadow-sm transition-all duration-700",
                                                tenant.status === 'PENDING_APPROVAL' && "bg-amber-500/10 text-amber-600 border-amber-500/20 shadow-amber-500/5",
                                                tenant.status === 'ACTIVE' && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 shadow-emerald-500/5",
                                                tenant.status === 'REJECTED' && "bg-rose-500/10 text-rose-600 border-rose-500/20 shadow-rose-500/5"
                                            )}>
                                                <div className={clsx(
                                                    "w-1.5 h-1.5 rounded-none",
                                                    tenant.status === 'PENDING_APPROVAL' ? "bg-amber-500 animate-pulse" :
                                                        tenant.status === 'ACTIVE' ? "bg-emerald-500" : "bg-rose-500"
                                                )}></div>
                                                {t(`admin.status.${tenant.status.toLowerCase().replace('_approval', '')}`)}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-10 py-8 text-right">
                                        <div className="flex justify-end gap-3 opacity-0 group-hover:opacity-100 translate-x-4 group-hover:translate-x-0 transition-all duration-500">
                                            <button
                                                onClick={() => setSelectedTenant(tenant)}
                                                className="w-12 h-12 rounded-none flex items-center justify-center transition-all bg-black/5 dark:bg-white/5 text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white active:scale-90 border border-transparent hover:border-antigravity-accent/30"
                                                title="View Detailed Protocol"
                                            >
                                                <Eye size={20} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
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
