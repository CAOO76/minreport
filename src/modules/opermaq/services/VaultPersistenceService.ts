import { randomUUID } from 'crypto';
import * as admin from 'firebase-admin';
import { db } from '../../../config/firebase';
import type { OpermaqFunctionalContext } from '../../../middleware/sessionScope';
import {
    EquipmentSymbologyPack,
    HistorialAuditoria,
    OperationalCostMatrix,
    PillarDocument,
    PillarId,
    PillarItem,
    SEQUENTIAL_PILLAR_ORDER,
    VALID_PILLAR_IDS,
} from '../types/vault.types';

const MAX_INLINE_AUDIT_ENTRIES = 20;

export interface HydratedCatalogSnapshot {
    exists: boolean;
    id: string;
    data: Record<string, any> | undefined;
    rootSnap: admin.firestore.DocumentSnapshot;
}

function summarizePillarForRoot(pillarId: PillarId, doc: Partial<PillarDocument>): Record<string, any> {
    const items = Array.isArray(doc.items) ? doc.items : [];
    const activeItems = items.filter((it) => !it?.is_discarded);
    const completedCount = activeItems.filter((it) => it?.content_status === 'COMPLETADO').length;
    const approvedCount = activeItems.filter((it) => it?.estado_aprobacion === 'APROBADO_HUMANO').length;
    const lockedCount = activeItems.filter((it) => Boolean(it?.is_human_locked)).length;

    return {
        pillar_id: pillarId,
        status: doc.status || 'IDLE',
        itemize_status: doc.itemize_status || 'IDLE',
        make_model: doc.make_model || '',
        generated_at: doc.generated_at ?? null,
        updated_at: doc.updated_at ?? new Date().toISOString(),
        started_at: doc.started_at ?? null,
        itemized_at: doc.itemized_at ?? null,
        itemize_error: doc.itemize_error ?? null,
        error_message: doc.error_message ?? null,
        structure_digest_sha256: doc.structure_digest_sha256 ?? null,
        content_digest_sha256: doc.content_digest_sha256 ?? null,
        parent_pillar_digest_sha256: doc.parent_pillar_digest_sha256 ?? null,
        active_items_count: activeItems.length,
        completed_items_count: completedCount,
        approved_items_count: approvedCount,
        locked_items_count: lockedCount,
    };
}

/**
 * Repositorio Soberano Anti-1MiB para `global_asset_catalog` (`OPERMAQ v3.0`).
 *
 * - Lectura Dual Transparente (`Dual-Read`): Hidrata `pillars/{pillarId}` y `derived/{docId}`
 *   sobre `global_asset_catalog/{id}` preservando 100% compatibilidad con activos legacy inline.
 * - Escritura Particionada (`Partitioned-Write`): Mantiene el documento raíz `< 25 KB`
 *   aislando capítulos Markdown en `/pillars/{pillarId}`, snapshots históricos en `/item_revisions/{revId}`
 *   y proyecciones derivadas en `/derived/{cost_matrix | symbology_pack}`.
 * - Proyección de Audiencia Ley N° 21.719: Purga PII de curadores e historiales internos en lecturas B2B/EDU.
 */
export class VaultPersistenceService {
    static summarizePillarForRoot(pillarId: PillarId, doc: Partial<PillarDocument>): Record<string, any> {
        return summarizePillarForRoot(pillarId, doc);
    }

    static writePillarInTransaction(
        tx: admin.firestore.Transaction,
        params: {
            globalAssetId: string;
            pillarId: PillarId;
            pillarDoc: PillarDocument;
            vaultMerkleRootSha256?: string | null;
        }
    ): void {
        const { globalAssetId, pillarId, pillarDoc, vaultMerkleRootSha256 } = params;
        const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const pillarRef = docRef.collection('pillars').doc(pillarId);
        const normalizedPillarDoc: PillarDocument = {
            ...pillarDoc,
            pillar_id: pillarId,
            updated_at: pillarDoc.updated_at || new Date().toISOString(),
        };
        const rootSummary = summarizePillarForRoot(pillarId, normalizedPillarDoc);

        tx.set(pillarRef, normalizedPillarDoc);
        tx.set(
            docRef,
            {
                knowledge_vault: {
                    [pillarId]: {
                        ...rootSummary,
                        items: admin.firestore.FieldValue.delete(),
                        content: admin.firestore.FieldValue.delete(),
                        classified_sources: admin.firestore.FieldValue.delete(),
                        classified_sources_itemized: admin.firestore.FieldValue.delete(),
                    },
                    ...(vaultMerkleRootSha256 !== undefined
                        ? { vault_merkle_root_sha256: vaultMerkleRootSha256 }
                        : {}),
                },
                vault_partition_version: 3,
                updatedAt: Date.now(),
            },
            { merge: true }
        );
    }

