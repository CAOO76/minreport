/**
 * MINREPORT SHARED CONTRACTS (Web 3.0 Hybrid Architecture)
 * Canonical Zod schemas for multi-tenant data federation, 5-tier account governance,
 * and knowledge network ingestion.
 * Strict ISO 9241-300 / WCAG 2.2 AAA ergonomics & zero hallucination.
 */
import { z } from 'zod';

// ── 0. Sovereign 5-Tier Account & Role Taxonomy ───────────────────────────────
// 1º DEV | 2º ADMIN | 3º TEST-PILOT | 4º CLIENTES B2B | 5º EDU
export const AccountClassificationSchema = z.enum([
    'dev',
    'admin',
    'test-pilot',
    'b2b',
    'edu',
    'personal'
]);

export type AccountClassification = z.infer<typeof AccountClassificationSchema>;

export const SystemRoleSchema = z.enum([
    'DEV_ROOT',
    'SUPER_ADMIN',
    'TEST_PILOT',
    'PILOT_LEAD',
    'OWNER',
    'ADMIN',
    'SUPERVISOR',
    'OPERATOR',
    'VIEWER',
    'STUDENT',
    'BILLING_ONLY'
]);

export type SystemRole = z.infer<typeof SystemRoleSchema>;

// ── 1. Tenant & Security Context ──────────────────────────────────────────────
export const TenantContextSchema = z.object({
    tenantId: z.string().min(1, 'tenantId es obligatorio'),
    tenantName: z.string().optional().default('Faena Principal'),
    userId: z.string().min(1, 'userId es obligatorio'),
    userRole: SystemRoleSchema.default('OPERATOR'),
    classification: AccountClassificationSchema.default('b2b'),
    accountTier: z.union([
        z.literal(1), // 1º DEV
        z.literal(2), // 2º ADMIN
        z.literal(3), // 3º TEST-PILOT
        z.literal(4), // 4º CLIENTES B2B
        z.literal(5)  // 5º EDU
    ]).default(4),
    isEduSandbox: z.boolean().default(false),
    isTestPilot: z.boolean().default(false),
    timestamp: z.string().datetime({ message: 'Timestamp debe cumplir ISO 8601' })
});

export type TenantContext = z.infer<typeof TenantContextSchema>;

// ── 2. Master Equipment Catalog & Telemetry (OPERMAQ ➔ MINREPORT) ──────────────
export const EquipmentMasterTelemetrySchema = z.object({
    assetId: z.string().min(1),
    code: z.string().min(1),
    type: z.string().min(1),
    model: z.string().min(1),
    horometer: z.number().nonnegative(),
    healthScore: z.number().min(0).max(100),
    status: z.enum(['OPERATIVO', 'MANTENCION', 'FUERA_SERVICIO']),
    lastInspection: z.string().datetime().optional(),
    operator: z.string().optional(),
    anonymizedCatalogData: z.object({
        manufacturer: z.string().optional(),
        modelFamily: z.string().optional(),
        operatingHoursInterval: z.number().optional(),
        componentHealthAvg: z.record(z.number()).optional()
    }).optional()
});

export type EquipmentMasterTelemetry = z.infer<typeof EquipmentMasterTelemetrySchema>;

// ── 3. Stockpile Cubication Survey (STOCKPILE ➔ MINREPORT) ───────────────────
export const StockpileSurveyTelemetrySchema = z.object({
    surveyId: z.string().min(1),
    tag: z.string().min(1),
    material: z.string().min(1),
    shape: z.enum(['elliptic-cone', 'truncated-elliptic-cone', 'perimeter-cone']),
    volumeM3: z.number().positive(),
    density: z.number().positive(),
    tonnage: z.number().positive(),
    confidence: z.number().min(0).max(100),
    surveyDate: z.string().datetime(),
    metadata: z.record(z.unknown()).optional()
});

export type StockpileSurveyTelemetry = z.infer<typeof StockpileSurveyTelemetrySchema>;

// ── 4. Test-Pilot Review, Comment & AI Training Schema (3º TEST-PILOT) ────────
export const PilotFeedbackSchema = z.object({
    feedbackId: z.string().optional(),
    tenantId: z.string().min(1),
    authorUid: z.string().min(1),
    authorEmail: z.string().email(),
    authorName: z.string().min(1),
    module: z.enum(['core', 'opermaq', 'stockpile']),
    executionMode: z.enum(['integrated', 'standalone']).default('integrated'),
    category: z.enum(['AI_KNOWLEDGE_TRAINING', 'CHANGE_REQUEST', 'BUG_CORRECTION', 'FIELD_SIMULATION']),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
    contextPath: z.string().default('/'),
    assetOrSurveyId: z.string().optional(),
    observation: z.string().min(3, 'La observación técnica debe tener al menos 3 caracteres'),
    expectedAiBehavior: z.string().optional(),
    status: z.enum(['OPEN', 'IN_REVIEW', 'APPLIED_TO_AI', 'RESOLVED']).default('OPEN'),
    timestamp: z.string().datetime()
});

export type PilotFeedback = z.infer<typeof PilotFeedbackSchema>;

// ── 5. Universal Event Ledger (Audit & Cross-Operational Integration) ─────────
export const SystemEventSchema = z.object({
    eventId: z.string().uuid(),
    tenantId: z.string().min(1),
    sourceApp: z.enum(['opermaq', 'stockpile-control', 'minreport-core']),
    eventType: z.string().min(1),
    payload: z.record(z.unknown()),
    timestamp: z.string().datetime(),
    signature: z.string().optional()
});

export type SystemEvent = z.infer<typeof SystemEventSchema>;
