import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

/**
 * Healthcheck soberano minimalista de Cloud Functions Gen 2 (`southamerica-west1`).
 */
export const systemHealthCheck = onRequest(
    {
        region: "southamerica-west1",
        cors: ["https://minreport.com", "https://www.minreport.com", "https://minreport-access.web.app"],
        maxInstances: 5,
    },
    (request, response) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
            response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
            return;
        }

        const payload = {
            service: "minreport-functions-gen2",
            region: "southamerica-west1",
            timestamp: new Date().toISOString(),
        };

        logger.info("MINREPORT systemHealthCheck ejecutado", {
            region: payload.region,
            method: request.method,
        });

        response.status(200).json(payload);
    }
);

// ---------------------------------------------------------------------------
// MINREPORT · ABASTECIMIENTO — Cloud Scheduler Gen 2 (`southamerica-west1`)
// 100% auto-contenido (sin imports relativos externos a `services/functions/src`)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const LEY19983_RCV_DEADLINE_DAYS = 8;
const LEY21719_MIN_K_ANONYMITY = 5;
const DEFAULT_SCHEDULER_QUERY_LIMIT = 500;

export interface MinimalFirestoreDocSnapshot {
    id: string;
    ref: {
        set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<unknown>;
        delete: () => Promise<unknown>;
    };
    data: () => Record<string, unknown> | undefined;
}

export interface MinimalFirestoreQueryLike {
    where: (field: string, op: "==", value: unknown) => MinimalFirestoreQueryLike;
    limit: (n: number) => MinimalFirestoreQueryLike;
    get: () => Promise<{ docs: MinimalFirestoreDocSnapshot[] }>;
}

export interface MinimalFirestoreCollectionLike extends MinimalFirestoreQueryLike {
    doc: (docId: string) => {
        set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<unknown>;
    };
}

export interface MinimalFirestoreLike {
    collection: (name: string) => MinimalFirestoreCollectionLike;
}

export interface SiiRcvDeadlineAlertSummary {
    scannedCount: number;
    ignoredNonEligibleCount: number;
    day5Warnings: number;
    day7Criticals: number;
    expired8dCount: number;
    skippedDuplicateAlerts: number;
    alertedDocIds: string[];
}

export type MarketSignalPurgeReason =
    | "K_BELOW_5"
    | "OPT_IN_UNVERIFIED"
    | "TTL_EXPIRED"
    | "SANDBOX_CONTAMINATION";

export interface MarketSignalMaintenanceSummary {
    scannedCount: number;
    retainedCount: number;
    purgedCount: number;
    purgedSignals: Array<{ signalId: string; reasons: MarketSignalPurgeReason[] }>;
}

function getDefaultFirestore(): MinimalFirestoreLike {
    if (admin.apps.length === 0) {
        admin.initializeApp();
    }
    return admin.firestore() as unknown as MinimalFirestoreLike;
}

function parseIssueDateUtcMs(rawIssueDate: unknown): number | null {
    const str = String(rawIssueDate || "").trim();
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }
    return Date.UTC(year, month - 1, day);
}

