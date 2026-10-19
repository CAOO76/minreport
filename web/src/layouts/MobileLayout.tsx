
import React, { useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { auth, db } from '../config/firebase';
import { doc, getDoc } from 'firebase/firestore';

const MobileLayout: React.FC = () => {
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
        <div className="fixed inset-0 flex flex-col bg-white dark:bg-[#030406] text-[#0F172A] dark:text-[#F3F4F6] select-none font-sans">
            {/* Área de Contenido */}
            <main className="flex-1 overflow-y-auto overscroll-none pb-[calc(env(safe-area-inset-bottom)+70px)]">
                <Outlet />
            </main>

            {/* Bottom Navigation Bar */}
            <nav className="fixed bottom-0 w-full pb-[env(safe-area-inset-bottom)] bg-white/95 dark:bg-[#07090D]/95 border-t border-[#E2E8F0] dark:border-[#12151C] z-50">
                <div className="flex justify-around items-center h-16">

                    {/* Inicio */}
                    <Link to="/mobile/dashboard" className="flex flex-col items-center justify-center w-full h-full relative cursor-pointer">
                        {isActive('/mobile/dashboard') && <div className="absolute top-0 w-8 h-[2px] bg-[#C68346]"></div>}
                        <span className={`material-symbols-outlined text-[22px] ${isActive('/mobile/dashboard') ? 'text-[#C68346]' : 'text-neutral-400 dark:text-neutral-500'}`}>
                            home
                        </span>
                        <span className={`text-[10px] font-mono mt-1 ${isActive('/mobile/dashboard') ? 'text-[#C68346] font-bold' : 'text-neutral-400 dark:text-neutral-500'}`}>
                            Inicio
                        </span>
                    </Link>

                    {/* Herramientas (Módulos) */}
                    <Link to="/mobile/tools" className="flex flex-col items-center justify-center w-full h-full relative cursor-pointer">
                        {isActive('/mobile/tools') && <div className="absolute top-0 w-8 h-[2px] bg-[#C68346]"></div>}
                        <span className={`material-symbols-outlined text-[22px] ${isActive('/mobile/tools') ? 'text-[#C68346]' : 'text-neutral-400 dark:text-neutral-500'}`}>
                            grid_view
                        </span>
                        <span className={`text-[10px] font-mono mt-1 ${isActive('/mobile/tools') ? 'text-[#C68346] font-bold' : 'text-neutral-400 dark:text-neutral-500'}`}>
                            Módulos
                        </span>
                    </Link>

                    {/* Perfil */}
                    <Link to="/mobile/profile" className="flex flex-col items-center justify-center w-full h-full relative cursor-pointer">
                        {isActive('/mobile/profile') && <div className="absolute top-0 w-8 h-[2px] bg-[#C68346]"></div>}
                        <span className={`material-symbols-outlined text-[22px] ${isActive('/mobile/profile') ? 'text-[#C68346]' : 'text-neutral-400 dark:text-neutral-500'}`}>
                            person
                        </span>
                        <span className={`text-[10px] font-mono mt-1 ${isActive('/mobile/profile') ? 'text-[#C68346] font-bold' : 'text-neutral-400 dark:text-neutral-500'}`}>
                            Perfil
                        </span>
                    </Link>

                </div>
            </nav>
        </div>
    );
};

export default MobileLayout;