    static async loadHydratedAssetCatalog(
        globalAssetId: string,
        existingRootSnap?: admin.firestore.DocumentSnapshot
    ): Promise<HydratedCatalogSnapshot> {
        const docRef = db.collection('global_asset_catalog').doc(globalAssetId);

        const [rootSnap, pillarsSnap, derivedSnap] = await Promise.all([
            existingRootSnap ? Promise.resolve(existingRootSnap) : docRef.get(),
            docRef.collection('pillars').get(),
            docRef.collection('derived').get(),
        ]);

        if (!rootSnap.exists) {
            return {
                exists: false,
                id: globalAssetId,
                data: undefined,
                rootSnap,
            };
        }

        const rootData = rootSnap.data() || {};
        const mergedVault: Record<string, any> = {
            ...(rootData.knowledge_vault || {}),
        };

        for (const pDoc of pillarsSnap.docs) {
            const pid = pDoc.id as PillarId;
            if (!VALID_PILLAR_IDS.includes(pid)) continue;
            const subData = pDoc.data() || {};
            const inlineSummary = mergedVault[pid] || {};
            mergedVault[pid] = {
                ...inlineSummary,
                ...subData,
                pillar_id: pid,
                items: Array.isArray(subData.items)
                    ? subData.items
                    : Array.isArray(inlineSummary.items)
                    ? inlineSummary.items
                    : [],
            };
        }

        let hydratedCostMatrix = rootData.operational_cost_matrix;
        let hydratedSymbologyPack = rootData.symbology_pack;

        for (const dDoc of derivedSnap.docs) {
            if (dDoc.id === 'cost_matrix') {
                const dData = dDoc.data();
                if (dData && typeof dData === 'object') {
                    hydratedCostMatrix = dData;
                }
            } else if (dDoc.id === 'symbology_pack') {
                const dData = dDoc.data();
                if (dData && typeof dData === 'object') {
                    hydratedSymbologyPack = dData;
                }
            }
        }

        const hydratedData: Record<string, any> = {
            ...rootData,
            knowledge_vault: mergedVault,
            ...(hydratedCostMatrix ? { operational_cost_matrix: hydratedCostMatrix } : {}),
            ...(hydratedSymbologyPack ? { symbology_pack: hydratedSymbologyPack } : {}),
        };

        return {
            exists: true,
            id: rootSnap.id,
            data: hydratedData,
            rootSnap,
        };
    }

    /**
     * Registra un snapshot histórico en la subcolección inmutable `item_revisions/{revId}`
     * y devuelve la lista `historial_cambios` acotada sin `snapshot_anterior` inline.
     */
    static async appendItemRevision(params: {
        globalAssetId: string;
        pillarId: PillarId;
        itemId: string;
        existingHistory: HistorialAuditoria[] | undefined;
        accion: string;
        actor: string;
        detalle?: string;
        snapshotAnterior?: string | null;
        changedFields?: string[];
    }): Promise<HistorialAuditoria[]> {
        const {
            globalAssetId,
            pillarId,
            itemId,
            existingHistory,
            accion,
            actor,
            detalle,
            snapshotAnterior,
            changedFields,
        } = params;

        const nowIso = new Date().toISOString();
        let revisionId: string | undefined;

        if (typeof snapshotAnterior === 'string' && snapshotAnterior.length > 0) {
            revisionId = `rev_${Date.now()}_${randomUUID().slice(0, 8)}`;
            await db
                .collection('global_asset_catalog')
                .doc(globalAssetId)
                .collection('item_revisions')
                .doc(revisionId)
                .set({
                    revision_id: revisionId,
                    global_asset_id: globalAssetId,
                    pillar_id: pillarId,
                    item_id: itemId,
                    accion,
                    actor,
                    detalle: detalle || null,
                    snapshot_anterior: snapshotAnterior,
                    created_at: nowIso,
                });
        }

        const sanitizedExisting: HistorialAuditoria[] = Array.isArray(existingHistory)
            ? existingHistory.map((entry) => {
                  const { snapshot_anterior: _legacySnap, ...rest } = entry || ({} as any);
                  return rest as HistorialAuditoria;
              })
            : [];

        const nextEntry: HistorialAuditoria = {
            fecha: nowIso,
            accion,
            actor,
            ...(detalle ? { detalle } : {}),
            ...(revisionId ? { revision_id: revisionId } : {}),
            ...(changedFields && changedFields.length > 0 ? { changed_fields: changedFields } : {}),
        };

        return [...sanitizedExisting, nextEntry].slice(-MAX_INLINE_AUDIT_ENTRIES);
    }

