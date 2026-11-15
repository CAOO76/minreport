import { Response } from 'express';
import { z } from 'zod';
import { db, storage } from '../config/firebase';
import { env } from '../config/env';
import { EduGatekeeper } from '../services/edu_gatekeeper';
import { safeFetchExternal } from '../utils/ssrfGuard';
import { AuthRequest } from '../middleware/admin';
import { extractClientIp } from '../middleware/rateLimiter';
import { AuditLedger } from '../core/audit-ledger';
import { UpsertEduInstitutionPayloadSchema } from '../contracts/session.contracts';

function assertAdminOrDevCaller(req: AuthRequest): boolean {
    const u = req.user;
    if (!u?.uid) return false;
    const emailLower = String(u.email || '').toLowerCase();
    const emailVerifiedOk = u.email_verified !== false;
    const role = String(u.role || '').toUpperCase();

    return (
        u.isMasterDev === true ||
        u.admin === true ||
        role === 'DEV_ROOT' ||
        role === 'SUPER_ADMIN' ||
        u.uid === 'dev-master-root-uid' ||
        u.uid === 'super-admin-uid' ||
        (emailVerifiedOk &&
            (emailLower === 'dev@minreport.com' ||
                emailLower === 'admin@minreport.com' ||
                emailLower === env.SUPER_ADMIN_EMAIL.toLowerCase()))
    );
}

const validateEduParamsSchema = z.object({
    requestId: z.string().min(1).max(128),
});

/**
 * POST /api/edu/validate/:requestId
 * Exige SUPER_ADMIN o DEV_ROOT.
 */
export const validateEduRequest = async (req: AuthRequest, res: Response) => {
    try {
        if (!assertAdminOrDevCaller(req)) {
            return res.status(403).json({ error: 'Prohibido: Acceso exclusivo a SUPER_ADMIN o DEV_ROOT.' });
        }

        const parsedParams = validateEduParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return res.status(400).json({ error: 'requestId inválido' });
        }

        const { requestId } = parsedParams.data;
        const requestSnap = await db.collection('tenants').doc(requestId).get();
        if (!requestSnap.exists) {
            return res.status(404).json({ error: 'Request not found' });
        }

        const data = requestSnap.data()!;
        const isEduRequest =
            data.type === 'EDUCATIONAL' ||
            data.isEduSandbox === true ||
            data.classification === 'edu';
        if (!isEduRequest) {
            return res.status(400).json({ error: 'Not an educational request' });
        }

        const emailStr = String(data.email || '').trim().toLowerCase();
        const emailDomain = emailStr.includes('@') ? emailStr.split('@')[1].trim() : '';

        let matchedInstitution: { id: string; name: string; domainMatched: string } | null = null;
        if (emailDomain) {
            const activeInstSnap = await db
                .collection('edu_institutions')
                .where('status', '==', 'ACTIVE')
                .get();
            for (const instDoc of activeInstSnap.docs) {
                const instData = instDoc.data() || {};
                const domains = Array.isArray(instData.domains) ? instData.domains : [];
                const foundDomain = domains.find((rawD: unknown) => {
                    const d = String(rawD || '').trim().toLowerCase().replace(/^@/, '');
                    return d && (emailDomain === d || emailDomain.endsWith(`.${d}`));
                });
                if (foundDomain) {
                    matchedInstitution = {
                        id: instDoc.id,
                        name: String(instData.name || ''),
                        domainMatched: String(foundDomain),
                    };
                    break;
                }
            }
        }

        const domainCheck = await EduGatekeeper.verifyDomain(emailStr);
        const hipoCheck = await EduGatekeeper.verifyHipoList(String(data.run || data.taxId || ''), emailStr);
        const domainValid = domainCheck.valid || Boolean(matchedInstitution);
        const gatekeeperStatus =
            domainValid && (hipoCheck.matched || Boolean(matchedInstitution)) ? 'VERIFIED' : 'NEEDS_REVIEW';

        await requestSnap.ref.update({
            gatekeeperFindings: {
                domainValid,
                hipoMatched: hipoCheck.matched,
                hipoData: hipoCheck.data || null,
                matchedInstitution,
                validatedAt: new Date().toISOString()
            },
            gatekeeperStatus,
        });

        await AuditLedger.record({
            tenantId: requestId,
            actorUid: String(req.user?.uid || ''),
            actorEmail: String(req.user?.email || ''),
            action: 'EDU_VALIDATE_REQUEST',
            module: 'edu',
            targetEntity: requestId,
            details: { domainValid, hipoMatched: hipoCheck.matched, matchedInstitution, gatekeeperStatus },
            ipAddress: extractClientIp(req),
        });

        return res.status(200).json({
            success: true,
            findings: {
                domain: {
                    ...domainCheck,
                    valid: domainValid,
                    matchedInstitution,
                },
                hipo: hipoCheck
            }
        });
    } catch (error) {
        console.error('[EDU-GATEKEEPER] Validation Error:', error);
        return res.status(500).json({ error: 'Internal validation failure' });
    }
};

