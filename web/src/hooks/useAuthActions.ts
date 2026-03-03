import { useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../config/firebase';
import { getApiUrl } from '../utils/network';
import type { AccountReference } from '../types/user_directory';

interface UseAuthActionsReturn {
    detectedAccounts: AccountReference[];
    showAccountSelector: boolean;
    loading: boolean;
    error: string;
    checkIdentity: (run: string) => Promise<void>;
    loginToAccount: (account: AccountReference, password: string, taxId: string) => Promise<void>;
    resetFlow: () => void;
}

/**
 * Hook de Autenticación - Arquitectura "Pasillo de Puertas Blindadas"
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
            const response = await fetch(getApiUrl(`/api/public/accounts-by-id/${run}`));

            const data = await response.json();

            if (!response.ok) {
                setError(data.message || 'ID no encontrado');
                setLoading(false);
                return;
            }

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
    const loginToAccount = async (account: AccountReference, password: string, taxId: string) => {
        setLoading(true);
        setError('');

        try {
            const response = await fetch(getApiUrl('/api/auth/tunnel/challenge'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accountId: account.accountId,
                    taxId: taxId, // RUT/RUN — identificador principal del usuario
                    password
                })
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || 'Credenciales inválidas.');
                setLoading(false);
                return;
            }

            await signInWithCustomToken(auth, data.firebaseToken);

            setDetectedAccounts([]);
            setShowAccountSelector(false);
            setLoading(false);

        } catch (err: any) {
            console.error('Login error:', err);
            setError('Error de conexión con el servidor de seguridad.');
            setLoading(false);
        }
    };

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
