import { z } from 'zod';

/**
 * MINREPORT MEDIA DIGESTOR & CAS CONTRACTS v4.0
 * Contratos canónicos transversales (Core, OPERMAQ, STOCKPILE CONTROL, Offline PWA)
 * Regla soberana: Ningún binario crudo se persiste sin digestión y huella SHA-256.
 */

export const MediaDigestionProfileSchema = z.enum([
    'PDF_HYBRID_OEM',
    'IMAGE_TECHNICAL_HD',
    'IMAGE_FIELD_EVIDENCE',
    'IMAGE_THUMBNAIL',
    'IMAGE_ISO_SYMBOL',
    'VECTOR_SVG_CLEAN',
    'VIDEO_FIELD_COMPACT',
]);

export type MediaDigestionProfile = z.infer<typeof MediaDigestionProfileSchema>;

export const CasStorageScopeSchema = z.enum(['GLOBAL_OEM', 'TENANT_PRIVATE', 'SYMBOLOGY_MASTER']);
export type CasStorageScope = z.infer<typeof CasStorageScopeSchema>;

export const DigestedMediaDescriptorSchema = z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    phashHex: z.string().regex(/^[a-f0-9]{16}$/).optional(),
    scope: CasStorageScopeSchema,
    tenantId: z.string().optional(),
    profile: MediaDigestionProfileSchema,
    mimeType: z.string().min(3),
    extension: z.string().min(2).max(8),
    originalFilename: z.string().optional(),
    originalBytes: z.number().int().nonnegative(),
    optimizedBytes: z.number().int().nonnegative(),
    savingsRatio: z.number().min(0).max(1),
    savingsPct: z.number().min(0).max(100).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    pageCount: z.number().int().positive().optional(),
    resampledPages: z.number().int().nonnegative().optional(),
    preservedVectorPages: z.number().int().nonnegative().optional(),
    durationSec: z.number().nonnegative().optional(),
    storagePath: z.string().min(1),
    downloadUrl: z.string().min(1),
    deduplicatedHit: z.boolean().default(false),
    nearDuplicateOf: z.string().optional(),
    createdAt: z.string(),
});

export type DigestedMediaDescriptor = z.infer<typeof DigestedMediaDescriptorSchema>;

export const DigestUploadQuerySchema = z.object({
    profile: MediaDigestionProfileSchema.optional().default('IMAGE_FIELD_EVIDENCE'),
    scope: CasStorageScopeSchema.optional().default('TENANT_PRIVATE'),
    clientOriginalBytes: z.coerce.number().int().nonnegative().optional(),
    enableSelectivePdfRaster: z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .optional()
        .transform((v) => v === true || v === 'true'),
});

