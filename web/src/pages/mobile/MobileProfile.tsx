import React from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

const MobileProfile: React.FC = () => {
    const navigate = useNavigate();
    const { user, profile, currentAccount } = useAuth();
    const { theme, toggleTheme } = useTheme();

    const handleLogout = async () => {
        try {
            await signOut(auth);
            navigate('/mobile/login');
        } catch (error) {
            console.error("Error al cerrar sesión:", error);
        }
    };

    const getRoleLabel = () => {
        const type = currentAccount?.type;
        if (type === 'EDUCATIONAL') return 'Estudiante / Académico';
        if (type === 'PERSONAL') return 'Profesional Independiente';
        if (type === 'ENTERPRISE') return profile?.memberships?.[0]?.role || 'Operador';
        return 'Usuario';
    };

    return (
        <div className="space-y-6 px-1 pt-4">

            {/* Avatar Section */}
            <div className="flex flex-col items-center text-center relative pt-2 pb-4 border-b border-slate-200 dark:border-[#12151C]">
                {/* Theme Toggle Button - Absolute Top Right */}
                <button
                    onClick={toggleTheme}
                    className="absolute right-0 top-0 bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center rounded-none"
                    aria-label="Toggle Theme"
                    title={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
                >
                    <span className="material-symbols-outlined text-[20px]">
                        {theme === 'light' ? 'dark_mode' : 'light_mode'}
                    </span>
                </button>

                <div className="w-20 h-20 rounded-none bg-[#C68346]/10 flex items-center justify-center mb-3 border border-[#C68346]/30 shadow-none">
                    {user?.photoURL ? (
                        <img src={user.photoURL} alt="Profile" className="w-full h-full rounded-none object-cover" />
                    ) : (
                        <span className="material-symbols-outlined text-[40px] text-[#C68346]">person</span>
                    )}
                </div>
                <h1 className="text-lg font-bold uppercase tracking-tight text-slate-900 dark:text-[#F3F4F6]">
                    {user?.displayName || 'Usuario'}
                </h1>
                <div className="flex items-center gap-1.5 mt-2 px-2.5 py-1 bg-[#C68346]/10 border border-[#C68346]/20 rounded-none">
                    <span className="material-symbols-outlined text-[#C68346] text-[14px]">verified_user</span>
                    <span className="text-[10px] font-bold text-[#C68346] uppercase tracking-wider font-mono">
                        {getRoleLabel()}
                    </span>
                </div>
            </div>

            {/* Info Cards (Read Only) */}
            <div className="space-y-3">
                <div className="bg-[#F8FAFC] dark:bg-[#07090D] p-3.5 rounded-none shadow-none border border-slate-200 dark:border-[#12151C] flex items-center gap-3">
                    <div className="p-2 bg-white dark:bg-[#030406] border border-slate-200 dark:border-[#12151C] rounded-none">
                        <span className="material-symbols-outlined text-slate-500 dark:text-[#8A93A6] text-[18px]">mail</span>
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-slate-500 dark:text-[#8A93A6] uppercase font-bold tracking-wider font-mono">Correo Electrónico</p>
                        <p className="text-xs font-mono text-slate-900 dark:text-[#F3F4F6] truncate mt-0.5">{user?.email}</p>
                    </div>
                </div>

                <div className="bg-[#F8FAFC] dark:bg-[#07090D] p-3.5 rounded-none shadow-none border border-slate-200 dark:border-[#12151C] flex items-center gap-3">
                    <div className="p-2 bg-white dark:bg-[#030406] border border-slate-200 dark:border-[#12151C] rounded-none">
                        <span className="material-symbols-outlined text-slate-500 dark:text-[#8A93A6] text-[18px]">corporate_fare</span>
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-slate-500 dark:text-[#8A93A6] uppercase font-bold tracking-wider font-mono">Organización</p>
                        <p className="text-xs font-mono text-slate-900 dark:text-[#F3F4F6] truncate mt-0.5">{currentAccount?.name || 'N/A'}</p>
                    </div>
                </div>
            </div>

            {/* Danger Zone */}
            <div className="pt-4 pb-8 space-y-3">
                <button
                    onClick={handleLogout}
                    className="w-full py-3 rounded-none border border-rose-500/30 text-rose-500 font-bold text-xs uppercase tracking-wider hover:bg-rose-500/10 active:scale-[0.99] transition-colors flex items-center justify-center gap-2 cursor-pointer bg-transparent"
                >
                    <span className="material-symbols-outlined text-[16px]">logout</span>
                    Cerrar Sesión
                </button>
                <p className="text-center text-[10px] text-slate-400 dark:text-[#5A6072] font-mono">
                    MINREPORT Mobile v1.0.0
                </p>
            </div>
        </div>
    );
};

export default MobileProfile;
