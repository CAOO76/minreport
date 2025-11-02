/**
 * Unified Environment Configuration
 * Manages development and production environments with single source of truth
 */

export type Environment = 'development' | 'production' | 'staging';

export interface EnvironmentConfig {
  // Environment
  env: Environment;
  isDev: boolean;
  isProd: boolean;
  
  // Firebase
  firebase: {
    projectId: string;
    apiKey: string;
    authDomain: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId?: string;
  };
  
  // App URLs
  urls: {
    clientApp: string;
    adminApp: string;
    publicSite: string;
    api: string;
  };
  
  // Feature flags
  features: {
    offlineSupport: boolean;
    syncInBackground: boolean;
    localCaching: boolean;
    dataEncryption: boolean;
  };
  
  // Offline configuration
  offline: {
    enableIndexedDB: boolean;
    enableServiceWorker: boolean;
    enableBackgroundSync: boolean;
    syncIntervalMs: number;
    maxOfflineStorageMB: number;
  };
  
  // Logging
  logging: {
    enabled: boolean;
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

// Development configuration
const developmentConfig: EnvironmentConfig = {
  env: 'development',
  isDev: true,
  isProd: false,
  
  firebase: {
    projectId: 'minreport-8f2a8',
    apiKey: 'AIzaSyBGXsX6YZE7QX5q5qF2N7pZqPq5qPq5qPq',
    authDomain: 'minreport-8f2a8.firebaseapp.com',
    storageBucket: 'minreport-8f2a8.appspot.com',
    messagingSenderId: '123456789',
    appId: '1:123456789:web:abcdef123456',
  },
  
  urls: {
    clientApp: 'http://localhost:5173',
    adminApp: 'http://localhost:5174',
    publicSite: 'http://localhost:5175',
    api: 'http://localhost:5000',
  },
  
  features: {
    offlineSupport: true,
    syncInBackground: true,
    localCaching: true,
    dataEncryption: false, // Not needed in dev
  },
  
  offline: {
    enableIndexedDB: true,
    enableServiceWorker: true,
    enableBackgroundSync: true,
    syncIntervalMs: 5000, // Sync every 5 seconds in dev
    maxOfflineStorageMB: 50,
  },
  
  logging: {
    enabled: true,
    level: 'debug',
  },
};

// Production configuration
const productionConfig: EnvironmentConfig = {
  env: 'production',
  isDev: false,
  isProd: true,
  
  firebase: {
    projectId: 'minreport-8f2a8',
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: 'minreport.com',
    storageBucket: 'minreport-8f2a8.appspot.com',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
  },
  
  urls: {
    clientApp: 'https://minreport.com',
    adminApp: 'https://admin.minreport.com',
    publicSite: 'https://minreport.com',
    api: 'https://api.minreport.com',
  },
  
  features: {
    offlineSupport: true,
    syncInBackground: true,
    localCaching: true,
    dataEncryption: true,
  },
  
  offline: {
    enableIndexedDB: true,
    enableServiceWorker: true,
    enableBackgroundSync: true,
    syncIntervalMs: 30000, // Sync every 30 seconds in prod
    maxOfflineStorageMB: 200,
  },
  
  logging: {
    enabled: false,
    level: 'error',
  },
};

// Staging configuration
const stagingConfig: EnvironmentConfig = {
  ...productionConfig,
  env: 'staging',
  urls: {
    ...productionConfig.urls,
    clientApp: 'https://staging.minreport.com',
    adminApp: 'https://staging-admin.minreport.com',
  },
  logging: {
    enabled: true,
    level: 'info',
  },
};

/**
 * Get configuration based on environment
 */
export function getEnvironmentConfig(): EnvironmentConfig {
  const env = (typeof process !== 'undefined' && process.env.NODE_ENV) || 'development';
  
  switch (env) {
    case 'production':
      return productionConfig;
    case 'staging':
      return stagingConfig;
    case 'development':
    default:
      return developmentConfig;
  }
}

// Export singleton
export const config = getEnvironmentConfig();
