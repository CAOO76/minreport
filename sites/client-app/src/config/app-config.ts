/**
 * Configuración unificada MinReport
 * Soporta desarrollo local y producción (minreport.com)
 */

interface AppConfig {
  environment: 'development' | 'production';
  apiUrl: string;
  appUrl: string;
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
  };
  offline: {
    enabled: boolean;
    persistenceLevel: 'full' | 'partial';
    autoSync: boolean;
    syncInterval: number; // ms
  };
  features: {
    offline: boolean;
    reporting: boolean;
    analytics: boolean;
    admin: boolean;
  };
}

/**
 * Detectar ambiente automáticamente
 */
function getEnvironment(): 'development' | 'production' {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const port = window.location.port;
    console.log(`🌐 URL actual: ${hostname}:${port}`);
    return hostname === 'localhost' || hostname === '127.0.0.1' ? 'development' : 'production';
  }
  return import.meta.env.MODE === 'production' ? 'production' : 'development';
}

/**
 * Cargar configuración según ambiente
 */
function loadConfig(): AppConfig {
  const isDev = getEnvironment() === 'development';
  
  // Detectar URL real si estamos en el navegador
  let appUrl = isDev ? 'http://localhost:5175' : 'https://minreport.com';
  if (typeof window !== 'undefined') {
    appUrl = `${window.location.protocol}//${window.location.host}`;
  }

  return {
    environment: isDev ? 'development' : 'production',
    
    // URLs basadas en ambiente
    apiUrl: isDev ? 'http://localhost:3000' : 'https://api.minreport.com',
    appUrl: appUrl,

    // Firebase (mismo para dev y prod - emulador local en dev)
    firebase: {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'minreport-dev',
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
    },

    // Configuración offline
    offline: {
      enabled: true,
      persistenceLevel: 'full', // full | partial
      autoSync: true,
      syncInterval: 30000, // 30 segundos
    },

    // Features por ambiente
    features: {
      offline: true,
      reporting: true,
      analytics: isDev, // Solo en dev por ahora
      admin: isDev, // Solo en dev
    },
  };
}

// Singleton
let config: AppConfig | null = null;

/**
 * Obtener configuración
 */
export function getConfig(): AppConfig {
  if (!config) {
    config = loadConfig();
    console.log(`✅ Config cargada: ${config.environment} - ${config.appUrl}`);
  }
  return config;
}

/**
 * Resetear configuración (útil para testing)
 */
export function resetConfig() {
  config = null;
}

/**
 * Verificar si está en modo desarrollo
 */
export function isDevelopment(): boolean {
  return getConfig().environment === 'development';
}

/**
 * Verificar si está en producción
 */
export function isProduction(): boolean {
  return getConfig().environment === 'production';
}

/**
 * Obtener URL de API
 */
export function getApiUrl(): string {
  return getConfig().apiUrl;
}

/**
 * Obtener configuración de Firebase
 */
export function getFirebaseConfig() {
  return getConfig().firebase;
}

/**
 * Verificar si feature está habilitada
 */
export function isFeatureEnabled(feature: keyof AppConfig['features']): boolean {
  return getConfig().features[feature];
}

/**
 * Obtener configuración offline
 */
export function getOfflineConfig() {
  return getConfig().offline;
}

export default getConfig();
