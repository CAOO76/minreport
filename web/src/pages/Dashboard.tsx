import { useTranslation } from 'react-i18next';
import { Building2, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { auth } from '../config/firebase';

export const Dashboard = () => {
    const { t } = useTranslation();
    const user = auth.currentUser;
    const [userType, setUserType] = useState<string | null>(null);

    useEffect(() => {
        const fetchUserType = async () => {
            if (user) {
                try {
                    const idTokenResult = await user.getIdTokenResult();
                    if (idTokenResult.claims.type) {
                        setUserType(idTokenResult.claims.type as string);
                    }
                } catch (error) {
                    console.error("Error fetching user's custom claims:", error);
                }
            }
        };
        fetchUserType();
    }, [user]);

    return (
        <div className="max-w-7xl mx-auto">
            {/* Main Content Header */}
            <header className="mb-10">
                <div className="flex items-center gap-3">
                    <span className="material-symbols-rounded text-4xl text-antigravity-accent transition-colors">
                        {userType === 'ENTERPRISE' ? 'domain' : userType === 'EDUCATIONAL' ? 'school' : 'person'}
                    </span>
                    <h1 className="text-3xl font-bold text-antigravity-light-text dark:text-antigravity-dark-text tracking-tight transition-colors">
                        {t('dashboard.welcome', '¡Hola de nuevo!')}
                    </h1>
                </div>
                <p className="text-antigravity-light-muted dark:text-antigravity-dark-muted mt-1 font-medium transition-colors">{user?.email}</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-antigravity-light-surface dark:bg-antigravity-dark-surface p-8 rounded-[32px] border border-antigravity-light-border dark:border-antigravity-dark-border shadow-sm transition-all hover:shadow-md group">
                    <div className="w-12 h-12 bg-antigravity-accent/10 text-antigravity-accent rounded-2xl flex items-center justify-center mb-6 group-hover:bg-antigravity-accent group-hover:text-white transition-all">
                        <Building2 size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-antigravity-light-text dark:text-antigravity-dark-text mb-2">Mi Ecosistema</h3>
                    <p className="text-sm text-antigravity-light-muted dark:text-antigravity-dark-muted leading-relaxed">
                        Gestione sus activos y configure los parámetros de su organización.
                    </p>
                </div>

                <div className="bg-antigravity-light-surface dark:bg-antigravity-dark-surface p-8 rounded-[32px] border border-antigravity-light-border dark:border-antigravity-dark-border shadow-sm transition-all hover:shadow-md group">
                    <div className="w-12 h-12 bg-antigravity-accent/10 text-antigravity-accent rounded-2xl flex items-center justify-center mb-6 group-hover:bg-antigravity-accent group-hover:text-white transition-all">
                        <User size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-antigravity-light-text dark:text-antigravity-dark-text mb-2">Perfil</h3>
                    <p className="text-sm text-antigravity-light-muted dark:text-antigravity-dark-muted leading-relaxed">
                        Actualice su información personal y preferencias de seguridad.
                    </p>
                </div>
            </div>

            <div className="mt-12 p-12 bg-antigravity-light-surface/50 dark:bg-antigravity-dark-surface/50 rounded-[40px] border border-dashed border-antigravity-light-border dark:border-antigravity-dark-border text-center">
                <p className="text-antigravity-light-muted dark:text-antigravity-dark-muted italic">Aquí aparecerá tu panel de indicadores...</p>
            </div>
        </div>
    );
};
