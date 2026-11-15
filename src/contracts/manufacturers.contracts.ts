import { z } from 'zod';

/**
 * MINREPORT OPERMAQ v4.1 — Contratos Canónicos Desacoplados (Minimalismo Industrial Puro)
 *
 * Dominio 1 — `global_manufacturers/{manufacturerKey}` (Registro Único OEM · Zero-Preset):
 * - Solo identidad corporativa de fábrica, emblemas SVG CAS, sitio web, contactos oficiales OEM
 *   y trazabilidad de equipos registrados (`equipmentCount`, `sampleModels`, `observedArchetypeIds`).
 * - Cero distribuidores locales acoplados.
 *
 * Dominio 2 — `global_suppliers/{supplierKey}` (Agenda Independiente de Proveedores & Base MARKETPLACE):
 * - Empresa distribuidora / proveedora independiente deduplicada por `countryIso2 + supplierTaxId`.
 * - Organización interna por divisiones (`divisions[]`: canal, marcas N:M, arquetipos, cobertura) y
 *   sucursales regionales (`branches[]`).
 * - Privacidad Ley N° 19.628 / Nueva Ley N° 21.719 + base silenciosa KYB / `x402`.
 */

export const MANUFACTURER_HITL_CONFIRM_KEYWORD = 'ACTUALIZAR' as const;

export const ManufacturerHitlConfirmWordSchema = z.literal(MANUFACTURER_HITL_CONFIRM_KEYWORD);

export const COMMERCIAL_CHANNEL_TYPES = ['NEW', 'USED', 'RENTAL', 'PARTS', 'SERVICE'] as const;
export const CommercialChannelTypeSchema = z.enum(COMMERCIAL_CHANNEL_TYPES);
export type CommercialChannelType = z.infer<typeof CommercialChannelTypeSchema>;

/** Los 16 arquetipos mecánicos canónicos de OPERMAQ (`canonicalArchetypeSpecs.ts`). */
export const MANUFACTURER_MACHINERY_ARCHETYPE_IDS = [
    'BULLDOZER_ORUGAS',
    'BULLDOZER_NEUMATICOS',
    'MINICARGADOR_SSL_CTL',
    'EXCAVADORA_HIDRAULICA',
    'CARGADOR_FRONTAL',
    'RETROEXCAVADORA',
    'CAMION_TOLVA_CAEX',
    'MOTONIVELADORA',
    'COMPACTADOR_RODILLO',
    'GRUA_IZAJE_MANIPULADOR',
    'PERFORADORA_SONDAJE',
    'PLANTA_MOVIL_CHANCADO_HARNERO',
    'COMPRESOR_GENERADOR_BOMBA',
    'REMOLQUE_CARRO_ARRASTRE_IMPLEMENTO',
    'VEHICULO_LIVIANO_TRANSPORTE',
    'HERRAMIENTA_INDUSTRIAL_GENERAL',
] as const;

export const ManufacturerMachineryArchetypeIdSchema = z.enum(MANUFACTURER_MACHINERY_ARCHETYPE_IDS);
export type ManufacturerMachineryArchetypeId = z.infer<typeof ManufacturerMachineryArchetypeIdSchema>;

export const MACHINERY_ARCHETYPE_FILTER_IDS = ['ALL', ...MANUFACTURER_MACHINERY_ARCHETYPE_IDS] as const;
export const MachineryArchetypeFilterIdSchema = z.enum(MACHINERY_ARCHETYPE_FILTER_IDS);
export type MachineryArchetypeFilterId = z.infer<typeof MachineryArchetypeFilterIdSchema>;

export const ManufacturerCurationStatusSchema = z.enum(['AUTO_DISCOVERED', 'VERIFIED']);
export type ManufacturerCurationStatus = z.infer<typeof ManufacturerCurationStatusSchema>;

export const LogoCandidateSourceKindSchema = z.enum([
    'OFFICIAL_SVG',
    'RASTER_VECTORIZED_VTRACER',
    'MANUAL_UPLOAD',
]);
export type LogoCandidateSourceKind = z.infer<typeof LogoCandidateSourceKindSchema>;

