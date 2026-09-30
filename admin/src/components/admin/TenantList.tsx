import { useEffect, useState } from 'react';
import { getTenants, updateTenantStatus, deleteTenant } from '../../services/api';
import { useNavigate } from 'react-router-dom';
import { ConfirmationModal } from './ConfirmationModal';

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
    const navigate = useNavigate();
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const [notification, setNotification] = useState<string | null>(null);

    const [actionModal, setActionModal] = useState<{
        isOpen: boolean;
        tenant: Tenant | null;
        action: 'DELETE' | 'SUSPEND' | 'ACTIVATE';
    } | null>(null);

    const fetchTenants = async () => {
        setLoading(true);
        try {
            const { data } = await getTenants();
            setTenants(data.filter((t: Tenant) => t.type === type && (t.status === 'ACTIVE' || t.status === 'SUSPENDED' || t.status === 'APPROVED')));
        } catch (error) {
            console.error('Error al consultar cuentas:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTenants();
    }, [type]);

    const handleActionConfirm = async () => {
        if (!actionModal?.tenant) return;
        const tenant = actionModal.tenant;
        const action = actionModal.action;

        try {
            if (action === 'DELETE') {
                await deleteTenant(tenant.id);
                setTenants(prev => prev.filter(t => t.id !== tenant.id));
                setNotification('Cuenta eliminada del registro');
            } else {
                const nextStatus = action === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE';
                await updateTenantStatus(tenant.id, nextStatus as any);
                setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, status: nextStatus as any } : t));
                setNotification(`Cuenta ${nextStatus === 'ACTIVE' ? 'activada' : 'suspendida'}`);
            }
            setActionModal(null);
            setTimeout(() => setNotification(null), 3000);
        } catch (error) {
            console.error('Error al ejecutar acción:', error);
            setNotification('Error al procesar acción');
            setTimeout(() => setNotification(null), 3000);
        }
    };

    const handleNavigateDetail = (tenantId: string) => {
        if (type === 'ENTERPRISE') navigate(`/b2b/${tenantId}`);
        else if (type === 'EDUCATIONAL') navigate(`/edu/${tenantId}`);
        else navigate(`/personal/${tenantId}`);
    };

    return (
        <div className="space-y-6 font-sans">
            {/* Cabecera Técnica */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                        {title}
                    </h1>
                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] mt-0.5">
                        {subtitle}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-[#475569] dark:text-[#8A93A6]">
                        Registros: <span className="tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6]">{tenants.length}</span>
                    </span>
                    <button
                        onClick={fetchTenants}
                        disabled={loading}
                        className="bg-transparent border-0 outline-none p-1.5 text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer flex items-center gap-1.5 text-xs"
                        title="Actualizar lista"
                    >
                        <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>sync</span>
                        <span>Actualizar</span>
                    </button>
                </div>
            </div>

            {/* Notificación Operativa Inline */}
            {notification && (
                <div className="px-3 py-2 bg-neutral-100 dark:bg-neutral-900 border border-[#E2E8F0] dark:border-[#12151C] text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-[#C68346]">info</span>
                    <span>{notification}</span>
                </div>
            )}

            {/* Tabla Técnica en Modo Informe */}
            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                    <thead>
                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406] font-mono text-[#475569] dark:text-[#8A93A6]">
                            <th className="py-2.5 px-4 font-semibold">Identificación / Titular</th>
                            <th className="py-2.5 px-4 font-semibold">RUT / RUN</th>
                            <th className="py-2.5 px-4 font-semibold">Correo Electrónico</th>
                            <th className="py-2.5 px-4 font-semibold">Estado</th>
                            <th className="py-2.5 px-4 font-semibold text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {loading ? (
                            <tr>
                                <td colSpan={5} className="py-8 px-4 text-center text-[#8A93A6] font-mono">
                                    [Consultando registros...]
                                </td>
                            </tr>
                        ) : tenants.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="py-8 px-4 text-center text-[#8A93A6] font-mono">
                                    [No se registran cuentas activas en esta categoría]
                                </td>
                            </tr>
                        ) : (
                            tenants.map((tenant) => (
                                <tr key={tenant.id} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01]">
                                    <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        <button
                                            onClick={() => handleNavigateDetail(tenant.id)}
                                            className="bg-transparent border-0 outline-none p-0 text-left hover:text-[#C68346] transition-colors cursor-pointer font-bold"
                                        >
                                            {type === 'ENTERPRISE' ? tenant.company_name : (tenant.full_name || tenant.institution_name || '-')}
                                        </button>
                                    </td>
                                    <td className="py-3 px-4 font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                        {tenant.rut || tenant.run || '[No declarado]'}
                                    </td>
                                    <td className="py-3 px-4 font-mono text-[#475569] dark:text-[#8A93A6]">
                                        {tenant.email.toLowerCase()}
                                    </td>
                                    <td className="py-3 px-4">
                                        <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${
                                            (tenant.status === 'ACTIVE' || tenant.status === 'APPROVED')
                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                : tenant.status === 'SUSPENDED'
                                                ? 'text-amber-600 dark:text-amber-400'
                                                : 'text-neutral-500'
                                        }`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${
                                                (tenant.status === 'ACTIVE' || tenant.status === 'APPROVED') ? 'bg-emerald-500' :
                                                tenant.status === 'SUSPENDED' ? 'bg-amber-500' : 'bg-neutral-400'
                                            }`} />
                                            {(tenant.status === 'ACTIVE' || tenant.status === 'APPROVED') ? 'Activa' :
                                             tenant.status === 'SUSPENDED' ? 'Suspendida' : tenant.status}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            {/* Acción 1: Ficha Técnica Oficial (Informe Completo) */}
                                            <button
                                                onClick={() => handleNavigateDetail(tenant.id)}
                                                className="bg-transparent border-0 outline-none p-1 text-neutral-400 hover:text-[#C68346] transition-colors cursor-pointer"
                                                title="Ver Ficha Técnica"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">description</span>
                                            </button>

                                            {/* Acción 2: Suspender / Activar */}
                                            {(tenant.status === 'ACTIVE' || tenant.status === 'APPROVED') ? (
                                                <button
                                                    onClick={() => setActionModal({ isOpen: true, tenant, action: 'SUSPEND' })}
                                                    className="bg-transparent border-0 outline-none p-1 text-neutral-400 hover:text-amber-600 transition-colors cursor-pointer"
                                                    title="Suspender cuenta"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">block</span>
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => setActionModal({ isOpen: true, tenant, action: 'ACTIVATE' })}
                                                    className="bg-transparent border-0 outline-none p-1 text-neutral-400 hover:text-emerald-600 transition-colors cursor-pointer"
                                                    title="Reactivar cuenta"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                                                </button>
                                            )}

                                            {/* Acción 3: Eliminar Registro */}
                                            <button
                                                onClick={() => setActionModal({ isOpen: true, tenant, action: 'DELETE' })}
                                                className="bg-transparent border-0 outline-none p-1 text-neutral-400 hover:text-rose-600 transition-colors cursor-pointer"
                                                title="Eliminar registro"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal de Confirmación HITL por Palabra Clave */}
            {actionModal && (
                <ConfirmationModal
                    isOpen={actionModal.isOpen}
                    onClose={() => setActionModal(null)}
                    action={actionModal.action}
                    targetName={type === 'ENTERPRISE' ? actionModal.tenant?.company_name : actionModal.tenant?.full_name}
                    onConfirm={handleActionConfirm}
                />
            )}
        </div>
    );
};
