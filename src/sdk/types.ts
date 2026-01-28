/**
 * Contexto de ejecución para los Plugins.
 * Define en qué entorno (Cuenta/Rol) está operando el plugin.
 */
export interface MinReportContext {
    /**
     * ID de la cuenta (Tenant) actual.
     * Obligatorio para asegurar aislamiento de datos.
     */
    accountId: string;

    /**
     * Rol del usuario en esta cuenta.
     * Útil para que el plugin oculte/muestre funciones.
     */
    userRole?: string;
}
