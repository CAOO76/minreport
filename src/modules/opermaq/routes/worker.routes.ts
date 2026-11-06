import { Router, type Request, type Response } from 'express';
import {
    buildHuntTaskId,
    executeHuntWorkerTask,
    verifyCloudTasksOidc,
} from '../services/TaskQueueService';
import type { PillarId } from '../types/vault.types';

/**
 * OPERMAQ — Worker Routes (Cloud Tasks OIDC)
 * Se monta antes del middleware de sesión humana para recibir disparos OIDC de Cloud Tasks.
 */

const workerRouter = Router();

workerRouter.post('/hunt-task', verifyCloudTasksOidc, async (req: Request, res: Response) => {
    const { itemId, pillarId, globalAssetId, userId, humanCorrection } = req.body || {};

    if (!itemId || !pillarId || !globalAssetId) {
        return res.status(400).json({
            error: 'Parámetros requeridos: itemId, pillarId, globalAssetId.',
        });
    }

    const taskId = buildHuntTaskId(globalAssetId, pillarId, itemId);

    try {
        await executeHuntWorkerTask({
            taskId,
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            tenantId: req.body?.tenantId || 'global',
            actorId: req.body?.actorId || userId || 'cloud-tasks-worker',
            humanCorrection,
        });

        return res.status(200).json({ success: true, taskId });
    } catch (error: any) {
        console.error(`[OPERMAQ-WORKER] Error en tarea ${taskId}:`, error?.message || error);
        return res.status(500).json({ error: error?.message || 'Error interno en worker de caza.' });
    }
});

export default workerRouter;
