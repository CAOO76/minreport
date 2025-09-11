/**
 * Función para manejar la solicitud inicial de acceso a MINREPORT.
 * Recibe los datos del formulario, valida y crea un documento en la colección 'requests'.
 */
export declare const requestInitialRegistration: (data: any) => Promise<{
    success: boolean;
    message: string;
    requestId: string;
}>;
