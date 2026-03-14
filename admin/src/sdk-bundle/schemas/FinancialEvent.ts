import { z } from 'zod';

/**
 * Global Ledger Contract
 * Esquema estricto e inmutable para eventos financieros emitidos por los plugins.
 */
export const FinancialEventSchema = z.object({
    pluginId: z.string().min(3),
    type: z.enum(['EXPENSE', 'REVENUE', 'ASSET_VALUATION', 'OPERATIONAL_METRIC']),
    amount: z.number(),
    currency: z.string().default('USD'),
    category: z.string(),
    timestamp: z.string().datetime(),
    metadata: z.record(z.any()).optional()
});

export type FinancialEvent = z.infer<typeof FinancialEventSchema>;
