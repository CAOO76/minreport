import { UserRole, AccountType } from '../../../src/types/auth';

/**
 * Referencia a una cuenta en el directorio de usuarios
 * Permite que un RUN tenga múltiples cuentas con emails de autenticación separados
 */
export interface AccountReference {
    accountId: string;      // ID de la cuenta en collection 'accounts'
    authEmail: string;      // Email específico para auth de esta cuenta
    role: UserRole;         // Rol del usuario en esta cuenta
    type: AccountType;      // Tipo de cuenta (B2B, EDU, PERSONAL)
    avatar?: string;        // Avatar específico para esta cuenta
    accountName: string;    // Nombre de la cuenta para UI
    jobProfileId?: string;  // [NEW] Referencia al perfil de cargo asignado
}

/**
 * Directorio de Usuarios - Colección Maestra de Identidades
 * ID del Documento: RUN del usuario (normalizado)
 * 
 * Arquitectura "Pasillo de Puertas Blindadas":
 * - Desvincula identidad física (RUN) de cuenta de usuario (Auth UID)
 * - Permite múltiples cuentas (B2B, Personal, Edu) bajo un mismo RUN
 * - Cada cuenta tiene su propio authEmail para aislamiento total
 */
export interface UserDirectory {
    run: string;                    // RUN del usuario (ID del documento)
    fullName: string;               // Nombre completo del usuario
    accounts: AccountReference[];   // Array de cuentas asociadas
    accountId?: string;             // [NEW] Added for Security Rules context validation
    createdAt: number;
    updatedAt: number;
}
