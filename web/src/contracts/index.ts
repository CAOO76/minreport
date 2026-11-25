/**
 * MINREPORT SHARED CONTRACTS (Web 3.0 Hybrid Architecture)
 * Canonical Zod schemas for multi-tenant data federation, 5-tier account governance,
 * and knowledge network ingestion.
 * Strict ISO 9241-300 / WCAG 2.2 AAA ergonomics & zero hallucination.
 */
import { z } from 'zod';
import {
    MemberNotificationPreferencesSchema,
    SupplyMemberProfileSchema,
} from './supply.contracts';

// ── 0. Sovereign 5-Tier Account & Role Taxonomy ───────────────────────────────
// 1º DEV | 2º ADMIN | 3º TEST-PILOT | 4º CLIENTES B2B | 5º EDU
export const AccountClassificationSchema = z.enum([
    'dev',
    'admin',
    'test-pilot',
    'b2b',
    'edu',
]);

export type AccountClassification = z.infer<typeof AccountClassificationSchema>;

export const SystemRoleSchema = z.enum([
    'DEV_ROOT',
    'SUPER_ADMIN',
    'TEST_PILOT',
    'OWNER',
    'ADMIN',
    'OPERATOR',
    'VIEWER',
    'PROFESSOR',
    'STUDENT',
]);

export type SystemRole = z.infer<typeof SystemRoleSchema>;

export const AccountTierSchema = z.union([
    z.literal(1), // 1º DEV
    z.literal(2), // 2º ADMIN
    z.literal(3), // 3º TEST-PILOT
    z.literal(4), // 4º CLIENTES B2B
    z.literal(5), // 5º EDU
]);

export type AccountTier = z.infer<typeof AccountTierSchema>;

/**
 * Sesión Unificada Canónica MINREPORT (Core + Módulos Integrados).
 */
export const UnifiedUserSessionSchema = z.object({
    uid: z.string().min(1),
    email: z.string().email().or(z.literal('')),
    displayName: z.string().min(1),
    tenantId: z.string(),
    tenantName: z.string().min(1),
    countryCode: z.string().min(2).max(4).default('CL'),
    role: SystemRoleSchema,
    classification: AccountClassificationSchema,
    accountTier: AccountTierSchema,
    isDevRoot: z.boolean(),
    isSuperAdmin: z.boolean(),
    isTestPilot: z.boolean(),
    isEduSandbox: z.boolean(),
    isMfaVerified: z.boolean(),
    activeModules: z.object({
        opermaq: z.boolean(),
        stockpile: z.boolean(),
        supply: z.boolean().default(false),
    }),
});

export type UnifiedUserSession = z.infer<typeof UnifiedUserSessionSchema>;

/**
 * Despachador determinista por nivel soberano (accountTier 1..5).
 */
export function resolveSessionHomePath(
    session?: Pick<UnifiedUserSession, 'accountTier' | 'isDevRoot' | 'isSuperAdmin' | 'isTestPilot'> | null
): '/access' | '/dev' | '/admin' | '/pilot' | '/dashboard' {
    if (!session) return '/access';
    if (session.isDevRoot || session.accountTier === 1) return '/dev';
    if (session.isSuperAdmin || session.accountTier === 2) return '/admin';
    if (session.isTestPilot || session.accountTier === 3) return '/pilot';
    return '/dashboard';
}

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
        z.literal(5), // 5º EDU
    ]).default(4),
    isEduSandbox: z.boolean().default(false),
    isTestPilot: z.boolean().default(false),
    timestamp: z.string().datetime({ message: 'Timestamp debe cumplir ISO 8601' }),
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
    anonymizedCatalogData: z
        .object({
            manufacturer: z.string().optional(),
            modelFamily: z.string().optional(),
            operatingHoursInterval: z.number().optional(),
            componentHealthAvg: z.record(z.string(), z.number()).optional(),
        })
        .optional(),
});

export type EquipmentMasterTelemetry = z.infer<typeof EquipmentMasterTelemetrySchema>;

