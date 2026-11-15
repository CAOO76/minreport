import { Router, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { ScopedRequest } from '../../../middleware/sessionScope';
import {
    ApproveSuppliersAiBodySchema,
    CommercialChannelTypeSchema,
    DirectCreateManufacturerBodySchema,
    DiscoverSuppliersAiBodySchema,
    MACHINERY_ARCHETYPE_FILTER_IDS,
    ManufacturerCurationStatusSchema,
    ModerateSupplierContributionBodySchema,
    SubmitSupplierContributionBodySchema,
    SupplierChannelResolveQuerySchema,
    UpdateManufacturerHitlBodySchema,
    UpsertSupplierBodySchema,
    UpsertTenantPrivateContactBodySchema,
    CreateSupplierDirectHitlBodySchema,
    UpdateSupplierProfileHitlBodySchema,
    UpsertSupplierContactHitlBodySchema,
    DeleteSupplierContactHitlBodySchema,
    DiscoverSupplierAreasAiBodySchema,
    UpsertTenantSupplierBillingRuleBodySchema,
} from '../../../contracts/manufacturers.contracts';
import { ManufacturerRegistryService } from '../services/ManufacturerRegistryService';
import { SupplierChannelResolverService } from '../services/SupplierChannelResolverService';

/**
 * RUTAS REST OPERMAQ v4.1 — DOMINIOS DESACOPLADOS:
 * 1) `/api/manufacturers` (Fabricantes OEM puros · Zero-Preset · Sync Retroactivo)
 * 2) `/api/manufacturers/suppliers/*`, `/resolve-channels`, `/contacts/private`, `/contributions` (Agenda Proveedores)
 */

const manufacturersRouter = Router();

const uploadLogoMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
    },
    fileFilter: (_req, file, cb) => {
        const mime = (file.mimetype || '').toLowerCase();
        const name = (file.originalname || '').toLowerCase();
        if (
            mime === 'image/svg+xml' ||
            mime === 'image/png' ||
            mime === 'image/webp' ||
            mime === 'image/jpeg' ||
            name.endsWith('.svg') ||
            name.endsWith('.png') ||
            name.endsWith('.webp')
        ) {
            cb(null, true);
            return;
        }
        cb(new Error('Formato no soportado: sube únicamente archivo SVG, PNG o WEBP oficial.'));
    },
});

interface CallerAuthSummary {
    actorUid: string;
    actorEmail: string;
    tenantId: string;
    isDevMaster: boolean;
    isDevOrAdmin: boolean;
    isEduSandbox: boolean;
}

function resolveCallerAuth(req: ScopedRequest): CallerAuthSummary {
    const ctx = req.opermaqContext || req.moduleContext;
    const accountTier = ctx?.accountTier ?? 4;
    const actorUid = ctx?.actorId || req.user?.uid || '';
    const actorEmail = ctx?.actorEmail || req.user?.email || '';
    const tenantId = ctx?.tenantId || '';
    const isEduSandbox = Boolean(ctx?.isEduSandbox || accountTier === 5);

    return {
        actorUid,
        actorEmail,
        tenantId,
        isDevMaster: accountTier === 1 && !isEduSandbox,
        isDevOrAdmin: (accountTier === 1 || accountTier === 2) && !isEduSandbox,
        isEduSandbox,
    };
}

function handleRouterError(res: Response, err: unknown, fallbackMessage: string) {
    const statusCode =
        typeof (err as any)?.statusCode === 'number' &&
        (err as any).statusCode >= 400 &&
        (err as any).statusCode < 600
            ? (err as any).statusCode
            : 500;
    return res.status(statusCode).json({ error: (err as any)?.message || fallbackMessage });
}

// ── DOMINIO 1: FABRICANTES OEM PUROS ─────────────────────────────────────────

const ListManufacturersQuerySchema = z.object({
    archetypeId: z.enum(MACHINERY_ARCHETYPE_FILTER_IDS).optional(),
    curationStatus: ManufacturerCurationStatusSchema.optional(),
    q: z.string().trim().max(120).optional(),
});

