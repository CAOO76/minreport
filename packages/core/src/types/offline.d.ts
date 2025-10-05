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
export declare const DEFAULT_OFFLINE_CONFIG: OfflineConfig;
export declare class OfflineError extends Error {
    code: string;
    actionId?: string | undefined;
    constructor(message: string, code: string, actionId?: string | undefined);
}
export declare class SyncConflictError extends OfflineError {
    serverData: any;
    clientData: any;
    constructor(message: string, serverData: any, clientData: any, actionId?: string);
}
export declare function generateActionId(): string;
export declare function isOfflineCapable(plan: string): boolean;
export declare function shouldRetry(action: OfflineAction, config: OfflineConfig): boolean;
