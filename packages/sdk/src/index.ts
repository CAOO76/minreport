/**
 * MINREPORT Plugin SDK
 * 
 * Este SDK facilita la comunicación entre un plugin y el núcleo de MINREPORT.
 */

// --- Tipos de Datos Centrales ---

/**
 * Representa un usuario de MINREPORT autenticado.
 */
export interface MinreportUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
}

/**
 * Representa los claims personalizados de un usuario en MINREPORT.
 */
export interface MinreportClaims {
  [key: string]: any;
  isAdmin?: boolean;
  isClient?: boolean;
}

/**
 * Contiene toda la información de la sesión del usuario, incluyendo el token de autenticación.
 */
export interface MinreportSession {
  user: MinreportUser | null;
  claims: MinreportClaims | null;
  token: string | null; // El Firebase ID Token del usuario
}

// --- Estado Interno del SDK ---

let session: MinreportSession = {
  user: null,
  claims: null,
  token: null,
};

let isInitialized = false;

// --- REGISTRO DE SERVICIOS ---
// En un entorno real, esto podría venir de una configuración remota.
const serviceRegistry = {
  development: {
    'transactions-service': 'http://localhost:8080',
  },
  production: {
    // TODO: Añadir URLs de producción cuando estén disponibles
    'transactions-service': 'https://transactions-service-url.on.run',
  },
};

// Determina el entorno actual (simplificado)
const env = window.location.hostname === 'localhost' ? 'development' : 'production';


// --- API del SDK ---

/**
 * Inicializa el SDK y establece la comunicación con el núcleo de MINREPORT.
 * @param allowedOrigins Un array de orígenes permitidos para recibir mensajes.
 * @returns Una promesa que se resuelve con los datos de sesión.
 */
export const initialize = (allowedOrigins: string[]): Promise<MinreportSession> => {
  if (isInitialized) {
    console.warn('MINREPORT SDK ya ha sido inicializado.');
    return Promise.resolve(session);
  }

  isInitialized = true;

  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent) => {
      if (!allowedOrigins.includes(event.origin)) {
        return;
      }

      if (event.data && event.data.type === 'MINREPORT_SESSION_DATA') {
        const sessionData = event.data.data;
        if (sessionData && sessionData.user && sessionData.token) {
          console.log('MINREPORT SDK: Datos de sesión recibidos y validados.');
          session = sessionData;
          resolve(session);
        } else {
          console.error('MINREPORT SDK: Los datos de sesión recibidos no incluyen el token o el usuario.');
          reject(new Error('Formato de datos de sesión inválido.'));
        }
        window.removeEventListener('message', handleMessage);
      }
    };

    window.addEventListener('message', handleMessage);

    setTimeout(() => {
      if (!session.user) {
        reject(new Error('MINREPORT SDK: Timeout esperando los datos de sesión del núcleo.'));
      }
    }, 10000);
  });
};

/**
 * Devuelve la información de la sesión del usuario.
 * @returns El objeto de sesión de MINREPORT.
 */
export const getSession = (): MinreportSession => {
  if (!isInitialized || !session.user) {
    console.warn('MINREPORT SDK: getSession() fue llamado antes de que la sesión estuviera disponible.');
  }
  return session;
};

/**
 * Realiza una llamada autenticada a un microservicio de MINREPORT.
 * @param serviceName El nombre del servicio (ej. 'transactions-service').
 * @param endpoint El endpoint a llamar (ej. '/projects/123/transactions').
 * @param options Opciones de Fetch API (method, body, etc.).
 * @returns Una promesa que se resuelve con la respuesta del servicio.
 */
export const callService = async (serviceName: keyof typeof serviceRegistry[typeof env], endpoint: string, options: RequestInit = {}): Promise<any> => {
  if (!isInitialized || !session.token) {
    throw new Error('MINREPORT SDK no está inicializado o no se ha recibido un token de sesión.');
  }

  const baseUrl = serviceRegistry[env][serviceName];
  if (!baseUrl) {
    throw new Error(`Servicio '${serviceName}' no encontrado en el registro para el entorno '${env}'.`);
  }

  const url = `${baseUrl}${endpoint}`;

  const fetchOptions: RequestInit = {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
  };

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error en la llamada al servicio ${serviceName}: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
};


// --- Funciones de Acción (Plugin -> Núcleo) ---

const requestAction = (action: string, data: any) => {
  if (!isInitialized) {
    console.error('MINREPORT SDK: Debe inicializar el SDK antes de solicitar una acción.');
    return;
  }
  window.parent.postMessage({ type: 'MINREPORT_ACTION', payload: { action, data } }, '*');
};

export const requestNavigation = (path: string) => {
  requestAction('navigate', { path });
};

export const showNotification = (level: 'info' | 'success' | 'error', message: string) => {
  requestAction('showNotification', { level, message });
};
