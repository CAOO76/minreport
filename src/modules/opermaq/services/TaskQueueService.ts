import { CloudTasksClient } from '@google-cloud/tasks';
import { OAuth2Client } from 'google-auth-library';
import { Request, Response, NextFunction } from 'express';
import { db } from '../../../config/firebase';
import { env } from '../../../config/env';
import { constantTimeEqualStrings } from '../../../utils/security';
import { PillarId } from '../types/vault.types';
import { huntVaultItem } from './ItemHunterService';

/**
 * TASK QUEUE SERVICE — COLA ASÍNCRONA SOBERANA (`southamerica-west1`)
 *
 * Usa `taskId` determinista `${globalAssetId}_${pillarId}_${itemId}` para compatibilidad 100%
 * en tiempo real con `onSnapshot(doc(db, 'task_status', taskId))` en `KnowledgeVaultDashboard.tsx`
 * y SSE en `GET /api/vault/hunt-status/:taskId`.
 */

export interface HuntTaskPayload {
    taskId: string;
    globalAssetId: string;
    pillarId: PillarId;
    itemId: string;
    humanCorrection?: string;
    tenantId: string;
    actorId: string;
}

const oauthClient = new OAuth2Client();
let tasksClient: CloudTasksClient | null = null;

export function buildHuntTaskId(globalAssetId: string, pillarId: string, itemId: string): string {
    return `${globalAssetId}_${pillarId}_${itemId}`;
}

async function updateTaskStatus(taskId: string, patch: Record<string, any>): Promise<void> {
    try {
        await db
            .collection('task_status')
            .doc(taskId)
            .set(
                {
                    ...patch,
                    updated_at: new Date().toISOString(),
                    updatedAtMs: Date.now(),
                },
                { merge: true }
            );
    } catch (err) {
        console.warn(`[TaskQueueService] Error actualizando task_status/${taskId}:`, err);
    }
}

export async function executeHuntWorkerTask(payload: HuntTaskPayload): Promise<void> {
    const { taskId, globalAssetId, pillarId, itemId, humanCorrection } = payload;

    try {
        await updateTaskStatus(taskId, {
            status: 'PROCESSING',
            progress_percent: 5,
            progress_message: 'Iniciando agente especialista de caza OEM...',
        });

        const result = await huntVaultItem({
            globalAssetId,
            pillarId,
            itemId,
            humanCorrection,
            onProgress: async (percent, message) => {
                await updateTaskStatus(taskId, {
                    status: 'PROCESSING',
                    progress_percent: percent,
                    progress_message: message,
                });
            },
        });

        await updateTaskStatus(taskId, {
            status: 'COMPLETED',
            progress_percent: 100,
            progress_message:
                result.mode === 'CONFLICT_BUFFER'
                    ? `Compulsa finalizada (${result.newConflictsCount} propuestas HITL).`
                    : 'Caza técnica completada.',
            result_mode: result.mode,
            new_conflicts_count: result.newConflictsCount,
            completed_at: new Date().toISOString(),
        });
    } catch (err: any) {
        console.error(`[TaskQueueService] Fallo en tarea ${taskId}:`, err);
        await updateTaskStatus(taskId, {
            status: 'FAILED',
            error: err?.message || 'Error inesperado durante la caza técnica.',
            progress_message: `Error: ${err?.message || 'Fallo de inferencia'}`,
            failed_at: new Date().toISOString(),
        });
    }
}

