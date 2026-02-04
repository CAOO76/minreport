
import React from 'react';
import { Loader2 } from 'lucide-react';

const LoadingScreen: React.FC = () => {
    const [showSlowMessage, setShowSlowMessage] = React.useState(false);
    const [showSkip, setShowSkip] = React.useState(false);

    React.useEffect(() => {
        const slowTimer = setTimeout(() => setShowSlowMessage(true), 6000);
        const skipTimer = setTimeout(() => setShowSkip(true), 15000);
        return () => {
            clearTimeout(slowTimer);
            clearTimeout(skipTimer);
        };
    }, []);

    const handleSkip = () => {
        // Force reload to login
        window.location.href = '/mobile/login';
    };

    return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-white dark:bg-black p-8 text-center select-none">
            <div className="relative mb-8">
                <div className="w-16 h-16 border-4 border-indigo-100 dark:border-indigo-900/40 rounded-full animate-pulse"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-indigo-600 dark:text-indigo-400 animate-spin" />
                </div>
            </div>

            <p className="text-sm font-bold text-gray-900 dark:text-white tracking-widest uppercase mb-2">
                MinReport
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">
                Iniciando sistema seguro...
            </p>

            {showSlowMessage && !showSkip && (
                <div className="mt-12 p-4 rounded-2xl bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20 max-w-xs animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <p className="text-[11px] text-amber-800 dark:text-amber-400 font-medium leading-relaxed">
                        ¿Demasiado tiempo? <br />
                        Verifica que tu celular esté en la misma red Wi-Fi que tu Mac.
                    </p>
                </div>
            )}

            {showSkip && (
                <div className="mt-12 flex flex-col items-center animate-in fade-in zoom-in duration-500">
                    <p className="text-[11px] text-red-500 mb-4 font-medium">
                        Problema de conexión detectado
                    </p>
                    <button
                        onClick={handleSkip}
                        className="px-6 py-3 bg-zinc-900 dark:bg-white text-white dark:text-black text-xs font-bold rounded-xl active:scale-95 transition-all shadow-lg"
                    >
                        Omitir y Reintentar Login
                    </button>
                </div>
            )}
        </div>
    );
};

export default LoadingScreen;
