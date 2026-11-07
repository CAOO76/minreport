import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../config/firebase';

/**
 * SERVICIO SOBERANO DE PERSISTENCIA CONTINUA EN DESARROLLO LOCAL (`DevEmulatorCheckpointService`)
 *
 * Resuelve de raíz la pérdida de datos entre sesiones de desarrollo local:
 * 1. Escucha en tiempo real (`onSnapshot`) las colecciones maestras y operativas del emulador Firestore
 *    (capturando tanto mutaciones del Backend Express como escrituras directas desde el SDK Web del navegador).
 * 2. Intercepta toda mutación HTTP exitosa (`POST`, `PUT`, `PATCH`, `DELETE`) en el Core API.
 * 3. Ejecuta un checkpoint atómico con debounce (2.0s) y mutex single-flight hacia el Firebase Emulator Hub
 *    (`POST http://127.0.0.1:4400/_admin/export` -> `./data`).
 * 4. Mantiene una copia espejo de recuperación atómica en `./_backups/data-last-good` para auto-reparación
 *    en caso de cierre forzado o corte de energía.
 */

const WATCHED_COLLECTIONS: readonly string[] = [
    'global_asset_catalog',
    'global_asset_lineages',
    'global_equipment_types',
    'tenant_assets',
    'knowledge_vault',
    'vault_items',
    'vault_chat_sessions',
    'media_registry',
    'stockpiles',
    'accounts',
    'users',
    'pilot_feedback',
    'hitl_candidates',
    'ai_inference_cache',
    'modules_status',
    'system_settings',
    'audit_ledger',
];

export class DevEmulatorCheckpointService {
    private static started = false;
    private static debounceTimer: NodeJS.Timeout | null = null;
    private static isExporting = false;
    private static pendingFollowUpReason: string | null = null;
    private static lastReason: string = 'init';
    private static unsubscribers: Array<() => void> = [];

    private static readonly DEBOUNCE_MS = 2000;
    private static readonly DATA_DIR = path.resolve(process.cwd(), 'data');
    private static readonly BACKUP_DIR = path.resolve(process.cwd(), '_backups', 'data-last-good');

    public static isEmulatorPersistenceActive(): boolean {
        return Boolean(process.env.FIRESTORE_EMULATOR_HOST) && process.env.NODE_ENV !== 'test';
    }

    /**
     * Descubre dinámicamente el puerto del Firebase Emulator Hub leyendo el archivo locator en `os.tmpdir()`
     * o usando `http://127.0.0.1:4400` por defecto.
     */
    private static resolveHubEndpoint(): { host: string; port: number } {
        const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'minreport-8f2a8';
        const candidates = [
            path.join(os.tmpdir(), `hub-${projectId}.json`),
            path.join(os.tmpdir(), 'hub-demo-no-project.json'),
        ];

        for (const locatorPath of candidates) {
            try {
                if (fs.existsSync(locatorPath)) {
                    const raw = fs.readFileSync(locatorPath, 'utf8');
                    const parsed = JSON.parse(raw) as { origins?: string[]; host?: string; port?: number };
                    if (Array.isArray(parsed.origins) && parsed.origins.length > 0) {
                        const ipv4Origin =
                            parsed.origins.find((o) => o.includes('127.0.0.1') || o.includes('localhost')) ||
                            parsed.origins[0];
                        const url = new URL(ipv4Origin);
                        return {
                            host: url.hostname === '0.0.0.0' ? '127.0.0.1' : url.hostname,
                            port: Number(url.port) || 4400,
                        };
                    }
                    if (parsed.port) {
                        return {
                            host: parsed.host && parsed.host !== '0.0.0.0' ? parsed.host : '127.0.0.1',
                            port: Number(parsed.port),
                        };
                    }
                }
            } catch {
                // Continuar con fallback estándar 127.0.0.1:4400
            }
        }

        return { host: '127.0.0.1', port: 4400 };
    }

    /**
     * Inicia los watchers en tiempo real sobre las colecciones del emulador Firestore.
     */
    public static start(): void {
        if (this.started || !this.isEmulatorPersistenceActive()) {
            return;
        }
        this.started = true;

        for (const collectionName of WATCHED_COLLECTIONS) {
            let isInitialSnapshot = true;
            const unsubscribe = db.collection(collectionName).onSnapshot(
                (snapshot) => {
                    if (isInitialSnapshot) {
                        isInitialSnapshot = false;
                        return;
                    }
                    const changes = snapshot.docChanges();
                    if (changes.length > 0) {
                        this.scheduleCheckpoint(`firestore:${collectionName}(${changes.length})`);
                    }
                },
                (err) => {
                    console.warn(
                        `[DEV-CHECKPOINT] Advertencia en listener de colección ${collectionName}:`,
                        err?.message || err
                    );
                }
            );
            this.unsubscribers.push(unsubscribe);
        }

        console.log(
            `[DEV-CHECKPOINT] Persistencia continua activa hacia ${this.DATA_DIR} (${WATCHED_COLLECTIONS.length} colecciones monitoreadas en tiempo real).`
        );
    }

