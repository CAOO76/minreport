import { CloudTasksClient } from '@google-cloud/tasks';
import { NextFunction, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../../config/env';
import { constantTimeEqualStrings } from '../../../utils/security';
import type { InboundWhatsAppMessage } from '../adapters/MetaWhatsAppCloudAdapter';

/**
 * SUPPLY TASK QUEUE SERVICE — COLA ASÍNCRONA SOBERANA CLOUD RUN (`southamerica-west1`)
 *
 * Desacopla el webhook oficial de Meta WhatsApp Cloud API (`POST /api/supply/whatsapp/webhook` -> ACK < 500ms)
 * del procesamiento multimodal/CAS/Firestore y reemplaza `setTimeout().unref()` por `scheduleTime` nativo
 * de Google Cloud Tasks en producción, manteniendo despacho asíncrono local seguro en dev/emulador/test.
 */

export type SupplyTaskDispatchMode = 'CLOUD_TASKS_OIDC' | 'LOCAL_ASYNC_WORKER';

export interface SupplyInboundWhatsAppTaskPayload {
    event: InboundWhatsAppMessage;
    flushImmediately?: boolean;
    dispatchToken?: string;
    skipOutboundSend?: boolean;
    enqueuedAtMs: number;
}

export interface SupplySessionFlushTaskPayload {
    sessionId: string;
    tenantId?: string;
    expectedDebounceUntilMs: number;
    skipOutboundSend?: boolean;
    forceFlush?: boolean;
    enqueuedAtMs: number;
}

export interface SupplyTaskHandlers {
    onInbound: (payload: SupplyInboundWhatsAppTaskPayload) => Promise<unknown>;
    onFlush: (payload: SupplySessionFlushTaskPayload) => Promise<unknown>;
}

export type OidcTokenVerifierFn = (
    idToken: string,
    audience: string
) => Promise<{ email?: string; email_verified?: boolean } | null>;

const oauthClient = new OAuth2Client();
let tasksClient: CloudTasksClient | null = null;
let customHandlers: SupplyTaskHandlers | null = null;
let customOidcVerifier: OidcTokenVerifierFn | null = null;
const localFlushTimers = new Map<string, NodeJS.Timeout>();
const pendingLocalPromises = new Set<Promise<void>>();

function resolveEffectiveRuntimeConfig(): {
    nodeEnv: string;
    gcpProjectId: string;
    gcpLocation: string;
    queueName: string;
    workerServiceUrl: string;
    workerSaEmail: string;
} {
    const nodeEnv = (process.env.NODE_ENV || env.NODE_ENV || 'development').trim();
    const gcpProjectId = (process.env.GCP_PROJECT_ID || env.GCP_PROJECT_ID || '').trim();
    const gcpLocation = (process.env.GCP_LOCATION || env.GCP_LOCATION || 'southamerica-west1').trim();
    const queueName = (
        process.env.SUPPLY_CLOUD_TASKS_QUEUE ||
        env.SUPPLY_CLOUD_TASKS_QUEUE ||
        'supply-whatsapp-queue'
    ).trim();
    const workerServiceUrl = (process.env.WORKER_SERVICE_URL || env.WORKER_SERVICE_URL || '').trim();
    const workerSaEmail = (process.env.WORKER_SA_EMAIL || env.WORKER_SA_EMAIL || '').trim();

    return {
        nodeEnv,
        gcpProjectId,
        gcpLocation,
        queueName,
        workerServiceUrl,
        workerSaEmail,
    };
}

export function isSupplyCloudTasksProductionMode(): boolean {
    const cfg = resolveEffectiveRuntimeConfig();
    return (
        cfg.nodeEnv === 'production' &&
        Boolean(cfg.gcpProjectId) &&
        Boolean(cfg.workerServiceUrl) &&
        Boolean(cfg.workerSaEmail)
    );
}

/**
 * Permite inyectar handlers explícitos o dejar resolución diferida hacia `CampChannel` (evita ciclos de importación).
 */
export function registerSupplyTaskHandlers(handlers: SupplyTaskHandlers | null): void {
    customHandlers = handlers;
}

/**
 * Hook exclusivo para pruebas deterministas de `verifySupplyWorkerOidcAuth` sin red externa.
 */
export function setCustomOidcVerifierForTests(verifier: OidcTokenVerifierFn | null): void {
    customOidcVerifier = verifier;
}

export function clearLocalSupplyTaskTimers(): void {
    for (const timer of localFlushTimers.values()) {
        clearTimeout(timer);
    }
    localFlushTimers.clear();
}

export async function waitForLocalSupplyTasksForTests(): Promise<void> {
    while (pendingLocalPromises.size > 0) {
        await Promise.allSettled(Array.from(pendingLocalPromises));
    }
}

async function resolveHandlers(): Promise<SupplyTaskHandlers> {
    if (customHandlers) return customHandlers;
    // Resolución diferida para evitar dependencia circular con `camp.channel.ts`
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CampChannel } = require('../channels/camp.channel') as typeof import('../channels/camp.channel');
    return {
        onInbound: (payload) =>
            CampChannel.handleInboundMessage(payload.event, {
                flushImmediately: payload.flushImmediately,
                dispatchToken: payload.dispatchToken,
                skipOutboundSend: payload.skipOutboundSend,
            }),
        onFlush: (payload) =>
            CampChannel.flushDebouncedSession(payload.sessionId, undefined, {
                skipOutboundSend: payload.skipOutboundSend,
                forceFlush: payload.forceFlush,
                expectedDebounceUntilMs: payload.expectedDebounceUntilMs,
            }),
    };
}

