import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import {
    CasStorageScopeSchema,
    DigestUploadQuerySchema,
} from '../contracts/media.contracts';
import { AuditLedger } from '../core/audit-ledger';
import { CasStorageService } from '../core/media/CasStorageService';
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

/**
 * GET /api/media/blob/global_oem/:filename
 * Sirve activos OEM comunes sanitizados con caché inmutable de 1 año (Capa 1 Cloudflare Edge + Workbox PWA).
 */
mediaRouter.get('/blob/global_oem/:filename', async (req: Request, res: Response) => {
    const parsed = sanitizeBlobFilename(String(req.params.filename));
    if (!parsed) {
        return res.status(400).json({ error: 'Identificador CAS inválido.' });
    }
    const storagePath = CasStorageService.buildStoragePath('GLOBAL_OEM', parsed.sha256, parsed.ext);
    const blob = await CasStorageService.readCasBlob(storagePath);
    if (!blob) {
        return res.status(404).json({ error: 'Activo CAS global no encontrado.' });
    }
    res.setHeader('Content-Type', blob.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('ETag', `"${parsed.sha256}"`);
    return res.status(200).send(blob.buffer);
});

/**
 * GET /api/media/blob/symbology/:filename
 * Sirve pictogramas vectoriales `.svg` e ISO universales con caché inmutable de 1 año.
 */
mediaRouter.get('/blob/symbology/:filename', async (req: Request, res: Response) => {
    const parsed = sanitizeBlobFilename(String(req.params.filename));
    if (!parsed) {
        return res.status(400).json({ error: 'Identificador CAS de simbología inválido.' });
    }
    const storagePath = CasStorageService.buildStoragePath('SYMBOLOGY_MASTER', parsed.sha256, parsed.ext);
    const blob = await CasStorageService.readCasBlob(storagePath);
    if (!blob) {
        return res.status(404).json({ error: 'Símbolo CAS no encontrado.' });
    }
    res.setHeader('Content-Type', blob.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('ETag', `"${parsed.sha256}"`);
    return res.status(200).send(blob.buffer);
});

/**
 * GET /api/media/blob/tenant/:tenantId/:filename
 * Sirve evidencia privada multi-tenant validando sesión y pertenencia al `tenantId`.
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

        const isPrivileged = ctx.capabilities.canCurateAI;
        if (!isPrivileged && requestedTenant !== ctx.tenantId) {
            return res.status(403).json({ error: 'Acceso denegado a evidencia privada de otra cuenta.' });
        }

        const storagePath = CasStorageService.buildStoragePath(
            'TENANT_PRIVATE',
            parsed.sha256,
            parsed.ext,
            requestedTenant
        );
        const blob = await CasStorageService.readCasBlob(storagePath);
        if (!blob) {
            return res.status(404).json({ error: 'Evidencia CAS no encontrada.' });
        }

        res.setHeader('Content-Type', blob.contentType);
        res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
        res.setHeader('ETag', `"${parsed.sha256}"`);
        return res.status(200).send(blob.buffer);
    }
);

/**
 * GET /api/media/cas-preflight/:sha256
 * Verifica en < 10ms si el hash SHA-256 ya reside en CAS para ahorrar 100% de ancho de banda de subida.
 */
mediaRouter.get('/cas-preflight/:sha256', resolveMinReportSessionScope, async (req: ScopedRequest, res: Response) => {
    try {
        const ctx = req.opermaqContext!;
        const sha256 = String(req.params.sha256 || '').trim().toLowerCase();
        const scopeParsed = CasStorageScopeSchema.safeParse(req.query.scope || 'TENANT_PRIVATE');
        const scope = scopeParsed.success ? scopeParsed.data : 'TENANT_PRIVATE';

        const hit = await CasStorageService.preflightCheck(sha256, scope, ctx.tenantId);
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

            // Solo roles soberanos (DEV / ADMIN / TEST-PILOT) escriben directo en GLOBAL_OEM o SYMBOLOGY_MASTER;
            // clientes B2B/EDU escriben en TENANT_PRIVATE (y pasan por la esclusa Airlock para aportar al común).
            const effectiveScope =
                (scope === 'GLOBAL_OEM' || scope === 'SYMBOLOGY_MASTER') && !ctx.capabilities.canCurateAI
                    ? 'TENANT_PRIVATE'
                    : scope;

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