manufacturersRouter.get('/', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        const parsed = ListManufacturersQuerySchema.safeParse(req.query || {});
        const filters = parsed.success ? parsed.data : {};

        const items = await ManufacturerRegistryService.listManufacturers(filters);

        let pendingContributionsCount = 0;
        if (caller.isDevOrAdmin) {
            const pending = await SupplierChannelResolverService.listContributions('PENDING_REVIEW');
            pendingContributionsCount = pending.length;
        }

        return res.status(200).json({
            success: true,
            manufacturers: items,
            pendingContributionsCount,
        });
    } catch (err) {
        return handleRouterError(res, err, 'Error al consultar el catálogo de fabricantes.');
    }
});

const SyncExistingBodySchema = z.object({
    runAi: z.boolean().default(true),
    forceRefreshBroken: z.boolean().default(true),
});

manufacturersRouter.post('/sync-existing', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox || !caller.isDevMaster) {
            return res.status(403).json({
                error: 'Sincronización retroactiva sobre catálogo existente exclusiva de 1º DEV.',
            });
        }
        const parsed = SyncExistingBodySchema.safeParse(req.body || {});
        const opts = parsed.success ? parsed.data : { runAi: true, forceRefreshBroken: true };

        const summary = await ManufacturerRegistryService.syncManufacturersFromExistingEquipment({
            actorUid: caller.actorUid,
            runAi: opts.runAi,
            forceRefreshBroken: opts.forceRefreshBroken,
        });

        return res.status(200).json({
            success: true,
            ...summary,
        });
    } catch (err) {
        return handleRouterError(res, err, 'Error al sincronizar fabricantes desde equipos existentes.');
    }
});

manufacturersRouter.post('/', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox) {
            return res.status(403).json({ error: 'Las cuentas sandbox 5º EDU operan en modo solo lectura.' });
        }
        if (!caller.isDevMaster) {
            return res.status(403).json({ error: 'El alta maestra directa de fabricantes es exclusiva de 1º DEV.' });
        }
        const parsed = DirectCreateManufacturerBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Payload inválido.' });
        }

        const manufacturer = await ManufacturerRegistryService.createDirectManufacturer({
            actorUid: caller.actorUid,
            actorEmail: caller.actorEmail,
            isDevRoot: caller.isDevMaster,
            isEduSandbox: caller.isEduSandbox,
            body: parsed.data,
        });

        return res.status(201).json({ success: true, manufacturer });
    } catch (err) {
        return handleRouterError(res, err, 'Error al registrar fabricante.');
    }
});

// ── DOMINIO 2: AGENDA INDEPENDIENTE DE PROVEEDORES & CANALES ──────────────────

manufacturersRouter.get('/resolve-channels', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        const parsed = SupplierChannelResolveQuerySchema.safeParse(req.query || {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'Parámetros de búsqueda inválidos.' });
        }

        const result = await SupplierChannelResolverService.resolveSupplierChannels({
            ...parsed.data,
            tenantId: caller.tenantId || undefined,
        });

        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        return handleRouterError(res, err, 'Error al resolver canales comerciales.');
    }
});

const ListSuppliersQuerySchema = z.object({
    manufacturerKey: z.string().trim().max(120).optional(),
    channelType: CommercialChannelTypeSchema.optional(),
    countryIso2: z.string().trim().max(4).optional(),
    q: z.string().trim().max(120).optional(),
});

manufacturersRouter.get('/suppliers', async (req: ScopedRequest, res: Response) => {
    try {
        const parsed = ListSuppliersQuerySchema.safeParse(req.query || {});
        const filters = parsed.success ? parsed.data : {};
        const suppliers = await SupplierChannelResolverService.listSuppliers(filters);
        return res.status(200).json({ success: true, suppliers });
    } catch (err) {
        return handleRouterError(res, err, 'Error al consultar agenda de proveedores.');
    }
});

manufacturersRouter.post('/suppliers', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox || !caller.isDevMaster) {
            return res.status(403).json({ error: 'Gestión maestra de distribuidores exclusiva de 1º DEV.' });
        }
        const parsed = UpsertSupplierBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Payload de proveedor inválido.' });
        }

        const supplier = await SupplierChannelResolverService.upsertSupplierDivision({
            ...parsed.data,
            actorUid: caller.actorUid,
            actorEmail: caller.actorEmail,
        });

        return res.status(200).json({ success: true, supplier });
    } catch (err) {
        return handleRouterError(res, err, 'Error al guardar empresa proveedora y división.');
    }
});

