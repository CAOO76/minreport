import { useEffect, useState } from 'react';
import { getTenants, updateTenantStatus, deleteTenant } from '../../services/api';
import { Check, X, Clock, Trash2, Eye, Ban, Settings, Blocks, Cpu, ShieldCheck, Zap, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { UserManagementDrawer } from './UserManagementDrawer';
import { ConfirmationModal } from './ConfirmationModal';
import { TenantDetailsModal } from './TenantDetailsModal';
import { TenantPluginsModal } from './TenantPluginsModal';
import { useAdminUsers } from '../../hooks/useAdminUsers';
import { UserProfile } from '../../types/admin';

interface Tenant {
    id: string;
    type: 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';
    email: string;
    status: 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'DELETED' | 'APPROVED';
    createdAt: any;
    company_name?: string;
    institution_name?: string;
    full_name?: string;
    rut?: string;
    run?: string;
    enabledPlugins?: string[];
}

interface TenantListProps {
    type: 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';
    title: string;
    subtitle: string;
}

export const TenantList: React.FC<TenantListProps> = ({ type, title, subtitle }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const { toggleUserPlugin, updateUserStatus } = useAdminUsers();

    const [managingUser, setManagingUser] = useState<UserProfile | null>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
    const [selectedPluginTenant, setSelectedPluginTenant] = useState<Tenant | null>(null);
    const [actionModal, setActionModal] = useState<{ isOpen: boolean, tenant: Tenant | null, action: 'DELETE' | 'SUSPEND' } | null>(null);

    const fetchTenants = async () => {
        try {
            const { data } = await getTenants();
            setTenants(data.filter((t: Tenant) => t.type === type && (t.status === 'ACTIVE' || t.status === 'SUSPENDED' || t.status === 'APPROVED')));
        } catch (error) {
            console.error('Error fetching tenants:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTenants();
    }, [type]);

    const handleManageUser = (tenant: Tenant) => {
        const profile: UserProfile = {
            uid: tenant.id,
            email: tenant.email,
            displayName: tenant.type === 'ENTERPRISE' ? tenant.company_name! : (tenant.full_name || tenant.institution_name!),
            role: 'USER',
            status: tenant.status as any,
            entitlements: {
                pluginsEnabled: tenant.enabledPlugins || [],
                storageLimit: 0
            },
            stats: {
                lastLogin: '',
                storageUsed: 0
            }
        };
        setManagingUser(profile);
        setIsDrawerOpen(true);
    };

    const handleAction = async (id: string, status: 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'DELETED', data?: any) => {
        try {
            await updateTenantStatus(id, status as any, data);
            setTenants(prev => prev.map(t => {
                if (t.id === id) {
                    return {
                        ...t,
                        status: status as any,
                        ...(data?.enabledPlugins ? { enabledPlugins: data.enabledPlugins } : {})
                    };
                }
                return t;
            }));
            setActionModal(null);
            if (status !== 'ACTIVE') {
                setSelectedTenant(null);
            }
        } catch (error) {
            alert('Error updating status');
        }
    };

    const handleUpdatePlugins = async (tenantId: string, newPlugins: string[]) => {
        try {
            await updateTenantStatus(tenantId, 'ACTIVE', { enabledPlugins: newPlugins });
            setTenants(prev => prev.map(t => {
                if (t.id === tenantId) {
                    return { ...t, enabledPlugins: newPlugins };
                }
                return t;
            }));
            setSelectedPluginTenant(prev => prev ? { ...prev, enabledPlugins: newPlugins } : null);
        } catch (error) {
            console.error('Failed to update plugins', error);
            alert('Error al actualizar plugins');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteTenant(id);
            setTenants(prev => prev.filter(t => t.id !== id));
            setActionModal(null);
        } catch (error) {
            console.error('Error deleting tenant:', error);
            alert('Error al eliminar la cuenta. Verifica los permisos.');
        }
    };

    return (
        <div className="space-y-10 animate-in fade-in duration-1000 pb-24">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div className="space-y-3">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-[2px] bg-antigravity-accent"></div>
                        <span className="hud-label !text-antigravity-accent italic">ACCOUNT_TENANT_PROTOCOL</span>
                    </div>
                    <h1 className="text-5xl font-black text-black dark:text-white tracking-tighter m-0 uppercase italic">
                        {title.replace(' ', '_')}
                    </h1>
                    <p className="text-black/50 dark:text-white/40 font-medium text-base max-w-xl leading-relaxed">
                        {subtitle}
                    </p>
                </div>

                <div className="flex gap-4">
                    <div className="p-4 glass-card flex items-center gap-4 border-black/5 dark:border-white/5">
                        <div className="w-10 h-10 bg-black/5 dark:bg-white/10 rounded-none flex items-center justify-center text-antigravity-accent">
                            <Zap size={20} />
                        </div>
                        <div>
                            <div className="text-[9px] font-black text-black/30 dark:text-white/20 uppercase tracking-widest">Active_Nodes</div>
                            <div className="text-xl font-black text-black dark:text-white font-mono">{tenants.filter(t => t.status === 'ACTIVE').length}</div>
                        </div>
                    </div>
                </div>
            </header>

            <div className="elite-tech-surface rounded-none shadow-3xl overflow-hidden border-black/5 dark:border-white/5 relative">
                <div className="absolute inset-0 technical-grid pointer-events-none opacity-20"></div>

                <div className="overflow-x-auto relative z-10">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-black/5 dark:bg-white/5 border-b border-black/10 dark:border-white/10">
                                <th className="px-10 py-6 hud-label">
                                    {type === 'ENTERPRISE' ? 'Entity_Identity' : type === 'EDUCATIONAL' ? 'Campus_Registry' : 'Subject_Name'}
                                </th>
                                <th className="px-10 py-6 hud-label">
                                    {type === 'ENTERPRISE' ? 'Fiscal_RUT' : 'Civil_RUN'}
                                </th>
                                <th className="px-10 py-6 hud-label">Digital_Endpoint</th>
                                <th className="px-10 py-6 hud-label text-center">Status_Matrix</th>
                                <th className="px-10 py-6 hud-label text-right">Protocol_Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5 dark:divide-white/5">
                            {loading ? (
                                <tr><td colSpan={5} className="px-10 py-24 text-center">
                                    <div className="flex flex-col items-center gap-4 animate-pulse opacity-40">
                                        <Cpu size={40} className="animate-spin duration-[3s]" />
                                        <span className="hud-label italic tracking-[0.3em]">SYNCHRONIZING_DATA_STREAM...</span>
                                    </div>
                                </td></tr>
                            ) : tenants.length === 0 ? (
                                <tr><td colSpan={5} className="px-10 py-24 text-center">
                                    <div className="flex flex-col items-center gap-4 opacity-10 grayscale">
                                        <ShieldCheck size={60} />
                                        <span className="hud-label italic tracking-[0.4em]">NO_RECORDS_IN_CURRENT_BUFFER</span>
                                    </div>
                                </td></tr>
                            ) : tenants.map((tenant) => (
                                <tr key={tenant.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group">
                                    <td className="px-10 py-6">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-none bg-black dark:bg-white text-white dark:text-black flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                                                <span className="text-[12px] font-black italic">
                                                    {(type === 'ENTERPRISE' ? tenant.company_name : (tenant.full_name || tenant.institution_name))?.substring(0, 2).toUpperCase()}
                                                </span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[13px] font-black text-black dark:text-white uppercase tracking-tighter">
                                                    {type === 'ENTERPRISE' ? tenant.company_name : (tenant.full_name || tenant.institution_name)}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-10 py-6">
                                        <span className="text-[11px] font-black text-black/40 dark:text-white/30 uppercase font-mono tracking-tight grayscale group-hover:grayscale-0 transition-all">
                                            {tenant.rut || tenant.run || 'NOT_DECLARED'}
                                        </span>
                                    </td>
                                    <td className="px-10 py-6">
                                        <span className="text-[11px] font-bold text-antigravity-accent tracking-tighter opacity-70 group-hover:opacity-100 transition-opacity">
                                            {tenant.email.toLowerCase()}
                                        </span>
                                    </td>
                                    <td className="px-10 py-6">
                                        <div className="flex justify-center">
                                            <span className={clsx(
                                                "inline-flex items-center gap-2 px-4 py-1.5 rounded-none text-[9px] font-black uppercase tracking-[0.15em] border shadow-sm transition-all duration-500",
                                                tenant.status === 'PENDING_APPROVAL' && "bg-amber-500/10 text-amber-600 border-amber-500/20",
                                                tenant.status === 'APPROVED' && "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
                                                tenant.status === 'ACTIVE' && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                                                tenant.status === 'REJECTED' && "bg-rose-500/10 text-rose-600 border-rose-500/20",
                                                tenant.status === 'SUSPENDED' && "bg-black/5 text-black/40 border-black/10 dark:bg-white/5 dark:text-white/30 dark:border-white/10"
                                            )}>
                                                <div className={clsx("w-1 h-1 rounded-none",
                                                    tenant.status === 'PENDING_APPROVAL' ? "bg-amber-500" :
                                                        tenant.status === 'APPROVED' ? "bg-cyan-500" :
                                                            tenant.status === 'ACTIVE' ? "bg-emerald-500" :
                                                                tenant.status === 'REJECTED' ? "bg-rose-500" : "bg-black/30 dark:bg-white/20"
                                                )}></div>
                                                {t(`admin.status.${tenant.status.toLowerCase().replace('_approval', '')}`)}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-10 py-6 text-right">
                                        <div className="flex justify-end gap-3 opacity-0 group-hover:opacity-100 transition-all duration-500">
                                            {tenant.status === 'ACTIVE' && (
                                                <button
                                                    onClick={() => setSelectedPluginTenant(tenant)}
                                                    className="w-10 h-10 rounded-none bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500 hover:text-white flex items-center justify-center transition-all active:scale-90"
                                                    title="Módulo Config"
                                                >
                                                    <Blocks size={18} />
                                                </button>
                                            )}

                                            {tenant.status === 'ACTIVE' && type === 'ENTERPRISE' && (
                                                <button
                                                    onClick={() => navigate(`/b2b/${tenant.id}`)}
                                                    className="w-10 h-10 rounded-none bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white flex items-center justify-center transition-all active:scale-90"
                                                    title="Manage Node / Users"
                                                >
                                                    <Users size={18} />
                                                </button>
                                            )}

                                            <button
                                                onClick={() => setSelectedTenant(tenant)}
                                                className="w-10 h-10 rounded-none bg-black/5 dark:bg-white/5 hover:bg-black dark:hover:bg-white text-black/40 dark:text-white/40 hover:text-white dark:hover:text-black flex items-center justify-center transition-all active:scale-90"
                                                title="Protocol Inspector"
                                            >
                                                <Settings size={18} />
                                            </button>

                                            <button
                                                onClick={() => handleManageUser(tenant)}
                                                className="w-10 h-10 rounded-none bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white flex items-center justify-center transition-all active:scale-90"
                                                title="Entity Profile"
                                            >
                                                <Eye size={18} />
                                            </button>

                                            {tenant.status === 'ACTIVE' && (
                                                <button
                                                    onClick={() => setActionModal({ isOpen: true, tenant, action: 'SUSPEND' })}
                                                    className="w-10 h-10 rounded-none bg-amber-500/10 text-amber-500 hover:bg-amber-500 hover:text-white flex items-center justify-center transition-all active:scale-90"
                                                    title="Halt Protocol"
                                                >
                                                    <Ban size={18} />
                                                </button>
                                            )}

                                            <button
                                                onClick={() => setActionModal({ isOpen: true, tenant, action: 'DELETE' })}
                                                className="w-10 h-10 rounded-none bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white flex items-center justify-center transition-all active:scale-90"
                                                title="Purge Entry"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modals */}
            <TenantDetailsModal
                isOpen={!!selectedTenant}
                onClose={() => setSelectedTenant(null)}
                tenant={selectedTenant as any}
                onAction={handleAction as any}
            />

            <TenantPluginsModal
                isOpen={!!selectedPluginTenant}
                onClose={() => setSelectedPluginTenant(null)}
                tenant={selectedPluginTenant as any}
                onUpdatePlugins={handleUpdatePlugins}
            />

            <UserManagementDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                user={managingUser}
                toggleUserPlugin={toggleUserPlugin}
                updateUserStatus={updateUserStatus}
            />

            {actionModal && (
                <ConfirmationModal
                    isOpen={actionModal.isOpen}
                    onClose={() => setActionModal(null)}
                    action={actionModal.action}
                    targetName={type === 'ENTERPRISE' ? actionModal.tenant?.company_name : actionModal.tenant?.full_name}
                    onConfirm={() => {
                        if (actionModal.action === 'DELETE') handleDelete(actionModal.tenant!.id);
                        if (actionModal.action === 'SUSPEND') handleAction(actionModal.tenant!.id, 'SUSPENDED');
                    }}
                />
            )}
        </div>
    );
};
