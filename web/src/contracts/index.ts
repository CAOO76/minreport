/**
 * MINREPORT SHARED CONTRACTS (Web 3.0 Hybrid Architecture)
 * Canonical Zod schemas for multi-tenant data federation and knowledge network ingestion.
 * Strict ISO 9241-300 / WCAG 2.2 AAA ergonomics & zero hallucination.
 */
import { z } from 'zod';

// ── 1. Tenant & Security Context ──────────────────────────────────────────────
export const TenantContextSchema = z.object({
    tenantId: z.string().min(1, 'tenantId es obligatorio'),
    tenantName: z.string().optional().default('Faena Principal'),
    userId: z.string().min(1, 'userId es obligatorio'),
    userRole: z.enum(['OWNER', 'ADMIN', 'SUPERVISOR', 'OPERATOR', 'VIEWER', 'STUDENT']).default('OPERATOR'),
    classification: z.enum(['b2b', 'edu', 'personal']).default('b2b'),
    isEduSandbox: z.boolean().default(false),
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

// ── 4. Universal Event Ledger (Audit & Cross-Operational Integration) ─────────
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