function toEpochMs(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (value && typeof value === "object") {
        const maybeTs = value as { toMillis?: () => number; _seconds?: number; seconds?: number };
        if (typeof maybeTs.toMillis === "function") {
            return maybeTs.toMillis();
        }
        if (typeof maybeTs._seconds === "number") {
            return maybeTs._seconds * 1000;
        }
        if (typeof maybeTs.seconds === "number") {
            return maybeTs.seconds * 1000;
        }
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Date.parse(value.trim());
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return 0;
}

function isSandboxIdentifier(raw: unknown): boolean {
    const val = String(raw || "").trim().toLowerCase();
    if (!val) {
        return false;
    }
    return (
        val.startsWith("pilot-") ||
        val.startsWith("edu-") ||
        val === "dev-master-sandbox" ||
        val.includes("dev-master-sandbox") ||
        val.includes("pilot-") ||
        val.includes("edu-sandbox")
    );
}

function hasSandboxContamination(signalId: string, data: Record<string, unknown>): boolean {
    if (isSandboxIdentifier(signalId)) {
        return true;
    }
    if (data.isSandbox === true || data.isEduSandbox === true || data.isTestPilot === true) {
        return true;
    }
    const scalarFields = ["tenantId", "accountId", "siteId", "districtCode", "sourceTenantId"];
    for (const field of scalarFields) {
        if (isSandboxIdentifier(data[field])) {
            return true;
        }
    }
    const arrayFields = ["tenantIds", "sourceTenantIds", "participatingTenantIds", "siteIds"];
    for (const field of arrayFields) {
        const list = data[field];
        if (Array.isArray(list) && list.some((entry) => isSandboxIdentifier(entry))) {
            return true;
        }
    }
    return false;
}

/**
 * Lógica pura y testeable del Semáforo Ley N° 19.983 (RCV 8 días para DTE 33 y 34):
 * - Día 5 (`daysElapsed === 5` / `daysRemaining === 3`): alerta `RCV_DAY_5_WARNING`.
 * - Día 7 (`daysElapsed === 7` / `daysRemaining === 1`): alerta crítica `RCV_DAY_7_CRITICAL`.
 * - Día >= 8 (`daysRemaining <= 0`): marca `rcvStatus: 'AUTO_ACCEPTED_EXPIRED'` + alerta `RCV_EXPIRED_8D`.
 * - Idempotente por `rcvAlertsSent`; ignora DTE 39, 41, 52, 61 y 0; cero PII en `supply_policy_audit`.
 */
export async function evaluateSiiRcvDeadlineAlerts(
    firestoreDb: MinimalFirestoreLike,
    options?: { nowMs?: number; limit?: number }
): Promise<SiiRcvDeadlineAlertSummary> {
    const nowMs =
        typeof options?.nowMs === "number" && Number.isFinite(options.nowMs)
            ? options.nowMs
            : Date.now();
    const limit =
        typeof options?.limit === "number" && options.limit > 0
            ? Math.min(500, Math.floor(options.limit))
            : DEFAULT_SCHEDULER_QUERY_LIMIT;
    const nowDate = new Date(nowMs);
    const todayUtcMs = Date.UTC(
        nowDate.getUTCFullYear(),
        nowDate.getUTCMonth(),
        nowDate.getUTCDate()
    );
    const nowIso = nowDate.toISOString();

    const [reviewSnap, acceptanceSnap] = await Promise.all([
        firestoreDb
            .collection("supply_sii_documents")
            .where("rcvStatus", "==", "PENDING_REVIEW")
            .limit(limit)
            .get(),
        firestoreDb
            .collection("supply_sii_documents")
            .where("rcvStatus", "==", "PENDING_ACCEPTANCE")
            .limit(limit)
            .get(),
    ]);

    const seenIds = new Set<string>();
    const docs: MinimalFirestoreDocSnapshot[] = [];
    for (const doc of [...reviewSnap.docs, ...acceptanceSnap.docs]) {
        if (!seenIds.has(doc.id) && docs.length < limit) {
            seenIds.add(doc.id);
            docs.push(doc);
        }
    }

    const summary: SiiRcvDeadlineAlertSummary = {
        scannedCount: docs.length,
        ignoredNonEligibleCount: 0,
        day5Warnings: 0,
        day7Criticals: 0,
        expired8dCount: 0,
        skippedDuplicateAlerts: 0,
        alertedDocIds: [],
    };

    for (const doc of docs) {
        const data = doc.data() || {};
        const dteType = Number(data.documentType ?? data.dteType ?? 0);

        // Ley N° 19.983 (plazo 8 días RCV) aplica exclusivamente a Factura Afecta (33) y Factura Exenta (34)
        if (dteType !== 33 && dteType !== 34) {
            summary.ignoredNonEligibleCount += 1;
            continue;
        }

        const issueUtcMs = parseIssueDateUtcMs(data.issueDate);
        if (issueUtcMs === null) {
            summary.ignoredNonEligibleCount += 1;
            continue;
        }

        const daysElapsed = Math.floor((todayUtcMs - issueUtcMs) / DAY_MS);
        const daysRemaining = LEY19983_RCV_DEADLINE_DAYS - daysElapsed;
        const sentAlerts = new Set<string>(
            Array.isArray(data.rcvAlertsSent)
                ? data.rcvAlertsSent.map((v) => String(v))
                : []
        );

        let policyCode: "RCV_DAY_5_WARNING" | "RCV_DAY_7_CRITICAL" | "RCV_EXPIRED_8D" | null = null;
        let severity: "HIGH" | "CRITICAL" = "HIGH";
        let nextRcvStatus: string | null = null;

        if (daysRemaining <= 0) {
            policyCode = "RCV_EXPIRED_8D";
            severity = "CRITICAL";
            nextRcvStatus = "AUTO_ACCEPTED_EXPIRED";
        } else if (daysElapsed === 7 || daysRemaining === 1) {
            policyCode = "RCV_DAY_7_CRITICAL";
            severity = "CRITICAL";
        } else if (daysElapsed === 5 || daysRemaining === 3) {
            policyCode = "RCV_DAY_5_WARNING";
            severity = "HIGH";
        }

        if (!policyCode) {
            continue;
        }

        if (sentAlerts.has(policyCode)) {
            summary.skippedDuplicateAlerts += 1;
            continue;
        }

        sentAlerts.add(policyCode);
        const tenantId = String(data.tenantId || "unknown");
        const siteId = typeof data.siteId === "string" ? data.siteId : undefined;
        const auditId = `paud_rcv_${nowMs.toString(36)}_${crypto.randomBytes(4).toString("hex")}`;

        await firestoreDb
            .collection("supply_policy_audit")
            .doc(auditId)
            .set({
                auditId,
                tenantId,
                ...(siteId ? { siteId } : {}),
                actorUid: "system:supplySiiRcvDeadlineMonitor",
                eventType: "SII_FISCAL_WARNING",
                policyCode,
                severity,
                entityId: doc.id,
                details: {
                    documentType: dteType,
                    folio: Number(data.folio || 0),
                    issueDate: String(data.issueDate || ""),
                    daysElapsed,
                    daysRemaining: Math.max(0, daysRemaining),
                    lawReference: "LEY_19983_RCV_8D",
                },
                createdAt: nowIso,
            });

        const docPatch: Record<string, unknown> = {
            rcvAlertsSent: Array.from(sentAlerts),
            rcvDaysRemaining: Math.max(0, daysRemaining),
            updatedAt: nowIso,
        };
        if (nextRcvStatus) {
            docPatch.rcvStatus = nextRcvStatus;
        }

        await doc.ref.set(docPatch, { merge: true });

        if (policyCode === "RCV_DAY_5_WARNING") {
            summary.day5Warnings += 1;
        } else if (policyCode === "RCV_DAY_7_CRITICAL") {
            summary.day7Criticals += 1;
        } else {
            summary.expired8dCount += 1;
        }
        summary.alertedDocIds.push(doc.id);
    }

    return summary;
}

/**
 * Lógica pura y testeable de mantenimiento continuo `k >= 5` y Ley N° 21.719 en `market_demand_signals`:
 * purga señales con `participatingEntitiesCount < 5`, `optInVerified !== true`, expiradas por `ttlExpiresAt`
 * o con cualquier rastro de sandbox (`pilot-*`, `dev-master-sandbox`, `edu-*`).
 */
export async function maintainMarketDemandSignalsK5(
    firestoreDb: MinimalFirestoreLike,
    options?: { nowMs?: number; limit?: number }
): Promise<MarketSignalMaintenanceSummary> {
    const nowMs =
        typeof options?.nowMs === "number" && Number.isFinite(options.nowMs)
            ? options.nowMs
            : Date.now();
    const limit =
        typeof options?.limit === "number" && options.limit > 0
            ? Math.min(500, Math.floor(options.limit))
            : DEFAULT_SCHEDULER_QUERY_LIMIT;

    const snap = await firestoreDb
        .collection("market_demand_signals")
        .limit(limit)
        .get();

    const summary: MarketSignalMaintenanceSummary = {
        scannedCount: snap.docs.length,
        retainedCount: 0,
        purgedCount: 0,
        purgedSignals: [],
    };

    for (const doc of snap.docs) {
        const data = doc.data() || {};
        const reasons: MarketSignalPurgeReason[] = [];

        const participatingCount = Number(data.participatingEntitiesCount ?? 0);
        if (!Number.isFinite(participatingCount) || participatingCount < LEY21719_MIN_K_ANONYMITY) {
            reasons.push("K_BELOW_5");
        }

        if (data.optInVerified !== true) {
            reasons.push("OPT_IN_UNVERIFIED");
        }

        const ttlMs = toEpochMs(data.ttlExpiresAt);
        if (ttlMs > 0 && ttlMs <= nowMs) {
            reasons.push("TTL_EXPIRED");
        }

        if (hasSandboxContamination(doc.id, data)) {
            reasons.push("SANDBOX_CONTAMINATION");
        }

        if (reasons.length > 0) {
            await doc.ref.delete();
            summary.purgedCount += 1;
            summary.purgedSignals.push({ signalId: doc.id, reasons });
        } else {
            summary.retainedCount += 1;
        }
    }

    return summary;
}

/**
 * Cloud Scheduler Gen 2 (`southamerica-west1`) — Semáforo Diario RCV 8 Días (Ley N° 19.983).
 */
export const supplySiiRcvDeadlineMonitor = onSchedule(
    {
        schedule: "0 8 * * *",
        timeZone: "America/Santiago",
        region: "southamerica-west1",
        maxInstances: 2,
    },
    async () => {
        const result = await evaluateSiiRcvDeadlineAlerts(getDefaultFirestore());
        logger.info("MINREPORT supplySiiRcvDeadlineMonitor ejecutado", result);
    }
);

/**
 * Cloud Scheduler Gen 2 (`southamerica-west1`) — Higiene Diaria `market_demand_signals` (`k >= 5` Ley N° 21.719).
 */
export const supplyMarketDemandSignalsMaintainer = onSchedule(
    {
        schedule: "0 3 * * *",
        timeZone: "America/Santiago",
        region: "southamerica-west1",
        maxInstances: 2,
    },
    async () => {
        const result = await maintainMarketDemandSignalsK5(getDefaultFirestore());
        logger.info("MINREPORT supplyMarketDemandSignalsMaintainer ejecutado", result);
    }
);
