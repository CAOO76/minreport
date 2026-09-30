import { useEffect, useState } from 'react';
import { getTenants, updateTenantStatus } from '../services/api';
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
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
    const [activeTab, setActiveTab] = useState<'PERSONAL' | 'ENTERPRISE' | 'EDUCATIONAL'>('PERSONAL');
    const [searchTerm, setSearchTerm] = useState('');
    const [showRejected, setShowRejected] = useState(false);

    const fetchTenants = async () => {
        try {
            const { data } = await getTenants();
            setTenants(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error al consultar solicitudes:', error);
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
            console.error('Error al actualizar estado:', error);
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

    return (
        <div className="space-y-6 font-sans">
            {/* Cabecera Técnica */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                        Bandeja de Aprobaciones
                    </h1>
                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] mt-0.5">
                        Solicitudes de cuenta pendientes de validación técnica.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowRejected(!showRejected)}
                        className={`text-xs px-2.5 py-1 border transition-colors ${
                            showRejected
                                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 border-transparent'
                                : 'bg-transparent text-[#475569] dark:text-[#8A93A6] border-[#E2E8F0] dark:border-[#12151C] hover:text-[#0F172A] dark:hover:text-white'
                        }`}
                    >
                        {showRejected ? 'Ver Pendientes' : 'Ver Rechazadas'}
                    </button>
                    <button
                        onClick={fetchTenants}
                        disabled={loading}
                        className="bg-transparent border-0 outline-none p-1.5 text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer flex items-center gap-1.5 text-xs"
                        title="Actualizar bandeja"
                    >
                        <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>sync</span>
                        <span>Actualizar</span>
                    </button>
                </div>
            </div>

            {/* Pestañas de Segmentación & Búsqueda */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-1 border-b border-[#E2E8F0] dark:border-[#12151C]">
                    <button
                        onClick={() => setActiveTab('PERSONAL')}
                        className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 ${
                            activeTab === 'PERSONAL'
                                ? 'border-[#C68346] text-[#C68346]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-white'
                        }`}
                    >
                        <span>Personal</span>
                        {pendingCounts.PERSONAL > 0 && (
                            <span className="font-mono tabular-nums text-[10px] px-1.5 py-0.2 bg-[#C68346]/10 text-[#C68346]">
                                {pendingCounts.PERSONAL}
                            </span>
                        )}
                    </button>

                    <button
                        onClick={() => setActiveTab('EDUCATIONAL')}
                        className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 ${
                            activeTab === 'EDUCATIONAL'
                                ? 'border-[#C68346] text-[#C68346]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-white'
                        }`}
                    >
                        <span>Educacional</span>
                        {pendingCounts.EDUCATIONAL > 0 && (
                            <span className="font-mono tabular-nums text-[10px] px-1.5 py-0.2 bg-[#C68346]/10 text-[#C68346]">
                                {pendingCounts.EDUCATIONAL}
                            </span>
                        )}
                    </button>

                    <button
                        onClick={() => setActiveTab('ENTERPRISE')}
                        className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 ${
                            activeTab === 'ENTERPRISE'
                                ? 'border-[#C68346] text-[#C68346]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-white'
                        }`}
                    >
                        <span>B2B Corporativo</span>
                        {pendingCounts.ENTERPRISE > 0 && (
                            <span className="font-mono tabular-nums text-[10px] px-1.5 py-0.2 bg-[#C68346]/10 text-[#C68346]">
                                {pendingCounts.ENTERPRISE}
                            </span>
                        )}
                    </button>
                </div>

                <div className="relative w-full md:w-80">
                    <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-neutral-400">
                        search
                    </span>
                    <input
                        type="text"
                        placeholder="Buscar por nombre, RUT o correo..."
                        autoComplete="off"
                        spellCheck={false}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-xs text-[#0F172A] dark:text-[#F3F4F6] placeholder:text-[#94A3B8] dark:placeholder:text-[#5A6072] outline-none rounded-none"
                    />
                </div>
            </div>

            {/* Tabla Técnica de Solicitudes */}
            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                    <thead>
                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406] font-mono text-[#475569] dark:text-[#8A93A6]">
                            <th className="py-2.5 px-4 font-semibold">Identificación / Titular</th>
                            <th className="py-2.5 px-4 font-semibold">Contacto</th>
                            <th className="py-2.5 px-4 font-semibold">RUT / RUN</th>
                            <th className="py-2.5 px-4 font-semibold">Correo Electrónico</th>
                            <th className="py-2.5 px-4 font-semibold">Estado</th>
                            <th className="py-2.5 px-4 font-semibold text-right">Acción</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {loading ? (
                            <tr>
                                <td colSpan={6} className="py-8 px-4 text-center text-[#8A93A6] font-mono">
                                    [Consultando solicitudes...]
                                </td>
                            </tr>
                        ) : filteredTenants.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="py-8 px-4 text-center text-[#8A93A6] font-mono">
                                    [No se registran solicitudes pendientes en esta categoría]
                                </td>
                            </tr>
                        ) : (
                            filteredTenants.map((tenant) => (
                                <tr key={tenant.id} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01]">
                                    <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {tenant.type === 'ENTERPRISE' ? tenant.company_name : (tenant.full_name || tenant.institution_name || '-')}
                                    </td>
                                    <td className="py-3 px-4 text-[#475569] dark:text-[#8A93A6]">
                                        {tenant.applicant_name || tenant.full_name || '-'}
                                        {tenant.job_title && (
                                            <span className="text-[#94A3B8] dark:text-[#5A6072]"> ({tenant.job_title})</span>
                                        )}
                                    </td>
                                    <td className="py-3 px-4 font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                        {tenant.rut || tenant.run || '-'}
                                    </td>
                                    <td className="py-3 px-4 font-mono text-[#475569] dark:text-[#8A93A6]">
                                        {tenant.email.toLowerCase()}
                                    </td>
                                    <td className="py-3 px-4">
                                        <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${
                                            tenant.status === 'PENDING_APPROVAL' ? 'text-amber-600 dark:text-amber-400' :
                                            tenant.status === 'ACTIVE' ? 'text-emerald-600 dark:text-emerald-400' :
                                            'text-rose-600 dark:text-rose-400'
                                        }`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${
                                                tenant.status === 'PENDING_APPROVAL' ? 'bg-amber-500' :
                                                tenant.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-rose-500'
                                            }`} />
                                            {tenant.status === 'PENDING_APPROVAL' ? 'Pendiente' :
                                             tenant.status === 'ACTIVE' ? 'Activo' : 'Rechazado'}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                        <button
                                            onClick={() => setSelectedTenant(tenant)}
                                            className="bg-transparent border-0 outline-none p-1 text-neutral-400 hover:text-[#0F172A] dark:hover:text-white transition-colors cursor-pointer"
                                            title="Revisar solicitud técnica"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">description</span>
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
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
