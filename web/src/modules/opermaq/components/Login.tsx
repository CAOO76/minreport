import React, { useState } from 'react';
import { auth } from '../firebase/config';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { M3Button } from './M3Button';
import { M3TextField } from './M3TextField';
import { useBrandConfig } from '../hooks/useBrandConfig';
import { useTranslation } from 'react-i18next';

export const Login: React.FC = () => {
    const { brand } = useBrandConfig();
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);



    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (err: unknown) {
            console.error(err);
            const errorMessage = err instanceof Error ? err.message : t('login.error_auth');
            setError(errorMessage);
        } finally {
            setIsLoading(false);
        }
    };


    return (
        <div className="flex flex-col items-center justify-center h-screen w-screen bg-background p-6 font-atkinson overflow-hidden">
            <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-1000">
                <div className="text-center flex flex-col items-center">
                    {brand.imagotype || brand.logotype ? (
                        <img 
                          src={brand.imagotype || brand.logotype} 
                          alt="Brand Logo" 
                          draggable={false}
                          onContextMenu={(e) => e.preventDefault()}
                          className="h-20 mb-6 object-contain shadow-none animate-in fade-in zoom-in duration-700 select-none pointer-events-none" 
                        />
                    ) : (
                        <h1 className="text-4xl font-black tracking-tighter text-foreground uppercase">
                            OPER<span className="text-copper">MAQ</span>
                        </h1>
                    )}
                    <p className="mt-2 text-[10px] text-muted tracking-[0.4em] uppercase font-black">
                        {t('login.subtitle')}
                    </p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4 mt-12" autoComplete="off">
                    <M3TextField
                        label={t('login.email_placeholder')}
                        type="email"
                        value={email}
                        onChange={setEmail}
                        required
                    />
                    <M3TextField
                        label={t('login.password_placeholder')}
                        type="password"
                        value={password}
                        onChange={setPassword}
                        required
                    />

                    {error && (
                        <div className="p-4 bg-red-500/10 border-l-4 border-red-500 text-red-500 text-[10px] font-black uppercase tracking-widest animate-in shake duration-500">
                            {error}
                        </div>
                    )}

                    <div className="pt-4">
                        <M3Button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-7 text-sm tracking-[0.3em] font-black uppercase rounded-none"
                        >
                            {isLoading ? t('login.loading') : t('login.btn_login')}
                        </M3Button>
                    </div>

                </form>




                <div className="text-center mt-12 pt-8 border-t border-border-base">
                    <p className="text-[10px] text-muted tracking-[0.3em] uppercase font-bold leading-relaxed">
                        {t('login.footer_note')}
                    </p>
                </div>
            </div>
        </div>
    );
};
