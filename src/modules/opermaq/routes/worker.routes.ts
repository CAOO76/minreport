import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
    buildHuntTaskId,
    executeHuntWorkerTask,
    verifyCloudTasksOidc,
} from '../services/TaskQueueService';

/**
 * OPERMAQ — Worker Routes (Cloud Tasks OIDC)
 * Se monta antes del middleware de sesión humana para recibir disparos OIDC de Cloud Tasks.
 */

const workerRouter = Router();

const HuntWorkerBodySchema = z.object({
    taskId: z.string().trim().min(1).max(256).optional(),
    globalAssetId: z.string().trim().min(1).max(128),
    pillarId: z.enum([
        'ficha_tecnica',
        'manual_operaciones',
        'pauta_mantencion',
        'matriz_riesgos',
        'checklist_pre_op',
    ]),
    itemId: z.string().trim().min(1).max(128),
    intent: z.enum(['INITIAL_CAPTURE', 'INCREMENTAL_UPDATE']).optional(),
    humanCorrection: z.string().max(16000).optional(),
    tenantId: z.string().trim().min(1).max(128).optional().default('global'),
    actorId: z.string().trim().min(1).max(128).optional(),
    userId: z.string().trim().min(1).max(128).optional(),
});

workerRouter.post('/hunt-task', verifyCloudTasksOidc, async (req: Request, res: Response) => {
    const parsed = HuntWorkerBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(400).json({
            error: 'Parámetros requeridos inválidos en worker de caza (globalAssetId, pillarId, itemId).',
            details: parsed.error.format(),
        });
    }

    const { itemId, pillarId, globalAssetId, intent, humanCorrection, tenantId, actorId, userId } = parsed.data;
    const taskId = buildHuntTaskId(globalAssetId, pillarId, itemId);

    try {
        await executeHuntWorkerTask({
            taskId,
            globalAssetId,
            pillarId,
            itemId,
            intent,
            tenantId,
            actorId: actorId || userId || 'cloud-tasks-worker',
            humanCorrection,
        });

        return res.status(200).json({ success: true, taskId });
    } catch (error: any) {
        console.error(`[OPERMAQ-WORKER] Error en tarea ${taskId}:`, error?.message || error);
        return res.status(500).json({ error: error?.message || 'Error interno en worker de caza.' });
    }
});

export default workerRouter;
