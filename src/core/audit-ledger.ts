import admin, { db } from '../config/firebase';
import { createHash } from 'crypto';

/**
 * AUDIT LEDGER INMUTABLE (Capa 3: Trazabilidad Bancaria Web 3.0)
 *
 * Colección Firestore `audit_ledger` append-only con encadenamiento criptográfico
 * secuencial SHA-256 (`seq`, `prevHash`, `entryHash = SHA-256(prevHash + canonicalPayload)`)
 * gobernado transaccionalmente mediante `audit_ledger_head/global`.
 */

export type AuditLedgerModule =
    | 'opermaq'
    | 'stockpile'
    | 'b2b-core'
    | 'core'
    | 'test-pilot'
    | 'web3-m2m'
    | 'auth'
    | 'edu';

export interface LedgerEntry {
    tenantId: string;
    actorUid: string;
    actorEmail: string;
    action: string;
    module: AuditLedgerModule;
    targetEntity: string;
    details: Record<string, any>;
    ipAddress?: string;
}

export interface ChainVerificationReport {
    valid: boolean;
    checkedCount: number;
    chainedCount: number;
    legacyUnchainedCount: number;
    headSeq: number | null;
    headHash: string | null;
    firstSeqChecked: number | null;
    lastSeqChecked: number | null;
    brokenAtDocId?: string;
    brokenAtSeq?: number;
    reason?: string;
    verifiedAt: string;
}

const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Serialización JSON determinista con orden lexicográfico de llaves
 * para garantizar reproducibilidad exacta al verificar la cadena.
 */
function canonicalizeValue(value: unknown): unknown {
    if (value === undefined) return null;
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'number' && !Number.isFinite(value)) {
            return null;
        }
        return value;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        return value.map((item) => canonicalizeValue(item));
    }
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
        result[key] = canonicalizeValue(record[key]);
    }
    return result;
}

export function canonicalJsonStringify(payload: Record<string, unknown>): string {
    return JSON.stringify(canonicalizeValue(payload));
}

export class AuditLedger {
    private static readonly COLLECTION_NAME = 'audit_ledger';
    private static readonly HEAD_COLLECTION = 'audit_ledger_head';
    private static readonly HEAD_DOC_ID = 'global';

    private static buildCanonicalPayload(params: {
        seq: number;
        tenantId: string;
        actorUid: string;
        actorEmail: string;
        action: string;
        module: string;
        targetEntity: string;
        ipAddress: string;
        timestamp: number;
        details: Record<string, unknown>;
    }): string {
        return canonicalJsonStringify({
            v: 1,
            seq: params.seq,
            tenantId: params.tenantId,
            actorUid: params.actorUid,
            actorEmail: params.actorEmail,
            action: params.action,
            module: params.module,
            targetEntity: params.targetEntity,
            ipAddress: params.ipAddress,
            timestamp: params.timestamp,
            details: params.details || {},
        });
    }

    public static computeChainedHash(prevHash: string, canonicalPayload: string): string {
        return createHash('sha256')
            .update(`${prevHash}${canonicalPayload}`, 'utf8')
            .digest('hex');
    }

