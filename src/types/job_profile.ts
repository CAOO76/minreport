
export type UserRole = 'OWNER' | 'ADMIN' | 'BILLING_ONLY' | 'OPERATOR' | 'SUBSCRIPTION_ADMIN' | 'GENERAL_ADMIN' | 'INTERNAL_USER';

export type AccountType = 'PERSONAL' | 'BUSINESS' | 'EDUCATIONAL' | 'ENTERPRISE';

/**
 * JobProfile - Perfil de Cargo
 * Define un conjunto estandarizado de permisos de plugins para un rol específico.
 * Cada cuenta B2B puede crear sus propios perfiles independientes.
 */
export interface JobProfile {
    id: string;
    name: string; // ej: "Operador CAEX", "Supervisor de Planta", "Capataz"
    description: string;
    allowedPlugins: string[]; // Array de plugin IDs permitidos
    createdAt: number;
    updatedAt: number;
    createdBy?: string; // UID del usuario que creó el perfil
}
