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

// ── 2. Master Equipment Catalog & Telemetry (OPERMAQ -> MINREPORT) ──────────────
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
        componentHealthAvg: z.record(z.string(), z.number()).optional()
    }).optional()
});

export type EquipmentMasterTelemetry = z.infer<typeof EquipmentMasterTelemetrySchema>;

// ── 3. Stockpile Cubication Survey (STOCKPILE -> MINREPORT) ───────────────────
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
    metadata: z.record(z.string(), z.unknown()).optional()
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
    payload: z.record(z.string(), z.unknown()),
    timestamp: z.string().datetime(),
    signature: z.string().optional()
});

export type SystemEvent = z.infer<typeof SystemEventSchema>;

// ── 6. OPERMAQ Fleet Ownership, Private Photos & PDF Quarantine Governance ────
export const FleetIdentifierTypeSchema = z.enum([
    'SERIAL_NUMBER',
    'LICENSE_PLATE',
    'VIN',
    'ASSET_TAG'
]);

export type FleetIdentifierType = z.infer<typeof FleetIdentifierTypeSchema>;

export const FleetOwnershipConditionSchema = z.enum([
    'PROPIO',
    'ARRENDADO',
    'CONTRATISTA',
    'COMODATO'
]);

export type FleetOwnershipCondition = z.infer<typeof FleetOwnershipConditionSchema>;

export const EquipmentAxisValueKindSchema = z.enum(['PHYSICAL_MAGNITUDE', 'CLOSED_ENUM']);

export type EquipmentAxisValueKind = z.infer<typeof EquipmentAxisValueKindSchema>;

export const EquipmentTypeAxisSchema = z.object({
    axis_key: z.string().trim().min(1).max(64),
    label_es: z.string().trim().min(1).max(64),
    unit_si: z.string().trim().min(1).max(64),
    value_kind: EquipmentAxisValueKindSchema,
    allowed_enum_values: z.array(z.string().trim().min(1)).optional(),
    search_keywords: z.array(z.string().trim().min(1)).min(1).max(16),
    mandatory: z.boolean().default(true),
    is_differentiator: z.boolean().default(false),
});

export type EquipmentTypeAxis = z.infer<typeof EquipmentTypeAxisSchema>;

export const EnergySourceCategorySchema = z.enum([
    'DIESEL',
    'GASOLINA',
    'ELECTRICO_RED_AC',
    'ELECTRICO_BATERIA_BEV',
    'HIBRIDO_DIESEL_ELECTRICO',
    'HIBRIDO_GASOLINA_ELECTRICO',
    'DUAL_FUEL_DIESEL_GAS',
    'GLP_GNV',
    'NEUMATICO_AIRE_COMPRIMIDO',
    'HIDRAULICO_AUXILIAR',
    'NO_DECLARADO',
]);

export type EnergySourceCategory = z.infer<typeof EnergySourceCategorySchema>;

export const EnergyConsumptionProfileSchema = z.object({
    energy_source: EnergySourceCategorySchema.default('NO_DECLARADO'),
    energy_spec_label: z.string().nullable().default(null),
    cost_driver_unit: z.enum(['L/h', 'km/L', 'L/100km', 'kWh/h', 'kWh/100km', 'L/s']).default('L/h'),
    hourly_consumption_by_load: z.object({
        idle_or_pto: z.string().nullable().default(null),
        low_load_25_35pct: z.string().nullable().default(null),
        medium_load_50_65pct: z.string().nullable().default(null),
        high_load_80_100pct: z.string().nullable().default(null),
    }),
    road_haul_efficiency: z.object({
        km_per_liter: z.string().nullable().default(null),
        liters_per_100km: z.string().nullable().default(null),
        kwh_per_100km: z.string().nullable().default(null),
    }),
    specific_consumption_bsfc_gkwh: z.string().nullable().default(null),
    pneumatic_or_hydraulic_flow: z.string().nullable().default(null),
    def_adblue_consumption: z.object({
        requires_def: z.boolean().default(false),
        consumption_pct_of_fuel: z.string().nullable().default(null),
        tank_capacity_liters: z.string().nullable().default(null),
    }),
    storage_and_autonomy: z.object({
        tank_or_battery_capacity: z.string().nullable().default(null),
        estimated_autonomy: z.string().nullable().default(null),
    }),
    source_url: z.string().nullable().default(null),
    updated_at: z.string(),
});

