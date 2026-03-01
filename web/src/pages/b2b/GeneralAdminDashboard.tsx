import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { StaffManager } from '../../components/b2b/StaffManager';

export const GeneralAdminDashboard = () => {
    const { currentAccount } = useAuth();

    const [staff, setStaff] = useState([
        { id: '101', name: 'Pedro', lastName: 'Pérez', run: '18.456.789-0', email: 'pperez@minera.cl', role: 'TOPOGRAFO', status: 'ACTIVE' },
        { id: '102', name: 'María', lastName: 'López', run: '17.345.678-9', email: 'mlopez@minera.cl', role: 'OPERADOR', status: 'SUSPENDED' }
    ]);

    const [formData, setFormData] = useState({
        name: '',
        lastName: '',
        run: '',
        email: '',
        role: 'OPERADOR'
    });

    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setStaff([...staff, { ...formData, id: Date.now().toString(), status: 'ACTIVE' }]);
        setFormData({ name: '', lastName: '', run: '', email: '', role: 'OPERADOR' });
    };

    const toggleStatus = (id: string) => {
        setStaff(staff.map(user => {
            if (user.id === id) {
                return { ...user, status: user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' };
            }
            return user;
        }));
    };

    if (!currentAccount) return null;

    return (
        <div className="min-h-screen bg-white dark:bg-[#111827] text-gray-900 dark:text-gray-100 p-8 font-['Atkinson_Hyperlegible']">

            <div className="mb-12 border-b border-gray-200 dark:border-gray-800 pb-8 flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2 uppercase">Operación Mina</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">Panel de Administrador General</p>
                </div>
                <div className="text-right">
                    <span className="text-xs uppercase tracking-widest text-[#C68346] font-bold">Personal Activo</span>
                    <p className="text-2xl font-mono mt-2">{staff.filter(s => s.status === 'ACTIVE').length}</p>
                </div>
            </div>

            {/* Invite Form */}
            <div className="border border-gray-200 dark:border-gray-800 p-6 rounded-none bg-gray-50 dark:bg-[#1F2937] mb-8">
                <h2 className="text-sm font-bold uppercase tracking-wider mb-6 text-gray-500">Acreditar Nuevo Personal</h2>

                <form onSubmit={handleSubmit} autoComplete="off" className="flex flex-col lg:flex-row gap-4 items-end">
                    <div className="flex-1 w-full">
                        <label className="block text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Nombre</label>
                        <input required type="text" autoComplete="off" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-white dark:bg-[#111827] border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-[#C68346] rounded-none transition-colors" />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="block text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Apellidos</label>
                        <input required type="text" autoComplete="off" value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} className="w-full bg-white dark:bg-[#111827] border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-[#C68346] rounded-none transition-colors" />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="block text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">RUN</label>
                        <input required type="text" autoComplete="off" value={formData.run} onChange={e => setFormData({ ...formData, run: e.target.value })} className="w-full bg-white dark:bg-[#111827] border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#C68346] rounded-none transition-colors" />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="block text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Email</label>
                        <input required type="email" autoComplete="off" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full bg-white dark:bg-[#111827] border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-[#C68346] rounded-none transition-colors" />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="block text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Rol Operativo</label>
                        <select required value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })} className="w-full bg-white dark:bg-[#111827] border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-[#C68346] rounded-none transition-colors appearance-none cursor-pointer">
                            <option value="OPERADOR">Operador</option>
                            <option value="TOPOGRAFO">Topógrafo</option>
                            <option value="SUPERVISOR">Supervisor</option>
                        </select>
                    </div>
                    <button type="submit" className="w-full lg:w-auto bg-[#C68346] hover:bg-[#b0743e] text-white font-bold uppercase tracking-wider text-xs py-3 px-8 transition-colors rounded-none">
                        Acreditar
                    </button>
                </form>
            </div>

            {/* Staff Grid & Plugin Manager */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Staff Table */}
                <div className="lg:col-span-2">
                    <h2 className="text-lg font-bold uppercase tracking-wider mb-6 border-b border-gray-200 dark:border-gray-800 pb-2">Gestión de Personal</h2>
                    <div className="border border-gray-200 dark:border-gray-800 rounded-none overflow-hidden">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50 dark:bg-[#1F2937] border-b border-gray-200 dark:border-gray-800 text-xs uppercase tracking-wider text-gray-500">
                                    <th className="py-3 px-4 font-normal">RUN</th>
                                    <th className="py-3 px-4 font-normal">Colaborador</th>
                                    <th className="py-3 px-4 font-normal">Rol</th>
                                    <th className="py-3 px-4 font-normal">Estado</th>
                                    <th className="py-3 px-4 font-normal text-right">Administrar</th>
                                </tr>
                            </thead>
                            <tbody>
                                {staff.map((user) => (
                                    <tr
                                        key={user.id}
                                        className={`border-b border-gray-100 dark:border-gray-800 transition-colors cursor-pointer ${selectedUserId === user.id ? 'bg-[#C68346]/10 dark:bg-[#C68346]/20' : 'hover:bg-gray-50 dark:hover:bg-[#1F2937]/50'}`}
                                        onClick={() => setSelectedUserId(user.id)}
                                    >
                                        <td className="py-3 px-4 font-mono text-sm">{user.run}</td>
                                        <td className="py-3 px-4">
                                            <p className="font-semibold text-sm">{user.lastName}, {user.name}</p>
                                            <p className="text-xs text-gray-500 font-mono">{user.email}</p>
                                        </td>
                                        <td className="py-3 px-4 text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                            {user.role}
                                        </td>
                                        <td className="py-3 px-4">
                                            <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 border ${user.status === 'ACTIVE' ? 'border-[#C68346] text-[#C68346]' : 'border-gray-300 text-gray-500'}`}>
                                                {user.status === 'ACTIVE' ? 'Activo' : 'Suspendido'}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-right space-x-4">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); toggleStatus(user.id); }}
                                                className={`text-xs uppercase font-bold transition-colors ${user.status === 'ACTIVE' ? 'text-gray-400 hover:text-[#C68346]' : 'text-green-600 hover:text-green-500'}`}
                                            >
                                                {user.status === 'ACTIVE' ? 'Suspender' : 'Reactivar'}
                                            </button>
                                            <button
                                                className="text-xs uppercase font-bold text-gray-400 hover:text-red-500 transition-colors"
                                                onClick={(e) => { e.stopPropagation(); setStaff(staff.filter(s => s.id !== user.id)); }}
                                            >
                                                Revocar
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Plugin Manager Sidebar */}
                <div className="lg:col-span-1">
                    {selectedUserId ? (
                        <StaffManager userId={selectedUserId} userName={staff.find(s => s.id === selectedUserId)?.lastName || ''} />
                    ) : (
                        <div className="border border-dashed border-gray-300 dark:border-gray-700 h-full min-h-[400px] flex flex-col items-center justify-center p-8 text-center bg-gray-50/50 dark:bg-[#1F2937]/50 rounded-none">
                            <span className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Permisos de Módulo</span>
                            <p className="text-sm text-gray-500">Seleccione un colaborador en la tabla de Gestión de Personal para configurar los plugins a los que tiene acceso en la mina.</p>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};
