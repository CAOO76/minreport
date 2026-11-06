import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { getApiUrl } from '../../utils/network';
import BrandLogo from '../../components/BrandLogo';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { M3Switch } from '../../components/common/M3Switch';
import CopyButton from '../../components/common/CopyButton';

type AdminTab = 'B2B' | 'EDU' | 'MODULES' | 'LEDGER';

interface TenantRecord {
    id: string;
    uid?: string;
    name?: string;
    companyName?: string;
    taxId?: string;
    rut?: string;
    email?: string;
    ownerEmail?: string;
    type?: string;
    classification?: string;
    status?: string;
    plan?: string;
    institution?: string;
    academicDomain?: string;
    documentUrl?: string;
    enabledPlugins?: string[];
    enabledModules?: string[];
    createdAt?: number | string;
}

interface ModuleStatusEntry {
    id: 'opermaq' | 'stockpile';
    name: string;
    code: string;
    description: string;
    enabled: boolean;
    updatedAt?: string;
    updatedBy?: string;
}

interface AuditLogRecord {
    id: string;
    seq?: number;
    action?: string;
    actorEmail?: string;
    actorUid?: string;
    tenantId?: string;
    module?: string;
    targetEntity?: string;
    entryHash?: string;
    hash?: string;
    prevHash?: string;
    timestamp?: string | number;
    details?: Record<string, unknown>;
}

const MISSING_VALUE = '[Información técnica no declarada en ficha]';

