import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { useTranslation } from 'react-i18next';
import { LogOut, LayoutDashboard, Building2, User } from 'lucide-react';
import { ThemeSwitch } from './Register'; // Re-using existing components
import { LanguageSwitch } from '../components/LanguageSwitch';

export const Dashboard = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const user = auth.currentUser;

    const handleLogout = async () => {
        await signOut(auth);
        navigate('/login');
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors">
            {/* Top Navigation */}
            <nav className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4">
                <div className="max-w-7xl mx-auto flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <div className="w-10 h-10 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
                            <LayoutDashboard size={24} />
                        </div>
                        <span className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">MINREPORT</span>
                    </div>

                    <div className="flex items-center gap-4">
                        <LanguageSwitch />
                        <ThemeSwitch />
                        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
                        <button
                            onClick={handleLogout}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all font-medium text-sm"
                        >
                            <LogOut size={18} />
                            {t('auth.logout', 'Cerrar Sesión')}
                        </button>
                    </div>
                </div>
            </nav>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto p-8">
                <header className="mb-10">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                        {t('dashboard.welcome', '¡Hola de nuevo!')}
                    </h1>
                    <p className="text-slate-500 mt-1">{user?.email}</p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white dark:bg-slate-800 p-8 rounded-[32px] border border-slate-100 dark:border-slate-700/50 shadow-sm transition-all hover:shadow-md">
                        <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 rounded-2xl flex items-center justify-center mb-6">
                            <Building2 size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Mi Ecosistema</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                            Gestione sus activos y configure los parámetros de su organización.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 p-8 rounded-[32px] border border-slate-100 dark:border-slate-700/50 shadow-sm transition-all hover:shadow-md">
                        <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 rounded-2xl flex items-center justify-center mb-6">
                            <User size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Perfil</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                            Actualice su información personal y preferencias de seguridad.
                        </p>
                    </div>
                </div>

                <div className="mt-12 p-12 bg-white dark:bg-slate-800 rounded-[40px] border border-dashed border-slate-200 dark:border-slate-700 text-center">
                    <p className="text-slate-400 italic">Aquí aparecerá tu panel de indicadores...</p>
                </div>
            </main>
        </div>
    );
};
