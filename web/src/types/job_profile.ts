/**
 * JobProfile - Perfil de Cargo (Frontend Types)
 * 
 * Define un conjunto estandarizado de permisos de plugins para un rol específico.
 * Cada cuenta B2B puede crear sus propios perfiles independientes.
 * 
 * IMPORTANTE: Estos tipos son una copia de los tipos del backend para evitar
 * dependencias cruzadas entre src/ y web/src/
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
