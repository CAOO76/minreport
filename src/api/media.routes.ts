import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import {
    CasStorageScopeSchema,
    DigestUploadQuerySchema,
    MediaDigestionProfileSchema,
    type CasStorageScope,
    type MediaDigestionProfile,
} from '../contracts/media.contracts';
import { AuditLedger } from '../core/audit-ledger';
import { CasStorageService, type CasBlobStreamHandle } from '../core/media/CasStorageService';
import { resolveMinReportSessionScope, type ScopedRequest } from '../middleware/sessionScope';

/**
 * RUTAS TRANSVERSALES DEL DIGESTOR MULTIMEDIA Y CAS (`/api/media/*`)
 * Disponibles para MINREPORT Core, OPERMAQ, STOCKPILE CONTROL y SyncQueueEngine PWA.
 */

const mediaRouter = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 120 * 1024 * 1024, // Soporta manuales OEM crudos de hasta 120 MB para digestión server-side
    },
});

function sanitizeBlobFilename(rawName: string): { sha256: string; ext: string } | null {
    const match = String(rawName || '')
        .trim()
        .match(/^([a-f0-9]{64})\.([a-z0-9]{2,8})$/i);
    if (!match) return null;
    return {
        sha256: match[1].toLowerCase(),
        ext: match[2].toLowerCase(),
    };
}

function sanitizeSha256Param(rawParam: string): string | null {
    const match = String(rawParam || '')
        .trim()
        .match(/^([a-f0-9]{64})(?:\.[a-z0-9]{2,8})?$/i);
    return match ? match[1].toLowerCase() : null;
}

/**
 * Verifica si la sesión corresponde a 1º DEV (`DEV_ROOT`) o 2º ADMIN (`SUPER_ADMIN`)
 * para habilitar auditoría/lectura soberana de evidencia privada sin exigir `canCurateAI`.
 */
function canAuditAllPrivateBlobs(req: ScopedRequest): boolean {
    const ctx = req.opermaqContext;
    if (!ctx) return false;
    const tokenRole = String(req.user?.role || '').toUpperCase();
    const isDevRoot =
        ctx.accountTier === 1 || req.user?.isMasterDev === true || tokenRole === 'DEV_ROOT';
    const isSuperAdmin =
        ctx.accountTier === 2 || req.user?.admin === true || tokenRole === 'SUPER_ADMIN';
    return isDevRoot || isSuperAdmin;
}

function pipeCasStreamToResponse(
    req: Request,
    res: Response,
    blobStream: CasBlobStreamHandle,
    options: {
        sha256: string;
        cacheControl: string;
        crossOriginResourcePolicy?: string;
    }
): Response | void {
    const etagValue = `"${options.sha256}"`;
    res.setHeader('Content-Type', blobStream.contentType);
    res.setHeader('Cache-Control', options.cacheControl);
    res.setHeader('ETag', etagValue);
    if (options.crossOriginResourcePolicy) {
        res.setHeader('Cross-Origin-Resource-Policy', options.crossOriginResourcePolicy);
    }

    if (req.headers['if-none-match'] === etagValue) {
        const destroyable = blobStream.stream as NodeJS.ReadableStream & { destroy?: () => void };
        if (typeof destroyable.destroy === 'function') {
            destroyable.destroy();
        }
        return res.status(304).end();
    }

    if (typeof blobStream.contentLength === 'number') {
        res.setHeader('Content-Length', String(blobStream.contentLength));
    }

    res.status(200);
    blobStream.stream.on('error', (err) => {
        console.error('[MEDIA-CAS-STREAM] Error transmitiendo stream CAS:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error transmitiendo activo CAS.' });
        } else {
            res.destroy();
        }
    });
    res.on('close', () => {
        const destroyable = blobStream.stream as NodeJS.ReadableStream & { destroy?: () => void };
        if (typeof destroyable.destroy === 'function') {
            destroyable.destroy();
        }
    });
    blobStream.stream.pipe(res);
}

/**
 * GET /api/media/cas/:sha256
 * Entrega streaming directo desde Cloud Storage sin cargar archivos pesados (hasta 120 MB) en RAM,
 * validando aislamiento multi-tenant y auditoría soberana (`SUPER_ADMIN` / `DEV_ROOT`).
 */