    /**
     * Registra un evento inmutable encadenado criptográficamente mediante transacción atómica.
     */
    public static async record(entry: LedgerEntry): Promise<string> {
        try {
            const headRef = db.collection(this.HEAD_COLLECTION).doc(this.HEAD_DOC_ID);
            const docRef = db.collection(this.COLLECTION_NAME).doc();
            const ipAddress = (entry.ipAddress || 'internal').trim() || 'internal';
            const sanitizedDetails = JSON.parse(
                canonicalJsonStringify((entry.details || {}) as Record<string, unknown>)
            ) as Record<string, unknown>;

            let committedHash = '';
            let committedSeq = 0;

            await db.runTransaction(async (tx) => {
                const headSnap = await tx.get(headRef);
                const headData = headSnap.exists ? headSnap.data() || {} : {};

                const prevSeq = typeof headData.seq === 'number' && Number.isInteger(headData.seq)
                    ? headData.seq
                    : 0;
                const prevHash =
                    typeof headData.lastHash === 'string' && /^[a-f0-9]{64}$/i.test(headData.lastHash)
                        ? headData.lastHash
                        : GENESIS_PREV_HASH;

                const seq = prevSeq + 1;
                const timestamp = Date.now();

                const canonicalPayload = this.buildCanonicalPayload({
                    seq,
                    tenantId: entry.tenantId,
                    actorUid: entry.actorUid,
                    actorEmail: entry.actorEmail,
                    action: entry.action,
                    module: entry.module,
                    targetEntity: entry.targetEntity,
                    ipAddress,
                    timestamp,
                    details: sanitizedDetails,
                });

                const entryHash = this.computeChainedHash(prevHash, canonicalPayload);

                tx.set(docRef, {
                    id: docRef.id,
                    seq,
                    prevHash,
                    entryHash,
                    chainVersion: 1,
                    tenantId: entry.tenantId,
                    actorUid: entry.actorUid,
                    actorEmail: entry.actorEmail,
                    action: entry.action,
                    module: entry.module,
                    targetEntity: entry.targetEntity,
                    details: sanitizedDetails,
                    ipAddress,
                    timestamp,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    immutable: true,
                });

                tx.set(
                    headRef,
                    {
                        seq,
                        lastHash: entryHash,
                        lastEntryId: docRef.id,
                        updatedAt: timestamp,
                    },
                    { merge: true }
                );

                committedHash = entryHash;
                committedSeq = seq;
            });

            console.log(
                `[AUDIT-LEDGER] #${committedSeq} ${entry.action} [${entry.module}] (Hash: ${committedHash.substring(0, 12)}...)`
            );
            return docRef.id;
        } catch (error) {
            console.error('[AUDIT-LEDGER] Error al escribir en el ledger inmutable:', error);
            throw new Error('Fallo crítico al asentar transacción en el ledger inmutable.');
        }
    }

