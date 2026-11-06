import { Response } from 'express';
import { z } from 'zod';
import { db, storage } from '../config/firebase';
import { env } from '../config/env';
import { EduGatekeeper } from '../services/edu_gatekeeper';
import { safeFetchExternal } from '../utils/ssrfGuard';
import { AuthRequest } from '../middleware/admin';
import { extractClientIp } from '../middleware/rateLimiter';
import { AuditLedger } from '../core/audit-ledger';

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
        if (data.type !== 'EDUCATIONAL') {
            return res.status(400).json({ error: 'Not an educational request' });
        }

        const domainCheck = await EduGatekeeper.verifyDomain(String(data.email || ''));
        const hipoCheck = await EduGatekeeper.verifyHipoList(String(data.run || ''), String(data.email || ''));
        const gatekeeperStatus = domainCheck.valid && hipoCheck.matched ? 'VERIFIED' : 'NEEDS_REVIEW';

        await requestSnap.ref.update({
            gatekeeperFindings: {
                domainValid: domainCheck.valid,
                hipoMatched: hipoCheck.matched,
                hipoData: hipoCheck.data || null,
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
            details: { domainValid: domainCheck.valid, hipoMatched: hipoCheck.matched, gatekeeperStatus },
            ipAddress: extractClientIp(req),
        });

        return res.status(200).json({
            success: true,
            findings: {
                domain: domainCheck,
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
