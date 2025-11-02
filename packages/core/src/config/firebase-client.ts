/**
 * MinReport - Firebase Configuration (Client-side)
 * 
 * Configuración centralizada para desarrollo y producción
 * Importa esta configuración en todos los sites (client-app, admin-app, public-site)
 */

export type Environment = 'development' | 'production' | 'staging';

export interface EmulatorPorts {
  auth: number;
  firestore: number;
  functions: number;
  storage: number;
  hosting?: number;
}

export interface FirebaseClientConfig {
  // Firebase Project Settings
  projectId: string;
  apiKey: string;
  authDomain: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
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
 * Uso: http://localhost:5173 (client-app) | http://localhost:5177 (admin-app)
 */
export const DEVELOPMENT_CONFIG: FirebaseClientConfig = {
  projectId: 'minreport-8f2a8',
  apiKey: 'AIzaSyC4oxkLSJUo-msWmsh3cQOZu_uJCuIISb8',
  authDomain: 'minreport-8f2a8.firebaseapp.com',
  storageBucket: 'minreport-8f2a8.appspot.com',
  messagingSenderId: '493995072778',
  appId: '1:493995072778:web:41a2917f1e81491a7f6ef3',
  measurementId: 'G-KH3ZP9V53Y',
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
 * Uso: https://minreport.com y https://admin.minreport.com
 */
export const PRODUCTION_CONFIG: FirebaseClientConfig = {
  projectId: 'minreport-8f2a8',
  apiKey: 'AIzaSyC4oxkLSJUo-msWmsh3cQOZu_uJCuIISb8', // same projectId, different firebaseconfig
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
 * Configuración centralizada por entorno
 */
export const FIREBASE_CONFIGS: Record<Environment, FirebaseClientConfig> = {
  development: DEVELOPMENT_CONFIG,
  production: PRODUCTION_CONFIG,
  staging: PRODUCTION_CONFIG, // Use production config for staging
};

/**
 * Obtener entorno actual (client-side)
 */
export const getCurrentEnvironment = (): Environment => {
  // @ts-ignore - import.meta.env is injected by Vite
  const mode = import.meta.env?.MODE || 'development';
  return (mode === 'production' ? 'production' : 'development') as Environment;
};

/**
 * Obtener configuración del entorno actual
 */
export const getCurrentConfig = (): FirebaseClientConfig => {
  const environment = getCurrentEnvironment();
  return FIREBASE_CONFIGS[environment];
};

/**
 * Obtener configuración por entorno específico
 */
export const getConfigByEnvironment = (environment: Environment): FirebaseClientConfig => {
  return FIREBASE_CONFIGS[environment];
};

/**
 * Validar que la configuración está completa
 */
export const validateConfig = (config: FirebaseClientConfig): boolean => {
  const required: (keyof FirebaseClientConfig)[] = [
    'projectId',
    'apiKey',
    'authDomain',
    'storageBucket',
    'messagingSenderId',
    'appId',
    'region',
    'apiBaseUrl',
  ];
  
  for (const key of required) {
    if (!config[key]) {
      console.error(`❌ Missing ${key} in Firebase config`);
      return false;
    }
  }
  
  if (config.useEmulator && !config.emulatorPorts) {
    console.error('❌ Missing emulatorPorts in development config');
    return false;
  }
  
  return true;
};

/**
 * Log configuración (debug)
 */
export const debugConfig = (config: FirebaseClientConfig): void => {
  console.log('🔧 Firebase Config:');
  console.log(`   Project: ${config.projectId}`);
  console.log(`   Region: ${config.region}`);
  console.log(`   Emulator: ${config.useEmulator ? '✅' : '❌'}`);
  console.log(`   API Base: ${config.apiBaseUrl}`);
  console.log(`   Features:`, config.features);
};