mediaRouter.get(
    '/cas/:sha256',
    async (req: ScopedRequest, res: Response, next: NextFunction) => {
        if (req.headers.authorization?.startsWith('Bearer ')) {
            return resolveMinReportSessionScope(req, res, next);
        }
        return next();
    },
    async (req: ScopedRequest, res: Response) => {
        const sha256 = sanitizeSha256Param(String(req.params.sha256 || ''));
        if (!sha256) {
            return res.status(400).json({ error: 'Identificador SHA-256 CAS inválido.' });
        }

        const ctx = req.opermaqContext;
        const isSovereignAuditor = canAuditAllPrivateBlobs(req);
        const requestedScopeRaw = typeof req.query.scope === 'string' ? req.query.scope.trim() : '';
        const requestedTenantRaw =
            typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : '';

        if (
            requestedTenantRaw &&
            ctx &&
            !isSovereignAuditor &&
            requestedTenantRaw !== ctx.tenantId
        ) {
            return res.status(403).json({ error: 'Acceso denegado a evidencia privada de otra cuenta.' });
        }

        const effectiveTenantId = requestedTenantRaw || ctx?.tenantId || undefined;
        const entry = await CasStorageService.resolveRegistryEntryBySha256(sha256, {
            scope: requestedScopeRaw || undefined,
            tenantId: effectiveTenantId,
            allowCrossTenantAudit: isSovereignAuditor,
        });

        if (!entry) {
            if (!ctx && (!requestedScopeRaw || requestedScopeRaw.toUpperCase() === 'TENANT_PRIVATE')) {
                return res.status(404).json({ error: 'Activo CAS no encontrado.' });
            }
            return res.status(404).json({ error: 'Activo CAS no encontrado.' });
        }

        const isPrivateScope = String(entry.scope || '').toUpperCase() === 'TENANT_PRIVATE';
        if (isPrivateScope) {
            if (!ctx) {
                return res.status(401).json({ error: 'No autorizado: Token de sesión MINREPORT requerido.' });
            }
            if (!isSovereignAuditor && entry.tenantId && entry.tenantId !== ctx.tenantId) {
                return res.status(403).json({ error: 'Acceso denegado a evidencia privada de otra cuenta.' });
            }
        }

        const blobStream = await CasStorageService.openCasBlobStream(
            entry.storagePath,
            isPrivateScope
                ? {
                      scope: 'TENANT_PRIVATE',
                      tenantId: entry.tenantId || ctx?.tenantId,
                      allowCrossTenantAudit: isSovereignAuditor,
                  }
                : { scope: entry.scope }
        );
        if (!blobStream) {
            return res.status(404).json({ error: 'Binario CAS no encontrado en almacenamiento.' });
        }

        const cacheControl = isPrivateScope
            ? 'private, max-age=3600'
            : 'public, max-age=31536000, immutable';

        return pipeCasStreamToResponse(req, res, blobStream, {
            sha256,
            cacheControl,
            crossOriginResourcePolicy: isPrivateScope ? undefined : 'cross-origin',
        });
    }
);

/**
 * GET /api/media/blob/global_oem/:filename
 * Sirve activos OEM comunes sanitizados por stream con caché inmutable de 1 año.
 */
mediaRouter.get('/blob/global_oem/:filename', async (req: Request, res: Response) => {
    const parsed = sanitizeBlobFilename(String(req.params.filename));
    if (!parsed) {
        return res.status(400).json({ error: 'Identificador CAS inválido.' });
    }
    const storagePath = CasStorageService.buildStoragePath('GLOBAL_OEM', parsed.sha256, parsed.ext);
    const blobStream = await CasStorageService.openCasBlobStream(storagePath);
    if (!blobStream) {
        return res.status(404).json({ error: 'Activo CAS global no encontrado.' });
    }
    return pipeCasStreamToResponse(req, res, blobStream, {
        sha256: parsed.sha256,
        cacheControl: 'public, max-age=31536000, immutable',
        crossOriginResourcePolicy: 'cross-origin',
    });
});

