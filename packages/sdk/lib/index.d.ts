/**
 * MINREPORT Plugin SDK
 *
 * Este SDK facilita la comunicación entre un plugin y el núcleo de MINREPORT.
 */
/**
 * Representa un usuario de MINREPORT autenticado.
 * La información es una versión segura y serializable del objeto de usuario de Firebase.
 */
export interface MinreportUser {
    uid: string;
    email: string | null;
    displayName: string | null;
    emailVerified: boolean;
}
/**
 * Representa los claims personalizados de un usuario en MINREPORT.
 * Determina los roles y permisos.
 */
export interface MinreportClaims {
    [key: string]: any;
    isAdmin?: boolean;
    isClient?: boolean;
}
/**
 * Contiene toda la información de la sesión del usuario.
 */
export interface MinreportSession {
    user: MinreportUser | null;
    claims: MinreportClaims | null;
}
/**
 * Inicializa el SDK y establece la comunicación con el núcleo de MINREPORT.
 * Esta función DEBE ser llamada una sola vez al iniciar el plugin.
 *
 * @param allowedOrigins Un array de strings con los orígenes permitidos para recibir mensajes.
 *                       Por seguridad, debe ser lo más restrictivo posible.
 * @returns Una promesa que se resuelve cuando el SDK ha recibido los datos de sesión.
 */
export declare const initialize: (allowedOrigins: string[]) => Promise<MinreportSession>;
/**
 * Devuelve la información de la sesión del usuario.
 * Solo funciona después de que `initialize` se haya resuelto exitosamente.
 *
 * @returns El objeto de sesión de MINREPORT, o null si no está inicializado.
 */
export declare const getSession: () => MinreportSession;
/**
 * Solicita al núcleo de MINREPORT que navegue a una nueva ruta interna.
 * @param path La ruta a la que navegar (ej. '/dashboard').
 */
export declare const requestNavigation: (path: string) => void;
/**
 * Solicita al núcleo de MINREPORT que muestre una notificación en la UI principal.
 * @param level El tipo de notificación.
 * @param message El mensaje a mostrar.
 */
export declare const showNotification: (level: "info" | "success" | "error", message: string) => void;
//# sourceMappingURL=index.d.ts.map