export type EnergyConsumptionProfile = z.infer<typeof EnergyConsumptionProfileSchema>;

export const GlobalEquipmentTypeSchema = z.object({
    type_key: z.string().trim().min(2).max(80),
    canonical_type_es: z.string().trim().min(2).max(96),
    categoria_equipo: z.string().trim().min(2).max(96),
    archetype_id: z.string().trim().optional(),
    type_aliases: z.array(z.string()).default([]),
    search_tokens: z.array(z.string()).default([]),
    spec_schema: z.array(EquipmentTypeAxisSchema).min(2).max(10),
    schema_version: z.number().int().positive().default(2),
    origin: z.enum(['SEEDED_ISO_BASE', 'AI_CURATED', 'AI_DISCOVERED', 'HUMAN_CURATED_HITL']),
    is_human_locked: z.boolean().default(false),
    usage_count: z.number().int().nonnegative().default(0),
    created_at: z.string(),
    updated_at: z.string(),
});

export type GlobalEquipmentType = z.infer<typeof GlobalEquipmentTypeSchema>;

export const CanonicalSpecSlotSchema = z.object({
    axis_key: z.string().trim().min(1),
    label_es: z.string().trim().min(1),
    value_si: z.string().trim().nullable(),
    unit_si: z.string().trim().optional(),
    mandatory: z.boolean().optional(),
    is_differentiator: z.boolean().optional(),
    value_kind: EquipmentAxisValueKindSchema.optional(),
    allowed_enum_values: z.array(z.string().trim().min(1)).optional(),
    source_url: z.string().trim().nullable().optional(),
    verbatim_evidence: z.string().trim().nullable().optional(),
});

export type CanonicalSpecSlot = z.infer<typeof CanonicalSpecSlotSchema>;

export const FleetUnitRegistrationSchema = z.object({
    global_asset_id: z.string().optional(),
    make_oficial: z.string().min(1, 'Marca oficial requerida'),
    model_oficial: z.string().min(1, 'Modelo oficial requerido'),
    categoria_equipo: z.string().optional(),
    tipo_equipo: z.string().optional(),
    equipment_type_key: z.string().optional(),
    archetype_id: z.string().optional(),
    canonical_specs: z.array(CanonicalSpecSlotSchema).optional(),
    energy_consumption_profile: EnergyConsumptionProfileSchema.optional(),
    ambiente_operativo: z.array(z.string()).optional(),
    contexto_operativo: z.array(z.string()).optional(),
    caracteristicas_principales: z.array(z.string()).optional(),
    chassis_versions: z.array(z.string()).optional(),
    version: z.string().default('ESTÁNDAR'),
    official_url: z.string().optional(),
    original_jargon: z.string().optional(),
    identifier_type: FleetIdentifierTypeSchema.default('SERIAL_NUMBER'),
    identifier_value: z.string().trim().min(2, 'Número de serie, patente o identificador único obligatorio').max(80),
    ownership_type: FleetOwnershipConditionSchema.default('PROPIO'),
    horometer: z.number().nonnegative().default(0),
    confirm_word: z.literal('ACTUALIZAR')
});

export type FleetUnitRegistration = z.infer<typeof FleetUnitRegistrationSchema>;

export const TenantPrivatePhotoSchema = z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    url: z.string().min(1),
    caption: z.string().max(160).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    uploadedAt: z.string(),
    uploadedBy: z.string().optional()
});

export type TenantPrivatePhoto = z.infer<typeof TenantPrivatePhotoSchema>;

export const KnowledgeContributionStatusSchema = z.enum([
    'PENDING_HUMAN_REVIEW',
    'AUTO_DEDUPLICATED_NO_DELTA',
    'APPROVED',
    'REJECTED'
]);

export type KnowledgeContributionStatus = z.infer<typeof KnowledgeContributionStatusSchema>;

// ── 7. Universal Media Digestor & Content-Addressable Storage (CAS v4.0) ──────
export * from './media.contracts';
