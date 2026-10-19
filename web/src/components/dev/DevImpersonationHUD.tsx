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
    accountId = 'sandbox'
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
                // Restaurar token maestro DEV si es posible
                try {
                    await signInWithCustomToken(auth, originalDevToken);
                } catch {
                    // Fallback a sign out limpio
                    await auth.signOut();
                }
            } else {
                await auth.signOut();
            }

            navigate('/dev-vault-gateway');
        } catch (err) {
            console.error('[DEV-HUD] Error al salir de simulación:', err);
            navigate('/dev-vault-gateway');
        }
    };

    return (
        <aside 
            aria-label="Barra de herramientas de simulación DEV"
            className="fixed top-0 left-0 right-0 z-[9999] bg-[#07090D] border-b-2 border-[#C68346] px-4 py-2 flex items-center justify-between shadow-none select-none"
        >
            <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[#C68346] text-[18px]">
                    terminal
                </span>
                <span className="font-mono text-xs uppercase tracking-wider text-[#F3F4F6]">
                    MODO SIMULACIÓN CLIENTE ACTIVO:
                </span>
                <span className="font-mono text-xs text-[#00AEEF] px-1.5 py-0.5 border border-[#00AEEF]/30 bg-[#00AEEF]/5">
                    {accountName} ({accountId})
                </span>
            </div>

            <button
                type="button"
                onClick={handleExitSimulation}
                className="bg-transparent border border-[#C68346] text-[#C68346] hover:bg-[#C68346] hover:text-black transition-colors px-3 py-1 text-xs font-mono font-bold tracking-wider uppercase cursor-pointer rounded-none outline-none flex items-center gap-1.5"
            >
                <span className="material-symbols-outlined text-[16px]">
                    logout
                </span>
                Finalizar Simulación
            </button>
        </aside>
    );
};

export default DevImpersonationHUD;
