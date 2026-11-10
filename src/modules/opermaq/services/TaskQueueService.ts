import { CloudTasksClient } from '@google-cloud/tasks';
import { OAuth2Client } from 'google-auth-library';
import { Request, Response, NextFunction } from 'express';
import { db } from '../../../config/firebase';
import { env } from '../../../config/env';
import { constantTimeEqualStrings } from '../../../utils/security';
import { PillarId, SEQUENTIAL_PILLAR_ORDER } from '../types/vault.types';
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
const activeLocalWorkerTasks = new Set<string>();
const pendingLocalQueue: HuntTaskPayload[] = [];
const MAX_CONCURRENT_LOCAL_HUNTS = 2;
let runningLocalWorkersCount = 0;
let watchdogStarted = false;
let recoveryInFlight = false;

export function buildHuntTaskId(globalAssetId: string, pillarId: string, itemId: string): string {
    return `${globalAssetId}_${pillarId}_${itemId}`;
}

export function isHuntTaskActivelyRunning(taskId: string, taskData?: Record<string, any>): boolean {
    if (!taskData) return false;
    const status = taskData.status;
    if (status !== 'PENDING' && status !== 'PROCESSING') return false;
    const ageMs = Date.now() - Number(taskData.updatedAtMs || 0);
    const isCloudTasksProd =
        env.NODE_ENV === 'production' && Boolean(env.WORKER_SERVICE_URL) && Boolean(env.WORKER_SA_EMAIL);
    if (!isCloudTasksProd) {
        return activeLocalWorkerTasks.has(taskId) && ageMs < 120_000;
    }
    return ageMs < 120_000;
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

function drainPendingLocalQueue(): void {
    while (runningLocalWorkersCount < MAX_CONCURRENT_LOCAL_HUNTS && pendingLocalQueue.length > 0) {
        const nextPayload = pendingLocalQueue.shift()!;
        void runLocalWorkerSlot(nextPayload);
    }
}

async function runLocalWorkerSlot(payload: HuntTaskPayload): Promise<void> {
    const { taskId, globalAssetId, pillarId, itemId, humanCorrection, actorId } = payload;
    runningLocalWorkersCount++;
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
            actorId,
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
    } finally {
        activeLocalWorkerTasks.delete(taskId);
        runningLocalWorkersCount = Math.max(0, runningLocalWorkersCount - 1);
        drainPendingLocalQueue();
    }
}

export async function executeHuntWorkerTask(payload: HuntTaskPayload): Promise<void> {
    const { taskId } = payload;
    if (activeLocalWorkerTasks.has(taskId)) return;
    activeLocalWorkerTasks.add(taskId);

    if (runningLocalWorkersCount >= MAX_CONCURRENT_LOCAL_HUNTS) {
        pendingLocalQueue.push(payload);
        await updateTaskStatus(taskId, {
            status: 'PENDING',
            progress_percent: 2,
            progress_message: `En cola de ejecución controlada (${pendingLocalQueue.length} en espera)...`,
        });
        return;
    }

    await runLocalWorkerSlot(payload);
}

