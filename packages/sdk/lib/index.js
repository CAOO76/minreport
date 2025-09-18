/**
 * MINREPORT Plugin SDK
 *
 * Este SDK facilita la comunicación entre un plugin y el núcleo de MINREPORT.
 */
// --- Estado Interno del SDK ---
let session = {
    user: null,
    claims: null,
};
let isInitialized = false;
// --- API del SDK ---
/**
 * Inicializa el SDK y establece la comunicación con el núcleo de MINREPORT.
 * Esta función DEBE ser llamada una sola vez al iniciar el plugin.
 *
 * @param allowedOrigins Un array de strings con los orígenes permitidos para recibir mensajes.
 *                       Por seguridad, debe ser lo más restrictivo posible.
 * @returns Una promesa que se resuelve cuando el SDK ha recibido los datos de sesión.
 */
export const initialize = (allowedOrigins) => {
    if (isInitialized) {
        console.warn('MINREPORT SDK ya ha sido inicializado.');
        return Promise.resolve(session);
    }
    isInitialized = true;
    return new Promise((resolve, reject) => {
        const handleMessage = (event) => {
            // Medida de Seguridad: Validar el origen del mensaje
            if (!allowedOrigins.includes(event.origin)) {
                console.warn(`MINREPORT SDK: Mensaje bloqueado de origen no permitido: ${event.origin}`);
                return;
            }
            // Medida de Seguridad: Validar la estructura del mensaje
            if (event.data && event.data.type === 'MINREPORT_SESSION_DATA') {
                const sessionData = event.data.data;
                if (sessionData && sessionData.user) {
                    console.log('MINREPORT SDK: Datos de sesión recibidos y validados.');
                    session = sessionData;
                    resolve(session);
                }
                else {
                    console.error('MINREPORT SDK: Los datos de sesión recibidos no tienen el formato esperado.');
                    reject(new Error('Formato de datos de sesión inválido.'));
                }
                // Una vez recibidos los datos, podemos remover el listener si no esperamos más mensajes de este tipo.
                window.removeEventListener('message', handleMessage);
            }
        };
        window.addEventListener('message', handleMessage);
        // Timeout por si el núcleo nunca envía los datos
        setTimeout(() => {
            if (!session.user) {
                reject(new Error('MINREPORT SDK: Timeout esperando los datos de sesión del núcleo.'));
            }
        }, 10000); // 10 segundos de espera
    });
};
/**
 * Devuelve la información de la sesión del usuario.
 * Solo funciona después de que `initialize` se haya resuelto exitosamente.
 *
 * @returns El objeto de sesión de MINREPORT, o null si no está inicializado.
 */
export const getSession = () => {
    if (!isInitialized || !session.user) {
        console.warn('MINREPORT SDK: getSession() fue llamado antes de que la sesión estuviera disponible.');
    }
    return session;
};
// --- Funciones de Acción (Plugin -> Núcleo) ---
/**
 * Envía un mensaje al núcleo de MINREPORT para solicitar una acción.
 * @param action El tipo de acción a solicitar.
 * @param data Los datos asociados a la acción.
 */
const requestAction = (action, data) => {
    if (!isInitialized) {
        console.error('MINREPORT SDK: Debe inicializar el SDK antes de solicitar una acción.');
        return;
    }
    // El origen del núcleo se infiere del primer mensaje recibido, pero por ahora usamos '*'.
    // TODO: Almacenar el origen del núcleo de forma segura para usarlo aquí.
    window.parent.postMessage({ type: 'MINREPORT_ACTION', payload: { action, data } }, '*');
};
/**
 * Solicita al núcleo de MINREPORT que navegue a una nueva ruta interna.
 * @param path La ruta a la que navegar (ej. '/dashboard').
 */
export const requestNavigation = (path) => {
    requestAction('navigate', { path });
};
/**
 * Solicita al núcleo de MINREPORT que muestre una notificación en la UI principal.
 * @param level El tipo de notificación.
 * @param message El mensaje a mostrar.
 */
export const showNotification = (level, message) => {
    requestAction('showNotification', { level, message });
};
