import { useEffect, useState } from 'react';
import { getTenants, updateTenantStatus, deleteTenant } from '../../services/api';
import { Check, X, Clock, Trash2, Eye, Ban, Settings, Blocks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
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
    status: 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'DELETED';
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
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const { toggleUserPlugin, updateUserStatus } = useAdminUsers();

    // State for managing user via Drawer (Legacy/User-Centric)
    const [managingUser, setManagingUser] = useState<UserProfile | null>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    // State for Tenant Details Modal (Traceability / Audit)
    const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);

    // State for Tenant Plugins Modal (Dedicated Workspace)
    const [selectedPluginTenant, setSelectedPluginTenant] = useState<Tenant | null>(null);

    // Confirmation Modal State
    const [actionModal, setActionModal] = useState<{ isOpen: boolean, tenant: Tenant | null, action: 'DELETE' | 'SUSPEND' } | null>(null);

    const fetchTenants = async () => {
        try {
            const { data } = await getTenants();
            setTenants(data.filter((t: Tenant) => t.type === type && t.status !== 'DELETED'));
        } catch (error) {
            console.error('Error fetching tenants:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTenants();
    }, [type]);

    // Adapter: Convert Tenant to UserProfile for the Drawer
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

            // Optimistic Update
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

            // Close modals if necessary
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

            // Optimistic Update
            setTenants(prev => prev.map(t => {
                if (t.id === tenantId) {
                    return { ...t, enabledPlugins: newPlugins };
                }
                return t;
            }));

            // Update the selected plugin tenant state to reflect changes immediately in the modal
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
        <div className="h-full flex flex-col">
            <header className="mb-8">
                <h1 className="text-3xl font-black text-antigravity-light-text dark:text-antigravity-dark-text tracking-tight">{title}</h1>
                <p className="text-antigravity-light-muted dark:text-antigravity-dark-muted mt-1">{subtitle}</p>
            </header>

            <div className="flex-1 bg-antigravity-light-surface dark:bg-antigravity-dark-surface border border-antigravity-light-border dark:border-antigravity-dark-border rounded-xl overflow-hidden shadow-sm flex flex-col">
                <div className="overflow-auto flex-1">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900/90 backdrop-blur z-10 border-b border-antigravity-light-border dark:border-antigravity-dark-border">
                            <tr>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-antigravity-light-muted dark:text-antigravity-dark-muted">
                                    {type === 'ENTERPRISE' ? 'Razón Social' : type === 'EDUCATIONAL' ? 'Institución' : 'Nombre Completo'}
                                </th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-antigravity-light-muted dark:text-antigravity-dark-muted">
                                    {type === 'ENTERPRISE' ? 'RUT Empresa' : 'Identificación (RUN)'}
                                </th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-antigravity-light-muted dark:text-antigravity-dark-muted">Email</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-antigravity-light-muted dark:text-antigravity-dark-muted text-center">Estado</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-antigravity-light-muted dark:text-antigravity-dark-muted text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-antigravity-light-border dark:divide-antigravity-dark-border">
                            {loading ? (
                                <tr><td colSpan={5} className="px-6 py-20 text-center text-antigravity-light-muted">Cargando cuentas...</td></tr>
                            ) : tenants.length === 0 ? (
                                <tr><td colSpan={5} className="px-6 py-20 text-center text-antigravity-light-muted">No hay cuentas registradas en esta categoría.</td></tr>
                            ) : tenants.map((tenant) => (
                                <tr key={tenant.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                                    <td className="px-6 py-4 font-bold text-antigravity-light-text dark:text-antigravity-dark-text">
                                        {type === 'ENTERPRISE' ? tenant.company_name : (tenant.full_name || tenant.institution_name)}
                                    </td>
                                    <td className="px-6 py-4 text-sm font-mono text-antigravity-light-muted dark:text-antigravity-dark-muted">
                                        {tenant.rut || tenant.run || 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-antigravity-light-muted dark:text-antigravity-dark-muted">
                                        {tenant.email}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <span className={clsx(
                                            "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border",
                                            tenant.status === 'PENDING_APPROVAL' && "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800",
                                            tenant.status === 'ACTIVE' && "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800",
                                            tenant.status === 'REJECTED' && "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800",
                                            tenant.status === 'SUSPENDED' && "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                                        )}>
                                            {tenant.status === 'PENDING_APPROVAL' && <Clock size={10} />}
                                            {tenant.status === 'ACTIVE' && <Check size={10} />}
                                            {tenant.status === 'REJECTED' && <X size={10} />}
                                            {tenant.status === 'SUSPENDED' && <Ban size={10} />}
                                            {t(`admin.status.${tenant.status.toLowerCase().replace('_approval', '')}`)}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">

                                            {/* Action 1: Settings / Plugins (Active Only) - NEW ICON */}
                                            {tenant.status === 'ACTIVE' && (
                                                <button
                                                    onClick={() => setSelectedPluginTenant(tenant)}
                                                    className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                                                    title="Configurar Plugins"
                                                >
                                                    <Blocks size={18} />
                                                </button>
                                            )}

                                            {/* Action 2: Inspector / Traceability - GEAR ICON RESTORED */}
                                            <button
                                                onClick={() => setSelectedTenant(tenant)}
                                                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-antigravity-accent transition-colors"
                                                title="Ver Trazabilidad y Detalles"
                                            >
                                                <Settings size={18} />
                                            </button>

                                            {/* Action 3: User Management (Active Only) - EYE ICON */}
                                            <button
                                                onClick={() => handleManageUser(tenant)}
                                                className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                                                title="Ver Perfil de Usuario"
                                            >
                                                <Eye size={18} />
                                            </button>

                                            {/* Action 4: Suspend (Active Only) */}
                                            {tenant.status === 'ACTIVE' && (
                                                <button
                                                    onClick={() => setActionModal({ isOpen: true, tenant, action: 'SUSPEND' })}
                                                    className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                                                    title="Suspender Cuenta"
                                                >
                                                    <Ban size={18} />
                                                </button>
                                            )}

                                            {/* Action 5: Delete */}
                                            <button
                                                onClick={() => setActionModal({ isOpen: true, tenant, action: 'DELETE' })}
                                                className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                                                title="Eliminar Cuenta"
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

            {/* Modal for Traceability (The "Card") */}
            <TenantDetailsModal
                isOpen={!!selectedTenant}
                onClose={() => setSelectedTenant(null)}
                tenant={selectedTenant as any}
                onAction={handleAction as any}
            />

            {/* Dedicated Modal for Plugins (The New Workspace) */}
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
