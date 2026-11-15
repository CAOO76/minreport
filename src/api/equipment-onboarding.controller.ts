import crypto from 'crypto';
import { NextFunction, Response, Router } from 'express';
import admin, { db } from '../config/firebase';
import { env } from '../config/env';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { extractClientIp, mutationRateLimiter } from '../middleware/rateLimiter';
import { AuditLedger } from '../core/audit-ledger';
import { computeThirtyDayTtlTimestamp } from '../core/retention-policy';
import {
    CreateEquipmentOnboardingRequestSchema,
    type EquipmentOnboardingResource,
    PublishEquipmentOnboardingSchema,
    ReviewEquipmentOnboardingSchema,
} from '../contracts/session.contracts';
import { invalidateCatalogProjectionCache } from '../modules/opermaq/routes/assets.routes';
import { triggerAsyncManufacturerDiscovery } from '../modules/opermaq/services/ManufacturerRegistryService';
import {
    extractHomologousAxisValues,
    type CanonicalSpecSlot,
} from '../modules/opermaq/utils/canonicalArchetypeSpecs';

const router = Router();

router.use((req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.uid) {
        return next();
    }
    return requireAuth(req, res, next);
});

export interface CasTelemetryValidationResult {
    valid: boolean;
    reason?: string;
    totalOriginalBytes: number;
    totalOptimizedBytes: number;
    totalSavingsPct: number;
}

/**
 * Construye una clave canónica determinista de catálogo (sin tildes, mayúsculas A-Z0-9, separada por '_').
 */
export function buildCanonicalCatalogKey(make: string, model: string): string {
    const normalizeToken = (value: string, fallback: string): string => {
        const cleaned = String(value || '')
            .trim()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        return cleaned || fallback;
    };
    return `${normalizeToken(make, 'GENERICO')}_${normalizeToken(model, 'EQUIPO')}`;
}

/**
 * Valida que todo recurso multimedia de onboarding use almacenamiento CAS optimizado
 * y rechaza de raíz buffers data: / base64 crudos.
 */
export function validateEquipmentResourcesCasTelemetry(
    resources: ReadonlyArray<Partial<EquipmentOnboardingResource>>
): CasTelemetryValidationResult {
    if (!Array.isArray(resources) || resources.length === 0) {
        return {
            valid: false,
            reason: 'Debe adjuntar al menos un recurso multimedia optimizado en CAS.',
            totalOriginalBytes: 0,
            totalOptimizedBytes: 0,
            totalSavingsPct: 0,
        };
    }

    let totalOriginalBytes = 0;
    let totalOptimizedBytes = 0;

    for (const resource of resources) {
        const url = String(resource?.downloadUrl || '').trim();
        const urlLower = url.toLowerCase();
        if (!url || urlLower.startsWith('data:') || urlLower.includes('data:') || urlLower.includes(';base64,')) {
            return {
                valid: false,
                reason: 'Rechazo CAS: downloadUrl no puede contener buffers data: o ;base64,.',
                totalOriginalBytes: 0,
                totalOptimizedBytes: 0,
                totalSavingsPct: 0,
            };
        }

        const sha = String(resource?.sha256 || '').trim();
        if (!/^[a-f0-9]{64}$/i.test(sha)) {
            return {
                valid: false,
                reason: 'Rechazo CAS: cada recurso requiere un sha256 válido de 64 caracteres hexadecimales.',
                totalOriginalBytes: 0,
                totalOptimizedBytes: 0,
                totalSavingsPct: 0,
            };
        }

        const originalBytes = Number(resource?.originalBytes);
        const optimizedBytes = Number(resource?.optimizedBytes);
        if (!Number.isFinite(originalBytes) || originalBytes <= 0 || !Number.isFinite(optimizedBytes) || optimizedBytes <= 0) {
            return {
                valid: false,
                reason: 'Rechazo CAS: originalBytes y optimizedBytes deben ser enteros positivos (> 0).',
                totalOriginalBytes: 0,
                totalOptimizedBytes: 0,
                totalSavingsPct: 0,
            };
        }

        totalOriginalBytes += Math.round(originalBytes);
        totalOptimizedBytes += Math.round(optimizedBytes);
    }

    const rawSavingsPct =
        totalOriginalBytes > 0 ? ((totalOriginalBytes - totalOptimizedBytes) / totalOriginalBytes) * 100 : 0;
    const totalSavingsPct = Math.min(100, Math.max(0, Math.round(rawSavingsPct * 10) / 10));

    return {
        valid: true,
        totalOriginalBytes,
        totalOptimizedBytes,
        totalSavingsPct,
    };
}

