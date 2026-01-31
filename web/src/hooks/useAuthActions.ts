import { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../config/firebase';
import { IdentityService } from '../services/IdentityService';

/**
 * Hook de Autenticación con Login Híbrido (RUT/Email)
 * Utiliza IdentityService para resolver RUT -> Email antes de autenticar.
 */
export const useAuthActions = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Login Híbrido: Acepta RUT o Email como identificador
     * @param identifier RUT (12.345.678-9) o Email
     * @param password Contraseña del usuario
     */
    const signIn = async (identifier: string, password: string): Promise<void> => {
        setLoading(true);
        setError(null);

        try {
            // Paso 1: Resolver credenciales (RUT -> Email o Email -> Email)
            const emailToUse = await IdentityService.resolveCredentials(identifier);

            // Paso 2: Autenticar con Firebase Auth
            await signInWithEmailAndPassword(auth, emailToUse, password);

            // Éxito: El AuthContext detectará el cambio de estado automáticamente
        } catch (err) {
            // Seguridad: Error genérico para evitar enumeración de usuarios
            console.error('Login error:', err);
            const errorMessage = 'Credenciales no válidas o error de conexión';
            setError(errorMessage);
            throw new Error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    /**
     * Registro de nuevo usuario (Email/Password)
     * Nota: El RUT se asignará posteriormente en el perfil de Firestore
     */
    const signUp = async (email: string, password: string): Promise<void> => {
        setLoading(true);
        setError(null);

        try {
            await createUserWithEmailAndPassword(auth, email, password);
            // El perfil se creará mediante Cloud Functions o lógica post-registro
        } catch (err: any) {
            console.error('Sign up error:', err);
            let errorMessage = 'Error al crear la cuenta';

            // Mensajes de error específicos (solo para registro, no login)
            if (err.code === 'auth/email-already-in-use') {
                errorMessage = 'Este email ya está registrado';
            } else if (err.code === 'auth/weak-password') {
                errorMessage = 'La contraseña debe tener al menos 6 caracteres';
            } else if (err.code === 'auth/invalid-email') {
                errorMessage = 'Email inválido';
            }

            setError(errorMessage);
            throw new Error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    /**
     * Recuperación de acceso por RUT
     * Dispara el email de reset de contraseña
     */
    const recoverAccess = async (rut: string): Promise<{
        email: string;
        phone: string;
        success: boolean;
    }> => {
        setLoading(true);
        setError(null);

        try {
            const result = await IdentityService.recoverAccessByRut(rut);
            return result;
        } catch (err: any) {
            console.error('Recovery error:', err);
            const errorMessage = err.message || 'No se pudo procesar la solicitud';
            setError(errorMessage);
            throw new Error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return {
        signIn,
        signUp,
        recoverAccess,
        loading,
        error,
        clearError: () => setError(null)
    };
};