// ── 3. Stockpile Cubication Survey (STOCKPILE -> MINREPORT) ───────────────────
export const StockpileSurveyTelemetrySchema = z.object({
    surveyId: z.string().min(1),
    tag: z.string().min(1),
    material: z.string().min(1),
    shape: z.enum(['elliptic-cone', 'truncated-elliptic-cone', 'perimeter-cone', 'windrow', 'toe-wall']),
    volumeM3: z.number().positive(),
    density: z.number().positive(),
    tonnage: z.number().positive(),
    confidence: z.number().min(0).max(100),
    surveyDate: z.string().datetime(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export type StockpileSurveyTelemetry = z.infer<typeof StockpileSurveyTelemetrySchema>;

// ── 4. Test-Pilot Review, Comment & AI Training Schema (3º TEST-PILOT) ────────
export const PilotFeedbackSchema = z.object({
    feedbackId: z.string().optional(),
    tenantId: z.string().min(1),
    authorUid: z.string().min(1),
    authorEmail: z.string().email(),
    authorName: z.string().min(1),
    module: z.enum(['core', 'opermaq', 'stockpile', 'supply']),
    executionMode: z.enum(['integrated', 'standalone']).default('integrated'),
    category: z.enum(['AI_KNOWLEDGE_TRAINING', 'CHANGE_REQUEST', 'BUG_CORRECTION', 'FIELD_SIMULATION']),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
    contextPath: z.string().default('/'),
    assetOrSurveyId: z.string().optional(),
    observation: z.string().min(3, 'La observación técnica debe tener al menos 3 caracteres'),
    expectedAiBehavior: z.string().optional(),
    status: z.enum(['OPEN', 'IN_REVIEW', 'APPLIED_TO_AI', 'RESOLVED']).default('OPEN'),
    timestamp: z.string().datetime(),
});

export type PilotFeedback = z.infer<typeof PilotFeedbackSchema>;

// ── 5. Universal Event Ledger (Audit & Cross-Operational Integration) ─────────
export const SystemEventSchema = z.object({
    eventId: z.string().uuid(),
    tenantId: z.string().min(1),
    sourceApp: z.enum(['opermaq', 'stockpile-control', 'supply', 'minreport-core']),
    eventType: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
    timestamp: z.string().datetime(),
    signature: z.string().optional(),
});

export type SystemEvent = z.infer<typeof SystemEventSchema>;

// ── 6. OPERMAQ v3.0 Universal Ontology, Cost Matrix & Fleet Governance ────────
export * from './opermaq.contracts';

// ── 7. Universal Media Digestor & Content-Addressable Storage (CAS v4.0) ──────
// Reexporta MediaDigestionProfileSchema, DigestedMediaDescriptorSchema, TenantLogoDescriptorSchema y sus tipos
export * from './media.contracts';

// ── 8. Sovereign Geospatial Core Contracts (Bloque 3.2) ──────────────────────
export * from './geo.contracts';

// ── 8b. MINREPORT · ABASTECIMIENTO Contracts (Módulo Nativo `supply`) ────────
export * from './supply.contracts';

// ── 8c. MINREPORT · ACOPIOS V2 Offline-First Capture Contracts ─────────────────
export * from './acopios.contracts';

// ── 8. B2B Team Seats & Equipment Onboarding Contracts (Bloque 2.2) ─────────
export const B2BSeatRoleSchema = z.enum(['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']);
export type B2BSeatRole = z.infer<typeof B2BSeatRoleSchema>;

export const B2BMemberAllowedModulesSchema = z.object({
    opermaq: z.boolean().default(true),
    stockpile: z.boolean().default(false),
    supply: z.boolean().default(false),
});
export type B2BMemberAllowedModules = z.infer<typeof B2BMemberAllowedModulesSchema>;

export const UpsertB2BMemberPayloadSchema = z.object({
    accountId: z.string().min(1).max(128),
    accountName: z.string().min(1).max(180),
    email: z.string().trim().email().max(254),
    displayName: z.string().trim().min(2).max(140),
    taxId: z.string().trim().max(32).optional().or(z.literal('')),
    countryCode: z.string().trim().toUpperCase().min(2).max(4).default('CL'),
    role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']).default('OPERATOR'),
    jobTitle: z.string().trim().max(100).optional().or(z.literal('')),
    allowedModules: B2BMemberAllowedModulesSchema.default({
        opermaq: true,
        stockpile: false,
        supply: false,
    }),
    canViewBilling: z.boolean().default(false),
    phoneE164: z.string().trim().max(24).nullable().optional().or(z.literal('')),
    whatsappOptInAt: z.union([z.number(), z.string().trim().max(64)]).nullable().optional(),
    supplyProfile: SupplyMemberProfileSchema.nullable().optional(),
    notificationPreferences: MemberNotificationPreferencesSchema.nullable().optional(),
});
export type UpsertB2BMemberPayload = z.infer<typeof UpsertB2BMemberPayloadSchema>;

export const UpdateB2BMemberPayloadSchema = z.object({
    accountId: z.string().min(1).max(128),
    confirmationKeyword: z.literal('ACTUALIZAR'),
    role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']).optional(),
    jobTitle: z.string().trim().max(100).optional(),
    allowedModules: B2BMemberAllowedModulesSchema.optional(),
    canViewBilling: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    phoneE164: z.string().trim().max(24).nullable().optional().or(z.literal('')),
    whatsappOptInAt: z.union([z.number(), z.string().trim().max(64)]).nullable().optional(),
    supplyProfile: SupplyMemberProfileSchema.nullable().optional(),
    notificationPreferences: MemberNotificationPreferencesSchema.nullable().optional(),
});
export type UpdateB2BMemberPayload = z.infer<typeof UpdateB2BMemberPayloadSchema>;

export const RemoveB2BMemberPayloadSchema = z.object({
    accountId: z.string().min(1).max(128),
    confirmationKeyword: z.literal('ACTUALIZAR'),
});
export type RemoveB2BMemberPayload = z.infer<typeof RemoveB2BMemberPayloadSchema>;

export const EquipmentOnboardingResourceKindSchema = z.enum([
    'UNIT_PHOTO',
    'NAMEPLATE_PHOTO',
    'TECHNICAL_MANUAL_PDF',
    'DATASHEET_PDF',
    'DIAGRAM_IMAGE',
]);
export type EquipmentOnboardingResourceKind = z.infer<typeof EquipmentOnboardingResourceKindSchema>;

export const EquipmentOnboardingResourceSchema = z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    kind: EquipmentOnboardingResourceKindSchema,
    mimeType: z.string().min(3).max(120),
    extension: z.string().min(2).max(10),
    originalFilename: z.string().min(1).max(240),
    downloadUrl: z.string().min(5).max(1024),
    originalBytes: z.number().int().positive(),
    optimizedBytes: z.number().int().positive(),
    savingsPct: z.number().min(0).max(100),
});
export type EquipmentOnboardingResource = z.infer<typeof EquipmentOnboardingResourceSchema>;

export const CreateEquipmentOnboardingRequestSchema = z.object({
    accountId: z.string().min(1).max(128),
    manufacturerRef: z.string().trim().min(2).max(120),
    modelRef: z.string().trim().min(1).max(120),
    equipmentCategory: z.string().trim().min(2).max(120),
    versionOrSeries: z.string().trim().max(80).optional().or(z.literal('')),
    unitIdentifierType: z.enum(['SERIE_CHASSIS', 'PATENTE_PPU', 'CODIGO_INTERNO']).default('CODIGO_INTERNO'),
    unitIdentifierValue: z.string().trim().max(80).optional().or(z.literal('')),
    ownershipType: z.enum(['PROPIO', 'ARRENDADO', 'CONTRATISTA']).default('PROPIO'),
    horometer: z.number().nonnegative().default(0),
    operationalNotes: z.string().trim().max(2000).optional().or(z.literal('')),
    resources: z.array(EquipmentOnboardingResourceSchema).min(1).max(12),
});
export type CreateEquipmentOnboardingRequest = z.infer<typeof CreateEquipmentOnboardingRequestSchema>;

export const PublishEquipmentOnboardingSchema = z.object({
    confirmationKeyword: z.literal('ACTUALIZAR'),
    existingGlobalAssetId: z.string().trim().max(160).optional().or(z.literal('')),
    makeOficial: z.string().trim().min(2).max(120),
    modelOficial: z.string().trim().min(1).max(120),
    tipoEquipo: z.string().trim().min(3).max(140),
    categoriaEquipo: z.string().trim().min(3).max(120),
    version: z.string().trim().min(1).max(80).default('ESTÁNDAR'),
    ambienteOperativo: z.array(z.string().trim().min(2)).min(1),
    contextoOperativo: z.array(z.string().trim().min(2)).min(1),
    caracteristicasPrincipales: z.array(z.string().trim().min(2)).min(1),
    autoRegisterFleetUnit: z.boolean().default(true),
    reviewNotes: z.string().trim().max(1000).optional().or(z.literal('')),
});
export type PublishEquipmentOnboarding = z.infer<typeof PublishEquipmentOnboardingSchema>;

export const ReviewEquipmentOnboardingSchema = z.object({
    confirmationKeyword: z.literal('ACTUALIZAR'),
    status: z.enum(['NEEDS_INFO', 'REJECTED']),
    reviewNotes: z.string().trim().min(5).max(1000),
});
export type ReviewEquipmentOnboarding = z.infer<typeof ReviewEquipmentOnboardingSchema>;

// ── 9. Entitlements, EDU Accredited Institutions & Pilot Expiration (Bloque 2.3) ──
export const CountryCodeSchema = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,4}$/, 'Código de país ISO inválido (ej. CL, PE, BR, AR, US).')
    .default('CL');