export const BrandSvgAssetDescriptorSchema = z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    phashHex: z.string().trim().max(32).optional(),
    storagePath: z.string().trim().max(256).nullable().optional(),
    downloadUrl: z
        .string()
        .trim()
        .min(1)
        .max(512)
        .refine(
            (u) => !u.includes(';base64,') && (u.startsWith('/api/media/blob/global_oem/') || u.startsWith('https://')),
            'SVG CAS debe residir en /api/media/blob/global_oem/ o HTTPS válido sin base64'
        ),
    originalBytes: z.number().int().nonnegative(),
    optimizedBytes: z.number().int().positive(),
    savingsPct: z.number().min(0).max(100),
    invertInDark: z.boolean().default(false),
    wasVectorized: z.boolean().default(false),
    sourceKind: LogoCandidateSourceKindSchema,
    sourceUrl: z.string().trim().max(512).nullable().optional(),
});
export type BrandSvgAssetDescriptor = z.infer<typeof BrandSvgAssetDescriptorSchema>;

export const ManufacturerLogoCandidateSchema = BrandSvgAssetDescriptorSchema.extend({
    candidateId: z.string().trim().min(4).max(80),
});
export type ManufacturerLogoCandidate = z.infer<typeof ManufacturerLogoCandidateSchema>;

export const ManufacturerOfficialContactsSchema = z.object({
    corporateContactUrl: z.string().trim().max(512).nullable().default(null),
    corporateEmail: z.string().trim().max(180).nullable().default(null),
    corporatePhone: z.string().trim().max(64).nullable().default(null),
    officialPartsUrl: z.string().trim().max(512).nullable().default(null),
    officialSupportUrl: z.string().trim().max(512).nullable().default(null),
    dealerLocatorUrl: z.string().trim().max(512).nullable().default(null),
});
export type ManufacturerOfficialContacts = z.infer<typeof ManufacturerOfficialContactsSchema>;

export const EMPTY_MANUFACTURER_OFFICIAL_CONTACTS: ManufacturerOfficialContacts = {
    corporateContactUrl: null,
    corporateEmail: null,
    corporatePhone: null,
    officialPartsUrl: null,
    officialSupportUrl: null,
    dealerLocatorUrl: null,
};

export const ManufacturerRecordSchema = z.object({
    manufacturerKey: z.string().trim().min(1).max(120),
    officialName: z.string().trim().min(1).max(180),
    legalCorporateName: z.string().trim().max(220).nullable().default(null),
    aliases: z.array(z.string().trim().min(1).max(120)).default([]),
    hqCountryIso2: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((v) => v.toUpperCase())
        .nullable()
        .default(null),
    hqCity: z.string().trim().max(120).nullable().default(null),
    officialWebsiteUrl: z.string().trim().max(512).nullable().default(null),
    officialContacts: ManufacturerOfficialContactsSchema.default(EMPTY_MANUFACTURER_OFFICIAL_CONTACTS),
    observedArchetypeIds: z.array(ManufacturerMachineryArchetypeIdSchema).default([]),
    sampleModels: z.array(z.string().trim().min(1).max(120)).max(24).default([]),
    logoSvg: BrandSvgAssetDescriptorSchema.nullable().default(null),
    logoCandidates: z.array(ManufacturerLogoCandidateSchema).max(12).default([]),
    curationStatus: ManufacturerCurationStatusSchema.default('AUTO_DISCOVERED'),
    hasPublicWebFootprint: z.boolean().default(true),
    equipmentCount: z.number().int().nonnegative().default(0),
    linkedSuppliersCount: z.number().int().nonnegative().optional().default(0),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    verifiedByUid: z.string().trim().max(128).nullable().optional(),
});
export type ManufacturerRecord = z.infer<typeof ManufacturerRecordSchema>;

// ── Dominio 2: Agenda Independiente de Proveedores y Distribuidores ─────────

export const SupplierBranchSchema = z.object({
    branchName: z.string().trim().min(1).max(160),
    city: z.string().trim().min(1).max(120),
    regionIso: z.string().trim().max(40).nullable().optional(),
    phone: z.string().trim().max(64).nullable().optional(),
    roleEmail: z.string().trim().max(180).nullable().optional(),
    portalUrl: z.string().trim().max(512).nullable().optional(),
});
export type SupplierBranch = z.infer<typeof SupplierBranchSchema>;

export const SupplierDivisionSchema = z.object({
    divisionId: z.string().trim().min(2).max(80),
    divisionName: z.string().trim().min(2).max(180),
    isOfficialDealer: z.boolean().default(true),
    channels: z.array(CommercialChannelTypeSchema).min(1).max(5),
    manufacturerKeys: z.array(z.string().trim().min(1).max(120)).max(32).default([]),
    archetypeIds: z.array(MachineryArchetypeFilterIdSchema).min(1).max(17).default(['ALL']),
    territories: z.array(z.string().trim().min(2).max(40)).min(1).max(24).default(['NATIONAL']),
    branches: z.array(SupplierBranchSchema).max(24).default([]),
});
export type SupplierDivision = z.infer<typeof SupplierDivisionSchema>;

