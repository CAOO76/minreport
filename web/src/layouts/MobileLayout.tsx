
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

                            // BLOCK: Enterprise Owner
                            if (accountData.type === 'ENTERPRISE' && role === 'OWNER') {
                                console.warn("Security Alert: Enterprise Owner detected in mobile layout. Expelling.");
                                await signOut(auth);
                                navigate('/mobile/login'); // Redirect to login which will show restricted message if they try again
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
            size={24}
            className={active ? "text-indigo-600 dark:text-indigo-400" : "text-gray-400 dark:text-gray-500"}
            fill={active ? "currentColor" : "none"}
            strokeWidth={active ? 2.5 : 2}
        />
    );

    return (
        <div className="fixed inset-0 flex flex-col bg-gray-50 dark:bg-black select-none">

            {/* Área de Contenido */}
            <main className="flex-1 overflow-y-auto overscroll-none pb-[calc(env(safe-area-inset-bottom)+70px)]">
                <Outlet />
            </main>

            {/* Bottom Navigation Bar */}
            <nav className="fixed bottom-0 w-full pb-[env(safe-area-inset-bottom)] backdrop-blur-xl bg-white/90 dark:bg-zinc-900/90 border-t border-gray-200 dark:border-zinc-800 z-50">
                <div className="flex justify-around items-center h-16">

                    {/* Inicio */}
                    <Link to="/mobile/dashboard" className="flex flex-col items-center justify-center w-full h-full">
                        <NavIcon icon={Home} active={isActive('/mobile/dashboard')} />
                        <span className={`text-[10px] mt-1 font-medium ${isActive('/mobile/dashboard') ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400'}`}>
                            Inicio
                        </span>
                    </Link>

                    {/* Herramientas (Plugins) */}
                    <Link to="/mobile/tools" className="flex flex-col items-center justify-center w-full h-full">
                        <NavIcon icon={LayoutGrid} active={isActive('/mobile/tools')} />
                        <span className={`text-[10px] mt-1 font-medium ${isActive('/mobile/tools') ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400'}`}>
                            Herramientas
                        </span>
                    </Link>

                    {/* Perfil */}
                    <Link to="/mobile/profile" className="flex flex-col items-center justify-center w-full h-full">
                        <NavIcon icon={User} active={isActive('/mobile/profile')} />
                        <span className={`text-[10px] mt-1 font-medium ${isActive('/mobile/profile') ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400'}`}>
                            Perfil
                        </span>
                    </Link>

                </div>
            </nav>
        </div>
    );
};

export default MobileLayout;