function isCallerDevRoot(user: Record<string, any> | undefined): boolean {
    if (!user?.uid) return false;
    const uid = String(user.uid);
    const emailLower = String(user.email || '').toLowerCase();
    const emailVerifiedOk = user.email_verified !== false;
    const tokenRole = String(user.role || '').toUpperCase();
    return (
        uid === 'dev-master-root-uid' ||
        tokenRole === 'DEV_ROOT' ||
        user.isMasterDev === true ||
        (emailVerifiedOk && emailLower === 'dev@minreport.com')
    );
}

function isCallerSuperAdmin(user: Record<string, any> | undefined): boolean {
    if (!user?.uid) return false;
    const uid = String(user.uid);
    const emailLower = String(user.email || '').toLowerCase();
    const emailVerifiedOk = user.email_verified !== false;
    const tokenRole = String(user.role || '').toUpperCase();
    return (
        user.admin === true ||
        tokenRole === 'SUPER_ADMIN' ||
        uid === 'super-admin-uid' ||
        (emailVerifiedOk &&
            (emailLower === 'admin@minreport.com' ||
                emailLower === env.SUPER_ADMIN_EMAIL.toLowerCase()))
    );
}

export const verifyDevRoot = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user?.uid) {
        return res.status(401).json({ error: 'Acceso no autorizado: token ausente.' });
    }
    if (!isCallerDevRoot(req.user)) {
        return res.status(403).json({
            error: 'Prohibido: Acción exclusiva de Cuenta Maestra de Desarrollo (1º DEV / DEV_ROOT).',
        });
    }
    return next();
};

function isInactiveStatus(status: unknown): boolean {
    const st = String(status || 'ACTIVE').trim().toUpperCase();
    return st === 'SUSPENDED' || st === 'REVOKED' || st === 'INACTIVE' || st === 'DELETED';
}

function isEduAccount(accountData: Record<string, any>): boolean {
    const typeUpper = String(accountData.type || '').toUpperCase();
    const classLower = String(accountData.classification || '').toLowerCase();
    return typeUpper === 'EDUCATIONAL' || classLower === 'edu' || accountData.isEduSandbox === true;
}

async function resolveCallerRoleInAccount(
    uid: string,
    accountId: string,
    accountData: Record<string, any>
): Promise<{ isMember: boolean; role: string }> {
    if (accountData.ownerId === uid) {
        return { isMember: true, role: 'OWNER' };
    }

    const userSnap = await db.collection('users').doc(uid).get();
    if (userSnap.exists) {
        const memberships = userSnap.data()?.memberships;
        if (Array.isArray(memberships)) {
            const mem = memberships.find((m: any) => m?.accountId === accountId);
            if (mem && !isInactiveStatus(mem?.status)) {
                const rawRole = String(mem.role || 'OPERATOR').toUpperCase();
                return { isMember: true, role: rawRole };
            }
        }
    }

    const memberSnap = await db.collection('accounts').doc(accountId).collection('members').doc(uid).get();
    if (memberSnap.exists) {
        const mData = memberSnap.data() || {};
        if (!isInactiveStatus(mData.status)) {
            const rawRole = String(mData.role || 'OPERATOR').toUpperCase();
            return { isMember: true, role: rawRole };
        }
    }

    return { isMember: false, role: '' };
}

async function lookupCatalogDocByKeys(catalogKey: string): Promise<FirebaseFirestore.DocumentSnapshot | null> {
    const exactQuery = await db
        .collection('global_asset_catalog')
        .where('catalog_key', '==', catalogKey)
        .limit(1)
        .get();
    if (!exactQuery.empty) {
        return exactQuery.docs[0];
    }

    const lowerKey = catalogKey.toLowerCase();
    if (lowerKey !== catalogKey) {
        const lowerQuery = await db
            .collection('global_asset_catalog')
            .where('catalog_key', '==', lowerKey)
            .limit(1)
            .get();
        if (!lowerQuery.empty) {
            return lowerQuery.docs[0];
        }
    }

    const directUpper = await db.collection('global_asset_catalog').doc(catalogKey).get();
    if (directUpper.exists) {
        return directUpper;
    }

    if (lowerKey !== catalogKey) {
        const directLower = await db.collection('global_asset_catalog').doc(lowerKey).get();
        if (directLower.exists) {
            return directLower;
        }
    }

    return null;
}

