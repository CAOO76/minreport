import { useState } from 'react';
import { adminLogin } from '../services/api';
import { ShieldAlert, LogIn, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { LanguageSwitch } from '../components/LanguageSwitch';

export const Login = () => {
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const { data } = await adminLogin(email, password);
            localStorage.setItem('admin_token', data.token);
            localStorage.setItem('admin_user', JSON.stringify(data.user));
            navigate('/');
        } catch (err: any) {
            setError(err.response?.data?.error || t('admin.invalid_credentials', 'Credenciales inválidas'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-antigravity-light-bg dark:bg-antigravity-dark-bg transition-colors relative overflow-hidden">
            <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                <LanguageSwitch />
                <ThemeSwitch />
            </div>

            {/* Background Decorative Element */}
            <div className="absolute -top-24 -right-24 w-96 h-96 bg-antigravity-accent/5 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-antigravity-accent/5 rounded-full blur-3xl" />

            <div className="w-full max-w-[400px] relative">
                <div className="mb-12 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white dark:bg-white/5 shadow-xl shadow-antigravity-accent/10 border border-slate-100 dark:border-white/10 text-antigravity-accent mb-6 transition-transform hover:scale-105 duration-300">
                        <ShieldAlert size={32} />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{t('admin.title')}</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-2 font-medium">{t('admin.restricted')}</p>
                </div>

                <div className="bg-white dark:bg-white/5 backdrop-blur-xl border border-slate-200 dark:border-white/10 p-8 rounded-3xl shadow-2xl shadow-black/5 dark:shadow-none">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-1.5">
                            <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">{t('admin.table.email')}</label>
                            <div className="relative group">
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="admin@minreport.com"
                                    required
                                    className="w-full pl-4 pr-4 py-3.5 rounded-2xl bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/5 focus:ring-2 focus:ring-antigravity-accent/20 focus:border-antigravity-accent outline-none text-slate-900 dark:text-white transition-all placeholder:text-slate-400"
                                    autoComplete="off"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">{t('admin.master_pass')}</label>
                            <div className="relative group">
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    className="w-full pl-4 pr-11 py-3.5 rounded-2xl bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/5 focus:ring-2 focus:ring-antigravity-accent/20 focus:border-antigravity-accent outline-none text-slate-900 dark:text-white transition-all placeholder:text-slate-400"
                                    autoComplete="off"
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                                    <Lock size={18} />
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-3 border border-rose-100 dark:border-rose-500/20 animate-in fade-in slide-in-from-top-2">
                                <span className="material-symbols-rounded text-lg">error</span>
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-4 px-6 rounded-2xl bg-antigravity-accent hover:bg-antigravity-accent/90 text-white font-bold transition-all flex items-center justify-center gap-3 shadow-xl shadow-antigravity-accent/20 hover:shadow-antigravity-accent/30 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
                        >
                            {loading ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <LogIn size={20} />
                                    {t('admin.login_btn')}
                                </>
                            )}
                        </button>
                    </form>
                </div>

                <footer className="mt-12 text-center space-y-2">
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] font-bold">
                        {t('admin.secure_layer')}
                    </p>
                    <div className="flex justify-center gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[9px] text-slate-400 uppercase tracking-widest">{t('admin.active_systems')}</span>
                    </div>
                </footer>
            </div>
        </div>
    );
};