/** Esquema legado únicamente para compatibilidad de lectura retroactiva. */
export const SupplierRepresentationSchema = z.object({
    manufacturerKey: z.string().trim().min(1).max(120),
    isOfficial: z.boolean().default(true),
    channels: z.array(CommercialChannelTypeSchema).min(1).max(5),
    archetypeIds: z.array(MachineryArchetypeFilterIdSchema).min(1).max(17).default(['ALL']),
    territories: z.array(z.string().trim().min(2).max(40)).min(1).max(24).default(['NATIONAL']),
    branchName: z.string().trim().max(160).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    phone: z.string().trim().max(64).nullable().optional(),
    roleEmail: z.string().trim().max(180).nullable().optional(),
    portalUrl: z.string().trim().max(512).nullable().optional(),
});
export type SupplierRepresentation = z.infer<typeof SupplierRepresentationSchema>;

export const SupplierAreaNameSchema = z.string().trim().min(2).max(120);
export type SupplierAreaName = z.infer<typeof SupplierAreaNameSchema>;

export const SupplierAreaKeySchema = z.string().trim().min(2).max(120);
export type SupplierAreaKey = z.infer<typeof SupplierAreaKeySchema>;

export const SupplierContactEntrySchema = z.object({
    contactId: z.string().trim().min(2).max(120),
    areaName: SupplierAreaNameSchema,
    areaKey: SupplierAreaKeySchema,
    contactLabel: z.string().trim().max(160).nullable().optional(),
    phone: z.string().trim().max(64).nullable().optional(),
    roleEmail: z.string().trim().max(180).nullable().optional(),
    portalUrl: z.string().trim().max(512).nullable().optional(),
    cityRegion: z.string().trim().max(120).nullable().optional(),
    manufacturerKeys: z.array(z.string().trim().min(1).max(120)).max(32).default([]),
    isOfficialDealer: z.boolean().default(true),
    legacyChannels: z.array(CommercialChannelTypeSchema).max(5).optional(),
    notes: z.string().trim().max(600).nullable().optional(),
    updatedAt: z.number().int().nonnegative().optional(),
});
export type SupplierContactEntry = z.infer<typeof SupplierContactEntrySchema>;

export const SII_DTE_DOCUMENT_TYPES = [33, 34, 46, 52, 56, 61, 110] as const;
export const SiiDteDocumentTypeSchema = z.union([
    z.literal(33),
    z.literal(34),
    z.literal(46),
    z.literal(52),
    z.literal(56),
    z.literal(61),
    z.literal(110),
]);
export type SiiDteDocumentType = z.infer<typeof SiiDteDocumentTypeSchema>;

export const SiiBranchTaxOfficeSchema = z.object({
    cdgSiiSucur: z.string().trim().regex(/^\d{1,9}$/).nullable().optional(),
    branchName: z.string().trim().min(1).max(120),
    dirOrigin: z.string().trim().min(1).max(70),
    cmnaOrigin: z.string().trim().min(1).max(20),
    ciudadOrigin: z.string().trim().min(1).max(20),
});
export type SiiBranchTaxOffice = z.infer<typeof SiiBranchTaxOfficeSchema>;

export const SupplierSiiTaxProfileSchema = z.object({
    taxRegimeScope: z.enum(['SII_CL', 'INTERNATIONAL']).default('SII_CL'),
    siiRutNormalized: z.string().trim().max(10).nullable().default(null),
    siiRutDisplay: z.string().trim().max(16).nullable().default(null),
    siiRznSoc: z.string().trim().max(100).nullable().default(null),
    siiGiroEmis: z.string().trim().max(80).nullable().default(null),
    siiGiroRecep: z.string().trim().max(40).nullable().default(null),
    actecoCodes: z.array(z.string().trim().regex(/^\d{6}$/)).max(4).default([]),
    taxAddressDir: z.string().trim().max(70).nullable().default(null),
    taxComuna: z.string().trim().max(20).nullable().default(null),
    taxCiudad: z.string().trim().max(20).nullable().default(null),
    cdgSiiSucur: z.string().trim().max(9).nullable().default(null),
    branchOffices: z.array(SiiBranchTaxOfficeSchema).max(24).default([]),
    dteInterchangeEmail: z.string().trim().max(80).nullable().default(null),
    apBillingEmail: z.string().trim().max(180).nullable().default(null),
    supportedDteTypes: z.array(SiiDteDocumentTypeSchema).max(7).default([33, 52, 56, 61]),
    isDteCertified: z.boolean().default(false),
    foreignTaxId: z.string().trim().max(48).nullable().default(null),
    verifiedAt: z.number().int().nonnegative().nullable().default(null),
});
export type SupplierSiiTaxProfile = z.infer<typeof SupplierSiiTaxProfileSchema>;

