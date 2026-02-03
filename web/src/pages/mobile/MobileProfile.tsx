
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { LogOut, ShieldCheck, Mail, Building2, UserCircle } from 'lucide-react';

const MobileProfile: React.FC = () => {
    const navigate = useNavigate();
    const { user, profile, currentAccount } = useAuth();

    const handleLogout = async () => {
        try {
            await signOut(auth);
            navigate('/mobile/login');
        } catch (error) {
            console.error("Error al cerrar sesión:", error);
        }
    };

    // Determinar etiqueta de rol para mostrar
    const getRoleLabel = () => {
        const type = currentAccount?.type;
        if (type === 'EDUCATIONAL') return 'Estudiante / Académico';
        if (type === 'PERSONAL') return 'Profesional Independiente';
        if (type === 'ENTERPRISE') return profile?.memberships?.[0]?.role || 'Operador';
        return 'Usuario';
    };

    return (
        <div className="space-y-8 px-1 pt-4">

            {/* Avatar Section */}
            <div className="flex flex-col items-center text-center">
                <div className="w-24 h-24 rounded-full bg-gray-200 dark:bg-zinc-800 flex items-center justify-center mb-4 border-4 border-white dark:border-black shadow-lg">
                    {user?.photoURL ? (
                        <img src={user.photoURL} alt="Profile" className="w-full h-full rounded-full object-cover" />
                    ) : (
                        <UserCircle size={64} className="text-gray-400 dark:text-gray-500" />
                    )}
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {user?.displayName || 'Usuario'}
                </h1>
                <div className="flex items-center gap-2 mt-2 px-3 py-1 bg-indigo-50 dark:bg-indigo-900/30 rounded-full">
                    <ShieldCheck size={14} className="text-indigo-600 dark:text-indigo-400" />
                    <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">
                        {getRoleLabel()}
                    </span>
                </div>
            </div>

            {/* Info Cards (Read Only) */}
            <div className="space-y-4">
                <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 flex items-center gap-4">
                    <div className="p-3 bg-gray-50 dark:bg-zinc-800 rounded-xl">
                        <Mail size={20} className="text-gray-500 dark:text-gray-400" />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 dark:text-gray-500 uppercase font-bold">Correo Electrónico</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{user?.email}</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 flex items-center gap-4">
                    <div className="p-3 bg-gray-50 dark:bg-zinc-800 rounded-xl">
                        <Building2 size={20} className="text-gray-500 dark:text-gray-400" />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 dark:text-gray-500 uppercase font-bold">Organización</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{currentAccount?.name || 'N/A'}</p>
                    </div>
                </div>
            </div>

            {/* Danger Zone */}
            <div className="pt-8 pb-8">
                <button
                    onClick={handleLogout}
                    className="w-full py-4 rounded-2xl border-2 border-red-100 dark:border-red-900/30 text-red-600 dark:text-red-500 font-bold text-lg hover:bg-red-50 dark:hover:bg-red-900/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                    <LogOut size={20} />
                    Cerrar Sesión
                </button>
                <p className="text-center text-xs text-gray-400 mt-4">
                    MinReport Mobile v1.0.0 (Build 240)
                </p>
            </div>
        </div>
    );
};

export default MobileProfile;