const analyzeEduDocSchema = z.object({
    requestId: z.string().min(1).max(128),
    documentText: z.string().max(50000).optional(),
    fileBase64: z.string().max(14_000_000).optional(),
    mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain']).optional(),
    documentUrl: z.string().url().max(2048).optional(),
    storagePath: z.string().min(3).max(512).optional(),
});

/**
 * POST /api/edu/analyze-doc
 * Procesa el archivo/texto real recibido (o almacenado en la solicitud) en modo Fail-Closed.
 */
export const analyzeEduDocument = async (req: AuthRequest, res: Response) => {
    try {
        if (!assertAdminOrDevCaller(req)) {
            return res.status(403).json({ error: 'Prohibido: Acceso exclusivo a SUPER_ADMIN o DEV_ROOT.' });
        }

        const parsed = analyzeEduDocSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Payload de análisis EDU inválido', details: parsed.error.format() });
        }

        const { requestId, documentText, fileBase64, mimeType, documentUrl, storagePath } = parsed.data;
        const requestSnap = await db.collection('tenants').doc(requestId).get();

        if (!requestSnap.exists) {
            return res.status(404).json({ error: 'Request not found' });
        }

        const tenantData = requestSnap.data() || {};
        if (tenantData.type && tenantData.type !== 'EDUCATIONAL') {
            return res.status(400).json({ error: 'La solicitud indicada no corresponde a una cuenta EDUCATIONAL.' });
        }

        let resolvedBuffer: Buffer | null = null;
        let resolvedMime: string = mimeType || 'application/pdf';
        const resolvedText: string = (documentText || tenantData.document_text || '').trim();

        if (fileBase64) {
            const cleanedB64 = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
            resolvedBuffer = Buffer.from(cleanedB64, 'base64');
        } else {
            const candidateStoragePath = storagePath || tenantData.document_storage_path || tenantData.storagePath;
            const candidateUrl =
                documentUrl ||
                tenantData.document_url ||
                tenantData.accreditation_url ||
                tenantData.certificate_url;

            if (typeof candidateStoragePath === 'string' && candidateStoragePath.trim() && !candidateStoragePath.includes('..')) {
                const [downloaded] = await storage.bucket().file(candidateStoragePath.trim()).download();
                resolvedBuffer = downloaded;
            } else if (typeof candidateUrl === 'string' && candidateUrl.trim()) {
                const resp = await safeFetchExternal(candidateUrl.trim(), { maxBytes: 10 * 1024 * 1024 });
                if (resp.ok) {
                    const ct = resp.headers.get('content-type');
                    if (ct) resolvedMime = ct.split(';')[0].trim();
                    resolvedBuffer = Buffer.from(await resp.arrayBuffer());
                }
            }
        }

        const aiResult = await EduGatekeeper.verifyDocumentWithAI({
            fileBuffer: resolvedBuffer,
            mimeType: resolvedMime,
            documentText: resolvedText,
            expectedInstitution: String(tenantData.institution_name || 'Institución Académica no declarada'),
        });

        await requestSnap.ref.update({
            'gatekeeperFindings.aiVerification': aiResult,
            'gatekeeperFindings.aiValidatedAt': new Date().toISOString()
        });

        await AuditLedger.record({
            tenantId: requestId,
            actorUid: String(req.user?.uid || ''),
            actorEmail: String(req.user?.email || ''),
            action: 'EDU_ANALYZE_DOCUMENT_AI',
            module: 'edu',
            targetEntity: requestId,
            details: {
                verified: aiResult.verified,
                confidence: aiResult.confidence,
                hasBinary: Boolean(resolvedBuffer && resolvedBuffer.length > 0),
                hasText: resolvedText.length > 0,
            },
            ipAddress: extractClientIp(req),
        });

        return res.status(200).json({ success: true, aiResult });
    } catch (error) {
        console.error('[EDU-GATEKEEPER] AI Analysis Error:', error);
        return res.status(500).json({
            error: 'AI Analysis failed',
            aiResult: { verified: false, confidence: 0, summary: 'Error procesando documento (Fail-Closed).' },
        });
    }
};