function buildCanonicalSearchMetadata(params: {
    makeOficial: string;
    modelOficial: string;
    tipoEquipo: string;
    categoriaEquipo: string;
    manufacturerRef?: string;
    modelRef?: string;
}): { search_aliases: string[]; search_tokens: string[] } {
    const normalizeText = (input: string): string =>
        String(input || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();

    const aliases = new Set<string>();
    for (const candidate of [
        `${params.makeOficial} ${params.modelOficial}`,
        params.makeOficial,
        params.modelOficial,
        `${params.manufacturerRef || ''} ${params.modelRef || ''}`,
        params.modelRef || '',
    ]) {
        const norm = normalizeText(candidate);
        if (norm.length >= 2) aliases.add(norm);
    }

    const tokens = new Set<string>();
    const tokenCorpus = normalizeText(
        `${params.makeOficial} ${params.modelOficial} ${params.tipoEquipo} ${params.categoriaEquipo} ${params.manufacturerRef || ''} ${params.modelRef || ''}`
    );
    for (const token of tokenCorpus.split(/\s+/)) {
        if (token.length >= 2) {
            tokens.add(token);
        }
    }

    return {
        search_aliases: Array.from(aliases),
        search_tokens: Array.from(tokens),
    };
}

/**
 * Selecciona una imagen pública global del catálogo para `global_asset_catalog.foto_url`.
 * Excluye `NAMEPLATE_PHOTO` (placas con serie/PII) y cualquier ruta privada de tenant
 * (`/api/media/blob/tenant/...`) conforme a Ley 21.719 y aislamiento multi-tenant.
 */
export function resolvePublicCatalogPhotoUrl(resources: unknown): string {
    if (!Array.isArray(resources)) return '';
    const imageCandidate = resources.find((res: any) => {
        if (!res || typeof res.downloadUrl !== 'string') return false;
        const kind = String(res.kind || '').toUpperCase();
        if (kind === 'NAMEPLATE_PHOTO') return false;
        const mime = String(res.mimeType || '').toLowerCase();
        const isImage =
            kind === 'UNIT_PHOTO' ||
            kind === 'DIAGRAM_IMAGE' ||
            mime.startsWith('image/');
        if (!isImage) return false;

        const url = res.downloadUrl.trim();
        const urlLower = url.toLowerCase();
        if (
            !url ||
            urlLower.startsWith('data:') ||
            urlLower.includes(';base64,') ||
            urlLower.includes('/api/media/blob/tenant/')
        ) {
            return false;
        }
        return (
            url.startsWith('/api/media/blob/global_oem/') ||
            url.startsWith('/api/media/blob/symbology/')
        );
    });
    return imageCandidate ? String(imageCandidate.downloadUrl).trim() : '';
}

function extractSortableTimestampMs(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value && typeof (value as any).toMillis === 'function') {
        return Number((value as any).toMillis()) || 0;
    }
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

interface FleetIdentityDescriptor {
    identifierType: string;
    identifierValue: string;
    compactId: string;
    uniquenessKey: string | null;
}

function normalizeCompactFleetId(raw: unknown): string {
    return String(raw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

function buildFleetIdentityDescriptor(params: {
    unitIdentifierType: unknown;
    unitIdentifierValue: unknown;
    makeOficial: string;
    modelOficial: string;
    targetTenantId: string;
}): FleetIdentityDescriptor {
    const identifierType = String(params.unitIdentifierType || 'CODIGO_INTERNO').trim() || 'CODIGO_INTERNO';
    const identifierValue = String(
        params.unitIdentifierValue || `${params.makeOficial}-${params.modelOficial}`
    )
        .trim()
        .toUpperCase();
    const compactId = normalizeCompactFleetId(identifierValue);
    const uniquenessKey =
        compactId && params.targetTenantId
            ? crypto
                  .createHash('sha256')
                  .update(`${params.targetTenantId}:${identifierType}:${compactId}`)
                  .digest('hex')
            : null;
    return {
        identifierType,
        identifierValue,
        compactId,
        uniquenessKey,
    };
}

function normalizeSpecCompareToken(raw: string): string {
    return String(raw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function slugifySpecAxisKey(label: string, fallbackIndex: number): string {
    const slug = String(label || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
    return slug || `spec_extra_${fallbackIndex}`;
}

export function buildOnboardingCanonicalSpecs(params: {
    tipoEquipo: string;
    categoriaEquipo: string;
    caracteristicasPrincipales: string[];
}): CanonicalSpecSlot[] {
    const cleanLines = Array.isArray(params.caracteristicasPrincipales)
        ? params.caracteristicasPrincipales
              .map((line) => String(line || '').replace(/\s+/g, ' ').trim())
              .filter((line) => line.length > 0 && !line.startsWith('['))
        : [];

    const homologous = extractHomologousAxisValues({
        tipo_equipo: params.tipoEquipo,
        categoria_equipo: params.categoriaEquipo,
        caracteristicas_principales: cleanLines,
    });

    const usedAxisKeys = new Set<string>(homologous.slots.map((slot) => slot.axis_key));
    const extraSlots: CanonicalSpecSlot[] = [];

    for (const line of cleanLines) {
        let labelEs = '';
        let valueSi = '';
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
            labelEs = line.slice(0, colonIdx).trim();
            valueSi = line.slice(colonIdx + 1).trim();
        } else {
            const metricMatch = line.match(/^(.+?)\s+([+-]?\d[\d.,]*\s*[A-Za-z%°\/]+.*)$/);
            if (metricMatch) {
                labelEs = metricMatch[1].trim();
                valueSi = metricMatch[2].trim();
            }
        }

        if (!labelEs || !valueSi || valueSi.startsWith('[')) {
            continue;
        }

        const normLabel = normalizeSpecCompareToken(labelEs);
        const normValue = normalizeSpecCompareToken(valueSi);
        if (!normLabel || !normValue) {
            continue;
        }

        const capturedInHomologous = homologous.slots.some((slot) => {
            if (!slot.value_si) return false;
            return (
                normalizeSpecCompareToken(slot.value_si) === normValue ||
                normalizeSpecCompareToken(slot.label_es) === normLabel
            );
        });
        const capturedInExtra = extraSlots.some(
            (slot) => normalizeSpecCompareToken(slot.label_es) === normLabel
        );
        if (capturedInHomologous || capturedInExtra) {
            continue;
        }

        const baseSlug = slugifySpecAxisKey(labelEs, extraSlots.length + 1);
        let axisKey = baseSlug;
        let suffix = 2;
        while (usedAxisKeys.has(axisKey)) {
            axisKey = `${baseSlug}_${suffix++}`;
        }
        usedAxisKeys.add(axisKey);

        extraSlots.push({
            axis_key: axisKey,
            label_es: labelEs,
            value_si: valueSi,
            mandatory: false,
            value_kind: /\d/.test(valueSi) ? 'PHYSICAL_MAGNITUDE' : 'CLOSED_ENUM',
        });
    }

    return [...homologous.slots, ...extraSlots];
}

/**
 * GET /api/equipment-onboarding
 */
router.get('/', async (req: AuthRequest, res: Response): Promise<any> => {
    try {
        const caller = req.user;
        if (!caller?.uid) {
            return res.status(401).json({ error: 'No autorizado: sesión ausente.' });
        }

        const isSovereignReader = isCallerDevRoot(caller) || isCallerSuperAdmin(caller);
        const rawStatusFilter = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : '';
        const statusFilter = rawStatusFilter === 'ALL' ? '' : rawStatusFilter;
        const queryAccountId = typeof req.query.accountId === 'string' ? req.query.accountId.trim() : '';

        if (isSovereignReader) {
            let query: FirebaseFirestore.Query = db.collection('equipment_onboarding_requests');
            if (statusFilter) {
                query = query.where('status', '==', statusFilter);
            }
            if (queryAccountId) {
                query = query.where('tenantId', '==', queryAccountId);
            }
            const snap = await query.limit(100).get();
            const requests = snap.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .sort(
                    (a: any, b: any) =>
                        extractSortableTimestampMs(b.createdAt) - extractSortableTimestampMs(a.createdAt)
                );
            return res.status(200).json({ requests });
        }

        const callerUid = String(caller.uid);
        let resolvedAccountId = String(
            queryAccountId ||
                req.headers['x-active-account-id'] ||
                req.headers['x-tenant-id'] ||
                caller.activeAccountId ||
                ''
        ).trim();

        if (!resolvedAccountId) {
            const userSnap = await db.collection('users').doc(callerUid).get();
            if (userSnap.exists) {
                const uData = userSnap.data() || {};
                resolvedAccountId = String(
                    uData.lastActiveAccountId ||
                        uData.primaryAccountId ||
                        uData.memberships?.[0]?.accountId ||
                        ''
                ).trim();
            }
        }

        if (!resolvedAccountId) {
            return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
        }

        const accSnap = await db.collection('accounts').doc(resolvedAccountId).get();
        if (!accSnap.exists) {
            return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
        }

        const accountData = accSnap.data() || {};
        if (isEduAccount(accountData)) {
            return res.status(403).json({
                error: 'LICENCIA_RESTRINGIDA: El entorno académico EDU no habilita solicitudes de catálogo corporativo.',
            });
        }

        const membershipCheck = await resolveCallerRoleInAccount(callerUid, resolvedAccountId, accountData);
        if (!membershipCheck.isMember) {
            return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
        }

        const snap = await db
            .collection('equipment_onboarding_requests')
            .where('tenantId', '==', resolvedAccountId)
            .limit(50)
            .get();

        const requests = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((item: any) => (!statusFilter ? true : String(item.status || '').toUpperCase() === statusFilter))
            .sort(
                (a: any, b: any) =>
                    extractSortableTimestampMs(b.createdAt) - extractSortableTimestampMs(a.createdAt)
            );

        return res.status(200).json({ requests });
    } catch (error: any) {
        console.error('[EquipmentOnboarding] Error listando solicitudes:', error);
        return res.status(500).json({ error: error?.message || 'Error al listar solicitudes de equipos.' });
    }
});

/**
 * POST /api/equipment-onboarding
 */
router.post('/', mutationRateLimiter, async (req: AuthRequest, res: Response): Promise<any> => {
    try {
        const caller = req.user;
        if (!caller?.uid) {
            return res.status(401).json({ error: 'No autorizado: sesión ausente.' });
        }

        const parsed = CreateEquipmentOnboardingRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Validación de solicitud de equipo fallida.',
                details: parsed.error.format(),
            });
        }

        const data = parsed.data;
        const casCheck = validateEquipmentResourcesCasTelemetry(data.resources);
        if (!casCheck.valid) {
            return res.status(400).json({ error: casCheck.reason || 'Telemetría CAS inválida.' });
        }

        const accountSnap = await db.collection('accounts').doc(data.accountId).get();
        if (!accountSnap.exists) {
            return res.status(404).json({ error: 'Cuenta corporativa no encontrada.' });
        }

        const accountData = accountSnap.data() || {};
        const accountStatus = String(accountData.status || '').toUpperCase();
        if (isEduAccount(accountData) || accountStatus !== 'ACTIVE') {
            return res.status(403).json({
                error: 'CUENTA_NO_HABILITADA: Solo cuentas B2B activas pueden enviar solicitudes de alta al Catálogo Maestro.',
            });
        }

        const callerUid = String(caller.uid);
        const callerEmail = String(caller.email || '').toLowerCase();
        const membership = await resolveCallerRoleInAccount(callerUid, data.accountId, accountData);
        const allowedSubmitterRoles = new Set(['OWNER', 'ADMIN', 'ADMINISTRADOR OPERATIVO']);

        if (!membership.isMember || !allowedSubmitterRoles.has(membership.role)) {
            return res.status(403).json({
                error: 'Prohibido: Solo usuarios OWNER o ADMIN de la cuenta B2B pueden solicitar alta de equipos nuevos.',
            });
        }

        const catalogKey = buildCanonicalCatalogKey(data.manufacturerRef, data.modelRef);
        const existingCatalogDoc = await lookupCatalogDocByKeys(catalogKey);

        if (existingCatalogDoc && existingCatalogDoc.exists && existingCatalogDoc.data()?.archived !== true) {
            return res.status(409).json({
                error: 'El equipo ya existe en el Catálogo Maestro oficial.',
                alreadyInCatalog: true,
                globalAssetId: existingCatalogDoc.id,
            });
        }

        const nowMs = Date.now();
        const requestPayload = {
            accountId: data.accountId,
            tenantId: data.accountId,
            accountName: String(accountData.name || ''),
            manufacturerRef: data.manufacturerRef,
            modelRef: data.modelRef,
            catalogKey,
            equipmentCategory: data.equipmentCategory,
            versionOrSeries: data.versionOrSeries || '',
            unitIdentifierType: data.unitIdentifierType,
            unitIdentifierValue: data.unitIdentifierValue || '',
            ownershipType: data.ownershipType,
            horometer: data.horometer,
            operationalNotes: data.operationalNotes || '',
            resources: data.resources,
            casTelemetry: {
                totalOriginalBytes: casCheck.totalOriginalBytes,
                totalOptimizedBytes: casCheck.totalOptimizedBytes,
                totalSavingsPct: casCheck.totalSavingsPct,
                resourceCount: data.resources.length,
            },
            totalOriginalBytes: casCheck.totalOriginalBytes,
            totalOptimizedBytes: casCheck.totalOptimizedBytes,
            totalSavingsPct: casCheck.totalSavingsPct,
            status: 'PENDING_DEV_REVIEW',
            requestedByUid: callerUid,
            requestedByEmail: callerEmail,
            requestedByRole: membership.role,
            publishedGlobalAssetId: null,
            publishedTenantAssetId: null,
            reviewedByUid: null,
            reviewedByEmail: null,
            reviewedAt: null,
            reviewNotes: '',
            createdAt: nowMs,
            updatedAt: nowMs,
        };

        const createdRef = await db.collection('equipment_onboarding_requests').add(requestPayload);

        triggerAsyncManufacturerDiscovery({
            rawMake: data.manufacturerRef,
            sampleModel: data.modelRef,
            sampleEquipmentType: data.equipmentCategory,
            isNewEquipmentRecord: true,
            actorUid: callerUid,
        });

        await AuditLedger.record({
            tenantId: data.accountId,
            actorUid: callerUid,
            actorEmail: callerEmail || 'b2b-admin@minreport.local',
            action: 'EQUIPMENT_ONBOARDING_REQUESTED',
            module: 'b2b-core',
            targetEntity: createdRef.id,
            details: {
                catalogKey,
                manufacturerRef: data.manufacturerRef,
                modelRef: data.modelRef,
                resourceCount: data.resources.length,
                totalOriginalBytes: casCheck.totalOriginalBytes,
                totalOptimizedBytes: casCheck.totalOptimizedBytes,
                totalSavingsPct: casCheck.totalSavingsPct,
            },
            ipAddress: extractClientIp(req),
        });

        return res.status(201).json({
            requestId: createdRef.id,
            status: 'PENDING_DEV_REVIEW',
        });
    } catch (error: any) {
        console.error('[EquipmentOnboarding] Error creando solicitud:', error);
        return res.status(500).json({ error: error?.message || 'Error al registrar solicitud de equipo.' });
    }
});

/**
 * POST /api/equipment-onboarding/:requestId/publish
 */
router.post(
    '/:requestId/publish',
    verifyDevRoot,
    mutationRateLimiter,
    async (req: AuthRequest, res: Response): Promise<any> => {
        try {
            const requestId = String(req.params.requestId || '').trim();
            if (!requestId) {
                return res.status(400).json({ error: 'Identificador requestId obligatorio.' });
            }

            const parsed = PublishEquipmentOnboardingSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: parsed.error.issues[0]?.message || 'Validación HITL fallida para publicación en Catálogo Maestro.',
                    details: parsed.error.format(),
                });
            }

            const data = parsed.data;
            const requestRef = db.collection('equipment_onboarding_requests').doc(requestId);
            const requestSnap = await requestRef.get();
            if (!requestSnap.exists) {
                return res.status(404).json({ error: 'Solicitud de onboarding de equipo no encontrada.' });
            }

            const requestData = requestSnap.data() || {};
            if (String(requestData.status || '').toUpperCase() === 'PUBLISHED') {
                return res.status(409).json({
                    error: 'Esta solicitud ya fue publicada previamente en el Catálogo Maestro.',
                    publishedGlobalAssetId: requestData.publishedGlobalAssetId || null,
                    publishedTenantAssetId: requestData.publishedTenantAssetId || null,
                });
            }

            const makeOficial = data.makeOficial.trim().toUpperCase();
            const modelOficial = data.modelOficial.trim().toUpperCase();
            const version = data.version.trim() || 'ESTÁNDAR';
            const catalogKey = buildCanonicalCatalogKey(makeOficial, modelOficial);
            const nowMs = Date.now();
            const reviewerUid = String(req.user?.uid || 'dev-master-root-uid');
            const reviewerEmail = String(req.user?.email || 'dev@minreport.com');
            const targetTenantId = String(requestData.tenantId || requestData.accountId || '').trim();
            const shouldRegisterFleet = data.autoRegisterFleetUnit !== false && Boolean(targetTenantId);
            const fleetIdentity = shouldRegisterFleet
                ? buildFleetIdentityDescriptor({
                      unitIdentifierType: requestData.unitIdentifierType,
                      unitIdentifierValue: requestData.unitIdentifierValue,
                      makeOficial,
                      modelOficial,
                      targetTenantId,
                  })
                : null;

            if (fleetIdentity && (fleetIdentity.uniquenessKey || fleetIdentity.compactId)) {
                const [tenantUnitsCamel, tenantUnitsSnake] = await Promise.all([
                    db.collection('tenant_assets').where('tenantId', '==', targetTenantId).get(),
                    db.collection('tenant_assets').where('tenant_id', '==', targetTenantId).get(),
                ]);
                const existingUnits = [...tenantUnitsCamel.docs, ...tenantUnitsSnake.docs];
                const duplicateUnit = existingUnits.find((docSnap) => {
                    const u = docSnap.data() || {};
                    if (u.archived === true) return false;
                    if (
                        fleetIdentity.uniquenessKey &&
                        u.identity_uniqueness_key &&
                        u.identity_uniqueness_key === fleetIdentity.uniquenessKey
                    ) {
                        return true;
                    }
                    const candidateIds = [u.serial_number, u.identifier_value];
                    return candidateIds.some((rawVal) => {
                        const prevCompact = normalizeCompactFleetId(rawVal);
                        return prevCompact.length > 0 && prevCompact === fleetIdentity.compactId;
                    });
                });

                if (duplicateUnit) {
                    return res.status(409).json({
                        error: 'IDENTIFICADOR_DUPLICADO_EN_FLOTA',
                        message: `Ya existe un equipo activo en la flota con el identificador "${fleetIdentity.identifierValue}". Cada unidad física debe poseer un identificador único.`,
                    });
                }
            }

            let publishedGlobalAssetId = '';
            let catalogDocData: Record<string, any> | null = null;

            const explicitCatalogId = String(data.existingGlobalAssetId || '').trim();
            if (explicitCatalogId) {
                const explicitSnap = await db.collection('global_asset_catalog').doc(explicitCatalogId).get();
                if (explicitSnap.exists) {
                    publishedGlobalAssetId = explicitSnap.id;
                    catalogDocData = explicitSnap.data() || {};
                }
            }

            if (!publishedGlobalAssetId) {
                const existingCatalogSnap = await lookupCatalogDocByKeys(catalogKey);
                if (existingCatalogSnap && existingCatalogSnap.exists) {
                    publishedGlobalAssetId = existingCatalogSnap.id;
                    catalogDocData = existingCatalogSnap.data() || {};
                }
            }

            if (publishedGlobalAssetId && catalogDocData) {
                await db
                    .collection('global_asset_catalog')
                    .doc(publishedGlobalAssetId)
                    .update({
                        archived: false,
                        versions: admin.firestore.FieldValue.arrayUnion(version),
                        chassis_versions: admin.firestore.FieldValue.arrayUnion(version),
                        updatedAt: nowMs,
                    })
                    .catch(() => undefined);
                invalidateCatalogProjectionCache();
            } else {
                const searchMeta = buildCanonicalSearchMetadata({
                    makeOficial,
                    modelOficial,
                    tipoEquipo: data.tipoEquipo.trim(),
                    categoriaEquipo: data.categoriaEquipo.trim().toUpperCase(),
                    manufacturerRef: requestData.manufacturerRef,
                    modelRef: requestData.modelRef,
                });
                const fotoUrl = resolvePublicCatalogPhotoUrl(requestData.resources);
                const canonicalSpecs = buildOnboardingCanonicalSpecs({
                    tipoEquipo: data.tipoEquipo.trim(),
                    categoriaEquipo: data.categoriaEquipo.trim().toUpperCase(),
                    caracteristicasPrincipales: data.caracteristicasPrincipales,
                });
                const newCatalogDoc = {
                    catalog_key: catalogKey,
                    make: makeOficial,
                    model: modelOficial,
                    make_oficial: makeOficial,
                    model_oficial: modelOficial,
                    make_model: `${makeOficial} ${modelOficial}`,
                    tipo_equipo: data.tipoEquipo.trim(),
                    categoria_equipo: data.categoriaEquipo.trim().toUpperCase(),
                    version,
                    versions: [version],
                    chassis_versions: [version],
                    ambiente_operativo: data.ambienteOperativo,
                    contexto_operativo: data.contextoOperativo,
                    caracteristicas_principales: data.caracteristicasPrincipales,
                    canonical_specs: canonicalSpecs.length >= 2 ? canonicalSpecs : [],
                    search_aliases: searchMeta.search_aliases,
                    search_tokens: searchMeta.search_tokens,
                    is_generic: false,
                    is_sealed: false,
                    isSealed: false,
                    knowledge_vault: null,
                    foto_url: fotoUrl,
                    createdBy: reviewerUid,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: nowMs,
                };

                await db.collection('global_asset_catalog').doc(catalogKey).set(newCatalogDoc);
                invalidateCatalogProjectionCache();
                publishedGlobalAssetId = catalogKey;
                catalogDocData = newCatalogDoc;
            }

            let publishedTenantAssetId: string | null = null;

            if (shouldRegisterFleet && fleetIdentity) {
                const { identifierType, identifierValue, uniquenessKey } = fleetIdentity;

                const privatePhotos = Array.isArray(requestData.resources)
                    ? requestData.resources
                          .filter(
                              (r: any) =>
                                  r &&
                                  (r.kind === 'UNIT_PHOTO' ||
                                      r.kind === 'NAMEPLATE_PHOTO' ||
                                      String(r.mimeType || '').toLowerCase().startsWith('image/'))
                          )
                          .map((r: any) => ({
                              sha256: r.sha256,
                              url: r.downloadUrl,
                              downloadUrl: r.downloadUrl,
                              kind: r.kind,
                              originalFilename: r.originalFilename,
                              originalBytes: r.originalBytes,
                              optimizedBytes: r.optimizedBytes,
                              savingsPct: r.savingsPct,
                          }))
                    : [];

                const nowDate = new Date();
                const fleetUnitDoc = {
                    global_asset_id: publishedGlobalAssetId,
                    make_oficial: makeOficial,
                    model_oficial: modelOficial,
                    make_model: `${makeOficial} ${modelOficial}`,
                    categoria_equipo: String(
                        catalogDocData?.categoria_equipo || data.categoriaEquipo.trim().toUpperCase()
                    ),
                    tipo_equipo: String(catalogDocData?.tipo_equipo || data.tipoEquipo.trim()),
                    canonical_specs: Array.isArray(catalogDocData?.canonical_specs)
                        ? catalogDocData!.canonical_specs
                        : [],
                    version,
                    identifier_type: identifierType,
                    identifier_value: identifierValue,
                    serial_number: identifierValue,
                    ...(uniquenessKey ? { identity_uniqueness_key: uniquenessKey } : {}),
                    ownership_type: String(requestData.ownershipType || 'PROPIO'),
                    horometer: typeof requestData.horometer === 'number' ? requestData.horometer : 0,
                    status: 'OPERATIVO',
                    private_photos: privatePhotos,
                    primary_private_photo_url: privatePhotos[0]?.downloadUrl || null,
                    tenant_id: targetTenantId,
                    tenantId: targetTenantId,
                    registered_by: String(requestData.requestedByUid || reviewerUid),
                    registered_by_email: String(requestData.requestedByEmail || reviewerEmail),
                    onboarding_request_id: requestId,
                    archived: false,
                    data_scope: 'PRODUCTION',
                    is_edu_sandbox: false,
                    createdAt: nowDate,
                    updatedAt: nowDate,
                };

                const tenantAssetRef = await db.collection('tenant_assets').add(fleetUnitDoc);
                publishedTenantAssetId = tenantAssetRef.id;
            }

            await requestRef.update({
                status: 'PUBLISHED',
                publishedGlobalAssetId,
                publishedTenantAssetId,
                reviewedByUid: reviewerUid,
                reviewedByEmail: reviewerEmail,
                reviewedAt: nowMs,
                reviewNotes: data.reviewNotes || '',
                updatedAt: nowMs,
            });

            triggerAsyncManufacturerDiscovery({
                rawMake: makeOficial,
                archetypeId: catalogDocData?.archetype_id ? String(catalogDocData.archetype_id) : null,
                sampleModel: String(catalogDocData?.model_oficial || modelOficial || ''),
                sampleEquipmentType: String(catalogDocData?.tipo_equipo || data.tipoEquipo.trim() || ''),
                isNewEquipmentRecord: false,
                actorUid: reviewerUid,
            });

            await AuditLedger.record({
                tenantId: targetTenantId || 'global',
                actorUid: reviewerUid,
                actorEmail: reviewerEmail,
                action: 'EQUIPMENT_ONBOARDING_PUBLISHED',
                module: 'b2b-core',
                targetEntity: requestId,
                details: {
                    publishedGlobalAssetId,
                    publishedTenantAssetId,
                    catalogKey,
                    autoRegisterFleetUnit: data.autoRegisterFleetUnit !== false,
                },
                ipAddress: extractClientIp(req),
            });

            return res.status(200).json({
                success: true,
                requestId,
                publishedGlobalAssetId,
                publishedTenantAssetId,
            });
        } catch (error: any) {
            console.error('[EquipmentOnboarding] Error publicando equipo en catálogo:', error);
            return res.status(500).json({ error: error?.message || 'Error al publicar equipo en Catálogo Maestro.' });
        }
    }
);