function trackLocalAsyncWork(work: () => Promise<void>): void {
    const promise = Promise.resolve()
        .then(work)
        .catch((err) => {
            console.error(
                '[SUPPLY-TASK-QUEUE] Error en worker local asíncrono:',
                err instanceof Error ? err.message : 'UnknownError'
            );
        })
        .finally(() => {
            pendingLocalPromises.delete(promise);
        });
    pendingLocalPromises.add(promise);
}

export class SupplyTaskQueueService {
    /**
     * Encola un mensaje entrante de Meta WhatsApp para procesamiento asíncrono inmediato
     * (Cloud Tasks OIDC en producción `southamerica-west1`; `setImmediate` no bloqueante en dev/test).
     */
    public static async enqueueInboundWhatsAppMessage(
        payload: Omit<SupplyInboundWhatsAppTaskPayload, 'enqueuedAtMs'> & { enqueuedAtMs?: number }
    ): Promise<{
        enqueued: boolean;
        dispatchMode: SupplyTaskDispatchMode;
        taskName?: string;
    }> {
        const fullPayload: SupplyInboundWhatsAppTaskPayload = {
            ...payload,
            enqueuedAtMs: payload.enqueuedAtMs ?? Date.now(),
        };

        const cfg = resolveEffectiveRuntimeConfig();
        if (isSupplyCloudTasksProductionMode()) {
            try {
                if (!tasksClient) tasksClient = new CloudTasksClient();
                const queuePath = tasksClient.queuePath(
                    cfg.gcpProjectId,
                    cfg.gcpLocation,
                    cfg.queueName
                );
                const targetUrl = `${cfg.workerServiceUrl.replace(/\/+$/, '')}/api/supply/whatsapp/worker/inbound`;

                const [created] = await tasksClient.createTask({
                    parent: queuePath,
                    task: {
                        httpRequest: {
                            httpMethod: 'POST',
                            url: targetUrl,
                            headers: { 'Content-Type': 'application/json' },
                            body: Buffer.from(JSON.stringify(fullPayload)).toString('base64'),
                            oidcToken: {
                                serviceAccountEmail: cfg.workerSaEmail,
                                audience: cfg.workerServiceUrl,
                            },
                        },
                    },
                });

                return {
                    enqueued: true,
                    dispatchMode: 'CLOUD_TASKS_OIDC',
                    taskName: created?.name || undefined,
                };
            } catch (ctErr) {
                console.warn(
                    '[SUPPLY-TASK-QUEUE] Error encolando inbound en Cloud Tasks; fallback a worker local asíncrono:',
                    ctErr instanceof Error ? ctErr.message : 'UnknownError'
                );
            }
        }

        // Despacho asíncrono local no bloqueante (jamás retrasa el HTTP 200 del webhook)
        trackLocalAsyncWork(async () => {
            await new Promise<void>((resolve) => setImmediate(resolve));
            const handlers = await resolveHandlers();
            await handlers.onInbound(fullPayload);
        });

        return {
            enqueued: true,
            dispatchMode: 'LOCAL_ASYNC_WORKER',
        };
    }

