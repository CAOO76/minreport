import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { formatRut } from '../../utils/rut';

// ─────────────────────────────────────────────
// Tipos locales
// ─────────────────────────────────────────────
type Tab = 'empresa' | 'admins' | 'metricas' | 'suscripcion';

interface Admin {
    id: string;
    name: string;
    lastName: string;
    run: string;
    email: string;
    status: 'ACTIVE' | 'PENDING';
    assignedAt: string;
}

// ─────────────────────────────────────────────
// Sub-componentes de secciones
// ─────────────────────────────────────────────

/** 1. DATOS DE LA EMPRESA (SII / Información comercial principal) */
const SeccionEmpresa = ({ account }: { account: any }) => {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({
        razonSocial: account?.name || '',
        nombreFantasia: '',
        rut: account?.taxId || '',
        giro: '',
        direccionComercial: '',
        comunaComercial: '',
        ciudadComercial: '',
        direccionSucursal: '',
        emailComercial: '',
        emailTributario: '',
        telefonoPrincipal: '',
        telefonoSecundario: '',
    });

    const labelCls = 'block text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1';
    const inputCls = 'w-full bg-transparent border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#C68346] rounded-none transition-colors disabled:opacity-50 disabled:bg-gray-100 dark:disabled:bg-gray-900';

    return (
        <div className="space-y-8">
            {/* Header de sección */}
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-base font-bold uppercase tracking-wider text-gray-900 dark:text-white">Datos Comerciales</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Información registrada ante el SII. Utilizada en facturas y contratos.</p>
                </div>
                <button
                    onClick={() => setEditing(!editing)}
                    className={`text-xs font-bold uppercase tracking-wider px-4 py-2 border transition-colors rounded-none ${editing
                        ? 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                        : 'border-[#C68346] text-[#C68346] hover:bg-[#C68346]/10'
                        }`}
                >
                    {editing ? 'Cancelar' : 'Editar'}
                </button>
            </div>

            {/* Bloque 1: Identificación legal */}
            <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3 border-b border-gray-200 dark:border-gray-800 pb-1">Identificación Legal</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                        <label className={labelCls}>Razón Social</label>
                        <input type="text" disabled={!editing} autoComplete="off" value={form.razonSocial} onChange={e => setForm({ ...form, razonSocial: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>RUT Empresa</label>
                        <input type="text" disabled className={inputCls + ' cursor-not-allowed'} value={form.rut} title="El RUT no puede modificarse" />
                    </div>
                    <div>
                        <label className={labelCls}>Nombre de Fantasía</label>
                        <input type="text" disabled={!editing} autoComplete="off" value={form.nombreFantasia} onChange={e => setForm({ ...form, nombreFantasia: e.target.value })} className={inputCls} />
                    </div>
                    <div className="md:col-span-2">
                        <label className={labelCls}>Giro Comercial</label>
                        <input type="text" disabled={!editing} autoComplete="off" value={form.giro} onChange={e => setForm({ ...form, giro: e.target.value })} className={inputCls} />
                    </div>
                </div>
            </div>

            {/* Bloque 2: Direcciones */}
            <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3 border-b border-gray-200 dark:border-gray-800 pb-1">Direcciones</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-1">
                        <label className={labelCls}>Dirección Comercial (Sede Principal)</label>
                        <input type="text" disabled={!editing} autoComplete="off" value={form.direccionComercial} onChange={e => setForm({ ...form, direccionComercial: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Comuna</label>
                        <input type="text" disabled={!editing} autoComplete="off" value={form.comunaComercial} onChange={e => setForm({ ...form, comunaComercial: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Ciudad</label>
                        <input type="text" disabled={!editing} autoComplete="off" value={form.ciudadComercial} onChange={e => setForm({ ...form, ciudadComercial: e.target.value })} className={inputCls} />
                    </div>
                    <div className="md:col-span-3">
                        <label className={labelCls}>Dirección Sucursal Operativa (si aplica)</label>
                        <input type="text" disabled={!editing} autoComplete="off" value={form.direccionSucursal} onChange={e => setForm({ ...form, direccionSucursal: e.target.value })} className={inputCls} />
                    </div>
                </div>
            </div>

            {/* Bloque 3: Contacto */}
            <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3 border-b border-gray-200 dark:border-gray-800 pb-1">Contacto Oficial</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>Email Comercial</label>
                        <input type="email" disabled={!editing} autoComplete="off" value={form.emailComercial} onChange={e => setForm({ ...form, emailComercial: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Email Tributario / SII</label>
                        <input type="email" disabled={!editing} autoComplete="off" value={form.emailTributario} onChange={e => setForm({ ...form, emailTributario: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Teléfono Principal</label>
                        <input type="tel" disabled={!editing} autoComplete="off" value={form.telefonoPrincipal} onChange={e => setForm({ ...form, telefonoPrincipal: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Teléfono Secundario</label>
                        <input type="tel" disabled={!editing} autoComplete="off" value={form.telefonoSecundario} onChange={e => setForm({ ...form, telefonoSecundario: e.target.value })} className={inputCls} />
                    </div>
                </div>
            </div>

            {/* Zona de carga de logo */}
            <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3 border-b border-gray-200 dark:border-gray-800 pb-1">Identidad Visual</p>
                <div className="flex items-center gap-6">
                    <div className="border border-dashed border-gray-300 dark:border-gray-600 w-40 h-20 flex items-center justify-center cursor-pointer hover:border-[#C68346] transition-colors rounded-none">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Logo Corporativo</span>
                    </div>
                    <div className="text-xs text-gray-400">
                        <p>PNG, SVG o JPG. Máx. 2 MB.</p>
                        <p className="mt-1">Se utilizará en reportes y documentos exportados.</p>
                    </div>
                </div>
            </div>

            {editing && (
                <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-800">
                    <button
                        onClick={() => setEditing(false)}
                        className="bg-[#C68346] hover:bg-[#b0743e] text-white font-bold uppercase tracking-wider text-xs py-2 px-6 rounded-none transition-colors"
                    >
                        Guardar Cambios
                    </button>
                </div>
            )}
        </div>
    );
};

/** 2. ADMINISTRADORES GENERALES */
const SeccionAdmins = () => {
    const [admins, setAdmins] = useState<Admin[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({ name: '', lastName: '', run: '', email: '' });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (admins.length >= 2) { setError('Límite de 2 Administradores Generales alcanzado.'); return; }
        setLoading(true);
        setError(null);
        setTimeout(() => {
            setAdmins([...admins, { ...form, id: Date.now().toString(), status: 'PENDING', assignedAt: new Date().toLocaleDateString('es-CL') }]);
            setForm({ name: '', lastName: '', run: '', email: '' });
            setLoading(false);
        }, 600);
    };

    const handleRevoke = (id: string) => {
        if (window.confirm('¿Revocar acceso de este Administrador General?')) {
            setAdmins(prev => prev.filter(a => a.id !== id));
        }
    };

    const inputCls = 'w-full bg-transparent border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-[#C68346] rounded-none transition-colors';

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Formulario */}
            <div className="border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1a2233] p-6">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white mb-1">Designar Administrador</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">Máximo 2 administradores generales por cuenta.</p>

                <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Nombre</label>
                            <input required type="text" autoComplete="off" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} />
                        </div>
                        <div>
                            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Apellidos</label>
                            <input required type="text" autoComplete="off" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} className={inputCls} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">RUN</label>
                        <input required type="text" autoComplete="off" value={form.run} onChange={e => setForm({ ...form, run: formatRut(e.target.value) })} placeholder="12.345.678-9" className={inputCls + ' font-mono'} />
                    </div>
                    <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Email Laboral</label>
                        <input required type="email" autoComplete="off" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={inputCls} />
                    </div>

                    {error && <p className="text-xs text-red-500">{error}</p>}

                    <button
                        type="submit"
                        disabled={admins.length >= 2 || loading}
                        className="w-full mt-2 bg-[#C68346] hover:bg-[#b0743e] text-white text-xs font-bold uppercase tracking-wider py-3 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-none"
                    >
                        {loading ? 'Enviando invitación...' : `Designar (${admins.length}/2 asignados)`}
                    </button>
                </form>
            </div>

            {/* Tabla */}
            <div className="lg:col-span-2">
                <div className="flex items-baseline justify-between mb-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white">Administradores Generales</h3>
                    <span className="text-xs text-gray-400">{admins.length} de 2 asignados</span>
                </div>
                <div className="border border-gray-200 dark:border-gray-800 overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">RUN</th>
                                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Nombre</th>
                                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Email</th>
                                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Estado</th>
                                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Designado</th>
                                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500 text-right">Acción</th>
                            </tr>
                        </thead>
                        <tbody>
                            {admins.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                                        No hay administradores generales designados para esta cuenta.
                                    </td>
                                </tr>
                            )}
                            {admins.map(admin => (
                                <tr key={admin.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                    <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">{admin.run}</td>
                                    <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{admin.name} {admin.lastName}</td>
                                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{admin.email}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-[10px] font-bold uppercase tracking-wider ${admin.status === 'ACTIVE' ? 'text-[#C68346]' : 'text-gray-400'}`}>
                                            {admin.status === 'ACTIVE' ? 'Activo' : 'Pendiente'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-gray-400">{admin.assignedAt}</td>
                                    <td className="px-4 py-3 text-right">
                                        <button onClick={() => handleRevoke(admin.id)} className="text-xs text-gray-400 hover:text-red-500 font-semibold uppercase tracking-wider transition-colors">
                                            Revocar
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
                    El Administrador General recibirá una invitación por email para configurar su acceso. Podrá gestionar el personal de terreno y perfiles de cargo internos.
                </p>
            </div>
        </div>
    );
};

/** 3. MÉTRICAS DE USO */
const SeccionMetricas = () => {
    const metricas = [
        { label: 'Usuarios Activos', value: '—', sub: 'de — licencias', accent: false },
        { label: 'Reportes Generados', value: '—', sub: 'este mes', accent: false },
        { label: 'Almacenamiento', value: '—', sub: 'de — GB disponibles', accent: true },
        { label: 'Módulos Activos', value: '—', sub: 'habilitados', accent: false },
    ];

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-base font-bold uppercase tracking-wider text-gray-900 dark:text-white">Métricas de Uso</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Resumen del consumo de la plataforma durante el período activo.</p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {metricas.map((m, i) => (
                    <div key={i} className="border border-gray-200 dark:border-gray-800 p-5 bg-gray-50 dark:bg-[#1a2233]">
                        <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${m.accent ? 'text-[#C68346]' : 'text-gray-500 dark:text-gray-400'}`}>{m.label}</p>
                        <p className="text-2xl font-mono text-gray-900 dark:text-white">{m.value}</p>
                        <p className="text-xs text-gray-400 mt-1">{m.sub}</p>
                    </div>
                ))}
            </div>

            <div className="border border-gray-200 dark:border-gray-800 p-6">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-4">Actividad por Módulo</p>
                <div className="flex items-center justify-center h-32 text-sm text-gray-400">
                    Datos de actividad disponibles cuando comiencen a utilizarse los módulos.
                </div>
            </div>
        </div>
    );
};

/** 4. SUSCRIPCIÓN MINREPORT */
const SeccionSuscripcion = ({ account }: { account: any }) => {
    const rows: { label: string; value: string }[] = [
        { label: 'Plan', value: (account as any)?.subscriptionPlan || 'Enterprise Pro' },
        { label: 'Estado del Contrato', value: 'Vigente' },
        { label: 'Inicio del Contrato', value: '—' },
        { label: 'Próximo Vencimiento', value: '—' },
        { label: 'Ciclo de Facturación', value: 'Mensual' },
        { label: 'Moneda', value: 'CLP' },
    ];

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-base font-bold uppercase tracking-wider text-gray-900 dark:text-white">Contrato de Suscripción</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Condiciones del servicio MINREPORT para esta cuenta.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Datos del contrato */}
                <div className="border border-gray-200 dark:border-gray-800">
                    <div className="bg-gray-100 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Condiciones del Contrato</p>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {rows.map((r, i) => (
                            <div key={i} className="flex justify-between items-center px-4 py-3">
                                <span className="text-xs text-gray-500 dark:text-gray-400">{r.label}</span>
                                <span className="text-sm font-semibold text-gray-900 dark:text-white">{r.value}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Historial de facturación */}
                <div className="border border-gray-200 dark:border-gray-800">
                    <div className="bg-gray-100 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Historial de Facturación</p>
                    </div>
                    <div className="px-4 py-10 text-center text-sm text-gray-400">
                        Sin facturas registradas en el período.
                    </div>
                </div>
            </div>

            <div className="border border-yellow-500/20 bg-yellow-500/5 p-4">
                <p className="text-xs text-yellow-700 dark:text-yellow-400">
                    Para modificar las condiciones del contrato, solicitudes de cambio de plan o terminación del servicio, contacta a tu ejecutivo de cuentas MINREPORT.
                </p>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// Componente Principal
// ─────────────────────────────────────────────
export const SubscriptionAdminDashboard = () => {
    const { currentAccount } = useAuth();
    const [activeTab, setActiveTab] = useState<Tab>('empresa');

    if (!currentAccount) return null;

    const tabs: { id: Tab; label: string; icon: string }[] = [
        { id: 'empresa', label: 'Datos de la Empresa', icon: 'business' },
        { id: 'admins', label: 'Administradores', icon: 'manage_accounts' },
        { id: 'metricas', label: 'Métricas de Uso', icon: 'bar_chart' },
        { id: 'suscripcion', label: 'Suscripción', icon: 'receipt_long' },
    ];

    return (
        <div
            className="min-h-screen bg-white dark:bg-[#111827] text-gray-900 dark:text-gray-100"
            style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}
        >
            {/* Header */}
            <div className="border-b border-gray-200 dark:border-gray-800 px-8 pt-8 pb-0">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold uppercase tracking-tight text-gray-900 dark:text-white">{currentAccount.name}</h1>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">{currentAccount.taxId} · Administrador de Suscripción</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#C68346]">Plan Activo</p>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{currentAccount.subscriptionPlan || 'Enterprise Pro'}</p>
                    </div>
                </div>

                {/* Tabs */}
                <nav className="flex gap-0 overflow-x-auto">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-5 py-3 text-[11px] font-bold uppercase tracking-wider border-b-2 transition-colors whitespace-nowrap rounded-none ${activeTab === tab.id
                                ? 'border-[#C68346] text-[#C68346]'
                                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                }`}
                        >
                            <span className="material-symbols-rounded text-base">{tab.icon}</span>
                            {tab.label}
                        </button>
                    ))}
                </nav>
            </div>

            {/* Contenido de la pestaña activa */}
            <div className="px-8 py-8">
                {activeTab === 'empresa' && <SeccionEmpresa account={currentAccount} />}
                {activeTab === 'admins' && <SeccionAdmins />}
                {activeTab === 'metricas' && <SeccionMetricas />}
                {activeTab === 'suscripcion' && <SeccionSuscripcion account={currentAccount} />}
            </div>
        </div>
    );
};
