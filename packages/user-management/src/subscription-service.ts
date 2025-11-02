// MINREPORT - Subscription Management Service

import { 
  Subscription, 
  SubscriptionPlan, 
  SubscriptionStatus,
  SUBSCRIPTION_LIMITS,
} from '@minreport/core';

export interface SubscriptionService {
  // Subscription management
  createSubscription(userId: string, plan: SubscriptionPlan): Promise<Subscription>;
  getSubscription(subscriptionId: string): Promise<Subscription | null>;
  getUserSubscription(userId: string): Promise<Subscription | null>;
  updateSubscription(subscriptionId: string, updates: Partial<Subscription>): Promise<Subscription>;
  cancelSubscription(subscriptionId: string, cancelAtPeriodEnd: boolean): Promise<Subscription>;
  
  // Plan management
  changePlan(subscriptionId: string, newPlan: SubscriptionPlan): Promise<Subscription>;
  
  // Usage tracking
  checkUsage(userId: string, resource: keyof typeof SUBSCRIPTION_LIMITS.free): Promise<{
    current: number;
    limit: number;
    canProceed: boolean;
  }>;
  
  // Feature access
  hasFeatureAccess(userId: string, feature: string): Promise<boolean>;
}

export class MockSubscriptionService implements SubscriptionService {
  private subscriptions: Map<string, Subscription> = new Map();
  private usage: Map<string, Record<string, number>> = new Map();

  async createSubscription(userId: string, plan: SubscriptionPlan): Promise<Subscription> {
    const subscription: Subscription = {
      id: `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      plan,
      status: 'active',
      limits: SUBSCRIPTION_LIMITS[plan],
      createdAt: new Date(),
      updatedAt: new Date(),
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      cancelAtPeriodEnd: false,
    };

    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  async getSubscription(subscriptionId: string): Promise<Subscription | null> {
    return this.subscriptions.get(subscriptionId) || null;
  }

  async getUserSubscription(userId: string): Promise<Subscription | null> {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.userId === userId) {
        return subscription;
      }
    }
    return null;
  }

  async updateSubscription(subscriptionId: string, updates: Partial<Subscription>): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    const updated = { 
      ...subscription, 
      ...updates, 
      updatedAt: new Date() 
    };
    
    this.subscriptions.set(subscriptionId, updated);
    return updated;
  }

  async cancelSubscription(subscriptionId: string, cancelAtPeriodEnd: boolean): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    subscription.cancelAtPeriodEnd = cancelAtPeriodEnd;
    subscription.status = cancelAtPeriodEnd ? 'active' : 'canceled';
    subscription.updatedAt = new Date();

    this.subscriptions.set(subscriptionId, subscription);
    return subscription;
  }

  async changePlan(subscriptionId: string, newPlan: SubscriptionPlan): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    subscription.plan = newPlan;
    subscription.limits = SUBSCRIPTION_LIMITS[newPlan];
    subscription.updatedAt = new Date();

    this.subscriptions.set(subscriptionId, subscription);
    return subscription;
  }

  async checkUsage(userId: string, resource: keyof typeof SUBSCRIPTION_LIMITS.free): Promise<{
    current: number;
    limit: number;
    canProceed: boolean;
  }> {
    const subscription = await this.getUserSubscription(userId);
    if (!subscription) {
      throw new Error('User has no subscription');
    }

    const userUsage = this.usage.get(userId) || {};
    const current = userUsage[resource as string] || 0;
    const limit = subscription.limits[resource] as number;

    return {
      current,
      limit,
      canProceed: limit === -1 || current < limit, // -1 means unlimited
    };
  }

  async hasFeatureAccess(userId: string, feature: string): Promise<boolean> {
    const subscription = await this.getUserSubscription(userId);
    if (!subscription) {
      return false;
    }

    const limits = subscription.limits as any;
    return limits[feature] === true;
  }
}

// Export singleton instance for development
export const subscriptionService = new MockSubscriptionService();