export const EMPTY_SUPPLIER_SII_TAX_PROFILE: SupplierSiiTaxProfile = {
    taxRegimeScope: 'SII_CL',
    siiRutNormalized: null,
    siiRutDisplay: null,
    siiRznSoc: null,
    siiGiroEmis: null,
    siiGiroRecep: null,
    actecoCodes: [],
    taxAddressDir: null,
    taxComuna: null,
    taxCiudad: null,
    cdgSiiSucur: null,
    branchOffices: [],
    dteInterchangeEmail: null,
    apBillingEmail: null,
    supportedDteTypes: [33, 52, 56, 61],
    isDteCertified: false,
    foreignTaxId: null,
    verifiedAt: null,
};

export const SupplierTaxReadinessCheckSchema = z.object({
    code: z.string().trim().min(2).max(64),
    passed: z.boolean(),
});
export type SupplierTaxReadinessCheck = z.infer<typeof SupplierTaxReadinessCheckSchema>;

export const SupplierTaxReadinessSummarySchema = z.object({
    scope: z.enum(['SII_CL', 'INTERNATIONAL']),
    score: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    isReady: z.boolean(),
    checks: z.array(SupplierTaxReadinessCheckSchema),
});
export type SupplierTaxReadinessSummary = z.infer<typeof SupplierTaxReadinessSummarySchema>;

export const TenantSupplierBillingRuleSchema = z.object({
    tenantId: z.string().trim().min(1).max(120),
    supplierKey: z.string().trim().min(1).max(120),
    requiresPurchaseOrder801: z.boolean().default(true),
    requiresContract803: z.boolean().default(false),
    requiresDispatchGuide52: z.boolean().default(false),
    requiresReceptionTokenType: z.enum(['NONE', 'HES', 'HEM', 'HAS']).default('HES'),
    defaultFormaPagoDte: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    paymentTermDays: z.number().int().min(0).max(365).default(30),
    hasExceptionalPaymentAgreement: z.boolean().default(false),
    exceptionalAgreementNote: z.string().trim().max(240).nullable().default(null),
    dteClaimWindowDays: z.number().int().min(1).max(8).default(8),
    rcvClaimAlertEmail: z.string().trim().max(180).nullable().default(null),
    allowFactoringCesion: z.boolean().default(true),
    billingPortalUrl: z.string().trim().max(512).nullable().default(null),
    remittanceEmail: z.string().trim().max(180).nullable().default(null),
    defaultCentroCosto: z.string().trim().max(80).nullable().default(null),
    notes: z.string().trim().max(800).nullable().default(null),
    updatedByUid: z.string().trim().max(128).optional(),
    updatedAt: z.number().int().nonnegative(),
});
export type TenantSupplierBillingRule = z.infer<typeof TenantSupplierBillingRuleSchema>;

export const ManufacturerRegisteredEquipmentItemSchema = z.object({
    catalogId: z.string().trim().min(1).max(160),
    make: z.string().trim().min(1).max(180),
    model: z.string().trim().min(1).max(180),
    equipmentType: z.string().trim().min(1).max(120),
    category: z.string().trim().max(120).nullable().default(null),
    archetypeId: ManufacturerMachineryArchetypeIdSchema.nullable().default(null),
    photoUrl: z.string().trim().max(512).nullable().default(null),
    shortDescription: z.string().trim().max(400).nullable().default(null),
});
export type ManufacturerRegisteredEquipmentItem = z.infer<typeof ManufacturerRegisteredEquipmentItemSchema>;

