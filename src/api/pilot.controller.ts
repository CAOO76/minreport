import { Router, Response } from 'express';
import { z } from 'zod';
import { db } from '../config/firebase';
import { env } from '../config/env';
import { AuditLedger } from '../core/audit-ledger';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { extractClientIp } from '../middleware/rateLimiter';
import { evaluatePilotExpiration } from '../contracts/session.contracts';
import {
    ExtractWisdomInputSchema,
    PilotWisdomExtractorService,
} from '../services/pilot-wisdom-extractor.service';

const router = Router();

const CreatePilotFeedbackSchema = z.object({
    tenantId: z.string().min(1).max(128).default('dev-master-sandbox'),
    module: z.enum(['core', 'opermaq', 'stockpile', 'geolapp']).default('core'),
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
    module: z.enum(['core', 'opermaq', 'stockpile', 'geolapp']).optional(),
});

const UpdatePilotFeedbackStatusSchema = z.object({
    status: z.enum(['OPEN', 'IN_REVIEW', 'APPLIED_TO_AI', 'RESOLVED']),
    confirmationWord: z.string().max(32).optional(),
    confirmationKeyword: z.string().max(32).optional(),
    reviewNotes: z.string().max(1000).optional(),
});

type VerifiedPilotAuthority = {
    authorized: boolean;
    expired?: boolean;
    isSovereignCurator: boolean; // Únicamente DEV_ROOT puede curar/aprobar APPLIED_TO_AI
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

    // Aislamiento hermético 100%: /api/pilot/* solo autoriza cuentas activas 3º TEST-PILOT.
    // 1º DEV y 2º ADMIN no operan dentro de la interfaz 3º TEST-PILOT.
    if (isDevRoot || isSuperAdmin) {
        return {
            authorized: false,
            expired: false,
            isSovereignCurator: false,
            role: isDevRoot ? 'DEV_ROOT' : 'SUPER_ADMIN',
            uid,
            email: emailLower,
        };
    }

    let serverRole = '';
    let userDisabled = false;
    let serverPilotExpiresAt: unknown = undefined;
    try {
        const userSnap = await db.collection('users').doc(uid).get();
        if (userSnap.exists) {
            const uData = userSnap.data() || {};
            serverRole = String(uData.role || '').toUpperCase();
            const st = String(uData.status || 'ACTIVE').toUpperCase();
            userDisabled = st === 'REVOKED' || st === 'SUSPENDED';
            serverPilotExpiresAt = uData.pilotExpiresAt;
        }
    } catch {
        serverRole = '';
    }

    const effectiveRole = tokenRole || serverRole;
    const isAccreditedPilot =
        !userDisabled && (effectiveRole === 'TEST_PILOT' || serverRole === 'TEST_PILOT');

    if (!isAccreditedPilot) {
        return {
            authorized: false,
            expired: false,
            isSovereignCurator: false,
            role: effectiveRole,
            uid,
            email: emailLower,
        };
    }

    let pilotExpired =
        evaluatePilotExpiration(user.pilotExpiresAt) ||
        evaluatePilotExpiration(serverPilotExpiresAt);

    if (!pilotExpired) {
        try {
            const pilotsSnap = await db.collection('test_pilots').where('userId', '==', uid).get();
            if (!pilotsSnap.empty) {
                const docs = pilotsSnap.docs.map((d) => d.data() || {});
                const activeDocs = docs.filter((p) => String(p.status || '').toUpperCase() === 'ACTIVE');
                if (activeDocs.length > 0 && activeDocs.every((p) => evaluatePilotExpiration(p.expiresAt))) {
                    pilotExpired = true;
                }
            }
        } catch {
            // Keep prior expiration state if test_pilots unreadable
        }
    }

    if (pilotExpired) {
        return {
            authorized: false,
            expired: true,
            isSovereignCurator: false,
            role: 'TEST_PILOT',
            uid,
            email: emailLower,
        };
    }

    return {
        authorized: true,
        expired: false,
        isSovereignCurator: false,
        role: 'TEST_PILOT',
        uid,
        email: emailLower,
    };
}

/**
 * GET /api/pilot/feedback
 * Exige rol verificado TEST_PILOT, DEV_ROOT o SUPER_ADMIN (aislado por authorUid para pilotos).
 */
