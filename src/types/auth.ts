
export type UserRole = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

export type AccountType = 'PERSONAL' | 'BUSINESS' | 'EDUCATIONAL';

export interface Membership {
    accountId: string;
    role: UserRole;
    companyName: string;
    joinedAt?: number; // timestamp
}

export interface UserProfile {
    uid: string;
    email: string;
    displayName?: string;
    photoURL?: string;
    // Array of accounts this user belongs to
    memberships: Membership[];
    // Track current active account in UI (optional, helpful for session persistence)
    lastActiveAccountId?: string;
    entitlements?: {
        pluginsEnabled: string[];
    };
    createdAt: number;
    updatedAt: number;
}

export interface Account {
    id: string; // matches accountId in Membership
    name: string; // Company Name or Personal Name
    type: AccountType;
    rut?: string; // Tax ID, unique per account
    ownerId: string; // User UID who owns this account
    createdAt: number;
    updatedAt: number;
}