export const SupplierEntitySchema = z.object({
    supplierKey: z.string().trim().min(1).max(120),
    tradeName: z.string().trim().min(1).max(180),
    legalName: z.string().trim().min(1).max(220),
    countryIso2: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((v) => v.toUpperCase())
        .default('CL'),
    supplierTaxId: z.string().trim().max(48).nullable().optional(),
    officialWebsiteUrl: z.string().trim().max(512).nullable().optional(),
    x402SellerWalletId: z.string().trim().max(160).nullable().optional(),
    manufacturerKeys: z.array(z.string().trim().min(1).max(120)).default([]),
    divisions: z.array(SupplierDivisionSchema).default([]),
    contacts: z.array(SupplierContactEntrySchema).default([]),
    siiTaxProfile: SupplierSiiTaxProfileSchema.optional(),
    taxReadiness: SupplierTaxReadinessSummarySchema.optional(),
    representations: z.array(SupplierRepresentationSchema).optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
});
export type SupplierEntity = z.infer<typeof SupplierEntitySchema>;

export const AiSupplierContactHintSchema = z.object({
    areaName: SupplierAreaNameSchema,
    contactLabel: z.string().trim().max(160).nullable().optional(),
    phone: z.string().trim().max(64).nullable().optional(),
    roleEmail: z.string().trim().max(180).nullable().optional(),
    portalUrl: z.string().trim().max(512).nullable().optional(),
    cityRegion: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(400).nullable().optional(),
});
export type AiSupplierContactHint = z.infer<typeof AiSupplierContactHintSchema>;

export const AiSupplierSuggestionSchema = z.object({
    suggestionId: z.string().trim().min(2).max(80),
    tradeName: z.string().trim().min(1).max(180),
    legalName: z.string().trim().max(220).nullable().optional(),
    countryIso2: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((v) => v.toUpperCase())
        .default('CL'),
    supplierTaxId: z.string().trim().max(48).nullable().optional(),
    officialWebsiteUrl: z.string().trim().max(512).nullable().optional(),
    divisionName: z.string().trim().min(2).max(180),
    isOfficialDealer: z.boolean().default(true),
    channels: z.array(CommercialChannelTypeSchema).min(1).max(5),
    manufacturerKeys: z.array(z.string().trim().min(1).max(120)).max(32).default([]),
    archetypeIds: z.array(MachineryArchetypeFilterIdSchema).min(1).max(17).default(['ALL']),
    territories: z.array(z.string().trim().min(2).max(40)).min(1).max(24).default(['NATIONAL']),
    branches: z.array(SupplierBranchSchema).max(12).default([]),
    contacts: z.array(AiSupplierContactHintSchema).max(24).default([]),
    siiGiroEmis: z.string().trim().max(80).nullable().optional(),
    taxAddressDir: z.string().trim().max(70).nullable().optional(),
    taxComuna: z.string().trim().max(20).nullable().optional(),
    taxCiudad: z.string().trim().max(20).nullable().optional(),
    dteInterchangeEmail: z.string().trim().max(80).nullable().optional(),
});
export type AiSupplierSuggestion = z.infer<typeof AiSupplierSuggestionSchema>;

export const TenantPrivateSupplierContactSchema = z.object({
    contactId: z.string().trim().min(1).max(120),
    tenantId: z.string().trim().min(1).max(120),
    supplierKey: z.string().trim().max(120).nullable().default(null),
    manufacturerKey: z.string().trim().max(120).nullable().default(null),
    distributorName: z.string().trim().min(1).max(180),
    areaName: z.string().trim().max(120).nullable().optional(),
    areaKey: z.string().trim().max(120).nullable().optional(),
    contactLabel: z.string().trim().max(160).nullable().optional(),
    channelType: CommercialChannelTypeSchema.default('PARTS'),
    cityRegion: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(64).nullable().optional(),
    emailOrWeb: z.string().trim().max(512).nullable().optional(),
    notes: z.string().trim().max(800).nullable().optional(),
    createdByUid: z.string().trim().min(1).max(128),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
});
export type TenantPrivateSupplierContact = z.infer<typeof TenantPrivateSupplierContactSchema>;