router.get('/feedback', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const authority = await resolvePilotAuthority(req);
        if (authority.expired) {
            return res.status(403).json({
                error: 'Cuenta 3º TEST-PILOT expirada.',
                code: 'PILOT_ACCOUNT_EXPIRED',
            });
        }
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

        let items: Record<string, any>[];
        if (authority.isSovereignCurator) {
            let queryRef: FirebaseFirestore.Query = db
                .collection('pilot_feedback')
                .orderBy('createdAt', 'desc')
                .limit(50);

            if (parsedQuery.data.module) {
                queryRef = db
                    .collection('pilot_feedback')
                    .where('module', '==', parsedQuery.data.module)
                    .limit(100);
            }

            const snap = await queryRef.get();
            items = snap.docs
                .map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, any>))
                .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
                .slice(0, 50);
        } else {
            const snap = await db
                .collection('pilot_feedback')
                .where('authorUid', '==', authority.uid)
                .limit(100)
                .get();

            items = snap.docs
                .map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, any>))
                .filter((item) => !parsedQuery.data.module || item.module === parsedQuery.data.module)
                .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
                .slice(0, 50);
        }

        return res.status(200).json({ success: true, items });
    } catch (error: any) {
        console.error('[PILOT-API] Error listando feedback:', error);
        return res.status(500).json({ error: error.message || 'Error al obtener bitácora TEST-PILOT' });
    }
});

/**
 * POST /api/pilot/feedback
 * Guarda SIEMPRE con `status: 'OPEN'` (inclusive `AI_KNOWLEDGE_TRAINING`) para impedir
 * Cross-Tenant Prompt Poisoning hasta aprobación HITL exclusiva de DEV_ROOT.
 */
router.post('/feedback', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const authority = await resolvePilotAuthority(req);
        if (authority.expired) {
            return res.status(403).json({
                error: 'Cuenta 3º TEST-PILOT expirada.',
                code: 'PILOT_ACCOUNT_EXPIRED',
            });
        }
        if (!authority.authorized) {
            return res.status(403).json({
                error: 'Prohibido: Solo cuentas TEST_PILOT, DEV_ROOT o SUPER_ADMIN pueden registrar feedback.',
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
 * Solo `DEV_ROOT` con confirmación HITL `'ACTUALIZAR'` puede cambiar el estado o promover a `'APPLIED_TO_AI'`.
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
                error: 'Prohibido: Interfaz 3º TEST-PILOT hermética; sin curación externa habilitada.',
            });
        }

        const parsed = UpdatePilotFeedbackStatusSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Payload de estado inválido', details: parsed.error.format() });
        }

        const { status, confirmationWord, confirmationKeyword, reviewNotes } = parsed.data;
        const effectiveConfirmation = String(
            confirmationKeyword ||
                confirmationWord ||
                req.headers['x-hitl-confirmation'] ||
                ''
        )
            .trim()
            .toUpperCase();

        if (effectiveConfirmation !== 'ACTUALIZAR') {
            return res.status(400).json({
                error: 'Confirmación HITL obligatoria: escriba exactamente "ACTUALIZAR" para modificar el estado del registro.',
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

/**
 * POST /api/pilot/feedback/extract-wisdom
 * Estructura relatos orales o escritos del maestro minero (1º DEV / 3º TEST-PILOT)
 * detrás de ConfidentialityAirlockService + ResilientAIClient sin persistir audio crudo (CAS).
 */
router.post('/feedback/extract-wisdom', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const authority = await resolvePilotAuthority(req);
        if (authority.expired) {
            return res.status(403).json({
                error: 'Cuenta 3º TEST-PILOT expirada.',
                code: 'PILOT_ACCOUNT_EXPIRED',
            });
        }
        if (!authority.authorized) {
            return res.status(403).json({
                error: 'Prohibido: Solo cuentas TEST_PILOT, DEV_ROOT o SUPER_ADMIN pueden estructurar aportes.',
            });
        }

        const parsed = ExtractWisdomInputSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Payload de extracción inválido.',
                details: parsed.error.format(),
            });
        }

        if (!parsed.data.rawNarrative.trim() && !parsed.data.ephemeralAudio) {
            return res.status(400).json({
                error: 'Debe ingresar un relato escrito o grabar audio breve para ordenarlo.',
            });
        }

        const extraction = await PilotWisdomExtractorService.extractWisdom(parsed.data);

        return res.status(200).json({
            success: true,
            extraction,
        });
    } catch (error: any) {
        console.error('[PILOT-API] Error estructurando sabiduría piloto:', error);
        return res.status(500).json({ error: error.message || 'Error procesando relato técnico' });
    }
});

export default router;
