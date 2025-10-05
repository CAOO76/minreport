export type SubscriptionPlan = 'free' | 'basic' | 'premium' | 'enterprise';
export type SubscriptionStatus = 'active' | 'inactive' | 'canceled' | 'past_due' | 'unpaid' | 'trialing';
export interface SubscriptionLimits {
    maxProjects: number;
    maxUsers: number;
    maxStorageGB: number;
    maxReportsPerMonth: number;
    offlineCapabilities: boolean;
    advancedAnalytics: boolean;
    customPlugins: boolean;
    prioritySupport: boolean;
}
export interface Subscription {
    id: string;
    userId: string;
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    limits: SubscriptionLimits;
    createdAt: Date;
    updatedAt: Date;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    trialEnd?: Date;
    cancelAtPeriodEnd: boolean;
}
export interface PaymentMethod {
    id: string;
    userId: string;
    type: 'card' | 'bank_transfer' | 'digital_wallet';
    last4?: string;
    brand?: string;
    expiryMonth?: number;
    expiryYear?: number;
    isDefault: boolean;
}
export interface Invoice {
    id: string;
    subscriptionId: string;
    amount: number;
    currency: string;
    status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
    dueDate: Date;
    paidAt?: Date;
    createdAt: Date;
}
export declare const SUBSCRIPTION_LIMITS: Record<SubscriptionPlan, SubscriptionLimits>;
