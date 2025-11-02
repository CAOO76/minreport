/**
 * MinReport - Environment Configuration
 * 
 * Configuración centralizada para desarrollo y producción
 * Una única fuente de verdad para todas las aplicaciones
 */

export type Environment = 'development' | 'production' | 'staging';

export interface EmulatorPorts {
  auth: number;
  firestore: number;
  functions: number;
  storage: number;
  hosting?: number;
}

export interface FirebaseEnvironmentConfig {
  // Firebase Project Settings
  projectId: string;
  apiKey?: string;
  authDomain?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
  
  // Region for Cloud Functions
  region: string;
  
  // Emulator Configuration
  useEmulator: boolean;
  emulatorPorts?: EmulatorPorts;
  
  // API Configuration
  apiBaseUrl: string;
  
  // Feature Flags
  features: {
    offlineEnabled: boolean;
    serviceWorkerEnabled: boolean;
    syncEnabled: boolean;
    analyticsEnabled: boolean;
  };
}

/**
 * Development Environment - Local Firebase Emulators
 */
export const DEVELOPMENT_CONFIG: FirebaseEnvironmentConfig = {
  projectId: 'minreport-8f2a8',
  region: 'southamerica-west1',
  useEmulator: true,
  emulatorPorts: {
    auth: 9190,
    firestore: 8085,
    functions: 9196,
    storage: 9195,
    hosting: 4002,
  },
  apiBaseUrl: 'http://localhost:9196/minreport-8f2a8/southamerica-west1',
  features: {
    offlineEnabled: true,
    serviceWorkerEnabled: true,
    syncEnabled: true,
    analyticsEnabled: false,
  },
};

/**
 * Production Environment - Firebase Cloud
 */
export const PRODUCTION_CONFIG: FirebaseEnvironmentConfig = {
  projectId: 'minreport-8f2a8',
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: 'minreport-8f2a8.firebaseapp.com',
  storageBucket: 'minreport-8f2a8.appspot.com',
  messagingSenderId: '493995072778',
  appId: '1:493995072778:web:41a2917f1e81491a7f6ef3',
  measurementId: 'G-KH3ZP9V53Y',
  region: 'southamerica-west1',
  useEmulator: false,
  apiBaseUrl: 'https://southamerica-west1-minreport-8f2a8.cloudfunctions.net',
  features: {
    offlineEnabled: true,
    serviceWorkerEnabled: true,
    syncEnabled: true,
    analyticsEnabled: true,
  },
};

/**
 * Staging Environment - Pre-production Firebase Project
 */
export const STAGING_CONFIG: FirebaseEnvironmentConfig = {
  projectId: 'minreport-staging',
  apiKey: process.env.VITE_FIREBASE_STAGING_API_KEY,
  authDomain: 'minreport-staging.firebaseapp.com',
  storageBucket: 'minreport-staging.appspot.com',
  messagingSenderId: '123456789',
  appId: '1:123456789:web:abc123def456',
  region: 'southamerica-west1',
  useEmulator: false,
  apiBaseUrl: 'https://southamerica-west1-minreport-staging.cloudfunctions.net',
  features: {
    offlineEnabled: true,
    serviceWorkerEnabled: true,
    syncEnabled: true,
    analyticsEnabled: true,
  },
};

/**
 * Configuración centralizada por entorno
 */
export const FIREBASE_CONFIGS: Record<Environment, FirebaseEnvironmentConfig> = {
  development: DEVELOPMENT_CONFIG,
  production: PRODUCTION_CONFIG,
  staging: STAGING_CONFIG,
};

/**
 * Obtener entorno actual
 */
export const getCurrentEnvironment = (): Environment => {
  // Client-side
  if (typeof window !== 'undefined') {
    return (import.meta.env.MODE === 'production' ? 'production' : 'development') as Environment;
  }
  
  // Server-side
  const env = process.env.NODE_ENV;
  if (env === 'production') return 'production';
  if (env === 'staging') return 'staging';
  return 'development';
};

/**
 * Obtener configuración del entorno actual
 */
export const getCurrentConfig = (): FirebaseEnvironmentConfig => {
  const environment = getCurrentEnvironment();
  return FIREBASE_CONFIGS[environment];
};

/**
 * Obtener configuración por entorno específico
 */
export const getConfigByEnvironment = (environment: Environment): FirebaseEnvironmentConfig => {
  return FIREBASE_CONFIGS[environment];
};

/**
 * Validar que la configuración está completa para el entorno
 */
export const validateConfig = (config: FirebaseEnvironmentConfig): boolean => {
  if (!config.projectId) {
    console.error('❌ Missing projectId in Firebase config');
    return false;
  }
  
  if (config.useEmulator) {
    if (!config.emulatorPorts) {
      console.error('❌ Missing emulatorPorts in development config');
      return false;
    }
  } else {
    if (!config.apiKey || !config.authDomain || !config.appId) {
      console.error('❌ Missing Firebase credentials for production');
      return false;
    }
  }
  
  return true;
};
