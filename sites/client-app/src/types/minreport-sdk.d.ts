declare module '@minreport/sdk' {
  export type OfflineAction = {
    type: string;
    payload: unknown;
    timestamp: number;
  };
  class OfflineQueue {
    private queue: OfflineAction[];
    private isOnline: boolean;
    constructor();
    enqueue(action: OfflineAction): void;
    sync(): Promise<void>;
    persist(): void;
    restore(): void;
  }
  export const offlineQueue: OfflineQueue;
}
