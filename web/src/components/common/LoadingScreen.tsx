
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
                <div className="w-16 h-16 border border-white/10 dark:border-white/5 rounded-none animate-pulse"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-black/40 dark:text-white/40 animate-spin" />
                </div>
            </div>

            <div className="flex flex-col items-center">
                <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-[1px] bg-antigravity-accent opacity-40"></div>
                    <p className="hud-label text-[11px] text-gray-900 dark:text-white">
                        MINREPORT®
                    </p>
                    <div className="w-8 h-[1px] bg-antigravity-accent opacity-40"></div>
                </div>
                <p className="hud-label text-[9px] text-black/20 dark:text-white/20 animate-pulse tracking-[0.3em]">
                    SECURE_INIT_PROTOCOL
                </p>
            </div>

            {showSlowMessage && !showSkip && (
                <div className="mt-12 p-5 rounded-none bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 max-w-xs animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <p className="hud-label text-black/40 dark:text-white/40 mb-2 opacity-60">
                        [CONNECTION_LATENCY]
                    </p>
                    <p className="text-[10px] text-black/60 dark:text-white/40 font-bold uppercase tracking-tight leading-relaxed">
                        Verifica que tu celular esté en la misma red Wi-Fi que tu Mac.
                    </p>
                </div>
            )}

            {showSkip && (
                <div className="mt-12 flex flex-col items-center animate-in fade-in zoom-in duration-500">
                    <p className="hud-label text-red-500 mb-4">
                        [FAILURE_TIMEOUT]
                    </p>
                    <button
                        onClick={handleSkip}
                        className="px-8 py-4 bg-black dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-[0.3em] rounded-none active:scale-95 transition-all shadow-antigravity-accent/10 shadow-2xl"
                    >
                        ABORT_AND_RETRY
                    </button>
                </div>
            )}
        </div>
    );
};

export default LoadingScreen;