export async function enqueueItemHuntTask(
    params: Omit<HuntTaskPayload, 'taskId'> & { forceRestart?: boolean }
): Promise<{
    taskId: string;
    alreadyRunning?: boolean;
    dispatchMode: 'CLOUD_TASKS_OIDC' | 'LOCAL_ASYNC_WORKER';
}> {
    const taskId = buildHuntTaskId(params.globalAssetId, params.pillarId, params.itemId);
    const existingDoc = await db.collection('task_status').doc(taskId).get();

    if (existingDoc.exists) {
        const cur = existingDoc.data();
        if (isHuntTaskActivelyRunning(taskId, cur)) {
            return { taskId, alreadyRunning: true, dispatchMode: 'LOCAL_ASYNC_WORKER' };
        }
    }

    const fullPayload: HuntTaskPayload = {
        taskId,
        globalAssetId: params.globalAssetId,
        pillarId: params.pillarId,
        itemId: params.itemId,
        humanCorrection: params.humanCorrection,
        tenantId: params.tenantId,
        actorId: params.actorId,
    };

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

/**
 * Recupera y reanuda automáticamente tareas de caza que quedaron interrumpidas en `PENDING` / `PROCESSING`
 * (p. ej. en `42%`) tras un reinicio de `nodemon` o timeout de red, así como ítems en `content_status === 'GENERANDO'`.
 */
let initialOrphanCatalogScanDone = false;

export async function recoverAndResumeOrphanedHuntTasks(): Promise<number> {
    if (recoveryInFlight) return 0;
    recoveryInFlight = true;
    let resumedCount = 0;

    try {
        const queuedPayloads = new Map<string, HuntTaskPayload>();

        // 1. Consultar únicamente tareas activas (`PENDING` / `PROCESSING`) — 0 lecturas ociosas cuando no hay caza activa
        const taskSnap = await db
            .collection('task_status')
            .where('status', 'in', ['PENDING', 'PROCESSING'])
            .limit(50)
            .get()
            .catch(() => null);
        if (taskSnap && !taskSnap.empty) {
            for (const docSnap of taskSnap.docs) {
                const d = docSnap.data() || {};
                if (d.type !== 'VAULT_ITEM_HUNT') continue;
                if (isHuntTaskActivelyRunning(docSnap.id, d)) continue;
                if (d.globalAssetId && d.pillarId && d.itemId) {
                    queuedPayloads.set(docSnap.id, {
                        taskId: docSnap.id,
                        globalAssetId: String(d.globalAssetId),
                        pillarId: d.pillarId as PillarId,
                        itemId: String(d.itemId),
                        tenantId: String(d.tenantId || 'dev-master-sandbox'),
                        actorId: String(d.actorId || 'dev-master-root-uid'),
                    });
                }
            }
        }

        // 2. Barrido único al arrancar el servidor para ítems huérfanos post-reinicio (elimina 115.200 lecturas/día en reposo)
        if (!initialOrphanCatalogScanDone) {
            initialOrphanCatalogScanDone = true;
            const assetsSnap = await db.collection('global_asset_catalog').limit(40).get().catch(() => null);
            if (assetsSnap && !assetsSnap.empty) {
                for (const assetDoc of assetsSnap.docs) {
                    const kv = assetDoc.data()?.knowledge_vault;
                    if (!kv) continue;
                    for (const pid of SEQUENTIAL_PILLAR_ORDER) {
                        const items = kv[pid]?.items;
                        if (!Array.isArray(items)) continue;
                        for (const it of items) {
                            if (!it || it.is_discarded || it.content_status !== 'GENERANDO') continue;
                            const tId = buildHuntTaskId(assetDoc.id, pid, it.item_id);
                            if (activeLocalWorkerTasks.has(tId) || queuedPayloads.has(tId)) continue;
                            queuedPayloads.set(tId, {
                                taskId: tId,
                                globalAssetId: assetDoc.id,
                                pillarId: pid,
                                itemId: String(it.item_id),
                                tenantId: 'dev-master-sandbox',
                                actorId: 'dev-master-root-uid',
                            });
                        }
                    }
                }
            }
        }

        for (const payload of queuedPayloads.values()) {
            resumedCount += 1;
            console.info(
                `[TaskQueueService] Reanudando automáticamente tarea de caza interrumpida: ${payload.taskId}`
            );
            await executeHuntWorkerTask(payload).catch((err) =>
                console.warn(`[TaskQueueService] Error al reanudar ${payload.taskId}:`, err)
            );
        }
    } catch (err) {
        console.warn('[TaskQueueService] Error en barrido de recuperación de tareas huérfanas:', err);
    } finally {
        recoveryInFlight = false;
    }

    return resumedCount;
}

export function startHuntTaskWatchdog(): void {
    if (watchdogStarted) return;
    watchdogStarted = true;
    setTimeout(() => {
        void recoverAndResumeOrphanedHuntTasks();
    }, 1500);
    setInterval(() => {
        void recoverAndResumeOrphanedHuntTasks();
    }, 30_000).unref();
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
