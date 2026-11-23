import crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../../config/firebase';
import {
    type ConversationRetentionPolicy,
    type ConversationScopeSnapshot,
    type ConversationTurnDirection,
    type EvidenceCasRef,
    type SupplyConversationThread,
    SupplyConversationThreadSchema,
    type SupplyConversationTurn,
    SupplyConversationTurnSchema,
    type SupplyOperationalRole,
    type SupplyWhatsAppChannelId,
} from '../../../contracts/supply.contracts';
import { AuditLedger } from '../../../core/audit-ledger';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { computeSixYearRetentionTimestamp } from '../../../core/retention-policy';
import { maskE164PhoneForStorage } from '../adapters/ProvisionalSupplyProfileAdapter';
import { SUPPLY_COLLECTIONS } from '../application/SupplyRepository';

/**
 * CONVERSATION AUDIT SERVICE (`V3-E03`)
 *
 * Archivo inmutable y auditable de conversaciones WhatsApp por perfil en Cloud Firestore (`southamerica-west1`):
 * - `supply_conversation_threads/{threadId}` (`cthread_${tenantId}_${profileId}`)
 * - `supply_conversation_turns/{turnId}` (append-only transaccional encadenado con `prevHash` ➔ `turnHash` SHA-256)
 * - Sanitización previa de `contentScrubbed` vía `ConfidentialityAirlockService` (Ley N° 21.719).
 * - Retención legal diferenciada:
 *   - `OPERATIONAL_24M` (24 meses + TTL Firestore) cuando no hay respaldo tributario/requisición.
 *   - `TAX_HOLD_6Y` (6 años calendario Art. 17 Código Tributario, sin `ttlExpiresAt`) al vincular `REQ`/`PUR`/`DTE`.
 *   - ARCO-P: `LEGAL_HOLD_PSEUDONYMIZED` pseudonimiza al titular preservando la cadena `turnHash` íntegra.
 */

export const GENESIS_CONVERSATION_HASH = '0'.repeat(64);
const TWENTY_FOUR_MONTHS_MS = 730 * 24 * 60 * 60 * 1000;

function safePart(raw: string): string {
    return String(raw || '')
        .trim()
        .replace(/[^A-Za-z0-9._-]/g, '_');
}

export function buildConversationThreadId(tenantId: string, profileId: string): string {
    return `cthread_${safePart(tenantId)}_${safePart(profileId)}`;
}

function hashPhoneSha256(phoneE164: string): string {
    return crypto.createHash('sha256').update(String(phoneE164 || '').trim(), 'utf8').digest('hex');
}

function addMonthsIso(baseMs: number, months: number): string {
    const d = new Date(baseMs);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString();
}

function addYearsIso(baseMs: number, years: number): string {
    const d = new Date(baseMs);
    d.setUTCFullYear(d.getUTCFullYear() + years);
    return d.toISOString();
}