    /**
     * Middleware Express que agenda un checkpoint tras cualquier mutación HTTP exitosa.
     */
    public static expressMutationMiddleware() {
        return (req: Request, res: Response, next: NextFunction): void => {
            if (!this.isEmulatorPersistenceActive()) {
                next();
                return;
            }
            const method = req.method.toUpperCase();
            if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
                res.on('finish', () => {
                    if (res.statusCode >= 200 && res.statusCode < 400) {
                        this.scheduleCheckpoint(`http:${method}:${req.originalUrl}`);
                    }
                });
            }
            next();
        };
    }

    /**
     * Agenda un checkpoint con debounce de 2.0s para agrupar ráfagas de escritura.
     */
    public static scheduleCheckpoint(reason: string): void {
        if (!this.isEmulatorPersistenceActive()) {
            return;
        }
        this.lastReason = reason;
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            void this.executeExport(this.lastReason);
        }, this.DEBOUNCE_MS);
    }

    /**
     * Fuerza un volcado inmediato a `./data` antes de apagar o reiniciar el servidor.
     */
    public static async flushOnShutdown(signal: string): Promise<void> {
        if (!this.isEmulatorPersistenceActive()) {
            return;
        }
        const hadPendingTimer = Boolean(this.debounceTimer);
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        for (const unsub of this.unsubscribers) {
            try {
                unsub();
            } catch {
                // Ignorar errores al cerrar listeners
            }
        }
        this.unsubscribers = [];

        if (hadPendingTimer || signal === 'SIGINT' || signal === 'SIGTERM') {
            await this.executeExport(`shutdown:${signal}`);
        }
    }

    /**
     * Ejecuta la exportación atómica contra el Firebase Emulator Hub (`/_admin/export`)
     * protegida por un mutex single-flight.
     */
    public static async executeExport(reason: string): Promise<boolean> {
        if (!this.isEmulatorPersistenceActive()) {
            return false;
        }
        if (this.isExporting) {
            this.pendingFollowUpReason = reason;
            return false;
        }

        this.isExporting = true;
        try {
            const { host, port } = this.resolveHubEndpoint();
            const payload = JSON.stringify({
                path: this.DATA_DIR,
                initiatedBy: `minreport-auto-checkpoint:${reason}`,
            });

            await new Promise<void>((resolve, reject) => {
                const req = http.request(
                    {
                        hostname: host,
                        port,
                        path: '/_admin/export',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(payload),
                        },
                        timeout: 15000,
                    },
                    (res) => {
                        let responseBody = '';
                        res.on('data', (chunk) => {
                            responseBody += chunk.toString();
                        });
                        res.on('end', () => {
                            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                                resolve();
                            } else {
                                reject(
                                    new Error(
                                        `Hub export HTTP ${res.statusCode || 500}: ${responseBody.slice(0, 200)}`
                                    )
                                );
                            }
                        });
                    }
                );

                req.on('timeout', () => {
                    req.destroy(new Error('Timeout esperando respuesta de Emulator Hub /_admin/export'));
                });
                req.on('error', (err) => reject(err));
                req.write(payload);
                req.end();
            });

            this.syncMirrorBackup();
            console.log(`[DEV-CHECKPOINT] Datos locales sincronizados en ./data (origen: ${reason}).`);
            return true;
        } catch (err: any) {
            console.warn(`[DEV-CHECKPOINT] No se pudo completar export automático (${reason}):`, err?.message || err);
            return false;
        } finally {
            this.isExporting = false;
            if (this.pendingFollowUpReason) {
                const nextReason = this.pendingFollowUpReason;
                this.pendingFollowUpReason = null;
                this.scheduleCheckpoint(nextReason);
            }
        }
    }

    /**
     * Mantiene una copia espejo verificada en `_backups/data-last-good` cuando `./data` contiene
     * `firebase-export-metadata.json` válido.
     */
    private static syncMirrorBackup(): void {
        try {
            const metadataFile = path.join(this.DATA_DIR, 'firebase-export-metadata.json');
            if (!fs.existsSync(metadataFile)) {
                return;
            }
            fs.mkdirSync(path.dirname(this.BACKUP_DIR), { recursive: true });
            fs.cpSync(this.DATA_DIR, this.BACKUP_DIR, { recursive: true, force: true });
        } catch (err: any) {
            console.warn('[DEV-CHECKPOINT] Advertencia al actualizar copia espejo _backups/data-last-good:', err?.message);
        }
    }
}