    /**
     * Programa el flush diferido de una sesión WhatsApp al vencer `debounceUntilMs` (`scheduleAtMs`).
     * En Cloud Run producción utiliza `scheduleTime` nativo de Google Cloud Tasks (100% stateless).
     * En dev/emulador/test usa timer local `.unref()` como fallback.
     */
    public static async enqueueSessionFlush(
        payload: Omit<SupplySessionFlushTaskPayload, 'enqueuedAtMs'> & { enqueuedAtMs?: number },
        scheduleAtMs: number
    ): Promise<{
        scheduled: boolean;
        dispatchMode: SupplyTaskDispatchMode;
        scheduleAtMs: number;
        taskName?: string;
    }> {
        const effectiveScheduleMs = Number.isFinite(scheduleAtMs)
            ? Math.max(Date.now() + 50, Math.round(scheduleAtMs))
            : Date.now() + 10_000;

        const fullPayload: SupplySessionFlushTaskPayload = {
            ...payload,
            expectedDebounceUntilMs: payload.expectedDebounceUntilMs ?? effectiveScheduleMs,
            enqueuedAtMs: payload.enqueuedAtMs ?? Date.now(),
        };

        const cfg = resolveEffectiveRuntimeConfig();
        if (isSupplyCloudTasksProductionMode()) {
            try {
                if (!tasksClient) tasksClient = new CloudTasksClient();
                const queuePath = tasksClient.queuePath(
                    cfg.gcpProjectId,
                    cfg.gcpLocation,
                    cfg.queueName
                );
                const targetUrl = `${cfg.workerServiceUrl.replace(/\/+$/, '')}/api/supply/whatsapp/worker/flush`;
                const scheduleSeconds = Math.max(
                    Math.floor(Date.now() / 1000) + 1,
                    Math.ceil(effectiveScheduleMs / 1000)
                );

                const [created] = await tasksClient.createTask({
                    parent: queuePath,
                    task: {
                        scheduleTime: { seconds: scheduleSeconds },
                        httpRequest: {
                            httpMethod: 'POST',
                            url: targetUrl,
                            headers: { 'Content-Type': 'application/json' },
                            body: Buffer.from(JSON.stringify(fullPayload)).toString('base64'),
                            oidcToken: {
                                serviceAccountEmail: cfg.workerSaEmail,
                                audience: cfg.workerServiceUrl,
                            },
                        },
                    },
                });

                return {
                    scheduled: true,
                    dispatchMode: 'CLOUD_TASKS_OIDC',
                    scheduleAtMs: effectiveScheduleMs,
                    taskName: created?.name || undefined,
                };
            } catch (ctErr) {
                console.warn(
                    '[SUPPLY-TASK-QUEUE] Error programando flush en Cloud Tasks; fallback a timer local:',
                    ctErr instanceof Error ? ctErr.message : 'UnknownError'
                );
            }
        }

        // Fallback exclusivo para dev/emulador/test cuando Cloud Tasks no está activo
        const prevTimer = localFlushTimers.get(fullPayload.sessionId);
        if (prevTimer) clearTimeout(prevTimer);

        const delayMs = Math.max(50, effectiveScheduleMs - Date.now() + 50);
        const timer = setTimeout(() => {
            localFlushTimers.delete(fullPayload.sessionId);
            trackLocalAsyncWork(async () => {
                const handlers = await resolveHandlers();
                await handlers.onFlush(fullPayload);
            });
        }, delayMs);
        if (typeof timer.unref === 'function') timer.unref();
        localFlushTimers.set(fullPayload.sessionId, timer);

        return {
            scheduled: true,
            dispatchMode: 'LOCAL_ASYNC_WORKER',
            scheduleAtMs: effectiveScheduleMs,
        };
    }
}