export function computeConversationTurnHash(params: {
    prevHash: string;
    threadId: string;
    tenantId: string;
    profileId: string;
    seq: number;
    direction: ConversationTurnDirection;
    contentScrubbed: string;
    scopeFingerprint: string;
    createdAtIso: string;
    linkedRequisitionIds: readonly string[];
    linkedPurchaseIds: readonly string[];
    linkedDteIds: readonly string[];
}): string {
    const canonical = JSON.stringify({
        prevHash: params.prevHash,
        threadId: params.threadId,
        tenantId: params.tenantId,
        profileId: params.profileId,
        seq: params.seq,
        direction: params.direction,
        contentScrubbed: params.contentScrubbed,
        scopeFingerprint: params.scopeFingerprint,
        createdAtIso: params.createdAtIso,
        linkedRequisitionIds: [...params.linkedRequisitionIds].sort(),
        linkedPurchaseIds: [...params.linkedPurchaseIds].sort(),
        linkedDteIds: [...params.linkedDteIds].sort(),
    });
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface AppendConversationTurnInput {
    tenantId: string;
    profileId: string;
    displayName: string;
    role: SupplyOperationalRole;
    phoneE164?: string;
    phoneMasked?: string;
    phoneHashSha256?: string;
    siteId?: string | null;
    direction: ConversationTurnDirection;
    channelSource?: 'WHATSAPP_CLOUD' | 'WHATSAPP_FLOW_V3' | 'SIMULATOR' | 'SYSTEM';
    wamid?: string | null;
    rawContent: string;
    scopeSnapshot: ConversationScopeSnapshot;
    casMedia?: EvidenceCasRef[];
    policyAuditRefs?: string[];
    aiModelUsed?: string | null;
    linkedRequisitionIds?: string[];
    linkedPurchaseIds?: string[];
    linkedDteIds?: string[];
    nowIso?: string;
}

export interface VerifyThreadChainResult {
    valid: boolean;
    turnCount: number;
    brokenAtSeq?: number;
    reason?: string;
}

export class ConversationAuditService {
    public static async appendTurn(
        input: AppendConversationTurnInput
    ): Promise<{ thread: SupplyConversationThread; turn: SupplyConversationTurn }> {
        const nowIso = input.nowIso || new Date().toISOString();
        const nowMs = Number.isFinite(Date.parse(nowIso)) ? Date.parse(nowIso) : Date.now();
        const threadId = buildConversationThreadId(input.tenantId, input.profileId);

        const airlock = ConfidentialityAirlockService.scrubDeterministicPii(
            String(input.rawContent || ''),
            'CL'
        );
        const contentScrubbed = (airlock.scrubbed || '').slice(0, 8000);
        const linkedReqIds = Array.from(new Set(input.linkedRequisitionIds || []));
        const linkedPurIds = Array.from(new Set(input.linkedPurchaseIds || []));
        const linkedDteIds = Array.from(new Set(input.linkedDteIds || []));

        const turnHasTaxSupport =
            linkedReqIds.length > 0 || linkedPurIds.length > 0 || linkedDteIds.length > 0;
        const turnLegalHoldTaxYears = turnHasTaxSupport ? 6 : 0;
        const turnRetentionExpiresAtIso = turnHasTaxSupport
            ? addYearsIso(nowMs, 6)
            : addMonthsIso(nowMs, 24);
        const turnTtlExpiresAt = turnHasTaxSupport
            ? null
            : Timestamp.fromMillis(nowMs + TWENTY_FOUR_MONTHS_MS);

        const resolvedPhoneMasked =
            input.phoneMasked ||
            (input.phoneE164 ? maskE164PhoneForStorage(input.phoneE164) : '***REDACTED***');
        const resolvedPhoneHash =
            input.phoneHashSha256 ||
            (input.phoneE164 ? hashPhoneSha256(input.phoneE164) : GENESIS_CONVERSATION_HASH);

        const threadRef = db
            .collection(SUPPLY_COLLECTIONS.CONVERSATION_THREADS)
            .doc(threadId);

        let resultThread!: SupplyConversationThread;
        let resultTurn!: SupplyConversationTurn;

        const runTx = async (tx: {
            get: (r: any) => Promise<any>;
            set: (r: any, d: any, opts?: any) => any;
        }) => {
            const snap = await tx.get(threadRef);
            const prevThread = snap.exists ? (snap.data() as SupplyConversationThread) : null;
            const prevSeq = prevThread?.headSeq || 0;
            const prevHash = prevThread?.headHashSha256 || GENESIS_CONVERSATION_HASH;
            const seq = prevSeq + 1;

            const turnHash = computeConversationTurnHash({
                prevHash,
                threadId,
                tenantId: input.tenantId,
                profileId: input.profileId,
                seq,
                direction: input.direction,
                contentScrubbed,
                scopeFingerprint: input.scopeSnapshot.scopeFingerprint,
                createdAtIso: nowIso,
                linkedRequisitionIds: linkedReqIds,
                linkedPurchaseIds: linkedPurIds,
                linkedDteIds: linkedDteIds,
            });

            const turnId = `${threadId}__${String(seq).padStart(6, '0')}`;
            const turnRef = db
                .collection(SUPPLY_COLLECTIONS.CONVERSATION_TURNS)
                .doc(turnId);

            const turnRecord: SupplyConversationTurn = SupplyConversationTurnSchema.parse({
                turnId,
                threadId,
                tenantId: input.tenantId,
                profileId: input.profileId,
                siteId: input.siteId ?? null,
                seq,
                prevHash,
                turnHash,
                direction: input.direction,
                channelSource: input.channelSource || 'WHATSAPP_CLOUD',
                wamid: input.wamid ?? null,
                contentScrubbed,
                redactedCategories: airlock.redactedCategories,
                scopeSnapshot: input.scopeSnapshot,
                casMedia: input.casMedia || [],
                policyAuditRefs: input.policyAuditRefs || [],
                aiModelUsed: input.aiModelUsed ?? null,
                linkedRequisitionIds: linkedReqIds,
                linkedPurchaseIds: linkedPurIds,
                linkedDteIds: linkedDteIds,
                legalHoldTaxYears: turnLegalHoldTaxYears,
                retentionExpiresAtIso: turnRetentionExpiresAtIso,
                ...(turnTtlExpiresAt ? { ttlExpiresAt: turnTtlExpiresAt } : {}),
                createdAtIso: nowIso,
            });

            const mergedReqIds = Array.from(
                new Set([...(prevThread?.linkedRequisitionIds || []), ...linkedReqIds])
            );
            const mergedPurIds = Array.from(
                new Set([...(prevThread?.linkedPurchaseIds || []), ...linkedPurIds])
            );
            const mergedDteIds = Array.from(
                new Set([...(prevThread?.linkedDteIds || []), ...linkedDteIds])
            );

            const isTaxHold =
                (prevThread?.legalHoldTaxYears || 0) >= 6 ||
                turnHasTaxSupport ||
                mergedReqIds.length > 0 ||
                mergedPurIds.length > 0 ||
                mergedDteIds.length > 0;

            const nextRetentionPolicy: ConversationRetentionPolicy =
                prevThread?.retentionPolicy === 'LEGAL_HOLD_PSEUDONYMIZED'
                    ? 'LEGAL_HOLD_PSEUDONYMIZED'
                    : isTaxHold
                      ? 'TAX_HOLD_6Y'
                      : 'OPERATIONAL_24M';

            const nextLegalHoldYears = isTaxHold ? 6 : 0;
            const prevExpMs = prevThread?.retentionExpiresAtIso
                ? Date.parse(prevThread.retentionExpiresAtIso)
                : 0;
            const candidateExpMs = isTaxHold
                ? computeSixYearRetentionTimestamp(nowMs).toMillis()
                : Date.parse(turnRetentionExpiresAtIso);
            const nextRetentionExpiresAtIso = new Date(
                Math.max(prevExpMs || 0, candidateExpMs || 0)
            ).toISOString();

            const threadRecord: SupplyConversationThread = SupplyConversationThreadSchema.parse({
                threadId,
                tenantId: input.tenantId,
                profileId: input.profileId,
                displayName:
                    prevThread?.retentionPolicy === 'LEGAL_HOLD_PSEUDONYMIZED'
                        ? prevThread.displayName
                        : input.displayName,
                role: input.role,
                phoneMasked:
                    prevThread?.retentionPolicy === 'LEGAL_HOLD_PSEUDONYMIZED'
                        ? prevThread.phoneMasked
                        : resolvedPhoneMasked,
                phoneHashSha256: prevThread?.phoneHashSha256 || resolvedPhoneHash,
                headSeq: seq,
                headHashSha256: turnHash,
                turnCount: seq,
                activeEffectiveChannels: input.scopeSnapshot.effectiveChannels,
                linkedRequisitionIds: mergedReqIds,
                linkedPurchaseIds: mergedPurIds,
                linkedDteIds: mergedDteIds,
                retentionPolicy: nextRetentionPolicy,
                legalHoldTaxYears: nextLegalHoldYears,
                retentionExpiresAtIso: nextRetentionExpiresAtIso,
                pseudonymizedAtIso: prevThread?.pseudonymizedAtIso ?? null,
                lastTurnAtIso: nowIso,
                createdAtIso: prevThread?.createdAtIso || nowIso,
                updatedAtIso: nowIso,
            });

            tx.set(turnRef, turnRecord);
            tx.set(threadRef, threadRecord);
            resultTurn = turnRecord;
            resultThread = threadRecord;
        };

        if (typeof db.runTransaction === 'function') {
            await db.runTransaction(runTx);
        } else {
            await runTx({
                get: (r: any) => r.get(),
                set: (r: any, d: any, opts?: any) => r.set(d, opts),
            });
        }

        return { thread: resultThread, turn: resultTurn };
    }

    public static async listThreads(
        tenantId: string,
        options: {
            profileId?: string;
            channelId?: SupplyWhatsAppChannelId;
            limit?: number;
        } = {}
    ): Promise<SupplyConversationThread[]> {
        const cap = Math.min(200, Math.max(1, options.limit || 100));
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.CONVERSATION_THREADS)
            .where('tenantId', '==', tenantId)
            .limit(cap)
            .get();

        let threads = snap.docs.map((d) => d.data() as SupplyConversationThread);
        if (options.profileId) {
            threads = threads.filter((t) => t.profileId === options.profileId);
        }
        if (options.channelId) {
            threads = threads.filter((t) =>
                (t.activeEffectiveChannels || []).includes(options.channelId!)
            );
        }
        return threads.sort((a, b) => b.lastTurnAtIso.localeCompare(a.lastTurnAtIso));
    }

    public static async getThread(
        tenantId: string,
        threadId: string
    ): Promise<SupplyConversationThread | null> {
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.CONVERSATION_THREADS)
            .doc(threadId)
            .get();
        if (!snap.exists) return null;
        const data = snap.data() as SupplyConversationThread;
        if (data.tenantId !== tenantId) return null;
        return data;
    }

    public static async listTurns(
        tenantId: string,
        threadId: string,
        limit = 500
    ): Promise<SupplyConversationTurn[]> {
        const cap = Math.min(500, Math.max(1, limit));
        const snap = await db
            .collection(SUPPLY_COLLECTIONS.CONVERSATION_TURNS)
            .where('threadId', '==', threadId)
            .limit(cap)
            .get();

        return snap.docs
            .map((d) => d.data() as SupplyConversationTurn)
            .filter((t) => t.tenantId === tenantId)
            .sort((a, b) => a.seq - b.seq);
    }

    public static verifyTurnChain(turns: readonly SupplyConversationTurn[]): VerifyThreadChainResult {
        const sorted = [...turns].sort((a, b) => a.seq - b.seq);
        let expectedPrevHash = GENESIS_CONVERSATION_HASH;

        for (let i = 0; i < sorted.length; i++) {
            const t = sorted[i];
            const expectedSeq = i + 1;
            if (t.seq !== expectedSeq) {
                return {
                    valid: false,
                    turnCount: sorted.length,
                    brokenAtSeq: t.seq,
                    reason: `Secuencia esperada ${expectedSeq}, encontrada ${t.seq}`,
                };
            }
            if (t.prevHash !== expectedPrevHash) {
                return {
                    valid: false,
                    turnCount: sorted.length,
                    brokenAtSeq: t.seq,
                    reason: 'prevHash no coincide con el turno anterior',
                };
            }
            const recomputed = computeConversationTurnHash({
                prevHash: t.prevHash,
                threadId: t.threadId,
                tenantId: t.tenantId,
                profileId: t.profileId,
                seq: t.seq,
                direction: t.direction,
                contentScrubbed: t.contentScrubbed,
                scopeFingerprint: t.scopeSnapshot.scopeFingerprint,
                createdAtIso: t.createdAtIso,
                linkedRequisitionIds: t.linkedRequisitionIds || [],
                linkedPurchaseIds: t.linkedPurchaseIds || [],
                linkedDteIds: t.linkedDteIds || [],
            });
            if (t.turnHash !== recomputed) {
                return {
                    valid: false,
                    turnCount: sorted.length,
                    brokenAtSeq: t.seq,
                    reason: 'turnHash adulterado: discrepancia SHA-256',
                };
            }
            expectedPrevHash = t.turnHash;
        }

        return { valid: true, turnCount: sorted.length };
    }

    public static async exportThread(
        tenantId: string,
        threadId: string,
        format: 'JSON' | 'CSV',
        actor: { actorUid: string; actorEmail: string; ipAddress?: string }
    ): Promise<{
        contentType: string;
        filename: string;
        body: string;
        sha256: string;
        chainVerification: VerifyThreadChainResult;
        turnCount: number;
    }> {
        const thread = await this.getThread(tenantId, threadId);
        if (!thread) {
            throw new Error('THREAD_NOT_FOUND');
        }
        const turns = await this.listTurns(tenantId, threadId);
        const chainVerification = this.verifyTurnChain(turns);

        let body: string;
        let contentType: string;
        let filename: string;

        if (format === 'CSV') {
            const esc = (v: unknown) => {
                let s = String(v ?? '');
                if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) {
                    s = `'${s}`;
                }
                s = s.replace(/"/g, '""');
                return /[;"\r\n]/.test(s) ? `"${s}"` : s;
            };
            const header = [
                'SEQ',
                'CREATED_AT_ISO',
                'DIRECTION',
                'SOURCE',
                'EFFECTIVE_CHANNELS',
                'SCOPE_FINGERPRINT',
                'CONTENT_SCRUBBED',
                'POLICY_AUDIT_REFS',
                'LINKED_REQS',
                'LINKED_PURCHASES',
                'LINKED_DTES',
                'PREV_HASH',
                'TURN_HASH',
            ].join(';');
            const rows = turns.map((t) =>
                [
                    t.seq,
                    t.createdAtIso,
                    t.direction,
                    t.channelSource,
                    (t.scopeSnapshot.effectiveChannels || []).join(','),
                    t.scopeSnapshot.scopeFingerprint,
                    t.contentScrubbed,
                    (t.policyAuditRefs || []).join(','),
                    (t.linkedRequisitionIds || []).join(','),
                    (t.linkedPurchaseIds || []).join(','),
                    (t.linkedDteIds || []).join(','),
                    t.prevHash,
                    t.turnHash,
                ]
                    .map(esc)
                    .join(';')
            );
            body = `\uFEFF${header}\n${rows.join('\n')}\n`;
            contentType = 'text/csv; charset=utf-8';
            filename = `${threadId}.csv`;
        } else {
            body = JSON.stringify(
                {
                    exportedAtIso: new Date().toISOString(),
                    chainVerification,
                    thread,
                    turns,
                },
                null,
                2
            );
            contentType = 'application/json; charset=utf-8';
            filename = `${threadId}.json`;
        }

        const sha256 = crypto.createHash('sha256').update(body, 'utf8').digest('hex');

        await AuditLedger.record({
            tenantId,
            actorUid: actor.actorUid,
            actorEmail: actor.actorEmail,
            action: 'SUPPLY_CONVERSATION_EXPORTED',
            module: 'supply',
            targetEntity: `${SUPPLY_COLLECTIONS.CONVERSATION_THREADS}/${threadId}`,
            details: {
                format,
                turnCount: turns.length,
                chainValid: chainVerification.valid,
                exportSha256: sha256,
            },
            ipAddress: actor.ipAddress,
        });

        return {
            contentType,
            filename,
            body,
            sha256,
            chainVerification,
            turnCount: turns.length,
        };
    }

    /**
     * Procesa solicitud ARCO-P (Ley N° 21.719) sobre un hilo conversacional:
     * - Si existen vínculos tributarios (`TAX_HOLD_6Y` / `legalHoldTaxYears >= 6`), aplica
     *   `LEGAL_HOLD_PSEUDONYMIZED` manteniendo íntegra la cadena SHA-256 por 6 años (Art. 17 Cód. Tributario).
     * - Si es puramente operacional (`OPERATIONAL_24M`), suprime el hilo y sus turnos operacionales.
     */
    public static async applyArcoPSuppressOrPseudonymize(
        tenantId: string,
        profileId: string,
        actor: { actorUid: string; actorEmail: string; ipAddress?: string }
    ): Promise<{
        mode: 'LEGAL_HOLD_PSEUDONYMIZED' | 'DELETED' | 'NOT_FOUND';
        threadId: string;
    }> {
        const threadId = buildConversationThreadId(tenantId, profileId);
        const threadRef = db
            .collection(SUPPLY_COLLECTIONS.CONVERSATION_THREADS)
            .doc(threadId);
        const snap = await threadRef.get();
        if (!snap.exists) {
            return { mode: 'NOT_FOUND', threadId };
        }
        const thread = snap.data() as SupplyConversationThread;
        if (thread.tenantId !== tenantId) {
            return { mode: 'NOT_FOUND', threadId };
        }

        const hasTaxHold =
            thread.legalHoldTaxYears >= 6 ||
            thread.retentionPolicy === 'TAX_HOLD_6Y' ||
            thread.linkedRequisitionIds.length > 0 ||
            thread.linkedPurchaseIds.length > 0 ||
            thread.linkedDteIds.length > 0;

        const nowIso = new Date().toISOString();

        if (hasTaxHold) {
            const updated: SupplyConversationThread = {
                ...thread,
                displayName: 'TITULAR PSEUDONIMIZADO (LEY 21.719)',
                phoneMasked: '***REDACTED***',
                retentionPolicy: 'LEGAL_HOLD_PSEUDONYMIZED',
                legalHoldTaxYears: 6,
                pseudonymizedAtIso: thread.pseudonymizedAtIso || nowIso,
                updatedAtIso: nowIso,
            };
            await threadRef.set(updated);

            await AuditLedger.record({
                tenantId,
                actorUid: actor.actorUid,
                actorEmail: actor.actorEmail,
                action: 'SUPPLY_CONVERSATION_ARCO_P_LEGAL_HOLD_PSEUDONYMIZED',
                module: 'supply',
                targetEntity: `${SUPPLY_COLLECTIONS.CONVERSATION_THREADS}/${threadId}`,
                details: {
                    profileId,
                    legalHoldTaxYears: 6,
                    headHashSha256: thread.headHashSha256,
                },
                ipAddress: actor.ipAddress,
            });

            return { mode: 'LEGAL_HOLD_PSEUDONYMIZED', threadId };
        }

        const turnsSnap = await db
            .collection(SUPPLY_COLLECTIONS.CONVERSATION_TURNS)
            .where('threadId', '==', threadId)
            .limit(500)
            .get();

        for (const tDoc of turnsSnap.docs) {
            await db
                .collection(SUPPLY_COLLECTIONS.CONVERSATION_TURNS)
                .doc(tDoc.id)
                .delete();
        }
        await threadRef.delete();

        await AuditLedger.record({
            tenantId,
            actorUid: actor.actorUid,
            actorEmail: actor.actorEmail,
            action: 'SUPPLY_CONVERSATION_ARCO_P_DELETED',
            module: 'supply',
            targetEntity: `${SUPPLY_COLLECTIONS.CONVERSATION_THREADS}/${threadId}`,
            details: {
                profileId,
                deletedTurnsCount: turnsSnap.size,
            },
            ipAddress: actor.ipAddress,
        });

        return { mode: 'DELETED', threadId };
    }
}
