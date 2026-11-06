import { Router, Response } from 'express';
import { z } from 'zod';
import { db } from '../config/firebase';
import { env } from '../config/env';
import { AuditLedger } from '../core/audit-ledger';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { extractClientIp } from '../middleware/rateLimiter';

const router = Router();

const CreatePilotFeedbackSchema = z.object({
    tenantId: z.string().min(1).max(128).default('dev-master-sandbox'),
    module: z.enum(['core', 'opermaq', 'stockpile']).default('core'),
    executionMode: z.enum(['integrated', 'standalone']).default('integrated'),
    category: z
        .enum(['AI_KNOWLEDGE_TRAINING', 'CHANGE_REQUEST', 'BUG_CORRECTION', 'FIELD_SIMULATION'])
        .default('AI_KNOWLEDGE_TRAINING'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
    contextPath: z.string().min(1).max(256).default('/'),
    assetOrSurveyId: z.string().max(128).optional(),
    observation: z.string().min(3).max(4000),
    expectedAiBehavior: z.string().max(2000).optional(),
});

const ListPilotFeedbackQuerySchema = z.object({
    module: z.enum(['core', 'opermaq', 'stockpile']).optional(),
});

const UpdatePilotFeedbackStatusSchema = z.object({
    status: z.enum(['OPEN', 'IN_REVIEW', 'APPLIED_TO_AI', 'RESOLVED']),
    confirmationWord: z.string().max(32).optional(),
    reviewNotes: z.string().max(1000).optional(),
});

type VerifiedPilotAuthority = {
    authorized: boolean;
    isSovereignCurator: boolean; // Solo DEV_ROOT o SUPER_ADMIN pueden aprobar APPLIED_TO_AI
    role: string;
    uid: string;
    email: string;
};

async function resolvePilotAuthority(req: AuthRequest): Promise<VerifiedPilotAuthority> {
    const user = req.user || {};
    const uid = String(user.uid || '');
    const emailLower = String(user.email || '').toLowerCase();
    const emailVerifiedOk = user.email_verified !== false;
    const tokenRole = String(user.role || '').toUpperCase();

    if (!uid) {
        return { authorized: false, isSovereignCurator: false, role: '', uid: '', email: '' };
    }

    const isDevRoot =
        user.isMasterDev === true ||
        tokenRole === 'DEV_ROOT' ||
        uid === 'dev-master-root-uid' ||
        (emailVerifiedOk && emailLower === 'dev@minreport.com');

    const isSuperAdmin =
        !isDevRoot &&
        (user.admin === true ||
            tokenRole === 'SUPER_ADMIN' ||
            uid === 'super-admin-uid' ||
            (emailVerifiedOk &&
                (emailLower === 'admin@minreport.com' ||
                    emailLower === env.SUPER_ADMIN_EMAIL.toLowerCase())));

    if (isDevRoot || isSuperAdmin) {
        return {
            authorized: true,
            isSovereignCurator: true,
            role: isDevRoot ? 'DEV_ROOT' : 'SUPER_ADMIN',
            uid,
            email: emailLower,
        };
    }

    let serverRole = '';
    let userDisabled = false;
    try {
        const userSnap = await db.collection('users').doc(uid).get();
        if (userSnap.exists) {
            const uData = userSnap.data() || {};
            serverRole = String(uData.role || '').toUpperCase();
            const st = String(uData.status || 'ACTIVE').toUpperCase();
            userDisabled = st === 'REVOKED' || st === 'SUSPENDED';
        }
    } catch {
        serverRole = '';
    }

    const effectiveRole = tokenRole || serverRole;
    const isAccreditedPilot =
        !userDisabled &&
        (effectiveRole === 'TEST_PILOT' ||
            effectiveRole === 'PILOT_LEAD' ||
            serverRole === 'TEST_PILOT' ||
            serverRole === 'PILOT_LEAD');

    return {
        authorized: isAccreditedPilot,
        isSovereignCurator: false,
        role: effectiveRole,
        uid,
        email: emailLower,
    };
}

/**
 * GET /api/pilot/feedback
 *Exige rol verificado TEST_PILOT, PILOT_LEAD, DEV_ROOT o SUPER_ADMIN.
 */
router.get('/feedback', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const authority = await resolvePilotAuthority(req);
        if (!authority.authorized) {
            return res.status(403).json({
                error: 'Prohibido: Acceso exclusivo a colaboradores TEST-PILOT acreditados, DEV_ROOT o SUPER_ADMIN.',
            });
        }

        const parsedQuery = ListPilotFeedbackQuerySchema.safeParse({
            module: typeof req.query.module === 'string' ? req.query.module : undefined,
        });
        if (!parsedQuery.success) {
            return res.status(400).json({ error: 'Filtro de módulo inválido' });
        }

        let queryRef: FirebaseFirestore.Query = db
            .collection('pilot_feedback')
            .orderBy('createdAt', 'desc')
            .limit(50);

        if (parsedQuery.data.module) {
            queryRef = db
                .collection('pilot_feedback')
                .where('module', '==', parsedQuery.data.module)
                .limit(50);
        }

        const snap = await queryRef.get();
        const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.status(200).json({ success: true, items });
    } catch (error: any) {
        console.error('[PILOT-API] Error listando feedback:', error);
        return res.status(500).json({ error: error.message || 'Error al obtener bitácora TEST-PILOT' });
    }
});