export const SupplierContactContributionSchema = z.object({
    contributionId: z.string().trim().min(1).max(120),
    manufacturerKey: z.string().trim().max(120).nullable().default(null),
    distributorName: z.string().trim().min(1).max(180),
    channelType: CommercialChannelTypeSchema,
    countryIso2: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((v) => v.toUpperCase())
        .default('CL'),
    cityRegion: z.string().trim().min(1).max(120),
    roleEmail: z.string().trim().max(180).nullable().optional(),
    phone: z.string().trim().max(64).nullable().optional(),
    portalUrl: z.string().trim().max(512).nullable().optional(),
    sanitizedNotes: z.string().trim().max(800).nullable().optional(),
    piiPurgedTypes: z.array(z.string()).default([]),
    piiPurgedCount: z.number().int().nonnegative().default(0),
    status: z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED']).default('PENDING_REVIEW'),
    submittedByTenantHash: z.string().trim().min(8).max(128),
    createdAt: z.number().int().nonnegative(),
    reviewedAt: z.number().int().nonnegative().nullable().optional(),
    reviewedByUid: z.string().trim().max(128).nullable().optional(),
    ttlExpiresAt: z.unknown().nullable().optional(),
});
export type SupplierContactContribution = z.infer<typeof SupplierContactContributionSchema>;

// ── Payloads de API ─────────────────────────────────────────────────────────

export const DirectCreateManufacturerBodySchema = z.object({
    rawMake: z.string().trim().min(2).max(180),
    legalCorporateName: z.string().trim().max(220).nullable().optional(),
    hqCountryIso2: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((v) => v.toUpperCase())
        .nullable()
        .optional(),
    hqCity: z.string().trim().max(120).nullable().optional(),
    officialWebsiteUrl: z.string().trim().max(512).nullable().optional(),
    hasPublicWebFootprint: z.boolean().default(true),
    runAiDiscovery: z.boolean().default(true),
    confirmWord: ManufacturerHitlConfirmWordSchema,
});
export type DirectCreateManufacturerBody = z.infer<typeof DirectCreateManufacturerBodySchema>;

export const UpdateManufacturerHitlBodySchema = z.object({
    officialName: z.string().trim().min(2).max(180).optional(),
    legalCorporateName: z.string().trim().max(220).nullable().optional(),
    hqCountryIso2: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((v) => v.toUpperCase())
        .nullable()
        .optional(),
    hqCity: z.string().trim().max(120).nullable().optional(),
    officialWebsiteUrl: z.string().trim().max(512).nullable().optional(),
    officialContacts: ManufacturerOfficialContactsSchema.partial().optional(),
    aliases: z.array(z.string().trim().min(1).max(120)).max(24).optional(),
    hasPublicWebFootprint: z.boolean().optional(),
    selectedLogoCandidateId: z.string().trim().min(4).max(80).optional(),
    invertInDark: z.boolean().optional(),
    confirmWord: ManufacturerHitlConfirmWordSchema,
});
export type UpdateManufacturerHitlBody = z.infer<typeof UpdateManufacturerHitlBodySchema>;

export const DiscoverSuppliersAiBodySchema = z
    .object({
        countryIso2: z
            .string()
            .trim()
            .regex(/^[A-Za-z]{2}$/)
            .transform((v) => v.toUpperCase())
            .optional(),
        regionQuery: z.string().trim().max(120).optional(),
        manufacturerKey: z.string().trim().max(120).optional(),
        brandQuery: z.string().trim().max(180).optional(),
        channelFocus: z.union([CommercialChannelTypeSchema, z.literal('ALL')]).optional(),
        queryFocus: z.string().trim().max(160).optional(),
    })
    .refine((val) => Boolean(val.countryIso2) || Boolean(val.regionQuery && val.regionQuery.trim().length >= 2), {
        message: 'Se requiere countryIso2 o regionQuery (>= 2 caracteres).',
        path: ['regionQuery'],
    });
export type DiscoverSuppliersAiBody = z.infer<typeof DiscoverSuppliersAiBodySchema>;

export const ApproveSuppliersAiBodySchema = z.object({
    suggestions: z.array(AiSupplierSuggestionSchema).min(1).max(12),
    confirmWord: ManufacturerHitlConfirmWordSchema,
});
export type ApproveSuppliersAiBody = z.infer<typeof ApproveSuppliersAiBodySchema>;