manufacturersRouter.post('/suppliers/discover-ai', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox || !caller.isDevMaster) {
            return res.status(403).json({ error: 'Descubrimiento IA de distribuidores exclusivo de 1º DEV.' });
        }
        const parsed = DiscoverSuppliersAiBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Indica país, región o ciudad para investigar.',
            });
        }

        const result = await SupplierChannelResolverService.discoverSuppliersWithAi({
            ...parsed.data,
            actorUid: caller.actorUid,
        });

        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        return handleRouterError(res, err, 'Error en investigación IA de proveedores.');
    }
});

manufacturersRouter.post('/suppliers/approve-ai', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox || !caller.isDevMaster) {
            return res.status(403).json({ error: 'Aprobación maestra HITL exclusiva de 1º DEV.' });
        }
        const parsed = ApproveSuppliersAiBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Confirmación "ACTUALIZAR" y sugerencias válidas requeridas.',
            });
        }

        const result = await SupplierChannelResolverService.approveSupplierAiSuggestions({
            suggestions: parsed.data.suggestions,
            actorUid: caller.actorUid,
            actorEmail: caller.actorEmail,
        });

        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        return handleRouterError(res, err, 'Error al consolidar sugerencias IA en agenda de proveedores.');
    }
});

manufacturersRouter.post('/suppliers/direct', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox || !caller.isDevMaster) {
            return res.status(403).json({ error: 'Alta directa de distribuidores exclusiva de 1º DEV.' });
        }
        const parsed = CreateSupplierDirectHitlBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Payload de distribuidor inválido.' });
        }
        const supplier = await SupplierChannelResolverService.createSupplierDirectHitl({
            ...parsed.data,
            actorUid: caller.actorUid,
            actorEmail: caller.actorEmail,
        });
        return res.status(200).json({ success: true, supplier });
    } catch (err) {
        return handleRouterError(res, err, 'Error al registrar distribuidor directo.');
    }
});

manufacturersRouter.get('/suppliers/:supplierKey', async (req: ScopedRequest, res: Response) => {
    try {
        const supplierKey = String(req.params.supplierKey || '').trim();
        if (!supplierKey) {
            return res.status(400).json({ error: 'Identificador de proveedor inválido.' });
        }
        const supplier = await SupplierChannelResolverService.getSupplierByKey(supplierKey);
        if (!supplier) {
            return res.status(404).json({ error: 'Distribuidor/proveedor no encontrado.' });
        }
        return res.status(200).json({ success: true, supplier });
    } catch (err) {
        return handleRouterError(res, err, 'Error al consultar espacio de distribuidor.');
    }
});

manufacturersRouter.put('/suppliers/:supplierKey/profile', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox || !caller.isDevMaster) {
            return res.status(403).json({ error: 'Edición tributaria y corporativa SII exclusiva de 1º DEV.' });
        }
        const supplierKey = String(req.params.supplierKey || '').trim();
        if (!supplierKey) {
            return res.status(400).json({ error: 'Identificador de proveedor inválido.' });
        }
        const parsed = UpdateSupplierProfileHitlBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Confirmación "ACTUALIZAR" o datos tributarios SII inválidos.',
            });
        }
        const supplier = await SupplierChannelResolverService.updateSupplierProfileHitl({
            supplierKey,
            ...parsed.data,
            actorUid: caller.actorUid,
            actorEmail: caller.actorEmail,
        });
        return res.status(200).json({ success: true, supplier });
    } catch (err) {
        return handleRouterError(res, err, 'Error al actualizar ficha corporativa / tributaria SII.');
    }
});