    /**
     * Recupera `snapshot_anterior` desde `item_revisions/{revisionId}` o desde un registro legacy inline.
     */
    static async resolveRevisionSnapshot(params: {
        globalAssetId: string;
        historyEntry: HistorialAuditoria | undefined;
    }): Promise<string | null> {
        const { globalAssetId, historyEntry } = params;
        if (!historyEntry) return null;

        if (typeof historyEntry.snapshot_anterior === 'string' && historyEntry.snapshot_anterior.length > 0) {
            return historyEntry.snapshot_anterior;
        }

        if (historyEntry.revision_id) {
            const revSnap = await db
                .collection('global_asset_catalog')
                .doc(globalAssetId)
                .collection('item_revisions')
                .doc(historyEntry.revision_id)
                .get();
            if (revSnap.exists) {
                const snapText = revSnap.data()?.snapshot_anterior;
                return typeof snapText === 'string' ? snapText : null;
            }
        }

        return null;
    }

    /**
     * Sanitiza `items[]` para asegurar que ningún `snapshot_anterior` pesado viaje al documento del pilar,
     * moviendo cualquier snapshot residual legacy a `item_revisions` antes de persistir.
     */
    private static async offloadResidualInlineSnapshots(
        globalAssetId: string,
        pillarId: PillarId,
        items: PillarItem[]
    ): Promise<PillarItem[]> {
        const batchWrites: Array<Promise<any>> = [];
        const cleanedItems = items.map((item) => {
            if (!Array.isArray(item?.historial_cambios) || item.historial_cambios.length === 0) {
                return item;
            }
            const nextHistory = item.historial_cambios
                .map((entry) => {
                    if (
                        entry &&
                        typeof entry.snapshot_anterior === 'string' &&
                        entry.snapshot_anterior.length > 0 &&
                        !entry.revision_id
                    ) {
                        const revId = `rev_mig_${Date.now()}_${randomUUID().slice(0, 8)}`;
                        const snapContent = entry.snapshot_anterior;
                        batchWrites.push(
                            db
                                .collection('global_asset_catalog')
                                .doc(globalAssetId)
                                .collection('item_revisions')
                                .doc(revId)
                                .set({
                                    revision_id: revId,
                                    global_asset_id: globalAssetId,
                                    pillar_id: pillarId,
                                    item_id: item.item_id,
                                    accion: entry.accion || 'MIGRATED_SNAPSHOT',
                                    actor: entry.actor || 'system',
                                    detalle: entry.detalle || null,
                                    snapshot_anterior: snapContent,
                                    created_at: entry.fecha || new Date().toISOString(),
                                })
                        );
                        const { snapshot_anterior: _dropped, ...rest } = entry;
                        return { ...rest, revision_id: revId };
                    }
                    if (entry && 'snapshot_anterior' in entry) {
                        const { snapshot_anterior: _dropped, ...rest } = entry;
                        return rest;
                    }
                    return entry;
                })
                .slice(-MAX_INLINE_AUDIT_ENTRIES);

            return {
                ...item,
                historial_cambios: nextHistory,
            };
        });

        if (batchWrites.length > 0) {
            await Promise.all(batchWrites);
        }
        return cleanedItems;
    }

