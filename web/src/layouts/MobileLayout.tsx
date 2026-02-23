
import React, { useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, LayoutGrid, User } from 'lucide-react';
import { auth, db } from '../config/firebase';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

const MobileLayout: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();

    // Guardian de Seguridad (Doble Check)
    useEffect(() => {
        const verifyAccess = async () => {
            const user = auth.currentUser;
            if (!user) {
                navigate('/mobile/login');
                return;
            }

            try {
                // Fetch User Profile
                const userRef = doc(db, 'users', user.uid);
                const userSnap = await getDoc(userRef);

                if (userSnap.exists()) {
                    const userData = userSnap.data();
                    const targetAccountId = userData.lastActiveAccountId || (userData.memberships?.[0]?.accountId);

                    if (targetAccountId) {
                        const accountRef = doc(db, 'accounts', targetAccountId);
                        const accountSnap = await getDoc(accountRef);

                        if (accountSnap.exists()) {
                            const accountData = accountSnap.data();
                            const membership = userData.memberships?.find((m: any) => m.accountId === targetAccountId);
                            const role = membership?.role || 'MEMBER';

                            // BLOCK: Enterprise Owner (Permitir en desarrollo local para E2E)
                            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                            if (accountData.type === 'ENTERPRISE' && role === 'OWNER' && !isLocal) {
                                console.warn("Security Alert: Enterprise Owner detected in mobile layout. Expelling.");
                                await signOut(auth);
                                navigate('/mobile/login');
                            }
                        }
                    }
                }
            } catch (error) {
                console.error("Security Check Failed:", error);
                // Fail safe: stay or logout? For now, stay, but log it.
            }
        };

        verifyAccess();
    }, [navigate]);

    const isActive = (path: string) => location.pathname.startsWith(path);

    // Helper for Icons (Solid if active)
    const NavIcon = ({ icon: Icon, active }: { icon: any, active: boolean }) => (
        <Icon
            size={22}
            className={active ? "text-antigravity-accent" : "text-black/30 dark:text-white/20"}
            strokeWidth={active ? 2.5 : 2}
        />
    );

    return (
        <div className="fixed inset-0 flex flex-col industrial-mineral-gradient dark:bg-black select-none">
            <div className="absolute inset-0 technical-grid pointer-events-none opacity-5"></div>

            {/* Área de Contenido */}
            <main className="flex-1 overflow-y-auto overscroll-none pb-[calc(env(safe-area-inset-bottom)+70px)]">
                <Outlet />
            </main>

            {/* Bottom Navigation Bar */}
            <nav className="fixed bottom-0 w-full pb-[env(safe-area-inset-bottom)] bg-white/95 dark:bg-[#0D0D0D]/95 border-t border-black/5 dark:border-white/5 z-50">
                <div className="flex justify-around items-center h-16">

                    {/* Inicio */}
                    <Link to="/mobile/dashboard" className="flex flex-col items-center justify-center w-full h-full relative">
                        {isActive('/mobile/dashboard') && <div className="absolute top-0 w-8 h-[2px] bg-antigravity-accent"></div>}
                        <NavIcon icon={Home} active={isActive('/mobile/dashboard')} />
                        <span className={`hud-label text-[8px] mt-1.5 ${isActive('/mobile/dashboard') ? 'text-antigravity-accent' : 'text-black/30 dark:text-white/20'}`}>
                            CORE_HUD
                        </span>
                    </Link>

                    {/* Herramientas (Plugins) */}
                    <Link to="/mobile/tools" className="flex flex-col items-center justify-center w-full h-full relative">
                        {isActive('/mobile/tools') && <div className="absolute top-0 w-8 h-[2px] bg-antigravity-accent"></div>}
                        <NavIcon icon={LayoutGrid} active={isActive('/mobile/tools')} />
                        <span className={`hud-label text-[8px] mt-1.5 ${isActive('/mobile/tools') ? 'text-antigravity-accent' : 'text-black/30 dark:text-white/20'}`}>
                            TOOLS_OS
                        </span>
                    </Link>

                    {/* Perfil */}
                    <Link to="/mobile/profile" className="flex flex-col items-center justify-center w-full h-full relative">
                        {isActive('/mobile/profile') && <div className="absolute top-0 w-8 h-[2px] bg-antigravity-accent"></div>}
                        <NavIcon icon={User} active={isActive('/mobile/profile')} />
                        <span className={`hud-label text-[8px] mt-1.5 ${isActive('/mobile/profile') ? 'text-antigravity-accent' : 'text-black/30 dark:text-white/20'}`}>
                            USER_ID
                        </span>
                    </Link>

                </div>
            </nav>
        </div>
    );
};

export default MobileLayout;