export type CountryCode = z.infer<typeof CountryCodeSchema>;

export const BasePackageTierSchema = z.enum([
    'CORE_BASE',
    'OPERMAQ_BASE',
    'FULL_SUITE',
    'ACADEMIC_SANDBOX',
]);
export type BasePackageTier = z.infer<typeof BasePackageTierSchema>;

export const AddonModuleStateSchema = z.object({
    active: z.boolean(),
    updatedAt: z.number().optional(),
});
export type AddonModuleState = z.infer<typeof AddonModuleStateSchema>;

export const AccountEntitlementsSchema = z.object({
    basePackage: BasePackageTierSchema.default('CORE_BASE'),
    baseModules: z
        .object({
            opermaq: z.boolean().default(false),
            stockpile: z.boolean().default(false),
            supply: z.boolean().default(false),
        })
        .optional(),
    addonModules: z
        .object({
            opermaq: AddonModuleStateSchema.optional(),
            stockpile: AddonModuleStateSchema.optional(),
            supply: AddonModuleStateSchema.optional(),
        })
        .default({}),
    maxProjects: z.number().int().min(1).max(100).nullable().default(null),
});
export type AccountEntitlements = z.infer<typeof AccountEntitlementsSchema>;

export function resolveEffectiveModuleAccess(params: {
    moduleKey: 'opermaq' | 'stockpile' | 'supply';
    globalModuleActive: boolean;
    hasFullSuiteOverride?: boolean;
    entitlements?: Record<string, any> | null;
    legacyContractActiveModules?: Record<string, boolean | undefined> | null;
    legacyEnabledPlugins?: string[] | null;
    memberRole?: string | null;
    memberAllowedModules?: Record<string, boolean | undefined> | null;
}): boolean {
    if (params.hasFullSuiteOverride) return true;
    if (!params.globalModuleActive) return false;

    const ent = params.entitlements;
    let accountEntitled = false;

    if (
        ent &&
        (ent.basePackage !== undefined ||
            ent.baseModules !== undefined ||
            ent.addonModules !== undefined)
    ) {
        const baseIncluded =
            ent.baseModules?.[params.moduleKey] === true ||
            ent.basePackage === 'FULL_SUITE' ||
            (ent.basePackage === 'OPERMAQ_BASE' && params.moduleKey === 'opermaq') ||
            (ent.basePackage === 'ACADEMIC_SANDBOX' && params.moduleKey === 'opermaq');
        const addonIncluded = ent.addonModules?.[params.moduleKey]?.active === true;
        accountEntitled = baseIncluded || addonIncluded;
    } else {
        accountEntitled =
            params.legacyContractActiveModules?.[params.moduleKey] === true ||
            (Array.isArray(params.legacyEnabledPlugins) &&
                params.legacyEnabledPlugins.some(
                    (p) => String(p).toLowerCase() === params.moduleKey
                ));
    }

    if (!accountEntitled) return false;

    const roleUpper = String(params.memberRole || '').trim().toUpperCase();
    if (roleUpper === 'SUBSCRIPTION_ADMIN' || roleUpper === 'BILLING_ONLY') {
        return false;
    }
    if (roleUpper === 'OWNER' || roleUpper === 'ADMIN') {
        return true;
    }

    return params.memberAllowedModules?.[params.moduleKey] !== false;
}