export const UpsertSupplierBodySchema = z.object({
    tradeName: z.string().trim().min(2).max(180),
    legalName: z.string().trim().max(220).optional(),
    countryIso2: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((v) => v.toUpperCase())
        .default('CL'),
    supplierTaxId: z.string().trim().max(48).nullable().optional(),
    officialWebsiteUrl: z.string().trim().max(512).nullable().optional(),
    x402SellerWalletId: z.string().trim().max(160).nullable().optional(),
    divisionId: z.string().trim().max(80).optional(),
    divisionName: z.string().trim().min(2).max(180).default('División Comercial General'),
    isOfficialDealer: z.boolean().default(true),
    channels: z.array(CommercialChannelTypeSchema).min(1).max(5),
    manufacturerKeys: z.array(z.string().trim().min(1).max(120)).max(32).optional(),
    manufacturerKey: z.string().trim().max(120).nullable().optional(),
    archetypeIds: z.array(MachineryArchetypeFilterIdSchema).min(1).max(17).default(['ALL']),
    territories: z.array(z.string().trim().min(2).max(40)).min(1).max(24).default(['NATIONAL']),
    branchName: z.string().trim().max(160).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    regionIso: z.string().trim().max(40).nullable().optional(),
    phone: z.string().trim().max(64).nullable().optional(),
    roleEmail: z.string().trim().max(180).nullable().optional(),
    portalUrl: z.string().trim().max(512).nullable().optional(),
    confirmWord: ManufacturerHitlConfirmWordSchema,
});
export type UpsertSupplierBody = z.infer<typeof UpsertSupplierBodySchema>;

export const UpsertTenantPrivateContactBodySchema = z.object({
    contactId: z.string().trim().max(120).optional(),
    supplierKey: z.string().trim().max(120).nullable().optional(),
    manufacturerKey: z.string().trim().max(120).nullable().optional(),
    distributorName: z.string().trim().min(2).max(180),
    areaName: z.string().trim().max(120).nullable().optional(),
    contactLabel: z.string().trim().max(160).nullable().optional(),
    channelType: CommercialChannelTypeSchema.optional().default('PARTS'),
    cityRegion: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(64).nullable().optional(),
    emailOrWeb: z.string().trim().max(512).nullable().optional(),
    notes: z.string().trim().max(800).nullable().optional(),
});
export type UpsertTenantPrivateContactBody = z.infer<typeof UpsertTenantPrivateContactBodySchema>;

export const CreateSupplierDirectHitlBodySchema = z.object({
    tradeName: z.string().trim().min(2).max(180),
    legalName: z.string().trim().max(220).optional(),
    countryIso2: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((v) => v.toUpperCase())
        .default('CL'),
    supplierTaxId: z.string().trim().max(48).nullable().optional(),
    officialWebsiteUrl: z.string().trim().max(512).nullable().optional(),
    manufacturerKeys: z.array(z.string().trim().min(1).max(120)).max(32).default([]),
    initialContact: AiSupplierContactHintSchema.optional(),
    siiTaxProfile: SupplierSiiTaxProfileSchema.partial().optional(),
    confirmWord: ManufacturerHitlConfirmWordSchema,
});
export type CreateSupplierDirectHitlBody = z.infer<typeof CreateSupplierDirectHitlBodySchema>;

export const UpdateSupplierProfileHitlBodySchema = z.object({
    tradeName: z.string().trim().min(2).max(180).optional(),
    legalName: z.string().trim().min(2).max(220).optional(),
    countryIso2: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((v) => v.toUpperCase())
        .optional(),
    supplierTaxId: z.string().trim().max(48).nullable().optional(),
    officialWebsiteUrl: z.string().trim().max(512).nullable().optional(),
    x402SellerWalletId: z.string().trim().max(160).nullable().optional(),
    manufacturerKeys: z.array(z.string().trim().min(1).max(120)).max(32).optional(),
    siiTaxProfile: SupplierSiiTaxProfileSchema.partial().optional(),
    confirmWord: ManufacturerHitlConfirmWordSchema,
});
export type UpdateSupplierProfileHitlBody = z.infer<typeof UpdateSupplierProfileHitlBodySchema>;

export const UpsertSupplierContactHitlBodySchema = z.object({
    contactId: z.string().trim().max(120).optional(),
    areaName: SupplierAreaNameSchema,
    contactLabel: z.string().trim().max(160).nullable().optional(),
    phone: z.string().trim().max(64).nullable().optional(),
    roleEmail: z.string().trim().max(180).nullable().optional(),
    portalUrl: z.string().trim().max(512).nullable().optional(),
    cityRegion: z.string().trim().max(120).nullable().optional(),
    manufacturerKeys: z.array(z.string().trim().min(1).max(120)).max(32).optional(),
    isOfficialDealer: z.boolean().default(true),
    notes: z.string().trim().max(600).nullable().optional(),
    confirmWord: ManufacturerHitlConfirmWordSchema,
});
export type UpsertSupplierContactHitlBody = z.infer<typeof UpsertSupplierContactHitlBodySchema>;