    /**
     * Persiste un pilar completo en `global_asset_catalog/{id}/pillars/{pillarId}`
     * y actualiza únicamente el resumen ligero + Merkle Root en el documento raíz (`< 25 KB`).
     */
    static async savePillarDocument(params: {
        globalAssetId: string;
        pillarId: PillarId;
        pillarDoc: PillarDocument;
        vaultMerkleRootSha256?: string | null;
        extraRootUpdates?: Record<string, any>;
    }): Promise<void> {
        const { globalAssetId, pillarId, pillarDoc, vaultMerkleRootSha256, extraRootUpdates } = params;
        const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const pillarRef = docRef.collection('pillars').doc(pillarId);

        const rawItems = Array.isArray(pillarDoc.items) ? pillarDoc.items : [];
        const cleanedItems = await this.offloadResidualInlineSnapshots(globalAssetId, pillarId, rawItems);

        const normalizedPillarDoc: PillarDocument = {
            ...pillarDoc,
            pillar_id: pillarId,
            items: cleanedItems,
            updated_at: pillarDoc.updated_at || new Date().toISOString(),
        };

        const rootSummary = summarizePillarForRoot(pillarId, normalizedPillarDoc);
        const batch = db.batch();

        batch.set(pillarRef, normalizedPillarDoc);
        batch.set(
            docRef,
            {
                knowledge_vault: {
                    [pillarId]: {
                        ...rootSummary,
                        items: admin.firestore.FieldValue.delete(),
                        content: admin.firestore.FieldValue.delete(),
                        classified_sources: admin.firestore.FieldValue.delete(),
                        classified_sources_itemized: admin.firestore.FieldValue.delete(),
                    },
                    ...(vaultMerkleRootSha256 !== undefined
                        ? { vault_merkle_root_sha256: vaultMerkleRootSha256 }
                        : {}),
                },
                vault_partition_version: 3,
                updatedAt: Date.now(),
                ...(extraRootUpdates || {}),
            },
            { merge: true }
        );

        await batch.commit();
    }

    /**
     * Persiste múltiples pilares simultáneamente (ej. reconciliación o ingesta multi-pilar).
     */
    static async saveMultiplePillars(params: {
        globalAssetId: string;
        pillars: Partial<Record<PillarId, PillarDocument>>;
        vaultMerkleRootSha256?: string | null;
        extraRootUpdates?: Record<string, any>;
    }): Promise<void> {
        const { globalAssetId, pillars, vaultMerkleRootSha256, extraRootUpdates } = params;
        const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const batch = db.batch();
        const rootVaultPatch: Record<string, any> = {};

        for (const pid of SEQUENTIAL_PILLAR_ORDER) {
            const pDoc = pillars[pid];
            if (!pDoc) continue;
            const rawItems = Array.isArray(pDoc.items) ? pDoc.items : [];
            const cleanedItems = await this.offloadResidualInlineSnapshots(globalAssetId, pid, rawItems);
            const normalized: PillarDocument = {
                ...pDoc,
                pillar_id: pid,
                items: cleanedItems,
                updated_at: pDoc.updated_at || new Date().toISOString(),
            };
            batch.set(docRef.collection('pillars').doc(pid), normalized);
            rootVaultPatch[pid] = {
                ...summarizePillarForRoot(pid, normalized),
                items: admin.firestore.FieldValue.delete(),
                content: admin.firestore.FieldValue.delete(),
                classified_sources: admin.firestore.FieldValue.delete(),
                classified_sources_itemized: admin.firestore.FieldValue.delete(),
            };
        }

        if (vaultMerkleRootSha256 !== undefined) {
            rootVaultPatch.vault_merkle_root_sha256 = vaultMerkleRootSha256;
        }

        batch.set(
            docRef,
            {
                knowledge_vault: rootVaultPatch,
                vault_partition_version: 3,
                updatedAt: Date.now(),
                ...(extraRootUpdates || {}),
            },
            { merge: true }
        );

        await batch.commit();
    }