function normalizeEduDomains(rawDomains: unknown): unknown {
    if (!Array.isArray(rawDomains)) return rawDomains;
    return Array.from(
        new Set(
            rawDomains
                .map((d) => String(d || '').trim().toLowerCase().replace(/^@/, ''))
                .filter((d) => d.length > 0)
        )
    );
}

function buildEduInstitutionCandidate(req: AuthRequest) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const headerConfirmation =
        typeof req.headers?.['x-hitl-confirmation'] === 'string'
            ? req.headers['x-hitl-confirmation'].trim().toUpperCase()
            : undefined;
    const rawConfirm = body.confirmationKeyword ?? body.confirmationWord ?? headerConfirmation;
    return {
        ...body,
        domains: normalizeEduDomains(body.domains),
        confirmationKeyword: typeof rawConfirm === 'string' ? rawConfirm.trim().toUpperCase() : rawConfirm,
    };
}

/**
 * GET /api/auth/access/edu-institutions
 * Catálogo público de instituciones académicas acreditadas activas.
 */
export const listPublicEduInstitutions = async (_req: AuthRequest, res: Response) => {
    try {
        const snapshot = await db
            .collection('edu_institutions')
            .where('status', '==', 'ACTIVE')
            .get();

        const institutions = snapshot.docs
            .map((doc) => {
                const d = doc.data() || {};
                return {
                    id: doc.id,
                    name: String(d.name || ''),
                    countryCode: String(d.countryCode || 'CL').toUpperCase(),
                    domains: Array.isArray(d.domains) ? d.domains.map((x: unknown) => String(x)) : [],
                    defaultMaxProjects: Number(d.defaultMaxProjects || 3),
                    eduInstitutionLogo: d.eduInstitutionLogo || null,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'es'));

        return res.status(200).json({ success: true, institutions });
    } catch (error) {
        console.error('[EDU] Error listPublicEduInstitutions:', error);
        return res.status(500).json({ error: 'No se pudo cargar el catálogo de instituciones EDU.' });
    }
};

/**
 * GET /api/admin/edu-institutions
 * Lista completa para 2º ADMIN / 1º DEV.
 */
export const listAdminEduInstitutions = async (req: AuthRequest, res: Response) => {
    try {
        if (!assertAdminOrDevCaller(req)) {
            return res.status(403).json({ error: 'Prohibido: Acceso exclusivo a SUPER_ADMIN o DEV_ROOT.' });
        }

        const snapshot = await db.collection('edu_institutions').get();
        const institutions = snapshot.docs
            .map((doc) => {
                const d = doc.data() || {};
                return {
                    id: doc.id,
                    name: String(d.name || ''),
                    countryCode: String(d.countryCode || 'CL').toUpperCase(),
                    domains: Array.isArray(d.domains) ? d.domains.map((x: unknown) => String(x)) : [],
                    status: d.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
                    defaultMaxProjects: Number(d.defaultMaxProjects || 3),
                    eduInstitutionLogo: d.eduInstitutionLogo || null,
                    createdAt: d.createdAt ?? null,
                    updatedAt: d.updatedAt ?? null,
                };
            })
            .sort((a, b) => {
                const diff = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
                return diff !== 0 ? diff : a.name.localeCompare(b.name, 'es');
            });

        return res.status(200).json({ success: true, institutions });
    } catch (error) {
        console.error('[EDU] Error listAdminEduInstitutions:', error);
        return res.status(500).json({ error: 'Error listando instituciones EDU.' });
    }
};

/**
 * POST /api/admin/edu-institutions
 * Registra nueva institución EDU acreditada con logo CAS opcional y HITL "ACTUALIZAR".
 */
export const createAdminEduInstitution = async (req: AuthRequest, res: Response) => {
    try {
        if (!assertAdminOrDevCaller(req)) {
            return res.status(403).json({ error: 'Prohibido: Acceso exclusivo a SUPER_ADMIN o DEV_ROOT.' });
        }

        const candidate = buildEduInstitutionCandidate(req);
        const parsed = UpsertEduInstitutionPayloadSchema.safeParse(candidate);
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Payload de institución EDU inválido.',
                details: parsed.error.format(),
            });
        }

        const { name, countryCode, domains, status, defaultMaxProjects, eduInstitutionLogo } = parsed.data;
        const normalizedDomains = normalizeEduDomains(domains) as string[];
        if (normalizedDomains.length === 0) {
            return res.status(400).json({ error: 'Debe especificar al menos un dominio institucional válido.' });
        }

        const nowMs = Date.now();
        const docRef = db.collection('edu_institutions').doc();
        const institutionDoc = {
            id: docRef.id,
            name,
            countryCode,
            domains: normalizedDomains,
            status,
            defaultMaxProjects,
            eduInstitutionLogo: eduInstitutionLogo ?? null,
            createdAt: nowMs,
            updatedAt: nowMs,
            createdByUid: String(req.user?.uid || ''),
        };

        await docRef.set(institutionDoc);

        await AuditLedger.record({
            tenantId: docRef.id,
            actorUid: String(req.user?.uid || ''),
            actorEmail: String(req.user?.email || ''),
            action: 'EDU_INSTITUTION_CREATED',
            module: 'edu',
            targetEntity: docRef.id,
            details: {
                name,
                countryCode,
                domains: normalizedDomains,
                status,
                defaultMaxProjects,
                hasLogo: Boolean(eduInstitutionLogo),
            },
            ipAddress: extractClientIp(req),
        });

        return res.status(201).json({ success: true, institution: institutionDoc });
    } catch (error) {
        console.error('[EDU] Error createAdminEduInstitution:', error);
        return res.status(500).json({ error: 'Error creando institución EDU.' });
    }
};