manufacturersRouter.post('/suppliers/:supplierKey/contacts', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox || !caller.isDevMaster) {
            return res.status(403).json({ error: 'Gestión de agenda maestra de contactos exclusiva de 1º DEV.' });
        }
        const supplierKey = String(req.params.supplierKey || '').trim();
        if (!supplierKey) {
            return res.status(400).json({ error: 'Identificador de proveedor inválido.' });
        }
        const parsed = UpsertSupplierContactHitlBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Confirmación "ACTUALIZAR" o datos de contacto inválidos.',
            });
        }
        const supplier = await SupplierChannelResolverService.upsertSupplierContactHitl({
            supplierKey,
            ...parsed.data,
            actorUid: caller.actorUid,
            actorEmail: caller.actorEmail,
        });
        return res.status(200).json({ success: true, supplier });
    } catch (err) {
        return handleRouterError(res, err, 'Error al guardar contacto comercial por área.');
    }
});

manufacturersRouter.delete('/suppliers/:supplierKey/contacts/:contactId', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox || !caller.isDevMaster) {
            return res.status(403).json({ error: 'Eliminación en agenda maestra exclusiva de 1º DEV.' });
        }
        const supplierKey = String(req.params.supplierKey || '').trim();
        const contactId = String(req.params.contactId || '').trim();
        if (!supplierKey || !contactId) {
            return res.status(400).json({ error: 'Parámetros inválidos.' });
        }
        const parsed = DeleteSupplierContactHitlBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Confirmación "ACTUALIZAR" obligatoria para eliminar contacto maestro.',
            });
        }
        const supplier = await SupplierChannelResolverService.deleteSupplierContactHitl({
            supplierKey,
            contactId,
            actorUid: caller.actorUid,
            actorEmail: caller.actorEmail,
        });
        return res.status(200).json({ success: true, supplier });
    } catch (err) {
        return handleRouterError(res, err, 'Error al eliminar contacto de distribuidor.');
    }
});

manufacturersRouter.post('/suppliers/:supplierKey/discover-areas-ai', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox || !caller.isDevMaster) {
            return res.status(403).json({ error: 'Descubrimiento IA de áreas comerciales exclusivo de 1º DEV.' });
        }
        const supplierKey = String(req.params.supplierKey || '').trim();
        if (!supplierKey) {
            return res.status(400).json({ error: 'Identificador de proveedor inválido.' });
        }
        const parsed = DiscoverSupplierAreasAiBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Parámetros IA inválidos.' });
        }
        const result = await SupplierChannelResolverService.discoverSupplierAreasWithAi({
            supplierKey,
            ...parsed.data,
            actorUid: caller.actorUid,
        });
        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        return handleRouterError(res, err, 'Error en investigación IA de áreas comerciales.');
    }
});

manufacturersRouter.get('/suppliers/:supplierKey/billing-rule', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox) {
            return res.status(200).json({ success: true, billingRule: null, blockedByEduSandbox: true });
        }
        const supplierKey = String(req.params.supplierKey || '').trim();
        if (!caller.tenantId || !supplierKey) {
            return res.status(200).json({ success: true, billingRule: null });
        }
        const billingRule = await SupplierChannelResolverService.getTenantSupplierBillingRule({
            tenantId: caller.tenantId,
            supplierKey,
        });
        return res.status(200).json({ success: true, billingRule });
    } catch (err) {
        return handleRouterError(res, err, 'Error al consultar reglas contractuales B2B de facturación.');
    }
});

manufacturersRouter.put('/suppliers/:supplierKey/billing-rule', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox) {
            return res.status(403).json({ error: 'Las cuentas sandbox 5º EDU operan en modo solo lectura.' });
        }
        if (!caller.tenantId) {
            return res.status(400).json({ error: 'Cuenta organizacional B2B requerida.' });
        }
        const supplierKey = String(req.params.supplierKey || '').trim();
        if (!supplierKey) {
            return res.status(400).json({ error: 'Identificador de proveedor inválido.' });
        }
        const parsed = UpsertTenantSupplierBillingRuleBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Confirmación "ACTUALIZAR" o reglas contractuales inválidas.',
            });
        }
        const billingRule = await SupplierChannelResolverService.upsertTenantSupplierBillingRule({
            tenantId: caller.tenantId,
            supplierKey,
            ...parsed.data,
            actorUid: caller.actorUid,
            actorEmail: caller.actorEmail,
        });
        return res.status(200).json({ success: true, billingRule });
    } catch (err) {
        return handleRouterError(res, err, 'Error al guardar reglas contractuales B2B de facturación.');
    }
});