/**
 * POST /api/pilot/feedback
 * Guarda SIEMPRE con `status: 'OPEN'` (inclusive `AI_KNOWLEDGE_TRAINING`) para impedir
 * Cross-Tenant Prompt Poisoning hasta aprobación HITL de DEV_ROOT / SUPER_ADMIN.
 */
router.post('/feedback', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const authority = await resolvePilotAuthority(req);
        if (!authority.authorized) {
            return res.status(403).json({
                error: 'Prohibido: Solo cuentas TEST_PILOT, PILOT_LEAD, DEV_ROOT o SUPER_ADMIN pueden registrar feedback.',
            });
        }

        const parsed = CreatePilotFeedbackSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Payload de feedback inválido', details: parsed.error.format() });
        }

        const user = req.user || {};
        const data = parsed.data;
        const docRef = db.collection('pilot_feedback').doc();
        const nowIso = new Date().toISOString();

        const record = {
            id: docRef.id,
            feedbackId: docRef.id,
            tenantId: data.tenantId,
            authorUid: authority.uid,
            authorEmail: authority.email || 'pilot@minreport.com',
            authorRole: authority.role,
            authorName: String(user.name || authority.email.split('@')[0] || 'Experto TEST-PILOT'),
            module: data.module,
            executionMode: data.executionMode,
            category: data.category,
            priority: data.priority,
            contextPath: data.contextPath,
            assetOrSurveyId: data.assetOrSurveyId || null,
            observation: data.observation,
            expectedAiBehavior: data.expectedAiBehavior || null,
            status: 'OPEN' as const, // NUNCA 'APPLIED_TO_AI' automático al crear
            timestamp: nowIso,
            createdAt: Date.now(),
        };

        await docRef.set(record);

        await AuditLedger.record({
            tenantId: data.tenantId,
            actorUid: authority.uid,
            actorEmail: record.authorEmail,
            action: `TEST_PILOT_${data.category}_CREATED`,
            module: 'test-pilot',
            targetEntity: docRef.id,
            details: {
                module: data.module,
                contextPath: data.contextPath,
                priority: data.priority,
                executionMode: data.executionMode,
                initialStatus: 'OPEN',
            },
            ipAddress: extractClientIp(req),
        });

        return res.status(201).json({ success: true, item: record });
    } catch (error: any) {
        console.error('[PILOT-API] Error registrando feedback:', error);
        return res.status(500).json({ error: error.message || 'Error al guardar feedback de TEST-PILOT' });
    }
});

/**
 * Handler compartido para PATCH `/feedback/:id/status` y `/feedback/:id`
 * Solo `DEV_ROOT` o `SUPER_ADMIN` con confirmación HITL `'ACTUALIZAR'` pueden promover a `'APPLIED_TO_AI'`.
 */
const handleUpdateFeedbackStatus = async (req: AuthRequest, res: Response) => {
    try {
        const feedbackId = z.string().min(1).max(128).safeParse(req.params.id);
        if (!feedbackId.success) {
            return res.status(400).json({ error: 'ID de feedback inválido' });
        }

        const authority = await resolvePilotAuthority(req);
        if (!authority.isSovereignCurator) {
            return res.status(403).json({
                error: 'Prohibido: Solo DEV_ROOT o SUPER_ADMIN pueden cambiar el estado de curación de feedback TEST-PILOT.',
            });
        }

        const parsed = UpdatePilotFeedbackStatusSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Payload de estado inválido', details: parsed.error.format() });
        }

        const { status, confirmationWord, reviewNotes } = parsed.data;
        const effectiveConfirmation = (
            confirmationWord ||
            String(req.headers['x-hitl-confirmation'] || '')
        ).trim();

        if (status === 'APPLIED_TO_AI' && effectiveConfirmation !== 'ACTUALIZAR') {
            return res.status(400).json({
                error: 'Confirmación HITL obligatoria: escriba exactamente "ACTUALIZAR" para inyectar esta regla en el Enjambre IA.',
            });
        }

        const docRef = db.collection('pilot_feedback').doc(feedbackId.data);
        const existingSnap = await docRef.get();
        if (!existingSnap.exists) {
            return res.status(404).json({ error: 'Registro de feedback no encontrado.' });
        }

        const prevStatus = existingSnap.data()?.status || 'OPEN';
        const now = Date.now();

        await docRef.update({
            status,
            reviewNotes: reviewNotes || null,
            curatedByUid: authority.uid,
            curatedByEmail: authority.email,
            curatedAt: now,
            updatedAt: now,
        });

        await AuditLedger.record({
            tenantId: String(existingSnap.data()?.tenantId || 'dev-master-sandbox'),
            actorUid: authority.uid,
            actorEmail: authority.email,
            action: status === 'APPLIED_TO_AI' ? 'PILOT_FEEDBACK_PROMOTED_TO_AI' : 'PILOT_FEEDBACK_STATUS_UPDATED',
            module: 'test-pilot',
            targetEntity: feedbackId.data,
            details: {
                previousStatus: prevStatus,
                newStatus: status,
                hitlConfirmed: status === 'APPLIED_TO_AI',
            },
            ipAddress: extractClientIp(req),
        });

        return res.status(200).json({ success: true, id: feedbackId.data, status });
    } catch (error: any) {
        console.error('[PILOT-API] Error actualizando estado de feedback:', error);
        return res.status(500).json({ error: error.message || 'Error actualizando estado' });
    }
};

router.patch('/feedback/:id/status', requireAuth, handleUpdateFeedbackStatus);
router.patch('/feedback/:id', requireAuth, handleUpdateFeedbackStatus);

export default router;
