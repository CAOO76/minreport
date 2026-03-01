
export type UserRole = 'OWNER' | 'ADMIN' | 'BILLING_ONLY' | 'OPERATOR' | 'SUBSCRIPTION_ADMIN' | 'GENERAL_ADMIN' | 'INTERNAL_USER';

export type AccountType = 'PERSONAL' | 'BUSINESS' | 'EDUCATIONAL' | 'ENTERPRISE';

export interface Membership {
    accountId: string;
    role: UserRole;
    companyName: string;
    joinedAt?: number; // timestamp
    jobProfileId?: string; // [NEW] Referencia al perfil de cargo asignado
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
    taxId?: string; // Tax ID, unique per account
    ownerId: string; // User UID who owns this account
    primaryOperator?: {
        name: string;
        email: string;
        taxId?: string; // ID used for authentication (RUT/RUN)
        jobTitle?: string;
        uid?: string;
        status: 'ACTIVE' | 'PENDING';
        invitedAt?: number; // Added for traceability
    };
    createdAt: number;
    updatedAt: number;
    enabledPlugins?: string[]; // [NEW] Definitive Plugin Management
}
