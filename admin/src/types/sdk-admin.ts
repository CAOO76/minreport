import { Timestamp } from 'firebase/firestore';

export type SDKStatus = 'STABLE' | 'BETA' | 'DEPRECATED';

/**
 * Interface representing an SDK Version record in Firestore.
 */
export interface SDKVersion {
    id: string;
    versionNumber: string; // e.g., '1.0.2'
    releaseDate: Timestamp;
    changelog: string;
    downloadUrl: string;
    createdBy: string; // User UID
    status: SDKStatus;
}

/**
 * Data needed to publish a new SDK version.
 */
export type NewSDKVersion = Omit<SDKVersion, 'id'>;