/**
 * GET /api/media/blob/symbology/:filename
 * Sirve pictogramas vectoriales `.svg` e ISO universales por stream con caché inmutable de 1 año.
 */
mediaRouter.get('/blob/symbology/:filename', async (req: Request, res: Response) => {
    const parsed = sanitizeBlobFilename(String(req.params.filename));
    if (!parsed) {
        return res.status(400).json({ error: 'Identificador CAS de simbología inválido.' });
    }
    const storagePath = CasStorageService.buildStoragePath('SYMBOLOGY_MASTER', parsed.sha256, parsed.ext);
    const blobStream = await CasStorageService.openCasBlobStream(storagePath);
    if (!blobStream) {
        return res.status(404).json({ error: 'Símbolo CAS no encontrado.' });
    }
    return pipeCasStreamToResponse(req, res, blobStream, {
        sha256: parsed.sha256,
        cacheControl: 'public, max-age=31536000, immutable',
        crossOriginResourcePolicy: 'cross-origin',
    });
});

/**
 * GET /api/media/blob/tenant/:tenantId/:filename
 * Sirve evidencia privada multi-tenant por stream validando pertenencia al `tenantId`
 * o rol de auditoría soberana (`SUPER_ADMIN` / `DEV_ROOT`).
 */
mediaRouter.get(
    '/blob/tenant/:tenantId/:filename',
    resolveMinReportSessionScope,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const requestedTenant = String(req.params.tenantId || '').trim();
        const parsed = sanitizeBlobFilename(String(req.params.filename));
        if (!parsed) {
            return res.status(400).json({ error: 'Identificador CAS inválido.' });
        }

        const isSovereignAuditor = canAuditAllPrivateBlobs(req);
        if (!isSovereignAuditor && requestedTenant !== ctx.tenantId) {
            return res.status(403).json({ error: 'Acceso denegado a evidencia privada de otra cuenta.' });
        }

        const storagePath = CasStorageService.buildStoragePath(
            'TENANT_PRIVATE',
            parsed.sha256,
            parsed.ext,
            requestedTenant
        );
        const blobStream = await CasStorageService.openCasBlobStream(storagePath, {
            scope: 'TENANT_PRIVATE',
            tenantId: requestedTenant,
            allowCrossTenantAudit: isSovereignAuditor,
        });
        if (!blobStream) {
            return res.status(404).json({ error: 'Evidencia CAS no encontrada.' });
        }

        return pipeCasStreamToResponse(req, res, blobStream, {
            sha256: parsed.sha256,
            cacheControl: 'private, max-age=3600',
        });
    }
);

/**
 * Resuelve el ámbito CAS efectivo aplicando autorización soberana por rol y perfil:
 * - GLOBAL_OEM reservado exclusivamente a 1º DEV (`canCurateAI`, nunca TEST-PILOT).
 * - SYMBOLOGY_MASTER habilitado para 1º DEV, 2º ADMIN y 4º B2B OWNER/ADMIN
 *   únicamente en perfiles de simbología/logo (`IMAGE_ISO_SYMBOL`, `VECTOR_SVG_CLEAN`).
 * - Cualquier otro rol o perfil degrada a TENANT_PRIVATE.
 */
function resolveEffectiveMediaScope(
    ctx: NonNullable<ScopedRequest['opermaqContext']>,
    requestedScope: CasStorageScope,
    profile?: MediaDigestionProfile
): CasStorageScope {
    const isDevCurator = ctx.capabilities.canCurateAI && ctx.accountTier !== 3;
    if (requestedScope === 'GLOBAL_OEM') {
        return isDevCurator ? 'GLOBAL_OEM' : 'TENANT_PRIVATE';
    }

    if (requestedScope === 'SYMBOLOGY_MASTER') {
        const isSymbologyProfile =
            profile === 'IMAGE_ISO_SYMBOL' || profile === 'VECTOR_SVG_CLEAN';
        const isB2BSymbologyAuthorized =
            ctx.accountTier === 4 &&
            !ctx.isEduSandbox &&
            ctx.capabilities.canManageFleet &&
            isSymbologyProfile;
        const isSymbologyAuthorized =
            isDevCurator || ctx.accountTier === 2 || isB2BSymbologyAuthorized;
        return isSymbologyAuthorized ? 'SYMBOLOGY_MASTER' : 'TENANT_PRIVATE';
    }

    return requestedScope;
}

