// MINREPORT - Offline Core Types and Utilities

export type SyncStatus = 'synced' | 'pending' | 'error' | 'conflict';

export interface OfflineAction {
  id: string;
  type: string;
  payload: any;
  timestamp: number;
  userId: string;
  status: SyncStatus;
  retryCount: number;
  error?: string;
}

export interface OfflineData {
  id: string;
  collection: string;
  documentId: string;
  data: any;
  lastModified: number;
  version: number;
  status: SyncStatus;
  conflicts?: any[];
}

export interface SyncResult {
  success: boolean;
  actionId: string;
  error?: string;
  conflictResolution?: 'server_wins' | 'client_wins' | 'merge';
}

export interface OfflineConfig {
  maxRetries: number;
  retryDelay: number;
  syncInterval: number;
  cacheSize: number;
  enableBackgroundSync: boolean;
}

export const DEFAULT_OFFLINE_CONFIG: OfflineConfig = {
  maxRetries: 3,
  retryDelay: 1000, // 1 second
  syncInterval: 30000, // 30 seconds
  cacheSize: 100, // MB
  enableBackgroundSync: true,
};

// Offline-specific error types
export class OfflineError extends Error {
  public code: string;
  public actionId?: string;

  constructor(
    message: string,
    code: string,
    actionId?: string
  ) {
    super(message);
    this.name = 'OfflineError';
    this.code = code;
    this.actionId = actionId;
  }
}

export class SyncConflictError extends OfflineError {
  public serverData: any;
  public clientData: any;

  constructor(
    message: string,
    serverData: any,
    clientData: any,
    actionId?: string
  ) {
    super(message, 'SYNC_CONFLICT', actionId);
    this.name = 'SyncConflictError';
    this.serverData = serverData;
    this.clientData = clientData;
  }
}

// Utility functions for offline operations
export function generateActionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function isOfflineCapable(plan: string): boolean {
  return ['basic', 'premium', 'enterprise'].includes(plan);
}

export function shouldRetry(action: OfflineAction, config: OfflineConfig): boolean {
  return action.retryCount < config.maxRetries && action.status === 'error';
}