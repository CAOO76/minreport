import React from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../config/firebase';
import { signInWithCustomToken } from 'firebase/auth';

interface DevImpersonationHUDProps {
    accountName?: string;
    accountId?: string;
}

export const DevImpersonationHUD: React.FC<DevImpersonationHUDProps> = ({
    accountName = 'Cliente Simulado',
    accountId = 'sandbox',
}) => {
    const navigate = useNavigate();
    const isImpersonating = localStorage.getItem('dev_is_impersonating') === 'true';

    if (!isImpersonating) return null;

    const handleExitSimulation = async () => {
        try {
            const originalDevToken = localStorage.getItem('dev_auth_token') || localStorage.getItem('dev_vault_token');
            localStorage.removeItem('dev_is_impersonating');
            localStorage.removeItem('dev_impersonated_account');

            if (originalDevToken) {
                try {
                    await signInWithCustomToken(auth, originalDevToken);
                } catch {
                    await auth.signOut();
                }
            } else {
                await auth.signOut();
            }

            navigate('/dev');
        } catch (err) {
            console.error('[DEV-HUD] Error al salir de simulación:', err);
            navigate('/dev');
        }
    };

    return (
        <aside
            aria-label="Barra de herramientas de simulación DEV"
            className="fixed top-0 left-0 right-0 z-[9999] bg-[#F8FAFC] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border-b-2 border-[#C68346] px-fib-21 py-fib-8 flex items-center justify-between rounded-none shadow-none select-none"
        >
            <div className="flex items-center gap-fib-13">
                <span className="material-symbols-outlined text-[#C68346] text-[18px]">
                    terminal
                </span>
                <span className="font-mono text-microcopy uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                    MODO SIMULACIÓN CLIENTE ACTIVO:
                </span>
                <span className="font-mono text-microcopy text-[#00AEEF] px-fib-8 py-0.5 border border-[#00AEEF]/40 bg-[#00AEEF]/5 rounded-none">
                    {accountName} ({accountId})
                </span>
            </div>

            <button
                type="button"
                onClick={handleExitSimulation}
                className="bg-transparent border border-[#C68346] text-[#C68346] hover:bg-[#C68346] hover:text-white transition-colors px-fib-13 py-fib-8 text-microcopy font-mono font-bold uppercase cursor-pointer rounded-none shadow-none outline-none"
            >
                FINALIZAR SIMULACIÓN
            </button>
        </aside>
    );
};

export default DevImpersonationHUD;
