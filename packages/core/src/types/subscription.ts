// MINREPORT - Core Subscription Types

export type SubscriptionPlan = 'free' | 'basic' | 'premium' | 'enterprise';

export type SubscriptionStatus = 
  | 'active' 
  | 'inactive' 
  | 'canceled' 
  | 'past_due' 
  | 'unpaid' 
  | 'trialing';

export interface SubscriptionLimits {
  maxProjects: number;
  maxUsers: number;
  maxStorageGB: number;
  maxReportsPerMonth: number;
  offlineCapabilities: boolean;
  advancedAnalytics: boolean;
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

// Plan Configurations
export const SUBSCRIPTION_LIMITS: Record<SubscriptionPlan, SubscriptionLimits> = {
  free: {
    maxProjects: 1,
    maxUsers: 1,
    maxStorageGB: 1,
    maxReportsPerMonth: 10,
    offlineCapabilities: false,
    advancedAnalytics: false,
    prioritySupport: false,
  },
  basic: {
    maxProjects: 5,
    maxUsers: 5,
    maxStorageGB: 10,
    maxReportsPerMonth: 100,
    offlineCapabilities: true,
    advancedAnalytics: false,
    prioritySupport: false,
  },
  premium: {
    maxProjects: 25,
    maxUsers: 25,
    maxStorageGB: 100,
    maxReportsPerMonth: 1000,
    offlineCapabilities: true,
    advancedAnalytics: true,
    prioritySupport: false,
  },
  enterprise: {
    maxProjects: -1, // unlimited
    maxUsers: -1, // unlimited
    maxStorageGB: 1000,
    maxReportsPerMonth: -1, // unlimited
    offlineCapabilities: true,
    advancedAnalytics: true,
    prioritySupport: true,
  },
};