/**
 * Middleware OIDC Fail-Closed para endpoints internos `/api/supply/whatsapp/worker/*`.
 * - En producción exige obligatoriamente Bearer OIDC validado vía `OAuth2Client.verifyIdToken`
 *   con `audience === WORKER_SERVICE_URL` y `payload.email === WORKER_SA_EMAIL` (`401`/`403` fail-closed).
 * - En entornos no productivos con `TASKS_EMULATOR=true` acepta header constante `X-Minreport-Local-Worker`.
 */
export async function verifySupplyWorkerOidcAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const cfg = resolveEffectiveRuntimeConfig();

    if (process.env.TASKS_EMULATOR === 'true' && cfg.nodeEnv !== 'production') {
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
        return res.status(401).json({
            error: 'Header X-Minreport-Local-Worker inválido o ausente.',
            code: 'WORKER_OIDC_UNAUTHORIZED',
        });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Token OIDC de Cloud Tasks requerido.',
            code: 'WORKER_OIDC_TOKEN_REQUIRED',
        });
    }

    if (cfg.nodeEnv === 'production' && (!cfg.workerServiceUrl || !cfg.workerSaEmail)) {
        return res.status(403).json({
            error: 'Configuración OIDC de worker (WORKER_SERVICE_URL / WORKER_SA_EMAIL) ausente en producción.',
            code: 'WORKER_OIDC_MISCONFIGURED',
        });
    }

    const idToken = authHeader.slice(7).trim();
    if (!idToken) {
        return res.status(401).json({
            error: 'Token OIDC vacío.',
            code: 'WORKER_OIDC_TOKEN_REQUIRED',
        });
    }

    try {
        let payload: { email?: string; email_verified?: boolean } | null = null;
        if (customOidcVerifier) {
            payload = await customOidcVerifier(idToken, cfg.workerServiceUrl);
        } else {
            const ticket = await oauthClient.verifyIdToken({
                idToken,
                audience: cfg.workerServiceUrl,
            });
            const ticketPayload = ticket.getPayload();
            payload = ticketPayload
                ? {
                      email: ticketPayload.email,
                      email_verified: ticketPayload.email_verified,
                  }
                : null;
        }

        if (!payload) {
            return res.status(401).json({
                error: 'Token OIDC inválido o sin claims verificables.',
                code: 'WORKER_OIDC_INVALID',
            });
        }

        if (payload.email_verified === false) {
            return res.status(403).json({
                error: 'Service Account OIDC sin correo verificado.',
                code: 'WORKER_OIDC_SA_FORBIDDEN',
            });
        }

        if (
            cfg.workerSaEmail &&
            String(payload.email || '').trim().toLowerCase() !== cfg.workerSaEmail.toLowerCase()
        ) {
            return res.status(403).json({
                error: 'Service Account OIDC no autorizada para Supply Worker.',
                code: 'WORKER_OIDC_SA_FORBIDDEN',
            });
        }

        return next();
    } catch (err) {
        console.error(
            '[SUPPLY-OIDC-WORKER] Fallo verificación OIDC:',
            err instanceof Error ? err.name : 'UnknownError'
        );
        return res.status(401).json({
            error: 'Token OIDC inválido.',
            code: 'WORKER_OIDC_INVALID',
        });
    }
}
