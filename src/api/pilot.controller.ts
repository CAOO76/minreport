import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../config/firebase';
import { AuditLedger } from '../core/audit-ledger';
import { requireAuth } from '../middleware/auth';

const router = Router();

const CreatePilotFeedbackSchema = z.object({
    tenantId: z.string().min(1).default('dev-master-sandbox'),
    module: z.enum(['core', 'opermaq', 'stockpile']).default('core'),
    executionMode: z.enum(['integrated', 'standalone']).default('integrated'),
    category: z.enum(['AI_KNOWLEDGE_TRAINING', 'CHANGE_REQUEST', 'BUG_CORRECTION', 'FIELD_SIMULATION']).default('AI_KNOWLEDGE_TRAINING'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
    contextPath: z.string().default('/'),
    assetOrSurveyId: z.string().optional(),
    observation: z.string().min(3),
    expectedAiBehavior: z.string().optional()
});

/**
 * GET /api/pilot/feedback
 * Lista comentarios, solicitudes de cambio y directivas de entrenamiento IA de TEST-PILOTS.
 */
router.get('/feedback', requireAuth, async (req: Request, res: Response) => {
    try {
        const moduleFilter = req.query.module as string | undefined;
        let queryRef: FirebaseFirestore.Query = db.collection('pilot_feedback').orderBy('createdAt', 'desc').limit(50);

        if (moduleFilter && ['core', 'opermaq', 'stockpile'].includes(moduleFilter)) {
            queryRef = db.collection('pilot_feedback').where('module', '==', moduleFilter).limit(50);
        }

        const snap = await queryRef.get();
        const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json({ success: true, items });
    } catch (error: any) {
        console.error('[PILOT-API] Error listando feedback:', error);
        res.status(500).json({ error: error.message || 'Error al obtener bitácora TEST-PILOT' });
    }
});

/**
 * POST /api/pilot/feedback
 * Registra una observación experta, solicitud de cambio o regla de conocimiento para la IA interna.
 */
router.post('/feedback', requireAuth, async (req: Request, res: Response) => {
    try {
        const parsed = CreatePilotFeedbackSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Payload de feedback inválido', details: parsed.error.format() });
        }

        const user = (req as any).user || {};
        const data = parsed.data;
        const docRef = db.collection('pilot_feedback').doc();
        const nowIso = new Date().toISOString();

        const record = {
            id: docRef.id,
            feedbackId: docRef.id,
            tenantId: data.tenantId,
            authorUid: user.uid || 'pilot',
            authorEmail: user.email || 'pilot@minreport.com',
            authorName: user.name || user.email?.split('@')[0] || 'Experto TEST-PILOT',
            module: data.module,
            executionMode: data.executionMode,
            category: data.category,
            priority: data.priority,
            contextPath: data.contextPath,
            assetOrSurveyId: data.assetOrSurveyId || null,
            observation: data.observation,
            expectedAiBehavior: data.expectedAiBehavior || null,
            status: data.category === 'AI_KNOWLEDGE_TRAINING' ? 'APPLIED_TO_AI' : 'OPEN',
            timestamp: nowIso,
            createdAt: Date.now()
        };

        await docRef.set(record);

        await AuditLedger.record({
            tenantId: data.tenantId,
            actorUid: record.authorUid,
            actorEmail: record.authorEmail,
            action: `TEST_PILOT_${data.category}`,
            module: 'test-pilot',
            targetEntity: `${data.module}:${data.contextPath}`,
            details: {
                feedbackId: docRef.id,
                priority: data.priority,
                executionMode: data.executionMode
            }
        });

        res.status(201).json({ success: true, item: record });
    } catch (error: any) {
        console.error('[PILOT-API] Error registrando feedback:', error);
        res.status(500).json({ error: error.message || 'Error al guardar feedback de TEST-PILOT' });
    }
});

/**
 * PATCH /api/pilot/feedback/:id
 * Actualiza el estado de una observación de TEST-PILOT.
 */
router.patch('/feedback/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!['OPEN', 'IN_REVIEW', 'APPLIED_TO_AI', 'RESOLVED'].includes(status)) {
            return res.status(400).json({ error: 'Estado no válido' });
        }

        await db.collection('pilot_feedback').doc(id).update({
            status,
            updatedAt: Date.now()
        });

        res.status(200).json({ success: true, id, status });
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Error actualizando estado' });
    }
});

export default router;

