export type UserRole = 'SUPER_ADMIN' | 'USER';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export interface UserEntitlements {
    pluginsEnabled: string[];
    storageLimit: number; // in bytes or MB
}

export interface UserStats {
    lastLogin: string; // ISO string or Firestore Timestamp
    storageUsed: number; // in bytes or MB
}

export interface UserProfile {
    uid: string;
    email: string;
    displayName: string;
    role: UserRole;
    status: UserStatus;
    entitlements: UserEntitlements;
    stats: UserStats;
    is_setup_completed?: boolean;
    createdAt?: any;
    updatedAt?: any;
}

export interface AdminAuditLog {
    timestamp: any;
    adminUid: string;
    action: string;
    targetUid: string;
    details: string;
}