export async function enqueueItemHuntTask(params: Omit<HuntTaskPayload, 'taskId'>): Promise<{
    taskId: string;
    alreadyRunning?: boolean;
    dispatchMode: 'CLOUD_TASKS_OIDC' | 'LOCAL_ASYNC_WORKER';
}> {
    const taskId = buildHuntTaskId(params.globalAssetId, params.pillarId, params.itemId);
    const existingDoc = await db.collection('task_status').doc(taskId).get();

    if (existingDoc.exists) {
        const cur = existingDoc.data();
        const ageMs = Date.now() - Number(cur?.updatedAtMs || 0);
        if ((cur?.status === 'PENDING' || cur?.status === 'PROCESSING') && ageMs < 4 * 60 * 1000) {
            return { taskId, alreadyRunning: true, dispatchMode: 'LOCAL_ASYNC_WORKER' };
        }
    }

    const fullPayload: HuntTaskPayload = { ...params, taskId };

    await db.collection('task_status').doc(taskId).set({
        taskId,
        type: 'VAULT_ITEM_HUNT',
        globalAssetId: params.globalAssetId,
        pillarId: params.pillarId,
        itemId: params.itemId,
        tenantId: params.tenantId,
        actorId: params.actorId,
        userId: params.actorId,
        status: 'PENDING',
        progress_percent: 0,
        progress_message: 'Tarea encolada...',
        created_at: new Date().toISOString(),
        updatedAtMs: Date.now(),
    });

    if (env.NODE_ENV === 'production' && env.WORKER_SERVICE_URL && env.WORKER_SA_EMAIL) {
        try {
            if (!tasksClient) tasksClient = new CloudTasksClient();
            const queuePath = tasksClient.queuePath(
                env.GCP_PROJECT_ID,
                env.GCP_LOCATION,
                env.CLOUD_TASKS_QUEUE
            );
            const targetUrl = `${env.WORKER_SERVICE_URL.replace(/\/+$/, '')}/api/vault/worker/hunt-task`;

            await tasksClient.createTask({
                parent: queuePath,
                task: {
                    httpRequest: {
                        httpMethod: 'POST',
                        url: targetUrl,
                        headers: { 'Content-Type': 'application/json' },
                        body: Buffer.from(JSON.stringify(fullPayload)).toString('base64'),
                        oidcToken: {
                            serviceAccountEmail: env.WORKER_SA_EMAIL,
                            audience: env.WORKER_SERVICE_URL,
                        },
                    },
                },
            });

            return { taskId, dispatchMode: 'CLOUD_TASKS_OIDC' };
        } catch (ctErr) {
            console.warn('[TaskQueueService] Fallback a worker asíncrono en proceso:', ctErr);
        }
    }

    setImmediate(() => {
        executeHuntWorkerTask(fullPayload).catch((e) =>
            console.error('[TaskQueueService] Excepción no controlada en worker local:', e)
        );
    });

    return { taskId, dispatchMode: 'LOCAL_ASYNC_WORKER' };
}

export async function verifyCloudTasksOidc(req: Request, res: Response, next: NextFunction) {
    if (process.env.TASKS_EMULATOR === 'true' && env.NODE_ENV !== 'production') {
        const providedWorkerHeader =
            typeof req.headers['x-minreport-local-worker'] === 'string'
                ? req.headers['x-minreport-local-worker'].trim()
                : '';
        const expectedWorkerSecret = (
            process.env.LOCAL_WORKER_SECRET ||
            env.X402_HMAC_SECRET ||
            'minreport-local-worker-emulator'
        ).trim();

        if (providedWorkerHeader && constantTimeEqualStrings(providedWorkerHeader, expectedWorkerSecret)) {
            return next();
        }
        return res.status(401).json({ error: 'Header X-Minreport-Local-Worker inválido o ausente.' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token OIDC de Cloud Tasks requerido.' });
    }

    try {
        const idToken = authHeader.slice(7).trim();
        const ticket = await oauthClient.verifyIdToken({
            idToken,
            audience: env.WORKER_SERVICE_URL,
        });
        const payload = ticket.getPayload();
        if (env.WORKER_SA_EMAIL && payload?.email !== env.WORKER_SA_EMAIL) {
            return res.status(403).json({ error: 'Service Account OIDC no autorizada.' });
        }
        return next();
    } catch (err) {
        console.error('[OIDC-WORKER] Fallo verificación OIDC:', err);
        return res.status(401).json({ error: 'Token OIDC inválido.' });
    }
}
