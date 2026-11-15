
export type UserSystemRole = 'DEV_ROOT' | 'SUPER_ADMIN' | 'TEST_PILOT' | 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'PROFESSOR' | 'STUDENT';

export type UserRole = UserSystemRole | 'SUPERVISOR' | 'INTERNAL_USER' | 'BILLING_ONLY' | 'SUBSCRIPTION_ADMIN' | 'GENERAL_ADMIN';

export type AccountClassification = 'dev' | 'admin' | 'dev-root' | 'b2b' | 'b2b-corporate' | 'edu' | 'edu-academic' | 'test-pilot';

export type AccountType = 'PERSONAL' | 'BUSINESS' | 'EDUCATIONAL' | 'ENTERPRISE';

export interface Membership {
    accountId: string;
    role: UserRole;
    companyName?: string;
    accountName?: string;
    type?: AccountType | string;
    status?: string;
    allowedModules?: {
        opermaq?: boolean;
        stockpile?: boolean;
    };
    jobTitle?: string;
    countryCode?: string;
    joinedAt?: number; // timestamp
    jobProfileId?: string;
}

export interface UserProfile {
    uid: string;
    email: string;
    fullName?: string;
    displayName?: string;
    photoURL?: string;
    role?: UserRole;
    classification?: AccountClassification;
    countryCode?: string;
    status?: string;
    // Array of accounts this user belongs to
    memberships: Membership[];
    // Track current active account in UI
    lastActiveAccountId?: string;
    primaryAccountId?: string;
    entitlements?: {
        pluginsEnabled: string[];
    };
    createdAt: number;
    updatedAt: number;
}

export interface Account {
    id: string; // matches accountId in Membership
    name: string; // Company Name or Institution Name
    type: AccountType;
    status?: string;
    country?: string;
    countryCode?: string;
    taxId?: string; // Tax ID, unique per account
    ownerId: string; // User UID who owns this account
    subscriptionPlan?: string;
    isEduSandbox?: boolean;
    entitlements?: {
        basePackage?: string;
        maxProjects?: number | null;
        addonModules?: {
            opermaq?: { active: boolean };
            stockpile?: { active: boolean };
            [key: string]: { active: boolean } | undefined;
        };
    };
    contract?: {
        plan?: string;
        status?: string;
        activeModules?: {
            opermaq?: boolean;
            stockpile?: boolean;
            [key: string]: boolean | undefined;
        };
    };
    modules?: {
        opermaq?: boolean;
        stockpile?: boolean;
        [key: string]: boolean | undefined;
    };
    ley19628Consent?: {
        acceptedAt: string;
        legalMandate: string;
        ipAddress?: string;
    };
    primaryOperator?: {
        name: string;
        email: string;
        taxId?: string;
        jobTitle?: string;
        uid?: string;
        status: 'ACTIVE' | 'PENDING';
        invitedAt?: number;
    };
    createdAt: number;
    updatedAt: number;
    classification?: AccountClassification;
    licensing?: {
        maxUsers: number;
        allowInternalUsers: boolean;
        isCommercial: boolean;
        watermarkRequired: boolean;
    };
    enabledPlugins?: string[];
}