export const EduInstitutionLogoSchema = z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    downloadUrl: z
        .string()
        .min(5)
        .max(1024)
        .refine(
            (u) =>
                !u.startsWith('data:') &&
                !u.includes(';base64,') &&
                !u.includes('/api/media/blob/tenant/') &&
                (u.startsWith('/api/media/blob/symbology/') || u.startsWith('https://')),
            'Logo EDU debe usar CAS público SYMBOLOGY_MASTER o HTTPS válido'
        ),
    mimeType: z.string().min(3).max(120),
    extension: z.string().min(2).max(10),
    originalBytes: z.number().int().positive(),
    optimizedBytes: z.number().int().positive(),
    savingsPct: z.number().min(0).max(100),
});
export type EduInstitutionLogo = z.infer<typeof EduInstitutionLogoSchema>;

export const EduInstitutionSchema = z.object({
    id: z.string().min(1).max(128),
    name: z.string().trim().min(2).max(180),
    countryCode: CountryCodeSchema.default('CL'),
    domains: z.array(z.string().trim().min(3).max(120)).min(1).max(20),
    status: z.enum(['ACTIVE', 'SUSPENDED']).default('ACTIVE'),
    defaultMaxProjects: z.number().int().min(1).max(20).default(3),
    eduInstitutionLogo: EduInstitutionLogoSchema.nullable().optional(),
    createdAt: z.union([z.number(), z.string()]).optional(),
    updatedAt: z.union([z.number(), z.string()]).optional(),
});
export type EduInstitution = z.infer<typeof EduInstitutionSchema>;