export const SuperAdminConsole: React.FC = () => {
    const navigate = useNavigate();
    const { user, signOut } = useAuth();
    const { session, isLoaded } = useMinReportSession();

    const [activeTab, setActiveTab] = useState<AdminTab>('B2B');
    const [tenants, setTenants] = useState<TenantRecord[]>([]);
    const [selectedTenant, setSelectedTenant] = useState<TenantRecord | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [loadingData, setLoadingData] = useState(false);
    const [errorBanner, setErrorBanner] = useState<string | null>(null);
    const [statusBanner, setStatusBanner] = useState<string | null>(null);

    // Disponibilidad global de modulos (exclusivamente opermaq y stockpile)
    const [modulesState, setModulesState] = useState<ModuleStatusEntry[]>([
        {
            id: 'opermaq',
            name: 'OPERMAQ',
            code: 'MOD-OPERMAQ',
            description: 'Control de flota pesada, telemetria de horometros e inspecciones DS 132.',
            enabled: true,
        },
        {
            id: 'stockpile',
            name: 'STOCKPILE CONTROL',
            code: 'MOD-STOCKPILE',
            description: 'Cubicacion volumetrica 3D, fotogrametria y balance de tonelaje mineral.',
            enabled: true,
        },
    ]);
    const [pendingModuleToggle, setPendingModuleToggle] = useState<{
        moduleId: 'opermaq' | 'stockpile';
        current: boolean;
        next: boolean;
    } | null>(null);

    // Auditoria y Telemetria IA
    const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
    const [chainVerification, setChainVerification] = useState<{
        verified: boolean | null;
        checkedRecords?: number;
        message: string;
    } | null>(null);
    const [verifyingChain, setVerifyingChain] = useState(false);
    const [telemetryData, setTelemetryData] = useState<Record<string, any> | null>(null);

    // Confirmacion HITL ("ACTUALIZAR")
    const [hitlAction, setHitlAction] = useState<{
        kind: 'TENANT_STATUS' | 'MODULE_TOGGLE';
        title: string;
        summary: string;
        targetUid?: string;
        nextStatus?: 'ACTIVE' | 'SUSPENDED' | 'REJECTED';
        moduleId?: 'opermaq' | 'stockpile';
        nextEnabled?: boolean;
    } | null>(null);
    const [hitlKeyword, setHitlKeyword] = useState('');
    const [hitlSubmitting, setHitlSubmitting] = useState(false);

    const fetchAdminApi = useCallback(async (path: string, init: RequestInit = {}): Promise<Response> => {
        const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
        return fetch(getApiUrl(path), {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...((init.headers as Record<string, string>) || {}),
            },
        });
    }, []);

    const loadTenants = useCallback(async () => {
        setLoadingData(true);
        setErrorBanner(null);
        try {
            const res = await fetchAdminApi('/api/admin/tenants');
            const data = await res.json().catch(() => ([]));
            if (!res.ok) {
                throw new Error(data?.error || `Error HTTP ${res.status} al consultar /api/admin/tenants`);
            }
            const list: TenantRecord[] = Array.isArray(data)
                ? data
                : Array.isArray(data?.tenants)
                    ? data.tenants
                    : Array.isArray(data?.items)
                        ? data.items
                        : [];
            setTenants(list);
        } catch (err: any) {
            setErrorBanner(err?.message || 'No se pudo cargar el padron de organizaciones.');
        } finally {
            setLoadingData(false);
        }
    }, [fetchAdminApi]);

    const loadModulesStatus = useCallback(async () => {
        setLoadingData(true);
        setErrorBanner(null);
        try {
            const snap = await getDocs(collection(db, 'modules_status'));
            const map: Record<string, { enabled: boolean; updatedAt?: string; updatedBy?: string }> = {};
            snap.forEach((d) => {
                const raw = d.data();
                if (d.id === 'opermaq' || d.id === 'stockpile') {
                    map[d.id] = {
                        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
                        updatedAt: raw.updatedAt,
                        updatedBy: raw.updatedBy,
                    };
                }
            });
            setModulesState((prev) =>
                prev.map((m) => ({
                    ...m,
                    enabled: map[m.id]?.enabled ?? m.enabled,
                    updatedAt: map[m.id]?.updatedAt,
                    updatedBy: map[m.id]?.updatedBy,
                }))
            );
        } catch (err: any) {
            setErrorBanner(err?.message || 'Error al leer estado global en modules_status.');
        } finally {
            setLoadingData(false);
        }
    }, []);

    const loadLedgerAndTelemetry = useCallback(async () => {
        setLoadingData(true);
        setErrorBanner(null);
        try {
            const [logsRes, telResponse] = await Promise.all([
                fetchAdminApi('/api/admin/audit-logs'),
                fetchAdminApi('/api/admin/ai-telemetry'),
            ]);

            if (logsRes.ok) {
                const logsJson = await logsRes.json().catch(() => ([]));
                const rows: AuditLogRecord[] = Array.isArray(logsJson)
                    ? logsJson
                    : Array.isArray(logsJson?.logs)
                        ? logsJson.logs
                        : Array.isArray(logsJson?.items)
                            ? logsJson.items
                            : [];
                setAuditLogs(rows);
            } else {
                const errJson = await logsRes.json().catch(() => ({}));
                setErrorBanner(errJson?.error || `Error HTTP ${logsRes.status} al consultar /api/admin/audit-logs`);
            }

            if (telResponse.ok) {
                const telJson = await telResponse.json().catch(() => null);
                setTelemetryData(telJson);
            } else {
                setTelemetryData(null);
            }
        } catch (err: any) {
            setErrorBanner(err?.message || 'Error de red consultando ledger y telemetria.');
        } finally {
            setLoadingData(false);
        }
    }, [fetchAdminApi]);

    useEffect(() => {
        if (!isLoaded || !session || (!session.isSuperAdmin && !session.isDevRoot)) return;
        if (activeTab === 'B2B' || activeTab === 'EDU') {
            loadTenants();
        } else if (activeTab === 'MODULES') {
            loadModulesStatus();
        } else if (activeTab === 'LEDGER') {
            loadLedgerAndTelemetry();
        }
    }, [activeTab, isLoaded, session, loadTenants, loadModulesStatus, loadLedgerAndTelemetry]);

    const filteredTenants = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return tenants.filter((t) => {
            const isEduRow =
                (t.type || '').toUpperCase() === 'EDUCATIONAL' ||
                (t.classification || '').toLowerCase() === 'edu';
            if (activeTab === 'EDU' && !isEduRow) return false;
            if (activeTab === 'B2B' && isEduRow) return false;
            if (!q) return true;
            const label = `${t.companyName || ''} ${t.name || ''} ${t.taxId || ''} ${t.rut || ''} ${t.email || ''} ${t.ownerEmail || ''}`.toLowerCase();
            return label.includes(q);
        });
    }, [tenants, activeTab, searchQuery]);

    const handleVerifyHashChain = async () => {
        setVerifyingChain(true);
        setErrorBanner(null);
        try {
            let res = await fetchAdminApi('/api/admin/audit-ledger/verify', { method: 'GET' });
            if (res.status === 404 || res.status === 405) {
                res = await fetchAdminApi('/api/admin/audit-ledger/verify', { method: 'POST', body: JSON.stringify({}) });
            }
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || `Endpoint de verificacion respondio HTTP ${res.status}`);
            }
            const isValid = Boolean(data.valid ?? data.verified ?? data.intact ?? data.success);
            setChainVerification({
                verified: isValid,
                checkedRecords: typeof data.checkedCount === 'number' ? data.checkedCount : data.totalChecked ?? auditLogs.length,
                message: data.message || (isValid ? 'Cadena criptografica SHA-256 integra y sin alteraciones.' : 'Discrepancia detectada en secuencia SHA-256.'),
            });
        } catch (err: any) {
            setChainVerification({
                verified: null,
                message: err?.message || 'No fue posible ejecutar verificacion remota de cadena SHA-256.',
            });
        } finally {
            setVerifyingChain(false);
        }
    };

    const executeHitlAction = async () => {
        if (!hitlAction || hitlKeyword.trim() !== 'ACTUALIZAR') return;
        setHitlSubmitting(true);
        setErrorBanner(null);
        setStatusBanner(null);

        try {
            if (hitlAction.kind === 'TENANT_STATUS' && hitlAction.targetUid && hitlAction.nextStatus) {
                const res = await fetchAdminApi(`/api/admin/tenants/${encodeURIComponent(hitlAction.targetUid)}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: hitlAction.nextStatus }),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(body?.error || `Error HTTP ${res.status} al actualizar organizacion`);
                }
                setStatusBanner(`Estado de cuenta ${hitlAction.targetUid} actualizado a ${hitlAction.nextStatus}.`);
                await loadTenants();
                setSelectedTenant((prev) => (prev && (prev.uid || prev.id) === hitlAction.targetUid ? { ...prev, status: hitlAction.nextStatus } : prev));
            } else if (hitlAction.kind === 'MODULE_TOGGLE' && hitlAction.moduleId && typeof hitlAction.nextEnabled === 'boolean') {
                const res = await fetchAdminApi('/api/admin/modules-status', {
                    method: 'PATCH',
                    body: JSON.stringify({
                        moduleId: hitlAction.moduleId,
                        enabled: hitlAction.nextEnabled,
                        confirmationWord: 'ACTUALIZAR',
                    }),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(body?.error || `Error HTTP ${res.status} al actualizar modulo`);
                }

                setPendingModuleToggle(null);
                setStatusBanner(`Disponibilidad global de ${hitlAction.moduleId.toUpperCase()} actualizada y registrada en AuditLedger SHA-256.`);
                await loadModulesStatus();
            }

            setHitlAction(null);
            setHitlKeyword('');
        } catch (err: any) {
            setErrorBanner(err?.message || 'Error ejecutando mutacion administrativa.');
        } finally {
            setHitlSubmitting(false);
        }
    };

    if (!isLoaded) return null;
    if (!user) return <Navigate to="/login" replace />;
    if (session?.isTestPilot) return <Navigate to="/pilot" replace />;
    if (!session?.isSuperAdmin && !session?.isDevRoot) return <Navigate to="/dashboard" replace />;

    return (
        <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col font-sans select-none antialiased">
            {/* Barra Superior Soberana 2º ADMIN */}
            <header className="h-14 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between sticky top-0 z-40">
                <div className="flex items-center gap-fib-21">
                    <BrandLogo variant="logotype" className="h-6 w-auto object-contain" />
                    <span className="text-microcopy font-mono uppercase text-[#C68346] border-l border-[#E2E8F0] dark:border-[#12151C] pl-fib-13">
                        2º ADMIN · OPERACION COMERCIAL Y AUDITORIA
                    </span>
                </div>

                <div className="flex items-center gap-fib-13">
                    {session.isDevRoot && (
                        <button
                            type="button"
                            onClick={() => navigate('/dev')}
                            title="Retornar a Cabina 1º DEV"
                            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-[#00AEEF] transition-colors cursor-pointer"
                        >
                            <span className="material-symbols-outlined text-[20px]">terminal</span>
                        </button>
                    )}
                    <LanguageSwitch />
                    <ThemeSwitch />
                    <button
                        type="button"
                        onClick={() => signOut()}
                        title="Cerrar sesion"
                        aria-label="Cerrar sesion"
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                    >
                        <span className="material-symbols-outlined text-[20px]">logout</span>
                    </button>
                </div>
            </header>

            {/* Navegacion Operativa de Pestañas */}
            <nav className="px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center gap-fib-21 overflow-x-auto">
                {[
                    { id: 'B2B' as AdminTab, label: '1. CLIENTES B2B', icon: 'domain' },
                    { id: 'EDU' as AdminTab, label: '2. ACREDITACIONES EDU', icon: 'school' },
                    { id: 'MODULES' as AdminTab, label: '3. DISPONIBILIDAD DE MODULOS', icon: 'tune' },
                    { id: 'LEDGER' as AdminTab, label: '4. AUDITORIA LEDGER & TELEMETRIA IA', icon: 'verified_user' },
                ].map((tab) => {
                    const active = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => {
                                setActiveTab(tab.id);
                                setSelectedTenant(null);
                                setErrorBanner(null);
                                setStatusBanner(null);
                            }}
                            className={`py-fib-13 px-fib-8 bg-transparent border-0 border-b-2 text-xs font-mono uppercase tracking-wider cursor-pointer transition-colors flex items-center gap-fib-8 whitespace-nowrap ${
                                active
                                    ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-bold'
                                    : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                            <span>{tab.label}</span>
                        </button>
                    );
                })}
            </nav>

            {/* Alertas Tecnicas */}
            {(errorBanner || statusBanner) && (
                <div className="px-fib-21 pt-fib-13">
                    {errorBanner && (
                        <div className="p-fib-13 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono rounded-none">
                            {errorBanner}
                        </div>
                    )}
                    {statusBanner && (
                        <div className="p-fib-13 bg-[#00AEEF]/10 border border-[#00AEEF]/30 text-[#00AEEF] text-xs font-mono rounded-none">
                            {statusBanner}
                        </div>
                    )}
                </div>
            )}

            {/* Macro-Layout en Proporcion Aurea (61.8% Area Mayor / 38.2% Area Menor) */}
            <main className="flex-1 flex flex-col lg:flex-row p-fib-21 gap-fib-21">
                {/* AREA MAYOR (61.8%) */}
                <section className="w-full lg:w-[61.8%] bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 rounded-none shadow-none flex flex-col gap-fib-21">
                    {(activeTab === 'B2B' || activeTab === 'EDU') && (
                        <>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <div>
                                    <h1 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                        {activeTab === 'B2B' ? 'Padron Comercial de Clientes B2B' : 'Solicitudes y Entornos Academicos EDU'}
                                    </h1>
                                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] font-mono tabular-nums">
                                        Registros verificados: {filteredTenants.length}
                                    </p>
                                </div>
                                <div className="flex items-center gap-fib-8">
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Filtrar por razon social, RUT o correo"
                                        className="bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] px-fib-13 py-2 text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none w-64 select-text"
                                    />
                                    <button
                                        type="button"
                                        onClick={loadTenants}
                                        title="Actualizar listado"
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                                    </button>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse font-mono text-data-dense tabular-nums">
                                    <thead>
                                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-microcopy uppercase">
                                            <th className="py-fib-13 px-fib-8">Organizacion</th>
                                            <th className="py-fib-13 px-fib-8">RUT / Tax ID</th>
                                            <th className="py-fib-13 px-fib-8">Correo Titular</th>
                                            <th className="py-fib-13 px-fib-8">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                        {loadingData ? (
                                            <tr>
                                                <td colSpan={4} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                                    Consultando /api/admin/tenants...
                                                </td>
                                            </tr>
                                        ) : filteredTenants.length === 0 ? (
                                            <tr>
                                                <td colSpan={4} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                                    [Sin organizaciones registradas en este segmento]
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredTenants.map((tenant) => {
                                                const tid = tenant.uid || tenant.id;
                                                const isSelected = (selectedTenant?.uid || selectedTenant?.id) === tid;
                                                const orgLabel = tenant.companyName || tenant.name || tenant.institution || MISSING_VALUE;
                                                const taxLabel = tenant.taxId || tenant.rut || '';
                                                const emailLabel = tenant.ownerEmail || tenant.email || '';

                                                return (
                                                    <tr
                                                        key={tid}
                                                        onClick={() => setSelectedTenant(tenant)}
                                                        className={`cursor-pointer transition-colors ${
                                                            isSelected
                                                                ? 'bg-[#C68346]/10'
                                                                : 'hover:bg-[#FFFFFF] dark:hover:bg-[#000000]'
                                                        }`}
                                                    >
                                                        <td className="py-fib-13 px-fib-8 font-sans font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                            {orgLabel}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8">
                                                            {taxLabel ? (
                                                                <span className="inline-flex items-center gap-1 select-text">
                                                                    <span>{taxLabel}</span>
                                                                    <CopyButton value={taxLabel} title="Copiar identificador" />
                                                                </span>
                                                            ) : (
                                                                <span className="text-[#94A3B8] dark:text-[#5A6072]">{MISSING_VALUE}</span>
                                                            )}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8">
                                                            {emailLabel ? (
                                                                <span className="inline-flex items-center gap-1 select-text">
                                                                    <span>{emailLabel}</span>
                                                                    <CopyButton value={emailLabel} title="Copiar correo" />
                                                                </span>
                                                            ) : (
                                                                <span className="text-[#94A3B8] dark:text-[#5A6072]">{MISSING_VALUE}</span>
                                                            )}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8">
                                                            <span className="text-microcopy uppercase text-[#00AEEF]">
                                                                {tenant.status || 'PENDING'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {activeTab === 'MODULES' && (
                        <div className="space-y-fib-21">
                            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <h1 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                    Disponibilidad Global de Modulos Nativos (`modules_status`)
                                </h1>
                                <p className="text-xs text-[#475569] dark:text-[#8A93A6]">
                                    Control maestro de disponibilidad operativa para cuentas B2B y EDU. Toda mutacion requiere validacion humana HITL.
                                </p>
                            </div>

                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                                {modulesState.map((mod) => (
                                    <div key={mod.id} className="p-fib-21 flex items-center justify-between gap-fib-21">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-fib-13">
                                                <span className="font-mono text-xs font-bold text-[#C68346]">{mod.code}</span>
                                                <span className="text-sm font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">{mod.name}</span>
                                            </div>
                                            <p className="text-xs text-[#475569] dark:text-[#8A93A6]">{mod.description}</p>
                                            <p className="text-[11px] font-mono tabular-nums text-[#94A3B8] dark:text-[#5A6072]">
                                                Ultima actualizacion: {mod.updatedAt || MISSING_VALUE}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-fib-13">
                                            <span className="font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {mod.enabled ? 'HABILITADO' : 'SUSPENDIDO'}
                                            </span>
                                            <M3Switch
                                                checked={mod.enabled}
                                                onChange={(nextVal) => {
                                                    setPendingModuleToggle({
                                                        moduleId: mod.id,
                                                        current: mod.enabled,
                                                        next: nextVal,
                                                    });
                                                    setHitlAction({
                                                        kind: 'MODULE_TOGGLE',
                                                        title: ` Disponibilidad Global ${mod.name}`,
                                                        summary: `[Actual: ${mod.enabled ? 'HABILITADO' : 'SUSPENDIDO'}] -> [Sugerido: ${nextVal ? 'HABILITADO' : 'SUSPENDIDO'}]`,
                                                        moduleId: mod.id,
                                                        nextEnabled: nextVal,
                                                    });
                                                    setHitlKeyword('');
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === 'LEDGER' && (
                        <div className="space-y-fib-21">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <div>
                                    <h1 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                        Audit Ledger Criptografico Inmutable (SHA-256)
                                    </h1>
                                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] font-mono tabular-nums">
                                        Eventos auditados: {auditLogs.length}
                                    </p>
                                </div>
                                <div className="flex items-center gap-fib-8">
                                    <button
                                        type="button"
                                        onClick={handleVerifyHashChain}
                                        disabled={verifyingChain}
                                        className="px-fib-13 py-2 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase tracking-wider rounded-none shadow-none border-0 cursor-pointer disabled:opacity-50"
                                    >
                                        {verifyingChain ? 'Verificando SHA-256...' : 'Verificar Integridad SHA-256'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={loadLedgerAndTelemetry}
                                        title="Recargar registros"
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                                    </button>
                                </div>
                            </div>

                            {chainVerification && (
                                <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] text-xs font-mono tabular-nums space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="uppercase font-bold text-[#00AEEF]">
                                            ESTADO VERIFICACION CADENA SHA-256
                                        </span>
                                        <span>
                                            {chainVerification.verified === true
                                                ? 'INTEGRA'
                                                : chainVerification.verified === false
                                                    ? 'ALTERADA'
                                                    : 'SIN CONFIRMACION REMOTA'}
                                        </span>
                                    </div>
                                    <p className="text-[#475569] dark:text-[#8A93A6]">{chainVerification.message}</p>
                                </div>
                            )}

                            <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
                                <table className="w-full text-left border-collapse font-mono text-data-dense tabular-nums">
                                    <thead>
                                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-microcopy uppercase">
                                            <th className="py-fib-13 px-fib-8">Timestamp</th>
                                            <th className="py-fib-13 px-fib-8">Accion</th>
                                            <th className="py-fib-13 px-fib-8">Actor</th>
                                            <th className="py-fib-13 px-fib-8">Modulo</th>
                                            <th className="py-fib-13 px-fib-8">Hash SHA-256</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                        {auditLogs.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                                    [Sin registros de auditoria disponibles]
                                                </td>
                                            </tr>
                                        ) : (
                                            auditLogs.map((entry) => {
                                                const resolvedHash = entry.entryHash || entry.hash;
                                                const formattedTs = typeof entry.timestamp === 'number'
                                                    ? new Date(entry.timestamp).toISOString()
                                                    : entry.timestamp
                                                        ? String(entry.timestamp)
                                                        : MISSING_VALUE;
                                                return (
                                                    <tr key={entry.id} className="hover:bg-[#FFFFFF] dark:hover:bg-[#000000]">
                                                        <td className="py-fib-13 px-fib-8 whitespace-nowrap text-xs">
                                                            {formattedTs}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8 font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                            {entry.action || MISSING_VALUE}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8 select-text">
                                                            {entry.actorEmail || entry.actorUid || MISSING_VALUE}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8 uppercase text-[#C68346]">
                                                            {entry.module || 'core'}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8">
                                                            {resolvedHash ? (
                                                                <span className="inline-flex items-center gap-1 select-text">
                                                                    <span>{resolvedHash.slice(0, 14)}...</span>
                                                                    <CopyButton value={resolvedHash} title="Copiar hash SHA-256 completo" />
                                                                </span>
                                                            ) : (
                                                                <span className="text-[#94A3B8] dark:text-[#5A6072]">{MISSING_VALUE}</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </section>

                {/* AREA MENOR (38.2%) - Ficha de Ingenieria / Telemetria Real / HITL */}
                <aside className="w-full lg:w-[38.2%] bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 rounded-none shadow-none flex flex-col gap-fib-21">
                    {(activeTab === 'B2B' || activeTab === 'EDU') && (
                        <>
                            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <span className="text-microcopy font-mono uppercase text-[#00AEEF]">
                                    INFORME TECNICO DE CUENTA (SOLO LECTURA)
                                </span>
                                <h2 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                                    {selectedTenant
                                        ? (selectedTenant.companyName || selectedTenant.name || selectedTenant.institution || MISSING_VALUE)
                                        : 'Seleccione una organizacion'}
                                </h2>
                            </div>

                            {!selectedTenant ? (
                                <p className="text-xs text-[#94A3B8] dark:text-[#5A6072] font-mono">
                                    Seleccione un registro en el panel principal (61.8%) para inspeccionar su ficha oficial y ejecutar acciones HITL.
                                </p>
                            ) : (
                                <div className="space-y-fib-21 text-xs font-mono tabular-nums">
                                    <dl className="space-y-fib-13">
                                        <div>
                                            <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">ID Cuenta / UID</dt>
                                            <dd className="text-[#0F172A] dark:text-[#F3F4F6] flex items-center gap-1 select-text mt-0.5">
                                                <span>{selectedTenant.uid || selectedTenant.id}</span>
                                                <CopyButton value={selectedTenant.uid || selectedTenant.id} />
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">Identificador Tributario (RUT)</dt>
                                            <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5 select-text">
                                                {selectedTenant.taxId || selectedTenant.rut || MISSING_VALUE}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">Correo Mandatario</dt>
                                            <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5 select-text">
                                                {selectedTenant.ownerEmail || selectedTenant.email || MISSING_VALUE}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">Estado Operativo</dt>
                                            <dd className="text-[#00AEEF] uppercase mt-0.5">
                                                {selectedTenant.status || 'PENDING'}
                                            </dd>
                                        </div>
                                        {activeTab === 'EDU' && (
                                            <>
                                                <div>
                                                    <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">Dominio / Institucion Academica</dt>
                                                    <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                                        {selectedTenant.institution || selectedTenant.academicDomain || MISSING_VALUE}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">Respaldo Documental</dt>
                                                    <dd className="mt-0.5">
                                                        {selectedTenant.documentUrl ? (
                                                            <a
                                                                href={selectedTenant.documentUrl}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="text-[#00AEEF] underline"
                                                            >
                                                                Abrir certificado acreditado
                                                            </a>
                                                        ) : (
                                                            <span className="text-[#94A3B8] dark:text-[#5A6072]">{MISSING_VALUE}</span>
                                                        )}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">Regimen de Aislamiento</dt>
                                                    <dd className="text-[#C68346] mt-0.5">ENTORNO ACADEMICO SANDBOX (isEduSandbox: true)</dd>
                                                </div>
                                            </>
                                        )}
                                    </dl>

                                    <div className="pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap gap-fib-8">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const targetUid = selectedTenant.uid || selectedTenant.id;
                                                setHitlAction({
                                                    kind: 'TENANT_STATUS',
                                                    title: 'Aprobar y Activar Organizacion',
                                                    summary: `[Actual: ${selectedTenant.status || 'PENDING'}] -> [Sugerido: ACTIVE] (${targetUid})`,
                                                    targetUid,
                                                    nextStatus: 'ACTIVE',
                                                });
                                                setHitlKeyword('');
                                            }}
                                            className="px-fib-13 py-2 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase rounded-none border-0 cursor-pointer"
                                        >
                                            Activar Cuenta
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const targetUid = selectedTenant.uid || selectedTenant.id;
                                                setHitlAction({
                                                    kind: 'TENANT_STATUS',
                                                    title: 'Suspender Organizacion',
                                                    summary: `[Actual: ${selectedTenant.status || 'ACTIVE'}] -> [Sugerido: SUSPENDED] (${targetUid})`,
                                                    targetUid,
                                                    nextStatus: 'SUSPENDED',
                                                });
                                                setHitlKeyword('');
                                            }}
                                            className="px-fib-13 py-2 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-red-500 text-[#0F172A] dark:text-[#F3F4F6] text-xs font-mono uppercase rounded-none cursor-pointer"
                                        >
                                            Suspender
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const targetUid = selectedTenant.uid || selectedTenant.id;
                                                setHitlAction({
                                                    kind: 'TENANT_STATUS',
                                                    title: 'Rechazar Solicitud',
                                                    summary: `[Actual: ${selectedTenant.status || 'PENDING'}] -> [Sugerido: REJECTED] (${targetUid})`,
                                                    targetUid,
                                                    nextStatus: 'REJECTED',
                                                });
                                                setHitlKeyword('');
                                            }}
                                            className="px-fib-13 py-2 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-red-500 text-red-600 dark:text-red-400 text-xs font-mono uppercase rounded-none cursor-pointer"
                                        >
                                            Rechazar
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {activeTab === 'MODULES' && (
                        <div className="space-y-fib-13 text-xs font-mono">
                            <span className="text-microcopy uppercase text-[#00AEEF]">GOBERNANZA MODULAR NATIVA</span>
                            <h2 className="text-h2-section font-sans uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                Politica de Modulos Integrados
                            </h2>
                            <p className="text-[#475569] dark:text-[#8A93A6] font-sans leading-relaxed">
                                MINREPORT opera exclusivamente con los modulos nativos integrados OPERMAQ y STOCKPILE CONTROL sobre la misma base de datos en southamerica-west1.
                            </p>
                            {pendingModuleToggle && (
                                <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#C68346] space-y-1">
                                    <span className="text-microcopy uppercase text-[#C68346]">CAMBIO PENDIENTE DE CONFIRMACION</span>
                                    <p className="text-[#0F172A] dark:text-[#F3F4F6]">
                                        {pendingModuleToggle.moduleId.toUpperCase()}: {pendingModuleToggle.current ? 'HABILITADO' : 'SUSPENDIDO'}
                                        {' '}
                                        <span className="material-symbols-outlined text-[14px] align-middle">arrow_forward</span>
                                        {' '}
                                        {pendingModuleToggle.next ? 'HABILITADO' : 'SUSPENDIDO'}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'LEDGER' && (
                        <div className="space-y-fib-21">
                            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <span className="text-microcopy font-mono uppercase text-[#00AEEF]">
                                    CAPA 4 · ENJAMBRE GEMINI AI
                                </span>
                                <h2 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                                    Telemetria Real de Inferencia
                                </h2>
                            </div>

                            {!telemetryData ? (
                                <p className="text-xs font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                    {MISSING_VALUE}
                                </p>
                            ) : (
                                <dl className="grid grid-cols-1 gap-fib-13 font-mono text-xs tabular-nums">
                                    <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]">
                                        <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">Total Solicitudes Registradas</dt>
                                        <dd className="text-kpi-display text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                                            {telemetryData.telemetrySummary?.totalCalls ?? telemetryData.totalRequests ?? 0}
                                        </dd>
                                    </div>
                                    <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]">
                                        <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">Cache Determinista / Recibos x402</dt>
                                        <dd className="text-h1-header text-[#00AEEF] mt-1">
                                            {telemetryData.telemetrySummary?.cacheHits ?? 0} hits · {telemetryData.protocolX402?.settledReceiptsCount ?? 0} x402
                                        </dd>
                                    </div>
                                    <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-1">
                                        <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">Estado del Enjambre (Pro / Flash / Flash-Lite)</dt>
                                        {telemetryData.swarmStatus ? (
                                            <dd className="space-y-1 pt-1 text-xs text-[#0F172A] dark:text-[#F3F4F6]">
                                                {(['pro', 'flash', 'flashLite'] as const).map((tierKey) => {
                                                    const item = telemetryData.swarmStatus?.[tierKey];
                                                    if (!item) return null;
                                                    return (
                                                        <div key={tierKey} className="flex items-center justify-between gap-2">
                                                            <span className="truncate">{item.model}</span>
                                                            <span className="text-[#475569] dark:text-[#8A93A6]">
                                                                {item.calls ?? 0} req · {item.avgLatencyMs !== null && item.avgLatencyMs !== undefined ? `${item.avgLatencyMs} ms` : 'N/A'}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </dd>
                                        ) : (
                                            <dd className="text-xs text-[#94A3B8] dark:text-[#5A6072]">{MISSING_VALUE}</dd>
                                        )}
                                    </div>
                                </dl>
                            )}
                        </div>
                    )}

                    {/* Bloque Modal/Inline de Confirmacion Obligatoria HITL ("ACTUALIZAR") */}
                    {hitlAction && (
                        <div className="mt-auto p-fib-21 bg-[#FFFFFF] dark:bg-[#000000] border border-[#C68346] space-y-fib-13">
                            <div className="flex items-center justify-between">
                                <span className="text-microcopy font-mono uppercase text-[#C68346]">
                                    CONFIRMACION HITL OBLIGATORIA
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setHitlAction(null);
                                        setPendingModuleToggle(null);
                                        setHitlKeyword('');
                                    }}
                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-[18px]">close</span>
                                </button>
                            </div>
                            <p className="text-xs font-bold text-[#0F172A] dark:text-[#F3F4F6]">{hitlAction.title}</p>
                            <p className="text-xs font-mono text-[#475569] dark:text-[#8A93A6]">{hitlAction.summary}</p>
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    executeHitlAction();
                                }}
                                autoComplete="off"
                                spellCheck={false}
                                className="space-y-fib-13"
                            >
                                <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    Escriba ACTUALIZAR para autorizar el cambio
                                </label>
                                <input
                                    type="text"
                                    required
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={hitlKeyword}
                                    onChange={(e) => setHitlKeyword(e.target.value.toUpperCase())}
                                    placeholder="ACTUALIZAR"
                                    className="w-full px-fib-13 py-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-xs font-mono tracking-widest text-center text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none"
                                />
                                <button
                                    type="submit"
                                    disabled={hitlKeyword.trim() !== 'ACTUALIZAR' || hitlSubmitting}
                                    className="w-full py-2.5 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase tracking-wider rounded-none border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {hitlSubmitting ? 'CONSOLIDANDO...' : 'CONFIRMAR MUTACION OFICIAL'}
                                </button>
                            </form>
                        </div>
                    )}
                </aside>
            </main>
        </div>
    );
};

export default SuperAdminConsole;