// ── AGENDA PRIVADA POR TENANT & APORTES COMUNITARIOS (LEY N° 21.719) ─────────

manufacturersRouter.get('/contacts/private', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (!caller.tenantId) return res.status(200).json({ success: true, contacts: [] });
        const rawMfgFilter = typeof req.query.manufacturerKey === 'string' ? req.query.manufacturerKey.trim() : '';
        const rawSupplierFilter = typeof req.query.supplierKey === 'string' ? req.query.supplierKey.trim() : '';
        const contacts = await SupplierChannelResolverService.listTenantPrivateContacts(caller.tenantId, {
            ...(rawMfgFilter ? { manufacturerKey: rawMfgFilter } : {}),
            ...(rawSupplierFilter ? { supplierKey: rawSupplierFilter } : {}),
        });
        return res.status(200).json({ success: true, contacts });
    } catch (err) {
        return handleRouterError(res, err, 'Error al leer contactos privados de empresa.');
    }
});

manufacturersRouter.post('/contacts/private', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox) {
            return res.status(403).json({ error: 'Las cuentas sandbox 5º EDU operan en modo solo lectura.' });
        }
        if (!caller.tenantId) {
            return res.status(400).json({ error: 'Cuenta organizacional requerida.' });
        }
        const parsed = UpsertTenantPrivateContactBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Payload inválido.' });
        }
        const contact = await SupplierChannelResolverService.upsertTenantPrivateContact({
            ...parsed.data,
            tenantId: caller.tenantId,
            actorUid: caller.actorUid,
            actorEmail: caller.actorEmail,
        });
        return res.status(200).json({ success: true, contact });
    } catch (err) {
        return handleRouterError(res, err, 'Error al guardar contacto privado.');
    }
});

manufacturersRouter.delete('/contacts/private/:contactId', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox) {
            return res.status(403).json({ error: 'Las cuentas sandbox 5º EDU operan en modo solo lectura.' });
        }
        if (!caller.tenantId || !req.params.contactId) {
            return res.status(400).json({ error: 'Parámetros inválidos.' });
        }
        await SupplierChannelResolverService.deleteTenantPrivateContact({
            tenantId: caller.tenantId,
            contactId: String(req.params.contactId),
            actorUid: caller.actorUid,
            actorEmail: caller.actorEmail,
        });
        return res.status(200).json({ success: true, deletedContactId: req.params.contactId });
    } catch (err) {
        return handleRouterError(res, err, 'Error al eliminar contacto privado.');
    }
});

manufacturersRouter.get('/contributions', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (!caller.isDevOrAdmin) {
            return res.status(403).json({ error: 'Acceso restringido a 1º DEV y 2º ADMIN.' });
        }
        const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
        const status =
            statusParam === 'PENDING_REVIEW' || statusParam === 'APPROVED' || statusParam === 'REJECTED'
                ? statusParam
                : undefined;
        const contributions = await SupplierChannelResolverService.listContributions(status);
        return res.status(200).json({ success: true, contributions });
    } catch (err) {
        return handleRouterError(res, err, 'Error al listar aportes comunitarios.');
    }
});

manufacturersRouter.post('/contributions', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox) {
            return res.status(403).json({ error: 'Las cuentas académicas 5º EDU operan en modo solo lectura.' });
        }
        const parsed = SubmitSupplierContributionBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Payload de aporte inválido.' });
        }
        const contribution = await SupplierChannelResolverService.submitSupplierContribution({
            ...parsed.data,
            tenantId: caller.tenantId || caller.actorUid,
            actorUid: caller.actorUid,
        });
        return res.status(201).json({ success: true, contribution });
    } catch (err) {
        return handleRouterError(res, err, 'Error al enviar aporte de distribuidor.');
    }
});

manufacturersRouter.post('/contributions/:contributionId/moderate', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox || !caller.isDevMaster) {
            return res.status(403).json({ error: 'Moderación HITL exclusiva de 1º DEV.' });
        }
        const parsed = ModerateSupplierContributionBodySchema.safeParse(req.body || {});
        if (!parsed.success || !req.params.contributionId) {
            return res.status(400).json({ error: parsed.success === false ? parsed.error.issues[0]?.message : 'Inválido.' });
        }
        const result = await SupplierChannelResolverService.moderateSupplierContribution({
            contributionId: String(req.params.contributionId),
            decision: parsed.data.decision,
            actorUid: caller.actorUid,
            actorEmail: caller.actorEmail,
        });
        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        return handleRouterError(res, err, 'Error al moderar aporte comunitario.');
    }
});