    /**
     * Persiste la Matriz Determinista de Costos TCO/OPEX/CAPEX en `derived/cost_matrix`
     * y mantiene solo metadatos ligeros en el documento raíz.
     */
    static async saveDerivedCostMatrix(
        globalAssetId: string,
        costMatrix: OperationalCostMatrix,
        extraRootUpdates?: Record<string, any>
    ): Promise<void> {
        const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const derivedRef = docRef.collection('derived').doc('cost_matrix');
        const batch = db.batch();

        batch.set(derivedRef, costMatrix);
        batch.set(
            docRef,
            {
                operational_cost_matrix: admin.firestore.FieldValue.delete(),
                operational_cost_matrix_summary: {
                    version: costMatrix.version,
                    compiled_at: costMatrix.compiled_at,
                    completeness_status: costMatrix.completeness_status,
                    source_merkle_root_sha256: costMatrix.source_merkle_root_sha256 ?? null,
                    primary_tco_unit: costMatrix.taxonomy_meta?.primary_tco_unit || '$ / h',
                    family_key: costMatrix.taxonomy_meta?.family_key || 'INDUSTRIAL_GENERAL',
                },
                updatedAt: Date.now(),
                ...(extraRootUpdates || {}),
            },
            { merge: true }
        );

        await batch.commit();
    }

    /**
     * Persiste el Paquete de Simbología ISO deduplicado en `derived/symbology_pack`
     * y mantiene solo resumen ligero en el documento raíz.
     */
    static async saveDerivedSymbologyPack(
        globalAssetId: string,
        symbologyPack: EquipmentSymbologyPack,
        extraRootUpdates?: Record<string, any>
    ): Promise<void> {
        const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const derivedRef = docRef.collection('derived').doc('symbology_pack');
        const { compiled_entries: _dropDuplicateCopy, ...compactPack } = symbologyPack;

        const batch = db.batch();
        batch.set(derivedRef, compactPack);
        batch.set(
            docRef,
            {
                symbology_pack: admin.firestore.FieldValue.delete(),
                symbology_pack_summary: {
                    generated_at: compactPack.generated_at,
                    archetype_key: compactPack.archetype_key,
                    total_symbols: compactPack.total_symbols,
                    powertrain_tags: compactPack.powertrain_tags,
                },
                updatedAt: Date.now(),
                ...(extraRootUpdates || {}),
            },
            { merge: true }
        );

        await batch.commit();
    }

    /**
     * Proyector de Privacidad Ley N° 21.719 (`Minimización de Datos` y `Privacidad por Defecto`).
     * Para clientes `4º B2B` y `5º EDU`, omite correos/identificadores de curadores internos,
     * historiales de auditoría de edición, borradores de conflicto e ítems descartados.
     */
    static projectAssetForAudience(
        hydratedData: Record<string, any>,
        ctx?: OpermaqFunctionalContext
    ): Record<string, any> {
        const isPrivilegedInternal =
            ctx?.accountTier === 1 || ctx?.accountTier === 2 || ctx?.accountTier === 3;
        if (isPrivilegedInternal) {
            return hydratedData;
        }

        const {
            created_by: _cb,
            createdBy: _cB,
            updated_by: _ub,
            updatedBy: _uB,
            homologated_by: _hb,
            sealed_by: _sb,
            sealedBy: _sB,
            unsealed_by: _usb,
            unsealedBy: _usB,
            official_photo_candidates: _opc,
            ...cleanRoot
        } = hydratedData;

        const rawVault = cleanRoot.knowledge_vault;
        if (rawVault && typeof rawVault === 'object') {
            const projectedVault: Record<string, any> = {};
            for (const [key, val] of Object.entries(rawVault)) {
                if (key === 'sealed_by') continue;
                if (!VALID_PILLAR_IDS.includes(key as PillarId) || !val || typeof val !== 'object') {
                    projectedVault[key] = val;
                    continue;
                }
                const pDoc = val as PillarDocument;
                const activeItems = Array.isArray(pDoc.items)
                    ? pDoc.items
                          .filter((it) => !it?.is_discarded)
                          .map((it) => {
                              const {
                                  created_by: _icb,
                                  approved_by: _iab,
                                  discarded_by: _idb,
                                  last_edit_by: _ileb,
                                  historial_cambios: _ihc,
                                  review_notes: _irn,
                                  pending_conflicts: _ipc,
                                  authorized_delta_buffer: _iadb,
                                  locked_item_advisories: _ilia,
                                  ...publicItem
                              } = it;
                              return publicItem;
                          })
                    : [];

                const { suggested_items_pending: _sip, ...publicPillar } = pDoc;
                projectedVault[key] = {
                    ...publicPillar,
                    items: activeItems,
                };
            }
            cleanRoot.knowledge_vault = projectedVault;
        }

        return cleanRoot;
    }
}
