import React, { useState } from 'react';
import { formatRut } from '../../utils/rut';

interface Admin {
    id: string;
    name: string;
    lastName: string;
    run: string;
    email: string;
    status: 'ACTIVE' | 'PENDING';
    assignedAt: string;
}

export const AdminsPage = () => {
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
            setAdmins(prev => [...prev, {
                ...form,
                id: Date.now().toString(),
                status: 'PENDING',
                assignedAt: new Date().toLocaleDateString('es-CL')
            }]);
            setForm({ name: '', lastName: '', run: '', email: '' });
            setLoading(false);
        }, 600);
    };

    const handleRevoke = (id: string) => {
        if (window.confirm('¿Revocar acceso de este Administrador General?')) {
            setAdmins(prev => prev.filter(a => a.id !== id));
        }
    };

    const inp = 'w-full bg-transparent border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-[#C68346] rounded-none transition-colors';
    const lbl = 'block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1';

    return (
        <div className="max-w-5xl mx-auto py-8 px-6 space-y-8" style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}>

            {/* Header */}
            <div className="border-b border-gray-200 dark:border-gray-800 pb-6">
                <h1 className="text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-white">Administradores Generales</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Designa hasta 2 administradores internos. Gestionarán el personal operativo y perfiles de cargo.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Formulario */}
                <div className="border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1a2233] p-6">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white mb-1">Designar Administrador</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
                        {admins.length < 2
                            ? `Puedes designar ${2 - admins.length} administrador${2 - admins.length !== 1 ? 'es' : ''} más.`
                            : 'Límite alcanzado. Revoca uno para agregar otro.'}
                    </p>

                    <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className={lbl}>Nombre</label>
                                <input required type="text" autoComplete="off" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inp} />
                            </div>
                            <div>
                                <label className={lbl}>Apellidos</label>
                                <input required type="text" autoComplete="off" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} className={inp} />
                            </div>
                        </div>
                        <div>
                            <label className={lbl}>RUN</label>
                            <input required type="text" autoComplete="off" value={form.run}
                                onChange={e => setForm({ ...form, run: formatRut(e.target.value) })}
                                placeholder="12.345.678-9" className={inp + ' font-mono'} />
                        </div>
                        <div>
                            <label className={lbl}>Email Laboral</label>
                            <input required type="email" autoComplete="off" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={inp} />
                        </div>

                        {error && <p className="text-xs text-red-500">{error}</p>}

                        <button
                            type="submit"
                            disabled={admins.length >= 2 || loading}
                            className="w-full mt-2 bg-[#C68346] hover:bg-[#b0743e] text-white text-xs font-bold uppercase tracking-wider py-3 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-none"
                        >
                            {loading ? 'Enviando invitación...' : 'Designar Administrador'}
                        </button>
                    </form>
                </div>

                {/* Tabla */}
                <div className="lg:col-span-2">
                    <div className="flex items-baseline justify-between mb-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Administradores asignados</p>
                        <span className="text-xs text-gray-400 font-mono">{admins.length} / 2</span>
                    </div>
                    <div className="border border-gray-200 dark:border-gray-800 overflow-hidden">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                                    {['RUN', 'Nombre', 'Email', 'Estado', 'Designado', ''].map((h, i) => (
                                        <th key={i} className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500 ${i === 5 ? 'text-right' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {admins.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                                            No hay administradores generales designados.
                                        </td>
                                    </tr>
                                )}
                                {admins.map(admin => (
                                    <tr key={admin.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                        <td className="px-4 py-3 font-mono text-xs">{admin.run}</td>
                                        <td className="px-4 py-3 font-semibold">{admin.name} {admin.lastName}</td>
                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{admin.email}</td>
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
                        El administrador recibirá una invitación por email con instrucciones para activar su acceso.
                    </p>
                </div>
            </div>
        </div>
    );
};