// ── RUTAS PARAMÉTRICAS DE FABRICANTE OEM (`/:manufacturerKey`) ────────────────

const ManufacturerKeyParamSchema = z.object({
    manufacturerKey: z.string().trim().min(1).max(120),
});

manufacturersRouter.get('/:manufacturerKey', async (req: ScopedRequest, res: Response) => {
    try {
        const parsedParams = ManufacturerKeyParamSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return res.status(400).json({ error: 'Identificador de fabricante inválido.' });
        }
        const manufacturer = await ManufacturerRegistryService.getManufacturerByKey(parsedParams.data.manufacturerKey);
        if (!manufacturer) {
            return res.status(404).json({ error: 'Fabricante no encontrado.' });
        }

        const [linkedSuppliers, registeredEquipment] = await Promise.all([
            SupplierChannelResolverService.listSuppliers({
                manufacturerKey: manufacturer.manufacturerKey,
            }),
            ManufacturerRegistryService.listRegisteredEquipmentByManufacturer(manufacturer.manufacturerKey),
        ]);

        return res.status(200).json({
            success: true,
            manufacturer: {
                ...manufacturer,
                linkedSuppliersCount: linkedSuppliers.length,
            },
            linkedSuppliersCount: linkedSuppliers.length,
            registeredEquipment,
        });
    } catch (err) {
        return handleRouterError(res, err, 'Error al obtener detalle de fabricante.');
    }
});

manufacturersRouter.put('/:manufacturerKey', async (req: ScopedRequest, res: Response) => {
    try {
        const caller = resolveCallerAuth(req);
        if (caller.isEduSandbox || !caller.isDevMaster) {
            return res.status(403).json({ error: 'Edición maestra exclusiva de 1º DEV.' });
        }
        const parsedParams = ManufacturerKeyParamSchema.safeParse(req.params);
        const parsedBody = UpdateManufacturerHitlBodySchema.safeParse(req.body || {});
        if (!parsedParams.success || !parsedBody.success) {
            return res.status(400).json({
                error: !parsedBody.success
                    ? parsedBody.error.issues[0]?.message || 'Confirmación "ACTUALIZAR" o datos inválidos.'
                    : 'Clave inválida.',
            });
        }
        const manufacturer = await ManufacturerRegistryService.updateManufacturerHitl({
            manufacturerKey: parsedParams.data.manufacturerKey,
            actorUid: caller.actorUid,
            actorEmail: caller.actorEmail,
            body: parsedBody.data,
        });
        return res.status(200).json({ success: true, manufacturer });
    } catch (err) {
        return handleRouterError(res, err, 'Error al actualizar fabricante.');
    }
});

manufacturersRouter.post(
    '/:manufacturerKey/upload-logo',
    uploadLogoMiddleware.single('file'),
    async (req: ScopedRequest, res: Response) => {
        try {
            const caller = resolveCallerAuth(req);
            if (caller.isEduSandbox || !caller.isDevMaster) {
                return res.status(403).json({ error: 'Carga maestra de logotipos CAS exclusiva de 1º DEV.' });
            }
            const parsedParams = ManufacturerKeyParamSchema.safeParse(req.params);
            if (!parsedParams.success || !req.file?.buffer) {
                return res.status(400).json({ error: 'Archivo gráfico SVG/PNG/WEBP obligatorio.' });
            }
            const result = await ManufacturerRegistryService.appendManualLogoCandidate({
                manufacturerKey: parsedParams.data.manufacturerKey,
                fileBuffer: req.file.buffer,
                filename: req.file.originalname || 'logo.svg',
                actorUid: caller.actorUid,
            });
            return res.status(200).json({ success: true, ...result });
        } catch (err) {
            return handleRouterError(res, err, 'Error al procesar y consolidar emblema CAS.');
        }
    }
);

export default manufacturersRouter;
