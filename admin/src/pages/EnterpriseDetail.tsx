import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../config/firebase';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { deleteTenant, getAccountUsers } from '../services/api';
import { M3Switch } from '../components/M3Switch';

interface User {
    uid: string;
    email: string;
    displayName?: string;
    fullName?: string;
    taxId?: string;
    memberships: any[];
    status?: string;
    lastLogin?: string;
}

const AVAILABLE_MODULES = [
    { key: 'opermaq', label: 'OPERMAQ', scope: 'Telemetría de maquinaria pesada' },
    { key: 'stockpile', label: 'STOCKPILE', scope: 'Cubicación topográfica de acopios' },
    { key: 'mining-flow', label: 'MINING FLOW', scope: 'Monitoreo de flujo y transporte' }
];

export const EnterpriseDetail = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [account, setAccount] = useState<any>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [notification, setNotification] = useState<string | null>(null);

    // Modal de confirmación por palabra clave (Regla HITL)
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        action: 'SUSPEND' | 'ACTIVATE' | 'DELETE';
        keyword: string;
    }>({ isOpen: false, action: 'SUSPEND', keyword: '' });

    useEffect(() => {
        if (id) {
            fetchData();
        }
    }, [id]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const accRef = doc(db, 'accounts', id!);
            const tenantRef = doc(db, 'tenants', id!);
            const [accSnap, tenantSnap] = await Promise.all([
                getDoc(accRef),
                getDoc(tenantRef)
            ]);

            if (!accSnap.exists() && !tenantSnap.exists()) {
                navigate('/b2b');
                return;
            }

            const merged = {
                id,
                ...(tenantSnap.exists() ? tenantSnap.data() : {}),
                ...(accSnap.exists() ? accSnap.data() : {}),
            };

            setAccount(merged);

            const { data: accountUsers } = await getAccountUsers(id!);
            setUsers(Array.isArray(accountUsers) ? accountUsers : []);
        } catch (error) {
            console.error('Error al consultar ficha técnica:', error);
            setNotification('Error al cargar datos del registro');
        } finally {
            setLoading(false);
        }
    };

    const backRoute = account?.type === 'EDUCATIONAL' ? '/edu' : account?.type === 'PERSONAL' ? '/personal' : '/b2b';
    const backLabel = account?.type === 'EDUCATIONAL' ? 'Instituciones Educativas' : account?.type === 'PERSONAL' ? 'Cuentas Personales' : 'Cuentas B2B';
    const reportTitle = account?.type === 'EDUCATIONAL'
        ? 'Informe Técnico de Institución Académica'
        : account?.type === 'PERSONAL'
        ? 'Informe Técnico de Cuenta Personal'
        : 'Informe Técnico de Entidad Corporativa';

    const handleExecuteAction = async () => {
        if (!account) return;
        setActionLoading(true);
        try {
            if (confirmModal.action === 'DELETE') {
                await deleteTenant(id!);
                navigate(backRoute);
                return;
            }

            const nextStatus = confirmModal.action === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE';
            const updates = {
                status: nextStatus,
                updatedAt: new Date().toISOString()
            };

            const promises = [
                updateDoc(doc(db, 'accounts', id!), updates).catch(() => null),
                updateDoc(doc(db, 'tenants', id!), updates).catch(() => null)
            ];
            await Promise.all(promises);

            setAccount((prev: any) => ({ ...prev, status: nextStatus }));
            setConfirmModal({ isOpen: false, action: 'SUSPEND', keyword: '' });
            setNotification(`Estado de cuenta actualizado: ${nextStatus === 'ACTIVE' ? 'Activa' : 'Suspendida'}`);
            setTimeout(() => setNotification(null), 3000);
        } catch (error) {
            console.error('Error al actualizar cuenta:', error);
            setNotification('Error al procesar acción sobre la cuenta');
            setTimeout(() => setNotification(null), 3000);
        } finally {
            setActionLoading(false);
        }
    };

    const toggleModule = async (moduleKey: string) => {
        if (!account) return;
        const currentList: string[] = account.enabledPlugins || [];
        const nextList = currentList.includes(moduleKey)
            ? currentList.filter(k => k !== moduleKey)
            : [...currentList, moduleKey];

        try {
            const updates = { enabledPlugins: nextList, updatedAt: serverTimestamp() };
            await Promise.all([
                updateDoc(doc(db, 'accounts', id!), updates).catch(() => null),
                updateDoc(doc(db, 'tenants', id!), updates).catch(() => null)
            ]);

            setAccount((prev: any) => ({ ...prev, enabledPlugins: nextList }));
            setNotification(`Módulos actualizados: ${nextList.join(', ') || 'Ninguno'}`);
            setTimeout(() => setNotification(null), 3000);
        } catch (error) {
            console.error('Error al actualizar módulos de empresa:', error);
            setNotification('Error al actualizar asignación de módulos');
            setTimeout(() => setNotification(null), 3000);
        }
    };

    const formatTimestamp = (ts: any): string => {
        if (!ts) return '[Información técnica no declarada en ficha]';
        if (typeof ts === 'string') return ts;
        if (typeof ts._seconds === 'number') return new Date(ts._seconds * 1000).toISOString();
        if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
        return String(ts);
    };

    const getRoleName = (user: User) => {
        const membership = user.memberships?.find(m => m.accountId === id);
        const role = membership?.role;
        if (role === 'BILLING_ONLY') return 'Comercial / Facturación';
        if (role === 'OWNER' || role === 'ADMIN') return 'Administrador de Cuenta';
        return 'Operador';
    };

    if (loading) {
        return (
            <div className="py-16 text-center font-mono text-xs text-[#8A93A6]">
                [Consultando registro oficial...]
            </div>
        );
    }

    return (
        <div className="space-y-6 font-sans">
            {/* Navegación y Acciones Primarias */}
            <div className="flex items-center justify-between gap-4">
                <button
                    onClick={() => navigate(backRoute)}
                    className="bg-transparent border-0 outline-none p-0 text-xs font-mono text-neutral-400 hover:text-[#0F172A] dark:hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
                >
                    <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                    <span>{backLabel}</span>
                </button>

                <div className="flex items-center gap-2">
                    {account?.status === 'ACTIVE' || account?.status === 'APPROVED' ? (
                        <button
                            onClick={() => setConfirmModal({ isOpen: true, action: 'SUSPEND', keyword: '' })}
                            className="px-3 py-1.5 text-xs font-mono bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors"
                        >
                            Suspender Cuenta
                        </button>
                    ) : (
                        <button
                            onClick={() => setConfirmModal({ isOpen: true, action: 'ACTIVATE', keyword: '' })}
                            className="px-3 py-1.5 text-xs font-mono bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors"
                        >
                            Activar Cuenta
                        </button>
                    )}

                    <button
                        onClick={() => setConfirmModal({ isOpen: true, action: 'DELETE', keyword: '' })}
                        className="px-3 py-1.5 text-xs font-mono bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                    >
                        Eliminar Registro
                    </button>
                </div>
            </div>

            {/* Notificación Operativa */}
            {notification && (
                <div className="px-3 py-2 bg-neutral-100 dark:bg-neutral-900 border border-[#E2E8F0] dark:border-[#12151C] text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-[#C68346]">info</span>
                    <span>{notification}</span>
                </div>
            )}

            {/* Macro-Layout Paramétrico (Proporción Áurea 1:1.618 / 61.8% vs 38.2%) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* ÁREA MAYOR (~61.8% / col-span-8): Informe Técnico Oficial */}
                <div className="lg:col-span-8 space-y-6">
                    {/* Ficha Legal & Tributaria / Datos Principales */}
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] p-5">
                        <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px] text-[#C68346]">
                                    {account?.type === 'EDUCATIONAL' ? 'school' : account?.type === 'PERSONAL' ? 'person' : 'domain'}
                                </span>
                                <h2 className="text-sm font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-wide">
                                    {reportTitle}
                                </h2>
                            </div>
                            <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${
                                account?.status === 'ACTIVE' || account?.status === 'APPROVED'
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-amber-600 dark:text-amber-400'
                            }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                    account?.status === 'ACTIVE' || account?.status === 'APPROVED' ? 'bg-emerald-500' : 'bg-amber-500'
                                }`} />
                                {account?.status === 'ACTIVE' || account?.status === 'APPROVED' ? 'Activa' : 'Suspendida'}
                            </span>
                        </div>

                        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3.5 text-xs">
                            <div>
                                <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">
                                    {account?.type === 'PERSONAL' ? 'Nombre Completo' : 'Razón Social / Institución'}
                                </dt>
                                <dd className="font-bold text-[#0F172A] dark:text-[#F3F4F6] text-sm mt-0.5">
                                    {account?.name || account?.company_name || account?.institution_name || account?.full_name || '[Información técnica no declarada en ficha]'}
                                </dd>
                            </div>

                            <div>
                                <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">RUT / RUN</dt>
                                <dd className="font-mono tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6] text-sm mt-0.5">
                                    {account?.taxId || account?.rut || account?.run || '[Información técnica no declarada en ficha]'}
                                </dd>
                            </div>

                            {account?.type !== 'PERSONAL' && (
                                <div className="md:col-span-2">
                                    <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">
                                        {account?.type === 'EDUCATIONAL' ? 'Programa / Convenio' : 'Giro Comercial / Actividad'}
                                    </dt>
                                    <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                        {account?.giro || account?.industry || account?.program_name || '[Información técnica no declarada en ficha]'}
                                    </dd>
                                </div>
                            )}

                            <div className="md:col-span-2">
                                <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Domicilio</dt>
                                <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                    {account?.direccionComercial || account?.address || '[Información técnica no declarada en ficha]'}
                                </dd>
                            </div>

                            <div>
                                <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Comuna / Ciudad</dt>
                                <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                    {account?.commune || account?.city || '[Información técnica no declarada en ficha]'}
                                </dd>
                            </div>

                            <div>
                                <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Región</dt>
                                <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                    {account?.region || '[Información técnica no declarada en ficha]'}
                                </dd>
                            </div>

                            <div>
                                <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Correo de Contacto / Facturación</dt>
                                <dd className="font-mono text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                    {account?.emailTributario || account?.billing_email || account?.email || '[Información técnica no declarada en ficha]'}
                                </dd>
                            </div>

                            <div>
                                <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Código Postal</dt>
                                <dd className="font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                    {account?.postal_code || '[Información técnica no declarada en ficha]'}
                                </dd>
                            </div>
                        </dl>
                    </div>

                    {/* Representación & Solicitante (si aplica) */}
                    {(account?.applicant_name || account?.job_title) && (
                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] p-5">
                            <div className="flex items-center gap-2 pb-3 mb-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
                                <span className="material-symbols-outlined text-[18px] text-[#C68346]">badge</span>
                                <h2 className="text-sm font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-wide">
                                    Representación Institucional
                                </h2>
                            </div>

                            <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                <div>
                                    <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Solicitante Titular</dt>
                                    <dd className="font-bold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                        {account?.applicant_name || account?.full_name || '[Información técnica no declarada en ficha]'}
                                    </dd>
                                </div>

                                <div>
                                    <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Cargo Declarado</dt>
                                    <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                        {account?.job_title || '[Información técnica no declarada en ficha]'}
                                    </dd>
                                </div>

                                <div>
                                    <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Correo de Contacto</dt>
                                    <dd className="font-mono text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                        {account?.email || '[Información técnica no declarada en ficha]'}
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    )}

                    {/* Tabla Técnica de Usuarios Asociados */}
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D]">
                        <div className="flex items-center justify-between p-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px] text-[#C68346]">group</span>
                                <h3 className="text-sm font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-wide">
                                    Personal Vinculado a la Cuenta
                                </h3>
                            </div>
                            <span className="font-mono text-xs text-[#8A93A6]">
                                Registros: <span className="tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6]">{users.length}</span>
                            </span>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#030406] font-mono text-[#475569] dark:text-[#8A93A6]">
                                        <th className="py-2.5 px-4 font-semibold">Nombre / Titular</th>
                                        <th className="py-2.5 px-4 font-semibold">Correo Electrónico</th>
                                        <th className="py-2.5 px-4 font-semibold">Rol Asignado</th>
                                        <th className="py-2.5 px-4 font-semibold font-mono">UID</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                    {users.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="py-8 px-4 text-center text-[#8A93A6] font-mono">
                                                [No se registran usuarios asociados a esta cuenta]
                                            </td>
                                        </tr>
                                    ) : (
                                        users.map((u) => (
                                            <tr key={u.uid} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01]">
                                                <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {u.displayName || u.fullName || '[Sin nombre registrado]'}
                                                </td>
                                                <td className="py-3 px-4 font-mono text-[#475569] dark:text-[#8A93A6]">
                                                    {u.email}
                                                </td>
                                                <td className="py-3 px-4 text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {getRoleName(u)}
                                                </td>
                                                <td className="py-3 px-4 font-mono text-[#8A93A6] text-[11px]">
                                                    {u.uid}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* ÁREA MENOR (~38.2% / col-span-4): Panel de Control Operativo y Gobernanza */}
                <div className="lg:col-span-4 space-y-6">
                    {/* Metadatos de Registro */}
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] p-5">
                        <div className="flex items-center gap-2 pb-3 mb-3 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <span className="material-symbols-outlined text-[18px] text-[#C68346]">info</span>
                            <h3 className="text-xs font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-wide">
                                Registro del Sistema
                            </h3>
                        </div>

                        <dl className="space-y-3 text-xs">
                            <div>
                                <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">ID de Cuenta</dt>
                                <dd className="font-mono text-[#0F172A] dark:text-[#F3F4F6] text-[11px] mt-0.5 break-all">
                                    {account?.id}
                                </dd>
                            </div>

                            <div>
                                <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Fecha de Aprobación</dt>
                                <dd className="font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                    {formatTimestamp(account?.processedAt || account?.createdAt)}
                                </dd>
                            </div>

                            <div>
                                <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Operador Responsable</dt>
                                <dd className="font-mono text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                    {account?.processedBy || 'master-admin'}
                                </dd>
                            </div>

                            {account?.observations && (
                                <div>
                                    <dt className="text-[#8A93A6] font-mono text-[10px] uppercase">Observaciones</dt>
                                    <dd className="text-[#475569] dark:text-[#8A93A6] mt-0.5 italic">
                                        {account.observations}
                                    </dd>
                                </div>
                            )}
                        </dl>
                    </div>

                    {/* Módulos Habilitados */}
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#07090D] p-5">
                        <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px] text-[#C68346]">deployed_code</span>
                                <h3 className="text-xs font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-wide">
                                    Módulos Asignados
                                </h3>
                            </div>
                        </div>

                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            {AVAILABLE_MODULES.map((mod) => {
                                const isEnabled = (account?.enabledPlugins || []).includes(mod.key);
                                return (
                                    <div key={mod.key} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                                        <div>
                                            <div className="font-mono font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {mod.label}
                                            </div>
                                            <div className="text-[11px] text-[#8A93A6]">
                                                {mod.scope}
                                            </div>
                                        </div>
                                        <M3Switch
                                            checked={isEnabled}
                                            onChange={() => toggleModule(mod.key)}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal Quirúrgico de Confirmación por Palabra Clave (HITL) */}
            {confirmModal.isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] max-w-md w-full p-6 space-y-4">
                        <div className="flex items-center gap-2 text-[#0F172A] dark:text-[#F3F4F6]">
                            <span className="material-symbols-outlined text-[20px] text-amber-500">warning</span>
                            <h3 className="text-sm font-bold uppercase tracking-wider font-mono">
                                {confirmModal.action === 'DELETE' ? 'Confirmar Eliminación' :
                                 confirmModal.action === 'SUSPEND' ? 'Confirmar Suspensión' : 'Confirmar Activación'}
                            </h3>
                        </div>

                        <p className="text-xs text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                            {confirmModal.action === 'DELETE'
                                ? 'Esta acción eliminará de forma permanente el registro, accesos y configuración asociada a esta cuenta. Para confirmar, escribe "ELIMINAR":'
                                : confirmModal.action === 'SUSPEND'
                                ? 'Al suspender la cuenta, los usuarios vinculados perderán acceso inmediato a la plataforma. Para confirmar, escribe "SUSPENDER":'
                                : 'Se restaurará el acceso de los usuarios vinculados a los módulos habilitados. Para confirmar, escribe "ACTIVAR":'}
                        </p>

                        <input
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            value={confirmModal.keyword}
                            onChange={(e) => setConfirmModal(prev => ({ ...prev, keyword: e.target.value.toUpperCase() }))}
                            placeholder={confirmModal.action === 'DELETE' ? 'ELIMINAR' : confirmModal.action === 'SUSPEND' ? 'SUSPENDER' : 'ACTIVAR'}
                            className="w-full px-3 py-2 bg-[#F8FAFC] dark:bg-[#030406] border border-[#E2E8F0] dark:border-[#12151C] text-xs font-mono tracking-widest text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                            autoFocus
                        />

                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E2E8F0] dark:border-[#12151C]">
                            <button
                                onClick={() => setConfirmModal({ isOpen: false, action: 'SUSPEND', keyword: '' })}
                                className="px-3 py-1.5 text-xs font-mono bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-white transition-colors"
                            >
                                Cancelar
                            </button>

                            <button
                                disabled={
                                    actionLoading ||
                                    confirmModal.keyword !== (
                                        confirmModal.action === 'DELETE' ? 'ELIMINAR' :
                                        confirmModal.action === 'SUSPEND' ? 'SUSPENDER' : 'ACTIVAR'
                                    )
                                }
                                onClick={handleExecuteAction}
                                className={`px-4 py-1.5 text-xs font-mono transition-opacity ${
                                    confirmModal.action === 'DELETE'
                                        ? 'bg-rose-600 text-white disabled:opacity-30'
                                        : 'bg-[#C68346] text-white disabled:opacity-30'
                                }`}
                            >
                                {actionLoading ? 'Procesando...' : 'Confirmar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
