import { Outlet, Link, useLocation } from 'react-router-dom';
import { Home, PlusSquare, Menu, Cloud, CloudOff } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import { useState, useEffect } from 'react';

export function MobileLayout() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const location = useLocation();

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    const isActive = (path: string) => location.pathname === path;

    return (
        <div className="flex flex-col min-h-screen bg-surface-light dark:bg-surface-dark">
            {/* Top Bar */}
            <header className="fixed top-0 w-full h-14 bg-surface-light/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-outline-light dark:border-outline-dark z-50 flex items-center justify-between px-4">
                <div className="w-8" /> {/* Spacer for centering logo */}
                <div className="flex items-center justify-center">
                    <BrandLogo className="h-6" />
                </div>
                <div className="flex items-center">
                    {isOnline ? (
                        <Cloud className="w-5 h-5 text-success" />
                    ) : (
                        <CloudOff className="w-5 h-5 text-error" />
                    )}
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 mt-14 pb-20 overflow-y-auto">
                <div className="p-4">
                    <Outlet />
                </div>
            </main>

            {/* Bottom Navigation */}
            <nav className="fixed bottom-0 w-full h-16 bg-surface-light dark:bg-surface-dark border-t border-outline-light dark:border-outline-dark flex items-center justify-around px-2 z-50">
                <Link
                    to="/dashboard"
                    className={`flex flex-col items-center justify-center space-y-1 w-full h-full transition-colors ${isActive('/dashboard') ? 'text-primary' : 'text-secondary opacity-60'
                        }`}
                >
                    <Home className="w-6 h-6" />
                    <span className="text-[10px] font-medium">Inicio</span>
                </Link>

                <Link
                    to="/capture"
                    className={`flex flex-col items-center justify-center space-y-1 w-full h-full transition-colors ${isActive('/capture') ? 'text-primary' : 'text-secondary opacity-60'
                        }`}
                >
                    <div className="bg-primary/10 p-2 rounded-xl">
                        <PlusSquare className="w-6 h-6 text-primary" />
                    </div>
                </Link>

                <Link
                    to="/menu"
                    className={`flex flex-col items-center justify-center space-y-1 w-full h-full transition-colors ${isActive('/menu') ? 'text-primary' : 'text-secondary opacity-60'
                        }`}
                >
                    <Menu className="w-6 h-6" />
                    <span className="text-[10px] font-medium">Menú</span>
                </Link>
            </nav>
        </div>
    );
}

export default MobileLayout;