    /**
     * Verifica la integridad criptográfica de las últimas `limit` entradas encadenadas en `audit_ledger`.
     */
    public static async verifyChain(limit: number = 100): Promise<ChainVerificationReport> {
        const safeLimit = Math.min(Math.max(1, Math.floor(limit || 100)), 1000);
        const verifiedAt = new Date().toISOString();

        const headSnap = await db.collection(this.HEAD_COLLECTION).doc(this.HEAD_DOC_ID).get();
        const headData = headSnap.exists ? headSnap.data() || {} : null;
        const headSeq = typeof headData?.seq === 'number' ? headData.seq : null;
        const headHash = typeof headData?.lastHash === 'string' ? headData.lastHash : null;

        const chainedSnap = await db
            .collection(this.COLLECTION_NAME)
            .orderBy('seq', 'desc')
            .limit(safeLimit)
            .get();

        if (chainedSnap.empty) {
            const legacySnap = await db.collection(this.COLLECTION_NAME).limit(safeLimit).get();
            return {
                valid: true,
                checkedCount: legacySnap.size,
                chainedCount: 0,
                legacyUnchainedCount: legacySnap.size,
                headSeq,
                headHash,
                firstSeqChecked: null,
                lastSeqChecked: null,
                verifiedAt,
            };
        }

        // Orden ascendente por `seq` para recorrer los eslabones en orden cronológico
        const docsAsc = [...chainedSnap.docs].reverse();
        let previousEntry: { seq: number; entryHash: string } | null = null;

        for (const doc of docsAsc) {
            const data = doc.data();
            const seq = data.seq;
            const prevHash = data.prevHash;
            const entryHash = data.entryHash;

            if (typeof seq !== 'number' || typeof prevHash !== 'string' || typeof entryHash !== 'string') {
                return {
                    valid: false,
                    checkedCount: docsAsc.length,
                    chainedCount: docsAsc.length,
                    legacyUnchainedCount: 0,
                    headSeq,
                    headHash,
                    firstSeqChecked: docsAsc[0]?.data()?.seq ?? null,
                    lastSeqChecked: docsAsc[docsAsc.length - 1]?.data()?.seq ?? null,
                    brokenAtDocId: doc.id,
                    brokenAtSeq: typeof seq === 'number' ? seq : undefined,
                    reason: 'Metadatos de cadena ausentes o corruptos (seq/prevHash/entryHash).',
                    verifiedAt,
                };
            }

            if (seq === 1 && prevHash !== GENESIS_PREV_HASH) {
                return {
                    valid: false,
                    checkedCount: docsAsc.length,
                    chainedCount: docsAsc.length,
                    legacyUnchainedCount: 0,
                    headSeq,
                    headHash,
                    firstSeqChecked: docsAsc[0]?.data()?.seq ?? null,
                    lastSeqChecked: docsAsc[docsAsc.length - 1]?.data()?.seq ?? null,
                    brokenAtDocId: doc.id,
                    brokenAtSeq: seq,
                    reason: 'El bloque génesis (seq=1) no referencia el hash génesis esperado.',
                    verifiedAt,
                };
            }

            if (previousEntry) {
                if (seq !== previousEntry.seq + 1) {
                    return {
                        valid: false,
                        checkedCount: docsAsc.length,
                        chainedCount: docsAsc.length,
                        legacyUnchainedCount: 0,
                        headSeq,
                        headHash,
                        firstSeqChecked: docsAsc[0]?.data()?.seq ?? null,
                        lastSeqChecked: docsAsc[docsAsc.length - 1]?.data()?.seq ?? null,
                        brokenAtDocId: doc.id,
                        brokenAtSeq: seq,
                        reason: `Salto de secuencia detectado: se esperaba seq=${previousEntry.seq + 1}, se encontró seq=${seq}.`,
                        verifiedAt,
                    };
                }
                if (prevHash !== previousEntry.entryHash) {
                    return {
                        valid: false,
                        checkedCount: docsAsc.length,
                        chainedCount: docsAsc.length,
                        legacyUnchainedCount: 0,
                        headSeq,
                        headHash,
                        firstSeqChecked: docsAsc[0]?.data()?.seq ?? null,
                        lastSeqChecked: docsAsc[docsAsc.length - 1]?.data()?.seq ?? null,
                        brokenAtDocId: doc.id,
                        brokenAtSeq: seq,
                        reason: 'Ruptura de eslabón criptográfico: prevHash no coincide con entryHash anterior.',
                        verifiedAt,
                    };
                }
            }

            const canonicalPayload = this.buildCanonicalPayload({
                seq,
                tenantId: String(data.tenantId || ''),
                actorUid: String(data.actorUid || ''),
                actorEmail: String(data.actorEmail || ''),
                action: String(data.action || ''),
                module: String(data.module || ''),
                targetEntity: String(data.targetEntity || ''),
                ipAddress: String(data.ipAddress || 'internal'),
                timestamp: Number(data.timestamp || 0),
                details: (data.details || {}) as Record<string, unknown>,
            });

            const recomputedHash = this.computeChainedHash(prevHash, canonicalPayload);
            if (recomputedHash !== entryHash) {
                return {
                    valid: false,
                    checkedCount: docsAsc.length,
                    chainedCount: docsAsc.length,
                    legacyUnchainedCount: 0,
                    headSeq,
                    headHash,
                    firstSeqChecked: docsAsc[0]?.data()?.seq ?? null,
                    lastSeqChecked: docsAsc[docsAsc.length - 1]?.data()?.seq ?? null,
                    brokenAtDocId: doc.id,
                    brokenAtSeq: seq,
                    reason: 'Alteración de contenido detectada: el hash SHA-256 recalculado difiere de entryHash.',
                    verifiedAt,
                };
            }

            previousEntry = { seq, entryHash };
        }

        const lastDoc = docsAsc[docsAsc.length - 1].data();
        if (headSeq !== null && lastDoc.seq === headSeq && headHash && lastDoc.entryHash !== headHash) {
            return {
                valid: false,
                checkedCount: docsAsc.length,
                chainedCount: docsAsc.length,
                legacyUnchainedCount: 0,
                headSeq,
                headHash,
                firstSeqChecked: docsAsc[0]?.data()?.seq ?? null,
                lastSeqChecked: lastDoc.seq,
                brokenAtDocId: docsAsc[docsAsc.length - 1].id,
                brokenAtSeq: lastDoc.seq,
                reason: 'El puntero global audit_ledger_head/global no coincide con el último eslabón.',
                verifiedAt,
            };
        }

        return {
            valid: true,
            checkedCount: docsAsc.length,
            chainedCount: docsAsc.length,
            legacyUnchainedCount: 0,
            headSeq,
            headHash,
            firstSeqChecked: docsAsc[0]?.data()?.seq ?? null,
            lastSeqChecked: lastDoc.seq ?? null,
            verifiedAt,
        };
    }
}
