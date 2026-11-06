import React from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import SecureImage from '../../components/common/SecureImage';
import CopyButton from '../../components/common/CopyButton';

const MISSING_FIELD = '[Información técnica no declarada en ficha]';

const MobileProfile: React.FC = () => {
    const navigate = useNavigate();
    const { user, profile, currentAccount } = useAuth();
    const { theme, toggleTheme } = useTheme();

    const handleLogout = async () => {
        try {
            await signOut(auth);
            navigate('/mobile/login');
        } catch (error) {
            console.error("Error al cerrar sesion:", error);
        }
    };

    const getRoleLabel = () => {
        const type = currentAccount?.type;
        if (type === 'EDUCATIONAL') return 'ESTUDIANTE / ACADEMICO (EDU)';
        const membership = profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id);
        return membership?.role || 'OPERADOR';
    };

    return (
        <div className="space-y-fib-21 px-fib-8 pt-fib-13 font-sans select-none">
            <div className="flex flex-col items-center text-center relative pt-2 pb-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C]">
                <button
                    type="button"
                    onClick={toggleTheme}
                    className="absolute right-0 top-0 bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center rounded-none"
                    aria-label="Cambiar tema"
                    title={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
                >
                    <span className="material-symbols-outlined text-[20px]">
                        {theme === 'light' ? 'dark_mode' : 'light_mode'}
                    </span>
                </button>

                <div className="w-20 h-20 rounded-none bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-center mb-fib-13 border border-[#E2E8F0] dark:border-[#12151C] shadow-none overflow-hidden">
                    {user?.photoURL ? (
                        <SecureImage src={user.photoURL} alt="Perfil" className="w-full h-full object-cover" />
                    ) : (
                        <span className="material-symbols-outlined text-[36px] text-[#C68346]">person</span>
                    )}
                </div>

                <h1 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                    {user?.displayName || MISSING_FIELD}
                </h1>

                <div className="flex items-center gap-fib-8 mt-2">
                    <span className="material-symbols-outlined text-[#00AEEF] text-[16px]">verified_user</span>
                    <span className="text-microcopy text-[#C68346] uppercase font-mono">
                        {getRoleLabel()}
                    </span>
                </div>
            </div>

            <div className="space-y-fib-13">
                <div className="bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none border border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-13">
                    <span className="material-symbols-outlined text-[#475569] dark:text-[#8A93A6] text-[20px]">mail</span>
                    <div className="min-w-0 flex-1">
                        <p className="text-microcopy text-[#475569] dark:text-[#8A93A6] uppercase font-mono">Correo Electronico</p>
                        {user?.email ? (
                            <div className="inline-flex items-center gap-1 mt-0.5 select-text">
                                <p className="text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] truncate">{user.email}</p>
                                <CopyButton value={user.email} title="Copiar correo" />
                            </div>
                        ) : (
                            <p className="text-xs font-mono text-[#94A3B8] dark:text-[#5A6072] mt-0.5">{MISSING_FIELD}</p>
                        )}
                    </div>
                </div>

                <div className="bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none border border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-13">
                    <span className="material-symbols-outlined text-[#475569] dark:text-[#8A93A6] text-[20px]">corporate_fare</span>
                    <div className="min-w-0 flex-1">
                        <p className="text-microcopy text-[#475569] dark:text-[#8A93A6] uppercase font-mono">Organizacion</p>
                        <p className="text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] truncate mt-0.5">
                            {currentAccount?.name || MISSING_FIELD}
                        </p>
                    </div>
                </div>
            </div>

            <div className="pt-fib-13 pb-fib-34">
                <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full py-3 rounded-none border border-red-500/30 text-red-600 dark:text-red-400 font-mono font-bold text-xs uppercase tracking-wider hover:bg-red-500/10 transition-colors flex items-center justify-center gap-fib-8 cursor-pointer bg-transparent"
                >
                    <span className="material-symbols-outlined text-[16px]">logout</span>
                    <span>Cerrar Sesion</span>
                </button>
            </div>
        </div>
    );
};

export default MobileProfile;
