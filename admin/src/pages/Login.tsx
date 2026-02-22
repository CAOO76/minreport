import { useState, useEffect } from 'react';
import { adminLogin, getUIAssetsSettings } from '../services/api';
import { LogIn, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { BrandLogo } from '../components/BrandLogo';

export const Login = () => {
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [bgImage, setBgImage] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const fetchUI = async () => {
            try {
                const { data } = await getUIAssetsSettings();
                if (data.login_bg) setBgImage(data.login_bg);
            } catch (err) {
                console.warn('Could not fetch premium backgrounds, using fallback.');
            }
        };
        fetchUI();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const { data } = await adminLogin(email, password);
            localStorage.setItem('admin_token', data.token);
            localStorage.setItem('admin_user', JSON.stringify(data.user));

            if (data.firebaseToken) {
                const { auth } = await import('../config/firebase');
                const { signInWithCustomToken } = await import('firebase/auth');
                await signInWithCustomToken(auth, data.firebaseToken);
            }

            navigate('/');
        } catch (err: any) {
            setError(err.response?.data?.error || t('admin.invalid_credentials', 'Credenciales inválidas'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-6 transition-colors relative overflow-hidden industrial-mineral-gradient">
            {/* Background Layer with industrial texture */}
            {bgImage && (
                <div className="absolute inset-0 z-0">
                    <img src={bgImage} alt="industrial atmosphere" className="w-full h-full object-cover brightness-[0.4] dark:brightness-[0.3]" />
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"></div>
                </div>
            )}

            <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                <LanguageSwitch />
                <ThemeSwitch />
            </div>

            <div className="w-full max-w-[400px] relative z-10 text-black dark:text-white transition-all duration-700">
                {/* Logo Flotante perfectamente alineado */}
                <div className="mb-6 px-10 flex justify-center">
                    <BrandLogo variant="isotype" className="w-1/4 h-auto relative z-10" />
                </div>

                <div className="flex items-center justify-center gap-4 mb-6 animate-in fade-in slide-in-from-top-4 duration-1000 delay-200">
                    <div className="h-[1px] w-8" style={{ backgroundColor: 'rgb(198, 131, 70)' }}></div>
                    <p className="hud-label" style={{ color: 'rgb(198, 131, 70)' }}>MINREPORT®</p>
                    <div className="h-[1px] w-8" style={{ backgroundColor: 'rgb(198, 131, 70)' }}></div>
                </div>

                <div className="elite-tech-surface py-12 px-10 shadow-3xl animate-in fade-in zoom-in-95 duration-700 delay-100 relative rounded-none overflow-hidden border-white/10">
                    {/* Interior Grid Layer */}
                    <div className="absolute inset-0 technical-grid opacity-20 pointer-events-none"></div>
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <ShieldCheck size={40} className="text-antigravity-accent" />
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-10 relative z-10" autoComplete="off">
                        <div className="space-y-3">
                            <div className="flex justify-between items-end px-1">
                                <span className="material-symbols-rounded text-black/40 dark:text-white/40 mb-1">alternate_email</span>
                                <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[01]</span>
                            </div>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder=""
                                required
                                className="premium-input bg-black/80"
                                autoComplete="off"
                                spellCheck="false"
                                data-lpignore="true"
                                data-form-type="other"
                            />
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between items-end px-1">
                                <span className="material-symbols-rounded text-black/40 dark:text-white/40 mb-1">key</span>
                                <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[02]</span>
                            </div>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder=""
                                    required
                                    className="premium-input pr-14 bg-black/80"
                                    autoComplete="new-password"
                                    spellCheck="false"
                                    data-lpignore="true"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-5 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white transition-colors"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="p-4 rounded-none bg-rose-500/10 text-rose-400 text-[10px] font-mono font-bold flex items-center gap-3 border border-rose-500/30 animate-in fade-in slide-in-from-bottom-2">
                                <span className="material-symbols-rounded text-base">error</span>
                                <span className="uppercase tracking-tight">{error}</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-6 px-8 rounded-none bg-black dark:bg-white text-white dark:text-black font-black uppercase tracking-[0.3em] text-[12px] transition-all flex items-center justify-center shadow-3xl active:scale-[0.98] disabled:opacity-30"
                        >
                            {loading ? (
                                <div className="w-6 h-6 border-2 border-black/20 dark:border-white/20 border-t-black dark:border-t-white rounded-full animate-spin" />
                            ) : (
                                <LogIn size={27} />
                            )}
                        </button>
                    </form>
                </div>

                <footer className="mt-8 text-center space-y-4 opacity-40 hover:opacity-100 transition-opacity duration-500">
                    <div className="flex justify-center">
                        <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <p className="text-[10px] text-black/60 dark:text-white uppercase tracking-[0.3em] font-black">
                        © {new Date().getFullYear()} MINREPORT. TODOS LOS DERECHOS RESERVADOS.
                    </p>
                </footer>
            </div>
        </div>
    );
};
