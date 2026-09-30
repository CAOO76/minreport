import admin, { db } from '../config/firebase';
import { createHash } from 'crypto';

/**
 * AUDIT LEDGER INMUTABLE (Capa 3: Trazabilidad Bancaria Web 3.0)
 * 
 * Colección Firestore 'audit_ledger' append-only inmutable.
 * Registra cada mutación crítica de contratos, licencias de módulos,
 * transacciones de flujos de caja y accesos de usuarios titulares.
 */

export interface LedgerEntry {
    tenantId: string;
    actorUid: string;
    actorEmail: string;
    action: string;
    module: 'opermaq' | 'stockpile' | 'mining-flow' | 'b2b-core';
    targetEntity: string;
    details: Record<string, any>;
    ipAddress?: string;
}

export class AuditLedger {
    private static readonly COLLECTION_NAME = 'audit_ledger';

    /**
     * Registra un evento inmutable con hash de integridad en el ledger
     */
    public static async record(entry: LedgerEntry): Promise<string> {
        try {
            const timestamp = Date.now();
            const rawPayload = JSON.stringify({
                tenantId: entry.tenantId,
                actorUid: entry.actorUid,
                action: entry.action,
                module: entry.module,
                timestamp,
                details: entry.details
            });

            // Generación de hash criptográfico SHA-256 para verificación de inmutabilidad
            const entryHash = createHash('sha256').update(rawPayload).digest('hex');

            const docRef = db.collection(this.COLLECTION_NAME).doc();
            
            await docRef.set({
                id: docRef.id,
                tenantId: entry.tenantId,
                actorUid: entry.actorUid,
                actorEmail: entry.actorEmail,
                action: entry.action,
                module: entry.module,
                targetEntity: entry.targetEntity,
                details: entry.details,
                ipAddress: entry.ipAddress || 'internal',
                entryHash,
                timestamp,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                // Regla de inmutabilidad: el documento no debe ser editado jamás
                immutable: true
            });

            console.log(`[AUDIT-LEDGER] 🛡️ Evento registrado: ${entry.action} [${entry.module}] (Hash: ${entryHash.substring(0, 12)}...)`);
            return docRef.id;
        } catch (error) {
            console.error('[AUDIT-LEDGER] ❌ Error al escribir en el ledger inmutable:', error);
            // En trazabilidad bancaria, los fallos de auditoría deben notificarse de forma crítica
            throw new Error('Fallo crítico al asentar transacción en el ledger inmutable.');
        }
    }
}