/**
 * POST /api/equipment-onboarding/:requestId/review
 */
router.post(
    '/:requestId/review',
    verifyDevRoot,
    mutationRateLimiter,
    async (req: AuthRequest, res: Response): Promise<any> => {
        try {
            const requestId = String(req.params.requestId || '').trim();
            if (!requestId) {
                return res.status(400).json({ error: 'Identificador requestId obligatorio.' });
            }

            const parsed = ReviewEquipmentOnboardingSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: parsed.error.issues[0]?.message || 'Validación HITL fallida para revisión de solicitud.',
                    details: parsed.error.format(),
                });
            }

            const data = parsed.data;
            const requestRef = db.collection('equipment_onboarding_requests').doc(requestId);
            const requestSnap = await requestRef.get();
            if (!requestSnap.exists) {
                return res.status(404).json({ error: 'Solicitud de onboarding de equipo no encontrada.' });
            }

            const requestData = requestSnap.data() || {};
            const nowMs = Date.now();
            const reviewerUid = String(req.user?.uid || 'dev-master-root-uid');
            const reviewerEmail = String(req.user?.email || 'dev@minreport.com');

            const updatePatch: Record<string, any> = {
                status: data.status,
                reviewNotes: data.reviewNotes,
                reviewedByUid: reviewerUid,
                reviewedByEmail: reviewerEmail,
                reviewedAt: nowMs,
                updatedAt: nowMs,
            };

            if (data.status === 'REJECTED') {
                updatePatch.ttlExpiresAt = computeThirtyDayTtlTimestamp(nowMs);
            }

            await requestRef.update(updatePatch);

            await AuditLedger.record({
                tenantId: String(requestData.tenantId || requestData.accountId || 'global'),
                actorUid: reviewerUid,
                actorEmail: reviewerEmail,
                action: 'EQUIPMENT_ONBOARDING_REVIEWED',
                module: 'b2b-core',
                targetEntity: requestId,
                details: {
                    status: data.status,
                    reviewNotes: data.reviewNotes,
                },
                ipAddress: extractClientIp(req),
            });

            return res.status(200).json({
                success: true,
                requestId,
                status: data.status,
            });
        } catch (error: any) {
            console.error('[EquipmentOnboarding] Error revisando solicitud:', error);
            return res.status(500).json({ error: error?.message || 'Error al registrar revisión de solicitud.' });
        }
    }
);

export default router;