/**
 * GET /api/media/cas-preflight/:sha256
 * Verifica en < 10ms si el hash SHA-256 ya reside en CAS para ahorrar 100% de ancho de banda de subida.
 */
mediaRouter.get('/cas-preflight/:sha256', resolveMinReportSessionScope, async (req: ScopedRequest, res: Response) => {
    try {
        const ctx = req.opermaqContext!;
        const sha256 = String(req.params.sha256 || '').trim().toLowerCase();
        const scopeParsed = CasStorageScopeSchema.safeParse(req.query.scope || 'TENANT_PRIVATE');
        const requestedScope = scopeParsed.success ? scopeParsed.data : 'TENANT_PRIVATE';
        const profileParsed = MediaDigestionProfileSchema.safeParse(req.query.profile);
        const effectiveScope = resolveEffectiveMediaScope(
            ctx,
            requestedScope,
            profileParsed.success ? profileParsed.data : undefined
        );

        const hit = await CasStorageService.preflightCheck(sha256, effectiveScope, ctx.tenantId);
        if (!hit) {
            return res.status(200).json({ exists: false });
        }
        return res.status(200).json({ exists: true, descriptor: hit });
    } catch (err: any) {
        return res.status(500).json({ error: err?.message || 'Error en preflight CAS.' });
    }
});

/**
 * POST /api/media/digest-upload
 * Recibe un archivo multipart (`file`), aplica `MediaDigestorServer` según perfil y persiste en CAS.
 */
mediaRouter.post(
    '/digest-upload',
    resolveMinReportSessionScope,
    upload.single('file'),
    async (req: ScopedRequest, res: Response) => {
        try {
            const ctx = req.opermaqContext!;
            const file = req.file;
            if (!file || !file.buffer) {
                return res.status(400).json({ error: 'No se recibió archivo (`file`) para digestión.' });
            }

            const queryParsed = DigestUploadQuerySchema.safeParse({
                profile: req.body?.profile || req.query?.profile,
                scope: req.body?.scope || req.query?.scope,
                clientOriginalBytes: req.body?.clientOriginalBytes ?? req.query?.clientOriginalBytes,
                enableSelectivePdfRaster:
                    req.body?.enableSelectivePdfRaster ?? req.query?.enableSelectivePdfRaster ?? 'true',
            });

            if (!queryParsed.success) {
                return res.status(400).json({
                    error: 'Parámetros de digestión inválidos.',
                    details: queryParsed.error.format(),
                });
            }

            const { profile, scope, clientOriginalBytes, enableSelectivePdfRaster } = queryParsed.data;
            const effectiveScope = resolveEffectiveMediaScope(ctx, scope, profile);

            const { descriptor } = await CasStorageService.digestAndStore(
                file.buffer,
                file.mimetype || 'application/octet-stream',
                profile,
                {
                    scope: effectiveScope,
                    tenantId: ctx.tenantId,
                    actorUid: ctx.actorId,
                    originalFilename: file.originalname,
                    clientOriginalBytes,
                    enableSelectiveRaster: enableSelectivePdfRaster,
                }
            );

            await AuditLedger.record({
                tenantId: ctx.tenantId,
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                action: 'MEDIA_CAS_DIGESTED',
                module: 'core',
                targetEntity: descriptor.sha256,
                details: {
                    scope: effectiveScope,
                    profile: descriptor.profile,
                    originalBytes: descriptor.originalBytes,
                    optimizedBytes: descriptor.optimizedBytes,
                    savingsRatio: descriptor.savingsRatio,
                    deduplicatedHit: descriptor.deduplicatedHit,
                },
            }).catch(() => {});

            return res.status(200).json({
                success: true,
                descriptor,
            });
        } catch (err: any) {
            return res.status(500).json({
                error: err?.message || 'Error procesando y optimizando archivo multimedia.',
            });
        }
    }
);

export default mediaRouter;
