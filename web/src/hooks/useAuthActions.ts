import { useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../config/firebase';
import type { AccountReference } from '../types/user_directory';

interface UseAuthActionsReturn {
    detectedAccounts: AccountReference[];
    showAccountSelector: boolean;
    loading: boolean;
    error: string;
    checkIdentity: (run: string) => Promise<void>;
    loginToAccount: (account: AccountReference, password: string) => Promise<void>;
    resetFlow: () => void;
}

/**
 * Hook de Autenticación - Arquitectura "Pasillo de Puertas Blindadas"
 * 
 * Flujo:
 * 1. checkIdentity(run) -> Consulta user_directory
 * 2. Si >1 cuenta -> Activa showAccountSelector
 * 3. loginToAccount(selectedAccount) -> Auth con authEmail específico
 */
export const useAuthActions = (): UseAuthActionsReturn => {
    const [detectedAccounts, setDetectedAccounts] = useState<AccountReference[]>([]);
    const [showAccountSelector, setShowAccountSelector] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    /**
     * Paso A: Verificar identidad y detectar cuentas asociadas
     */
    const checkIdentity = async (run: string) => {
        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL}/api/public/accounts-by-id/${run}`);

            if (!response.ok) {
                const data = await response.json();
                setError(data.message || 'ID no encontrado');
                setLoading(false);
                return;
            }

            const data = await response.json();
            console.log('[AUTH-HOOK] API Response data:', JSON.stringify(data, null, 2));

            if (!data.accounts || data.accounts.length === 0) {
                setError('Este documento no tiene cuentas asociadas');
                setLoading(false);
                return;
            }

            // Deduplicar cuentas por accountId
            const uniqueAccounts = new Map<string, AccountReference>();
            data.accounts.forEach((acc: AccountReference) => {
                uniqueAccounts.set(acc.accountId, acc);
            });

            const accounts = Array.from(uniqueAccounts.values());
            setDetectedAccounts(accounts);

            // Mostrar selector si hay al menos una cuenta
            if (accounts.length >= 1) {
                setShowAccountSelector(true);
            }

            setLoading(false);
        } catch (err: any) {
            console.error('Error detecting accounts:', err);
            setError('Error al verificar la identidad.');
            setLoading(false);
        }
    };

    /**
     * Paso C: Login a cuenta específica usando authEmail segregado
     */
    const loginToAccount = async (account: AccountReference, password: string) => {
        setLoading(true);
        setError('');

        try {
            // 1. Desafío de Clave Segregada (vía API Tunnel)
            const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/tunnel/challenge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accountId: account.accountId,
                    authEmail: account.authEmail, // CRÍTICO: Email específico de la cuenta
                    password
                })
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || 'Credenciales inválidas.');
                setLoading(false);
                return;
            }

            // 2. Autenticación Firebase con Token Personalizado
            // Este token ya trae los claims del entorno seleccionado (Aislamiento Total)
            await signInWithCustomToken(auth, data.firebaseToken);

            // 3. Limpieza exitosa
            setDetectedAccounts([]);
            setShowAccountSelector(false);
            setLoading(false);

        } catch (err: any) {
            console.error('Login error:', err);
            setError('Error de conexión con el servidor de seguridad.');
            setLoading(false);
        }
    };

    /**
     * Resetear flujo (volver a identificación)
     */
    const resetFlow = () => {
        setDetectedAccounts([]);
        setShowAccountSelector(false);
        setError('');
        setLoading(false);
    };

    return {
        detectedAccounts,
        showAccountSelector,
        loading,
        error,
        checkIdentity,
        loginToAccount,
        resetFlow
    };
};
