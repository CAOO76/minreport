
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { auth, db } from '../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { MobileAppTopBar } from '../components/mobile/MobileAppTopBar';

const MobileLayout: React.FC = () => {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();

    // Verificación de Autenticación
    useEffect(() => {
        const verifyAccess = async () => {
            const user = auth.currentUser;
            if (!user) {
                navigate('/mobile/login');
                return;
            }

            try {
                const userRef = doc(db, 'users', user.uid);
                const userSnap = await getDoc(userRef);

                if (!userSnap.exists()) {
                    console.warn('[MOBILE-LAYOUT] Perfil de usuario pendiente de sincronización.');
                }
            } catch (error) {
                console.error('[MOBILE-LAYOUT] Error al verificar sesión:', error);
            }
        };

        verifyAccess();
    }, [navigate]);

    const isActive = (path: string) => location.pathname.startsWith(path);

    return (
        <div className="fixed inset-0 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] select-none font-atkinson">
            <MobileAppTopBar homePath="/mobile/dashboard" showConnectivity={false} />

            {/* Área de Contenido */}
            <main className="flex-1 min-h-0 overflow-y-auto overscroll-none pb-[calc(env(safe-area-inset-bottom)+70px)]">
                <Outlet />
            </main>

            {/* Bottom Navigation Bar */}
            <nav
                aria-label={t('core_mobile.bottom_nav_aria', 'Navegación móvil')}
                className="fixed bottom-0 w-full pb-[env(safe-area-inset-bottom)] bg-white/95 dark:bg-[#07090D]/95 border-t border-[#E2E8F0] dark:border-[#12151C] z-50"
            >
                <div className="flex justify-around items-stretch min-h-[64px]">

                    {/* Inicio */}
                    <Link
                        to="/mobile/dashboard"
                        title={t('core_mobile.nav_home', 'Inicio')}
                        aria-label={t('core_mobile.nav_home', 'Inicio')}
                        className="flex items-center justify-center w-full min-h-[56px] py-1 relative cursor-pointer"
                    >
                        {isActive('/mobile/dashboard') && <div className="absolute top-0 w-10 h-[3px] bg-[#C68346]"></div>}
                        <span className={`material-symbols-outlined text-[24px] ${isActive('/mobile/dashboard') ? 'text-[#C68346]' : 'text-[#475569] dark:text-[#CBD5E1]'}`}>
                            home
                        </span>
                        <span className="sr-only">{t('core_mobile.nav_home', 'Inicio')}</span>
                    </Link>

                    {/* Herramientas (Módulos) */}
                    <Link
                        to="/mobile/tools"
                        title={t('core_mobile.nav_modules', 'Módulos')}
                        aria-label={t('core_mobile.nav_modules', 'Módulos')}
                        className="flex items-center justify-center w-full min-h-[56px] py-1 relative cursor-pointer"
                    >
                        {isActive('/mobile/tools') && <div className="absolute top-0 w-10 h-[3px] bg-[#C68346]"></div>}
                        <span className={`material-symbols-outlined text-[24px] ${isActive('/mobile/tools') ? 'text-[#C68346]' : 'text-[#475569] dark:text-[#CBD5E1]'}`}>
                            grid_view
                        </span>
                        <span className="sr-only">{t('core_mobile.nav_modules', 'Módulos')}</span>
                    </Link>

                    {/* Perfil */}
                    <Link
                        to="/mobile/profile"
                        title={t('core_mobile.nav_profile', 'Perfil')}
                        aria-label={t('core_mobile.nav_profile', 'Perfil')}
                        className="flex items-center justify-center w-full min-h-[56px] py-1 relative cursor-pointer"
                    >
                        {isActive('/mobile/profile') && <div className="absolute top-0 w-10 h-[3px] bg-[#C68346]"></div>}
                        <span className={`material-symbols-outlined text-[24px] ${isActive('/mobile/profile') ? 'text-[#C68346]' : 'text-[#475569] dark:text-[#CBD5E1]'}`}>
                            person
                        </span>
                        <span className="sr-only">{t('core_mobile.nav_profile', 'Perfil')}</span>
                    </Link>

                </div>
            </nav>
        </div>
    );
};

export default MobileLayout;