export const DeleteSupplierContactHitlBodySchema = z.object({
    confirmWord: ManufacturerHitlConfirmWordSchema,
});
export type DeleteSupplierContactHitlBody = z.infer<typeof DeleteSupplierContactHitlBodySchema>;

export const DiscoverSupplierAreasAiBodySchema = z.object({
    countryIso2: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((v) => v.toUpperCase())
        .optional(),
    focusArea: z.string().trim().max(120).optional(),
});
export type DiscoverSupplierAreasAiBody = z.infer<typeof DiscoverSupplierAreasAiBodySchema>;

export const UpsertTenantSupplierBillingRuleBodySchema = z.object({
    requiresPurchaseOrder801: z.boolean().default(true),
    requiresContract803: z.boolean().default(false),
    requiresDispatchGuide52: z.boolean().default(false),
    requiresReceptionTokenType: z.enum(['NONE', 'HES', 'HEM', 'HAS']).default('HES'),
    defaultFormaPagoDte: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    paymentTermDays: z.number().int().min(0).max(365).default(30),
    hasExceptionalPaymentAgreement: z.boolean().default(false),
    exceptionalAgreementNote: z.string().trim().max(240).nullable().optional(),
    dteClaimWindowDays: z.number().int().min(1).max(8).default(8),
    rcvClaimAlertEmail: z.string().trim().max(180).nullable().optional(),
    allowFactoringCesion: z.boolean().default(true),
    billingPortalUrl: z.string().trim().max(512).nullable().optional(),
    remittanceEmail: z.string().trim().max(180).nullable().optional(),
    defaultCentroCosto: z.string().trim().max(80).nullable().optional(),
    notes: z.string().trim().max(800).nullable().optional(),
    confirmWord: ManufacturerHitlConfirmWordSchema,
});
export type UpsertTenantSupplierBillingRuleBody = z.infer<typeof UpsertTenantSupplierBillingRuleBodySchema>;

export const SubmitSupplierContributionBodySchema = z.object({
    manufacturerKey: z.string().trim().max(120).nullable().optional(),
    distributorName: z.string().trim().min(2).max(180),
    channelType: CommercialChannelTypeSchema,
    countryIso2: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((v) => v.toUpperCase())
        .default('CL'),
    cityRegion: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(64).nullable().optional(),
    roleEmail: z.string().trim().max(180).nullable().optional(),
    portalUrl: z.string().trim().max(512).nullable().optional(),
    notes: z.string().trim().max(800).nullable().optional(),
});
export type SubmitSupplierContributionBody = z.infer<typeof SubmitSupplierContributionBodySchema>;

export const ModerateSupplierContributionBodySchema = z.object({
    decision: z.enum(['APPROVE', 'REJECT']),
    confirmWord: ManufacturerHitlConfirmWordSchema,
});
export type ModerateSupplierContributionBody = z.infer<typeof ModerateSupplierContributionBodySchema>;

export const SupplierChannelResolveQuerySchema = z.object({
    manufacturerKey: z.string().trim().max(120).optional(),
    make: z.string().trim().max(180).optional(),
    archetypeId: ManufacturerMachineryArchetypeIdSchema.optional(),
    equipmentClass: z.string().trim().max(64).optional(),
    regionIso: z.string().trim().max(40).optional(),
    channelIntent: CommercialChannelTypeSchema.optional(),
    areaQuery: z.string().trim().max(120).optional(),
    includeIndependentSpecialists: z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .optional()
        .transform((v) => (v === undefined ? true : v === true || v === 'true')),
});
export type SupplierChannelResolveQuery = z.infer<typeof SupplierChannelResolveQuerySchema>;

export interface ResolvedSupplierMatch {
    supplier: SupplierEntity;
    division: SupplierDivision;
    isOfficial: boolean;
    score: number;
    matchedAreaName?: string | null;
}

export interface ResolveSupplierChannelsResult {
    query: {
        manufacturerKey: string | null;
        archetypeId: ManufacturerMachineryArchetypeId | null;
        regionIso: string | null;
        channelIntent: CommercialChannelType | null;
        areaQuery?: string | null;
    };
    officialMatches: ResolvedSupplierMatch[];
    independentMatches: ResolvedSupplierMatch[];
    tenantPrivateContacts: TenantPrivateSupplierContact[];
    latencyMs: number;
}