/**
 * PATCH /api/admin/edu-institutions/:id
 * Actualiza institución EDU y propaga eduInstitutionLogo + eduInstitutionName a cuentas/tenants vinculados.
 */
export const updateAdminEduInstitution = async (req: AuthRequest, res: Response) => {
    try {
        if (!assertAdminOrDevCaller(req)) {
            return res.status(403).json({ error: 'Prohibido: Acceso exclusivo a SUPER_ADMIN o DEV_ROOT.' });
        }

        const id = String(req.params.id || '').trim();
        if (!id || id.length > 128) {
            return res.status(400).json({ error: 'ID de institución EDU inválido.' });
        }

        const instRef = db.collection('edu_institutions').doc(id);
        const instSnap = await instRef.get();
        if (!instSnap.exists) {
            return res.status(404).json({ error: 'Institución EDU no encontrada.' });
        }

        const candidate = buildEduInstitutionCandidate(req);
        const parsed = UpsertEduInstitutionPayloadSchema.safeParse(candidate);
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Payload de actualización EDU inválido.',
                details: parsed.error.format(),
            });
        }

        const { name, countryCode, domains, status, defaultMaxProjects, eduInstitutionLogo } = parsed.data;
        const normalizedDomains = normalizeEduDomains(domains) as string[];
        if (normalizedDomains.length === 0) {
            return res.status(400).json({ error: 'Debe especificar al menos un dominio institucional válido.' });
        }

        const nowMs = Date.now();
        const existingData = instSnap.data() || {};
        const updatedDoc = {
            id,
            name,
            countryCode,
            domains: normalizedDomains,
            status,
            defaultMaxProjects,
            eduInstitutionLogo: eduInstitutionLogo ?? null,
            createdAt: existingData.createdAt ?? nowMs,
            updatedAt: nowMs,
            updatedByUid: String(req.user?.uid || ''),
        };

        await instRef.set(updatedDoc, { merge: true });

        const [linkedAccountsSnap, linkedTenantsSnap] = await Promise.all([
            db.collection('accounts').where('eduInstitutionId', '==', id).get(),
            db.collection('tenants').where('eduInstitutionId', '==', id).get(),
        ]);

        const propagationUpdates = {
            eduInstitutionName: name,
            eduInstitutionLogo: eduInstitutionLogo ?? null,
            updatedAt: nowMs,
        };

        await Promise.all([
            ...linkedAccountsSnap.docs.map((doc) => doc.ref.update(propagationUpdates).catch(() => {})),
            ...linkedTenantsSnap.docs.map((doc) => doc.ref.update(propagationUpdates).catch(() => {})),
        ]);

        await AuditLedger.record({
            tenantId: id,
            actorUid: String(req.user?.uid || ''),
            actorEmail: String(req.user?.email || ''),
            action: 'EDU_INSTITUTION_UPDATED',
            module: 'edu',
            targetEntity: id,
            details: {
                name,
                countryCode,
                domains: normalizedDomains,
                status,
                defaultMaxProjects,
                hasLogo: Boolean(eduInstitutionLogo),
                propagatedAccounts: linkedAccountsSnap.size,
                propagatedTenants: linkedTenantsSnap.size,
            },
            ipAddress: extractClientIp(req),
        });

        return res.status(200).json({
            success: true,
            institution: updatedDoc,
            propagatedAccounts: linkedAccountsSnap.size,
            propagatedTenants: linkedTenantsSnap.size,
        });
    } catch (error) {
        console.error('[EDU] Error updateAdminEduInstitution:', error);
        return res.status(500).json({ error: 'Error actualizando institución EDU.' });
    }
};