export const UpsertEduInstitutionPayloadSchema = z.object({
    name: z.string().trim().min(2).max(180),
    countryCode: CountryCodeSchema.default('CL'),
    domains: z.array(z.string().trim().min(3).max(120)).min(1).max(20),
    status: z.enum(['ACTIVE', 'SUSPENDED']).default('ACTIVE'),
    defaultMaxProjects: z.number().int().min(1).max(20).default(3),
    eduInstitutionLogo: EduInstitutionLogoSchema.nullable().optional(),
    confirmationKeyword: z.literal('ACTUALIZAR'),
});
export type UpsertEduInstitutionPayload = z.infer<typeof UpsertEduInstitutionPayloadSchema>;

export const UpdateAccountEntitlementsPayloadSchema = z.object({
    basePackage: BasePackageTierSchema,
    addonModules: z.object({
        opermaq: z.boolean(),
        stockpile: z.boolean(),
        supply: z.boolean().optional().default(false),
    }),
    maxProjects: z.number().int().min(1).max(100).nullable().optional(),
    eduInstitutionId: z.string().trim().max(128).nullable().optional(),
    confirmationKeyword: z.literal('ACTUALIZAR'),
});
export type UpdateAccountEntitlementsPayload = z.infer<typeof UpdateAccountEntitlementsPayloadSchema>;

export function evaluatePilotExpiration(expiresAt: unknown, nowMs: number = Date.now()): boolean {
    let resolvedMs = NaN;
    if (typeof expiresAt === 'number') {
        resolvedMs = expiresAt;
    } else if (typeof expiresAt === 'string' && expiresAt.trim().length > 0) {
        const trimmed = expiresAt.trim();
        resolvedMs = /^\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
    } else if (expiresAt && typeof (expiresAt as { toMillis?: unknown }).toMillis === 'function') {
        resolvedMs = (expiresAt as { toMillis: () => number }).toMillis();
    }
    return Number.isFinite(resolvedMs) && resolvedMs > 0 && nowMs > resolvedMs;
}

export * from './manufacturers.contracts';

